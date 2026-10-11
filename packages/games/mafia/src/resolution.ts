import type { DomainEvent } from '@platform/types';
import type { EliminationCause, MafiaPlayerState, MafiaState } from './types';
import { PublicEvents } from './events';

/** Mutates s: marks a player eliminated and reveals their role in the public history. */
export function eliminate(s: MafiaState, player: MafiaPlayerState, cause: EliminationCause): void {
  player.alive = false;
  player.eliminationCause = cause;
  player.eliminationRound = s.round;
  s.eliminationHistory.push({ round: s.round, playerId: player.id, cause, revealedRole: player.role });
}

function alivePlayer(s: MafiaState, id: string | null) {
  if (!id) return undefined;
  const p = s.players.find((x) => x.id === id);
  return p && p.alive ? p : undefined;
}

/** Alive mafia member with the lowest joinOrder — breaks mafia vote ties. */
export function mafiaLeaderId(s: MafiaState): string | null {
  const leader = s.players
    .filter((p) => p.alive && p.role === 'MAFIA')
    .sort((a, b) => a.joinOrder - b.joinOrder)[0];
  return leader?.id ?? null;
}

/**
 * Final mafia target: most-voted among ALIVE mafia's last votes (only
 * still-valid targets: alive, non-mafia). Tie → the leader's vote; leader
 * didn't vote → nobody dies. No votes → nobody dies.
 */
export function resolveMafiaTarget(s: MafiaState): string | null {
  const counts = new Map<string, number>();
  for (const [mafiaId, targetId] of Object.entries(s.currentNightActions.mafiaVotes)) {
    const voter = alivePlayer(s, mafiaId);
    const target = alivePlayer(s, targetId);
    if (!voter || voter.role !== 'MAFIA' || !target || target.role === 'MAFIA') continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id);
  if (top.length === 1) return top[0]!;

  const leaderId = mafiaLeaderId(s);
  const leaderVote = leaderId ? s.currentNightActions.mafiaVotes[leaderId] : undefined;
  if (!leaderVote) return null;
  const leaderTarget = alivePlayer(s, leaderVote);
  return leaderTarget && leaderTarget.role !== 'MAFIA' ? leaderVote : null;
}

/**
 * Pure night resolution, in order: mafia target → doctor → detective
 * (already recorded privately when it was submitted) → kill unless saved.
 * Mutates the given working copy; the caller handles the win check.
 */
export function resolveNight(s: MafiaState, events: DomainEvent[]): void {
  const mafiaTarget = resolveMafiaTarget(s);

  const doctor = s.players.find((p) => p.alive && p.role === 'DOCTOR');
  const doctorTarget = doctor ? alivePlayer(s, s.currentNightActions.doctorTarget)?.id ?? null : null;

  // Remember tonight's protection (or lack of it) for the no-repeat rule.
  for (const p of s.players) {
    if (p.role !== 'DOCTOR') continue;
    if (p.id === doctor?.id && doctorTarget) s.lastDoctorTargetByDoctorId[p.id] = doctorTarget;
    else delete s.lastDoctorTargetByDoctorId[p.id];
  }

  let eliminatedId: string | null = null;
  if (mafiaTarget && mafiaTarget !== doctorTarget) {
    const victim = alivePlayer(s, mafiaTarget);
    if (victim) {
      eliminate(s, victim, 'MAFIA');
      eliminatedId = victim.id;
    }
  }

  const revealed = eliminatedId ? s.players.find((p) => p.id === eliminatedId)!.role : null;
  s.lastNightOutcome = { round: s.round, eliminatedPlayerId: eliminatedId, revealedRole: revealed };
  events.push(PublicEvents.nightResolved(s.round, eliminatedId, revealed));
}

/** Public tally of the current (last-per-voter) votes of alive voters for alive targets. */
export function tallyVotes(s: MafiaState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [voterId, targetId] of Object.entries(s.currentVotes.votes)) {
    if (!targetId || !alivePlayer(s, voterId) || !alivePlayer(s, targetId)) continue;
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  return counts;
}

/** Most votes is eliminated; a tie (or no votes) eliminates nobody. */
export function resolveVote(s: MafiaState, events: DomainEvent[]): void {
  const counts = tallyVotes(s);
  let eliminatedId: string | null = null;
  let wasTie = false;
  if (counts.size > 0) {
    const max = Math.max(...counts.values());
    const top = [...counts.entries()].filter(([, n]) => n === max);
    if (top.length === 1) eliminatedId = top[0]![0];
    else wasTie = true;
  }

  let revealed = null;
  if (eliminatedId) {
    const victim = alivePlayer(s, eliminatedId)!;
    eliminate(s, victim, 'VOTE');
    revealed = victim.role;
  }
  s.lastVoteOutcome = { round: s.round, eliminatedPlayerId: eliminatedId, revealedRole: revealed, wasTie };
  events.push(PublicEvents.voteResolved(eliminatedId, revealed, wasTie));
}
