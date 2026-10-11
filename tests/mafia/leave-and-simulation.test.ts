import { describe, test, expect } from 'vitest';
import { makeGame } from './helpers';

// 6 players: p1 MAFIA, p2 DOCTOR, p3 DETECTIVE, p4–p6 CITIZEN
// 8 players: p1,p2 MAFIA, p3 DOCTOR, p4 DETECTIVE, p5–p8 CITIZEN

describe('permanent leave (onPlayerLeft)', () => {
  test('the only mafia leaving → role revealed, town wins immediately', () => {
    const g = makeGame(6);
    g.toNight();
    const r = g.def.onPlayerLeft!(g.state, 'p1')!;
    expect(r.nextState.phase).toBe('GAME_FINISHED');
    expect(r.nextState.winner).toBe('TOWN');
    expect(r.events[0]).toEqual({ type: 'PLAYER_LEFT', playerId: 'p1', revealedRole: 'MAFIA' });
    expect(r.events.map((e) => e.type)).toContain('CITIZENS_WON');
    const p1 = r.nextState.players.find((p) => p.id === 'p1')!;
    expect(p1).toMatchObject({ alive: false, eliminationCause: 'LEFT', eliminationRound: 1 });
  });

  test('a citizen leaving: phase and timer unchanged, game goes on', () => {
    const g = makeGame(8);
    g.toNight();
    const before = { phase: g.state.phase, endsAt: g.state.phaseEndsAt };
    const r = g.def.onPlayerLeft!(g.state, 'p6')!;
    expect(r.nextState.phase).toBe(before.phase);
    expect(r.nextState.phaseEndsAt).toBe(before.endsAt);
    expect(r.nextState.eliminationHistory).toEqual([{ round: 1, playerId: 'p6', cause: 'LEFT', revealedRole: 'CITIZEN' }]);
    expect(g.def.getPlayerView(r.nextState, 'p7')).toMatchObject({
      players: expect.arrayContaining([expect.objectContaining({ id: 'p6', alive: false, revealedRole: 'CITIZEN' })]),
    });
  });

  test('the doctor leaving mid-NIGHT: their pending protection is dropped', () => {
    const g = makeGame(8);
    g.toNight();
    g.act('p3', { type: 'DOCTOR_PROTECT', targetUserId: 'p5' });
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    g.state = g.def.onPlayerLeft!(g.state, 'p3')!.nextState;
    expect(g.state.currentNightActions.doctorTarget).toBeNull();
    g.next();
    expect(g.state.players.find((p) => p.id === 'p5')!.alive).toBe(false); // no longer protected
  });

  test('the detective leaving: excluded from later actions; a mafia member leaving drops their night vote', () => {
    const g = makeGame(8);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    g.state = g.def.onPlayerLeft!(g.state, 'p4')!.nextState;
    expect(g.act('p4', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' }).reason).toBe('player_dead');

    g.state = g.def.onPlayerLeft!(g.state, 'p1')!.nextState; // leader leaves → p2 becomes leader
    expect(g.state.currentNightActions.mafiaVotes).toEqual({ p2: 'p6' });
    g.next();
    expect(g.state.players.find((p) => p.id === 'p6')!.alive).toBe(false);
  });

  test('leaving mid-VOTING removes their vote; a leave can hand mafia the win', () => {
    const g = makeGame(6);
    g.toVoting();
    g.act('p4', { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.act('p5', { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.state = g.def.onPlayerLeft!(g.state, 'p4')!.nextState;
    expect(g.state.currentVotes.votes).toEqual({ p5: 'p1' });
    expect(g.state.phase).toBe('VOTING');

    g.state = g.def.onPlayerLeft!(g.state, 'p5')!.nextState; // 1 mafia vs 3 town
    expect(g.state.winner).toBeNull();
    g.state = g.def.onPlayerLeft!(g.state, 'p6')!.nextState; // 1 vs 2
    const r = g.def.onPlayerLeft!(g.state, 'p2')!; // 1 vs 1 → mafia wins mid-VOTING
    expect(r.nextState.phase).toBe('GAME_FINISHED');
    expect(r.nextState.winner).toBe('MAFIA');
  });

  test('no-ops: already dead, unknown player, finished game', () => {
    const g = makeGame(6);
    g.toNight();
    g.state = g.def.onPlayerLeft!(g.state, 'p5')!.nextState;
    expect(g.def.onPlayerLeft!(g.state, 'p5')).toBeNull();
    expect(g.def.onPlayerLeft!(g.state, 'stranger')).toBeNull();
    g.state = g.def.onPlayerLeft!(g.state, 'p1')!.nextState;
    expect(g.def.onPlayerLeft!(g.state, 'p2')).toBeNull();
  });
});

describe('chat permission hook', () => {
  test('alive → yes, dead → no, after GAME_FINISHED → everyone', () => {
    const g = makeGame(6);
    const ctx = { roomRole: 'PLAYER' as const, roomStatus: 'IN_GAME' as const };
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    g.next();
    expect(g.def.canSendMessage!(g.state, 'p5', ctx)).toBe(true);
    expect(g.def.canSendMessage!(g.state, 'p4', ctx)).toBe(false);
    expect(g.def.canSendMessage!(g.state, 'outsider', ctx)).toBe(false);
    g.state = g.def.onPlayerLeft!(g.state, 'p1')!.nextState;
    expect(g.state.phase).toBe('GAME_FINISHED');
    expect(g.def.canSendMessage!(g.state, 'p4', ctx)).toBe(true);
  });
});

describe('full 6-player simulation to GAME_FINISHED', () => {
  test('role reveal → nights, days, votes → town wins; every transition consistent', () => {
    const g = makeGame(6);
    const phases: string[] = [g.state.phase];
    const step = () => {
      g.clock.t = g.state.phaseEndsAt ?? g.clock.t;
      g.next();
      phases.push(g.state.phase);
    };

    for (const p of g.state.players) g.act(p.id, { type: 'ROLE_READY' });
    expect(g.state.phaseEndsAt).toBe(g.clock.t);
    step(); // NIGHT 1

    // Night 1: mafia goes for p4, doctor saves p4, detective finds p1.
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p4' });
    g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' });
    expect(g.view('p3').detectiveInvestigations![0]!.isMafia).toBe(true);
    step(); // DAY_ANNOUNCEMENT — nobody died
    expect(g.state.lastNightOutcome).toEqual({ round: 1, eliminatedPlayerId: null, revealedRole: null });
    step(); // DISCUSSION
    step(); // VOTING
    // Day 1: town hesitates — tie.
    g.act('p3', { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.act('p1', { type: 'PLAYER_VOTE', targetUserId: 'p3' });
    step(); // VOTE_RESULT (tie)
    expect(g.state.lastVoteOutcome!.wasTie).toBe(true);
    step(); // NIGHT 2

    // Night 2: mafia kills p5 (doctor guards p6).
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p6' });
    g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p6' });
    step();
    expect(g.state.lastNightOutcome).toEqual({ round: 2, eliminatedPlayerId: 'p5', revealedRole: 'CITIZEN' });
    step();
    step(); // VOTING
    for (const v of ['p2', 'p3', 'p4', 'p6']) g.act(v, { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.act('p1', { type: 'PLAYER_VOTE', targetUserId: 'p3' });
    step();

    expect(g.state.phase).toBe('GAME_FINISHED');
    expect(g.state.winner).toBe('TOWN');
    expect(g.state.phaseEndsAt).toBeNull();
    expect(phases).toEqual([
      'ROLE_REVEAL', 'NIGHT', 'DAY_ANNOUNCEMENT', 'DISCUSSION', 'VOTING', 'VOTE_RESULT',
      'NIGHT', 'DAY_ANNOUNCEMENT', 'DISCUSSION', 'VOTING', 'GAME_FINISHED',
    ]);
    expect(g.state.eliminationHistory).toEqual([
      { round: 2, playerId: 'p5', cause: 'MAFIA', revealedRole: 'CITIZEN' },
      { round: 2, playerId: 'p1', cause: 'VOTE', revealedRole: 'MAFIA' },
    ]);
    // every action is rejected now
    expect(g.act('p2', { type: 'PLAYER_VOTE', targetUserId: null }).reason).toBe('game_finished');
    // all roles public
    expect(g.view('p4').players.every((p) => p.revealedRole !== null)).toBe(true);
  });
});
