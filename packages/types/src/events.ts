import type { RoomDTO } from './room';
import type { DomainEvent } from './game';

// Strongly-typed Socket.IO event map. Import this on both apps/server and
// apps/web so client and server can never silently drift out of sync.
// See ARCHITECTURE.md Milestone 5 for the full realtime design.

export interface ChatMessageDTO {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  text: string;
  createdAt: string;
}

export type RealtimeErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_AUTHORIZED'
  | 'NOT_A_MEMBER'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_ROOM_STATE'
  | 'INVALID_ACTION'
  | 'STALE_STATE'
  | 'RATE_LIMITED'
  | 'GAME_NOT_STARTED'
  | 'GAME_NOT_FOUND';

export interface RealtimeErrorPayload {
  code: RealtimeErrorCode;
  message: string;
  /** Echoes the client's request id / actionId where applicable, so the client can match the error to its call. */
  requestId?: string;
}

export interface ConnectionStatusPayload {
  status: 'connected' | 'reconnected';
  userId: string;
}

// --- Server -> Client ----------------------------------------------------

export interface ServerToClientEvents {
  /** Authoritative room snapshot. Sent on join and whenever a full resync is needed. */
  ROOM_STATE: (room: RoomDTO) => void;
  PLAYER_JOINED: (payload: { roomId: string; userId: string; room: RoomDTO }) => void;
  PLAYER_LEFT: (payload: { roomId: string; userId: string; room: RoomDTO }) => void;
  /** Any partial member change: ready toggled, connection status changed, role changed (e.g. host transfer). */
  PLAYER_UPDATED: (payload: { roomId: string; userId: string; room: RoomDTO }) => void;
  CHAT_MESSAGE: (message: ChatMessageDTO) => void;
  CONNECTION_STATUS: (payload: ConnectionStatusPayload) => void;
  /** Tells the client its local roomVersion/stateVersion is stale and it must request/accept a fresh snapshot. */
  SYNC_REQUIRED: (payload: { roomId: string; reason: 'ROOM_VERSION' | 'GAME_STATE_VERSION' }) => void;
  GAME_STARTED: (payload: { roomId: string; gameId: string }) => void;
  /** Public domain events (no per-player secrets — see DomainEvent). */
  GAME_EVENT: (payload: { roomId: string; events: DomainEvent[] }) => void;
  /** Per-player filtered view — NEVER the full authoritative state. */
  GAME_STATE: (payload: { roomId: string; stateVersion: number; view: unknown }) => void;
  ERROR: (payload: RealtimeErrorPayload) => void;
}

// --- Client -> Server ------------------------------------------------------

export interface ClientToServerEvents {
  ROOM_JOIN: (payload: { code: string }) => void;
  ROOM_LEAVE: (payload: { roomId: string }) => void;
  PLAYER_READY: (payload: { roomId: string }) => void;
  PLAYER_UNREADY: (payload: { roomId: string }) => void;
  CHAT_SEND: (payload: { roomId: string; text: string }) => void;
  ROOM_SYNC_REQUEST: (payload: { roomId: string }) => void;
  GAME_ACTION: (payload: {
    roomId: string;
    actionId: string;
    clientStateVersion: number;
    action: unknown;
  }) => void;
}

// Socket.IO room naming convention — internal, never shown in the UI
// (the user-facing identifier is always the short room code).
export function socketRoomName(roomId: string): string {
  return `room:${roomId}`;
}
