import type { Server } from 'socket.io';
import { GameRegistry } from '@platform/game-engine';
import {
  socketRoomName,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
} from '@platform/types';
import type { SocketData } from './socketAuth.js';

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

/**
 * The ONE way a game state change reaches clients, whatever caused it (a
 * player action, a phase timer, a player leaving, the game starting):
 *   1. public domain events → whole room (GAME_EVENT)
 *   2. a personal GAME_STATE to EACH socket, built with getPlayerView for
 *      that socket's own user — the authoritative state never leaves here.
 */
export async function broadcastGameTransition(
  io: AppServer,
  params: { roomId: string; gameId: string; nextVersion: number; nextState: unknown; events: DomainEvent[] },
): Promise<void> {
  const { roomId, gameId, nextVersion, nextState, events } = params;
  const definition = GameRegistry.get(gameId);
  if (!definition) return;

  const roomName = socketRoomName(roomId);
  if (events.length > 0) {
    io.to(roomName).emit('GAME_EVENT', { roomId, events });
  }

  const sockets = await io.in(roomName).fetchSockets();
  for (const s of sockets) {
    const userId = (s.data as SocketData).userId;
    s.emit('GAME_STATE', {
      roomId,
      stateVersion: nextVersion,
      view: definition.getPlayerView(nextState, userId),
    });
  }
}
