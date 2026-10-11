import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ code: 'ABCD12' }),
}));

vi.mock('../../lib/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', user: { id: 'user-a', displayName: 'میزبان' } }),
}));

vi.mock('../../lib/roomApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/roomApi')>('../../lib/roomApi');
  return {
    ...actual,
    fetchGames: vi.fn().mockResolvedValue([{ id: 'fake-game', name: 'x', description: 'x', minPlayers: 2, maxPlayers: 8 }]),
    startGame: vi.fn(),
    removePlayer: vi.fn(),
  };
});

const room = {
  id: 'room-1',
  code: 'ABCD12',
  hostUserId: 'user-a',
  gameId: 'fake-game',
  status: 'IN_GAME',
  visibility: 'PRIVATE',
  maxPlayers: 4,
  createdAt: new Date().toISOString(),
  roomVersion: 1,
  members: [
    { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: true, isConnected: true, joinedAt: new Date().toISOString() },
  ],
};

const fakeGameView = {
  round: 1,
  maxRounds: 3,
  finished: false,
  you: { id: 'user-a', secretNumber: 77, score: 0 },
  others: [],
};

let useRoomMock: ReturnType<typeof vi.fn>;

vi.mock('../../lib/useRoom', () => ({
  useRoom: () => useRoomMock(),
}));

const RoomPage = (await import('../../app/room/[code]/page')).default;

beforeEach(() => {
  useRoomMock = vi.fn();
});

describe('RoomPage', () => {
  test('renders the Lobby while the game has not started', async () => {
    useRoomMock.mockReturnValue({
      room,
      connectionStatus: 'connected',
      messages: [],
      gameState: null,
      gameStarted: false,
      error: null,
      joinByCode: vi.fn(),
      leaveRoom: vi.fn(),
      setReady: vi.fn(),
      sendChat: vi.fn(),
      sendGameAction: vi.fn(),
      clearError: vi.fn(),
    });

    render(<RoomPage />);
    expect(await screen.findByText('اتاق انتظار')).toBeInTheDocument();
    expect(screen.getByText('ABCD12')).toBeInTheDocument();
  });

  test('renders GameShell + the player-specific game view once the game has started', async () => {
    useRoomMock.mockReturnValue({
      room,
      connectionStatus: 'connected',
      messages: [],
      gameState: { stateVersion: 1, view: fakeGameView },
      gameStarted: true,
      error: null,
      joinByCode: vi.fn(),
      leaveRoom: vi.fn(),
      setReady: vi.fn(),
      sendChat: vi.fn(),
      sendGameAction: vi.fn(),
      clearError: vi.fn(),
    });

    render(<RoomPage />);

    // The GameShell chrome (leave control) and the fake game's own secret
    // number (proving the player-specific view actually reached the UI).
    expect(await screen.findByRole('button', { name: 'خروج از بازی' })).toBeInTheDocument();
    expect(screen.getByText('77')).toBeInTheDocument();
    expect(screen.getByText('دور 1 از 3')).toBeInTheDocument();
  });

  test('shows a friendly error screen instead of the Lobby when the room is not found', async () => {
    useRoomMock.mockReturnValue({
      room: null,
      connectionStatus: 'connecting',
      messages: [],
      gameState: null,
      gameStarted: false,
      error: { code: 'ROOM_NOT_FOUND', message: 'raw' },
      joinByCode: vi.fn(),
      leaveRoom: vi.fn(),
      setReady: vi.fn(),
      sendChat: vi.fn(),
      sendGameAction: vi.fn(),
      clearError: vi.fn(),
    });

    render(<RoomPage />);
    expect(await screen.findByText('این اتاق پیدا نشد.')).toBeInTheDocument();
  });
});
