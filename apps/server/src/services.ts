import { Redis } from 'ioredis';
import {
  createRedisSessionStore,
  createRedisRoomVersionStore,
  createRedisPresenceStore,
  createRedisRateLimiter,
  createRedisIdempotencyStore,
  createDbPhaseSchedulerStorage,
  GuestAuthProvider,
  RoomService,
  GameSessionService,
} from '@platform/core';
import { PhaseScheduler } from '@platform/game-engine';
import type { Server } from 'socket.io';
import { broadcastGameTransition } from './realtime/broadcastGameTransition.js';

// Constructed lazily (function, not top-level `new Redis()`) for the same
// reason packages/db's pool is lazy — avoid capturing env vars before
// apps/server/src/index.ts's dotenv.config() has run.
let _redis: Redis | undefined;
let _guestAuth: GuestAuthProvider | undefined;
let _roomService: RoomService | undefined;
let _gameSessionService: GameSessionService | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return _redis;
}

export function getGuestAuth(): GuestAuthProvider {
  if (!_guestAuth) {
    _guestAuth = new GuestAuthProvider({
      sessionStore: createRedisSessionStore(getRedis()),
      jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-secret-change-me',
    });
  }
  return _guestAuth;
}

export function getRoomService(): RoomService {
  if (!_roomService) {
    _roomService = new RoomService(createRedisRoomVersionStore(getRedis()));
  }
  return _roomService;
}

export function getGameSessionService(): GameSessionService {
  if (!_gameSessionService) {
    _gameSessionService = new GameSessionService(createRedisIdempotencyStore(getRedis()));
  }
  return _gameSessionService;
}

export function getPresenceStore() {
  return createRedisPresenceStore(getRedis());
}

export function getRateLimiter() {
  return createRedisRateLimiter(getRedis());
}

// One scheduler per Socket.IO server (tests boot several servers in one
// process; each needs timers that broadcast through ITS OWN io).
const _schedulers = new WeakMap<Server<any, any, any, any>, PhaseScheduler>();

export function getPhaseScheduler(io: Server<any, any, any, any>): PhaseScheduler {
  let scheduler = _schedulers.get(io);
  if (!scheduler) {
    scheduler = new PhaseScheduler(createDbPhaseSchedulerStorage(), {
      onTransition: (session, transition) =>
        broadcastGameTransition(io, {
          roomId: session.roomId,
          gameId: session.gameId,
          nextVersion: transition.nextVersion,
          nextState: transition.nextState,
          events: transition.events,
        }),
    });
    _schedulers.set(io, scheduler);
  }
  return scheduler;
}
