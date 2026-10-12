import {
  ROLES, ROLE_ORDER, MIN_PLAYERS, MAX_PLAYERS, UNIQUE_KINDS, KIND_LABEL, TEAMS,
  suggestRoles, fitScenario, minPlayersFor, teamCounts, validateSetup, dealRoles, nightSteps, actorsFor, targetsFor,
  resolveNight, winner, voteThreshold, teamOf, detectivePositive, setExtraRoles, allRoleIds, toFa,
} from './logic.js';
import { SCENARIOS, SCENARIO_ROLES } from './scenarios.js';

const STORE_KEY = 'mafia-tool-v1';
const NAMES_KEY = 'mafia-tool-names';
const LIB_KEY = 'mafia-tool-library';

const DEFAULT_BRAND = 'گاد مافیا';
const COLORS = ['#7C5CFC', '#E5484D', '#F76B15', '#FFB224', '#30A46C', '#0091FF', '#D6409F', '#8D8D99'];

// ---------- library: the group's brand, own roles and saved scenarios (kept on this phone) ----------

function loadLibrary() {
  let lib = null;
  try { lib = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); } catch { /* ignore */ }
  return {
    brand: { name: '', logo: '', color: '', ...(lib?.brand || {}) },
    roles: Array.isArray(lib?.roles) ? lib.roles : [],
    scenarios: Array.isArray(lib?.scenarios) ? lib.scenarios : [],
  };
}
let library = loadLibrary();
function saveLibrary() {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(library));
    return true;
  } catch {
    alert('حافظه‌ی مرورگر پر است یا در دسترس نیست؛ تغییر ذخیره نشد. لوگوی کوچک‌تری امتحان کنید.');
    return false;
  }
}

/** Registers every role the tool can show: scenario roles, the group's roles, and the roles of the running game. */
function syncRoles() {
  const byId = new Map();
  for (const d of [...SCENARIO_ROLES, ...library.roles, ...(state?.roleDefs || [])]) byId.set(d.id, d);
  setExtraRoles([...byId.values()]);
}

const roleOf = (id) => ROLES[id] || { id, name: '؟', team: 'town', icon: '❔', desc: '', kind: null, night: false };
const brandName = () => library.brand.name.trim() || DEFAULT_BRAND;

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
  document.title = library.brand.name.trim() ? `${library.brand.name.trim()} | گاد مافیا` : 'گاد مافیا | اسپادنا';
}

