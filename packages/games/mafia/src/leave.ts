import type { ActionResult, DomainEvent } from '@platform/types';
import type { MafiaState } from './types';
import { eliminate } from './resolution';
import { PublicEvents } from './events';
import { finishIfWon } from './phases';

/**
 * Permanent leave (never called for a temporary disconnect). In order:
 * dead → cause LEFT → current round → role revealed publicly → excluded
 * from future actions (validation always requires `alive`) → their
 * pending night action / vote removed → win re-checked → GAME_FINISHED if
 * decided, otherwise the current phase simply continues (timer unchanged).
 */
export function handlePlayerLeft(state: MafiaState, playerId: string): ActionResult<MafiaState> | null {
  if (state.phase === 'GAME_FINISHED') return null;
  const existing = state.players.find((p) => p.id === playerId);
  if (!existing || !existing.alive) return null;

  const s = structuredClone(state);
  const events: DomainEvent[] = [];
  const player = s.players.find((p) => p.id === playerId)!;

  eliminate(s, player, 'LEFT');
  events.push(PublicEvents.playerLeft(player.id, player.role));

  delete s.currentNightActions.mafiaVotes[player.id];
  if (player.role === 'DOCTOR') s.currentNightActions.doctorTarget = null;
  if (player.role === 'DETECTIVE') s.currentNightActions.detectiveTarget = null;
  delete s.currentVotes.votes[player.id];

  finishIfWon(s, events);
  return { nextState: s, events };
}
