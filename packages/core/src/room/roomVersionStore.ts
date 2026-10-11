import type { Redis } from 'ioredis';

/**
 * Lightweight per-room version counter (see ARCHITECTURE.md §10). Every
 * meaningful room mutation (join/leave/ready/host-transfer/status change)
 * bumps this; clients compare it to their locally cached roomVersion to
 * decide whether they need a fresh ROOM_STATE snapshot.
 *
 * Deliberately NOT a database column — this is disposable, derivable data
 * (worst case on Redis restart: every client just gets one extra resync),
 * so a simple Redis INCR is enough. Not over-engineered per the brief.
 */
export interface RoomVersionStore {
  bump(roomId: string): Promise<number>;
  get(roomId: string): Promise<number>;
}

const KEY_PREFIX = 'room-version:';

export function createRedisRoomVersionStore(redis: Redis): RoomVersionStore {
  return {
    async bump(roomId: string) {
      return redis.incr(KEY_PREFIX + roomId);
    },
    async get(roomId: string) {
      const value = await redis.get(KEY_PREFIX + roomId);
      return value ? Number(value) : 0;
    },
  };
}
