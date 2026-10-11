# Persian Party Games Platform

A reusable Persian-first, mobile-first, RTL online party-games platform.
Phase 1 delivers the **platform foundation** (rooms, lobby, realtime, guest
auth, a generic Game Engine) — no real game (Mafia, Spy, ...) is implemented
yet. See `ARCHITECTURE.md` for the full design.

## Monorepo layout

```
/apps
  /web        Next.js 14 (App Router, TypeScript, Tailwind, RTL)
  /server     Fastify + Socket.IO
/packages
  /types      Shared TS contracts (Room, GameDefinition, Socket events)
  /game-engine  Generic engine: registry, action pipeline, versioning
  /games/fake-game  Placeholder game — proves the engine works end to end
  /games/mafia      Mafia (first real game) — see packages/games/mafia/docs/MAFIA_SPEC.md
/web              Offline Mafia narrator tool + landing pages (mafia.espadna.com) — web/README.md
/mobile           Android (Cafe Bazaar) / iOS apps of the narrator tool — mobile/README.md
  /core       Auth/room/chat/presence package skeleton (filled in per milestone)
  /ui         Shared React components
  /i18n       Persian strings (fa.json) — no game is added here
  /db         Prisma client singleton
/prisma       schema.prisma + migrations
/tests        Cross-cutting tests (e.g. the leak-detection suite)
```

## Requirements

- Node.js 20+
- PostgreSQL 16
- Redis 7

## Install

```bash
npm install
cp .env.example .env   # edit DATABASE_URL / REDIS_URL if needed
```

## Database

```bash
createdb party_platform   # or: psql -c "CREATE DATABASE party_platform;"
npx prisma migrate dev
npx prisma generate
```

> **Note on this delivery:** the schema was developed and verified against a
> real local PostgreSQL instance by applying the equivalent hand-written SQL
> in `prisma/migrations/00000000000000_init/migration.sql` directly, because
> the sandbox this was built in cannot reach `binaries.prisma.sh` (Prisma's
> engine-binary CDN) — only a fixed allowlist of domains (npm, GitHub, apt)
> is reachable there. On a normal machine or CI with unrestricted network,
> just delete that migration folder and run `npx prisma migrate dev` against
> an empty database; Prisma will generate and apply its own migration and
> take over tracking normally from there. Every table, relation, index, and
> cascade in that SQL file was tested with real inserts/deletes.

## Run locally

```bash
npm run dev        # runs apps/web (:3000) and apps/server (:4000) via turbo
```

## Test

```bash
npm run test        # vitest — engine, scheduler, mafia rules + realtime integration
npm run typecheck    # tsc --noEmit across every package
```

Backend tests need PostgreSQL and Redis running and the env from `.env`
loaded (e.g. `set -a && . ./.env && set +a && NODE_ENV=test npm run test`).
The web app's own tests run with `cd apps/web && npx vitest run`.

## Adding a new game module

1. Create `packages/games/<game-id>` implementing `GameDefinition` from
   `@platform/types` (see `packages/games/fake-game/src/index.ts` for a
   minimal example).
2. `GameRegistry.register(YourGameDefinition)` — the only place `apps/server`
   is allowed to import the game module.
3. Add a UI package/module for the game's screens, rendered inside the
   shared `GameShell`.
4. The automated leak-detection test in `tests/game-engine/no-leak.test.ts`
   picks up any registered game automatically — no new test required for
   the base guarantee.

No other file needs to change. Core Platform and Game Engine code must never
import a specific game package.
