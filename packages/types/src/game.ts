// Generic Game Engine contract. Nothing in this file may reference a
// specific game (Mafia, Spy, ...). See ARCHITECTURE.md §3.

import type { RoomRole, RoomStatus } from './room';

export interface GamePlayer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export type DomainEvent =
  | { type: 'PLAYER_JOINED'; playerId: string }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_READY'; playerId: string }
  | { type: 'GAME_STARTED' }
  | { type: 'PHASE_STARTED'; phase: string; endsAt: number | null }
  | { type: 'TURN_STARTED'; playerId: string }
  | { type: 'PLAYER_ACTION'; playerId: string; actionType: string }
  | { type: 'PLAYER_VOTED'; playerId: string; targetId: string }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'GAME_FINISHED'; winnerSide: string | null }
  // Open-ended variant so game modules can emit their own PUBLIC event
  // types without the engine having to enumerate them.
  | { type: string; [key: string]: unknown };

/** Room-level facts a game may use when deciding whether a player may chat. */
export interface ChatAuthorizationContext {
  roomRole: RoomRole;
  roomStatus: RoomStatus;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ActionResult<TState> {
  nextState: TState;
  events: DomainEvent[];
}

export interface WinResult {
  winnerSide: string | null;
  summary?: Record<string, unknown>;
}

/**
 * Contract every game module must implement. The Core Platform and the
 * Game Engine only ever talk to this interface — never to a concrete game.
 *
 * TState is the full authoritative state (may contain secrets, e.g. hidden
 * roles). getPlayerView() is the ONLY function allowed to leave the server —
 * see ARCHITECTURE.md §7 and the automated leak-detection test in
 * tests/game-engine/no-leak.test.ts.
 */
export interface GameDefinition<TState = unknown, TAction = unknown, TConfig = unknown> {
  id: string;
  name: string;
  description: string;
  icon: string;
  minPlayers: number;
  maxPlayers: number;
  defaultConfig: TConfig;

  createInitialState(players: GamePlayer[], config: TConfig): TState;
  validateAction(state: TState, playerId: string, action: TAction): ValidationResult;
  applyAction(state: TState, playerId: string, action: TAction): ActionResult<TState>;
  getNextPhase(state: TState): ActionResult<TState> | null;
  checkWinCondition(state: TState): WinResult | null;

  /** The ONLY function whose output may be sent to a client. */
  getPlayerView(state: TState, playerId: string): unknown;

  // --- Optional hooks (all opt-in; games that omit them keep M1–M6 behavior) ---

  /**
   * Epoch ms at which the current phase ends and getNextPhase() should be
   * run by the server-side PhaseScheduler. null/undefined = no timer.
   */
  getPhaseEndsAt?(state: TState): number | null;

  /**
   * Called once a player has PERMANENTLY left (explicit leave, kick, or
   * disconnect grace period expiry) — never for a temporary disconnect.
   * Returning null means "no state change".
   */
  onPlayerLeft?(state: TState, playerId: string): ActionResult<TState> | null;

  /**
   * Opt out of optimistic version locking for actions. By default an action
   * sent with an older clientStateVersion gets SYNC_REQUIRED. Games where
   * many players act at the same moment (votes, night actions) and whose
   * validateAction always checks against the CURRENT authoritative state
   * can set this so simultaneous actions don't bounce off each other.
   */
  acceptsStaleClientVersion?: boolean;

  /** Whether this player may send room chat right now. Absent = always allowed. */
  canSendMessage?(state: TState, playerId: string, context: ChatAuthorizationContext): boolean;
}

export interface ActionEnvelope<TAction = unknown> {
  actionId: string; // idempotency key, client-generated UUID
  clientStateVersion: number;
  action: TAction;
}
