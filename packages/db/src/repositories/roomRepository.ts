import { randomUUID } from 'node:crypto';
import { pool } from '../pool';

const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — avoids ambiguity when read aloud/typed
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 10;

export type RoomStatus = 'WAITING' | 'STARTING' | 'IN_GAME' | 'PAUSED' | 'FINISHED' | 'CLOSED';
export type RoomVisibility = 'PRIVATE' | 'PUBLIC';
export type RoomRole = 'HOST' | 'PLAYER' | 'SPECTATOR' | 'NARRATOR' | 'MODERATOR' | 'ADMIN';

export interface RoomRow {
  id: string;
  code: string;
  hostUserId: string;
  gameId: string | null;
  status: RoomStatus;
  visibility: RoomVisibility;
  maxPlayers: number;
  createdAt: Date;
}

export interface RoomMemberRow {
  id: string;
  roomId: string;
  userId: string;
  role: RoomRole;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: Date;
  leftAt: Date | null;
  displayName: string;
  avatarUrl: string | null;
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return code;
}

export class RoomCodeCollisionError extends Error {
  constructor() {
    super('Could not generate a unique room code after several attempts');
    this.name = 'RoomCodeCollisionError';
  }
}

export class RoomNotFoundError extends Error {
  constructor() {
    super('Room not found');
    this.name = 'RoomNotFoundError';
  }
}

export class RoomFullError extends Error {
  constructor() {
    super('Room is at capacity');
    this.name = 'RoomFullError';
  }
}

export class RoomClosedError extends Error {
  constructor() {
    super('Room no longer exists or is closed');
    this.name = 'RoomClosedError';
  }
}

/** Creates a room + its HOST membership row in one transaction. */
export async function createRoom(params: {
  hostUserId: string;
  gameId?: string | null;
  maxPlayers?: number;
  visibility?: RoomVisibility;
}): Promise<{ room: RoomRow; members: RoomMemberRow[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let code: string | undefined;
    let roomId = randomUUID();
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateCode();
      const { rows } = await client.query('SELECT 1 FROM rooms WHERE code = $1', [candidate]);
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new RoomCodeCollisionError();

    const { rows: roomRows } = await client.query(
      `INSERT INTO rooms (id, code, "hostUserId", "gameId", "maxPlayers", visibility, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING id, code, "hostUserId", "gameId", status, visibility, "maxPlayers", "createdAt"`,
      [
        roomId,
        code,
        params.hostUserId,
        params.gameId ?? null,
        params.maxPlayers ?? 10,
        params.visibility ?? 'PRIVATE',
      ],
    );
    const room: RoomRow = roomRows[0];

    await client.query(
      `INSERT INTO room_members (id, "roomId", "userId", role) VALUES ($1, $2, $3, 'HOST')`,
      [randomUUID(), room.id, params.hostUserId],
    );

    await client.query('COMMIT');
    const members = await getRoomMembers(room.id);
    return { room, members };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findRoomByCode(code: string): Promise<RoomRow | null> {
  const { rows } = await pool.query(
    `SELECT id, code, "hostUserId", "gameId", status, visibility, "maxPlayers", "createdAt"
     FROM rooms WHERE code = $1`,
    [code.toUpperCase()],
  );
  return rows[0] ?? null;
}

export async function findRoomById(roomId: string): Promise<RoomRow | null> {
  const { rows } = await pool.query(
    `SELECT id, code, "hostUserId", "gameId", status, visibility, "maxPlayers", "createdAt"
     FROM rooms WHERE id = $1`,
    [roomId],
  );
  return rows[0] ?? null;
}

export async function getRoomMembers(roomId: string): Promise<RoomMemberRow[]> {
  const { rows } = await pool.query(
    `SELECT rm.id, rm."roomId", rm."userId", rm.role, rm."isReady", rm."isConnected",
            rm."joinedAt", rm."leftAt", u."displayName", u."avatarUrl"
     FROM room_members rm
     JOIN users u ON u.id = rm."userId"
     WHERE rm."roomId" = $1 AND rm."leftAt" IS NULL
     ORDER BY rm."joinedAt" ASC`,
    [roomId],
  );
  return rows;
}

/**
 * Joins a user to a room by code. Enforces capacity and room status.
 * Idempotent: if the user is already an active member, returns the current
 * state rather than erroring (handles double-submits / reconnect-as-join).
 */
export async function joinRoomByCode(
  code: string,
  userId: string,
): Promise<{ room: RoomRow; members: RoomMemberRow[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: roomRows } = await client.query(
      `SELECT id, code, "hostUserId", "gameId", status, visibility, "maxPlayers", "createdAt"
       FROM rooms WHERE code = $1 FOR UPDATE`,
      [code.toUpperCase()],
    );
    const room: RoomRow | undefined = roomRows[0];
    if (!room) throw new RoomNotFoundError();
    if (room.status === 'CLOSED') throw new RoomClosedError();

    const { rows: existing } = await client.query(
      `SELECT id, "leftAt" FROM room_members WHERE "roomId" = $1 AND "userId" = $2`,
      [room.id, userId],
    );
    const existingRow: { id: string; leftAt: Date | null } | undefined = existing[0];

    if (!existingRow) {
      // Brand-new member: never been in this room before.
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM room_members WHERE "roomId" = $1 AND "leftAt" IS NULL AND role IN ('HOST','PLAYER')`,
        [room.id],
      );
      if (countRows[0].n >= room.maxPlayers) throw new RoomFullError();

      await client.query(
        `INSERT INTO room_members (id, "roomId", "userId", role) VALUES ($1, $2, $3, 'PLAYER')`,
        [randomUUID(), room.id, userId],
      );
    } else if (existingRow.leftAt !== null) {
      // Rejoining after a previous leave. The table has a UNIQUE(roomId,
      // userId) constraint (not scoped to active rows), so a second INSERT
      // for this pair would violate it — reactivate the existing row
      // instead. bumping "joinedAt" to now() so host-transfer ordering
      // (longest-standing CONNECTED player) reflects this as a fresh join,
      // not their original one from possibly much earlier.
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM room_members WHERE "roomId" = $1 AND "leftAt" IS NULL AND role IN ('HOST','PLAYER')`,
        [room.id],
      );
      if (countRows[0].n >= room.maxPlayers) throw new RoomFullError();

      await client.query(
        `UPDATE room_members
         SET "leftAt" = NULL, "isConnected" = true, "isReady" = false, role = 'PLAYER', "joinedAt" = now()
         WHERE id = $1`,
        [existingRow.id],
      );
    }
    // else: existingRow.leftAt === null -> already an active member, no-op (idempotent).

    await client.query('COMMIT');
    const members = await getRoomMembers(room.id);
    return { room, members };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Marks a member as left (soft delete — keeps history for GameEvent/analytics). */
export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE room_members SET "leftAt" = now(), "isConnected" = false
     WHERE "roomId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [roomId, userId],
  );
}

