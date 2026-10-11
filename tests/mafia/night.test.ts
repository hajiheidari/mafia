import { describe, test, expect } from 'vitest';
import { makeGame } from './helpers';

// 6 players with identity RNG: p1 MAFIA, p2 DOCTOR, p3 DETECTIVE, p4–p6 CITIZEN
// 8 players: p1,p2 MAFIA, p3 DOCTOR, p4 DETECTIVE, p5–p8 CITIZEN

describe('ROLE_REVEAL', () => {
  test('ends early once every alive player has sent ROLE_READY', () => {
    const g = makeGame(6);
    const deadline = g.state.phaseEndsAt!;
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) g.act(id, { type: 'ROLE_READY' });
    expect(g.state.phaseEndsAt).toBe(deadline);
    const r = g.act('p6', { type: 'ROLE_READY' });
    expect(r.events).toEqual([{ type: 'PLAYER_ROLE_ACKED', playerId: 'p6' }]);
    expect(g.state.phaseEndsAt).toBe(g.clock.t); // due now → scheduler advances
    g.next();
    expect(g.state.phase).toBe('NIGHT');
    expect(g.state.round).toBe(1);
  });
});

describe('mafia', () => {
  test('rejects wrong phase, dead target, self, teammate', () => {
    const g = makeGame(8);
    expect(g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' }).reason).toBe('wrong_phase');
    g.toNight();
    expect(g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p1' }).reason).toBe('cannot_target_self');
    expect(g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p2' }).reason).toBe('target_is_mafia');
    expect(g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'nobody' }).reason).toBe('invalid_target');
    expect(g.act('p5', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' }).reason).toBe('wrong_role');
    // a citizen probing "is p2 mafia?" gets wrong_role, never target_is_mafia (no oracle)
    expect(g.act('p5', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p2' }).reason).toBe('wrong_role');

    g.state = { ...g.state, players: g.state.players.map((p) => (p.id === 'p6' ? { ...p, alive: false } : p)) };
    expect(g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' }).reason).toBe('invalid_target');
  });

  test('last vote of each member counts; majority target dies', () => {
    const g = makeGame(8);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' }); // changed mind
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    const events = g.next();
    expect(g.state.players.find((p) => p.id === 'p6')!.alive).toBe(false);
    expect(events).toContainEqual({ type: 'NIGHT_RESOLVED', round: 1, eliminatedPlayerId: 'p6', revealedRole: 'CITIZEN' });
  });

  test('tie → the leader (lowest joinOrder alive mafia) decides', () => {
    const g = makeGame(8);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    g.next();
    expect(g.state.players.find((p) => p.id === 'p5')!.alive).toBe(false);
    expect(g.state.players.find((p) => p.id === 'p6')!.alive).toBe(true);
  });

  test('tie where the leader did not vote → nobody dies; no mafia votes → nobody dies', () => {
    const g = makeGame(11); // p1,p2,p3 mafia
    g.toNight();
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    g.act('p3', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p7' });
    const events = g.next();
    expect(events).toContainEqual({ type: 'NIGHT_RESOLVED', round: 1, eliminatedPlayerId: null, revealedRole: null });

    const h = makeGame(6);
    h.toNight();
    h.next();
    expect(h.alive()).toHaveLength(6);
  });

  test('the mafia target never leaks to non-mafia (no event, not in their view)', () => {
    const g = makeGame(8);
    g.toNight();
    const r = g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p7' });
    expect(r.events).toEqual([]);
    for (const id of ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']) {
      const v = g.view(id);
      expect(v.mafiaTeammates).toBeUndefined();
      expect(JSON.stringify(v)).not.toContain('MAFIA');
    }
    expect(g.view('p2').mafiaTeammates).toEqual([
      { id: 'p1', displayName: 'Player 1', alive: true, currentTargetId: 'p7' },
    ]);
    expect(g.view('p1').you.nightTargetId).toBe('p7');
  });
});

describe('doctor', () => {
  test('protecting the mafia target prevents the kill; self-protection allowed', () => {
    const g = makeGame(6);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p2' });
    expect(g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p2' }).ok).toBe(true);
    const events = g.next();
    expect(g.alive()).toHaveLength(6);
    expect(events).toContainEqual({ type: 'NIGHT_RESOLVED', round: 1, eliminatedPlayerId: null, revealedRole: null });
    // the public outcome never says WHY nobody died
    expect(JSON.stringify(events)).not.toContain('p2');
  });

  test('cannot protect the same player two nights in a row, but can after a gap', () => {
    const g = makeGame(6);
    g.toNight();
    g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p4' });
    while (g.state.phase !== 'NIGHT' || g.state.round !== 2) g.next();
    expect(g.view('p2').doctorLastProtectedId).toBe('p4');
    expect(g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p4' }).reason).toBe('same_target_consecutive_nights');
    expect(g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p5' }).ok).toBe(true);
    // night 3 without protecting anyone in night 2? here night 2 protected p5 → p4 allowed in night 3
    while (g.state.phase !== 'NIGHT' || g.state.round !== 3) g.next();
    expect(g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p4' }).ok).toBe(true);
  });

  test('no doctor action = no protection', () => {
    const g = makeGame(6);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    g.next();
    expect(g.state.players.find((p) => p.id === 'p4')!.alive).toBe(false);
  });
});

describe('detective', () => {
  test('result is computed immediately and visible ONLY in the detective view', () => {
    const g = makeGame(6);
    g.toNight();
    const r = g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' });
    expect(r.events).toEqual([]);
    expect(g.view('p3').detectiveInvestigations).toEqual([{ round: 1, detectiveId: 'p3', targetId: 'p1', isMafia: true }]);
    for (const id of ['p1', 'p2', 'p4', 'p5', 'p6']) {
      const s = JSON.stringify(g.view(id));
      expect(s).not.toContain('isMafia');
      expect(s).not.toContain('detectiveInvestigations');
    }
  });

  test('rejects self, dead, unknown target and a second investigation in the same night', () => {
    const g = makeGame(6);
    g.toNight();
    expect(g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p3' }).reason).toBe('cannot_target_self');
    expect(g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'zzz' }).reason).toBe('invalid_target');
    expect(g.act('p4', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' }).reason).toBe('wrong_role');
    expect(g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p4' }).ok).toBe(true);
    expect(g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' }).reason).toBe('already_investigated');
  });
});

describe('night early completion', () => {
  test('once every alive night role has acted, the night is due immediately', () => {
    const g = makeGame(6);
    g.toNight();
    const deadline = g.state.phaseEndsAt!;
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    g.act('p2', { type: 'DOCTOR_PROTECT', targetUserId: 'p5' });
    expect(g.state.phaseEndsAt).toBe(deadline);
    g.act('p3', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p1' });
    expect(g.state.phaseEndsAt).toBe(g.clock.t);
  });

  test('entering a new night bumps the round and clears last night’s actions', () => {
    const g = makeGame(6);
    g.toNight();
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    while (g.state.phase !== 'NIGHT' || g.state.round !== 2) g.next();
    expect(g.state.currentNightActions).toEqual({ mafiaVotes: {}, doctorTarget: null, detectiveTarget: null });
  });
});
