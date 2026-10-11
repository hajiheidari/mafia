import { describe, test, expect } from 'vitest';
import type { MafiaPlayerView, MafiaState } from '@platform/game-mafia';
import { makeGame } from './helpers';

const PUBLIC_KEYS = [
  'phase', 'phaseEndsAt', 'round', 'setup', 'you', 'players', 'currentVoteTally',
  'eliminationHistory', 'lastNightOutcome', 'lastVoteOutcome', 'winner',
];
const FORBIDDEN_EVERYWHERE = [
  'mafiaVotes', 'doctorTarget', 'detectiveTarget', 'lastDoctorTargetByDoctorId',
  'investigations', 'currentNightActions', 'joinOrder', 'eliminationCause',
];

/** Asserts the leak policy for one viewer against the authoritative state. */
function assertNoLeak(state: MafiaState, viewerId: string, view: MafiaPlayerView) {
  const finished = state.phase === 'GAME_FINISHED';
  const me = state.players.find((p) => p.id === viewerId)!;
  const meAliveRole = me.alive && !finished ? me.role : null;
  const json = JSON.stringify(view);

  // 1. only the extras this viewer is entitled to
  const allowed = new Set(PUBLIC_KEYS);
  if (meAliveRole === 'MAFIA') allowed.add('mafiaTeammates');
  if (meAliveRole === 'DOCTOR') allowed.add('doctorLastProtectedId');
  if (meAliveRole === 'DETECTIVE') allowed.add('detectiveInvestigations');
  for (const key of Object.keys(view)) expect(allowed.has(key), `${viewerId} sees ${key}`).toBe(true);
  for (const key of FORBIDDEN_EVERYWHERE) expect(json.includes(`"${key}"`), `${viewerId} sees ${key}`).toBe(false);
  if (meAliveRole !== 'DETECTIVE') expect(json).not.toContain('isMafia');

  // 2. roles: own role + revealed (dead / finished) + teammates for alive mafia — nothing else
  expect(view.you.role).toBe(me.role);
  for (const p of state.players) {
    const pub = view.players.find((x) => x.id === p.id)!;
    const shouldReveal = finished || !p.alive;
    expect(pub.revealedRole, `${viewerId} → ${p.id}`).toBe(shouldReveal ? p.role : null);
  }
  const hiddenMafia = state.players.filter((p) => p.role === 'MAFIA' && p.alive && !finished && p.id !== viewerId);
  if (meAliveRole === 'MAFIA') {
    expect(view.mafiaTeammates!.map((t) => t.id).sort()).toEqual(
      state.players.filter((p) => p.role === 'MAFIA' && p.id !== viewerId).map((p) => p.id).sort(),
    );
  } else {
    for (const m of hiddenMafia) {
      // a hidden mafia's id must never sit next to a MAFIA role in this view
      expect(json.includes(`"id":"${m.id}","displayName":"${m.displayName}","alive":true,"revealedRole":null`)).toBe(true);
    }
    const revealedMafia = state.eliminationHistory.some((e) => e.revealedRole === 'MAFIA');
    if (!finished && !revealedMafia && view.winner !== 'MAFIA') {
      expect(json.replaceAll('"cause":"MAFIA"', '')).not.toContain('"MAFIA"');
    }
  }

  // 3. night choices: only your own
  const myTarget = view.you.nightTargetId;
  if (myTarget !== null) {
    expect(state.phase).toBe('NIGHT');
    expect(['MAFIA', 'DOCTOR', 'DETECTIVE']).toContain(meAliveRole);
  }
}


