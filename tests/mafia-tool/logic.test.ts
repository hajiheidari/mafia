import { describe, test, expect } from 'vitest';
// @ts-expect-error plain JS module shipped as-is to the static host
import * as L from '../../deploy/mafia-tool/logic.js';

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
    expect(L.validateSetup(9, c)).toMatch(/برابر نیست/);
    expect(L.validateSetup(4, { citizen: 4 })).toMatch(/حداقل یک نقش مافیا/);
    expect(L.validateSetup(4, { mafia: 2, citizen: 2 })).toMatch(/کمتر باشد/);
    expect(L.validateSetup(8, { mafia: 2, doctor: 2, citizen: 4 })).toMatch(/فقط یکی/);
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

  test('vote threshold is more than half of the living', () => {
    expect(L.voteThreshold(fixed(Array(10).fill('citizen')))).toBe(6);
    expect(L.voteThreshold(fixed(Array(7).fill('citizen')))).toBe(4);
  });

  test('persian digits', () => {
    expect(L.toFa(120)).toBe('۱۲۰');
  });
});
