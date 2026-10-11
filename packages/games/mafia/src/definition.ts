import { randomInt as cryptoRandomInt } from 'node:crypto';
import type { GameDefinition, GamePlayer } from '@platform/types';
import type { MafiaConfigInput, MafiaRuntime, MafiaState } from './types';
import { MAX_PLAYERS, MIN_PLAYERS, resolveConfig } from './config';
import { assignRoles } from './roleDistribution';
import { validateMafiaAction } from './validation';
import { applyMafiaAction } from './actions';
import { emptyNightActions, nextPhase, setPhase } from './phases';
import { buildPlayerView } from './playerView';
import { handlePlayerLeft } from './leave';

export const MAFIA_GAME_ID = 'mafia';

const defaultRuntime: MafiaRuntime = {
  now: () => Date.now(),
  randomInt: (maxExclusive) => cryptoRandomInt(maxExclusive),
};

/**
 * Factory so tests can inject a clock and RNG; the server registers the
 * default instance (`MafiaGameDefinition`) that uses Date.now and
 * crypto.randomInt.
 */
export function createMafiaDefinition(
  runtime: Partial<MafiaRuntime> = {},
): GameDefinition<MafiaState, unknown, MafiaConfigInput> {
  const rt: MafiaRuntime = { ...defaultRuntime, ...runtime };

  return {
    id: MAFIA_GAME_ID,
    name: 'مافیا',
    description: 'شهروندها در برابر مافیا: شب‌ها مافیا شکار می‌کند، روزها شهر رأی می‌دهد.',
    icon: 'mask',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    // Defaults depend on the player count, so they are filled in by
    // createInitialState; the host only sends overrides.
    defaultConfig: {},
    // Players act simultaneously (ready, night actions, votes) and every
    // action is validated against the current state, so a client that is
    // one broadcast behind must not be bounced with SYNC_REQUIRED.
    acceptsStaleClientVersion: true,

    createInitialState(players: GamePlayer[], configInput: MafiaConfigInput): MafiaState {
      const config = resolveConfig(configInput, players.length);
      const state: MafiaState = {
        phase: 'ROLE_REVEAL',
        phaseEndsAt: null,
        round: 0,
        config,
        players: assignRoles(players, config, rt.randomInt),
        currentNightActions: emptyNightActions(),
        lastDoctorTargetByDoctorId: {},
        investigations: [],
        currentVotes: { votes: {} },
        eliminationHistory: [],
        lastNightOutcome: null,
        lastVoteOutcome: null,
        winner: null,
      };
      setPhase(state, 'ROLE_REVEAL', rt);
      return state;
    },

    validateAction: (state, playerId, action) => validateMafiaAction(state, playerId, action),
    applyAction: (state, playerId, action) => applyMafiaAction(state, playerId, action, rt),
    getNextPhase: (state) => nextPhase(state, rt),
    checkWinCondition: (state) => (state.winner ? { winnerSide: state.winner } : null),
    getPlayerView: (state, playerId) => buildPlayerView(state, playerId),

    getPhaseEndsAt: (state) => (state.phase === 'GAME_FINISHED' ? null : state.phaseEndsAt),
    onPlayerLeft: (state, playerId) => handlePlayerLeft(state, playerId),
    canSendMessage(state, playerId) {
      if (state.phase === 'GAME_FINISHED') return true;
      const me = state.players.find((p) => p.id === playerId);
      return !!me && me.alive;
    },
  };
}

export const MafiaGameDefinition = createMafiaDefinition();