describe('player view leak sweep (every viewer, every phase)', () => {
  test('8-player game with 2 mafia, played through all phases to the end', () => {
    const g = makeGame(8); // p1,p2 MAFIA; p3 DOCTOR; p4 DETECTIVE; p5–p8 CITIZEN
    const seen = new Set<string>();
    const check = () => {
      seen.add(g.state.phase);
      for (const p of g.state.players) assertNoLeak(g.state, p.id, g.view(p.id));
      const outsider = g.view('outsider');
      expect(outsider.you.role).toBeNull();
      expect(outsider.mafiaTeammates).toBeUndefined();
      expect(outsider.players.every((p) => p.revealedRole === null || !p.alive || g.state.phase === 'GAME_FINISHED')).toBe(true);
    };

    check();
    g.act('p5', { type: 'ROLE_READY' });
    check();
    g.next(); // NIGHT 1
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p5' });
    check();
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p6' });
    g.act('p3', { type: 'DOCTOR_PROTECT', targetUserId: 'p6' });
    g.act('p4', { type: 'DETECTIVE_INVESTIGATE', targetUserId: 'p2' });
    check();
    g.next(); // tie → leader p1 → p5 dies (doctor protected p6)
    expect(g.state.players.find((p) => p.id === 'p5')!.alive).toBe(false);
    check(); // DAY_ANNOUNCEMENT — dead p5 sees only public info
    g.next();
    check(); // DISCUSSION
    g.next(); // VOTING
    for (const v of ['p3', 'p4', 'p6', 'p7']) g.act(v, { type: 'PLAYER_VOTE', targetUserId: 'p2' });
    check();
    g.next(); // VOTE_RESULT: p2 (mafia) out
    check();
    g.next(); // NIGHT 2
    g.act('p1', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p4' });
    check();
    g.next(); // detective dies
    check();
    g.toVoting();
    for (const v of ['p3', 'p6', 'p7', 'p8']) g.act(v, { type: 'PLAYER_VOTE', targetUserId: 'p1' });
    g.next();
    expect(g.state.phase).toBe('GAME_FINISHED');
    expect(g.state.winner).toBe('TOWN');
    check();

    expect([...seen].sort()).toEqual(
      ['DAY_ANNOUNCEMENT', 'DISCUSSION', 'GAME_FINISHED', 'NIGHT', 'ROLE_REVEAL', 'VOTE_RESULT', 'VOTING'].sort(),
    );
    // at the end every role is visible to everyone
    expect(g.view('p7').players.map((p) => p.revealedRole)).toEqual(g.state.players.map((p) => p.role));
  });
});

describe('mafia teammate visibility (2+ mafia)', () => {
  test('alive mafia see each other and each other’s current vote; nobody else does', () => {
    const g = makeGame(11); // p1–p3 MAFIA, p4 DOCTOR, p5 DETECTIVE
    g.toNight();
    g.act('p2', { type: 'MAFIA_SELECT_TARGET', targetUserId: 'p9' });
    const v1 = g.view('p1');
    expect(v1.mafiaTeammates).toEqual([
      { id: 'p2', displayName: 'Player 2', alive: true, currentTargetId: 'p9' },
      { id: 'p3', displayName: 'Player 3', alive: true, currentTargetId: null },
    ]);
    for (const id of ['p4', 'p5', 'p6', 'p11']) {
      expect(g.view(id).mafiaTeammates).toBeUndefined();
      expect(JSON.stringify(g.view(id))).not.toContain('currentTargetId');
    }

    // a mafia member who dies loses the team view
    g.next();
    g.toVoting();
    for (const v of ['p4', 'p5', 'p6', 'p7', 'p8']) g.act(v, { type: 'PLAYER_VOTE', targetUserId: 'p3' });
    g.next();
    expect(g.state.players.find((p) => p.id === 'p3')!.alive).toBe(false);
    expect(g.view('p3').mafiaTeammates).toBeUndefined();
    expect(g.view('p3').players.find((p) => p.id === 'p1')!.revealedRole).toBeNull();
    // the survivors still see the fallen teammate (marked dead)
    expect(g.view('p1').mafiaTeammates!.find((t) => t.id === 'p3')!.alive).toBe(false);
  });
});
