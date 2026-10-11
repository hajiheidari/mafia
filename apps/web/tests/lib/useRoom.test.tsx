import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FakeSocket } from './FakeSocket';

const fakeSocket = new FakeSocket();

vi.mock('../../lib/socket', () => ({
  connectSocket: () => fakeSocket,
  getSocket: () => fakeSocket,
}));

// Imported AFTER the mock so useRoom picks up the mocked module.
const { useRoom } = await import('../../lib/useRoom');

function makeRoom(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'room-1',
    code: 'ABCD12',
    hostUserId: 'user-a',
    gameId: 'fake-game',
    status: 'WAITING',
    visibility: 'PRIVATE',
    maxPlayers: 4,
    createdAt: new Date().toISOString(),
    roomVersion: 1,
    members: [
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  fakeSocket.emitted = [];
});

describe('useRoom — realtime state', () => {
  test('ROOM_STATE sets the room', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    expect(result.current.room?.code).toBe('ABCD12');
  });

  test('PLAYER_JOINED replaces the room with the updated snapshot (a second player appears)', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    expect(result.current.room?.members).toHaveLength(1);

    const updated = makeRoom({
      members: [
        ...makeRoom().members,
        { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      ],
    });
    act(() => fakeSocket.serverEmit('PLAYER_JOINED', { roomId: 'room-1', userId: 'user-b', room: updated }));
    expect(result.current.room?.members).toHaveLength(2);
  });

  test('PLAYER_LEFT updates the room to reflect the departure', () => {
    const { result } = renderHook(() => useRoom());
    const twoMembers = makeRoom({
      members: [
        ...makeRoom().members,
        { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      ],
    });
    act(() => fakeSocket.serverEmit('ROOM_STATE', twoMembers));
    expect(result.current.room?.members).toHaveLength(2);

    const oneLeft = makeRoom();
    act(() => fakeSocket.serverEmit('PLAYER_LEFT', { roomId: 'room-1', userId: 'user-b', room: oneLeft }));
    expect(result.current.room?.members).toHaveLength(1);
  });

  test('PLAYER_UPDATED reflects a ready-state change', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));

    const ready = makeRoom({ members: [{ ...makeRoom().members[0], isReady: true }] });
    act(() => fakeSocket.serverEmit('PLAYER_UPDATED', { roomId: 'room-1', userId: 'user-a', room: ready }));
    expect(result.current.room?.members[0]?.isReady).toBe(true);
  });

  test('CHAT_MESSAGE appends to the message list, in order', () => {
    const { result } = renderHook(() => useRoom());
    act(() => {
      fakeSocket.serverEmit('CHAT_MESSAGE', { id: '1', roomId: 'room-1', userId: 'user-a', displayName: 'میزبان', text: 'سلام', createdAt: new Date().toISOString() });
      fakeSocket.serverEmit('CHAT_MESSAGE', { id: '2', roomId: 'room-1', userId: 'user-b', displayName: 'مهمان', text: 'سلام بر تو', createdAt: new Date().toISOString() });
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.text).toBe('سلام');
    expect(result.current.messages[1]?.text).toBe('سلام بر تو');
  });

  test('GAME_STARTED then GAME_STATE transitions the hook into "game" mode with the personal view', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('GAME_STARTED', { roomId: 'room-1', gameId: 'fake-game' }));
    expect(result.current.gameStarted).toBe(true);

    act(() =>
      fakeSocket.serverEmit('GAME_STATE', { roomId: 'room-1', stateVersion: 1, view: { you: { secretNumber: 42 } } }),
    );
    expect(result.current.gameState?.stateVersion).toBe(1);
    expect((result.current.gameState?.view as { you: { secretNumber: number } }).you.secretNumber).toBe(42);
  });

  test('ERROR sets a readable error payload the UI can render', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ERROR', { code: 'ROOM_NOT_FOUND', message: 'این اتاق پیدا نشد' }));
    expect(result.current.error?.code).toBe('ROOM_NOT_FOUND');
  });
});

describe('useRoom — connection status (reconnection UX)', () => {
  test('CONNECTION_STATUS "reconnected" is reflected without the caller re-joining', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('CONNECTION_STATUS', { status: 'connected', userId: 'user-a' }));
    expect(result.current.connectionStatus).toBe('connected');

    act(() => fakeSocket.serverEmit('CONNECTION_STATUS', { status: 'reconnected', userId: 'user-a' }));
    expect(result.current.connectionStatus).toBe('reconnected');
  });

  test('a native socket "disconnect" flips status to reconnecting', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('connect'));
    expect(result.current.connectionStatus).toBe('connected');
    act(() => fakeSocket.serverEmit('disconnect'));
    expect(result.current.connectionStatus).toBe('reconnecting');
  });

  test('SYNC_REQUIRED automatically asks the server for a fresh snapshot (no user action needed)', () => {
    const { result: _result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    fakeSocket.emitted = [];
    act(() => fakeSocket.serverEmit('SYNC_REQUIRED', { roomId: 'room-1', reason: 'GAME_STATE_VERSION' }));
    expect(fakeSocket.emitted).toContainEqual({ event: 'ROOM_SYNC_REQUEST', payload: { roomId: 'room-1' } });
  });
});

describe('useRoom — actions emit the correct events', () => {
  test('joinByCode emits ROOM_JOIN with the code', () => {
    const { result } = renderHook(() => useRoom());
    act(() => result.current.joinByCode('ABCD12'));
    expect(fakeSocket.emitted).toContainEqual({ event: 'ROOM_JOIN', payload: { code: 'ABCD12' } });
  });

  test('setReady(true) emits PLAYER_READY, setReady(false) emits PLAYER_UNREADY, after a room is known', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    fakeSocket.emitted = [];

    act(() => result.current.setReady(true));
    expect(fakeSocket.emitted).toContainEqual({ event: 'PLAYER_READY', payload: { roomId: 'room-1' } });

    act(() => result.current.setReady(false));
    expect(fakeSocket.emitted).toContainEqual({ event: 'PLAYER_UNREADY', payload: { roomId: 'room-1' } });
  });

  test('sendChat trims and emits CHAT_SEND, ignores empty/whitespace-only text', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    fakeSocket.emitted = [];

    act(() => result.current.sendChat('  سلام  '));
    expect(fakeSocket.emitted).toContainEqual({ event: 'CHAT_SEND', payload: { roomId: 'room-1', text: 'سلام' } });

    fakeSocket.emitted = [];
    act(() => result.current.sendChat('   '));
    expect(fakeSocket.emitted).toHaveLength(0);
  });

  test('leaveRoom emits ROOM_LEAVE and clears local room state', () => {
    const { result } = renderHook(() => useRoom());
    act(() => fakeSocket.serverEmit('ROOM_STATE', makeRoom()));
    fakeSocket.emitted = [];

    act(() => result.current.leaveRoom());
    expect(fakeSocket.emitted).toContainEqual({ event: 'ROOM_LEAVE', payload: { roomId: 'room-1' } });
    expect(result.current.room).toBeNull();
  });
});
