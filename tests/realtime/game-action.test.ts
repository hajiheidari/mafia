import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  bootTestServer,
  loginAsNewGuest,
  createRoom,
  connectSocket,
  waitForEvent,
  waitForConnect,
  type TestContext,
} from './testServer';
import { getGameSessionService } from '@platform/server/src/services';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootTestServer();
});

afterAll(async () => {
  await ctx.close();
});

async function setupTwoInRoomWithGame() {
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

  // Milestone 6 will add a proper "start game" UX; for now start the
  // session directly through the service (already permission-checked and
  // tested on its own) so this milestone can focus on the socket pipeline.
  await getGameSessionService().startGame(room.id, host.userId, 'fake-game');

  return { host, hostSocket, guest, guestSocket, room };
}

describe('GAME_ACTION through Socket.IO', () => {
  test('a valid action reaches the engine and each player gets their OWN filtered view', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoomWithGame();

    const hostSeesState = waitForEvent<{ stateVersion: number; view: { you: { secretNumber: number } } }>(
      hostSocket,
      'GAME_STATE',
    );
    const guestSeesState = waitForEvent<{ stateVersion: number; view: { you: { secretNumber: number } } }>(
      guestSocket,
      'GAME_STATE',
    );
    const bothSeeEvent = waitForEvent<{ events: { type: string }[] }>(hostSocket, 'GAME_EVENT');

    hostSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });

    const [hostView, guestView, eventPayload] = await Promise.all([
      hostSeesState,
      guestSeesState,
      bothSeeEvent,
    ]);

    expect(hostView.stateVersion).toBe(1);
    expect(guestView.stateVersion).toBe(1);
    // Different players get different personalized views (different secret numbers).
    expect(hostView.view.you.secretNumber).not.toBe(guestView.view.you.secretNumber);
    expect(eventPayload.events.some((e) => e.type === 'PLAYER_ACTION')).toBe(true);

    hostSocket.close();
    guestSocket.close();
  });

  test('the raw GAME_STATE payload never contains a field for another player\'s secret', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoomWithGame();

    const hostSeesState = waitForEvent<{ view: { you: unknown; others: unknown[] } }>(hostSocket, 'GAME_STATE');
    hostSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });
    const { view } = await hostSeesState;

    // Structural check (see the fix in tests/game-engine/no-leak.test.ts):
    // `others` entries must never carry a secretNumber field at all.
    for (const other of view.others as Record<string, unknown>[]) {
      expect('secretNumber' in other).toBe(false);
    }

    hostSocket.close();
    guestSocket.close();
  });

  test('a duplicate actionId is not applied twice (idempotency)', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoomWithGame();
    const actionId = randomUUID();

    const firstState = waitForEvent<{ stateVersion: number }>(hostSocket, 'GAME_STATE');
    hostSocket.emit('GAME_ACTION', { roomId: room.id, actionId, clientStateVersion: 0, action: { type: 'PING' } });
    const first = await firstState;
    expect(first.stateVersion).toBe(1);

    // Resend the EXACT same actionId (simulates a client retry after a dropped ack).
    const secondState = waitForEvent<{ stateVersion: number }>(hostSocket, 'GAME_STATE');
    hostSocket.emit('GAME_ACTION', { roomId: room.id, actionId, clientStateVersion: 0, action: { type: 'PING' } });
    const second = await secondState;

    expect(second.stateVersion).toBe(1); // NOT 2 — the action was not re-applied

    hostSocket.close();
    guestSocket.close();
  });

  test('a stale clientStateVersion yields SYNC_REQUIRED instead of corrupting state', async () => {
    const { hostSocket, guestSocket, room } = await setupTwoInRoomWithGame();

    // Bump the real version to 1 first.
    const bumped = waitForEvent(hostSocket, 'GAME_STATE');
    hostSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });
    await bumped;

    // Guest still thinks version is 0.
    const syncRequired = waitForEvent<{ reason: string }>(guestSocket, 'SYNC_REQUIRED');
    guestSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });
    const payload = await syncRequired;
    expect(payload.reason).toBe('GAME_STATE_VERSION');

    hostSocket.close();
    guestSocket.close();
  });

  test('an action from a non-member room is rejected, not silently dropped or crashing', async () => {
    const outsider = await loginAsNewGuest(ctx.baseUrl);
    const outsiderSocket = connectSocket(ctx.baseUrl, outsider);
    await waitForConnect(outsiderSocket);

    const { hostSocket, guestSocket, room } = await setupTwoInRoomWithGame();

    const errorPromise = waitForEvent<{ code: string }>(outsiderSocket, 'ERROR');
    outsiderSocket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: 0,
      action: { type: 'PING' },
    });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_A_MEMBER');

    outsiderSocket.close();
    hostSocket.close();
    guestSocket.close();
  });
});
