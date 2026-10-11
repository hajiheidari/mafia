import { randomUUID } from 'node:crypto';
import { pool } from '../pool';

export interface UserRecord {
  id: string;
  isGuest: boolean;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface AuthMethodRecord {
  id: string;
  userId: string;
  provider: 'GUEST' | 'PHONE' | 'EMAIL' | 'GOOGLE' | 'APPLE';
  providerId: string;
}

function randomGuestName(): string {
  const adjectives = ['شاد', 'باحال', 'سریع', 'خوش‌شانس', 'مرموز', 'باهوش'];
  const animals = ['روباه', 'ببر', 'پلنگ', 'عقاب', 'گرگ', 'شیر'];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const b = animals[Math.floor(Math.random() * animals.length)];
  return `${a} ${b}`;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, "isGuest", username, "displayName", "avatarUrl", "createdAt" FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findAuthMethod(
  provider: string,
  providerId: string,
): Promise<AuthMethodRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, "userId", provider, "providerId" FROM auth_methods WHERE provider = $1 AND "providerId" = $2`,
    [provider, providerId],
  );
  return rows[0] ?? null;
}

/**
 * Creates a brand-new guest User + its GUEST AuthMethod row in one
 * transaction. `providerId` is the opaque guest-session id (see
 * ARCHITECTURE.md §1) — never a secret, just a stable pointer.
 */
export async function createGuestUser(providerId: string): Promise<UserRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = randomUUID();
    const displayName = randomGuestName();
    const { rows } = await client.query(
      `INSERT INTO users (id, "isGuest", "displayName", "updatedAt")
       VALUES ($1, true, $2, now())
       RETURNING id, "isGuest", username, "displayName", "avatarUrl", "createdAt"`,
      [userId, displayName],
    );
    await client.query(
      `INSERT INTO auth_methods (id, "userId", provider, "providerId")
       VALUES ($1, $2, 'GUEST', $3)`,
      [randomUUID(), userId, providerId],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
