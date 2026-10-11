import type { FastifyInstance } from 'fastify';
import { findUserById } from '@platform/db';
import { getGuestAuth } from '../services.js';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // must match GuestAuthProvider's TTL

export async function registerAuthRoutes(app: FastifyInstance) {
  const guestAuth = getGuestAuth();
  const isProd = process.env.NODE_ENV === 'production';

  function setSessionCookie(reply: import('fastify').FastifyReply, sessionId: string) {
    reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true, // never readable by client-side JS — see ARCHITECTURE.md §1
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }

  // POST /api/auth/guest — resumes the existing session if the cookie is
  // valid, otherwise creates exactly one new guest user. Refreshing the
  // page must never create a second user.
  app.post('/api/auth/guest', async (request, reply) => {
    const existingSessionId = request.cookies[SESSION_COOKIE_NAME];

    if (existingSessionId) {
      const resumed = await guestAuth.resumeSession(existingSessionId);
      if (resumed) {
        setSessionCookie(reply, resumed.sessionId); // slide the TTL forward
        return {
          user: { id: resumed.userId, displayName: resumed.displayName },
          accessToken: resumed.tokens.accessToken,
          accessTokenExpiresInSeconds: resumed.tokens.accessTokenExpiresInSeconds,
          isNewUser: false,
        };
      }
      // fall through: cookie present but session expired/invalid -> create fresh
    }

    const created = await guestAuth.createGuestSession();
    setSessionCookie(reply, created.sessionId);
    return {
      user: { id: created.userId, displayName: created.displayName },
      accessToken: created.tokens.accessToken,
      accessTokenExpiresInSeconds: created.tokens.accessTokenExpiresInSeconds,
      isNewUser: true,
    };
  });

  // POST /api/auth/refresh — cookie in, new short-lived access token out.
  // No secret is ever readable by client JS in this exchange.
  app.post('/api/auth/refresh', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (!sessionId) {
      return reply.code(401).send({ code: 'NO_SESSION', message: 'اجازه انجام این کار را ندارید' });
    }
    const tokens = await guestAuth.refreshAccessToken(sessionId);
    if (!tokens) {
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      return reply.code(401).send({ code: 'SESSION_EXPIRED', message: 'نشست شما منقضی شده است' });
    }
    return tokens;
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId) await guestAuth.logout(sessionId);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // GET /api/auth/me — requires a valid access token (Authorization header).
  app.get('/api/auth/me', async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      return reply.code(401).send({ code: 'NO_TOKEN', message: 'اجازه انجام این کار را ندارید' });
    }
    const payload = guestAuth.verifyAccessToken(token);
    if (!payload) {
      return reply.code(401).send({ code: 'INVALID_TOKEN', message: 'اجازه انجام این کار را ندارید' });
    }
    const user = await findUserById(payload.sub);
    if (!user) {
      return reply.code(401).send({ code: 'USER_NOT_FOUND', message: 'کاربر یافت نشد' });
    }
    return { user: { id: user.id, displayName: user.displayName, isGuest: user.isGuest } };
  });
}
