import type { Server, Socket } from 'socket.io';
import {
  socketRoomName,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type RealtimeErrorCode,
  type RoomDTO,
} from '@platform/types';
import {
  RoomNotFoundError,
  RoomFullError,
  RoomClosedError,
  insertChatMessage,
  findActiveMembershipForUser,
} from '@platform/db';
import {
  PermissionDeniedError,
  NotAMemberError,
  NoActiveSessionError,
  GameNotFoundError,
  RATE_LIMITS,
  type RoomService,
  type GameSessionService,
  type RateLimiter,
} from '@platform/core';
import type { SocketData } from './socketAuth.js';
import { trackSocketConnected, trackSocketDisconnected, hasActiveSocket } from './socketPresenceTracker.js';

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const DISCONNECT_GRACE_PERIOD_MS_DEFAULT = 20_000;

/**
 * Read lazily (at the moment we actually schedule a timer), NOT captured
 * as a module-level constant at import time. ES module static imports are
 * evaluated before any test's `beforeAll` runs, so a frozen top-level
 * `const X = Number(process.env.X ?? default)` would permanently capture
 * whatever the env var was (or wasn't) at import time — too early for a
 * test to override it. This function re-reads the env var every call.
 */
function getGracePeriodMs(): number {
  return Number(process.env.DISCONNECT_GRACE_PERIOD_MS ?? DISCONNECT_GRACE_PERIOD_MS_DEFAULT);
}
const CHAT_MAX_LENGTH = 500;

// Single-server-instance MVP: pending disconnect timers live in this
// process's memory (see ARCHITECTURE.md §2 — Redis pub/sub for
// multi-instance coordination is explicitly deferred, not needed yet).
// A restart simply drops any in-flight grace periods; the affected member
// will show as disconnected until they reconnect or someone calls
// ROOM_LEAVE. Acceptable for Phase 1.
const pendingDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

function cancelPendingDisconnectTimer(roomId: string, userId: string): void {
  const key = timerKey(roomId, userId);
  const pending = pendingDisconnectTimers.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingDisconnectTimers.delete(key);
  }
}

function sendError(
  socket: AppSocket,
  code: RealtimeErrorCode,
  message: string,
  requestId?: string,
): void {
  socket.emit('ERROR', { code, message, requestId });
}

