// منطق خالص بازی مافیا برای ابزار گرداننده (بدون DOM) — در مرورگر و در تست‌های Node استفاده می‌شود.

// Logic only: no display text here. Role names, descriptions and error
// messages live in the language files (see i18n.js); validateSetup returns
// { key, vars } for the UI to translate.
//
// Built-in roles. Each has a `kind`: the night mechanics the tool resolves
// automatically. Scenario and custom roles (see setExtraRoles) either borrow
// one of these kinds — e.g. «رئیس مافیا» works like the godfather — or have
// no kind, and then the narrator wakes them and applies their effect by hand.
const BUILTIN = {
  godfather: { team: 'mafia', icon: '🎩' },
  lecter: { team: 'mafia', icon: '💉' },
  mafia: { team: 'mafia', icon: '🔪' },
  doctor: { team: 'town', icon: '🩺' },
  detective: { team: 'town', icon: '🔎' },
  sniper: { team: 'town', icon: '🎯' },
  diehard: { team: 'town', icon: '🛡️' },
  citizen: { team: 'town', icon: '🏠' },
};

export const ROLE_ORDER = ['godfather', 'lecter', 'mafia', 'doctor', 'detective', 'sniper', 'diehard', 'citizen'];

/** Every role the tool knows: built-ins plus extra roles. Mutated only by setExtraRoles. */
export const ROLES = Object.fromEntries(ROLE_ORDER.map((id) => [id, { ...BUILTIN[id], id, kind: id, night: false }]));

/** Kinds that can appear at most once in a game. */
export const UNIQUE_KINDS = ['godfather', 'lecter', 'doctor', 'detective', 'sniper', 'diehard'];
export const TEAM_IDS = ['mafia', 'town', 'indep'];

/**
 * Replaces the extra (non built-in) roles. A def is
 * { id, name?, desc?, team: 'mafia'|'town'|'indep', icon, desc, night: bool, kind?: one of UNIQUE_KINDS,
 *   detNeg?: detective reads «منفی», detPos?: detective reads «مثبت», immune?: the mafia's night shot never
 *   kills them, shotProof?: the sniper's shot has no effect on them, order?: wake position (see nightSteps),
 *   scenario?: id of the built-in scenario the role belongs to }.
 */
export function setExtraRoles(defs) {
  for (const id of Object.keys(ROLES)) if (!BUILTIN[id]) delete ROLES[id];
  for (const d of defs || []) {
    if (!d || !d.id || BUILTIN[d.id]) continue;
    ROLES[d.id] = {
      id: d.id,
      name: d.name == null ? null : String(d.name),
      team: TEAM_IDS.includes(d.team) ? d.team : 'town',
      icon: d.icon || (d.team === 'mafia' ? '🃏' : '🎴'),
      desc: d.desc == null ? null : String(d.desc),
      night: !!d.night && !d.kind,
      kind: UNIQUE_KINDS.includes(d.kind) ? d.kind : null,
      detNeg: !!d.detNeg,
      detPos: !!d.detPos,
      immune: !!d.immune,
      shotProof: !!d.shotProof,
      order: Number.isFinite(d.order) ? d.order : null,
      scenario: d.scenario || null,
    };
  }
}

/** Built-ins first, then extras grouped mafia → town → independent. */
export function allRoleIds() {
  const extra = Object.keys(ROLES).filter((id) => !BUILTIN[id]);
  const rank = { mafia: 0, town: 1, indep: 2 };
  extra.sort((a, b) => rank[ROLES[a].team] - rank[ROLES[b].team]);
  return [...ROLE_ORDER, ...extra];
}

export const kindOf = (role) => ROLES[role]?.kind ?? null;
export const teamOf = (role) => ROLES[role]?.team ?? 'town';

/** Order in which the narrator wakes roles at night. */
export const NIGHT_ORDER = ['mafia', 'lecter', 'doctor', 'detective', 'sniper'];

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 30;

export function mafiaCountFor(n) {
  if (n <= 5) return 1;
  if (n <= 7) return 1;
  if (n <= 10) return 2;
  if (n <= 14) return 3;
  if (n <= 20) return 4;
  return Math.floor(n / 4);
}

/** Suggested role counts for n players. */
export function suggestRoles(n) {
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, 0]));
  const m = mafiaCountFor(n);
  if (m === 1) counts.mafia = 1;
  else {
    counts.godfather = 1;
    if (m >= 3) counts.lecter = 1;
    counts.mafia = m - counts.godfather - counts.lecter;
  }
  counts.doctor = 1;
  counts.detective = 1;
  if (n >= 9) counts.sniper = 1;
  if (n >= 11) counts.diehard = 1;
  const used = ROLE_ORDER.reduce((s, r) => s + counts[r], 0);
  counts.citizen = Math.max(0, n - used);
  return counts;
}

