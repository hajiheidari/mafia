import type { ActionResult, DomainEvent, GameDefinition, GamePlayer, ValidationResult, WinResult } from '@platform/types';

/**
 * FakeGame — NOT a real game. Exists solely to prove the Game Engine
 * pipeline (registry -> validate -> apply -> events -> versioning ->
 * player-view filtering -> reconnection) works before Mafia is built.
 *
 * It intentionally includes one "secret" field per player so the automated
 * leak-detection test (tests/game-engine/no-leak.test.ts) has something
 * real to check.
 */

export interface FakePlayerState {
  id: string;
  displayName: string;
  secretNumber: number; // hidden — must never appear in another player's view
  score: number; // public
}

export interface FakeGameState {
  players: FakePlayerState[];
  round: number;
  maxRounds: number;
  finished: boolean;
}

export type FakeGameAction = { type: 'PING' };

export interface FakeGameConfig {
  maxRounds: number;
}

export interface FakePlayerView {
  round: number;
  maxRounds: number;
  finished: boolean;
  you: { id: string; secretNumber: number; score: number };
  others: { id: string; displayName: string; score: number }[];
}

function randomSecret(): number {
  return Math.floor(Math.random() * 100) + 1;
}

/**
 * Assigns each player a UNIQUE secret number. Without this, two players
 * could randomly get the same number (1-in-100 chance per pair), which
 * would make the leak-detection test's "does this number appear anywhere
 * else" check produce a false positive — not a real leak, just a
 * coincidence. Sampling without replacement removes that flakiness.
 */
function assignUniqueSecrets(count: number): number[] {
  const pool = Array.from({ length: 100 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

export const FakeGameDefinition: GameDefinition<FakeGameState, FakeGameAction, FakeGameConfig> = {
  id: 'fake-game',
  name: 'بازی آزمایشی',
  description: 'بازی داخلی برای تست موتور بازی — قابل بازی برای کاربر نیست.',
  icon: 'test-tube',
  minPlayers: 2,
  maxPlayers: 8,
  defaultConfig: { maxRounds: 3 },

  createInitialState(players: GamePlayer[], config: FakeGameConfig): FakeGameState {
    const secrets = assignUniqueSecrets(players.length);
    return {
      players: players.map((p, i) => ({
        id: p.id,
        displayName: p.displayName,
        secretNumber: secrets[i]!,
        score: 0,
      })),
      round: 0,
      maxRounds: config.maxRounds,
      finished: false,
    };
  },

  validateAction(state, playerId, action): ValidationResult {
    if (state.finished) return { valid: false, reason: 'game_already_finished' };
    if (!state.players.some((p) => p.id === playerId)) {
      return { valid: false, reason: 'not_a_player' };
    }
    if (action.type !== 'PING') return { valid: false, reason: 'unknown_action' };
    return { valid: true };
  },

  applyAction(state, playerId, _action): ActionResult<FakeGameState> {
    const events: DomainEvent[] = [];
    const players = state.players.map((p) =>
      p.id === playerId ? { ...p, score: p.score + 1 } : p,
    );
    const round = state.round + 1;
    const finished = round >= state.maxRounds;

    events.push({ type: 'PLAYER_ACTION', playerId, actionType: 'PING' });
    events.push({ type: 'TURN_STARTED', playerId });
    if (finished) {
      const winner = [...players].sort((a, b) => b.score - a.score)[0];
      events.push({ type: 'GAME_FINISHED', winnerSide: winner?.id ?? null });
    }

    return {
      nextState: { ...state, players, round, finished },
      events,
    };
  },

  getNextPhase(): null {
    // FakeGame has no phase system — always resolved synchronously in applyAction.
    return null;
  },

  checkWinCondition(state): WinResult | null {
    if (!state.finished) return null;
    const winner = [...state.players].sort((a, b) => b.score - a.score)[0];
    return { winnerSide: winner?.id ?? null };
  },

  getPlayerView(state, playerId): FakePlayerView {
    const me = state.players.find((p) => p.id === playerId);
    return {
      round: state.round,
      maxRounds: state.maxRounds,
      finished: state.finished,
      you: me
        ? { id: me.id, secretNumber: me.secretNumber, score: me.score }
        : { id: playerId, secretNumber: -1, score: 0 },
      others: state.players
        .filter((p) => p.id !== playerId)
        .map((p) => ({ id: p.id, displayName: p.displayName, score: p.score })),
      // NOTE: secretNumber is deliberately omitted from `others`.
    };
  },
};
