import type { ActionResult, DomainEvent } from '@platform/types';
import type { MafiaRuntime, MafiaState } from './types';
import { parseAction } from './validation';
import { PublicEvents } from './events';

/** Every alive player has acknowledged their role. */
export function allRolesAcked(s: MafiaState): boolean {
  return s.players.every((p) => !p.alive || p.roleReadyAcked);
}

/** Every alive night role has submitted its action for this night. */
export function allNightActionsIn(s: MafiaState): boolean {
  const a = s.currentNightActions;
  for (const p of s.players) {
    if (!p.alive) continue;
    if (p.role === 'MAFIA' && !a.mafiaVotes[p.id]) return false;
    if (p.role === 'DOCTOR' && !a.doctorTarget) return false;
    if (p.role === 'DETECTIVE' && !a.detectiveTarget) return false;
  }
  return true;
}

/** Early completion: pull the phase deadline to "now"; the scheduler advances it. */
function endPhaseNow(s: MafiaState, rt: MafiaRuntime): void {
  const now = rt.now();
  if (s.phaseEndsAt === null || s.phaseEndsAt > now) s.phaseEndsAt = now;
}

/**
 * Applies an ALREADY-VALIDATED action. Night choices produce no events —
 * they are private and only visible through the actor's own player view.
 */
export function applyMafiaAction(
  state: MafiaState,
  playerId: string,
  raw: unknown,
  rt: MafiaRuntime,
): ActionResult<MafiaState> {
  const action = parseAction(raw);
  if (!action) return { nextState: state, events: [] };
  const s = structuredClone(state);
  const events: DomainEvent[] = [];

  switch (action.type) {
    case 'ROLE_READY': {
      const me = s.players.find((p) => p.id === playerId)!;
      me.roleReadyAcked = true;
      events.push(PublicEvents.playerRoleAcked(playerId));
      if (allRolesAcked(s)) endPhaseNow(s, rt);
      break;
    }
    case 'MAFIA_SELECT_TARGET':
      s.currentNightActions.mafiaVotes[playerId] = action.targetUserId;
      break;
    case 'DOCTOR_PROTECT':
      s.currentNightActions.doctorTarget = action.targetUserId;
      break;
    case 'DETECTIVE_INVESTIGATE': {
      const target = s.players.find((p) => p.id === action.targetUserId)!;
      s.currentNightActions.detectiveTarget = target.id;
      s.investigations.push({
        round: s.round,
        detectiveId: playerId,
        targetId: target.id,
        isMafia: target.role === 'MAFIA',
      });
      break;
    }
    case 'PLAYER_VOTE':
      s.currentVotes.votes[playerId] = action.targetUserId;
      events.push(PublicEvents.voteCast(playerId, action.targetUserId));
      break;
  }

  if (s.phase === 'NIGHT' && allNightActionsIn(s)) endPhaseNow(s, rt);
  return { nextState: s, events };
}