/**
 * Fits a saved scenario (role → count) to n players: every role keeps its
 * count and plain citizens fill the rest. Roles the tool does not know are dropped.
 */
export function fitScenario(roles, n) {
  const counts = {};
  let used = 0;
  for (const [r, c] of Object.entries(roles || {})) {
    if (r === 'citizen' || !ROLES[r] || !(c > 0)) continue;
    counts[r] = Math.floor(c);
    used += counts[r];
  }
  counts.citizen = Math.max(0, n - used);
  return counts;
}

/** Smallest number of players for which a scenario is playable (0 if never, up to MAX_PLAYERS). */
export function minPlayersFor(roles) {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    if (!validateSetup(n, fitScenario(roles, n))) return n;
  }
  return 0;
}

/** Independents count on the town side for the parity rule. */
export function teamCounts(counts) {
  let mafia = 0;
  let town = 0;
  for (const [r, c] of Object.entries(counts || {})) {
    if (!ROLES[r] || !c) continue;
    if (teamOf(r) === 'mafia') mafia += c;
    else town += c;
  }
  return { mafia, town, total: mafia + town };
}

/**
 * Returns null when the setup is playable, else { key, vars } naming the
 * problem (keys 'err.*' in the language files; role ids in vars.role/roles).
 */
export function validateSetup(playerCount, counts) {
  if (playerCount < MIN_PLAYERS) return { key: 'err.min', vars: { n: MIN_PLAYERS } };
  if (playerCount > MAX_PLAYERS) return { key: 'err.max', vars: { n: MAX_PLAYERS } };
  const { mafia, town, total } = teamCounts(counts);
  if (total !== playerCount) return { key: 'err.total', vars: { total, n: playerCount } };
  if (mafia < 1) return { key: 'err.noMafia', vars: {} };
  if (mafia >= town) return { key: 'err.parity', vars: {} };
  for (const k of UNIQUE_KINDS) {
    const withKind = Object.keys(counts).filter((r) => ROLES[r] && kindOf(r) === k && counts[r] > 0);
    const n = withKind.reduce((s, r) => s + counts[r], 0);
    if (n > 1) {
      return withKind.length === 1
        ? { key: 'err.unique', vars: { role: withKind[0] } }
        : { key: 'err.sameKind', vars: { roles: withKind } };
    }
  }
  return null;
}

/** Uniform integer in [0, max) — crypto in the browser, injectable for tests. */
export function cryptoRandomInt(max) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/** Fisher–Yates deal. Returns players with a `role` each. */
export function dealRoles(names, counts, randomInt = cryptoRandomInt) {
  const bag = [];
  for (const r of allRoleIds()) for (let i = 0; i < (counts[r] || 0); i++) bag.push(r);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return names.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    role: bag[i],
    alive: true,
    seen: false,
    death: null, // { round, cause: 'night' | 'vote' | 'sniper' | 'manual' }
  }));
}

export function aliveWithKind(players, kind) {
  return players.filter((p) => p.alive && kindOf(p.role) === kind);
}

/** True when the detective's answer for this role is «مثبت». */
export function detectivePositive(role) {
  if (ROLES[role]?.detPos) return true;
  return teamOf(role) === 'mafia' && kindOf(role) !== 'godfather' && !ROLES[role]?.detNeg;
}

const KIND_RANK = { mafia: 20, lecter: 25, doctor: 50, detective: 60, sniper: 70 };

/**
 * Which night steps apply this night, given who is alive. A step is a kind
 * ('mafia', 'lecter', 'doctor', 'detective', 'sniper') or, for a role the
 * narrator handles by hand, that role's id. Steps are sorted by rank: the
 * kinds have fixed ranks (above), hand-run roles default to 30 (mafia team)
 * or 80 (others), and any role's `order` overrides the rank of its step.
 */
