import { describe, test, expect } from 'vitest';
import { assignRoles, createMafiaDefinition, defaultMafiaCount, resolveConfig, validateConfig } from '@platform/game-mafia';
import { makeGame, makePlayers } from './helpers';

describe('role distribution', () => {
  test.each([
    [6, 1], [7, 1], [8, 2], [10, 2], [11, 3], [14, 3], [15, 4], [20, 4],
  ])('%i players → %i mafia by default, plus one doctor and one detective', (n, mafia) => {
    expect(defaultMafiaCount(n)).toBe(mafia);
    const def = createMafiaDefinition();
    const state = def.createInitialState(makePlayers(n), {});
    const count = (r: string) => state.players.filter((p) => p.role === r).length;
    expect(count('MAFIA')).toBe(mafia);
    expect(count('DOCTOR')).toBe(1);
    expect(count('DETECTIVE')).toBe(1);
    expect(count('CITIZEN')).toBe(n - mafia - 2);
    expect(state.players.map((p) => p.joinOrder)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  test('uses the injected RNG (Fisher–Yates), so the distribution is reproducible in tests only', () => {
    const cfg = resolveConfig({}, 8);
    const a = assignRoles(makePlayers(8), cfg, (m) => m - 1).map((p) => p.role);
    expect(a.slice(0, 2)).toEqual(['MAFIA', 'MAFIA']);
    expect(a[2]).toBe('DOCTOR');
    expect(a[3]).toBe('DETECTIVE');
    const b = assignRoles(makePlayers(8), cfg, () => 0).map((p) => p.role);
    expect(b).not.toEqual(a);
  });

  test('host can move mafiaCount ±1 and disable doctor / detective (they become citizens)', () => {
    expect(resolveConfig({ mafiaCount: 3 }, 10).mafiaCount).toBe(3);
    expect(resolveConfig({ mafiaCount: 1 }, 10).mafiaCount).toBe(1);
    const g = makeGame(6, { doctorEnabled: false, detectiveEnabled: false });
    expect(g.idsWithRole('DOCTOR')).toEqual([]);
    expect(g.idsWithRole('DETECTIVE')).toEqual([]);
    expect(g.idsWithRole('CITIZEN')).toHaveLength(5);
  });

  test.each([
    ['too few players', 5, {}],
    ['too many players', 21, {}],
    ['mafiaCount 0', 8, { mafiaCount: 0 }],
    ['mafiaCount not integer', 8, { mafiaCount: 1.5 }],
    ['mafiaCount beyond ±1', 10, { mafiaCount: 4 }],
    ['night too short', 8, { nightSeconds: 5 }],
    ['discussion too long', 8, { discussionSeconds: 1000 }],
    ['non-configurable timer in v1', 8, { roleRevealSeconds: 10 }],
    ['client tries to assign roles', 8, { roles: { p1: 'DETECTIVE' } }],
    ['config not an object', 8, 'mafia'],
  ])('rejects: %s', (_label, n, input) => {
    expect(() => createMafiaDefinition().createInitialState(makePlayers(n), input as never)).toThrow();
  });

  test('structural invariants: mafia*2 < players, and at least one citizen', () => {
    const base = resolveConfig({}, 6);
    expect(() => validateConfig({ ...base, mafiaCount: 3 }, 6)).toThrow('too_many_mafia');
    expect(() => validateConfig({ ...base, mafiaCount: 2 }, 4)).toThrow('too_many_mafia');
    expect(() => validateConfig({ ...base, mafiaCount: 2 }, 6)).not.toThrow(); // 2 mafia + 2 specials + 2 citizens
    expect(() => validateConfig({ ...base, mafiaCount: 1 }, 3)).toThrow('no_room_for_citizen'); // 1 mafia + 2 specials leaves no citizen
  });

  test('a client action can never set or change a role', () => {
    const g = makeGame(6);
    const before = g.state.players.map((p) => p.role);
    expect(g.act('p4', { type: 'SET_ROLE', role: 'MAFIA' }).ok).toBe(false);
    expect(g.act('p4', { type: 'ROLE_READY', role: 'MAFIA' }).ok).toBe(true);
    expect(g.state.players.map((p) => p.role)).toEqual(before);
  });
});
