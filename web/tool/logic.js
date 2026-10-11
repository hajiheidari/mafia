// منطق خالص بازی مافیا برای ابزار گرداننده (بدون DOM) — در مرورگر و در تست‌های Node استفاده می‌شود.

export const ROLES = {
  godfather: { name: 'پدرخوانده', team: 'mafia', icon: '🎩', desc: 'رئیس مافیا. شلیک شب با تصمیم اوست و استعلام کارآگاه از او «منفی» است.' },
  lecter: { name: 'دکتر لکتر', team: 'mafia', icon: '💉', desc: 'دکتر مافیا. هر شب یکی از اعضای مافیا را از تیر اسنایپر نجات می‌دهد. خودش را فقط یک بار.' },
  mafia: { name: 'مافیای ساده', team: 'mafia', icon: '🔪', desc: 'عضو تیم مافیا. شب‌ها با هم‌تیمی‌ها بیدار می‌شود.' },
  doctor: { name: 'دکتر', team: 'town', icon: '🩺', desc: 'هر شب یک نفر را نجات می‌دهد. خودش را فقط یک بار، و یک نفر را دو شب پشت‌سرهم نه.' },
  detective: { name: 'کارآگاه', team: 'town', icon: '🔎', desc: 'هر شب از یک نفر استعلام می‌گیرد. پدرخوانده را منفی می‌بیند.' },
  sniper: { name: 'اسنایپر', team: 'town', icon: '🎯', desc: 'شب می‌تواند شلیک کند. اگر به شهروند بزند، خودش می‌میرد.' },
  diehard: { name: 'رویین‌تن', team: 'town', icon: '🛡️', desc: 'اولین تیر شب مافیا به او اثر نمی‌کند.' },
  citizen: { name: 'شهروند ساده', team: 'town', icon: '🏠', desc: 'توانایی شبانه ندارد. با بحث و رأی، مافیا را پیدا می‌کند.' },
};

export const ROLE_ORDER = ['godfather', 'lecter', 'mafia', 'doctor', 'detective', 'sniper', 'diehard', 'citizen'];

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

export function teamCounts(counts) {
  let mafia = 0;
  let town = 0;
  for (const r of ROLE_ORDER) {
    if (ROLES[r].team === 'mafia') mafia += counts[r] || 0;
    else town += counts[r] || 0;
  }
  return { mafia, town, total: mafia + town };
}

/** Returns an error message (Persian) or null when the setup is playable. */
export function validateSetup(playerCount, counts) {
  if (playerCount < MIN_PLAYERS) return `حداقل ${MIN_PLAYERS} بازیکن لازم است.`;
  if (playerCount > MAX_PLAYERS) return `حداکثر ${MAX_PLAYERS} بازیکن.`;
  const { mafia, town, total } = teamCounts(counts);
  if (total !== playerCount) return `جمع نقش‌ها (${total}) با تعداد بازیکن‌ها (${playerCount}) برابر نیست.`;
  if (mafia < 1) return 'حداقل یک نقش مافیا لازم است.';
  if (mafia >= town) return 'تعداد مافیا باید از شهروندها کمتر باشد.';
  for (const r of ['godfather', 'lecter', 'doctor', 'detective', 'sniper', 'diehard']) {
    if ((counts[r] || 0) > 1) return `از نقش «${ROLES[r].name}» فقط یکی مجاز است.`;
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
  for (const r of ROLE_ORDER) for (let i = 0; i < (counts[r] || 0); i++) bag.push(r);
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

export const teamOf = (role) => ROLES[role].team;

export function aliveWithRole(players, role) {
  return players.filter((p) => p.alive && p.role === role);
}

/** Which night steps apply this night, given who is alive. */
export function nightSteps(players) {
  const steps = [];
  if (players.some((p) => p.alive && teamOf(p.role) === 'mafia')) steps.push('mafia');
  for (const r of ['lecter', 'doctor', 'detective', 'sniper']) {
    if (aliveWithRole(players, r).length) steps.push(r);
  }
  return steps;
}

/**
 * Valid targets for a role this night, plus a reason for each excluded
 * player so the narrator can explain it. `memory` carries cross-night
 * limits: lastDoctorSave, doctorSelfUsed, lecterSelfUsed.
 */
export function targetsFor(step, players, memory) {
  const alive = players.filter((p) => p.alive);
  const actor = step === 'mafia' ? null : aliveWithRole(players, step)[0];
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
      return [];
  }
}

/**
 * Resolves a night. `actions` = { mafia, lecter, doctor, detective, sniper }
 * (player ids or null). Pure: returns the new players/memory plus a
 * narrator report; never mutates its inputs.
 */
export function resolveNight(players, memory, actions, round) {
  const ps = players.map((p) => ({ ...p }));
  const mem = { ...memory };
  const byId = (id) => ps.find((p) => p.id === id);
  const report = { deaths: [], saves: [], shieldUsed: null, detective: null, sniperBackfired: false };

  const doctor = aliveWithRole(ps, 'doctor')[0];
  const lecter = aliveWithRole(ps, 'lecter')[0];
  const sniper = aliveWithRole(ps, 'sniper')[0];

  // Detective (answer is for the narrator to signal; godfather reads negative).
  if (actions.detective) {
    const t = byId(actions.detective);
    if (t) report.detective = { targetId: t.id, positive: teamOf(t.role) === 'mafia' && t.role !== 'godfather' };
  }

  const kills = new Map(); // id → cause

  // Mafia shot.
  if (actions.mafia) {
    const t = byId(actions.mafia);
    if (t && t.alive) {
      if (doctor && actions.doctor === t.id) report.saves.push({ id: t.id, by: 'doctor' });
      else if (t.role === 'diehard' && !mem.diehardShieldUsed) {
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
        if (lecter && actions.lecter === t.id) report.saves.push({ id: t.id, by: 'lecter' });
        else kills.set(t.id, 'sniper');
      } else {
        report.sniperBackfired = true;
        kills.set(sniper.id, 'sniper');
      }
    }
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

export function toFa(n) {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}
