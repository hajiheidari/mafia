import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../lib/AuthProvider', () => ({
  useAuth: () => ({ status: 'ready', user: { id: 'user-a', displayName: 'میزبان' } }),
}));

const fetchGamesMock = vi.fn();
const createRoomMock = vi.fn();
vi.mock('../../lib/roomApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/roomApi')>('../../lib/roomApi');
  return {
    ...actual,
    fetchGames: () => fetchGamesMock(),
    createRoom: (...args: unknown[]) => createRoomMock(...args),
  };
});

const GamesPage = (await import('../../app/games/page')).default;

beforeEach(() => {
  pushMock.mockReset();
  createRoomMock.mockReset();
  fetchGamesMock.mockReset();
  fetchGamesMock.mockResolvedValue([
    { id: 'fake-game', name: 'بازی آزمایشی', description: 'x', minPlayers: 2, maxPlayers: 8 },
  ]);
});

describe('/games', () => {
  test('renders a playable card for the registered game and disabled cards for coming-soon games', async () => {
    render(<GamesPage />);

    await waitFor(() => expect(screen.getByText('بازی نمایشی')).toBeInTheDocument());

    // Coming-soon games are clearly labeled and NOT playable.
    expect(screen.getByText('مافیا')).toBeInTheDocument();
    expect(screen.getByText('جاسوس')).toBeInTheDocument();
    expect(screen.getByText('اسم فامیل')).toBeInTheDocument();
    const comingSoonLabels = screen.getAllByText('به‌زودی');
    expect(comingSoonLabels).toHaveLength(3); // exactly the 3 unavailable games, not the playable one

    // Only the available game has a "بازی کن" call to action.
    const playButtons = screen.getAllByRole('button', { name: 'بازی کن' });
    expect(playButtons).toHaveLength(1);
  });

  test('clicking play creates a room and navigates to it', async () => {
    createRoomMock.mockResolvedValue({ id: 'room-1', code: 'ABCD12' });
    const user = userEvent.setup();
    render(<GamesPage />);

    const playButton = await screen.findByRole('button', { name: 'بازی کن' });
    await user.click(playButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/room/ABCD12'));
    expect(createRoomMock).toHaveBeenCalledWith({ gameId: 'fake-game', maxPlayers: 8 });
  });

  test('a failed room creation shows a friendly error, not a raw exception', async () => {
    const { ApiError } = await import('../../lib/api');
    createRoomMock.mockRejectedValue(new ApiError('ROOM_FULL', 'raw backend text', 409));
    const user = userEvent.setup();
    render(<GamesPage />);

    const playButton = await screen.findByRole('button', { name: 'بازی کن' });
    await user.click(playButton);

    await waitFor(() => expect(screen.getByText('ظرفیت اتاق تکمیل شده.')).toBeInTheDocument());
    expect(screen.queryByText('raw backend text')).not.toBeInTheDocument();
  });

  test('once the server registers mafia it becomes a playable card instead of “coming soon”', async () => {
    fetchGamesMock.mockResolvedValue([
      { id: 'fake-game', name: 'بازی آزمایشی', description: 'x', minPlayers: 2, maxPlayers: 8 },
      { id: 'mafia', name: 'مافیا', description: 'x', minPlayers: 6, maxPlayers: 20 },
    ]);
    render(<GamesPage />);
    await waitFor(() => expect(screen.getByText('مافیا')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'بازی کن' })).toHaveLength(2);
    expect(screen.getAllByText('به‌زودی')).toHaveLength(2);
  });
});
