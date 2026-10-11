// Milestone 1: package skeleton only.
// Real implementations land in Milestone 3 (auth), Milestone 4 (room),
// Milestone 5 (realtime/presence/chat) — see ARCHITECTURE.md roadmap.
export const CORE_PACKAGE_READY = true;
export * from './auth/types';
export * from './auth/sessionStore';
export * from './auth/jwt';
export * from './auth/guestProvider';
export * from './room/roomService';
export * from './room/roomVersionStore';
export * from './room/presenceStore';
export * from './realtime/rateLimiter';
export * from './game/idempotencyStore';
export * from './game/gameSessionService';
