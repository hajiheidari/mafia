import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { getGameSessionService } from '@platform/server/src/services';
import type { RoomDTO, ConnectionStatusPayload } from '@platform/types';

let ctx: TestContext;

beforeAll(async () => {
  // A short grace period for this file only, so "wait past the grace
  // period" tests run in ~1s instead of 20s. Production/default behavior
  // (20s) is untouched — see DISCONNECT_GRACE_PERIOD_MS in
  // registerRealtimeHandlers.ts.
  process.env.DISCONNECT_GRACE_PERIOD_MS = '600';
  ctx = await bootTestServer();
});

afterAll(async () => {
  await ctx.close();
  delete process.env.DISCONNECT_GRACE_PERIOD_MS;
});

describe('basic automatic reconnection', () => {
  test('disconnecting and reconnecting the SAME socket restores room membership without an explicit ROOM_JOIN', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4 });

    const socket = connectSocket(ctx.baseUrl, host);
    await waitForConnect(socket);
    // First connection ever for this user -> 'connected', not 'reconnected'.
    const firstStatus = await waitForEvent<ConnectionStatusPayload>(socket, 'CONNECTION_STATUS');
    expect(firstStatus.status).toBe('connected');

    socket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent<RoomDTO>(socket, 'ROOM_STATE');

    // Simulate a dropped connection, then Socket.IO reconnecting the SAME
    // client instance — no ROOM_JOIN is emitted after this.
    const reconnectedStatus = waitForEvent<ConnectionStatusPayload>(socket, 'CONNECTION_STATUS');
    const restoredState = waitForEvent<RoomDTO>(socket, 'ROOM_STATE');
    socket.disconnect();
    await sleep(100);
    socket.connect();
    await waitForConnect(socket);

    const status = await reconnectedStatus;
    expect(status.status).toBe('reconnected'); // NOT 'connected' — an active membership already existed

    const state = await restoredState;
    expect(state.members).toHaveLength(1); // no duplicate membership row
    const member = state.members.find((m) => m.userId === host.userId);
    expect(member?.isConnected).toBe(true);

    socket.close();
  });

  test('another player sees PLAYER_UPDATED (not PLAYER_JOINED) when someone reconnects', async () => {
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

    const hostSeesDisconnect = waitForEvent<{ room: RoomDTO }>(hostSocket, 'PLAYER_UPDATED');
    guestSocket.disconnect();
    await hostSeesDisconnect;

    const hostSeesReconnectUpdate = waitForEvent<{ room: RoomDTO }>(hostSocket, 'PLAYER_UPDATED');
    await sleep(50);
    guestSocket.connect();
    await waitForConnect(guestSocket);
    const payload = await hostSeesReconnectUpdate; // specifically PLAYER_UPDATED, not PLAYER_JOINED
    const member = payload.room.members.find((m) => m.userId === guest.userId);
    expect(member?.isConnected).toBe(true);
    expect(payload.room.members).toHaveLength(2);

    hostSocket.close();
    guestSocket.close();
  });
});

describe('reconnection during an active game', () => {
  test('reconnecting mid-game automatically receives the correct player-specific GAME_STATE', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4, gameId: 'fake-game' });
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

    await getGameSessionService().startGame(room.id, host.userId, 'fake-game');

    // Advance the game once so stateVersion is non-trivial (1, not 0).
    const bumped = waitForEvent<{ stateVersion: number }>(hostSocket, 'GAME_STATE');
    hostSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });
    await bumped;
    const guestSawInitialState = await waitForEvent<{
      stateVersion: number;
      view: { you: { secretNumber: number } };
    }>(guestSocket, 'GAME_STATE');
    expect(guestSawInitialState.stateVersion).toBe(1);
    const guestSecret = guestSawInitialState.view.you.secretNumber;

    // Guest disconnects and reconnects — must receive GAME_STATE
    // automatically, with the SAME secret (their own), no ROOM_JOIN, no
    // GAME_ACTION needed.
    guestSocket.disconnect();
    await sleep(100);
    const reconnectGameState = waitForEvent<{
      stateVersion: number;
      view: { you: { secretNumber: number }; others: Record<string, unknown>[] };
    }>(guestSocket, 'GAME_STATE');
    guestSocket.connect();
    await waitForConnect(guestSocket);
    const restored = await reconnectGameState;

    expect(restored.stateVersion).toBe(1);
    expect(restored.view.you.secretNumber).toBe(guestSecret); // their own secret, unchanged
    for (const other of restored.view.others) {
      expect('secretNumber' in other).toBe(false); // never another player's hidden state
    }

    hostSocket.close();
    guestSocket.close();
  });
});

