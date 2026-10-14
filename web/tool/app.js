import {
  ROLES, ROLE_ORDER, MIN_PLAYERS, MAX_PLAYERS, UNIQUE_KINDS, TEAM_IDS,
  suggestRoles, fitScenario, minPlayersFor, teamCounts, validateSetup, dealRoles, nightSteps, actorsFor, targetsFor,
  resolveNight, winner, voteThreshold, defenseList, finalVote, teamOf, detectivePositive, setExtraRoles, allRoleIds,
} from './logic.js';
import { SCENARIOS as ALL_SCENARIOS, SCENARIO_ROLES } from './scenarios.js';
import { LANGS, detectLang, setLang, getLang, t, num, joinList, arrowBack, arrowNext } from './i18n.js';
import { isIOSApp, isAndroidApp, gameCenter, icloud } from './native.js';
import { LEADERBOARDS, MEDALS, emptyStats, recordGame, recentCounts, medalProgress } from './stats.js';
import * as backup from './backup.js';

setLang(detectLang());
/** Ready-made scenarios offered in the current language. */
const scenarios = () => ALL_SCENARIOS.filter((sc) => sc.langs.includes(getLang()));

const STORE_KEY = 'mafia-tool-v1';
const NAMES_KEY = 'mafia-tool-names';
const LIB_KEY = 'mafia-tool-library';
const STATS_KEY = 'mafia-tool-stats';
const BACKUP_KEY = 'mafia-tool-backup';

const COLORS = ['#7C5CFC', '#E5484D', '#F76B15', '#FFB224', '#30A46C', '#0091FF', '#D6409F', '#8D8D99'];

// ---------- library: the group's brand, own roles and saved scenarios (kept on this phone) ----------

function normalizeLibrary(lib) {
  return {
    brand: { name: '', logo: '', color: '', ...(lib?.brand || {}) },
    roles: Array.isArray(lib?.roles) ? lib.roles : [],
    scenarios: Array.isArray(lib?.scenarios) ? lib.scenarios : [],
    savedAt: Number(lib?.savedAt) || 0,
  };
}
function loadLibrary() {
  let lib = null;
  try { lib = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); } catch { /* ignore */ }
  return normalizeLibrary(lib);
}
let library = loadLibrary();
/** Saves the library on the phone, then copies it to iCloud and the recovery code (if any). */
function saveLibrary({ sync = true } = {}) {
  if (sync) library.savedAt = Date.now();
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(library));
  } catch {
    alert(t('err.storage'));
    return false;
  }
  if (sync) {
    icloud.set('library', JSON.stringify(library)).catch(() => {});
    scheduleBackup();
    syncGameCenter();
  }
  return true;
}

// ---------- stats, Game Center, iCloud, recovery code ----------

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full: keep going */ }
};

let stats = readJson(STATS_KEY, emptyStats());
const gc = { authenticated: false, name: '' };

/** Sends this period's game counts and the medal progress to Game Center (iPhone only). */
function syncGameCenter() {
  if (!isIOSApp() || !gc.authenticated) return;
  const times = stats.games.map((g) => g.at);
  for (const id of Object.values(LEADERBOARDS)) gameCenter.submitPeriodCount(id, times).catch(() => {});
  const done = medalProgress(stats, library).filter((m) => m.percent > 0).map(({ id, percent }) => ({ id, percent }));
  gameCenter.report(done).catch(() => {});
}

function signInGameCenter() {
  return gameCenter.signIn().then((info) => {
    gc.authenticated = !!info?.authenticated;
    gc.name = info?.name || '';
    syncGameCenter();
    if (state.view === 'settings') render();
  }).catch(() => {});
}

/** A finished game (a side won) counts once for stats, rankings and medals. */
function countGame() {
  if (!state.gameId) state.gameId = newId('g');
  stats = recordGame(stats, {
    id: state.gameId,
    at: Date.now(),
    players: state.players.length,
    nights: Math.max(0, state.round - 1),
    scenario: state.scenarioId || 'auto',
  });
  writeJson(STATS_KEY, stats);
  syncGameCenter();
}

/** Takes the iCloud copy of the library when it is newer (new phone, reinstall, another device). */
function pullICloud() {
  const hasContent = (lib) => !!(lib.roles.length || lib.scenarios.length || lib.brand.name || lib.brand.logo);
  icloud.get('library').then((text) => {
    const cloud = text ? normalizeLibrary(JSON.parse(text)) : null;
    if (!cloud || (cloud.savedAt || 0) < (library.savedAt || 0)) {
      // iCloud is empty or older: this phone's copy wins.
      if (hasContent(library)) icloud.set('library', JSON.stringify(library)).catch(() => {});
      return;
    }
    if (cloud.savedAt === library.savedAt) return;
    library = normalizeLibrary(cloud);
    saveLibrary({ sync: false });
    syncRoles();
    applyBrand();
    render();
  }).catch(() => {});
}

let backupState = readJson(BACKUP_KEY, null); // { code, savedAt, failed }
let backupTimer = null;
let backupBusy = false;

/** Saves the library under the recovery code a moment after the last change. */
function scheduleBackup() {
  if (!backupState?.code) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => runBackup(), 1500);
}
function runBackup() {
  if (!backupState?.code) return Promise.resolve();
  backupBusy = true;
  if (state.view === 'settings') render();
  return backup.upload(backupState.code, { library })
    .then(() => { backupState = { ...backupState, savedAt: Date.now(), failed: false }; })
    .catch(() => { backupState = { ...backupState, failed: true }; })
    .finally(() => {
      backupBusy = false;
      writeJson(BACKUP_KEY, backupState);
      if (state.view === 'settings') render();
    });
}

/** Registers every role the tool can show: scenario roles, the group's roles, and the roles of the running game. */
function syncRoles() {
  const byId = new Map();
  for (const d of [...SCENARIO_ROLES, ...library.roles, ...(state?.roleDefs || [])]) byId.set(d.id, d);
  setExtraRoles([...byId.values()]);
}

/**
 * A role with its display text in the current language: built-in and
 * scenario roles are translated, the group's own roles keep their own text.
 */
function roleOf(id) {
  const r = ROLES[id];
  if (!r) return { id, name: t('role.unknown'), team: 'town', icon: '❔', desc: '', kind: null, night: false };
  if (ROLE_ORDER.includes(id)) return { ...r, name: t(`role.${id}`), desc: t(`role.${id}.desc`) };
  if (r.scenario) return { ...r, name: t(`sr.${id}`), desc: t(`sr.${id}.desc`) };
  return { ...r, name: r.name ?? '', desc: r.desc ?? '' };
}
const brandName = () => library.brand.name.trim() || t('app.name');

