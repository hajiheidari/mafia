import { randomUUID } from 'node:crypto';
import { createGuestUser, findUserById } from '@platform/db';
import { signAccessToken, verifyAccessToken } from './jwt';
import type { SessionStore, TokenPair } from './types';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days, per ARCHITECTURE.md §1

export interface GuestAuthConfig {
  sessionStore: SessionStore;
  jwtAccessSecret: string;
}

export interface GuestLoginResult {
  userId: string;
  displayName: string;
  sessionId: string;
  tokens: TokenPair;
  /** true if this call created a brand-new user; false if an existing session/user was resumed */
  isNewUser: boolean;
}

/**
 * The Guest AuthProvider. Same shape any future provider (phone/email/
 * google/apple) will follow: given whatever the transport layer (Fastify
 * routes) hands it, resolve to a userId + issue a session + access token.
 * See ARCHITECTURE.md §1 for the full security model.
 */
export class GuestAuthProvider {
  constructor(private config: GuestAuthConfig) {}

  /**
   * Called when the request arrives WITHOUT a valid session cookie.
   * Always creates a new guest User + session — this is the only path
   * that creates a user.
   */
  async createGuestSession(): Promise<GuestLoginResult> {
    const sessionId = randomUUID();
    const user = await createGuestUser(sessionId);

    await this.config.sessionStore.create(
      { sessionId, userId: user.id, isGuest: true, createdAt: Date.now() },
      SESSION_TTL_SECONDS,
    );

    const tokens = signAccessToken({ sub: user.id, sessionId }, this.config.jwtAccessSecret);

    return {
      userId: user.id,
      displayName: user.displayName,
      sessionId,
      tokens,
      isNewUser: true,
    };
  }

  /**
   * Called when the request arrives WITH a session cookie. Resumes the
   * existing user — this must NEVER create a new user. Returns null if the
   * session is missing/expired, so the caller can fall back to
   * createGuestSession().
   */
  async resumeSession(sessionId: string): Promise<GuestLoginResult | null> {
    const session = await this.config.sessionStore.get(sessionId);
    if (!session) return null;

    const user = await findUserById(session.userId);
    if (!user) return null; // orphaned session (user deleted) — treat as invalid

    const tokens = signAccessToken({ sub: user.id, sessionId }, this.config.jwtAccessSecret);

    return {
      userId: user.id,
      displayName: user.displayName,
      sessionId,
      tokens,
      isNewUser: false,
    };
  }

  /** Silent refresh: cookie is valid, client just needs a new access token. */
  async refreshAccessToken(sessionId: string): Promise<TokenPair | null> {
    const session = await this.config.sessionStore.get(sessionId);
    if (!session) return null;
    return signAccessToken(
      { sub: session.userId, sessionId },
      this.config.jwtAccessSecret,
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.config.sessionStore.destroy(sessionId);
  }

  verifyAccessToken(token: string) {
    return verifyAccessToken(token, this.config.jwtAccessSecret);
  }
}
