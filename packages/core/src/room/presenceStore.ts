import type { Redis } from 'ioredis';

const KEY_PREFIX = 'presence:';

function key(roomId: string, userId: string): string {
  return `${KEY_PREFIX}${roomId}:${userId}`;
}

/**
 * Tracks whether a room member's socket is currently connected. Backed by
 * Redis so it's consistent even if the server restarts (an entry simply
 * expires and the member is treated as disconnected — safe default).
 */
export interface PresenceStore {
  setConnected(roomId: string, userId: string): Promise<void>;
  setDisconnected(roomId: string, userId: string): Promise<void>;
  isConnected(roomId: string, userId: string): Promise<boolean>;
}

const PRESENCE_TTL_SECONDS = 60 * 60; // safety net only; explicit set/clear is the primary path

export function createRedisPresenceStore(redis: Redis): PresenceStore {
  return {
    async setConnected(roomId, userId) {
      await redis.set(key(roomId, userId), '1', 'EX', PRESENCE_TTL_SECONDS);
    },
    async setDisconnected(roomId, userId) {
      await redis.del(key(roomId, userId));
    },
    async isConnected(roomId, userId) {
      const value = await redis.get(key(roomId, userId));
      return value === '1';
    },
  };
}
