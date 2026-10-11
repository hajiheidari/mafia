import type { FastifyRequest, FastifyReply } from 'fastify';
import { GuestAuthProvider } from '@platform/core';

/**
 * Extracts and verifies the access token from the Authorization header.
 * Returns the userId on success, or sends a 401 and returns null on
 * failure — callers should `if (!userId) return;` immediately after.
 */
export function requireAuth(guestAuth: GuestAuthProvider) {
  return function verify(request: FastifyRequest, reply: FastifyReply): string | null {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      reply.code(401).send({ code: 'NO_TOKEN', message: 'اجازه انجام این کار را ندارید' });
      return null;
    }
    const payload = guestAuth.verifyAccessToken(token);
    if (!payload) {
      reply.code(401).send({ code: 'INVALID_TOKEN', message: 'اجازه انجام این کار را ندارید' });
      return null;
    }
    return payload.sub;
  };
}
