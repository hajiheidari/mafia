import {
  getSessionById,
  casApplyPhaseTransition,
  insertGameEvents,
  getAllActiveSessions,
  endSession,
  type GameSessionRow,
} from '@platform/db';
import type { PhaseSchedulerStorage, SchedulableSession } from '@platform/game-engine';
import type { DomainEvent } from '@platform/types';

function toSchedulable(row: GameSessionRow): SchedulableSession {
  return {
    sessionId: row.id,
    roomId: row.roomId,
    gameId: row.gameId,
    stateVersion: row.stateVersion,
    state: row.state,
  };
}

/** Same shape the action path uses when persisting events. */
export function toGameEventRows(events: DomainEvent[]) {
  return events.map((e) => ({
    type: e.type,
    playerId: 'playerId' in e && typeof e.playerId === 'string' ? e.playerId : null,
    payload: e,
  }));
}

/** Postgres-backed storage for the generic PhaseScheduler. */
export function createDbPhaseSchedulerStorage(): PhaseSchedulerStorage {
  return {
    async loadSession(sessionId) {
      const row = await getSessionById(sessionId);
      if (!row || row.endedAt) return null;
      return toSchedulable(row);
    },
    casApplyTransition: (params) => casApplyPhaseTransition(params),
    async persistEvents(sessionId, events) {
      await insertGameEvents(sessionId, toGameEventRows(events));
    },
    async listActiveSessions() {
      const rows = await getAllActiveSessions();
      return rows.map(toSchedulable);
    },
    endSession: (sessionId) => endSession(sessionId),
  };
}