function lighten(hex, amount = 0.35) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * amount);
  const [r, g, b] = [ch(n >> 16), ch((n >> 8) & 255), ch(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function applyBrand() {
  const c = library.brand.color;
  const root = document.documentElement.style;
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    root.setProperty('--accent', c);
    root.setProperty('--accent-soft', lighten(c));
  } else {
    root.removeProperty('--accent');
    root.removeProperty('--accent-soft');
  }
  document.title = library.brand.name.trim() ? t('title.brand', { brand: library.brand.name.trim() }) : t('title.default');
}

function logoHtml(cls = 'logo') {
  return library.brand.logo
    ? `<img class="${cls}-img" src="${esc(library.brand.logo)}" alt="">`
    : `<img class="${cls}-img" src="icon.svg" alt="">`;
}

/** Shrinks a picked image to at most 320px (PNG keeps transparency) so it fits in local storage. */
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 320;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Night steps the tool resolves itself (the rest are hand-run roles). */
const AUTO_STEPS = ['mafia', 'lecter', 'doctor', 'detective', 'sniper'];

/** Name of a night step: the team for the mafia step, else the role that wakes (as named in this game). */
function stepName(step) {
  if (step === 'mafia') return t('step.mafiaTeam');
  if (ROLES[step] && !AUTO_STEPS.includes(step)) return roleOf(step).name;
  const actor = actorsFor(step, state.players)[0];
  return actor ? roleOf(actor.role).name : roleOf(step).name;
}
function stepInfo(step) {
  const k = AUTO_STEPS.includes(step) ? step : 'manual';
  return { ask: t(`step.${k}.ask`), none: t(`step.${k}.none`) };
}

const cause = (c) => t(`cause.${c}`);

// ---------- state ----------

function freshState() {
  let names = [];
  try { names = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]'); } catch { /* ignore */ }
  return {
    view: 'setup', playerCount: names.length >= MIN_PLAYERS ? names.length : 10, names, counts: null, players: [], memory: {},
    round: 1, phase: 'day', night: null, report: null, votes: {}, log: [],
    showRoles: false, revealId: null, revealOpen: false, menuId: null, winner: null,
    scenarioId: null, roleDefs: [], editRole: null, settingsFrom: null,
  };
}

let state = load() || freshState();
if (!state.playerCount) state.playerCount = state.names.length >= MIN_PLAYERS ? state.names.length : 10;
syncRoles();
applyBrand();
const undoStack = [];

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    localStorage.setItem(NAMES_KEY, JSON.stringify(state.names));
  } catch { /* storage unavailable — game still works for this session */ }
}
function update(fn, { undoable = false } = {}) {
  if (undoable) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 30) undoStack.shift();
  }
  fn(state);
  save();
  render();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  state = JSON.parse(prev);
  syncRoles();
  save();
  render();
}

const byId = (id) => state.players.find((p) => p.id === id);
const nameOf = (id) => (id ? esc(byId(id)?.name ?? t('role.unknown')) : '—');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const phaseLabel = (phase = state.phase, round = state.round) => t(`phase.${phase}`, { n: round });

/**
 * History entries keep a key and raw values (player ids, role ids), not
 * text, so they read correctly after switching language.
 */
function addLog(key, vars = {}) {
  state.log.unshift({ phase: state.phase, round: state.round, key, vars });
}
function logText(l) {
  if (l.text) return { at: l.at, text: l.text }; // entries saved before translations existed
  const v = { ...l.vars };
  if (v.pid) v.name = nameOf(v.pid);
  if (v.role) v.role = esc(roleOf(v.role).name);
  if (v.pids) v.list = joinList(v.pids.map(nameOf));
  else if (v.list) v.list = joinList(v.list.map((pid) => `${nameOf(pid)} (${esc(roleOf(byId(pid)?.role).name)})`));
  return { at: phaseLabel(l.phase, l.round), text: t(`log.${l.key}`, v) };
}
function checkWin() {
  const w = winner(state.players);
  if (w) {
    state.winner = w;
    state.view = 'end';
    addLog(w === 'mafia' ? 'winMafia' : 'winTown');
    countGame();
  }
}

// ---------- timer (not persisted) ----------

const timer = { total: 60, left: 60, running: false, handle: null };
let audioCtx = null;
function beep(freq = 880, ms = 180) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* no audio */ }
}
function tick() {
  timer.left -= 1;
  if (timer.left === 10) beep(660);
  if (timer.left <= 0) {
    timer.left = 0;
    stopTimer();
    beep(880, 500);
    navigator.vibrate?.([300, 100, 300]);
  }
  renderTimer();
}
function startTimer() {
  if (timer.running) return;
  if (timer.left <= 0) timer.left = timer.total;
  timer.running = true;
  timer.handle = setInterval(tick, 1000);
  renderTimer();
}
function stopTimer() {
  timer.running = false;
  clearInterval(timer.handle);
  renderTimer();
}
function setTimer(sec) {
  stopTimer();
  timer.total = sec;
  timer.left = sec;
  renderTimer();
}
function renderTimer() {
  const el = document.getElementById('timer-value');
  if (!el) return;
  const m = Math.floor(timer.left / 60);
  const s = String(timer.left % 60).padStart(2, '0');
  el.textContent = num(`${m}:${s}`);
  el.classList.toggle('warn', timer.left <= 10 && timer.left > 0);
  el.classList.toggle('done', timer.left === 0);
  const btn = document.getElementById('timer-toggle');
  if (btn) btn.textContent = timer.running ? t('timer.stop') : t('timer.start');
}

// ---------- views ----------

const app = document.getElementById('app');

const roleLabel = (id) => `${roleOf(id).icon} ${esc(roleOf(id).name)}`;

function header(title, back, end) {
  const right = end
    ?? (undoStack.length && !['setup', 'players', 'settings', 'role-edit'].includes(state.view)
      ? `<button class="icon-btn" data-action="undo" aria-label="${t('a11y.undo')}">↶</button>`
      : '<span></span>');
  return `
  <header class="bar">
    ${back ? `<button class="icon-btn" data-action="${back}" aria-label="${t('a11y.back')}">${arrowBack()}</button>` : logoHtml()}
    <h1><small class="brand-name">${esc(brandName())}</small>${title}</h1>
    ${right}
  </header>`;
}

/** Scenarios to offer for n players: { id, name, note, min }, playable ones only. */
function scenarioOptions(n) {
  const all = [
    { id: 'auto', name: t('scn.auto'), note: t('scn.auto.note'), min: MIN_PLAYERS },
    ...library.scenarios.map((sc) => ({ id: `my:${sc.id}`, name: `⭐ ${sc.name}`, note: t('scn.mine.note'), min: minPlayersFor(sc.roles) })),
    ...scenarios().map((sc) => ({ id: `b:${sc.id}`, name: t(`sc.${sc.id}`), note: `${t(`sc.${sc.id}.summary`)} ${t('scn.deck', { n: sc.players })}`, min: minPlayersFor(sc.roles) })),
  ];
  return { fit: all.filter((o) => o.min && o.min <= n), more: all.filter((o) => !o.min || o.min > n) };
}
function scenarioName(id) {
  if (!id || id === 'auto') return t('scn.auto');
  if (id.startsWith('my:')) return library.scenarios.find((x) => `my:${x.id}` === id)?.name || t('scn.mine');
  return t(`sc.${id.slice(2)}`);
}

/** Text of a validateSetup error ({ key, vars } with role ids). */
function errorText({ key, vars }) {
  const v = { ...vars };
  if (v.role) v.role = t('quote', { s: esc(roleOf(v.role).name) });
  if (v.roles) v.roles = joinList(v.roles.map((r) => t('quote', { s: esc(roleOf(r).name) })));
  return t(key, v);
}

function languagePicker() {
  return `
  <section class="card">
    <p class="label">🌐 ${t('lang.label')}</p>
    <div class="presets">
      ${Object.entries(LANGS).map(([code, l]) => `<button class="chip-btn ${getLang() === code ? 'on' : ''}" data-action="set-lang" data-lang="${code}" lang="${code}">${l.name}</button>`).join('')}
    </div>
  </section>`;
}

