// Generic Game Engine contract. Nothing in this file may reference a
// specific game (Mafia, Spy, ...). See ARCHITECTURE.md §3.

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
  | { type: 'GAME_FINISHED'; winnerSide: string | null };

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
}

export interface ActionEnvelope<TAction = unknown> {
  actionId: string; // idempotency key, client-generated UUID
  clientStateVersion: number;
  action: TAction;
}
