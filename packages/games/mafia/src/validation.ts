import type { ValidationResult } from '@platform/types';
import type { MafiaAction, MafiaState } from './types';

const ok: ValidationResult = { valid: true };
const no = (reason: string): ValidationResult => ({ valid: false, reason });

const ACTION_TYPES = new Set(['ROLE_READY', 'MAFIA_SELECT_TARGET', 'DOCTOR_PROTECT', 'DETECTIVE_INVESTIGATE', 'PLAYER_VOTE']);

/** Narrows an untrusted payload. Extra fields (e.g. a forged phaseEndsAt) are ignored. */
export function parseAction(raw: unknown): MafiaAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) return null;
  switch (a.type) {
    case 'ROLE_READY':
      return { type: 'ROLE_READY' };
    case 'PLAYER_VOTE':
      if (a.targetUserId !== null && typeof a.targetUserId !== 'string') return null;
      return { type: 'PLAYER_VOTE', targetUserId: a.targetUserId };
    default:
      if (typeof a.targetUserId !== 'string') return null;
      return { type: a.type as 'MAFIA_SELECT_TARGET' | 'DOCTOR_PROTECT' | 'DETECTIVE_INVESTIGATE', targetUserId: a.targetUserId };
  }
}

/**
 * Server-side rules for every action. The actor's ROLE is always checked
 * before anything about the target, so a rejection can never be used as an
 * oracle about someone else's role (e.g. "target_is_mafia" is only
 * reachable by a mafia member, who already knows their teammates).
 */
export function validateMafiaAction(state: MafiaState, playerId: string, raw: unknown): ValidationResult {
  const action = parseAction(raw);
  if (!action) return no('unknown_action');
  if (state.phase === 'GAME_FINISHED') return no('game_finished');

  const actor = state.players.find((p) => p.id === playerId);
  if (!actor) return no('not_a_player');
  if (!actor.alive) return no('player_dead');

  const aliveTarget = (id: string | null) => (id ? state.players.find((p) => p.id === id && p.alive) : undefined);

  switch (action.type) {
    case 'ROLE_READY':
      if (state.phase !== 'ROLE_REVEAL') return no('wrong_phase');
      if (actor.roleReadyAcked) return no('already_ready');
      return ok;

    case 'MAFIA_SELECT_TARGET': {
      if (state.phase !== 'NIGHT') return no('wrong_phase');
      if (actor.role !== 'MAFIA') return no('wrong_role');
      const target = aliveTarget(action.targetUserId);
      if (!target) return no('invalid_target');
      if (target.id === actor.id) return no('cannot_target_self');
      if (target.role === 'MAFIA') return no('target_is_mafia');
      return ok;
    }

    case 'DOCTOR_PROTECT': {
      if (state.phase !== 'NIGHT') return no('wrong_phase');
      if (actor.role !== 'DOCTOR') return no('wrong_role');
      const target = aliveTarget(action.targetUserId);
      if (!target) return no('invalid_target');
      if (state.lastDoctorTargetByDoctorId[actor.id] === target.id) return no('same_target_consecutive_nights');
      return ok;
    }

    case 'DETECTIVE_INVESTIGATE': {
      if (state.phase !== 'NIGHT') return no('wrong_phase');
      if (actor.role !== 'DETECTIVE') return no('wrong_role');
      if (state.currentNightActions.detectiveTarget) return no('already_investigated');
      const target = aliveTarget(action.targetUserId);
      if (!target) return no('invalid_target');
      if (target.id === actor.id) return no('cannot_target_self');
      return ok;
    }

    case 'PLAYER_VOTE': {
      if (state.phase !== 'VOTING') return no('wrong_phase');
      if (action.targetUserId !== null && !aliveTarget(action.targetUserId)) return no('invalid_target');
      return ok;
    }
  }
}
