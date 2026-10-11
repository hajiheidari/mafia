// NOTE: PrismaClient is intentionally NOT instantiated here right now.
// `new PrismaClient()` throws immediately unless `prisma generate` has run
// (see pool.ts for why that can't happen in this sandbox). Re-enable this
// singleton once the client has been generated in a normal environment —
// the repositories below will keep working unchanged either way.
//
// import { PrismaClient } from '@prisma/client';
// const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
// export const prisma = globalForPrisma.prisma ?? new PrismaClient();
// if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from './pool';
export * from './repositories/userRepository';
export * from './repositories/roomRepository';
export * from './repositories/chatRepository';
export * from './repositories/gameSessionRepository';
