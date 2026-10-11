import { Pool } from 'pg';

/**
 * TEMPORARY IMPLEMENTATION NOTE
 * -----------------------------
 * The application is designed around `prisma/schema.prisma` as the single
 * source of truth for the DB schema (see ARCHITECTURE.md §16), and the
 * intent is to query through the generated Prisma Client everywhere.
 *
 * However, `prisma generate` needs to download a native engine binary from
 * binaries.prisma.sh, which this sandbox's network allowlist blocks (only
 * npm/GitHub/apt are reachable here — see README.md). Without that binary,
 * `@prisma/client` has no typed model methods (`prisma.user...`) to call.
 *
 * To keep Milestone 3 actually runnable and testable in this environment,
 * the repositories in this package use `pg` directly with parameterized
 * SQL against the exact same tables `schema.prisma` defines. This is a
 * drop-in-replaceable implementation detail, not an architecture change:
 * once `prisma generate` can run (any normal machine/CI), these
 * repositories can be swapped to call the generated Prisma Client with an
 * identical function signature, and nothing above this module needs to
 * change.
 */

// IMPORTANT: the Pool is created LAZILY (on first use), not at module load
// time. ES module `import` statements are hoisted and fully evaluated
// before any top-level code in the entry file runs — so if this file
// constructed `new Pool(...)` eagerly at import time, it would capture
// `process.env.DATABASE_URL` before apps/server's dotenv.config() call
// (which is top-level code in index.ts) ever executes, silently connecting
// with an empty connection string. Lazy construction defers reading the
// env var until the first actual query, by which point .env has loaded.
let _pool: Pool | undefined;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

// Proxy so existing call sites can keep writing `pool.query(...)` /
// `pool.connect()` unchanged while still getting lazy initialization.
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
});
