import {
  ROLES, ROLE_ORDER, MIN_PLAYERS, MAX_PLAYERS,
  suggestRoles, teamCounts, validateSetup, dealRoles, nightSteps, targetsFor,
  resolveNight, winner, voteThreshold, teamOf, toFa,
} from './logic.js';

const STORE_KEY = 'mafia-tool-v1';
const NAMES_KEY = 'mafia-tool-names';

const STEP_INFO = {
  mafia: { title: 'تیم مافیا بیدار شود', ask: 'پدرخوانده (یا مافیا) چه کسی را می‌زند؟', none: 'شلیک نمی‌کنند' },
  lecter: { title: 'دکتر لکتر بیدار شود', ask: 'کدام عضو مافیا را نجات می‌دهد؟', none: 'کسی را نجات نمی‌دهد' },
  doctor: { title: 'دکتر بیدار شود', ask: 'چه کسی را نجات می‌دهد؟', none: 'کسی را نجات نمی‌دهد' },
  detective: { title: 'کارآگاه بیدار شود', ask: 'از چه کسی استعلام می‌گیرد؟', none: 'استعلام نمی‌گیرد' },
  sniper: { title: 'اسنایپر بیدار شود', ask: 'به چه کسی شلیک می‌کند؟', none: 'شلیک نمی‌کند' },
};

const CAUSE = { night: 'شلیک شب', sniper: 'تیر اسنایپر', vote: 'رأی روز', manual: 'حذف دستی' };

// ---------- state ----------

function freshState() {
  let names = [];
  try { names = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]'); } catch { /* ignore */ }
  return {
    view: 'players', names, counts: null, players: [], memory: {},
    round: 1, phase: 'day', night: null, report: null, votes: {}, log: [],
    showRoles: false, revealId: null, menuId: null, winner: null,
  };
}

let state = load() || freshState();
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

function header(title, back) {
  return `
  <header class="bar">
    ${back ? `<button class="icon-btn" data-action="${back}" aria-label="بازگشت">→</button>` : '<span class="logo">🕵️</span>'}
    <h1>${title}</h1>
    ${undoStack.length && state.view !== 'players' ? '<button class="icon-btn" data-action="undo" aria-label="برگرداندن آخرین کار">↶</button>' : '<span></span>'}
  </header>`;
}

function viewPlayers() {
  const n = state.names.length;
  return `${header('بازیکن‌ها')}
  <main class="pad">
    <form class="row" data-form="add-name">
      <input id="name-input" name="name" maxlength="24" autocomplete="off" placeholder="اسم بازیکن" aria-label="اسم بازیکن">
      <button class="btn primary" type="submit">افزودن</button>
    </form>
    <p class="muted">${toFa(n)} بازیکن · حداقل ${toFa(MIN_PLAYERS)} نفر. اسم‌ها برای دفعه‌ی بعد ذخیره می‌شوند.</p>
    <ol class="list">
      ${state.names.map((nm, i) => `
        <li class="item"><span class="num">${toFa(i + 1)}</span><span class="grow">${esc(nm)}</span>
        <button class="icon-btn small" data-action="remove-name" data-i="${i}" aria-label="حذف ${esc(nm)}">✕</button></li>`).join('')}
    </ol>
    ${n ? '<button class="btn ghost small" data-action="clear-names">پاک کردن همه</button>' : ''}
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="to-roles" ${n < MIN_PLAYERS ? 'disabled' : ''}>ادامه: انتخاب نقش‌ها</button>
  </footer>`;
}

function viewRoles() {
  const n = state.names.length;
  const c = state.counts;
  const { mafia, town, total } = teamCounts(c);
  const error = validateSetup(n, c);
  return `${header('نقش‌ها', 'to-players')}
  <main class="pad">
    <div class="summary">
      <span class="chip mafia">مافیا ${toFa(mafia)}</span>
      <span class="chip town">شهر ${toFa(town)}</span>
      <span class="chip">${toFa(total)} از ${toFa(n)}</span>
      <button class="btn ghost small" data-action="suggest">پیشنهاد خودکار</button>
    </div>
    <ul class="list">
      ${ROLE_ORDER.map((r) => `
        <li class="item role-row ${ROLES[r].team}">
          <span class="ricon">${ROLES[r].icon}</span>
          <span class="grow"><b>${ROLES[r].name}</b><small>${ROLES[r].desc}</small></span>
          <span class="stepper">
            <button class="icon-btn small" data-action="dec" data-role="${r}" aria-label="کم کردن">−</button>
            <b>${toFa(c[r] || 0)}</b>
            <button class="icon-btn small" data-action="inc" data-role="${r}" aria-label="زیاد کردن">+</button>
          </span>
        </li>`).join('')}
    </ul>
    ${error ? `<p class="error">${error}</p>` : ''}
  </main>
  <footer class="dock">
    <button class="btn primary block" data-action="deal" ${error ? 'disabled' : ''}>پخش تصادفی نقش‌ها</button>
  </footer>`;
}