export function registerRealtimeHandlers(
  io: AppServer,
  deps: {
    roomService: RoomService;
    gameSessionService: GameSessionService;
    rateLimiter: RateLimiter;
  },
) {
  const { roomService, gameSessionService, rateLimiter } = deps;

  /**
   * Shared by BOTH the automatic-reconnect-on-connect path and the
   * explicit ROOM_JOIN handler. Does NOT create membership — the caller
   * is responsible for that (roomService.joinByCode for explicit joins;
   * for auto-reconnect the membership already exists by construction,
   * see findActiveMembershipForUser). This function only ever:
   *   1. Joins the Socket.IO room.
   *   2. Registers the socket in the multi-tab presence tracker.
   *   3. Restores DB presence (isConnected=true) IF this is the user's
   *      first active socket for this room.
   *   4. Sends the CALLER their own ROOM_STATE and, if a game is active,
   *      their own filtered GAME_STATE — never another player's.
   *   5. Broadcasts a presence event to OTHER members, but only when
   *      presence actually changed (i.e. not for a redundant 2nd/3rd tab).
   *
   * See Milestone 5 follow-up §1/§3/§4/§6.
   */
  async function attachSocketToRoom(
    socket: AppSocket,
    roomId: string,
    broadcastKind: 'PLAYER_JOINED' | 'PLAYER_UPDATED',
  ): Promise<RoomDTO | null> {
    const userId = socket.data.userId;
    const roomName = socketRoomName(roomId);

    await socket.join(roomName);
    socket.data.roomId = roomId;

    cancelPendingDisconnectTimer(roomId, userId);
    const { wasFullyDisconnected } = trackSocketConnected(roomId, userId, socket.id);

    // Only flip DB presence (and broadcast) when this is genuinely a
    // connected<->disconnected transition — a second tab joining while the
    // first is still open doesn't change the user's presence.
    const room = wasFullyDisconnected
      ? await roomService.setConnected(roomId, userId, true)
      : await roomService.getRoomById(roomId);
    if (!room) return null; // room vanished concurrently (e.g. closed) — nothing to send

    socket.emit('ROOM_STATE', room);

    const gameState = await gameSessionService.getStateForPlayer(roomId, userId);
    if (gameState) {
      socket.emit('GAME_STATE', { roomId, stateVersion: gameState.stateVersion, view: gameState.view });
    }

    if (wasFullyDisconnected) {
      socket.to(roomName).emit(broadcastKind, { roomId, userId, room });
    }

    return room;
  }

  io.on('connection', (socket: AppSocket) => {
    const userId = socket.data.userId;

    // --- Automatic reconnection (Milestone 5 follow-up §1/§2/§3) ---
    // Every new socket connection — whether truly the user's first-ever
    // connection or Socket.IO silently reconnecting after a dropped
    // network — lands here identically. We derive identity ONLY from the
    // authenticated JWT (socket.data.userId, set by the auth middleware,
    // never from anything the client sends) and look up whether THIS user
    // already has an active room membership. If so, we restore them
    // automatically — the client does not need to call ROOM_JOIN again.
    //
    // IMPORTANT: this runs as fire-and-forget (not awaited) BEFORE any
    // `await` point in this function, so every `socket.on(...)` listener
    // below is registered synchronously, in the same tick as 'connection'.
    // If listener registration were delayed behind an `await`, a client
    // that emits ROOM_JOIN immediately after connecting could have that
    // event arrive before the server had a listener for it — it would be
    // silently dropped. Do not make this handler `async` at the top level.
    void (async () => {
      try {
        const existingMembership = await findActiveMembershipForUser(userId);
        if (existingMembership) {
          // Distinguish "genuinely reconnecting after being offline" from
          // "this membership already existed (e.g. created via REST
          // POST /api/rooms) but no socket has ever attached to it yet" —
          // both find an "existing membership", but only the former is a
          // real reconnection. The DB's isConnected value from BEFORE this
          // socket attaches is the signal: false means they were actually
          // marked offline at some point.
          const priorRoom = await roomService.getRoomById(existingMembership.roomId);
          const priorMember = priorRoom?.members.find((m) => m.userId === userId);
          const wasMarkedDisconnected = priorMember ? !priorMember.isConnected : false;

          await attachSocketToRoom(socket, existingMembership.roomId, 'PLAYER_UPDATED');
          socket.emit('CONNECTION_STATUS', {
            status: wasMarkedDisconnected ? 'reconnected' : 'connected',
            userId,
          });
        } else {
          socket.emit('CONNECTION_STATUS', { status: 'connected', userId });
        }
      } catch (err) {
        console.error('auto-reconnect error', err);
        socket.emit('CONNECTION_STATUS', { status: 'connected', userId }); // fail open, never block the connection itself
      }
    })();

    socket.on('ROOM_JOIN', async ({ code }) => {
      try {
        const allowed = await rateLimiter.check(
          `room-join:${userId}`,
          RATE_LIMITS.ROOM_JOIN.limit,
          RATE_LIMITS.ROOM_JOIN.windowSeconds,
        );
        if (!allowed) return sendError(socket, 'RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است');

        // Creates membership if this is a genuinely new join; idempotent
        // (no-op) if the caller is already an active member — capacity and
        // room-status validation happen here regardless.
        const joinedRoom = await roomService.joinByCode(code, userId);
        await attachSocketToRoom(socket, joinedRoom.id, 'PLAYER_JOINED');
      } catch (err) {
        if (err instanceof RoomNotFoundError) return sendError(socket, 'ROOM_NOT_FOUND', 'این اتاق دیگر وجود ندارد');
        if (err instanceof RoomFullError) return sendError(socket, 'ROOM_FULL', 'ظرفیت اتاق تکمیل است');
        if (err instanceof RoomClosedError) return sendError(socket, 'INVALID_ROOM_STATE', 'این اتاق دیگر وجود ندارد');
        console.error('ROOM_JOIN error', err);
        sendError(socket, 'INVALID_ACTION', 'خطای غیرمنتظره رخ داد');
      }
    });

    socket.on('ROOM_LEAVE', async ({ roomId }) => {
      try {
        const roomName = socketRoomName(roomId);
        const result = await roomService.leave(roomId, userId);
        await socket.leave(roomName);
        if (socket.data.roomId === roomId) socket.data.roomId = undefined;

        trackSocketDisconnected(roomId, userId, socket.id);
        cancelPendingDisconnectTimer(roomId, userId);

        if (!result.roomClosed && result.room) {
          io.to(roomName).emit('PLAYER_LEFT', { roomId, userId, room: result.room });
        }
      } catch (err) {
        console.error('ROOM_LEAVE error', err);
        sendError(socket, 'INVALID_ACTION', 'خطا در خروج از اتاق');
      }
    });

    async function handleReadyChange(roomId: string, isReady: boolean) {
      try {
        // Only the authenticated socket's OWN member row is ever touched —
        // userId always comes from socket.data, never from the payload.
        const room = await roomService.toggleReady(roomId, userId, isReady);
        io.to(socketRoomName(roomId)).emit('PLAYER_UPDATED', { roomId, userId, room });
      } catch (err) {
        if (err instanceof NotAMemberError) return sendError(socket, 'NOT_A_MEMBER', 'شما عضو این اتاق نیستید');
        if (err instanceof PermissionDeniedError) return sendError(socket, 'NOT_AUTHORIZED', 'اجازه انجام این کار را ندارید');
        console.error('READY error', err);
        sendError(socket, 'INVALID_ACTION', 'خطا در تغییر وضعیت آماده‌باش');
      }
    }
    socket.on('PLAYER_READY', ({ roomId }) => handleReadyChange(roomId, true));
    socket.on('PLAYER_UNREADY', ({ roomId }) => handleReadyChange(roomId, false));

    socket.on('CHAT_SEND', async ({ roomId, text }) => {
      try {
        const allowed = await rateLimiter.check(
          `chat:${userId}`,
          RATE_LIMITS.CHAT.limit,
          RATE_LIMITS.CHAT.windowSeconds,
        );
        if (!allowed) return sendError(socket, 'RATE_LIMITED', 'پیام‌های شما بیش از حد مجاز است، کمی صبر کنید');

        const role = await roomService.getMemberRole(roomId, userId);
        if (!role) return sendError(socket, 'NOT_A_MEMBER', 'شما عضو این اتاق نیستید');

        const trimmed = (text ?? '').trim();
        if (trimmed.length === 0) return; // silently ignore empty sends
        const safeText = trimmed.slice(0, CHAT_MAX_LENGTH);

        // userId/displayName/timestamp are ALWAYS server-derived — the
        // client only ever supplies `text`. See Milestone 5 §8.
        const row = await insertChatMessage(roomId, userId, safeText);
        io.to(socketRoomName(roomId)).emit('CHAT_MESSAGE', {
          id: row.id,
          roomId: row.roomId,
          userId: row.userId,
          displayName: row.displayName,
          text: row.text,
          createdAt: row.createdAt.toISOString(),
        });
      } catch (err) {
        console.error('CHAT_SEND error', err);
        sendError(socket, 'INVALID_ACTION', 'خطا در ارسال پیام');
      }
    });

    socket.on('ROOM_SYNC_REQUEST', async ({ roomId }) => {
      try {
        const role = await roomService.getMemberRole(roomId, userId);
        if (!role) return sendError(socket, 'NOT_A_MEMBER', 'شما عضو این اتاق نیستید');
        const room = await roomService.getRoomById(roomId);
        if (!room) return sendError(socket, 'ROOM_NOT_FOUND', 'این اتاق دیگر وجود ندارد');
        socket.emit('ROOM_STATE', room);
      } catch (err) {
        console.error('ROOM_SYNC_REQUEST error', err);
        sendError(socket, 'INVALID_ACTION', 'خطا در همگام‌سازی اتاق');
      }
    });

    socket.on('GAME_ACTION', async ({ roomId, actionId, clientStateVersion, action }) => {
      try {
        const allowed = await rateLimiter.check(
          `game-action:${userId}`,
          RATE_LIMITS.GAME_ACTION.limit,
          RATE_LIMITS.GAME_ACTION.windowSeconds,
        );
        if (!allowed) return sendError(socket, 'RATE_LIMITED', 'تعداد اکشن‌ها بیش از حد مجاز است', actionId);

        const { outcome, playerViews } = await gameSessionService.applyAction(roomId, userId, {
          actionId,
          clientStateVersion,
          action,
        });

        if (outcome.kind === 'REJECTED') {
          return sendError(socket, 'INVALID_ACTION', outcome.reason, actionId);
        }

        if (outcome.kind === 'SYNC_REQUIRED') {
          return socket.emit('SYNC_REQUIRED', { roomId, reason: 'GAME_STATE_VERSION' });
        }

        // APPLIED: broadcast public domain events to everyone, then send
        // each player their OWN filtered view individually — never the
        // shared authoritative state. See ARCHITECTURE.md §7 and the
        // automated leak-detection tests in tests/game-engine/. Every
        // socket currently in the room (including multiple tabs for the
        // same user) gets its own personalized emit here.
        io.to(socketRoomName(roomId)).emit('GAME_EVENT', { roomId, events: outcome.events });

        if (playerViews) {
          const socketsInRoom = await io.in(socketRoomName(roomId)).fetchSockets();
          for (const s of socketsInRoom) {
            const view = playerViews.find((pv) => pv.userId === (s.data as SocketData).userId);
            if (view) {
              s.emit('GAME_STATE', {
                roomId,
                stateVersion: outcome.session.stateVersion,
                view: view.view,
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof NotAMemberError) return sendError(socket, 'NOT_A_MEMBER', 'شما عضو این اتاق نیستید', actionId);
        if (err instanceof PermissionDeniedError) return sendError(socket, 'NOT_AUTHORIZED', 'اجازه انجام این کار را ندارید', actionId);
        if (err instanceof NoActiveSessionError) return sendError(socket, 'GAME_NOT_STARTED', 'بازی هنوز شروع نشده است', actionId);
        if (err instanceof GameNotFoundError) return sendError(socket, 'GAME_NOT_FOUND', 'بازی مورد نظر یافت نشد', actionId);
        console.error('GAME_ACTION error', err);
        sendError(socket, 'INVALID_ACTION', 'خطای غیرمنتظره رخ داد', actionId);
      }
    });

    socket.on('disconnect', async () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      // Multi-tab: only treat this as a real presence change if that was
      // this user's LAST active socket in the room. Another open tab means
      // the user is still very much "here" — see Milestone 5 follow-up §4.
      const { isNowFullyDisconnected } = trackSocketDisconnected(roomId, userId, socket.id);
      if (!isNowFullyDisconnected) return;

      try {
        const room = await roomService.setConnected(roomId, userId, false);
        if (room) {
          io.to(socketRoomName(roomId)).emit('PLAYER_UPDATED', { roomId, userId, room });
        }
      } catch (err) {
        console.error('disconnect presence-update error', err);
      }

      // Grace period: only treat this as a real LEAVE if the user hasn't
      // reconnected (any new socket for them landing back in this room,
      // handled automatically at connection time — see above) within the
      // window. Distinguishes a dropped wifi connection from an actual
      // "I'm done" leave — see Milestone 5 follow-up §5.
      const key = timerKey(roomId, userId);
      const timer = setTimeout(async () => {
        pendingDisconnectTimers.delete(key);
        try {
          if (hasActiveSocket(roomId, userId)) return; // reconnected in the meantime

          const result = await roomService.leave(roomId, userId);
          if (!result.roomClosed && result.room) {
            io.to(socketRoomName(roomId)).emit('PLAYER_LEFT', { roomId, userId, room: result.room });
          }
        } catch (err) {
          console.error('grace-period leave error', err);
        }
      }, getGracePeriodMs());
      // .unref() so this pending timer never keeps the Node process (or, in
      // tests, Fastify's app.close()) alive by itself.
      timer.unref?.();

      pendingDisconnectTimers.set(key, timer);
    });
  });
}

/**
 * Test/shutdown helper: clears every pending disconnect-grace timer. Call
 * this from a server's close/teardown path if you need shutdown to be
 * instant and don't care about the (harmless, already-unref'd) timers
 * firing later — mainly useful so test suites can boot/close many server
 * instances back-to-back without accumulating timers across instances.
 */
export function clearAllPendingDisconnectTimers(): void {
  for (const timer of pendingDisconnectTimers.values()) clearTimeout(timer);
  pendingDisconnectTimers.clear();
}
