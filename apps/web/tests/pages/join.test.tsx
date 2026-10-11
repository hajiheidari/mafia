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

const fetchRoomByCodeMock = vi.fn();
vi.mock('../../lib/roomApi', async () => {
  const actual = await vi.importActual<typeof import('../../lib/roomApi')>('../../lib/roomApi');
  return {
    ...actual,
    fetchRoomByCode: (...args: unknown[]) => fetchRoomByCodeMock(...args),
  };
});

const JoinPage = (await import('../../app/join/page')).default;

beforeEach(() => {
  pushMock.mockReset();
  fetchRoomByCodeMock.mockReset();
});

describe('/join', () => {
  test('a valid room code navigates to the room', async () => {
    fetchRoomByCodeMock.mockResolvedValue({ id: 'room-1', code: 'ABCD12' });
    const user = userEvent.setup();
    render(<JoinPage />);

    await user.type(screen.getByLabelText('کد اتاق'), 'abcd12');
    await user.click(screen.getByRole('button', { name: 'ورود به اتاق' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/room/ABCD12'));
  });

  test('an unknown room code shows a friendly Persian error, not a raw one', async () => {
    const { ApiError } = await import('../../lib/api');
    fetchRoomByCodeMock.mockRejectedValue(new ApiError('ROOM_NOT_FOUND', 'no row in db', 404));
    const user = userEvent.setup();
    render(<JoinPage />);

    await user.type(screen.getByLabelText('کد اتاق'), 'ZZZZZZ');
    await user.click(screen.getByRole('button', { name: 'ورود به اتاق' }));

    await waitFor(() => expect(screen.getByText('این اتاق پیدا نشد.')).toBeInTheDocument());
    expect(screen.queryByText('no row in db')).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  test('a full room shows the correct friendly error', async () => {
    const { ApiError } = await import('../../lib/api');
    fetchRoomByCodeMock.mockRejectedValue(new ApiError('ROOM_FULL', 'capacity exceeded', 409));
    const user = userEvent.setup();
    render(<JoinPage />);

    await user.type(screen.getByLabelText('کد اتاق'), 'ABCD12');
    await user.click(screen.getByRole('button', { name: 'ورود به اتاق' }));

    await waitFor(() => expect(screen.getByText('ظرفیت اتاق تکمیل شده.')).toBeInTheDocument());
  });

  test('the submit button is disabled with an empty code', () => {
    render(<JoinPage />);
    expect(screen.getByRole('button', { name: 'ورود به اتاق' })).toBeDisabled();
  });
});
