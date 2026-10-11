import { apiJson, ApiError } from './api';
import type { RoomDTO } from '@platform/types';

export interface GameSummary {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}

export async function fetchGames(): Promise<GameSummary[]> {
  const body = await apiJson<{ games: GameSummary[] }>('/api/games');
  return body.games;
}

export async function createRoom(opts: { gameId: string; maxPlayers?: number }): Promise<RoomDTO> {
  const body = await apiJson<{ room: RoomDTO }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
  return body.room;
}

export async function fetchRoomByCode(code: string): Promise<RoomDTO> {
  const body = await apiJson<{ room: RoomDTO }>(`/api/rooms/by-code/${encodeURIComponent(code)}`);
  return body.room;
}

export async function startGame(roomId: string): Promise<void> {
  await apiJson(`/api/rooms/${roomId}/start`, { method: 'POST' });
}

export async function removePlayer(roomId: string, targetUserId: string): Promise<void> {
  await apiJson(`/api/rooms/${roomId}/remove-player`, {
    method: 'POST',
    body: JSON.stringify({ targetUserId }),
  });
}

// Never surface a raw exception/backend message to the user — every entry
// point into the room flow funnels errors through this. See Milestone 6 §17.
export function friendlyRoomError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ROOM_NOT_FOUND':
        return 'این اتاق پیدا نشد.';
      case 'ROOM_FULL':
        return 'ظرفیت اتاق تکمیل شده.';
      case 'ROOM_CLOSED':
      case 'INVALID_ROOM_STATE':
        return 'این اتاق دیگر فعال نیست.';
      case 'NOT_ALLOWED':
        return 'اجازه انجام این کار را ندارید.';
      case 'GAME_NOT_FOUND':
        return 'امکان شروع بازی وجود ندارد.';
      default:
        return 'خطایی پیش آمد. دوباره امتحان کن.';
    }
  }
  return 'خطایی پیش آمد. دوباره امتحان کن.';
}
