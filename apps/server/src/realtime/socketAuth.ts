import type { Socket } from 'socket.io';
import type { GuestAuthProvider } from '@platform/core';

export interface SocketData {
  userId: string;
  roomId?: string;
}

/**
 * Socket.IO middleware (`io.use`). The client must send its short-lived
 * access token (the same one issued by POST /api/auth/guest) as
 * `handshake.auth.token`. Never trust a userId sent any other way — this
 * is the ONLY place a socket's identity is established, and every
 * subsequent handler reads it from `socket.data.userId`, never from an
 * event payload. See ARCHITECTURE.md Milestone 5 §1.
 */
export function createSocketAuthMiddleware(guestAuth: GuestAuthProvider) {
  return (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('NOT_AUTHENTICATED'));
    }
    const payload = guestAuth.verifyAccessToken(token);
    if (!payload) {
      return next(new Error('NOT_AUTHENTICATED'));
    }
    (socket.data as SocketData).userId = payload.sub;
    next();
  };
}
