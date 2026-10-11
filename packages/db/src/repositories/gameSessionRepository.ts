import { randomUUID } from 'node:crypto';
import { pool } from '../pool';

export interface GameSessionRow {
  id: string;
  roomId: string;
  gameId: string;
  stateVersion: number;
  phase: string | null;
  state: unknown;
  startedAt: Date;
  endedAt: Date | null;
}

export async function createGameSession(
  roomId: string,
  gameId: string,
  initialState: unknown,
): Promise<GameSessionRow> {
  const { rows } = await pool.query(
    `INSERT INTO game_sessions (id, "roomId", "gameId", "stateVersion", state)
     VALUES ($1, $2, $3, 0, $4)
     RETURNING id, "roomId", "gameId", "stateVersion", phase, state, "startedAt", "endedAt"`,
    [randomUUID(), roomId, gameId, JSON.stringify(initialState)],
  );
  return rows[0];
}

/** The most recent NOT-yet-ended session for a room, if any. */
export async function getActiveSession(roomId: string): Promise<GameSessionRow | null> {
  const { rows } = await pool.query(
    `SELECT id, "roomId", "gameId", "stateVersion", phase, state, "startedAt", "endedAt"
     FROM game_sessions WHERE "roomId" = $1 AND "endedAt" IS NULL
     ORDER BY "startedAt" DESC LIMIT 1`,
    [roomId],
  );
  return rows[0] ?? null;
}

export async function getSessionById(sessionId: string): Promise<GameSessionRow | null> {
  const { rows } = await pool.query(
    `SELECT id, "roomId", "gameId", "stateVersion", phase, state, "startedAt", "endedAt"
     FROM game_sessions WHERE id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function updateSessionState(
  sessionId: string,
  stateVersion: number,
  state: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE game_sessions SET "stateVersion" = $2, state = $3 WHERE id = $1`,
    [sessionId, stateVersion, JSON.stringify(state)],
  );
}

export async function endSession(sessionId: string): Promise<void> {
  await pool.query(`UPDATE game_sessions SET "endedAt" = now() WHERE id = $1`, [sessionId]);
}

export async function insertGameEvents(
  sessionId: string,
  events: { type: string; playerId?: string | null; payload?: unknown }[],
): Promise<void> {
  if (events.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const event of events) {
      await client.query(
        `INSERT INTO game_events (id, "sessionId", "playerId", type, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), sessionId, event.playerId ?? null, event.type, JSON.stringify(event.payload ?? {})],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