function logoHtml(cls = 'logo') {
  return library.brand.logo
    ? `<img class="${cls}-img" src="${esc(library.brand.logo)}" alt="">`
    : `<span class="${cls}">🕵️</span>`;
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

const STEP_ASK = {
  mafia: { ask: 'پدرخوانده (یا مافیا) چه کسی را می‌زند؟', none: 'شلیک نمی‌کنند' },
  lecter: { ask: 'کدام عضو مافیا را نجات می‌دهد؟', none: 'کسی را نجات نمی‌دهد' },
  doctor: { ask: 'چه کسی را نجات می‌دهد؟', none: 'کسی را نجات نمی‌دهد' },
  detective: { ask: 'از چه کسی استعلام می‌گیرد؟', none: 'استعلام نمی‌گیرد' },
  sniper: { ask: 'به چه کسی شلیک می‌کند؟', none: 'شلیک نمی‌کند' },
};

/** Name of a night step: the team for the mafia step, else the role that wakes (as named in this game). */
function stepName(step) {
  if (step === 'mafia') return 'تیم مافیا';
  if (ROLES[step] && !STEP_ASK[step]) return roleOf(step).name;
  const actor = actorsFor(step, state.players)[0];
  return actor ? roleOf(actor.role).name : roleOf(step).name;
}
function stepInfo(step) {
  return STEP_ASK[step] || { ask: 'کار شبانه‌اش روی چه کسی است؟ (اثرش را خودتان اعمال کنید)', none: 'کاری نمی‌کند' };
}

const CAUSE = { night: 'شلیک شب', sniper: 'تیر اسنایپر', vote: 'رأی روز', manual: 'حذف دستی' };

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
const nameOf = (id) => (id ? esc(byId(id)?.name ?? '؟') : '—');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const phaseLabel = () => `${state.phase === 'day' ? 'روز' : 'شب'} ${toFa(state.round)}`;

function addLog(text) {
  state.log.unshift({ at: phaseLabel(), text });
}
function checkWin() {
  const w = winner(state.players);
  if (w) {
    state.winner = w;
    state.view = 'end';
    addLog(w === 'mafia' ? 'مافیا برنده شد.' : 'شهروندان برنده شدند.');
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
  el.textContent = toFa(`${m}:${s}`);
  el.classList.toggle('warn', timer.left <= 10 && timer.left > 0);
  el.classList.toggle('done', timer.left === 0);
  const btn = document.getElementById('timer-toggle');
  if (btn) btn.textContent = timer.running ? 'توقف' : 'شروع';
}

// ---------- views ----------

const app = document.getElementById('app');

const roleLabel = (id) => `${roleOf(id).icon} ${esc(roleOf(id).name)}`;

function header(title, back, end) {
  const right = end
    ?? (undoStack.length && !['setup', 'players', 'settings', 'role-edit'].includes(state.view)
      ? '<button class="icon-btn" data-action="undo" aria-label="برگرداندن آخرین کار">↶</button>'
      : '<span></span>');
  return `
  <header class="bar">
    ${back ? `<button class="icon-btn" data-action="${back}" aria-label="بازگشت">→</button>` : logoHtml()}
    <h1><small class="brand-name">${esc(brandName())}</small>${title}</h1>
    ${right}
  </header>`;
}

/** Scenarios to offer for n players: { id, name, note, min }, playable ones only. */
function scenarioOptions(n) {
  const all = [
    { id: 'auto', name: 'پیشنهاد خودکار', note: 'ترکیب ساده‌ی پدرخوانده، دکتر و کارآگاه؛ برای هر تعداد بازیکن.', min: MIN_PLAYERS },
    ...library.scenarios.map((sc) => ({ id: `my:${sc.id}`, name: `⭐ ${sc.name}`, note: 'سناریوی ذخیره‌شده‌ی خودتان', min: minPlayersFor(sc.roles) })),
    ...SCENARIOS.map((sc) => ({ id: `b:${sc.id}`, name: sc.name, note: `${sc.summary} (دک استاندارد ${toFa(sc.players)} نفر)`, min: minPlayersFor(sc.roles) })),
  ];
  return { fit: all.filter((o) => o.min && o.min <= n), more: all.filter((o) => !o.min || o.min > n) };
}
function scenarioName(id) {
  if (!id || id === 'auto') return 'پیشنهاد خودکار';
  if (id.startsWith('my:')) return library.scenarios.find((x) => `my:${x.id}` === id)?.name || 'سناریوی من';
  return SCENARIOS.find((x) => `b:${x.id}` === id)?.name || '';
}

function viewSetup() {
  const n = state.playerCount;
  const { fit, more } = scenarioOptions(n);
  const gear = '<button class="icon-btn" data-action="open-settings" aria-label="تنظیمات گروه">⚙︎</button>';
  const minMore = more.filter((o) => o.min).map((o) => o.min);
  return `${header('شروع بازی', null, gear)}
  <main class="pad">
    ${!library.brand.name && !library.brand.logo ? `
    <button class="card hint" data-action="open-settings">
      <b>شخصی‌ساز اپ مافیا برای ایونت خودتان</b>
      <small>اسم و لوگوی گروه، رنگ، نقش‌ها و سناریوهای خودتان را در تنظیمات بگذارید.</small>
    </button>` : ''}
    <section class="card count-card">
      <p class="label">چند نفرید؟</p>
      <div class="stepper big">
        <button class="icon-btn" data-action="count-inc" aria-label="یک نفر بیشتر" ${n >= MAX_PLAYERS ? 'disabled' : ''}>+</button>
        <b>${toFa(n)}</b>
        <button class="icon-btn" data-action="count-dec" aria-label="یک نفر کمتر" ${n <= MIN_PLAYERS ? 'disabled' : ''}>−</button>
      </div>
    </section>
    <p class="label">سناریو را انتخاب کنید</p>
    <ul class="list">
      ${fit.map((o) => `
        <li><button class="item scenario-item ${state.scenarioId === o.id ? 'on' : ''}" data-action="pick-scenario" data-id="${o.id}">
          <span class="grow"><b>${esc(o.name)}</b><small>${esc(o.note)}</small></span><span class="go">←</span>
        </button></li>`).join('')}
    </ul>
    ${minMore.length ? `<p class="muted small-text center">${toFa(more.length)} سناریوی دیگر از ${toFa(Math.min(...minMore))} نفر به بالا باز می‌شود.</p>` : ''}
  </main>`;
}

function viewPlayers() {
  const n = state.names.length;
  const need = state.playerCount;
  const status = n === need
    ? `${toFa(n)} بازیکن · آماده‌اید.`
    : n < need
      ? `${toFa(n)} از ${toFa(need)} اسم وارد شده؛ ${toFa(need - n)} اسم دیگر لازم است.`
      : `${toFa(n)} اسم دارید ولی ${toFa(need)} نفرید؛ ${toFa(n - need)} اسم را حذف کنید یا برگردید و تعداد را عوض کنید.`;
  return `${header('بازیکن‌ها', 'to-setup')}
  <main class="pad">
    <p class="muted small-text">سناریو: <b>${esc(scenarioName(state.scenarioId))}</b> · ${toFa(need)} نفر</p>
    <form class="row" data-form="add-name">
      <input id="name-input" name="name" maxlength="24" autocomplete="off" placeholder="اسم بازیکن" aria-label="اسم بازیکن" ${n >= need ? 'disabled' : ''}>
      <button class="btn primary" type="submit" ${n >= need ? 'disabled' : ''}>افزودن</button>
    </form>
    <p class="${n > need ? 'error' : 'muted'}">${status} اسم‌ها برای دفعه‌ی بعد ذخیره می‌شوند.</p>
    <ol class="list">
      ${state.names.map((nm, i) => `
        <li class="item"><span class="num">${toFa(i + 1)}</span><span class="grow">${esc(nm)}</span>
        <button class="icon-btn small" data-action="remove-name" data-i="${i}" aria-label="حذف ${esc(nm)}">✕</button></li>`).join('')}
    </ol>
    ${n ? '<button class="btn ghost small" data-action="clear-names">پاک کردن همه</button>' : ''}
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="to-roles" ${n !== need ? 'disabled' : ''}>ادامه: نقش‌ها</button>
  </footer>`;
}

function scenarioCard() {
  return `
  <section class="card">
    <div class="row between">
      <p class="label">سناریو: <b>${esc(scenarioName(state.scenarioId))}</b></p>
      <button class="btn ghost small" data-action="to-setup">تغییر سناریو</button>
    </div>
    ${scenarioNote()}
  </section>`;
}
function scenarioNote() {
  const id = state.scenarioId || '';
  if (id.startsWith('b:')) {
    const sc = SCENARIOS.find((x) => `b:${x.id}` === id);
    if (sc) {
      const diff = state.names.length !== sc.players
        ? ` شما ${toFa(state.names.length)} نفرید؛ شهروند ساده کم و زیاد شد، بقیه را خودتان تنظیم کنید.` : '';
      return `<p class="muted small-text">${esc(sc.summary)} (دک استاندارد: ${toFa(sc.players)} نفر.${diff})</p>`;
    }
  }
  if (id.startsWith('my:')) {
    return `<p class="muted small-text">سناریوی ذخیره‌شده‌ی خودتان. هر تغییری بدهید فقط برای همین بازی است؛ برای نگه داشتنش دوباره ذخیره کنید.</p>`;
  }
  return '';
}

function roleRow(r, count) {
  const role = roleOf(r);
  const tag = role.kind && role.kind !== r ? `<em class="tag">${esc(KIND_LABEL[role.kind] || '')}</em>`
    : (!role.kind && role.night ? '<em class="tag">شب بیدار می‌شود · اجرای دستی</em>' : '');
  return `
  <li class="item role-row ${role.team}">
    <span class="ricon">${role.icon}</span>
    <span class="grow"><b>${esc(role.name)}</b>${tag}<small>${esc(role.desc)}</small></span>
    <span class="stepper">
      <button class="icon-btn small" data-action="inc" data-role="${r}" aria-label="زیاد کردن">+</button>
      <b>${toFa(count)}</b>
      <button class="icon-btn small" data-action="dec" data-role="${r}" aria-label="کم کردن">−</button>
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
  return `${header('نقش‌ها', 'to-players')}
  <main class="pad">
    ${scenarioCard()}
    <div class="summary">
      <span class="chip mafia">مافیا ${toFa(mafia)}</span>
      <span class="chip town">شهر ${toFa(town)}</span>
      <span class="chip">${toFa(total)} از ${toFa(n)}</span>
    </div>
    <ul class="list">${used.map((r) => roleRow(r, c[r] || 0)).join('')}</ul>
    ${error ? `<p class="error">${error}</p>` : ''}
    <details class="log">
      <summary>افزودن نقش دیگر (${toFa(rest.length)})</summary>
      <ul class="list more-roles">${rest.map((r) => roleRow(r, 0)).join('')}</ul>
    </details>
    <div class="row wrap">
      <button class="btn ghost small" data-action="new-role">＋ ساخت نقش جدید</button>
      <button class="btn ghost small" data-action="save-scenario">⭐ ذخیره به‌عنوان سناریو</button>
    </div>
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="deal" ${error ? 'disabled' : ''}>پخش تصادفی نقش‌ها</button>
  </footer>`;
}

function viewRoleEdit() {
  const d = state.editRole;
  const teamBtn = (t) => `<button type="button" class="chip-btn ${d.team === t ? 'on' : ''}" data-action="edit-team" data-team="${t}">${TEAMS[t]}</button>`;
  return `${header(d.isNew ? 'نقش جدید' : 'ویرایش نقش', 'role-edit-back', '<span></span>')}
  <main class="pad">
    <form class="form" data-form="role">
      <label>اسم نقش<input name="name" maxlength="24" required value="${esc(d.name)}" placeholder="مثلاً: بازپرس"></label>
      <label>شکلک (ایموجی)<input name="icon" maxlength="4" value="${esc(d.icon)}" placeholder="🎴"></label>
      <div><p class="label">تیم</p><div class="presets">${teamBtn('mafia')}${teamBtn('town')}${teamBtn('indep')}</div>
        ${d.team === 'indep' ? '<small class="muted">نقش مستقل در شمارش برد کنار شهر حساب می‌شود؛ برد خودش را شما اعلام کنید.</small>' : ''}</div>
      <label>توضیح روی کارت<textarea name="desc" maxlength="200" rows="3" placeholder="توانایی نقش را کوتاه بنویسید">${esc(d.desc)}</textarea></label>
      <label>کار شبانه
        <select name="kind">
          <option value="" ${!d.kind ? 'selected' : ''}>بدون کار خودکار (گرداننده خودش اجرا می‌کند)</option>
          ${UNIQUE_KINDS.map((k) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}
        </select>
      </label>
      ${!d.kind ? `<label class="check"><input type="checkbox" name="night" ${d.night ? 'checked' : ''}> شب بیدار می‌شود (در مراحل شب صدایش می‌زنیم)</label>` : ''}
      ${d.team === 'mafia' && d.kind !== 'godfather' ? `<label class="check"><input type="checkbox" name="detNeg" ${d.detNeg ? 'checked' : ''}> استعلام کارآگاه از او منفی است</label>` : ''}
      ${d.team !== 'mafia' ? `<label class="check"><input type="checkbox" name="detPos" ${d.detPos ? 'checked' : ''}> استعلام کارآگاه از او مثبت است</label>` : ''}
      <label class="check"><input type="checkbox" name="immune" ${d.immune ? 'checked' : ''}> تیر شب مافیا او را نمی‌کشد</label>
      <button class="btn primary block" type="submit">ذخیره‌ی نقش</button>
      ${!d.isNew ? '<button type="button" class="btn ghost small danger-text" data-action="delete-role">حذف این نقش</button>' : ''}
    </form>
  </main>`;
}

function viewSettings() {
  const b = library.brand;
  return `${header('تنظیمات گروه', 'close-settings', '<span></span>')}
  <main class="pad">
    <section class="card brand-card">
      <div class="brand-preview">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : '<span>🕵️</span>'}</div>
      <form class="form" data-form="brand">
        <label>اسم گروه یا مجموعه<input name="name" maxlength="30" value="${esc(b.name)}" placeholder="مثلاً: مافیای الون"></label>
        <button class="btn primary small" type="submit">ذخیره‌ی اسم</button>
      </form>
      <div class="row wrap">
        <label class="btn ghost small file-btn">${b.logo ? 'عوض کردن لوگو' : 'انتخاب لوگو'}<input type="file" accept="image/*" data-input="logo" hidden></label>
        ${b.logo ? '<button class="btn ghost small" data-action="remove-logo">حذف لوگو</button>' : ''}
      </div>
      <p class="muted small-text">اسم و لوگو بالای صفحه‌ها و پشت کارت نقش‌ها می‌آید. بهتر است لوگو مربعی و با پس‌زمینه‌ی شفاف باشد.</p>
      <p class="label">رنگ اصلی</p>
      <div class="swatches">
        ${COLORS.map((col) => `<button class="swatch ${(b.color || COLORS[0]).toLowerCase() === col.toLowerCase() ? 'on' : ''}" style="background:${col}" data-action="set-color" data-c="${col}" aria-label="رنگ ${col}"></button>`).join('')}
      </div>
    </section>

    <section class="card">
      <p class="label">سناریوهای من</p>
      ${library.scenarios.length ? `<ul class="list">${library.scenarios.map((sc) => `
        <li class="item"><span class="grow"><b>${esc(sc.name)}</b>
          <small class="muted">${Object.entries(sc.roles).filter(([r]) => r !== 'citizen' && ROLES[r]).map(([r, k]) => `${esc(roleOf(r).name)}${k > 1 ? ` ×${toFa(k)}` : ''}`).join('، ')} + شهروند</small></span>
          <button class="icon-btn small" data-action="rename-scenario" data-id="${sc.id}" aria-label="تغییر اسم">✎</button>
          <button class="icon-btn small" data-action="delete-scenario" data-id="${sc.id}" aria-label="حذف">✕</button></li>`).join('')}</ul>`
        : '<p class="muted small-text">هنوز سناریویی ذخیره نکرده‌اید. در صفحه‌ی نقش‌ها ترکیب دلخواه را بچینید و «ذخیره به‌عنوان سناریو» را بزنید.</p>'}
    </section>

    <section class="card">
      <p class="label">نقش‌های من</p>
      ${library.roles.length ? `<ul class="list">${library.roles.map((d) => `
        <li class="item role-row ${d.team}"><span class="ricon">${esc(d.icon || '🎴')}</span>
          <span class="grow"><b>${esc(d.name)}</b><small>${TEAMS[d.team] || ''}</small></span>
          <button class="icon-btn small" data-action="edit-role" data-id="${d.id}" aria-label="ویرایش">✎</button></li>`).join('')}</ul>`
        : '<p class="muted small-text">نقش‌هایی که خودتان می‌سازید اینجا می‌آیند.</p>'}
      <button class="btn ghost small" data-action="new-role">＋ ساخت نقش جدید</button>
    </section>
    <p class="muted small-text center">همه‌ی این‌ها فقط روی همین گوشی ذخیره می‌شود.</p>
  </main>`;
}

function viewReveal() {
  if (state.revealId) {
    const p = byId(state.revealId);
    if (!state.revealOpen) {
      return `
      <main class="reveal card-back">
        <button class="back-face" data-action="flip-role">
          <span class="back-logo">${library.brand.logo ? `<img src="${esc(library.brand.logo)}" alt="">` : '🕵️'}</span>
          <b class="back-brand">${esc(brandName())}</b>
          <span class="back-name">${esc(p.name)}</span>
          <small>برای دیدن نقش بزن</small>
        </button>
        <button class="btn ghost" data-action="cancel-reveal">این من نیستم</button>
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
      <p class="team-label">${TEAMS[r.team]}</p>
      <p class="desc">${esc(r.desc)}</p>
      ${r.team === 'mafia' ? `<p class="desc">هم‌تیمی‌ها: ${mates.map((q) => `${esc(q.name)} (${esc(roleOf(q.role).name)})`).join('، ') || '—'}</p>` : ''}
      <button class="btn primary block" data-action="hide-role">دیدم، مخفی کن</button>
    </main>`;
  }
  const allSeen = state.players.every((p) => p.seen);
  return `${header('دیدن نقش‌ها', 'to-roles-confirm')}
  <main class="pad">
    <p class="muted">گوشی را دست‌به‌دست کنید. هر نفر روی اسم خودش بزند، نقشش را ببیند و «مخفی کن» را بزند.</p>
    <ul class="grid-names">
      ${state.players.map((p) => `
        <li><button class="name-card ${p.seen ? 'seen' : ''}" data-action="reveal" data-id="${p.id}">
          ${esc(p.name)}<small>${p.seen ? 'دیده شد ✓' : 'بزن و ببین'}</small></button></li>`).join('')}
    </ul>
  </main>
  <footer class="dock">
    <button class="btn ${allSeen ? 'primary' : 'ghost'} block" data-action="start-game">${allSeen ? 'شروع بازی' : 'شروع بازی (همه هنوز ندیده‌اند)'}</button>
  </footer>`;
}

function playerRow(p) {
  const r = roleOf(p.role);
  const roleTxt = state.showRoles || !p.alive ? `<small class="${r.team}">${roleLabel(p.role)}</small>` : '';
  const death = p.death ? `<small class="muted">${CAUSE[p.death.cause]} · ${toFa(p.death.round)}</small>` : '';
  const votes = state.votes[p.id] || 0;
  const open = state.menuId === p.id;
  return `
  <li class="item player ${p.alive ? '' : 'dead'}">
    <button class="grow plain" data-action="menu" data-id="${p.id}">
      <b>${esc(p.name)}</b>${roleTxt}${death}
    </button>
    ${p.alive && state.phase === 'day' ? `
      <span class="stepper">
        <button class="icon-btn small" data-action="vote-inc" data-id="${p.id}" aria-label="افزودن رأی">+</button>
        <b class="votes ${votes >= voteThreshold(state.players) ? 'hot' : ''}">${toFa(votes)}</b>
        <button class="icon-btn small" data-action="vote-dec" data-id="${p.id}" aria-label="کم کردن رأی">−</button>
      </span>` : ''}
  </li>
  ${open ? `
  <li class="menu">
    ${p.alive
      ? `${state.phase === 'day' ? `<button class="btn danger small" data-action="vote-out" data-id="${p.id}">خروج با رأی</button>` : ''}
         <button class="btn ghost small" data-action="kill" data-id="${p.id}">حذف دستی</button>`
      : `<button class="btn ghost small" data-action="revive" data-id="${p.id}">برگرداندن به بازی</button>`}
    <button class="btn ghost small" data-action="menu" data-id="${p.id}">بستن</button>
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
        <span id="timer-value" class="timer">۱:۰۰</span>
        <button id="timer-toggle" class="btn primary small" data-action="timer-toggle">شروع</button>
        <button class="btn ghost small" data-action="timer-reset">از نو</button>
      </div>
      <div class="presets">
        ${[30, 45, 60, 90, 120].map((s) => `<button class="chip-btn ${timer.total === s ? 'on' : ''}" data-action="timer-set" data-s="${s}">${toFa(s)} ثانیه</button>`).join('')}
      </div>
    </section>
    <div class="summary">
      <span class="chip">زنده ${toFa(alive.length)}</span>
      ${state.showRoles ? `<span class="chip mafia">مافیا ${toFa(mafia)}</span><span class="chip town">شهر ${toFa(town)}</span>` : ''}
      ${state.phase === 'day' ? `<span class="chip">حد نصاب رأی ${toFa(voteThreshold(state.players))}</span>` : ''}
      <button class="btn ghost small" data-action="toggle-roles">${state.showRoles ? 'مخفی کردن نقش‌ها 🙈' : 'نمایش نقش‌ها 👁'}</button>
    </div>
    <ul class="list">${state.players.map(playerRow).join('')}</ul>
    ${state.phase === 'day' && Object.keys(state.votes).length ? '<button class="btn ghost small" data-action="clear-votes">صفر کردن رأی‌ها</button>' : ''}
    ${state.log.length ? `<details class="log"><summary>تاریخچه (${toFa(state.log.length)})</summary><ul>${state.log.map((l) => `<li><b>${l.at}:</b> ${l.text}</li>`).join('')}</ul></details>` : ''}
    <button class="btn ghost small danger-text" data-action="new-game">پایان و بازی جدید</button>
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="start-night">🌙 شروع شب ${toFa(state.round)}</button>
  </footer>`;
}

function morningCard() {
  const r = state.report;
  const lines = r.deaths.length
    ? r.deaths.map((d) => `<b>${nameOf(d.id)}</b> دیشب از بازی خارج شد.`).join('<br>')
    : 'دیشب کسی از بازی خارج نشد.';
  const secret = [];
  for (const s of r.saves) secret.push(`${nameOf(s.id)} توسط ${esc(stepName(s.by))} نجات پیدا کرد.`);
  if (r.shieldUsed) secret.push(`سپر ${esc(roleOf(byId(r.shieldUsed)?.role).name)} (${nameOf(r.shieldUsed)}) مصرف شد.`);
  if (r.immuneHit) secret.push(`تیر مافیا به ${nameOf(r.immuneHit)} (${esc(roleOf(byId(r.immuneHit)?.role).name)}) اثر نکرد.`);
  if (r.sniperNoEffect) secret.push(`تیر ${esc(stepName('sniper'))} به ${nameOf(r.sniperNoEffect)} اثر نکرد.`);
  if (r.sniperBackfired) secret.push(`${esc(stepName('sniper'))} به شهروند شلیک کرد و خودش حذف شد.`);
  for (const m of r.manual || []) secret.push(`${esc(roleOf(m.role).name)} ← ${nameOf(m.targetId)} (اثرش را خودتان اعمال کنید)`);
  return `
  <section class="card announce">
    <p class="muted">اعلام صبح (بلند بخوانید)</p>
    <p class="big">${lines}</p>
    ${secret.length ? `<details><summary>یادداشت گرداننده (نخوانید)</summary><p class="muted">${secret.join('<br>')}</p></details>` : ''}
    <button class="btn ghost small" data-action="dismiss-report">باشه</button>
  </section>`;
}

function viewNight() {
  const n = state.night;
  const step = n.steps[n.index];
  if (!step) {
    return `${header(phaseLabel())}
    <main class="pad night-bg">
      <section class="card">
        <h2>خلاصه‌ی شب</h2>
        <ul class="plain-list">
          ${n.steps.map((s) => `<li>${esc(stepName(s))}: <b>${nameOf(n.actions[s])}</b></li>`).join('')}
        </ul>
      </section>
    </main>
    <footer class="dock">
      <button class="btn ghost" data-action="night-back">بازگشت</button>
      <button class="btn primary grow" data-action="end-night">☀️ صبح شد</button>
    </footer>`;
  }
  const info = stepInfo(step);
  const name = stepName(step);
  const actors = actorsFor(step, state.players);
  const targets = targetsFor(step, state.players, state.memory);
  const chosen = n.actions[step] ?? null;
  const manual = !STEP_ASK[step];
  let detective = '';
  if (step === 'detective' && chosen) {
    const positive = detectivePositive(byId(chosen).role);
    detective = `<p class="answer ${positive ? 'pos' : 'neg'}">پاسخ استعلام: ${positive ? '👍 مثبت (مافیا)' : '👎 منفی'}</p>`;
  }
  return `${header(`${phaseLabel()} — مرحله‌ی ${toFa(n.index + 1)} از ${toFa(n.steps.length)}`)}
  <main class="pad night-bg">
    <p class="muted">همه چشم‌ها بسته…</p>
    <h2>${esc(name)} بیدار شود</h2>
    <p class="muted">${actors.map((a) => `${esc(a.name)} (${esc(roleOf(a.role).name)})`).join('، ')}</p>
    ${manual && roleOf(step).desc ? `<p class="card small-text">${esc(roleOf(step).desc)}</p>` : ''}
    <p>${info.ask}</p>
    <div class="targets">
      ${targets.map((p) => `<button class="target ${chosen === p.id ? 'on' : ''}" data-action="pick" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      <button class="target none ${n.actions[step] === null && n.touched[step] ? 'on' : ''}" data-action="pick" data-id="">${info.none}</button>
    </div>
    ${detective}
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="night-back">${n.index === 0 ? 'لغو شب' : 'قبلی'}</button>
    <button class="btn primary grow" data-action="night-next">${esc(name)} بخوابد ←</button>
  </footer>`;
}

function viewEnd() {
  const w = state.winner;
  return `${header('پایان بازی')}
  <main class="pad">
    <section class="card announce ${w === 'mafia' ? 'mafia' : 'town'}">
      <div class="big-icon">${w === 'mafia' ? '🔪' : '🏆'}</div>
      <h2>${w === 'mafia' ? 'مافیا برنده شد' : 'شهروندان برنده شدند'}</h2>
    </section>
    <ul class="list">
      ${state.players.map((p) => `
        <li class="item ${p.alive ? '' : 'dead'}"><span class="grow"><b>${esc(p.name)}</b>
        <small class="${roleOf(p.role).team}">${roleLabel(p.role)}</small></span>
        <small class="muted">${p.alive ? 'زنده' : CAUSE[p.death?.cause] ?? ''}</small></li>`).join('')}
    </ul>
    <button class="btn ghost small" data-action="continue-anyway">ادامه‌ی بازی (اشتباه شده)</button>
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="new-game-setup">تغییر بازیکن‌ها</button>
    <button class="btn primary grow" data-action="rematch">بازی دوباره</button>
  </footer>`;
}

let shownView = null;
function render() {
  const views = {
    setup: viewSetup, players: viewPlayers, roles: viewRoles, reveal: viewReveal, game: viewGame, night: viewNight,
    end: viewEnd, settings: viewSettings, 'role-edit': viewRoleEdit,
  };
  app.innerHTML = (views[state.view] || viewSetup)();
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
  state.log = [];
  state.winner = null;
  state.revealId = null;
  state.revealOpen = false;
  state.menuId = null;
  state.showRoles = false;
  state.view = 'reveal';
}

function scenarioCounts(id, n) {
  if (id.startsWith('my:')) {
    const sc = library.scenarios.find((x) => `my:${x.id}` === id);
    if (sc) return fitScenario(sc.roles, n);
  }
  if (id.startsWith('b:')) {
    const sc = SCENARIOS.find((x) => `b:${x.id}` === id);
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

function openRoleEditor(def, from) {
  state.editRole = def
    ? { ...def, isNew: false }
    : { id: newId('c_'), name: '', icon: '', team: 'town', desc: '', kind: '', night: true, detNeg: false, isNew: true };
  state.editFrom = from;
  state.view = 'role-edit';
}

const actions = {
  undo,
  'remove-name': (el) => update((s) => s.names.splice(Number(el.dataset.i), 1)),
  'clear-names': () => confirm('همه‌ی اسم‌ها پاک شود؟') && update((s) => { s.names = []; }),
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
    const name = prompt('اسم این سناریو؟ (مثلاً: مافیای ساده‌ی جمعه‌ها)', cur?.name || '');
    if (!name || !name.trim()) return;
    const roles = Object.fromEntries(Object.entries(state.counts).filter(([r, c]) => c > 0 && r !== 'citizen'));
    const same = library.scenarios.find((x) => x.name === name.trim());
    if (same && !confirm(`سناریوی «${name.trim()}» از قبل هست. جایگزین شود؟`)) return;
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
    if (!confirm(`نقش «${d.name}» حذف شود؟ از سناریوهای ذخیره‌شده هم برداشته می‌شود.`)) return;
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
    const name = sc && prompt('اسم تازه‌ی سناریو؟', sc.name);
    if (!name || !name.trim()) return;
    sc.name = name.trim();
    saveLibrary();
    render();
  },
  'delete-scenario': (el) => {
    const sc = library.scenarios.find((x) => x.id === el.dataset.id);
    if (!sc || !confirm(`سناریوی «${sc.name}» حذف شود؟`)) return;
    library.scenarios = library.scenarios.filter((x) => x.id !== sc.id);
    saveLibrary();
    update((s) => { if (s.scenarioId === `my:${sc.id}`) s.scenarioId = null; });
  },
  deal: () => update(startNewDeal),
  'to-roles-confirm': () => confirm('نقش‌ها دوباره پخش شوند؟ نقش‌های فعلی از بین می‌رود.') && update((s) => { s.view = 'roles'; }),
  reveal: (el) => update((s) => { s.revealId = el.dataset.id; s.revealOpen = false; }),
  'flip-role': () => update((s) => { s.revealOpen = true; }),
  'cancel-reveal': () => update((s) => { s.revealId = null; s.revealOpen = false; }),
  'hide-role': () => update((s) => { byId(s.revealId).seen = true; s.revealId = null; s.revealOpen = false; }),
  'start-game': () => update((s) => { s.view = 'game'; addLog('بازی شروع شد.'); }),
  'toggle-roles': () => update((s) => { s.showRoles = !s.showRoles; }),
  menu: (el) => update((s) => { s.menuId = s.menuId === el.dataset.id ? null : el.dataset.id; }),
  'vote-inc': (el) => update((s) => {
    const max = s.players.filter((p) => p.alive).length;
    s.votes[el.dataset.id] = Math.min(max, (s.votes[el.dataset.id] || 0) + 1);
  }),
  'vote-dec': (el) => update((s) => { s.votes[el.dataset.id] = Math.max(0, (s.votes[el.dataset.id] || 0) - 1); }),
  'clear-votes': () => update((s) => { s.votes = {}; }),
  'vote-out': (el) => update((s) => {
    const p = byId(el.dataset.id);
    p.alive = false;
    p.death = { round: s.round, cause: 'vote' };
    s.menuId = null;
    s.votes = {};
    addLog(`${esc(p.name)} با رأی از بازی خارج شد (${esc(roleOf(p.role).name)}).`);
    checkWin();
  }, { undoable: true }),
  kill: (el) => update((s) => {
    const p = byId(el.dataset.id);
    p.alive = false;
    p.death = { round: s.round, cause: 'manual' };
    s.menuId = null;
    addLog(`${esc(p.name)} به‌صورت دستی حذف شد.`);
    checkWin();
  }, { undoable: true }),
  revive: (el) => update((s) => {
    const p = byId(el.dataset.id);
    p.alive = true;
    p.death = null;
    s.menuId = null;
    addLog(`${esc(p.name)} به بازی برگشت.`);
  }, { undoable: true }),
  'dismiss-report': () => update((s) => { s.report = null; }),
  'start-night': () => update((s) => {
    stopTimer();
    s.phase = 'night';
    s.votes = {};
    s.menuId = null;
    s.report = null;
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
    const deaths = res.report.deaths.map((d) => `${nameOf(d.id)} (${esc(roleOf(byId(d.id).role).name)})`).join('، ');
    addLog(deaths ? `حذف در شب: ${deaths}` : 'شب بدون حذف گذشت.');
    for (const m of res.report.manual) addLog(`${esc(roleOf(m.role).name)} ← ${nameOf(m.targetId)}`);
    s.night = null;
    s.phase = 'day';
    s.round += 1;
    s.view = 'game';
    checkWin();
  }, { undoable: true }),
  'continue-anyway': () => update((s) => { s.view = 'game'; s.winner = null; }),
  rematch: () => update(startNewDeal),
  'new-game-setup': () => update((s) => { s.view = 'setup'; }),
  'new-game': () => confirm('بازی فعلی تمام شود و به تنظیمات برگردیم؟') && update((s) => { s.view = 'setup'; }),
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
      alert('این تصویر خوانده نشد. یک فایل PNG یا JPG دیگر امتحان کنید.');
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
  if (form === 'role') {
    readRoleForm();
    const d = state.editRole;
    const name = d.name.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if ([...ROLE_ORDER, ...library.roles.map((x) => x.id)].some((r) => r !== d.id && ROLES[r]?.name === name)) { alert('نقشی با این اسم از قبل هست.'); return; }
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
  if (state.names.includes(name)) { alert('این اسم قبلاً اضافه شده.'); return; }
  if (state.names.length >= state.playerCount) return;
  update((s) => s.names.push(name));
});

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
