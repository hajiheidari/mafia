import type { Redis } from 'ioredis';
import type { IdempotencyStore, ActionOutcome } from '@platform/game-engine';

const KEY_PREFIX = 'action-idem:';
const TTL_SECONDS = 5 * 60; // only needs to survive brief retries/reconnects, not forever

export function createRedisIdempotencyStore(redis: Redis): IdempotencyStore {
  return {
    async get(actionId) {
      const raw = await redis.get(KEY_PREFIX + actionId);
      return raw ? (JSON.parse(raw) as ActionOutcome) : undefined;
    },
    async set(actionId, outcome) {
      await redis.set(KEY_PREFIX + actionId, JSON.stringify(outcome), 'EX', TTL_SECONDS);
    },
  };
}
