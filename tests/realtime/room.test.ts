import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestServer,
  loginAsNewGuest,
  createRoom,
  connectSocket,
  waitForEvent,
  waitForConnect,
  sleep,
  type TestContext,
} from './testServer';
import type { RoomDTO } from '@platform/types';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootTestServer();
});

afterAll(async () => {
  await ctx.close();
});

describe('socket authentication', () => {
  test('a connection without a token is rejected', async () => {
    const { io: ioClient } = await import('socket.io-client');
    const socket = ioClient(ctx.baseUrl, { transports: ['websocket'], forceNew: true });
    await expect(
      new Promise((resolve, reject) => {
        socket.once('connect', () => reject(new Error('should not have connected')));
        socket.once('connect_error', (err) => resolve(err));
        setTimeout(() => reject(new Error('timed out')), 3000);
      }),
    ).resolves.toBeTruthy();
    socket.close();
  });

  test('a connection with a valid access token is accepted', async () => {
    const session = await loginAsNewGuest(ctx.baseUrl);
    const socket = connectSocket(ctx.baseUrl, session);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    socket.close();
  });
});

describe('room join / presence', () => {
  test('joining sends ROOM_STATE to the joiner and PLAYER_JOINED to existing members', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4 });

    const hostSocket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(hostSocket);
    hostSocket.emit('ROOM_JOIN', { code: room.code });
    const hostState = await waitForEvent<RoomDTO>(hostSocket, 'ROOM_STATE');
    expect(hostState.members).toHaveLength(1);
    expect(hostState.members[0]!.role).toBe('HOST');

    const guest = await loginAsNewGuest(ctx.baseUrl);
    const guestSocket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(guestSocket);

    const hostSeesJoin = waitForEvent<{ userId: string; room: RoomDTO }>(hostSocket, 'PLAYER_JOINED');
    guestSocket.emit('ROOM_JOIN', { code: room.code });
    const guestState = await waitForEvent<RoomDTO>(guestSocket, 'ROOM_STATE');
    expect(guestState.members).toHaveLength(2);

    const joinedPayload = await hostSeesJoin;
    expect(joinedPayload.userId).toBe(guest.userId);
    expect(joinedPayload.room.members).toHaveLength(2);

    hostSocket.close();
    guestSocket.close();
  });

  test('a room at capacity rejects a third joiner with ROOM_FULL', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 2 });

    const hostSocket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(hostSocket);
    hostSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(hostSocket, 'ROOM_STATE');

    const guest1 = await loginAsNewGuest(ctx.baseUrl);
    const guest1Socket = connectSocket(ctx.baseUrl, guest1);
    await waitForConnect(guest1Socket);
    guest1Socket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(guest1Socket, 'ROOM_STATE');

    const guest2 = await loginAsNewGuest(ctx.baseUrl);
    const guest2Socket = connectSocket(ctx.baseUrl, guest2);
    await waitForConnect(guest2Socket);
    guest2Socket.emit('ROOM_JOIN', { code: room.code });
    const error = await waitForEvent<{ code: string }>(guest2Socket, 'ERROR');
    expect(error.code).toBe('ROOM_FULL');

    hostSocket.close();
    guest1Socket.close();
    guest2Socket.close();
  });

  test('an unknown room code yields ROOM_NOT_FOUND, not a crash', async () => {
    const guest = await loginAsNewGuest(ctx.baseUrl);
    const socket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(socket);
    socket.emit('ROOM_JOIN', { code: 'ZZZZZZ' });
    const error = await waitForEvent<{ code: string }>(socket, 'ERROR');
    expect(error.code).toBe('ROOM_NOT_FOUND');
    socket.close();
  });
});

describe('explicit leave', () => {
  test('ROOM_LEAVE broadcasts PLAYER_LEFT and updates the member list immediately', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4 });
    const hostSocket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(hostSocket);
    hostSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(hostSocket, 'ROOM_STATE');

    const guest = await loginAsNewGuest(ctx.baseUrl);
    const guestSocket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(guestSocket);
    guestSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(guestSocket, 'ROOM_STATE');
    await waitForEvent(hostSocket, 'PLAYER_JOINED');

    const hostSeesLeft = waitForEvent<{ userId: string; room: RoomDTO }>(hostSocket, 'PLAYER_LEFT');
    guestSocket.emit('ROOM_LEAVE', { roomId: room.id });
    const payload = await hostSeesLeft;
    expect(payload.userId).toBe(guest.userId);
    expect(payload.room.members).toHaveLength(1);

    hostSocket.close();
    guestSocket.close();
  });
});

describe('host transfer', () => {
  test('when the host leaves, the longest-standing connected player becomes host', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4 });
    const hostSocket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(hostSocket);
    hostSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(hostSocket, 'ROOM_STATE');

    const guest = await loginAsNewGuest(ctx.baseUrl);
    const guestSocket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(guestSocket);
    guestSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(guestSocket, 'ROOM_STATE');
    await waitForEvent(hostSocket, 'PLAYER_JOINED');

    const guestSeesTransfer = waitForEvent<{ room: RoomDTO }>(guestSocket, 'PLAYER_LEFT');
    hostSocket.emit('ROOM_LEAVE', { roomId: room.id });
    const payload = await guestSeesTransfer;

    const remaining = payload.room.members.find((m) => m.userId === guest.userId);
    expect(remaining?.role).toBe('HOST');
    expect(payload.room.hostUserId).toBe(guest.userId);

    hostSocket.close();
    guestSocket.close();
  });
});

describe('reconnection', () => {
  test('disconnecting marks the member disconnected, and reconnecting restores membership without duplicating it', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4 });
    const hostSocket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(hostSocket);
    hostSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(hostSocket, 'ROOM_STATE');

    const guest = await loginAsNewGuest(ctx.baseUrl);
    let guestSocket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(guestSocket);
    guestSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(guestSocket, 'ROOM_STATE');
    await waitForEvent(hostSocket, 'PLAYER_JOINED');

    // Simulate a dropped connection (not an explicit leave).
    const hostSeesDisconnectUpdate = waitForEvent<{ room: RoomDTO }>(hostSocket, 'PLAYER_UPDATED');
    guestSocket.close();
    const disconnectPayload = await hostSeesDisconnectUpdate;
    const disconnectedMember = disconnectPayload.room.members.find((m) => m.userId === guest.userId);
    expect(disconnectedMember?.isConnected).toBe(false);
    expect(disconnectPayload.room.members).toHaveLength(2); // still a member, not removed

    // Reconnect well within the grace period.
    guestSocket = connectSocket(ctx.baseUrl, guest);
    await waitForConnect(guestSocket);
    guestSocket.emit('ROOM_JOIN', { code: room.code });
    const restoredState = await waitForEvent<RoomDTO>(guestSocket, 'ROOM_STATE');

    expect(restoredState.members).toHaveLength(2); // no duplicate membership row
    const restoredMember = restoredState.members.find((m) => m.userId === guest.userId);
    expect(restoredMember?.isConnected).toBe(true);

    hostSocket.close();
    guestSocket.close();
  });
});
