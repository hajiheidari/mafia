import {
  createGameSession,
  getActiveSession,
  casApplyPhaseTransition,
  insertGameEvents,
  endSession,
  getRoomMembers,
  findRoomById,
  findMemberRole,
} from '@platform/db';
import {
  GameRegistry,
  processAction,
  isGameFinished,
  type GameSessionState,
  type ActionOutcome,
} from '@platform/game-engine';
import {
  hasRoomPermission,
  type ActionEnvelope,
  type DomainEvent,
  type GamePlayer,
  type RoomRole,
  type RoomStatus,
} from '@platform/types';
import type { IdempotencyStore } from '@platform/game-engine';
import { PermissionDeniedError, NotAMemberError } from '../room/roomService';
import { toGameEventRows } from './phaseSchedulerStorage';

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

export class GameAlreadyActiveError extends Error {
  constructor() {
    super('Room already has an active game session');
    this.name = 'GameAlreadyActiveError';
  }
}

/** createInitialState rejected the players/config (e.g. too few players for the game). */
export class InvalidGameConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGameConfigError';
  }
}

/** Result of a state change that did not come from a player's GAME_ACTION. */
export interface GameTransitionResult {
  sessionId: string;
  roomId: string;
  gameId: string;
  nextVersion: number;
  nextState: unknown;
  events: DomainEvent[];
  finished: boolean;
}

const PLAYER_LEFT_CAS_ATTEMPTS = 5;

/**
 * Bridges the transport-agnostic Game Engine (packages/game-engine) to
 * persistence and room membership. This is where "Action → Validation →
 * State Transition → Domain Event(s) → persistence → player views" (see
 * ARCHITECTURE.md §3) actually happens for a specific room.
 */
export class GameSessionService {
  constructor(private idempotency: IdempotencyStore) {}

  /** Host-only. Creates a fresh GameSession using the room's configured game (or an explicit override). */
  async startGame(roomId: string, actorUserId: string, gameIdOverride?: string, configOverride?: unknown) {
    const actorRole = await findMemberRole(roomId, actorUserId);
    if (!actorRole) throw new NotAMemberError();
    if (!hasRoomPermission(actorRole, 'START_GAME')) throw new PermissionDeniedError('START_GAME');

    const room = await findRoomById(roomId);
    if (!room) throw new NoActiveSessionError();

    const gameId = gameIdOverride ?? room.gameId;
    if (!gameId) throw new GameNotFoundError();
    const definition = GameRegistry.get(gameId);
    if (!definition) throw new GameNotFoundError();

    if (await getActiveSession(roomId)) throw new GameAlreadyActiveError();

    const memberRows = await getRoomMembers(roomId);
    const players: GamePlayer[] = memberRows
      .filter((m) => m.role === 'HOST' || m.role === 'PLAYER')
      .map((m) => ({ id: m.userId, displayName: m.displayName, avatarUrl: m.avatarUrl }));

    const config =
      configOverride && typeof configOverride === 'object'
        ? { ...(definition.defaultConfig as object), ...(configOverride as object) }
        : definition.defaultConfig;

    let initialState: unknown;
    try {
      initialState = definition.createInitialState(players, config);
    } catch (err) {
      throw new InvalidGameConfigError(err instanceof Error ? err.message : 'invalid_config');
    }
    const row = await createGameSession(roomId, gameId, initialState);
    return { sessionId: row.id, roomId, gameId, stateVersion: row.stateVersion, state: initialState };
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
    sessionId?: string;
    gameId?: string;
    finished?: boolean;
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

    // Idempotent replay of an action that was already applied earlier: the
    // cached outcome's version no longer lines up with the stored one. Never
    // write the cached state back — just re-send everyone the CURRENT views.
    if (outcome.session.stateVersion !== sessionRow.stateVersion + 1) {
      const replay: ActionOutcome = { kind: 'APPLIED', session, events: [] };
      return {
        outcome: replay,
        playerViews: await this.buildPlayerViews(roomId, definition, sessionRow.state),
        sessionId: sessionRow.id,
        gameId: sessionRow.gameId,
        finished: false,
      };
    }

    // CAS so an action can never overwrite a phase transition (timer) or a
    // leave that landed between our read and this write.
    const written = await casApplyPhaseTransition({
      sessionId: sessionRow.id,
      expectedVersion: sessionRow.stateVersion,
      nextVersion: outcome.session.stateVersion,
      nextState: outcome.session.state,
    });
    if (!written) {
      const current = await getActiveSession(roomId);
      const syncOutcome: ActionOutcome = {
        kind: 'SYNC_REQUIRED',
        session: {
          gameId: sessionRow.gameId,
          stateVersion: current?.stateVersion ?? sessionRow.stateVersion,
          state: null, // never needed by callers; avoid caching the authoritative state again
        },
      };
      await this.idempotency.set(envelope.actionId, syncOutcome);
      return { outcome: syncOutcome };
    }
    await insertGameEvents(sessionRow.id, toGameEventRows(outcome.events));

    const finished = isGameFinished(definition, outcome.session.state);
    if (finished) await endSession(sessionRow.id);

    const playerViews = await this.buildPlayerViews(roomId, definition, outcome.session.state);

    return { outcome, playerViews, sessionId: sessionRow.id, gameId: sessionRow.gameId, finished };
  }

