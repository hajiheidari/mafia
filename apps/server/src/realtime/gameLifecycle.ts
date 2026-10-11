import type { Server } from 'socket.io';
import type { GameSessionService } from '@platform/core';
import type { PhaseScheduler } from '@platform/game-engine';
import type { ClientToServerEvents, ServerToClientEvents } from '@platform/types';
import type { SocketData } from './socketAuth.js';
import { broadcastGameTransition } from './broadcastGameTransition.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/**
 * A member has PERMANENTLY left a room (ROOM_LEAVE, REST leave, kick, or
 * disconnect grace expiry). Never call this for a transient disconnect.
 *  - room closed (nobody left) → end its game so no timer keeps ticking.
 *  - otherwise → let the game react (onPlayerLeft), broadcast, re-arm timer.
 */
export async function notifyGameOfPlayerLeft(
  io: AppServer,
  deps: { gameSessionService: GameSessionService; scheduler: PhaseScheduler },
  params: { roomId: string; userId: string; roomClosed: boolean },
): Promise<void> {
  const { gameSessionService, scheduler } = deps;
  const { roomId, userId, roomClosed } = params;
  try {
    if (roomClosed) {
      const endedSessionId = await gameSessionService.endActiveSession(roomId);
      if (endedSessionId) scheduler.cancel(endedSessionId);
      return;
    }

    const result = await gameSessionService.notifyPlayerLeft(roomId, userId);
    if (!result) return;

    await broadcastGameTransition(io, result);
    if (result.finished) {
      scheduler.cancel(result.sessionId);
    } else {
      await scheduler.scheduleFromSession({
        sessionId: result.sessionId,
        roomId,
        gameId: result.gameId,
        stateVersion: result.nextVersion,
        state: result.nextState,
      });
    }
  } catch (err) {
    console.error('notifyGameOfPlayerLeft error', err);
  }
}
