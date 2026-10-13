import { describe, test, expect } from 'vitest';
// @ts-expect-error plain JS module shipped as-is to the static host
import * as L from '../../web/tool/logic.js';
// @ts-expect-error plain JS module shipped as-is to the static host
import { SCENARIOS, SCENARIO_ROLES } from '../../web/tool/scenarios.js';

const names = (n: number) => Array.from({ length: n }, (_, i) => `n${i + 1}`);
type P = { id: string; role: string; alive: boolean };
const fixed = (roles: string[]): P[] =>
  roles.map((role, i) => ({ id: `p${i + 1}`, name: `n${i + 1}`, role, alive: true, seen: false, death: null }) as P);

describe('setup', () => {
  test.each([6, 8, 10, 12, 16, 20])('suggested roles for %i players are valid', (n) => {
    const c = L.suggestRoles(n);
    expect(L.validateSetup(n, c)).toBeNull();
    expect(L.teamCounts(c).mafia).toBe(L.mafiaCountFor(n));
  });

  test('rejects wrong totals, no mafia, mafia majority, duplicate unique roles', () => {
    const c = L.suggestRoles(8);
    expect(L.validateSetup(9, c)).toMatchObject({ key: 'err.total', vars: { total: 8, n: 9 } });
    expect(L.validateSetup(4, { citizen: 4 })).toMatchObject({ key: 'err.noMafia' });
    expect(L.validateSetup(4, { mafia: 2, citizen: 2 })).toMatchObject({ key: 'err.parity' });
    expect(L.validateSetup(8, { mafia: 2, doctor: 2, citizen: 4 })).toMatchObject({ key: 'err.unique', vars: { role: 'doctor' } });
  });

  test('deal gives every role exactly once per slot', () => {
    const c = L.suggestRoles(12);
    const ps = L.dealRoles(names(12), c);
    const got: Record<string, number> = {};
    for (const p of ps) got[p.role] = (got[p.role] ?? 0) + 1;
    for (const r of L.ROLE_ORDER) expect(got[r] ?? 0).toBe(c[r]);
    expect(ps.every((p: P) => p.alive)).toBe(true);
  });
});

describe('night', () => {
  // p1 godfather, p2 lecter, p3 mafia, p4 doctor, p5 detective, p6 sniper, p7 diehard, p8-10 citizens
  const base = () => fixed(['godfather', 'lecter', 'mafia', 'doctor', 'detective', 'sniper', 'diehard', 'citizen', 'citizen', 'citizen']);

  test('mafia kill; doctor save prevents it', () => {
    let r = L.resolveNight(base(), {}, { mafia: 'p8' }, 1);
    expect(r.report.deaths).toEqual([{ id: 'p8', cause: 'night' }]);
    r = L.resolveNight(base(), {}, { mafia: 'p8', doctor: 'p8' }, 1);
    expect(r.report.deaths).toEqual([]);
    expect(r.report.saves).toEqual([{ id: 'p8', by: 'doctor' }]);
  });

  test('diehard survives the first night shot only', () => {
    const r1 = L.resolveNight(base(), {}, { mafia: 'p7' }, 1);
    expect(r1.report.shieldUsed).toBe('p7');
    expect(r1.report.deaths).toEqual([]);
    const r2 = L.resolveNight(r1.players, r1.memory, { mafia: 'p7' }, 2);
    expect(r2.report.deaths).toEqual([{ id: 'p7', cause: 'night' }]);
  });

  test('sniper: kills mafia unless lecter saves; hitting town kills the sniper', () => {
    expect(L.resolveNight(base(), {}, { sniper: 'p3' }, 1).report.deaths).toEqual([{ id: 'p3', cause: 'sniper' }]);
    const saved = L.resolveNight(base(), {}, { sniper: 'p3', lecter: 'p3' }, 1).report;
    expect(saved.deaths).toEqual([]);
    expect(saved.saves).toEqual([{ id: 'p3', by: 'lecter' }]);
    const back = L.resolveNight(base(), {}, { sniper: 'p9' }, 1).report;
    expect(back.sniperBackfired).toBe(true);
    expect(back.deaths).toEqual([{ id: 'p6', cause: 'sniper' }]);
  });

  test('detective: mafia positive, godfather negative, town negative', () => {
    const q = (id: string) => L.resolveNight(base(), {}, { detective: id }, 1).report.detective.positive;
    expect(q('p3')).toBe(true);
    expect(q('p2')).toBe(true);
    expect(q('p1')).toBe(false);
    expect(q('p8')).toBe(false);
  });

  test('doctor limits: not same player two nights running, self only once', () => {
    const ps = base();
    let r = L.resolveNight(ps, {}, { doctor: 'p4' }, 1);
    const t2 = L.targetsFor('doctor', r.players, r.memory).map((p: P) => p.id);
    expect(t2).not.toContain('p4'); // self used AND last save
    r = L.resolveNight(r.players, r.memory, { doctor: 'p8' }, 2);
    const t3 = L.targetsFor('doctor', r.players, r.memory).map((p: P) => p.id);
    expect(t3).not.toContain('p8');
    expect(t3).not.toContain('p4');
    expect(t3).toContain('p9');
  });

  test('mafia cannot target their own team; steps follow who is alive', () => {
    const ps = base();
    expect(L.targetsFor('mafia', ps, {}).map((p: P) => p.id)).not.toContain('p2');
    expect(L.nightSteps(ps)).toEqual(['mafia', 'lecter', 'doctor', 'detective', 'sniper']);
    ps[5]!.alive = false;
    ps[1]!.alive = false;
    expect(L.nightSteps(ps)).toEqual(['mafia', 'doctor', 'detective']);
  });

  test('inputs are not mutated', () => {
    const ps = base();
    const snap = JSON.stringify(ps);
    L.resolveNight(ps, {}, { mafia: 'p8', sniper: 'p9' }, 1);
    expect(JSON.stringify(ps)).toBe(snap);
  });
});

