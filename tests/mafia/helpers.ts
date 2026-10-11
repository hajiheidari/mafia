import type { GamePlayer } from '@platform/types';
import { createMafiaDefinition, type MafiaPlayerView, type MafiaRole, type MafiaState } from '@platform/game-mafia';

export function makePlayers(n: number): GamePlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, displayName: `Player ${i + 1}`, avatarUrl: null }));
}

/** randomInt(max) = max-1 makes Fisher–Yates a no-op → roles follow list order. */
export const identityRng = (maxExclusive: number) => maxExclusive - 1;

export function makeGame(n = 6, configInput: Record<string, unknown> = {}) {
  const clock = { t: 1_000_000 };
  const def = createMafiaDefinition({ now: () => clock.t, randomInt: identityRng });
  let state = def.createInitialState(makePlayers(n), configInput);

  const act = (playerId: string, action: unknown) => {
    const v = def.validateAction(state, playerId, action);
    if (!v.valid) return { ok: false as const, reason: v.reason, events: [] };
    const r = def.applyAction(state, playerId, action);
    state = r.nextState;
    return { ok: true as const, reason: undefined, events: r.events };
  };
  const next = () => {
    const r = def.getNextPhase(state);
    if (!r) return [];
    state = r.nextState;
    return r.events;
  };
  const view = (id: string) => def.getPlayerView(state, id) as MafiaPlayerView;
  const idsWithRole = (role: MafiaRole) => state.players.filter((p) => p.role === role).map((p) => p.id);
  const alive = () => state.players.filter((p) => p.alive).map((p) => p.id);

  return {
    def,
    clock,
    get state(): MafiaState {
      return state;
    },
    set state(s: MafiaState) {
      state = s;
    },
    act,
    next,
    view,
    idsWithRole,
    alive,
    /** Skip from ROLE_REVEAL into the first NIGHT. */
    toNight() {
      while (state.phase !== 'NIGHT') next();
    },
    toVoting() {
      while (state.phase !== 'VOTING') next();
    },
  };
}
