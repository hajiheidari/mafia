import type { MafiaPlayerView, MafiaState } from './types';
import { tallyVotes } from './resolution';

/**
 * The ONLY Mafia data that ever leaves the server. Built per recipient:
 *  - everyone: phase, timer, round, public roster (roles only for the
 *    eliminated), public votes, elimination history, winner
 *  - alive mafia: + teammates and their current night votes
 *  - alive doctor: + who they protected last night
 *  - alive detective: + their own investigation results
 *  - every player: + their own role
 *  - dead players: public info only (no team/night info); host: no extras
 *  - GAME_FINISHED: every role revealed
 */
export function buildPlayerView(state: MafiaState, playerId: string): MafiaPlayerView {
  const finished = state.phase === 'GAME_FINISHED';
  const me = state.players.find((p) => p.id === playerId);
  const meAlive = !!me?.alive && !finished;

  let nightTargetId: string | null = null;
  if (me && meAlive && state.phase === 'NIGHT') {
    const a = state.currentNightActions;
    if (me.role === 'MAFIA') nightTargetId = a.mafiaVotes[me.id] ?? null;
    if (me.role === 'DOCTOR') nightTargetId = a.doctorTarget;
    if (me.role === 'DETECTIVE') nightTargetId = a.detectiveTarget;
  }

  const showVotes = state.phase === 'VOTING' || state.phase === 'VOTE_RESULT';
  const view: MafiaPlayerView = {
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    round: state.round,
    setup: {
      mafiaCount: state.config.mafiaCount,
      doctorEnabled: state.config.doctorEnabled,
      detectiveEnabled: state.config.detectiveEnabled,
      playerCount: state.players.length,
    },
    you: {
      id: playerId,
      role: me ? me.role : null,
      alive: !!me?.alive,
      roleReadyAcked: !!me?.roleReadyAcked,
      nightTargetId,
    },
    players: state.players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      alive: p.alive,
      revealedRole: finished || !p.alive ? p.role : null,
      roleReadyAcked: p.roleReadyAcked,
    })),
    currentVoteTally: showVotes
      ? { votes: { ...state.currentVotes.votes }, counts: Object.fromEntries(tallyVotes(state)) }
      : null,
    eliminationHistory: state.eliminationHistory.map((e) => ({ ...e })),
    lastNightOutcome: state.lastNightOutcome ? { ...state.lastNightOutcome } : null,
    lastVoteOutcome: state.lastVoteOutcome ? { ...state.lastVoteOutcome } : null,
    winner: state.winner,
  };

  if (!me || !meAlive) return view;

  if (me.role === 'MAFIA') {
    view.mafiaTeammates = state.players
      .filter((p) => p.role === 'MAFIA' && p.id !== me.id)
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        alive: p.alive,
        currentTargetId: state.phase === 'NIGHT' && p.alive ? state.currentNightActions.mafiaVotes[p.id] ?? null : null,
      }));
  }
  if (me.role === 'DOCTOR') {
    view.doctorLastProtectedId = state.lastDoctorTargetByDoctorId[me.id] ?? null;
  }
  if (me.role === 'DETECTIVE') {
    view.detectiveInvestigations = state.investigations.filter((i) => i.detectiveId === me.id).map((i) => ({ ...i }));
  }
  return view;
}