function viewSetup() {
  const n = state.playerCount;
  const { fit, more } = scenarioOptions(n);
  const gear = `<button class="icon-btn" data-action="open-settings" aria-label="${t('a11y.settings')}">⚙︎</button>`;
  const minMore = more.filter((o) => o.min).map((o) => o.min);
  return `${header(t('setup.title'), null, gear)}
  <main class="pad">
    ${!library.brand.name && !library.brand.logo ? `
    <button class="card hint" data-action="open-settings">
      <b>${t('setup.hintTitle')}</b>
      <small>${t('setup.hintBody')}</small>
    </button>` : ''}
    <section class="card count-card">
      <p class="label">${t('setup.count')}</p>
      <div class="stepper big">
        <button class="icon-btn" data-action="count-inc" aria-label="${t('a11y.more')}" ${n >= MAX_PLAYERS ? 'disabled' : ''}>+</button>
        <b>${num(n)}</b>
        <button class="icon-btn" data-action="count-dec" aria-label="${t('a11y.less')}" ${n <= MIN_PLAYERS ? 'disabled' : ''}>−</button>
      </div>
    </section>
    <p class="label">${t('setup.pick')}</p>
    <ul class="list">
      ${fit.map((o) => `
        <li><button class="item scenario-item ${state.scenarioId === o.id ? 'on' : ''}" data-action="pick-scenario" data-id="${o.id}">
          <span class="grow"><b>${esc(o.name)}</b><small>${esc(o.note)}</small></span><span class="go">${arrowNext()}</span>
        </button></li>`).join('')}
    </ul>
    ${minMore.length ? `<p class="muted small-text center">${t('setup.more', { n: more.length, min: Math.min(...minMore) })}</p>` : ''}
  </main>`;
}

function viewPlayers() {
  const n = state.names.length;
  const need = state.playerCount;
  const status = n === need
    ? t('players.ready', { n })
    : n < need
      ? t('players.need', { n, need, left: need - n })
      : t('players.over', { n, need, extra: n - need });
  return `${header(t('players.title'), 'to-setup')}
  <main class="pad">
    <p class="muted small-text">${t('players.scenario', { name: `<b>${esc(scenarioName(state.scenarioId))}</b>`, n: need })}</p>
    <form class="row" data-form="add-name">
      <input id="name-input" name="name" maxlength="24" autocomplete="off" placeholder="${t('players.placeholder')}" aria-label="${t('players.placeholder')}" ${n >= need ? 'disabled' : ''}>
      <button class="btn primary" type="submit" ${n >= need ? 'disabled' : ''}>${t('players.add')}</button>
    </form>
    <p class="${n > need ? 'error' : 'muted'}">${status} ${t('players.saved')}</p>
    <ol class="list">
      ${state.names.map((nm, i) => `
        <li class="item"><span class="num">${num(i + 1)}</span><span class="grow">${esc(nm)}</span>
        <button class="icon-btn small" data-action="remove-name" data-i="${i}" aria-label="${t('a11y.remove', { name: esc(nm) })}">✕</button></li>`).join('')}
    </ol>
    ${n ? `<button class="btn ghost small" data-action="clear-names">${t('players.clear')}</button>` : ''}
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="to-roles" ${n !== need ? 'disabled' : ''}>${t('players.next')}</button>
  </footer>`;
}

function scenarioCard() {
  return `
  <section class="card">
    <div class="row between">
      <p class="label">${t('roles.scenario', { name: `<b>${esc(scenarioName(state.scenarioId))}</b>` })}</p>
      <button class="btn ghost small" data-action="to-setup">${t('roles.change')}</button>
    </div>
    ${scenarioNote()}
  </section>`;
}
function scenarioNote() {
  const id = state.scenarioId || '';
  if (id.startsWith('b:')) {
    const sc = ALL_SCENARIOS.find((x) => `b:${x.id}` === id);
    if (sc) {
      const diff = state.names.length !== sc.players ? t('roles.diff', { n: state.names.length }) : '';
      return `<p class="muted small-text">${t('roles.deckNote', { summary: esc(t(`sc.${sc.id}.summary`)), n: sc.players, diff })}</p>`;
    }
  }
  if (id.startsWith('my:')) return `<p class="muted small-text">${t('roles.mineNote')}</p>`;
  return '';
}

function roleRow(r, count) {
  const role = roleOf(r);
  const tag = role.kind && role.kind !== r ? `<em class="tag">${t(`kind.${role.kind}`)}</em>`
    : (!role.kind && role.night ? `<em class="tag">${t('roles.tagManual')}</em>` : '');
  return `
  <li class="item role-row ${role.team}">
    <span class="ricon">${role.icon}</span>
    <span class="grow"><b>${esc(role.name)}</b>${tag}<small>${esc(role.desc)}</small></span>
    <span class="stepper">
      <button class="icon-btn small" data-action="inc" data-role="${r}" aria-label="${t('a11y.inc')}">+</button>
      <b>${num(count)}</b>
      <button class="icon-btn small" data-action="dec" data-role="${r}" aria-label="${t('a11y.dec')}">−</button>
    </span>
  </li>`;
}

function viewRoles() {
  const n = state.names.length;
  const c = state.counts;
  const { mafia, town, total } = teamCounts(c);
  const error = validateSetup(n, c);
  const ids = allRoleIds();
  const sid = (state.scenarioId || '').startsWith('b:') ? state.scenarioId.slice(2) : null;
  const rank = (r) => (r === 'citizen' ? 9 : { mafia: 0, town: 1, indep: 2 }[roleOf(r).team]);
  const used = ids.filter((r) => (c[r] || 0) > 0 || r === 'citizen').sort((x, y) => rank(x) - rank(y));
  // Other scenarios' roles stay out of the list; your own roles are always offered.
  const rest = ids.filter((r) => !used.includes(r) && (!ROLES[r].scenario || ROLES[r].scenario === sid));
  return `${header(t('roles.title'), 'to-players')}
  <main class="pad">
    ${scenarioCard()}
    <div class="summary">
      <span class="chip mafia">${t('roles.chipMafia', { n: mafia })}</span>
      <span class="chip town">${t('roles.chipTown', { n: town })}</span>
      <span class="chip">${t('roles.chipTotal', { n: total, total: n })}</span>
    </div>
    <ul class="list">${used.map((r) => roleRow(r, c[r] || 0)).join('')}</ul>
    ${error ? `<p class="error">${errorText(error)}</p>` : ''}
    <details class="log">
      <summary>${t('roles.more', { n: rest.length })}</summary>
      <ul class="list more-roles">${rest.map((r) => roleRow(r, 0)).join('')}</ul>
    </details>
    <div class="row wrap">
      <button class="btn ghost small" data-action="new-role">${t('roles.new')}</button>
      <button class="btn ghost small" data-action="save-scenario">${t('roles.save')}</button>
    </div>
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="deal" ${error ? 'disabled' : ''}>${t('roles.deal')}</button>
  </footer>`;
}

