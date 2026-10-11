import { describe, test, expect } from 'vitest';
import { evaluateWinner } from '@platform/game-mafia';
import { makeGame } from './helpers';

// 6 players: p1 MAFIA, p2 DOCTOR, p3 DETECTIVE, p4–p6 CITIZEN

describe('voting', () => {
  test('only alive players vote; votes are public and changeable (last counts)', () => {
    const g = makeGame(6);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    g.toVoting();
    expect(g.state.players.find((p) => p.id === 'p6')!.alive).toBe(false);

    expect(g.act('p6', { type: 'PLAYER_VOTE', targetUserId: 'p1' }).reason).toBe('player_dead');
    expect(g.act('p2', { type: 'PLAYER_VOTE', targetUserId: 'p6' }).reason).toBe('invalid_target');

    const r = g.act('p2', { type: 'PLAYER_VOTE', targetUserId: 'p4' });
    expect(r.events).toEqual([{ type: 'VOTE_CAST', voterId: 'p2', targetId: 'p4' }]);
    g.act('p2', { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.act('p3', { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.act('p4', { type: 'PLAYER_VOTE', targetUserId: 'p4' }); // self-vote allowed
    g.act('p5', { type: 'PLAYER_VOTE', targetUserId: null }); // explicit abstain

    const tally = g.view('p5').currentVoteTally!;
    expect(tally.votes).toEqual({ p2: 'p1', p3: 'p1', p4: 'p4', p5: null });
    expect(tally.counts).toEqual({ p1: 2, p4: 1 });

    const events = g.next();
    expect(events).toContainEqual({ type: 'VOTE_RESOLVED', eliminatedPlayerId: 'p1', revealedRole: 'MAFIA', wasTie: false });
    expect(g.state.phase).toBe('GAME_FINISHED');
    expect(g.state.winner).toBe('TOWN');
  });

  test('a tie between two candidates eliminates nobody', () => {
    const g = makeGame(6);
    g.toVoting();
    g.act('p2', { type: 'PLAYER_VOTE', targetUserId: 'p4' });
    g.act('p3', { type: 'PLAYER_VOTE', targetUserId: 'p5' });
    const events = g.next();
    expect(events).toContainEqual({ type: 'VOTE_RESOLVED', eliminatedPlayerId: null, revealedRole: null, wasTie: true });
    expect(g.alive()).toHaveLength(6);
    expect(g.state.phase).toBe('VOTE_RESULT');
    g.next();
    expect(g.state.phase).toBe('NIGHT');
    expect(g.state.round).toBe(2);
  });

  test('nobody voting = no elimination, not a tie', () => {
    const g = makeGame(6);
    g.toVoting();
    const events = g.next();
    expect(events).toContainEqual({ type: 'VOTE_RESOLVED', eliminatedPlayerId: null, revealedRole: null, wasTie: false });
  });

  test('voting outside VOTING is rejected', () => {
    const g = makeGame(6);
    g.toNight();
    expect(g.act('p4', { type: 'PLAYER_VOTE', targetUserId: 'p5' }).reason).toBe('wrong_phase');
  });
});

describe('win conditions', () => {
  const mk = (alive: Record<string, boolean>, roles: Record<string, string>) => ({
    players: Object.keys(roles).map((id) => ({ id, role: roles[id], alive: alive[id] ?? true })) as never,
  });

  test('town wins at 0 mafia; mafia wins at parity; otherwise no winner', () => {
    const roles = { a: 'MAFIA', b: 'MAFIA', c: 'DOCTOR', d: 'DETECTIVE', e: 'CITIZEN' };
    expect(evaluateWinner(mk({}, roles))).toBeNull(); // 2 vs 3
    expect(evaluateWinner(mk({ e: false }, roles))).toBe('MAFIA'); // 2 vs 2
    expect(evaluateWinner(mk({ a: false, b: false }, roles))).toBe('TOWN');
    expect(evaluateWinner(mk({ a: false }, roles))).toBeNull(); // 1 vs 3
  });

  test('mafia wins during the night (no premature finish before that)', () => {
    const g = makeGame(6); // 1 mafia vs 5 town
    for (const victim of ['p4', 'p5', 'p6']) {
      while (g.state.phase !== 'NIGHT') g.next();
      expect(g.state.phase).not.toBe('GAME_FINISHED');
      g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: victim });
      g.next();
      if (victim !== 'p6') expect(g.state.winner).toBeNull();
    }
    // after 3 kills: 1 mafia vs 2 town → game continues
    expect(g.state.winner).toBeNull();
    while (g.state.phase !== 'NIGHT') g.next();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p3' });
    const events = g.next();
    expect(g.state.phase).toBe('GAME_FINISHED');
    expect(g.state.winner).toBe('MAFIA');
    expect(events.find((e) => e.type === 'MAFIA_WON')).toEqual({
      type: 'MAFIA_WON',
      finalRoles: { p1: 'MAFIA', p2: 'DOCTOR', p3: 'DETECTIVE', p4: 'CITIZEN', p5: 'CITIZEN', p6: 'CITIZEN' },
    });
    expect(g.def.getNextPhase(g.state)).toBeNull();
    expect(g.def.checkWinCondition(g.state)).toEqual({ winnerSide: 'MAFIA' });
  });
});

describe('timers', () => {
  test('every timed phase gets phaseEndsAt = now + its configured duration', () => {
    const g = makeGame(6, { nightSeconds: 30, discussionSeconds: 60, votingSeconds: 25 });
    expect(g.state.phaseEndsAt).toBe(g.clock.t + 10_000);
    const expected: Record<string, number> = {
      NIGHT: 30, DAY_ANNOUNCEMENT: 8, DISCUSSION: 60, VOTING: 25, VOTE_RESULT: 8,
    };
    for (const phase of ['NIGHT', 'DAY_ANNOUNCEMENT', 'DISCUSSION', 'VOTING', 'VOTE_RESULT']) {
      g.clock.t += 1234;
      g.next();
      expect(g.state.phase).toBe(phase);
      expect(g.state.phaseEndsAt).toBe(g.clock.t + expected[phase]! * 1000);
      expect(g.def.getPhaseEndsAt!(g.state)).toBe(g.state.phaseEndsAt);
    }
  });

  test('a forged phaseEndsAt (or any extra field) in an action payload has no effect', () => {
    const g = makeGame(6);
    const deadline = g.state.phaseEndsAt;
    g.act('p4', { type: 'ROLE_READY', phaseEndsAt: 0, phase: 'GAME_FINISHED', winner: 'MAFIA' });
    expect(g.state.phaseEndsAt).toBe(deadline);
    expect(g.state.phase).toBe('ROLE_REVEAL');
    expect(g.state.winner).toBeNull();
  });
});