describe('win and votes', () => {
  test('town wins at zero mafia; mafia wins at parity', () => {
    const ps = fixed(['mafia', 'citizen', 'citizen']);
    expect(L.winner(ps)).toBeNull();
    ps[1]!.alive = false;
    expect(L.winner(ps)).toBe('mafia');
    ps[1]!.alive = true;
    ps[0]!.alive = false;
    expect(L.winner(ps)).toBe('town');
  });

  test('first vote sends everyone at the threshold to the defense, most votes first', () => {
    const ps = fixed(Array(10).fill('citizen')); // threshold 6
    expect(L.defenseList(ps, { p1: 6, p2: 7, p3: 5 })).toEqual(['p2', 'p1']);
    expect(L.defenseList(ps, { p1: 5 })).toEqual([]);
    ps[1]!.alive = false; // dead players never go
    expect(L.defenseList(ps, { p2: 9 })).toEqual([]);
  });

  test('final vote: single top leaves, ties go to the narrator, no votes means nobody', () => {
    expect(L.finalVote(['p1', 'p2'], { p1: 3, p2: 5 })).toEqual({ out: 'p2', tie: [] });
    expect(L.finalVote(['p1', 'p2', 'p3'], { p1: 4, p2: 4, p3: 1 })).toEqual({ out: null, tie: ['p1', 'p2'] });
    expect(L.finalVote(['p1'], {})).toEqual({ out: null, tie: [] });
  });

  test('vote threshold is more than half of the living', () => {
    expect(L.voteThreshold(fixed(Array(10).fill('citizen')))).toBe(6);
    expect(L.voteThreshold(fixed(Array(7).fill('citizen')))).toBe(4);
  });
});

describe('scenario and custom roles', () => {
  const extra = [
    { id: 's_boss', name: 'رئیس مافیا', team: 'mafia', kind: 'godfather' },
    { id: 's_medic', name: 'پزشک', team: 'town', kind: 'doctor' },
    { id: 'c_judge', name: 'بازپرس', team: 'town', night: true },
    { id: 'c_liar', name: 'شیاد', team: 'mafia', night: true, detNeg: true },
    { id: 'c_joker', name: 'جوکر', team: 'indep' },
  ];

  test('extra roles borrow built-in mechanics by kind', () => {
    L.setExtraRoles(extra);
    // p1 boss, p2 mafia, p3 liar, p4 medic, p5 detective, p6 judge, p7 joker, p8 citizen
    const ps = fixed(['s_boss', 'mafia', 'c_liar', 's_medic', 'detective', 'c_judge', 'c_joker', 'citizen']);
    expect(L.nightSteps(ps)).toEqual(['mafia', 'c_liar', 'doctor', 'detective', 'c_judge']);
    const r = L.resolveNight(ps, {}, { mafia: 'p8', doctor: 'p8', detective: 'p1', c_judge: 'p2' }, 1);
    expect(r.report.saves).toEqual([{ id: 'p8', by: 'doctor' }]);
    expect(r.report.detective.positive).toBe(false); // boss works like the godfather
    expect(r.report.manual).toEqual([{ role: 'c_judge', targetId: 'p2' }]);
    expect(L.detectivePositive('c_liar')).toBe(false);
    expect(L.detectivePositive('mafia')).toBe(true);
    expect(L.teamCounts({ s_boss: 1, c_joker: 1, citizen: 2 })).toEqual({ mafia: 1, town: 3, total: 4 });
    L.setExtraRoles([]);
  });

  test('at most one role per unique kind, even across names', () => {
    L.setExtraRoles(extra);
    expect(L.validateSetup(8, { godfather: 1, s_boss: 1, citizen: 6 })).toMatchObject({ key: 'err.sameKind', vars: { roles: ['godfather', 's_boss'] } });
    expect(L.validateSetup(8, { s_boss: 1, mafia: 1, s_medic: 1, citizen: 5 })).toBeNull();
    L.setExtraRoles([]);
  });

  test('scenario fits any player count with citizens; unknown roles dropped', () => {
    L.setExtraRoles(extra);
    expect(L.fitScenario({ s_boss: 1, mafia: 2, s_medic: 1, gone: 3, citizen: 9 }, 10)).toEqual({ s_boss: 1, mafia: 2, s_medic: 1, citizen: 6 });
    expect(L.fitScenario({ mafia: 3, doctor: 1 }, 3).citizen).toBe(0);
    const ps = L.dealRoles(names(5), { s_boss: 1, c_judge: 1, citizen: 3 });
    expect(ps.filter((p: P) => p.role === 'c_judge')).toHaveLength(1);
    L.setExtraRoles([]);
    expect(L.ROLES.c_judge).toBeUndefined();
    expect(L.ROLES.godfather.kind).toBe('godfather');
  });
});

