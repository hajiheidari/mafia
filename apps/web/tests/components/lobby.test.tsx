import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lobby } from '../../components/Lobby';
import type { RoomDTO } from '@platform/types';

function makeRoom(members: RoomDTO['members']): RoomDTO {
  return {
    id: 'room-1',
    code: 'ABCD12',
    hostUserId: members.find((m) => m.role === 'HOST')?.userId ?? 'user-a',
    gameId: 'fake-game',
    status: 'WAITING',
    visibility: 'PRIVATE',
    maxPlayers: 4,
    createdAt: new Date().toISOString(),
    roomVersion: 1,
    members,
  };
}

const baseProps = {
  currentUserId: 'user-a',
  connectionStatus: 'connected' as const,
  messages: [],
  gameMinPlayers: 2,
  gameName: 'بازی نمایشی',
  onReady: vi.fn(),
  onStart: vi.fn(),
  onLeave: vi.fn(),
  onRemovePlayer: vi.fn(),
  onSendChat: vi.fn(),
};

describe('Lobby', () => {
  test('renders the host badge and each player card', () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} />);

    expect(screen.getAllByText('میزبان').length).toBeGreaterThanOrEqual(1); // display name AND host badge label
    expect(screen.getByText('مهمان')).toBeInTheDocument();
    expect(screen.getByText('بازیکنان (2/4)')).toBeInTheDocument();
  });

  test("shows the current player's ready button when not the host", () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} currentUserId="user-b" />);
    expect(screen.getByRole('button', { name: 'آماده‌ام' })).toBeInTheDocument();
  });

  test('clicking ready calls onReady(true)', async () => {
    const onReady = vi.fn();
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    const user = userEvent.setup();
    render(<Lobby {...baseProps} room={room} currentUserId="user-b" onReady={onReady} />);

    await user.click(screen.getByRole('button', { name: 'آماده‌ام' }));
    expect(onReady).toHaveBeenCalledWith(true);
  });

  test('host cannot start when a player is not ready, and sees a hint why', () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} currentUserId="user-a" />);

    expect(screen.getByRole('button', { name: 'شروع بازی' })).toBeDisabled();
    expect(screen.getByText('منتظر آماده شدن همه‌ی بازیکن‌ها…')).toBeInTheDocument();
  });

  test('host can start once minimum players are met and all are ready', () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: true, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} currentUserId="user-a" />);

    expect(screen.getByRole('button', { name: 'شروع بازی' })).toBeEnabled();
  });

  test('host sees the minimum-players message when below the threshold', () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} currentUserId="user-a" gameMinPlayers={2} />);

    expect(screen.getByText('حداقل 2 بازیکن لازم است.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'شروع بازی' })).toBeDisabled();
  });

  test('non-host players never see a start button', () => {
    const room = makeRoom([
      { id: 'm1', userId: 'user-a', displayName: 'میزبان', avatarUrl: null, role: 'HOST', isReady: false, isConnected: true, joinedAt: new Date().toISOString() },
      { id: 'm2', userId: 'user-b', displayName: 'مهمان', avatarUrl: null, role: 'PLAYER', isReady: true, isConnected: true, joinedAt: new Date().toISOString() },
    ]);
    render(<Lobby {...baseProps} room={room} currentUserId="user-b" />);
    expect(screen.queryByRole('button', { name: 'شروع بازی' })).not.toBeInTheDocument();
  });
});
