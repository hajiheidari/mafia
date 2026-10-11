import type { Redis } from 'ioredis';
import type { SessionRecord, SessionStore } from './types';

const KEY_PREFIX = 'session:';

export function createRedisSessionStore(redis: Redis): SessionStore {
  return {
    async create(record, ttlSeconds) {
      await redis.set(KEY_PREFIX + record.sessionId, JSON.stringify(record), 'EX', ttlSeconds);
    },
    async get(sessionId) {
      const raw = await redis.get(KEY_PREFIX + sessionId);
      return raw ? (JSON.parse(raw) as SessionRecord) : null;
    },
    async destroy(sessionId) {
      await redis.del(KEY_PREFIX + sessionId);
    },
  };
}