/** Host-only action, permission-checked by the caller before this runs. */
export async function removeMember(roomId: string, targetUserId: string): Promise<void> {
  await leaveRoom(roomId, targetUserId);
}

export async function setMemberReady(
  roomId: string,
  userId: string,
  isReady: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE room_members SET "isReady" = $3 WHERE "roomId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [roomId, userId, isReady],
  );
}

export async function setRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
  await pool.query(`UPDATE rooms SET status = $2, "updatedAt" = now() WHERE id = $1`, [
    roomId,
    status,
  ]);
}

export async function findMemberRole(roomId: string, userId: string): Promise<RoomRole | null> {
  const { rows } = await pool.query(
    `SELECT role FROM room_members WHERE "roomId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [roomId, userId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Finds the room a user currently has an ACTIVE (not-left) membership in,
 * if any, excluding rooms that have been closed. Used for automatic
 * reconnection: a socket reconnecting for an authenticated user should be
 * restored to this room without the client needing to call ROOM_JOIN
 * again. Never creates anything — pure lookup. See Milestone 5 follow-up §1/§3.
 *
 * Phase 1 assumes a user is active in at most one room at a time, so the
 * most recently joined active membership wins if more than one somehow
 * exists.
 */
export async function findActiveMembershipForUser(
  userId: string,
): Promise<{ roomId: string } | null> {
  const { rows } = await pool.query(
    `SELECT rm."roomId"
     FROM room_members rm
     JOIN rooms r ON r.id = rm."roomId"
     WHERE rm."userId" = $1 AND rm."leftAt" IS NULL AND r.status != 'CLOSED'
     ORDER BY rm."joinedAt" DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ? { roomId: rows[0].roomId } : null;
}

export async function setMemberConnected(
  roomId: string,
  userId: string,
  isConnected: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE room_members SET "isConnected" = $3
     WHERE "roomId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [roomId, userId, isConnected],
  );
}

/**
 * Deterministic host-transfer policy (see ARCHITECTURE.md Milestone 5 §6):
 * transfer HOST to the longest-standing CONNECTED PLAYER (earliest
 * joinedAt among active, connected, role=PLAYER members). If no such
 * candidate exists, the room is left without a host — the caller decides
 * what to do (Phase 1: close the room).
 */
export async function transferHostToLongestStandingPlayer(
  roomId: string,
): Promise<RoomMemberRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT rm.id, rm."roomId", rm."userId", rm.role, rm."isReady", rm."isConnected",
              rm."joinedAt", rm."leftAt", u."displayName", u."avatarUrl"
       FROM room_members rm
       JOIN users u ON u.id = rm."userId"
       WHERE rm."roomId" = $1 AND rm."leftAt" IS NULL AND rm."isConnected" = true AND rm.role = 'PLAYER'
       ORDER BY rm."joinedAt" ASC
       LIMIT 1
       FOR UPDATE OF rm`,
      [roomId],
    );
    const candidate: RoomMemberRow | undefined = rows[0];
    if (!candidate) {
      await client.query('COMMIT');
      return null;
    }

    await client.query(`UPDATE room_members SET role = 'PLAYER' WHERE "roomId" = $1 AND role = 'HOST'`, [
      roomId,
    ]);
    await client.query(`UPDATE room_members SET role = 'HOST' WHERE id = $1`, [candidate.id]);
    await client.query(`UPDATE rooms SET "hostUserId" = $2, "updatedAt" = now() WHERE id = $1`, [
      roomId,
      candidate.userId,
    ]);

    await client.query('COMMIT');
    return { ...candidate, role: 'HOST' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Count of remaining active (not-left) members, used to decide whether a room should close. */
export async function countActiveMembers(roomId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM room_members WHERE "roomId" = $1 AND "leftAt" IS NULL`,
    [roomId],
  );
  return rows[0].n;
}