describe('multiple sockets for the same user', () => {
  test('the user stays connected while at least one tab is open, and only disconnects after the last one closes', async () => {
    // IMPORTANT: `host` (the multi-tab test subject) must NOT be the one
    // who creates the room via REST — POST /api/rooms already inserts an
    // isConnected:true membership row for its creator, so THEIR very first
    // socket connection would immediately auto-restore via the same path
    // reconnection uses, which is correct behavior but would confuse this
    // test's specific "explicit ROOM_JOIN causes PLAYER_JOINED" check. A
    // separate `roomCreator` avoids that overlap.
    const roomCreator = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, roomCreator, { maxPlayers: 4 });
    const host = await loginAsNewGuest(ctx.baseUrl);
    const observerHost = await loginAsNewGuest(ctx.baseUrl);

    const observerSocket = connectSocket(ctx.baseUrl, observerHost);
    await waitForConnect(observerSocket);
    observerSocket.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(observerSocket, 'ROOM_STATE');

    // Tab 1 for `host`.
    const tab1 = connectSocket(ctx.baseUrl, host);
    await waitForConnect(tab1);
    const observerSeesJoin = waitForEvent(observerSocket, 'PLAYER_JOINED');
    tab1.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(tab1, 'ROOM_STATE');
    await observerSeesJoin;

    // Tab 2 for the SAME `host` user.
    const tab2 = connectSocket(ctx.baseUrl, host);
    await waitForConnect(tab2);
    tab2.emit('ROOM_JOIN', { code: room.code });
    await waitForEvent(tab2, 'ROOM_STATE');

    // Closing tab 1 must NOT mark host disconnected — tab 2 is still open.
    let sawUnexpectedDisconnect = false;
    const disconnectWatcher = (payload: { userId: string; room: RoomDTO }) => {
      if (payload.userId === host.userId) {
        const member = payload.room.members.find((m) => m.userId === host.userId);
        if (member && member.isConnected === false) sawUnexpectedDisconnect = true;
      }
    };
    observerSocket.on('PLAYER_UPDATED', disconnectWatcher);

    tab1.close();
    await sleep(300); // well past enough time for a (wrongly) fired presence update to arrive
    expect(sawUnexpectedDisconnect).toBe(false);

    // Now close the LAST remaining socket — presence must flip to disconnected.
    const observerSeesRealDisconnect = waitForEvent<{ userId: string; room: RoomDTO }>(
      observerSocket,
      'PLAYER_UPDATED',
    );
    tab2.close();
    const payload = await observerSeesRealDisconnect;
    expect(payload.userId).toBe(host.userId);
    const member = payload.room.members.find((m) => m.userId === host.userId);
    expect(member?.isConnected).toBe(false);
    expect(payload.room.members).toHaveLength(3); // still a member — grace period hasn't expired yet (roomCreator + host + observer)

    // Past the (shortened, 600ms) grace period with no reconnect -> real leave.
    const observerSeesLeave = waitForEvent<{ userId: string; room: RoomDTO }>(
      observerSocket,
      'PLAYER_LEFT',
      3000,
    );
    const leftPayload = await observerSeesLeave;
    expect(leftPayload.userId).toBe(host.userId);
    expect(leftPayload.room.members).toHaveLength(2); // roomCreator + observer remain

    observerSocket.close();
  });
});

describe('reconnection security', () => {
  test("a reconnecting socket can only ever be restored to ITS OWN authenticated user's room, never another user's", async () => {
    const userA = await loginAsNewGuest(ctx.baseUrl);
    const roomA = await createRoom(ctx.baseUrl, userA, { maxPlayers: 4 });
    const socketA = connectSocket(ctx.baseUrl, userA);
    await waitForConnect(socketA);
    socketA.emit('ROOM_JOIN', { code: roomA.code });
    await waitForEvent(socketA, 'ROOM_STATE');

    const userB = await loginAsNewGuest(ctx.baseUrl);
    const roomB = await createRoom(ctx.baseUrl, userB, { maxPlayers: 4 });
    const socketB = connectSocket(ctx.baseUrl, userB);
    await waitForConnect(socketB);
    socketB.emit('ROOM_JOIN', { code: roomB.code });
    const stateB = await waitForEvent<RoomDTO>(socketB, 'ROOM_STATE');
    expect(stateB.id).toBe(roomB.id); // sanity: B is in ITS OWN room

    // B reconnects — must be restored to room B, never room A, no matter
    // what. Identity is derived purely from B's own access token.
    const reconnectState = waitForEvent<RoomDTO>(socketB, 'ROOM_STATE');
    socketB.disconnect();
    await sleep(100);
    socketB.connect();
    await waitForConnect(socketB);
    const restored = await reconnectState;

    expect(restored.id).toBe(roomB.id);
    expect(restored.id).not.toBe(roomA.id);
    expect(restored.members.every((m) => m.userId !== userA.userId)).toBe(true);

    socketA.close();
    socketB.close();
  });

  test("a fresh guest with no prior membership anywhere receives 'connected', not 'reconnected', and no ROOM_STATE", async () => {
    const fresh = await loginAsNewGuest(ctx.baseUrl);
    const socket = connectSocket(ctx.baseUrl, fresh);
    await waitForConnect(socket);

    const status = await waitForEvent<ConnectionStatusPayload>(socket, 'CONNECTION_STATUS');
    expect(status.status).toBe('connected');

    let gotRoomState = false;
    socket.on('ROOM_STATE', () => {
      gotRoomState = true;
    });
    await sleep(200);
    expect(gotRoomState).toBe(false);

    socket.close();
  });
});