function viewRoleEdit() {
  const d = state.editRole;
  const teamBtn = (team) => `<button type="button" class="chip-btn ${d.team === team ? 'on' : ''}" data-action="edit-team" data-team="${team}">${t(`team.${team}`)}</button>`;
  return `${header(d.isNew ? t('edit.new') : t('edit.edit'), 'role-edit-back', '<span></span>')}
  <main class="pad">
    <form class="form" data-form="role">
      <label>${t('edit.name')}<input name="name" maxlength="24" required value="${esc(d.name)}" placeholder="${t('edit.namePh')}"></label>
      <label>${t('edit.icon')}<input name="icon" maxlength="4" value="${esc(d.icon)}" placeholder="🎴"></label>
      <div><p class="label">${t('edit.team')}</p><div class="presets">${TEAM_IDS.map(teamBtn).join('')}</div>
        ${d.team === 'indep' ? `<small class="muted">${t('edit.indepNote')}</small>` : ''}</div>
      <label>${t('edit.desc')}<textarea name="desc" maxlength="200" rows="3" placeholder="${t('edit.descPh')}">${esc(d.desc)}</textarea></label>
      <label>${t('edit.kind')}
        <select name="kind">
          <option value="" ${!d.kind ? 'selected' : ''}>${t('edit.kindNone')}</option>
          ${UNIQUE_KINDS.map((k) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${t(`kind.${k}`)}</option>`).join('')}
        </select>
      </label>
      ${!d.kind ? `<label class="check"><input type="checkbox" name="night" ${d.night ? 'checked' : ''}> ${t('edit.night')}</label>` : ''}
      ${d.team === 'mafia' && d.kind !== 'godfather' ? `<label class="check"><input type="checkbox" name="detNeg" ${d.detNeg ? 'checked' : ''}> ${t('edit.detNeg')}</label>` : ''}
      ${d.team !== 'mafia' ? `<label class="check"><input type="checkbox" name="detPos" ${d.detPos ? 'checked' : ''}> ${t('edit.detPos')}</label>` : ''}
      <label class="check"><input type="checkbox" name="immune" ${d.immune ? 'checked' : ''}> ${t('edit.immune')}</label>
      <button class="btn primary block" type="submit">${t('edit.save')}</button>
      ${!d.isNew ? `<button type="button" class="btn ghost small danger-text" data-action="delete-role">${t('edit.delete')}</button>` : ''}
    </form>
  </main>`;
}

function statsCard() {
  const c = recentCounts(stats);
  const medals = medalProgress(stats, library);
  const won = medals.filter((m) => m.percent >= 100).length;
  return `
  <section class="card">
    <p class="label">🏅 ${t('stats.title')}</p>
    <div class="stat-row">
      <div><b>${num(c.week)}</b><small>${t('stats.week')}</small></div>
      <div><b>${num(c.month)}</b><small>${t('stats.month')}</small></div>
      <div><b>${num(c.total)}</b><small>${t('stats.total')}</small></div>
    </div>
    <p class="muted small-text">${t('stats.note')}</p>
    <details class="medals">
      <summary>${t('stats.medals', { n: won, total: MEDALS.length })}</summary>
      <ul class="medal-list">
        ${medals.map((m) => `
          <li class="${m.percent >= 100 ? 'won' : ''}">
            <span class="medal-icon">${m.percent >= 100 ? '🏅' : '○'}</span>
            <span class="grow"><b>${t(`medal.${m.key}`)}</b><small>${t(`medal.${m.key}.desc`)}</small></span>
            ${m.percent < 100 ? `<small class="muted">${new Intl.NumberFormat(getLang(), { style: 'percent' }).format(m.percent / 100)}</small>` : ''}
          </li>`).join('')}
      </ul>
    </details>
    ${isIOSApp() ? `
    <div class="gc">
      <p class="label">🎮 ${t('gc.title')}</p>
      ${gc.authenticated
        ? `<p class="small-text">${t('gc.signedIn', { name: esc(gc.name) })}</p>
           <div class="row wrap">
             <button class="btn primary small" data-action="gc-show" data-view="leaderboards">${t('gc.leaderboards')}</button>
             <button class="btn ghost small" data-action="gc-show" data-view="achievements">${t('gc.achievements')}</button>
           </div>`
        : `<button class="btn primary small" data-action="gc-sign-in">${t('gc.signIn')}</button>`}
      <p class="muted small-text">${t('gc.note')}</p>
    </div>` : ''}
  </section>`;
}

function backupCard() {
  const b = backupState;
  const when = b?.savedAt
    ? new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(b.savedAt)) : '';
  return `
  <section class="card">
    <p class="label">☁️ ${t('backup.title')}</p>
    ${isIOSApp() ? `<p class="small-text">${t('backup.icloud')}</p>` : ''}
    ${isAndroidApp() ? `<p class="small-text">${t('backup.android')}</p>` : ''}
    <p class="muted small-text">${t('backup.codeIntro')}</p>
    ${b?.code ? `
      <p class="label">${t('backup.yourCode')}</p>
      <div class="code-box" dir="ltr">${backup.formatCode(b.code)}</div>
      <p class="muted small-text">${t('backup.keep')}</p>
      <p class="small-text ${b.failed ? 'error' : 'muted'}">${backupBusy ? t('backup.working') : b.failed ? t('backup.failed') : when ? t('backup.savedAt', { when }) : ''}</p>
      <div class="row wrap">
        <button class="btn ghost small" data-action="backup-copy">${t('backup.copy')}</button>
        <button class="btn ghost small" data-action="backup-now" ${backupBusy ? 'disabled' : ''}>${t('backup.saveNow')}</button>
      </div>`
      : `<button class="btn primary small" data-action="backup-make" ${backupBusy ? 'disabled' : ''}>${backupBusy ? t('backup.working') : t('backup.make')}</button>`}
    <form class="form restore" data-form="restore">
      <label>${t('backup.restoreTitle')}<input name="code" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr" placeholder="${t('backup.restorePh')}"></label>
      <button class="btn ghost small" type="submit">${t('backup.restore')}</button>
    </form>
  </section>`;
}

function viewSettings() {
  const b = library.brand;
  return `${header(t('settings.title'), 'close-settings', '<span></span>')}
  <main class="pad">
    ${languagePicker()}

    <section class="card brand-card">
      <div class="brand-preview"><img src="${b.logo ? esc(b.logo) : 'icon.svg'}" alt=""></div>
      <form class="form" data-form="brand">
        <label>${t('settings.groupName')}<input name="name" maxlength="30" value="${esc(b.name)}" placeholder="${t('settings.groupPh')}"></label>
        <button class="btn primary small" type="submit">${t('settings.saveName')}</button>
      </form>
      <div class="row wrap">
        <label class="btn ghost small file-btn">${b.logo ? t('settings.changeLogo') : t('settings.pickLogo')}<input type="file" accept="image/*" data-input="logo" hidden></label>
        ${b.logo ? `<button class="btn ghost small" data-action="remove-logo">${t('settings.removeLogo')}</button>` : ''}
      </div>
      <p class="muted small-text">${t('settings.logoNote')}</p>
      <p class="label">${t('settings.color')}</p>
      <div class="swatches">
        ${COLORS.map((col) => `<button class="swatch ${(b.color || COLORS[0]).toLowerCase() === col.toLowerCase() ? 'on' : ''}" style="background:${col}" data-action="set-color" data-c="${col}" aria-label="${t('a11y.color', { c: col })}"></button>`).join('')}
      </div>
    </section>

    ${statsCard()}
    ${backupCard()}

    <section class="card">
      <p class="label">${t('settings.myScenarios')}</p>
      ${library.scenarios.length ? `<ul class="list">${library.scenarios.map((sc) => `
        <li class="item"><span class="grow"><b>${esc(sc.name)}</b>
          <small class="muted">${joinList(Object.entries(sc.roles).filter(([r]) => r !== 'citizen' && ROLES[r]).map(([r, k]) => `${esc(roleOf(r).name)}${k > 1 ? ` ×${num(k)}` : ''}`))} ${t('settings.plusCitizens')}</small></span>
          <button class="icon-btn small" data-action="rename-scenario" data-id="${sc.id}" aria-label="${t('a11y.rename')}">✎</button>
          <button class="icon-btn small" data-action="delete-scenario" data-id="${sc.id}" aria-label="${t('a11y.delete')}">✕</button></li>`).join('')}</ul>`
        : `<p class="muted small-text">${t('settings.noScenarios')}</p>`}
    </section>

    <section class="card">
      <p class="label">${t('settings.myRoles')}</p>
      ${library.roles.length ? `<ul class="list">${library.roles.map((d) => `
        <li class="item role-row ${d.team}"><span class="ricon">${esc(d.icon || '🎴')}</span>
          <span class="grow"><b>${esc(d.name)}</b><small>${t(`team.${d.team}`)}</small></span>
          <button class="icon-btn small" data-action="edit-role" data-id="${d.id}" aria-label="${t('a11y.edit')}">✎</button></li>`).join('')}</ul>`
        : `<p class="muted small-text">${t('settings.noRoles')}</p>`}
      <button class="btn ghost small" data-action="new-role">${t('roles.new')}</button>
    </section>
    <p class="muted small-text center">${t('settings.local')}</p>
  </main>`;
}

function viewReveal() {
  if (state.revealId) {
    const p = byId(state.revealId);
    if (!state.revealOpen) {
      return `
      <main class="reveal card-back">
        <button class="back-face" data-action="flip-role">
          <span class="back-logo"><img src="${library.brand.logo ? esc(library.brand.logo) : 'icon.svg'}" alt=""></span>
          <b class="back-brand">${esc(brandName())}</b>
          <span class="back-name">${esc(p.name)}</span>
          <small>${t('reveal.tap')}</small>
        </button>
        <button class="btn ghost" data-action="cancel-reveal">${t('reveal.notMe')}</button>
      </main>`;
    }
    const r = roleOf(p.role);
    const mates = state.players.filter((q) => q.id !== p.id && teamOf(q.role) === 'mafia');
    return `
    <main class="reveal ${r.team}">
      <p class="mini-brand">${logoHtml('mini')}<span>${esc(brandName())}</span></p>
      <p class="muted">${esc(p.name)}</p>
      <div class="big-icon">${r.icon}</div>
      <h2>${esc(r.name)}</h2>
      <p class="team-label">${t(`team.${r.team}`)}</p>
      <p class="desc">${esc(r.desc)}</p>
      ${r.team === 'mafia' ? `<p class="desc">${t('reveal.mates', { list: joinList(mates.map((q) => `${esc(q.name)} (${esc(roleOf(q.role).name)})`)) || '—' })}</p>` : ''}
      <button class="btn primary block" data-action="hide-role">${t('reveal.hide')}</button>
    </main>`;
  }
  const allSeen = state.players.every((p) => p.seen);
  return `${header(t('reveal.title'), 'to-roles-confirm')}
  <main class="pad">
    <p class="muted">${t('reveal.help')}</p>
    <ul class="grid-names">
      ${state.players.map((p) => `
        <li><button class="name-card ${p.seen ? 'seen' : ''}" data-action="reveal" data-id="${p.id}">
          ${esc(p.name)}<small>${p.seen ? t('reveal.seen') : t('reveal.tapToSee')}</small></button></li>`).join('')}
    </ul>
  </main>
  <footer class="dock">
    <button class="btn ${allSeen ? 'primary' : 'ghost'} block" data-action="start-game">${allSeen ? t('reveal.start') : t('reveal.startNotAll')}</button>
  </footer>`;
}

function playerRow(p) {
  const r = roleOf(p.role);
  const roleTxt = state.showRoles || !p.alive ? `<small class="${r.team}">${roleLabel(p.role)}</small>` : '';
  const death = p.death ? `<small class="muted">${cause(p.death.cause)} · ${num(p.death.round)}</small>` : '';
  const votes = state.votes[p.id] || 0;
  const open = state.menuId === p.id;
  const v = state.vote;
  const accused = v?.accused?.includes(p.id);
  const canVote = p.alive && state.phase === 'day' && (!v || (v.stage === 'final' && accused));
  return `
  <li class="item player ${p.alive ? '' : 'dead'}">
    <button class="grow plain" data-action="menu" data-id="${p.id}">
      <b>${esc(p.name)}</b>${accused ? ` <em class="tag accused">${t('vote.accused')}</em>` : ''}${roleTxt}${death}
    </button>
    ${canVote ? `
      <span class="stepper">
        <button class="icon-btn small" data-action="vote-inc" data-id="${p.id}" aria-label="${t('a11y.voteInc')}">+</button>
        <b class="votes ${!v && votes >= voteThreshold(state.players) ? 'hot' : ''}">${num(votes)}</b>
        <button class="icon-btn small" data-action="vote-dec" data-id="${p.id}" aria-label="${t('a11y.voteDec')}">−</button>
      </span>` : ''}
  </li>
  ${open ? `
  <li class="menu">
    ${p.alive
      ? `${state.phase === 'day' ? `<button class="btn danger small" data-action="vote-out" data-id="${p.id}">${t('game.voteOut')}</button>` : ''}
         <button class="btn ghost small" data-action="kill" data-id="${p.id}">${t('game.kill')}</button>`
      : `<button class="btn ghost small" data-action="revive" data-id="${p.id}">${t('game.revive')}</button>`}
    <button class="btn ghost small" data-action="menu" data-id="${p.id}">${t('game.close')}</button>
  </li>` : ''}`;
}

function viewGame() {
  const alive = state.players.filter((p) => p.alive);
  const mafia = alive.filter((p) => teamOf(p.role) === 'mafia').length;
  const town = alive.length - mafia;
  return `${header(phaseLabel())}
  <main class="pad">
    ${state.report && state.phase === 'day' ? morningCard() : ''}
    <section class="card">
      <div class="timer-row">
        <span id="timer-value" class="timer"></span>
        <button id="timer-toggle" class="btn primary small" data-action="timer-toggle">${t('timer.start')}</button>
        <button class="btn ghost small" data-action="timer-reset">${t('timer.reset')}</button>
      </div>
      <div class="presets">
        ${[30, 45, 60, 90, 120].map((s) => `<button class="chip-btn ${timer.total === s ? 'on' : ''}" data-action="timer-set" data-s="${s}">${t('timer.sec', { n: s })}</button>`).join('')}
      </div>
    </section>
    <div class="summary">
      <span class="chip">${t('game.alive', { n: alive.length })}</span>
      ${state.showRoles ? `<span class="chip mafia">${t('roles.chipMafia', { n: mafia })}</span><span class="chip town">${t('roles.chipTown', { n: town })}</span>` : ''}
      ${state.phase === 'day' ? `<span class="chip">${t('game.threshold', { n: voteThreshold(state.players) })}</span>` : ''}
      <button class="btn ghost small" data-action="toggle-roles">${state.showRoles ? t('game.hideRoles') : t('game.showRoles')}</button>
    </div>
    ${state.phase === 'day' ? voteCard() : ''}
    <ul class="list">${state.players.map(playerRow).join('')}</ul>
    ${state.phase === 'day' && Object.values(state.votes).some((x) => x > 0) ? `<button class="btn ghost small" data-action="clear-votes">${t('game.clearVotes')}</button>` : ''}
    ${state.log.length ? `<details class="log"><summary>${t('game.history', { n: state.log.length })}</summary><ul>${state.log.map(logText).map((l) => `<li><b>${l.at}:</b> ${l.text}</li>`).join('')}</ul></details>` : ''}
    <button class="btn ghost small danger-text" data-action="new-game">${t('game.newGame')}</button>
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="start-night">${t('game.startNight', { n: state.round })}</button>
  </footer>`;
}

/**
 * The day's vote, in two rounds: the first vote sends everyone at the
 * threshold to the defense; after their defense a final vote among them
 * decides who leaves, and a tie is the narrator's call.
 */
function voteCard() {
  const v = state.vote;
  const names = (ids) => joinList(ids.map((id) => `<b>${nameOf(id)}</b>`));
  let body;
  if (!v) {
    body = `<p class="muted small-text">${t('vote.first', { n: voteThreshold(state.players) })}</p>
      ${state.voteNote ? `<p class="small-text">${t(state.voteNote)}</p>` : ''}
      <button class="btn primary block" data-action="vote-submit">${t('vote.submit')}</button>`;
  } else if (v.stage === 'defense') {
    body = `<p>${t('vote.defense', { list: names(v.accused) })}</p>
      <p class="muted small-text">${t('vote.defenseHint')}</p>
      <button class="btn primary block" data-action="vote-final">${t('vote.startFinal')}</button>`;
  } else if (v.stage === 'final') {
    body = `<p class="muted small-text">${t('vote.final', { list: names(v.accused) })}</p>
      <button class="btn danger block" data-action="vote-final-submit">${t('vote.submitFinal')}</button>`;
  } else {
    body = `<p>${t('vote.tie', { list: names(v.tie) })}</p>
      <div class="row wrap">
        ${v.tie.map((id) => `<button class="btn danger small" data-action="vote-out" data-id="${id}">${t('vote.out', { name: nameOf(id) })}</button>`).join('')}
        <button class="btn ghost small" data-action="vote-nobody">${t('vote.nobody')}</button>
      </div>`;
  }
  return `
  <section class="card vote-card">
    <div class="row between">
      <p class="label">🗳️ ${t('vote.title')}</p>
      ${v ? `<button class="btn ghost small" data-action="vote-cancel">${t('vote.cancel')}</button>` : ''}
    </div>
    ${body}
  </section>`;
}

function morningCard() {
  const r = state.report;
  const lines = r.deaths.length
    ? r.deaths.map((d) => t('morning.died', { name: nameOf(d.id) })).join('<br>')
    : t('morning.none');
  const roleName = (pid) => esc(roleOf(byId(pid)?.role).name);
  const secret = [];
  for (const s of r.saves) secret.push(t('morning.saved', { name: nameOf(s.id), by: esc(stepName(s.by)) }));
  if (r.shieldUsed) secret.push(t('morning.shield', { role: roleName(r.shieldUsed), name: nameOf(r.shieldUsed) }));
  if (r.immuneHit) secret.push(t('morning.immune', { name: nameOf(r.immuneHit), role: roleName(r.immuneHit) }));
  if (r.sniperNoEffect) secret.push(t('morning.sniperNoEffect', { by: esc(stepName('sniper')), name: nameOf(r.sniperNoEffect) }));
  if (r.sniperBackfired) secret.push(t('morning.backfire', { by: esc(stepName('sniper')) }));
  for (const m of r.manual || []) secret.push(t('morning.manual', { role: esc(roleOf(m.role).name), name: nameOf(m.targetId) }));
  return `
  <section class="card announce">
    <p class="muted">${t('morning.read')}</p>
    <p class="big">${lines}</p>
    ${secret.length ? `<details><summary>${t('morning.secret')}</summary><p class="muted">${secret.join('<br>')}</p></details>` : ''}
    <button class="btn ghost small" data-action="dismiss-report">${t('morning.ok')}</button>
  </section>`;
}

function viewNight() {
  const n = state.night;
  const step = n.steps[n.index];
  if (!step) {
    return `${header(phaseLabel())}
    <main class="pad night-bg">
      <section class="card">
        <h2>${t('night.summary')}</h2>
        <ul class="plain-list">
          ${n.steps.map((s) => `<li>${esc(stepName(s))}: <b>${nameOf(n.actions[s])}</b></li>`).join('')}
        </ul>
      </section>
    </main>
    <footer class="dock">
      <button class="btn ghost" data-action="night-back">${t('night.back')}</button>
      <button class="btn primary grow" data-action="end-night">${t('night.morning')}</button>
    </footer>`;
  }
  const info = stepInfo(step);
  const name = stepName(step);
  const actors = actorsFor(step, state.players);
  const targets = targetsFor(step, state.players, state.memory);
  const chosen = n.actions[step] ?? null;
  const manual = !AUTO_STEPS.includes(step);
  let detective = '';
  if (step === 'detective' && chosen) {
    const positive = detectivePositive(byId(chosen).role);
    detective = `<p class="answer ${positive ? 'pos' : 'neg'}">${t('night.answer', { a: positive ? t('night.positive') : t('night.negative') })}</p>`;
  }
  return `${header(t('night.step', { phase: phaseLabel(), i: n.index + 1, n: n.steps.length }))}
  <main class="pad night-bg">
    <p class="muted">${t('night.eyes')}</p>
    <h2>${t('night.wake', { name: esc(name) })}</h2>
    <p class="muted">${joinList(actors.map((a) => `${esc(a.name)} (${esc(roleOf(a.role).name)})`))}</p>
    ${manual && roleOf(step).desc ? `<p class="card small-text">${esc(roleOf(step).desc)}</p>` : ''}
    <p>${info.ask}</p>
    <div class="targets">
      ${targets.map((p) => `<button class="target ${chosen === p.id ? 'on' : ''}" data-action="pick" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      <button class="target none ${n.actions[step] === null && n.touched[step] ? 'on' : ''}" data-action="pick" data-id="">${info.none}</button>
    </div>
    ${detective}
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="night-back">${n.index === 0 ? t('night.cancel') : t('night.prev')}</button>
    <button class="btn primary grow" data-action="night-next">${t('night.sleep', { name: esc(name) })} ${arrowNext()}</button>
  </footer>`;
}

function viewEnd() {
  const w = state.winner;
  return `${header(t('end.title'))}
  <main class="pad">
    <section class="card announce ${w === 'mafia' ? 'mafia' : 'town'}">
      <div class="big-icon">${w === 'mafia' ? '🔪' : '🏆'}</div>
      <h2>${w === 'mafia' ? t('end.mafia') : t('end.town')}</h2>
    </section>
    <ul class="list">
      ${state.players.map((p) => `
        <li class="item ${p.alive ? '' : 'dead'}"><span class="grow"><b>${esc(p.name)}</b>
        <small class="${roleOf(p.role).team}">${roleLabel(p.role)}</small></span>
        <small class="muted">${p.alive ? t('end.alive') : (p.death ? cause(p.death.cause) : '')}</small></li>`).join('')}
    </ul>
    <button class="btn ghost small" data-action="continue-anyway">${t('end.continue')}</button>
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="new-game-setup">${t('end.players')}</button>
    <button class="btn primary grow" data-action="rematch">${t('end.rematch')}</button>
  </footer>`;
}

let shownView = null;
function render() {
  const views = {
    setup: viewSetup, players: viewPlayers, roles: viewRoles, reveal: viewReveal, game: viewGame, night: viewNight,
    end: viewEnd, settings: viewSettings, 'role-edit': viewRoleEdit,
  };
  // Keep what the user is typing when something in the background re-renders.
  const typed = [...app.querySelectorAll('form[data-form] input[name]:not([type="file"]):not([type="checkbox"]), form[data-form] textarea[name]')]
    .filter((el) => el.value !== el.defaultValue)
    .map((el) => [`${el.form.dataset.form}/${el.name}`, el.value]);
  const focused = document.activeElement?.form ? `${document.activeElement.form.dataset.form}/${document.activeElement.name}` : null;
  app.innerHTML = (views[state.view] || viewSetup)();
  for (const [key, value] of typed) {
    const [form, name] = key.split('/');
    const el = app.querySelector(`form[data-form="${form}"] [name="${name}"]`);
    if (el) el.value = value;
  }
  if (focused) app.querySelector(`form[data-form="${focused.split('/')[0]}"] [name="${focused.split('/')[1]}"]`)?.focus();
  renderTimer();
  if (shownView !== state.view) window.scrollTo(0, 0);
  shownView = state.view;
  if (state.view === 'players') document.getElementById('name-input')?.focus();
}

// ---------- actions ----------

function startNewDeal() {
  // The game keeps its own copy of the extra roles it uses, so editing or
  // deleting a role in the settings never breaks a game in progress.
  state.roleDefs = Object.keys(state.counts)
    .filter((r) => state.counts[r] > 0 && ROLES[r] && !ROLE_ORDER.includes(r))
    .map((r) => ({ ...ROLES[r] }));
  state.players = dealRoles(state.names, state.counts);
  state.memory = {};
  state.round = 1;
  state.phase = 'day';
  state.night = null;
  state.report = null;
  state.votes = {};
  state.vote = null;
  state.voteNote = null;
  state.log = [];
  state.winner = null;
  state.revealId = null;
  state.revealOpen = false;
  state.menuId = null;
  state.showRoles = false;
  state.gameId = newId('g');
  state.view = 'reveal';
}

function scenarioCounts(id, n) {
  if (id.startsWith('my:')) {
    const sc = library.scenarios.find((x) => `my:${x.id}` === id);
    if (sc) return fitScenario(sc.roles, n);
  }
  if (id.startsWith('b:')) {
    const sc = ALL_SCENARIOS.find((x) => `b:${x.id}` === id);
    if (sc) return fitScenario(sc.roles, n);
  }
  return suggestRoles(n);
}

/** Changes a role's count; while the total matches the players, plain citizens make room or fill the gap. */
function changeCount(s, role, delta) {
  const before = s.counts[role] || 0;
  if (before + delta < 0) return;
  const balanced = teamCounts(s.counts).total === s.names.length;
  s.counts[role] = before + delta;
  if (role !== 'citizen' && balanced && (s.counts.citizen || 0) - delta >= 0) s.counts.citizen = (s.counts.citizen || 0) - delta;
}

function endVote(s) {
  s.vote = null;
  s.votes = {};
  s.voteNote = null;
}
function voteOut(s, id) {
  const p = s.players.find((x) => x.id === id);
  p.alive = false;
  p.death = { round: s.round, cause: 'vote' };
  s.menuId = null;
  endVote(s);
  addLog('voteOut', { pid: p.id, role: p.role });
  checkWin();
}

function openRoleEditor(def, from) {
  state.editRole = def
    ? { ...def, isNew: false }
    : { id: newId('c_'), name: '', icon: '', team: 'town', desc: '', kind: '', night: true, detNeg: false, isNew: true };
  state.editFrom = from;
  state.view = 'role-edit';
}

const actions = {
  undo,
  'gc-sign-in': () => signInGameCenter(),
  'gc-show': (el) => gameCenter.show(el.dataset.view).catch(() => {}),
  'backup-make': () => {
    backupState = { code: backup.newCode(), savedAt: 0, failed: false };
    runBackup().then(() => {
      if (backupState.failed) {
        backupState = null;
        writeJson(BACKUP_KEY, null);
        alert(t('backup.netError'));
        render();
      } else {
        alert(t('backup.auto'));
      }
    });
  },
  'backup-now': () => runBackup().then(() => backupState?.failed && alert(t('backup.netError'))),
  'backup-copy': () => {
    const text = backup.formatCode(backupState.code);
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => alert(t('backup.copied')), () => prompt(t('backup.yourCode'), text));
  },
  'set-lang': (el) => {
    setLang(el.dataset.lang, { remember: true });
    applyBrand();
    render();
  },
  'remove-name': (el) => update((s) => s.names.splice(Number(el.dataset.i), 1)),
  'clear-names': () => confirm(t('players.confirmClear')) && update((s) => { s.names = []; }),
  'to-setup': () => update((s) => { s.view = 'setup'; }),
  'count-inc': () => update((s) => { s.playerCount = Math.min(MAX_PLAYERS, s.playerCount + 1); }),
  'count-dec': () => update((s) => { s.playerCount = Math.max(MIN_PLAYERS, s.playerCount - 1); }),
  'pick-scenario': (el) => update((s) => {
    s.scenarioId = el.dataset.id;
    s.counts = scenarioCounts(el.dataset.id, s.playerCount);
    s.view = 'players';
  }),
  'to-roles': () => update((s) => {
    const n = s.names.length;
    if (!s.counts || teamCounts(s.counts).total !== n) s.counts = scenarioCounts(s.scenarioId || 'auto', n);
    s.view = 'roles';
  }),
  'to-players': () => update((s) => { s.view = 'players'; }),
  inc: (el) => update((s) => changeCount(s, el.dataset.role, +1)),
  dec: (el) => update((s) => changeCount(s, el.dataset.role, -1)),
  'save-scenario': () => {
    const cur = library.scenarios.find((x) => `my:${x.id}` === state.scenarioId);
    const name = prompt(t('roles.promptName'), cur?.name || '');
    if (!name || !name.trim()) return;
    const roles = Object.fromEntries(Object.entries(state.counts).filter(([r, c]) => c > 0 && r !== 'citizen'));
    const same = library.scenarios.find((x) => x.name === name.trim());
    if (same && !confirm(t('roles.confirmReplace', { name: name.trim() }))) return;
    const sc = { id: same?.id || newId('s'), name: name.trim(), roles };
    library.scenarios = same ? library.scenarios.map((x) => (x.id === same.id ? sc : x)) : [sc, ...library.scenarios];
    if (saveLibrary()) update((s) => { s.scenarioId = `my:${sc.id}`; });
  },
  'new-role': () => update((s) => openRoleEditor(null, s.view)),
  'edit-role': (el) => update((s) => openRoleEditor(library.roles.find((d) => d.id === el.dataset.id), s.view)),
  'edit-team': (el) => {
    readRoleForm();
    update((s) => { s.editRole.team = el.dataset.team; });
  },
  'role-edit-back': () => update((s) => { s.view = s.editFrom || 'roles'; s.editRole = null; }),
  'delete-role': () => {
    const d = state.editRole;
    if (!confirm(t('edit.confirmDelete', { name: d.name }))) return;
    library.roles = library.roles.filter((x) => x.id !== d.id);
    for (const sc of library.scenarios) delete sc.roles[d.id];
    saveLibrary();
    update((s) => {
      if (s.counts) delete s.counts[d.id];
      syncRoles();
      s.view = s.editFrom || 'settings';
      s.editRole = null;
    });
  },
  'open-settings': () => update((s) => { s.settingsFrom = s.view; s.view = 'settings'; }),
  'close-settings': () => update((s) => { s.view = s.settingsFrom && s.settingsFrom !== 'settings' ? s.settingsFrom : 'setup'; }),
  'remove-logo': () => {
    library.brand.logo = '';
    saveLibrary();
    render();
  },
  'set-color': (el) => {
    library.brand.color = el.dataset.c === COLORS[0] ? '' : el.dataset.c;
    saveLibrary();
    applyBrand();
    render();
  },
  'rename-scenario': (el) => {
    const sc = library.scenarios.find((x) => x.id === el.dataset.id);
    const name = sc && prompt(t('settings.promptRename'), sc.name);
    if (!name || !name.trim()) return;
    sc.name = name.trim();
    saveLibrary();
    render();
  },
  'delete-scenario': (el) => {
    const sc = library.scenarios.find((x) => x.id === el.dataset.id);
    if (!sc || !confirm(t('settings.confirmDeleteScenario', { name: sc.name }))) return;
    library.scenarios = library.scenarios.filter((x) => x.id !== sc.id);
    saveLibrary();
    update((s) => { if (s.scenarioId === `my:${sc.id}`) s.scenarioId = null; });
  },
  deal: () => update(startNewDeal),
  'to-roles-confirm': () => confirm(t('reveal.confirmRedeal')) && update((s) => { s.view = 'roles'; }),
  reveal: (el) => update((s) => { s.revealId = el.dataset.id; s.revealOpen = false; }),
  'flip-role': () => update((s) => { s.revealOpen = true; }),
  'cancel-reveal': () => update((s) => { s.revealId = null; s.revealOpen = false; }),
  'hide-role': () => update((s) => { byId(s.revealId).seen = true; s.revealId = null; s.revealOpen = false; }),
  'start-game': () => update((s) => { s.view = 'game'; addLog('start'); }),
  'toggle-roles': () => update((s) => { s.showRoles = !s.showRoles; }),
  menu: (el) => update((s) => { s.menuId = s.menuId === el.dataset.id ? null : el.dataset.id; }),
  'vote-inc': (el) => update((s) => {
    const max = s.players.filter((p) => p.alive).length;
    s.votes[el.dataset.id] = Math.min(max, (s.votes[el.dataset.id] || 0) + 1);
    s.voteNote = null;
  }),
  'vote-dec': (el) => update((s) => { s.votes[el.dataset.id] = Math.max(0, (s.votes[el.dataset.id] || 0) - 1); }),
  'clear-votes': () => update((s) => { s.votes = {}; }),
  'vote-out': (el) => update((s) => voteOut(s, el.dataset.id), { undoable: true }),
  'vote-submit': () => update((s) => {
    const accused = defenseList(s.players, s.votes);
    s.votes = {};
    s.menuId = null;
    if (!accused.length) {
      s.voteNote = 'vote.noneUp';
      addLog('voteNone');
      return;
    }
    s.voteNote = null;
    s.vote = { stage: 'defense', accused };
    addLog('defense', { pids: accused });
  }, { undoable: true }),
  'vote-final': () => update((s) => { s.vote.stage = 'final'; s.votes = {}; }),
  'vote-final-submit': () => update((s) => {
    const res = finalVote(s.vote.accused, s.votes);
    if (res.out) voteOut(s, res.out);
    else if (res.tie.length) s.vote = { ...s.vote, stage: 'tie', tie: res.tie };
    else {
      addLog('finalNone');
      endVote(s);
    }
  }, { undoable: true }),
  'vote-nobody': () => update((s) => { addLog('finalNone'); endVote(s); }, { undoable: true }),
  'vote-cancel': () => update((s) => endVote(s), { undoable: true }),
  kill: (el) => update((s) => {
    const p = byId(el.dataset.id);
    p.alive = false;
    p.death = { round: s.round, cause: 'manual' };
    s.menuId = null;
    addLog('kill', { pid: p.id });
    checkWin();
  }, { undoable: true }),
  revive: (el) => update((s) => {
    const p = byId(el.dataset.id);
    p.alive = true;
    p.death = null;
    s.menuId = null;
    addLog('revive', { pid: p.id });
  }, { undoable: true }),
  'dismiss-report': () => update((s) => { s.report = null; }),
  'start-night': () => update((s) => {
    stopTimer();
    s.phase = 'night';
    s.votes = {};
    s.menuId = null;
    s.report = null;
    endVote(s);
    s.night = { steps: nightSteps(s.players), index: 0, actions: {}, touched: {} };
    s.view = 'night';
  }, { undoable: true }),
  pick: (el) => update((s) => {
    const step = s.night.steps[s.night.index];
    s.night.actions[step] = el.dataset.id || null;
    s.night.touched[step] = true;
  }),
  'night-next': () => update((s) => { s.night.index += 1; }),
  'night-back': () => update((s) => {
    if (s.night.index === 0) { s.phase = 'day'; s.night = null; s.view = 'game'; return; }
    s.night.index -= 1;
  }),
  'end-night': () => update((s) => {
    const res = resolveNight(s.players, s.memory, s.night.actions, s.round);
    s.players = res.players;
    s.memory = res.memory;
    s.report = res.report;
    if (res.report.deaths.length) addLog('nightDeaths', { list: res.report.deaths.map((d) => d.id) });
    else addLog('nightNone');
    for (const m of res.report.manual) addLog('manual', { role: m.role, pid: m.targetId });
    s.night = null;
    s.phase = 'day';
    s.round += 1;
    s.view = 'game';
    checkWin();
  }, { undoable: true }),
  'continue-anyway': () => update((s) => { s.view = 'game'; s.winner = null; }),
  rematch: () => update(startNewDeal),
  'new-game-setup': () => update((s) => { s.view = 'setup'; }),
  'new-game': () => confirm(t('game.confirmNew')) && update((s) => { s.view = 'setup'; }),
  'timer-toggle': () => (timer.running ? stopTimer() : startTimer()),
  'timer-reset': () => setTimer(timer.total),
  'timer-set': (el) => { setTimer(Number(el.dataset.s)); render(); },
};