function viewReveal() {
  if (state.revealId) {
    const p = byId(state.revealId);
    const r = ROLES[p.role];
    return `
    <main class="reveal ${r.team}">
      <p class="muted">${esc(p.name)}</p>
      <div class="big-icon">${r.icon}</div>
      <h2>${r.name}</h2>
      <p class="team-label">${r.team === 'mafia' ? 'تیم مافیا' : 'تیم شهر'}</p>
      <p class="desc">${r.desc}</p>
      ${r.team === 'mafia' ? `<p class="desc">هم‌تیمی‌ها: ${state.players.filter((q) => q.id !== p.id && teamOf(q.role) === 'mafia').map((q) => `${esc(q.name)} (${ROLES[q.role].name})`).join('، ') || '—'}</p>` : ''}
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
  const r = ROLES[p.role];
  const roleTxt = state.showRoles || !p.alive ? `<small class="${r.team}">${r.icon} ${r.name}</small>` : '';
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
        <button class="icon-btn small" data-action="vote-dec" data-id="${p.id}" aria-label="کم کردن رأی">−</button>
        <b class="votes ${votes >= voteThreshold(state.players) ? 'hot' : ''}">${toFa(votes)}</b>
        <button class="icon-btn small" data-action="vote-inc" data-id="${p.id}" aria-label="افزودن رأی">+</button>
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
  const { mafia, town } = alive.reduce((a, p) => (a[teamOf(p.role)]++, a), { mafia: 0, town: 0 });
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
  for (const s of r.saves) secret.push(`${nameOf(s.id)} توسط ${s.by === 'doctor' ? 'دکتر' : 'دکتر لکتر'} نجات پیدا کرد.`);
  if (r.shieldUsed) secret.push(`سپر رویین‌تن (${nameOf(r.shieldUsed)}) مصرف شد.`);
  if (r.sniperBackfired) secret.push('اسنایپر به شهروند شلیک کرد و خودش حذف شد.');
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
          ${n.steps.map((s) => `<li>${STEP_INFO[s].title.replace(' بیدار شود', '')}: <b>${nameOf(n.actions[s])}</b></li>`).join('')}
        </ul>
      </section>
    </main>
    <footer class="dock">
      <button class="btn ghost" data-action="night-back">بازگشت</button>
      <button class="btn primary grow" data-action="end-night">☀️ صبح شد</button>
    </footer>`;
  }
  const info = STEP_INFO[step];
  const actors = step === 'mafia'
    ? state.players.filter((p) => p.alive && teamOf(p.role) === 'mafia')
    : state.players.filter((p) => p.alive && p.role === step);
  const targets = targetsFor(step, state.players, state.memory);
  const chosen = n.actions[step] ?? null;
  let detective = '';
  if (step === 'detective' && chosen) {
    const t = byId(chosen);
    const positive = teamOf(t.role) === 'mafia' && t.role !== 'godfather';
    detective = `<p class="answer ${positive ? 'pos' : 'neg'}">پاسخ استعلام: ${positive ? '👍 مثبت (مافیا)' : '👎 منفی'}</p>`;
  }
  return `${header(`${phaseLabel()} — مرحله‌ی ${toFa(n.index + 1)} از ${toFa(n.steps.length)}`)}
  <main class="pad night-bg">
    <p class="muted">همه چشم‌ها بسته…</p>
    <h2>${info.title}</h2>
    <p class="muted">${actors.map((a) => `${esc(a.name)} (${ROLES[a.role].name})`).join('، ')}</p>
    <p>${info.ask}</p>
    <div class="targets">
      ${targets.map((p) => `<button class="target ${chosen === p.id ? 'on' : ''}" data-action="pick" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      <button class="target none ${n.actions[step] === null && n.touched[step] ? 'on' : ''}" data-action="pick" data-id="">${info.none}</button>
    </div>
    ${detective}
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="night-back">${n.index === 0 ? 'لغو شب' : 'قبلی'}</button>
    <button class="btn primary grow" data-action="night-next">${info.title.replace('بیدار شود', 'بخوابد')} ←</button>
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
        <small class="${ROLES[p.role].team}">${ROLES[p.role].icon} ${ROLES[p.role].name}</small></span>
        <small class="muted">${p.alive ? 'زنده' : CAUSE[p.death?.cause] ?? ''}</small></li>`).join('')}
    </ul>
    <button class="btn ghost small" data-action="continue-anyway">ادامه‌ی بازی (اشتباه شده)</button>
  </main>
  <footer class="dock">
    <button class="btn ghost" data-action="new-game-setup">تغییر بازیکن‌ها</button>
    <button class="btn primary grow" data-action="rematch">بازی دوباره</button>
  </footer>`;
}

