import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { SessionRecord, SessionStore } from '@platform/core';

// Mock @platform/db so this test suite doesn't need a live Postgres.
vi.mock('@platform/db', () => {
  const users = new Map<string, { id: string; displayName: string }>();
  let counter = 0;
  return {
    createGuestUser: vi.fn(async (_providerId: string) => {
      const id = `user-${++counter}`;
      const user = { id, displayName: `Guest ${counter}` };
      users.set(id, user);
      return user;
    }),
    findUserById: vi.fn(async (id: string) => users.get(id) ?? null),
  };
});

function createMemorySessionStore(): SessionStore {
  const store = new Map<string, SessionRecord>();
  return {
    async create(record) {
      store.set(record.sessionId, record);
    },
    async get(sessionId) {
      return store.get(sessionId) ?? null;
    },
    async destroy(sessionId) {
      store.delete(sessionId);
    },
  };
}

describe('GuestAuthProvider', () => {
  let GuestAuthProvider: typeof import('@platform/core').GuestAuthProvider;
  let sessionStore: SessionStore;
  let provider: InstanceType<typeof import('@platform/core').GuestAuthProvider>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GuestAuthProvider } = await import('@platform/core'));
    sessionStore = createMemorySessionStore();
    provider = new GuestAuthProvider({ sessionStore, jwtAccessSecret: 'test-secret' });
  });

  test('createGuestSession always creates exactly one new user', async () => {
    const { createGuestUser } = await import('@platform/db');
    const result = await provider.createGuestSession();

    expect(result.isNewUser).toBe(true);
    expect(createGuestUser).toHaveBeenCalledTimes(1);
    expect(result.tokens.accessToken).toBeTruthy();
  });

  test('resumeSession with a valid sessionId does NOT create a new user (simulates page refresh)', async () => {
    const { createGuestUser } = await import('@platform/db');
    const created = await provider.createGuestSession();

    const resumed = await provider.resumeSession(created.sessionId);

    expect(resumed).not.toBeNull();
    expect(resumed?.userId).toBe(created.userId);
    expect(resumed?.isNewUser).toBe(false);
    expect(createGuestUser).toHaveBeenCalledTimes(1); // still just once
  });

  test('resumeSession with an unknown sessionId returns null (caller must fall back to createGuestSession)', async () => {
    const resumed = await provider.resumeSession('does-not-exist');
    expect(resumed).toBeNull();
  });

  test('refreshAccessToken issues a new token for a valid session without touching the DB', async () => {
    const { createGuestUser } = await import('@platform/db');
    const created = await provider.createGuestSession();

    const refreshed = await provider.refreshAccessToken(created.sessionId);

    expect(refreshed).not.toBeNull();
    // NOTE: two tokens signed with an identical payload (sub, sessionId, iat)
    // within the same second are byte-identical — that's correct HMAC
    // behavior, not a bug, so we don't assert token inequality here.
    expect(createGuestUser).toHaveBeenCalledTimes(1); // refresh never creates a user
  });

  test('logout invalidates the session so refresh subsequently fails', async () => {
    const created = await provider.createGuestSession();
    await provider.logout(created.sessionId);

    const refreshed = await provider.refreshAccessToken(created.sessionId);
    expect(refreshed).toBeNull();
  });

  test('verifyAccessToken rejects a token signed with a different secret', async () => {
    const otherProvider = new (
      await import('@platform/core')
    ).GuestAuthProvider({ sessionStore, jwtAccessSecret: 'a-different-secret' });
    const created = await otherProvider.createGuestSession();

    expect(provider.verifyAccessToken(created.tokens.accessToken)).toBeNull();
  });
});
