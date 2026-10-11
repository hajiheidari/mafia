import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { getGuestAuth, getRoomService, getGameSessionService, getPhaseScheduler } from '../services.js';
import { notifyGameOfPlayerLeft } from '../realtime/gameLifecycle.js';
import { broadcastGameTransition } from '../realtime/broadcastGameTransition.js';
import { requireAuth } from './requireAuth.js';
import {
  RoomNotFoundError,
  RoomFullError,
  RoomClosedError,
} from '@platform/db';
import {
  PermissionDeniedError,
  NotAMemberError,
  NoActiveSessionError,
  GameNotFoundError,
  InvalidGameConfigError,
  GameAlreadyActiveError,
} from '@platform/core';
import { socketRoomName, type ClientToServerEvents, type ServerToClientEvents } from '@platform/types';
import type { SocketData } from '../realtime/socketAuth.js';

type AppIO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

export async function registerRoomRoutes(app: FastifyInstance, io: AppIO) {
  const roomService = getRoomService();
  const gameSessionService = getGameSessionService();
  const verify = requireAuth(getGuestAuth());
  const scheduler = getPhaseScheduler(io);
  const lifecycleDeps = { gameSessionService, scheduler };

  // POST /api/rooms — create a private room, caller becomes HOST.
  app.post<{ Body: { gameId?: string; maxPlayers?: number } }>('/api/rooms', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;

    const room = await roomService.createRoom(userId, {
      gameId: request.body?.gameId,
      maxPlayers: request.body?.maxPlayers,
    });
    return reply.code(201).send({ room });
  });

  // GET /api/rooms/by-code/:code
  app.get<{ Params: { code: string } }>('/api/rooms/by-code/:code', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;

    const room = await roomService.getRoomByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ code: 'ROOM_NOT_FOUND', message: 'این اتاق دیگر وجود ندارد' });
    }
    return { room };
  });

  // GET /api/rooms/:id
  app.get<{ Params: { id: string } }>('/api/rooms/:id', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;

    const room = await roomService.getRoomById(request.params.id);
    if (!room) {
      return reply.code(404).send({ code: 'ROOM_NOT_FOUND', message: 'این اتاق دیگر وجود ندارد' });
    }
    return { room };
  });

  // POST /api/rooms/join — join by code (also handles /join/[code] on the web app)
  app.post<{ Body: { code: string } }>('/api/rooms/join', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;

    try {
      const room = await roomService.joinByCode(request.body.code, userId);
      return { room };
    } catch (err) {
      if (err instanceof RoomNotFoundError) {
        return reply.code(404).send({ code: 'ROOM_NOT_FOUND', message: 'این اتاق دیگر وجود ندارد' });
      }
      if (err instanceof RoomFullError) {
        return reply.code(409).send({ code: 'ROOM_FULL', message: 'ظرفیت اتاق تکمیل است' });
      }
      if (err instanceof RoomClosedError) {
        return reply.code(410).send({ code: 'ROOM_CLOSED', message: 'این اتاق دیگر وجود ندارد' });
      }
      throw err;
    }
  });

  // POST /api/rooms/:id/leave
  app.post<{ Params: { id: string } }>('/api/rooms/:id/leave', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;
    const result = await roomService.leave(request.params.id, userId);
    if (!result.roomClosed && result.room) {
      io.to(socketRoomName(request.params.id)).emit('PLAYER_LEFT', {
        roomId: request.params.id,
        userId,
        room: result.room,
      });
    }
    await notifyGameOfPlayerLeft(io, lifecycleDeps, {
      roomId: request.params.id,
      userId,
      roomClosed: result.roomClosed,
    });
    return { ok: true };
  });

  // POST /api/rooms/:id/ready — body: { isReady: boolean }
  app.post<{ Params: { id: string }; Body: { isReady: boolean } }>(
    '/api/rooms/:id/ready',
    async (request, reply) => {
      const userId = verify(request, reply);
      if (!userId) return;
      try {
        await roomService.toggleReady(request.params.id, userId, request.body.isReady);
        return { ok: true };
      } catch (err) {
        if (err instanceof NotAMemberError || err instanceof PermissionDeniedError) {
          return reply.code(403).send({ code: 'NOT_ALLOWED', message: 'اجازه انجام این کار را ندارید' });
        }
        throw err;
      }
    },
  );

  // POST /api/rooms/:id/remove-player — host only. body: { targetUserId }
  // Broadcasts PLAYER_LEFT so every connected client updates live, exactly
  // like an explicit ROOM_LEAVE would — kicking someone via the Lobby's
  // host controls must be indistinguishable, from other players' point of
  // view, from that player leaving on their own.
  app.post<{ Params: { id: string }; Body: { targetUserId: string } }>(
    '/api/rooms/:id/remove-player',
    async (request, reply) => {
      const userId = verify(request, reply);
      if (!userId) return;
      try {
        const result = await roomService.removePlayer(request.params.id, userId, request.body.targetUserId);
        if (!result.roomClosed && result.room) {
          io.to(socketRoomName(request.params.id)).emit('PLAYER_LEFT', {
            roomId: request.params.id,
            userId: request.body.targetUserId,
            room: result.room,
          });
        }
        await notifyGameOfPlayerLeft(io, lifecycleDeps, {
          roomId: request.params.id,
          userId: request.body.targetUserId,
          roomClosed: result.roomClosed,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof NotAMemberError || err instanceof PermissionDeniedError) {
          return reply.code(403).send({ code: 'NOT_ALLOWED', message: 'اجازه انجام این کار را ندارید' });
        }
        throw err;
      }
    },
  );

  // POST /api/rooms/:id/start — host only. Starts a GameSession for the
  // room's configured game, broadcasts GAME_STARTED, and immediately sends
  // every currently-connected player their OWN filtered initial view (so
  // the client doesn't have to wait for a first GAME_ACTION round-trip to
  // see anything). See Milestone 6 §12.
  // Optional body: { config } — game-specific settings; the game module
  // validates them inside createInitialState (server-side, never trusted).
  app.post<{ Params: { id: string }; Body: { config?: unknown } | undefined }>('/api/rooms/:id/start', async (request, reply) => {
    const userId = verify(request, reply);
    if (!userId) return;
    const roomId = request.params.id;

    try {
      const started = await gameSessionService.startGame(roomId, userId, undefined, request.body?.config);
      const { gameId } = started;
      io.to(socketRoomName(roomId)).emit('GAME_STARTED', { roomId, gameId });

      // Personal initial view for every connected socket (same helper as
      // every other transition; no public events at start).
      await broadcastGameTransition(io, {
        roomId,
        gameId,
        nextVersion: started.stateVersion,
        nextState: started.state,
        events: [],
      });

      await scheduler.scheduleFromSession({
        sessionId: started.sessionId,
        roomId,
        gameId,
        stateVersion: started.stateVersion,
        state: started.state,
      });

      return { ok: true, gameId };
    } catch (err) {
      if (err instanceof NotAMemberError || err instanceof PermissionDeniedError) {
        return reply.code(403).send({ code: 'NOT_ALLOWED', message: 'اجازه انجام این کار را ندارید' });
      }
      if (err instanceof GameAlreadyActiveError) {
        return reply.code(409).send({ code: 'GAME_ALREADY_ACTIVE', message: 'بازی در حال اجراست' });
      }
      if (err instanceof InvalidGameConfigError) {
        return reply.code(400).send({ code: 'INVALID_CONFIG', message: 'تنظیمات بازی معتبر نیست', reason: err.message });
      }
      if (err instanceof NoActiveSessionError || err instanceof GameNotFoundError) {
        return reply.code(400).send({ code: 'GAME_NOT_FOUND', message: 'امکان شروع بازی وجود ندارد' });
      }
      throw err;
    }
  });
}