  private async buildPlayerViews(
    roomId: string,
    definition: { getPlayerView(state: unknown, playerId: string): unknown },
    state: unknown,
  ) {
    const memberRows = await getRoomMembers(roomId);
    return memberRows
      .filter((m) => m.role === 'HOST' || m.role === 'PLAYER')
      .map((m) => ({ userId: m.userId, view: definition.getPlayerView(state, m.userId) }));
  }

  /**
   * A player has PERMANENTLY left the room (explicit leave, kick, or grace
   * period expiry — never a transient disconnect). Lets the game react via
   * its optional onPlayerLeft hook. Written with CAS; on a lost race the
   * hook is re-run against the fresh state so the leave is never dropped.
   */
  async notifyPlayerLeft(roomId: string, playerId: string): Promise<GameTransitionResult | null> {
    for (let attempt = 0; attempt < PLAYER_LEFT_CAS_ATTEMPTS; attempt++) {
      const sessionRow = await getActiveSession(roomId);
      if (!sessionRow) return null;
      const definition = GameRegistry.get(sessionRow.gameId);
      if (!definition?.onPlayerLeft) return null;

      const result = definition.onPlayerLeft(sessionRow.state, playerId);
      if (!result) return null;

      const nextVersion = sessionRow.stateVersion + 1;
      const written = await casApplyPhaseTransition({
        sessionId: sessionRow.id,
        expectedVersion: sessionRow.stateVersion,
        nextVersion,
        nextState: result.nextState,
      });
      if (!written) continue;

      await insertGameEvents(sessionRow.id, toGameEventRows(result.events));
      const finished = isGameFinished(definition, result.nextState);
      if (finished) await endSession(sessionRow.id);

      return {
        sessionId: sessionRow.id,
        roomId,
        gameId: sessionRow.gameId,
        nextVersion,
        nextState: result.nextState,
        events: result.events,
        finished,
      };
    }
    throw new Error('notifyPlayerLeft: could not apply leave after repeated version conflicts');
  }

  /** Room was closed (everyone left): end its game so nothing keeps ticking. */
  async endActiveSession(roomId: string): Promise<string | null> {
    const sessionRow = await getActiveSession(roomId);
    if (!sessionRow) return null;
    await endSession(sessionRow.id);
    return sessionRow.id;
  }

  /**
   * Game-level chat gate. No active session, or a game without the
   * canSendMessage hook (e.g. fake-game) → always allowed.
   */
  async checkChatPermission(
    roomId: string,
    userId: string,
    roomRole: RoomRole,
    roomStatus: RoomStatus,
  ): Promise<boolean> {
    const sessionRow = await getActiveSession(roomId);
    if (!sessionRow) return true;
    const definition = GameRegistry.get(sessionRow.gameId);
    if (!definition?.canSendMessage) return true;
    return definition.canSendMessage(sessionRow.state, userId, { roomRole, roomStatus });
  }
}