/** Copies the role form's inputs into state.editRole (before a re-render would drop them). */
function readRoleForm() {
  const f = app.querySelector('form[data-form="role"]');
  if (!f || !state.editRole) return;
  const d = state.editRole;
  d.name = f.elements.name.value;
  d.icon = f.elements.icon.value;
  d.desc = f.elements.desc.value;
  d.kind = f.elements.kind.value;
  if (f.elements.night) d.night = f.elements.night.checked;
  if (f.elements.detNeg) d.detNeg = f.elements.detNeg.checked;
  if (f.elements.detPos) d.detPos = f.elements.detPos.checked;
  d.immune = f.elements.immune.checked;
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

app.addEventListener('change', async (e) => {
  if (e.target.dataset.input === 'logo') {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const logo = await readLogo(file);
      const old = library.brand.logo;
      library.brand.logo = logo;
      if (!saveLibrary()) library.brand.logo = old;
    } catch {
      alert(t('err.badImage'));
    }
    render();
  } else if (e.target.name === 'kind' && e.target.closest('form[data-form="role"]')) {
    readRoleForm();
    render();
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.dataset.form;
  if (form === 'brand') {
    library.brand.name = e.target.elements.name.value.trim().replace(/\s+/g, ' ');
    saveLibrary();
    applyBrand();
    render();
    return;
  }
  if (form === 'restore') {
    const code = backup.normalizeCode(e.target.elements.code.value);
    if (!code) { alert(t('backup.badCode')); return; }
    backup.download(code).then((data) => {
      if (!data?.library) { alert(t('backup.notFound')); return; }
      if (!confirm(t('backup.confirmRestore'))) return;
      library = normalizeLibrary(data.library);
      backupState = { code, savedAt: Date.now(), failed: false };
      writeJson(BACKUP_KEY, backupState);
      saveLibrary();
      syncRoles();
      applyBrand();
      render();
      alert(t('backup.restored'));
    }, () => alert(t('backup.netError')));
    return;
  }
  if (form === 'role') {
    readRoleForm();
    const d = state.editRole;
    const name = d.name.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if ([...ROLE_ORDER, ...library.roles.map((x) => x.id)].some((r) => r !== d.id && ROLES[r] && roleOf(r).name === name)) { alert(t('edit.dup')); return; }
    const def = {
      id: d.id, name, icon: d.icon.trim() || (d.team === 'mafia' ? '🃏' : '🎴'), team: d.team,
      desc: d.desc.trim(), kind: d.kind || null, night: !d.kind && !!d.night, detNeg: d.team === 'mafia' && !!d.detNeg,
      detPos: d.team !== 'mafia' && !!d.detPos, immune: !!d.immune,
    };
    library.roles = d.isNew ? [...library.roles, def] : library.roles.map((x) => (x.id === def.id ? def : x));
    if (!saveLibrary()) return;
    update((s) => {
      syncRoles();
      if (d.isNew && s.editFrom === 'roles' && s.counts) changeCount(s, def.id, +1);
      s.view = s.editFrom || 'roles';
      s.editRole = null;
    });
    return;
  }
  if (form !== 'add-name') return;
  const input = e.target.elements.name;
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (state.names.includes(name)) { alert(t('players.dup')); return; }
  if (state.names.length >= state.playerCount) return;
  update((s) => s.names.push(name));
});

render();

if (isIOSApp()) {
  signInGameCenter();
  pullICloud();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullICloud(); });
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
