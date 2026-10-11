import {
  createRoom,
  findRoomByCode,
  findRoomById,
  getRoomMembers,
  joinRoomByCode,
  leaveRoom,
  removeMember,
  setMemberReady,
  setMemberConnected,
  findMemberRole,
  transferHostToLongestStandingPlayer,
  countActiveMembers,
  setRoomStatus,
  type RoomRow,
  type RoomMemberRow,
} from '@platform/db';
import { hasRoomPermission, type RoomDTO, type RoomMemberDTO } from '@platform/types';
import type { RoomVersionStore } from './roomVersionStore';

export class PermissionDeniedError extends Error {
  constructor(action: string) {
    super(`Not permitted: ${action}`);
    this.name = 'PermissionDeniedError';
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super('User is not an active member of this room');
    this.name = 'NotAMemberError';
  }
}

function toMemberDTO(m: RoomMemberRow): RoomMemberDTO {
  return {
    id: m.id,
    userId: m.userId,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    role: m.role,
    isReady: m.isReady,
    isConnected: m.isConnected,
    joinedAt: m.joinedAt.toISOString(),
  };
}

function toRoomDTO(room: RoomRow, members: RoomMemberRow[], roomVersion: number): RoomDTO {
  return {
    id: room.id,
    code: room.code,
    hostUserId: room.hostUserId,
    gameId: room.gameId,
    status: room.status,
    visibility: room.visibility,
    maxPlayers: room.maxPlayers,
    createdAt: room.createdAt.toISOString(),
    members: members.map(toMemberDTO),
    roomVersion,
  };
}

export interface LeaveResult {
  room: RoomDTO | null; // null if the room was closed (no members/no host candidate left)
  hostTransferredTo: string | null; // userId of the new host, if a transfer happened
  roomClosed: boolean;
}

/**
 * Thin, permission-checked orchestration between the transport layer
 * (Fastify routes / Socket.IO handlers) and the room repository. Every
 * mutating action re-derives the caller's role from the DB (never trusts a
 * client-supplied role) and checks it against ROOM_ROLE_PERMISSIONS from
 * @platform/types before doing anything — see ARCHITECTURE.md §4/§7.
 */
export class RoomService {
  constructor(private roomVersionStore: RoomVersionStore) {}

  private async snapshot(roomId: string): Promise<RoomDTO | null> {
    const room = await findRoomById(roomId);
    if (!room) return null;
    const members = await getRoomMembers(room.id);
    const version = await this.roomVersionStore.get(roomId);
    return toRoomDTO(room, members, version);
  }

  async createRoom(hostUserId: string, opts?: { gameId?: string; maxPlayers?: number }) {
    const { room } = await createRoom({
      hostUserId,
      gameId: opts?.gameId,
      maxPlayers: opts?.maxPlayers,
    });
    await this.roomVersionStore.bump(room.id);
    return (await this.snapshot(room.id))!;
  }

  async getRoomByCode(code: string): Promise<RoomDTO | null> {
    const room = await findRoomByCode(code);
    if (!room) return null;
    return this.snapshot(room.id);
  }

  async getRoomById(roomId: string): Promise<RoomDTO | null> {
    return this.snapshot(roomId);
  }

  async joinByCode(code: string, userId: string): Promise<RoomDTO> {
    const { room } = await joinRoomByCode(code, userId);
    await this.roomVersionStore.bump(room.id);
    return (await this.snapshot(room.id))!;
  }

  /**
   * Marks presence connected/disconnected and bumps roomVersion so other
   * members' clients know to re-fetch. Does NOT remove membership — see
   * `leave()` for that.
   */
  async setConnected(roomId: string, userId: string, isConnected: boolean): Promise<RoomDTO | null> {
    await setMemberConnected(roomId, userId, isConnected);
    await this.roomVersionStore.bump(roomId);
    return this.snapshot(roomId);
  }

  /**
   * Explicit leave OR a disconnect-grace-period expiry. Handles the
   * deterministic host-transfer policy: if the leaving member was HOST,
   * transfer to the longest-standing CONNECTED PLAYER; if none exists,
   * close the room (see ARCHITECTURE.md Milestone 5 §6).
   */
  async leave(roomId: string, userId: string): Promise<LeaveResult> {
    const wasHost = (await findMemberRole(roomId, userId)) === 'HOST';
    await leaveRoom(roomId, userId);

    let hostTransferredTo: string | null = null;
    if (wasHost) {
      const newHost = await transferHostToLongestStandingPlayer(roomId);
      if (newHost) {
        hostTransferredTo = newHost.userId;
      } else {
        const remaining = await countActiveMembers(roomId);
        if (remaining === 0) {
          await setRoomStatus(roomId, 'CLOSED');
          await this.roomVersionStore.bump(roomId);
          return { room: null, hostTransferredTo: null, roomClosed: true };
        }
        // Members remain but none are eligible PLAYERs (e.g. all spectators) —
        // documented edge case: room keeps its old (now-departed) hostUserId
        // until someone becomes eligible. Rare in Phase 1 (HOST/PLAYER only).
      }
    }

    await this.roomVersionStore.bump(roomId);
    const room = await this.snapshot(roomId);
    return { room, hostTransferredTo, roomClosed: false };
  }

  async toggleReady(roomId: string, userId: string, isReady: boolean): Promise<RoomDTO> {
    const role = await findMemberRole(roomId, userId);
    if (!role) throw new NotAMemberError();
    if (!hasRoomPermission(role, 'TOGGLE_READY')) throw new PermissionDeniedError('TOGGLE_READY');
    await setMemberReady(roomId, userId, isReady);
    await this.roomVersionStore.bump(roomId);
    return (await this.snapshot(roomId))!;
  }

  /** Host removes another player. Re-checks the ACTOR's role server-side. */
  async removePlayer(roomId: string, actorUserId: string, targetUserId: string): Promise<LeaveResult> {
    const actorRole = await findMemberRole(roomId, actorUserId);
    if (!actorRole) throw new NotAMemberError();
    if (!hasRoomPermission(actorRole, 'REMOVE_PLAYER')) {
      throw new PermissionDeniedError('REMOVE_PLAYER');
    }
    return this.leave(roomId, targetUserId);
  }

  async getMemberRole(roomId: string, userId: string) {
    return findMemberRole(roomId, userId);
  }
}
