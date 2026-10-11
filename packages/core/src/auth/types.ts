export interface SessionRecord {
  sessionId: string;
  userId: string;
  isGuest: boolean;
  createdAt: number; // epoch ms
}

/**
 * Storage-agnostic session store contract. In Phase 1 this is backed by
 * Redis (see RedisSessionStore) per ARCHITECTURE.md §1/§2 — the cookie only
 * ever carries this opaque sessionId, never a secret or the userId itself.
 */
export interface SessionStore {
  create(record: SessionRecord, ttlSeconds: number): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  destroy(sessionId: string): Promise<void>;
}

export interface AccessTokenPayload {
  sub: string; // userId
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
}
