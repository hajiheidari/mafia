import type {
  ActionEnvelope,
  DomainEvent,
  GameDefinition,
  GamePlayer,
} from '@platform/types';

export interface GameSessionState<TState = unknown> {
  gameId: string;
  stateVersion: number;
  state: TState;
}

/**
 * Injected by the caller (apps/server) so the engine package stays storage
 * agnostic. In Phase 1 the server implements this with Redis (short TTL);
 * see ARCHITECTURE.md §8.
 */
export interface IdempotencyStore {
  /** Returns the previously stored result for actionId, if any. */
  get(actionId: string): Promise<ActionOutcome | undefined>;
  set(actionId: string, outcome: ActionOutcome): Promise<void>;
}

export type ActionOutcome =
  | { kind: 'APPLIED'; session: GameSessionState; events: DomainEvent[] }
  | { kind: 'SYNC_REQUIRED'; session: GameSessionState }
  | { kind: 'REJECTED'; reason: string };

export function createInitialSession<TState, TConfig>(
  definition: GameDefinition<TState, unknown, TConfig>,
  players: GamePlayer[],
  config: TConfig,
): GameSessionState<TState> {
  return {
    gameId: definition.id,
    stateVersion: 0,
    state: definition.createInitialState(players, config),
  };
}

/**
 * Action → Validation → State Transition → Domain Event(s).
 * This is the single funnel every game action passes through, regardless
 * of which game module owns the logic. See ARCHITECTURE.md §3.
 */
export async function processAction<TState, TAction>(
  definition: GameDefinition<TState, TAction, unknown>,
  session: GameSessionState<TState>,
  playerId: string,
  envelope: ActionEnvelope<TAction>,
  idempotency: IdempotencyStore,
): Promise<ActionOutcome> {
  const cached = await idempotency.get(envelope.actionId);
  if (cached) return cached;

  if (envelope.clientStateVersion < session.stateVersion) {
    const outcome: ActionOutcome = { kind: 'SYNC_REQUIRED', session };
    await idempotency.set(envelope.actionId, outcome);
    return outcome;
  }

  const validation = definition.validateAction(session.state, playerId, envelope.action);
  if (!validation.valid) {
    const outcome: ActionOutcome = {
      kind: 'REJECTED',
      reason: validation.reason ?? 'invalid_action',
    };
    await idempotency.set(envelope.actionId, outcome);
    return outcome;
  }

  const result = definition.applyAction(session.state, playerId, envelope.action);
  const nextSession: GameSessionState<TState> = {
    gameId: session.gameId,
    stateVersion: session.stateVersion + 1,
    state: result.nextState,
  };

  const outcome: ActionOutcome = {
    kind: 'APPLIED',
    session: nextSession,
    events: result.events,
  };
  await idempotency.set(envelope.actionId, outcome);
  return outcome;
}

/** Builds the per-player filtered payload that is safe to broadcast. */
export function buildPlayerView<TState>(
  definition: GameDefinition<TState, unknown, unknown>,
  session: GameSessionState<TState>,
  playerId: string,
): { stateVersion: number; view: unknown } {
  return {
    stateVersion: session.stateVersion,
    view: definition.getPlayerView(session.state, playerId),
  };
}
