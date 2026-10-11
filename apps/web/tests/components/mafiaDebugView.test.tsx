import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MafiaPlayerView } from '@platform/game-mafia';
import { MafiaDebugView } from '../../components/MafiaDebugView';

function baseView(over: Partial<MafiaPlayerView> = {}): MafiaPlayerView {
  return {
    phase: 'NIGHT',
    phaseEndsAt: Date.now() + 30_000,
    round: 1,
    setup: { mafiaCount: 1, doctorEnabled: true, detectiveEnabled: true, playerCount: 3 },
    you: { id: 'a', role: 'MAFIA', alive: true, roleReadyAcked: true, nightTargetId: null },
    players: [
      { id: 'a', displayName: 'Ali', alive: true, revealedRole: null, roleReadyAcked: true },
      { id: 'b', displayName: 'Bita', alive: true, revealedRole: null, roleReadyAcked: true },
      { id: 'c', displayName: 'Cyrus', alive: false, revealedRole: 'CITIZEN', roleReadyAcked: true },
    ],
    currentVoteTally: null,
    eliminationHistory: [{ round: 1, playerId: 'c', cause: 'LEFT', revealedRole: 'CITIZEN' }],
    lastNightOutcome: null,
    lastVoteOutcome: null,
    winner: null,
    mafiaTeammates: [],
    ...over,
  };
}

describe('MafiaDebugView', () => {
  test('mafia at night: shows the role and sends MAFIA_SELECT_TARGET for an alive non-self target', async () => {
    const onAction = vi.fn();
    render(<MafiaDebugView view={baseView()} onAction={onAction} />);
    expect(screen.getByText('مافیا')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ali' })).not.toBeInTheDocument(); // not self
    expect(screen.queryByRole('button', { name: 'Cyrus' })).not.toBeInTheDocument(); // not dead
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bita' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'MAFIA_SELECT_TARGET', targetUserId: 'b' });
  });

  test('voting: every alive player plus abstain', async () => {
    const onAction = vi.fn();
    render(
      <MafiaDebugView
        view={baseView({ phase: 'VOTING', you: { id: 'b', role: 'CITIZEN', alive: true, roleReadyAcked: true, nightTargetId: null }, mafiaTeammates: undefined, currentVoteTally: { votes: {}, counts: {} } })}
        onAction={onAction}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ali' }));
    await user.click(screen.getByRole('button', { name: 'ممتنع' }));
    expect(onAction).toHaveBeenNthCalledWith(1, { type: 'PLAYER_VOTE', targetUserId: 'a' });
    expect(onAction).toHaveBeenNthCalledWith(2, { type: 'PLAYER_VOTE', targetUserId: null });
  });

  test('finished game shows the winner', () => {
    render(<MafiaDebugView view={baseView({ phase: 'GAME_FINISHED', phaseEndsAt: null, winner: 'TOWN' })} onAction={vi.fn()} />);
    expect(screen.getByText('شهروندان برنده شدند')).toBeInTheDocument();
  });
});
