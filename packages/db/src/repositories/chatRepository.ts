import { randomUUID } from 'node:crypto';
import { pool } from '../pool';

export interface ChatMessageRow {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  createdAt: Date;
  displayName: string;
}

export async function insertChatMessage(
  roomId: string,
  userId: string,
  text: string,
): Promise<ChatMessageRow> {
  const { rows } = await pool.query(
    `WITH inserted AS (
       INSERT INTO chat_messages (id, "roomId", "userId", text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, "roomId", "userId", text, "createdAt"
     )
     SELECT inserted.*, u."displayName"
     FROM inserted JOIN users u ON u.id = inserted."userId"`,
    [randomUUID(), roomId, userId, text],
  );
  return rows[0];
}
