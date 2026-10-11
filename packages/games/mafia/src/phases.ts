import type { ActionResult, DomainEvent } from '@platform/types';
import type { MafiaPhase, MafiaRuntime, MafiaState, MafiaWinner } from './types';
import { PublicEvents } from './events';
import { evaluateWinner } from './winConditions';
import { resolveNight, resolveVote } from './resolution';

// All transition helpers take a private deep copy and mutate it — the
// state passed in is never modified.

const PHASE_SECONDS: Record<Exclude<MafiaPhase, 'GAME_FINISHED'>, keyof MafiaState['config']> = {
  ROLE_REVEAL: 'roleRevealSeconds',
  NIGHT: 'nightSeconds',
  DAY_ANNOUNCEMENT: 'dayAnnouncementSeconds',
  DISCUSSION: 'discussionSeconds',
  VOTING: 'votingSeconds',
  VOTE_RESULT: 'voteResultSeconds',
};

export function setPhase(s: MafiaState, phase: Exclude<MafiaPhase, 'GAME_FINISHED'>, rt: MafiaRuntime): void {
  s.phase = phase;
  const seconds = s.config[PHASE_SECONDS[phase]] as number;
  s.phaseEndsAt = rt.now() + seconds * 1000;
}

export function emptyNightActions(): MafiaState['currentNightActions'] {
  return { mafiaVotes: {}, doctorTarget: null, detectiveTarget: null };
}

/** Mutates s into GAME_FINISHED and appends the public win event. */
export function finishGame(s: MafiaState, winner: MafiaWinner, events: DomainEvent[]): void {
  s.winner = winner;
  s.phase = 'GAME_FINISHED';
  s.phaseEndsAt = null;
  events.push(PublicEvents.gameWon(winner, s));
}

/** After any elimination: finish immediately if someone has won. Returns true if finished. */
export function finishIfWon(s: MafiaState, events: DomainEvent[]): boolean {
  const winner = evaluateWinner(s);
  if (!winner) return false;
  finishGame(s, winner, events);
  return true;
}

function enterNight(s: MafiaState, rt: MafiaRuntime, events: DomainEvent[]): void {
  s.round += 1;
  s.currentNightActions = emptyNightActions();
  s.currentVotes = { votes: {} };
  setPhase(s, 'NIGHT', rt);
  events.push(PublicEvents.nightStarted(s.round));
}

/**
 * Timer-driven transition (called by the platform's PhaseScheduler when
 * phaseEndsAt has passed, or immediately after early completion).
 * CHECK_WIN is not a phase: it is evaluated inline after every elimination.
 */
export function nextPhase(state: MafiaState, rt: MafiaRuntime): ActionResult<MafiaState> | null {
  if (state.phase === 'GAME_FINISHED') return null;
  const s = structuredClone(state);
  const events: DomainEvent[] = [];

  switch (s.phase) {
    case 'ROLE_REVEAL':
      enterNight(s, rt, events);
      break;

    case 'NIGHT': {
      resolveNight(s, events);
      if (!finishIfWon(s, events)) {
        setPhase(s, 'DAY_ANNOUNCEMENT', rt);
        events.push(PublicEvents.dayStarted(s.round));
      }
      break;
    }

    case 'DAY_ANNOUNCEMENT':
      setPhase(s, 'DISCUSSION', rt);
      events.push(PublicEvents.discussionStarted(s.round));
      break;

    case 'DISCUSSION':
      s.currentVotes = { votes: {} };
      setPhase(s, 'VOTING', rt);
      events.push(PublicEvents.voteStarted(s.round));
      break;

    case 'VOTING': {
      resolveVote(s, events);
      if (!finishIfWon(s, events)) setPhase(s, 'VOTE_RESULT', rt);
      break;
    }

    case 'VOTE_RESULT':
      enterNight(s, rt, events);
      break;
  }

  return { nextState: s, events };
}