export function nightSteps(players) {
  const alive = players.filter((p) => p.alive);
  const steps = [];
  if (alive.some((p) => teamOf(p.role) === 'mafia')) steps.push('mafia');
  for (const k of ['lecter', 'doctor', 'detective', 'sniper']) {
    if (aliveWithKind(players, k).length) steps.push(k);
  }
  for (const r of allRoleIds()) {
    if (ROLES[r].night && alive.some((p) => p.role === r)) steps.push(r);
  }
  const rank = (step) => {
    if (KIND_RANK[step] !== undefined) {
      const actor = step === 'mafia' ? null : aliveWithKind(players, step)[0];
      return ROLES[actor?.role]?.order ?? KIND_RANK[step];
    }
    return ROLES[step].order ?? (teamOf(step) === 'mafia' ? 30 : 80);
  };
  return steps
    .map((step, i) => ({ step, i, r: rank(step) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.step);
}

/** Players who wake for a step. */
export function actorsFor(step, players) {
  if (step === 'mafia') return players.filter((p) => p.alive && teamOf(p.role) === 'mafia');
  if (NIGHT_ORDER.includes(step)) return aliveWithKind(players, step);
  return players.filter((p) => p.alive && p.role === step);
}

/**
 * Valid targets for a step this night. `memory` carries cross-night
 * limits: lastDoctorSave, doctorSelfUsed, lecterSelfUsed.
 */
export function targetsFor(step, players, memory) {
  const alive = players.filter((p) => p.alive);
  const actor = step === 'mafia' ? null : actorsFor(step, players)[0];
  switch (step) {
    case 'mafia':
      return alive.filter((p) => teamOf(p.role) !== 'mafia');
    case 'lecter':
      return alive.filter(
        (p) => teamOf(p.role) === 'mafia' && !(p.id === actor?.id && memory.lecterSelfUsed),
      );
    case 'doctor':
      return alive.filter(
        (p) => p.id !== memory.lastDoctorSave && !(p.id === actor?.id && memory.doctorSelfUsed),
      );
    case 'detective':
    case 'sniper':
      return alive.filter((p) => p.id !== actor?.id);
    default:
      return ROLES[step] ? alive : [];
  }
}

/**
 * Resolves a night. `actions` = { mafia, lecter, doctor, detective, sniper,
 * <manual role id>… } (player ids or null). Pure: returns the new
 * players/memory plus a narrator report; never mutates its inputs. Choices
 * of hand-run roles are only reported (report.manual), never applied.
 */
export function resolveNight(players, memory, actions, round) {
  const ps = players.map((p) => ({ ...p }));
  const mem = { ...memory };
  const byId = (id) => ps.find((p) => p.id === id);
  const report = { deaths: [], saves: [], shieldUsed: null, immuneHit: null, sniperNoEffect: null, detective: null, sniperBackfired: false, manual: [] };

  const doctor = aliveWithKind(ps, 'doctor')[0];
  const lecter = aliveWithKind(ps, 'lecter')[0];
  const sniper = aliveWithKind(ps, 'sniper')[0];

  // Detective (answer is for the narrator to signal; godfather reads negative).
  if (actions.detective) {
    const t = byId(actions.detective);
    if (t) report.detective = { targetId: t.id, positive: detectivePositive(t.role) };
  }

  const kills = new Map(); // id → cause

  // Mafia shot.
  if (actions.mafia) {
    const t = byId(actions.mafia);
    if (t && t.alive) {
      if (doctor && actions.doctor === t.id) report.saves.push({ id: t.id, by: 'doctor' });
      else if (ROLES[t.role]?.immune) report.immuneHit = t.id;
      else if (kindOf(t.role) === 'diehard' && !mem.diehardShieldUsed) {
        mem.diehardShieldUsed = true;
        report.shieldUsed = t.id;
      } else kills.set(t.id, 'night');
    }
  }

  // Sniper shot.
  if (sniper && actions.sniper) {
    const t = byId(actions.sniper);
    if (t && t.alive) {
      if (teamOf(t.role) === 'mafia') {
        if (ROLES[t.role]?.shotProof) report.sniperNoEffect = t.id;
        else if (lecter && actions.lecter === t.id) report.saves.push({ id: t.id, by: 'lecter' });
        else kills.set(t.id, 'sniper');
      } else {
        report.sniperBackfired = true;
        kills.set(sniper.id, 'sniper');
      }
    }
  }

  for (const [step, target] of Object.entries(actions)) {
    if (target && !NIGHT_ORDER.includes(step) && ROLES[step]) report.manual.push({ role: step, targetId: target });
  }

  for (const [id, cause] of kills) {
    const p = byId(id);
    p.alive = false;
    p.death = { round, cause };
    report.deaths.push({ id, cause });
  }

  // Cross-night memory.
  mem.lastDoctorSave = doctor ? actions.doctor || null : null;
  if (doctor && actions.doctor === doctor.id) mem.doctorSelfUsed = true;
  if (lecter && actions.lecter === lecter.id) mem.lecterSelfUsed = true;

  return { players: ps, memory: mem, report };
}

/** 'mafia' | 'town' | null */
export function winner(players) {
  let mafia = 0;
  let town = 0;
  for (const p of players) {
    if (!p.alive) continue;
    if (teamOf(p.role) === 'mafia') mafia++;
    else town++;
  }
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}

/** Votes needed to send someone to the defense/exit stage: more than half the living. */
export function voteThreshold(players) {
  const alive = players.filter((p) => p.alive).length;
  return Math.floor(alive / 2) + 1;
}