function render() {
  const views = { players: viewPlayers, roles: viewRoles, reveal: viewReveal, game: viewGame, night: viewNight, end: viewEnd };
  app.innerHTML = (views[state.view] || viewPlayers)();
  renderTimer();
  if (state.view === 'players') document.getElementById('name-input')?.focus();
}

// ---------- actions ----------

function startNewDeal() {
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
  state.menuId = null;
  state.showRoles = false;
  state.view = 'reveal';
}

const actions = {
  undo,
  'remove-name': (el) => update((s) => s.names.splice(Number(el.dataset.i), 1)),
  'clear-names': () => confirm('همه‌ی اسم‌ها پاک شود؟') && update((s) => { s.names = []; }),
  'to-roles': () => update((s) => {
    const n = s.names.length;
    if (!s.counts || teamCounts(s.counts).total !== n) s.counts = suggestRoles(n);
    s.view = 'roles';
  }),
  'to-players': () => update((s) => { s.view = 'players'; }),
  suggest: () => update((s) => { s.counts = suggestRoles(s.names.length); }),
  inc: (el) => update((s) => { s.counts[el.dataset.role] = (s.counts[el.dataset.role] || 0) + 1; }),
  dec: (el) => update((s) => { s.counts[el.dataset.role] = Math.max(0, (s.counts[el.dataset.role] || 0) - 1); }),
  deal: () => update(startNewDeal),
  'to-roles-confirm': () => confirm('نقش‌ها دوباره پخش شوند؟ نقش‌های فعلی از بین می‌رود.') && update((s) => { s.view = 'roles'; }),
  reveal: (el) => update((s) => { s.revealId = el.dataset.id; }),
  'hide-role': () => update((s) => { byId(s.revealId).seen = true; s.revealId = null; }),
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
    addLog(`${esc(p.name)} با رأی از بازی خارج شد (${ROLES[p.role].name}).`);
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
    const deaths = res.report.deaths.map((d) => `${nameOf(d.id)} (${ROLES[byId(d.id).role].name})`).join('، ');
    addLog(deaths ? `حذف در شب: ${deaths}` : 'شب بدون حذف گذشت.');
    s.night = null;
    s.phase = 'day';
    s.round += 1;
    s.view = 'game';
    checkWin();
  }, { undoable: true }),
  'continue-anyway': () => update((s) => { s.view = 'game'; s.winner = null; }),
  rematch: () => update(startNewDeal),
  'new-game-setup': () => update((s) => { s.view = 'players'; }),
  'new-game': () => confirm('بازی فعلی تمام شود و به تنظیمات برگردیم؟') && update((s) => { s.view = 'players'; }),
  'timer-toggle': () => (timer.running ? stopTimer() : startTimer()),
  'timer-reset': () => setTimer(timer.total),
  'timer-set': (el) => { setTimer(Number(el.dataset.s)); render(); },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== 'add-name') return;
  const input = e.target.elements.name;
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (state.names.includes(name)) { alert('این اسم قبلاً اضافه شده.'); return; }
  if (state.names.length >= MAX_PLAYERS) return;
  update((s) => s.names.push(name));
});

render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
