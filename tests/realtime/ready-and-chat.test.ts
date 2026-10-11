import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  bootTestServer,
  loginAsNewGuest,
  createRoom,
  connectSocket,
  waitForEvent,
  waitForConnect,
  type TestContext,
} from './testServer';
import type { RoomDTO, ChatMessageDTO } from '@platform/types';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootTestServer();
});

afterAll(async () => {
  await ctx.close();
});

async function setupTwoInRoom(maxPlayers = 4) {
  const host = await loginAsNewGuest(ctx.baseUrl);
  const room = await createRoom(ctx.baseUrl, host, { maxPlayers });
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

  return { host, hostSocket, guest, guestSocket, room };
}

describe('ready state', () => {
  test('a player can set their own ready state, and it broadcasts to the room', async () => {
    const { hostSocket, guest, guestSocket, room } = await setupTwoInRoom();

    const hostSeesUpdate = waitForEvent<{ userId: string; room: RoomDTO }>(hostSocket, 'PLAYER_UPDATED');
    guestSocket.emit('PLAYER_READY', { roomId: room.id });
    const payload = await hostSeesUpdate;

    expect(payload.userId).toBe(guest.userId);
    const member = payload.room.members.find((m) => m.userId === guest.userId);
    expect(member?.isReady).toBe(true);

    hostSocket.close();
    guestSocket.close();
  });

  test("there is no event that lets a client change another player's ready state", async () => {
    // By construction: PLAYER_READY/PLAYER_UNREADY only take { roomId } —
    // there is no playerId/targetUserId field in the client->server type
    // (see packages/types/src/events.ts), so this is enforced at the type
    // level, not just at runtime. This test documents and asserts the
    // runtime behavior: the change always applies to the SENDER's own
    // membership, derived from the authenticated socket, never a payload.
    const { hostSocket, host, guestSocket, room } = await setupTwoInRoom();

    const hostSeesUpdate = waitForEvent<{ userId: string; room: RoomDTO }>(guestSocket, 'PLAYER_UPDATED');
    hostSocket.emit('PLAYER_READY', { roomId: room.id });
    const payload = await hostSeesUpdate;

    expect(payload.userId).toBe(host.userId); // only the sender's own row changed
    const guestMember = payload.room.members.find((m) => m.userId !== host.userId);
    expect(guestMember?.isReady).toBe(false); // untouched

    hostSocket.close();
    guestSocket.close();
  });
});

describe('chat', () => {
  test('a message reaches the room, is persisted with server-derived identity, and cannot be spoofed', async () => {
    const { hostSocket, guest, guestSocket, room } = await setupTwoInRoom();

    const hostSeesMessage = waitForEvent<ChatMessageDTO>(hostSocket, 'CHAT_MESSAGE');
    // Attempt to spoof identity — the payload type doesn't even have a
    // userId/displayName field, but we cast to prove the server ignores
    // any extra fields a hand-crafted client might still send.
    (guestSocket as unknown as { emit: (...a: unknown[]) => void }).emit('CHAT_SEND', {
      roomId: room.id,
      text: 'سلام دوستان',
      userId: 'someone-else-entirely',
      displayName: 'Fake Name',
    });
    const message = await hostSeesMessage;

    expect(message.userId).toBe(guest.userId); // NOT "someone-else-entirely"
    expect(message.displayName).toBe(guest.displayName); // NOT "Fake Name"
    expect(message.text).toBe('سلام دوستان');
    expect(message.id).toBeTruthy();
    expect(message.createdAt).toBeTruthy();

    hostSocket.close();
    guestSocket.close();
  });

  test('an over-length message is truncated rather than rejected or crashing the server', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoom();
    const longText = 'a'.repeat(1000);

    const hostSeesMessage = waitForEvent<ChatMessageDTO>(hostSocket, 'CHAT_MESSAGE');
    guestSocket.emit('CHAT_SEND', { roomId: room.id, text: longText });
    const message = await hostSeesMessage;

    expect(message.text.length).toBeLessThanOrEqual(500);

    hostSocket.close();
    guestSocket.close();
  });

  test('rate limiting kicks in after repeated rapid messages', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoom();

    let sawRateLimitError = false;
    guestSocket.on('ERROR', (err: { code: string }) => {
      if (err.code === 'RATE_LIMITED') sawRateLimitError = true;
    });

    // CHAT limit is 8 per 10s (see RATE_LIMITS in packages/core) — fire well past it.
    for (let i = 0; i < 15; i++) {
      guestSocket.emit('CHAT_SEND', { roomId: room.id, text: `msg ${i}` });
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(sawRateLimitError).toBe(true);

    hostSocket.close();
    guestSocket.close();
  });
});
