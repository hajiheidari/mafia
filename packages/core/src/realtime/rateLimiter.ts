import type { Redis } from 'ioredis';

/**
 * Simple fixed-window rate limiter (Redis INCR + EXPIRE). Deliberately
 * simple, not a sliding-window/token-bucket — per the brief, limits just
 * need to stop abuse without making normal gameplay feel restricted.
 */
export interface RateLimiter {
  /** Returns true if the action is allowed, false if the caller is over the limit. */
  check(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    async check(key, limit, windowSeconds) {
      const fullKey = `ratelimit:${key}`;
      const count = await redis.incr(fullKey);
      if (count === 1) {
        await redis.expire(fullKey, windowSeconds);
      }
      return count <= limit;
    },
  };
}

// Sensible defaults — see Milestone 5 §15.
export const RATE_LIMITS = {
  CHAT: { limit: 8, windowSeconds: 10 }, // ~1 message every 1.25s sustained
  GAME_ACTION: { limit: 20, windowSeconds: 10 },
  ROOM_JOIN: { limit: 10, windowSeconds: 60 },
} as const;