describe('built-in scenarios', () => {
  test.each(SCENARIOS.map((sc: { id: string }) => sc.id))('%s is valid at its standard size and at 12', (id) => {
    L.setExtraRoles(SCENARIO_ROLES);
    const sc = SCENARIOS.find((x: { id: string }) => x.id === id);
    for (const r of Object.keys(sc.roles)) expect(L.ROLES[r], r).toBeDefined();
    expect(L.validateSetup(sc.players, L.fitScenario(sc.roles, sc.players))).toBeNull();
    expect(L.validateSetup(12, L.fitScenario(sc.roles, 12))).toBeNull();
    const min = L.minPlayersFor(sc.roles);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThanOrEqual(sc.players);
    expect(L.validateSetup(min - 1, L.fitScenario(sc.roles, min - 1))).not.toBeNull();
    L.setExtraRoles([]);
  });

  test('wake order, night immunity, sniper-proof boss, positive suspect', () => {
    L.setExtraRoles(SCENARIO_ROLES);
    // تکاور: نگهبان and گروگان‌گیر before the mafia, پزشک after تکاور.
    const tk = fixed(['s_takavar_boss', 's_takavar_hostage', 's_takavar_nato', 's_takavar_guard', 'detective', 's_takavar_commando', 's_takavar_medic', 's_takavar_gunner', 'citizen', 'citizen']);
    expect(L.nightSteps(tk)).toEqual(['s_takavar_guard', 's_takavar_hostage', 'mafia', 'detective', 's_takavar_commando', 'doctor', 's_takavar_gunner']);
    // بازپرس: روئین‌تن never dies at night.
    const bz = fixed(['s_bazpors_boss', 'mafia', 's_bazpors_tough', 'citizen', 'citizen']);
    const r = L.resolveNight(bz, {}, { mafia: 'p3' }, 1);
    expect(r.report.deaths).toEqual([]);
    expect(r.report.immuneHit).toBe('p3');
    // مذاکره: the sniper cannot kill the boss.
    const mz = fixed(['s_mozakere_boss', 'mafia', 's_mozakere_sniper', 'citizen', 'citizen']);
    const r2 = L.resolveNight(mz, {}, { sniper: 'p1' }, 1);
    expect(r2.report.deaths).toEqual([]);
    expect(r2.report.sniperNoEffect).toBe('p1');
    expect(L.resolveNight(mz, {}, { sniper: 'p2' }, 1).report.deaths).toEqual([{ id: 'p2', cause: 'sniper' }]);
    // کاپو: مظنون reads positive.
    expect(L.detectivePositive('s_capo_suspect')).toBe(true);
    expect(L.detectivePositive('s_capo_don')).toBe(false);
    L.setExtraRoles([]);
  });
});

describe('stats and medals', async () => {
  // @ts-expect-error plain JS module shipped as-is to the static host
  const S = await import('../../web/tool/stats.js');
  const now = Date.UTC(2026, 9, 13);
  const day = 24 * 3600 * 1000;

  test('a game counts once; recent counts follow the dates', () => {
    let s = S.emptyStats();
    s = S.recordGame(s, { id: 'g1', at: now - 2 * day, players: 10, nights: 3, scenario: 'auto' });
    s = S.recordGame(s, { id: 'g1', at: now - 2 * day, players: 10, nights: 3, scenario: 'auto' });
    s = S.recordGame(s, { id: 'g2', at: now - 20 * day, players: 16, nights: 6, scenario: 'b:takavar' });
    s = S.recordGame(s, { id: 'g3', at: now - 40 * day, players: 8, nights: 2, scenario: 'b:classic' });
    expect(s.total).toBe(3);
    expect(S.recentCounts(s, now)).toEqual({ week: 1, month: 2, total: 3 });
    const p = Object.fromEntries(S.medalProgress(s, { brand: { name: '' }, roles: [], scenarios: [] }).map((m: { key: string; percent: number }) => [m.key, m.percent]));
    expect(p).toMatchObject({ first_game: 100, games_10: 30, big_table: 100, long_game: 100, explorer: 100, own_brand: 0 });
  });

  test('Game Center points stay within Apple’s 1000 limit and ids are unique', () => {
    expect(S.MEDALS.reduce((a: number, m: { points: number }) => a + m.points, 0)).toBeLessThanOrEqual(1000);
    expect(new Set(S.MEDALS.map((m: { id: string }) => m.id)).size).toBe(S.MEDALS.length);
  });
});
