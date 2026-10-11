import type { DomainEvent } from '@platform/types';
import type { MafiaRole, MafiaState, MafiaWinner } from './types';

/**
 * PUBLIC events only — everything built here is broadcast to the whole
 * room via GAME_EVENT and persisted. Night choices (mafia target, doctor
 * protection, detective result) are PRIVATE and are deliberately NOT
 * representable here: they only ever reach the acting player through
 * their own getPlayerView().
 */
export const PublicEvents = {
  playerRoleAcked: (playerId: string): DomainEvent => ({ type: 'PLAYER_ROLE_ACKED', playerId }),
  nightStarted: (round: number): DomainEvent => ({ type: 'NIGHT_STARTED', round }),
  nightResolved: (round: number, eliminatedPlayerId: string | null, revealedRole: MafiaRole | null): DomainEvent => ({
    type: 'NIGHT_RESOLVED',
    round,
    eliminatedPlayerId,
    revealedRole,
  }),
  dayStarted: (round: number): DomainEvent => ({ type: 'DAY_STARTED', round }),
  discussionStarted: (round: number): DomainEvent => ({ type: 'DISCUSSION_STARTED', round }),
  voteStarted: (round: number): DomainEvent => ({ type: 'VOTE_STARTED', round }),
  voteCast: (voterId: string, targetId: string | null): DomainEvent => ({ type: 'VOTE_CAST', voterId, targetId }),
  voteResolved: (eliminatedPlayerId: string | null, revealedRole: MafiaRole | null, wasTie: boolean): DomainEvent => ({
    type: 'VOTE_RESOLVED',
    eliminatedPlayerId,
    revealedRole,
    wasTie,
  }),
  playerLeft: (playerId: string, revealedRole: MafiaRole): DomainEvent => ({
    type: 'PLAYER_LEFT',
    playerId,
    revealedRole,
  }),
  gameWon: (winner: MafiaWinner, state: Pick<MafiaState, 'players'>): DomainEvent => ({
    type: winner === 'MAFIA' ? 'MAFIA_WON' : 'CITIZENS_WON',
    finalRoles: Object.fromEntries(state.players.map((p) => [p.id, p.role])),
  }),
};

/**
 * Names of the private night events (documentation + leak tests). These
 * are never constructed as DomainEvents and never appear in `events`.
 */
export const PRIVATE_EVENT_TYPES = [
  'MAFIA_TARGET_SELECTED',
  'DOCTOR_PROTECTION_SELECTED',
  'DETECTIVE_INVESTIGATION_COMPLETED',
] as const;
