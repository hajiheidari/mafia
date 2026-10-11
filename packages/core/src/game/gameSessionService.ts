import {
  createGameSession,
  getActiveSession,
  updateSessionState,
  insertGameEvents,
  getRoomMembers,
  findRoomById,
  findMemberRole,
} from '@platform/db';
import { GameRegistry, processAction, type GameSessionState, type ActionOutcome } from '@platform/game-engine';
import { hasRoomPermission, type ActionEnvelope, type GamePlayer } from '@platform/types';
import type { IdempotencyStore } from '@platform/game-engine';
import { PermissionDeniedError, NotAMemberError } from '../room/roomService';

export class GameNotFoundError extends Error {
  constructor() {
    super('Unknown game id');
    this.name = 'GameNotFoundError';
  }
}

export class NoActiveSessionError extends Error {
  constructor() {
    super('Room has no active game session');
    this.name = 'NoActiveSessionError';
  }
}

/**
 * Bridges the transport-agnostic Game Engine (packages/game-engine) to
 * persistence and room membership. This is where "Action → Validation →
 * State Transition → Domain Event(s) → persistence → player views" (see
 * ARCHITECTURE.md §3) actually happens for a specific room.
 */
export class GameSessionService {
  constructor(private idempotency: IdempotencyStore) {}

  /** Host-only. Creates a fresh GameSession using the room's configured game (or an explicit override). */
  async startGame(roomId: string, actorUserId: string, gameIdOverride?: string) {
    const actorRole = await findMemberRole(roomId, actorUserId);
    if (!actorRole) throw new NotAMemberError();
    if (!hasRoomPermission(actorRole, 'START_GAME')) throw new PermissionDeniedError('START_GAME');

    const room = await findRoomById(roomId);
    if (!room) throw new NoActiveSessionError();

    const gameId = gameIdOverride ?? room.gameId;
    if (!gameId) throw new GameNotFoundError();
    const definition = GameRegistry.get(gameId);
    if (!definition) throw new GameNotFoundError();

    const memberRows = await getRoomMembers(roomId);
    const players: GamePlayer[] = memberRows
      .filter((m) => m.role === 'HOST' || m.role === 'PLAYER')
      .map((m) => ({ id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl }));

    const initialState = definition.createInitialState(players, definition.defaultConfig);
    const row = await createGameSession(roomId, gameId, initialState);
    return { sessionId: row.id, gameId, stateVersion: row.stateVersion };
  }

  async getActiveSession(roomId: string) {
    return getActiveSession(roomId);
  }

  /**
   * Used on reconnection: if a game is active for this room, returns THIS
   * player's filtered view + current stateVersion/phase — never the
   * authoritative state. Returns null if no session is active (perfectly
   * normal — most rooms won't have started a game yet). See Milestone 5
   * follow-up §6.
   */
  async getStateForPlayer(
    roomId: string,
    userId: string,
  ): Promise<{ stateVersion: number; phase: string | null; view: unknown } | null> {
    const sessionRow = await getActiveSession(roomId);
    if (!sessionRow) return null;

    const definition = GameRegistry.get(sessionRow.gameId);
    if (!definition) return null; // defensive: shouldn't happen if the session was created through startGame()

    return {
      stateVersion: sessionRow.stateVersion,
      phase: sessionRow.phase,
      view: definition.getPlayerView(sessionRow.state, userId),
    };
  }

  /**
   * Runs one GAME_ACTION through the full pipeline. Returns the outcome
   * (APPLIED / REJECTED / SYNC_REQUIRED) plus, for APPLIED, the per-player
   * views ready to broadcast — callers must NEVER broadcast `session.state`
   * directly (see ARCHITECTURE.md §7).
   */
  async applyAction(
    roomId: string,
    userId: string,
    envelope: ActionEnvelope,
  ): Promise<{
    outcome: ActionOutcome;
    playerViews?: { userId: string; view: unknown }[];
  }> {
    const role = await findMemberRole(roomId, userId);
    if (!role) throw new NotAMemberError();
    if (!hasRoomPermission(role, 'SEND_GAME_ACTION')) {
      throw new PermissionDeniedError('SEND_GAME_ACTION');
    }

    const sessionRow = await getActiveSession(roomId);
    if (!sessionRow) throw new NoActiveSessionError();

    const definition = GameRegistry.get(sessionRow.gameId);
    if (!definition) throw new GameNotFoundError();

    const session: GameSessionState = {
      gameId: sessionRow.gameId,
      stateVersion: sessionRow.stateVersion,
      state: sessionRow.state,
    };

    const outcome = await processAction(definition, session, userId, envelope, this.idempotency);

    if (outcome.kind !== 'APPLIED') {
      return { outcome };
    }

    await updateSessionState(sessionRow.id, outcome.session.stateVersion, outcome.session.state);
    await insertGameEvents(
      sessionRow.id,
      outcome.events.map((e) => ({
        type: e.type,
        playerId: 'playerId' in e ? e.playerId : null,
        payload: e,
      })),
    );

    const memberRows = await getRoomMembers(roomId);
    const playerViews = memberRows
      .filter((m) => m.role === 'HOST' || m.role === 'PLAYER')
      .map((m) => ({
        userId: m.userId,
        view: definition.getPlayerView(outcome.session.state, m.userId),
      }));

    return { outcome, playerViews };
  }
}
