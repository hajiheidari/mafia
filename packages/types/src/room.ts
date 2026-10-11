// Room + membership types shared between server and web.
// NOTE: Core platform types must never reference a specific game (e.g. Mafia).

export type RoomVisibility = 'PRIVATE' | 'PUBLIC';

export type RoomStatus =
  | 'WAITING'
  | 'STARTING'
  | 'IN_GAME'
  | 'PAUSED'
  | 'FINISHED'
  | 'CLOSED';

// Reserved for future roles (spectator/narrator/moderator). Only HOST and
// PLAYER are actually used/enforced in Phase 1 — see ARCHITECTURE.md §4.
export type RoomRole = 'HOST' | 'PLAYER' | 'SPECTATOR' | 'NARRATOR' | 'MODERATOR' | 'ADMIN';

export interface RoomMemberDTO {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: RoomRole;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: string;
}

export interface RoomDTO {
  id: string;
  code: string;
  hostUserId: string;
  gameId: string | null;
  status: RoomStatus;
  visibility: RoomVisibility;
  maxPlayers: number;
  createdAt: string;
  members: RoomMemberDTO[];
  /** Increments on every meaningful room mutation — lets clients detect a stale local copy. See ARCHITECTURE.md §10. */
  roomVersion: number;
}

// Permission matrix: role -> allowed actions. Deliberately data (not scattered
// if/else) so adding a role later (e.g. MODERATOR) is a table edit, not a
// code change through the room/lobby components.
export type RoomPermission =
  | 'START_GAME'
  | 'CHANGE_SETTINGS'
  | 'REMOVE_PLAYER'
  | 'CLOSE_ROOM'
  | 'SEND_CHAT'
  | 'TOGGLE_READY'
  | 'SEND_GAME_ACTION';

export const ROOM_ROLE_PERMISSIONS: Record<RoomRole, RoomPermission[]> = {
  HOST: [
    'START_GAME',
    'CHANGE_SETTINGS',
    'REMOVE_PLAYER',
    'CLOSE_ROOM',
    'SEND_CHAT',
    'TOGGLE_READY',
    'SEND_GAME_ACTION',
  ],
  PLAYER: ['SEND_CHAT', 'TOGGLE_READY', 'SEND_GAME_ACTION'],
  SPECTATOR: ['SEND_CHAT'],
  NARRATOR: ['SEND_CHAT', 'SEND_GAME_ACTION'],
  MODERATOR: ['SEND_CHAT', 'REMOVE_PLAYER'],
  ADMIN: [
    'START_GAME',
    'CHANGE_SETTINGS',
    'REMOVE_PLAYER',
    'CLOSE_ROOM',
    'SEND_CHAT',
    'TOGGLE_READY',
    'SEND_GAME_ACTION',
  ],
};

export function hasRoomPermission(role: RoomRole, permission: RoomPermission): boolean {
  return ROOM_ROLE_PERMISSIONS[role].includes(permission);
}
