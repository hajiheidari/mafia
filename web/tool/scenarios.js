// Ready-made scenarios of the Persian Mafia game. `roles` maps role id →
// count for the standard deck; plain citizens are added or removed to match
// the number of players (see fitScenario). Roles that are not built in are
// defined below with ids `s_<scenario>_<name>`.
//
// A scenario role either borrows a built-in mechanic through `kind` (e.g. the
// boss works like the godfather: detective reads negative) or, with
// `night: true`, is woken by the tool and its effect applied by the narrator.
// `order` is its place in the night (mafia team 20, doctor 50, detective 60,
// sniper 70). Rosters follow the 10-player decks of mafia.farid.one (11 for
// پدرخوانده); house rules vary, so every role stays editable before the deal.

const M = 'mafia';
const T = 'town';

function role(scenario, key, name, team, icon, desc, extra = {}) {
  return { id: `s_${scenario}_${key}`, scenario, name, team, icon, desc, ...extra };
}

export const SCENARIO_ROLES = [
  // کلاسیک
  role('classic', 'boss', 'رئیس مافیا', M, '🎩', 'شلیک شب با اوست و استعلامش برای کارآگاه منفی است.', { kind: 'godfather' }),
  role('classic', 'terror', 'تروریست', M, '💣', 'اگر در روز با رأی بیرون برود، یک نفر را با خودش از بازی خارج می‌کند.'),
  role('classic', 'medic', 'پزشک', T, '🩺', 'هر شب یک نفر را از شلیک مافیا نجات می‌دهد.', { kind: 'doctor' }),
  role('classic', 'tough', 'روئین‌تن', T, '🛡️', 'با شلیک شب کشته نمی‌شود و فقط با رأی روز بیرون می‌رود.', { immune: true }),

  // تکاور
  role('takavar', 'boss', 'رئیس مافیا', M, '🎩', 'شلیک شب را تعیین می‌کند؛ استعلامش منفی است و تیر تکاور هم او را نمی‌کشد.', { kind: 'godfather' }),
  role('takavar', 'hostage', 'گروگان‌گیر', M, '⛓️', 'تنها بیدار می‌شود و هر شب یک نفر را گروگان می‌گیرد تا توانایی‌اش آن شب باطل شود؛ دو شب پشت هم یک نفر را نه.', { night: true, order: 15 }),
  role('takavar', 'nato', 'ناتو', M, '🎯', 'یک بار در بازی به جای شلیک، نقش یک شهروند را حدس می‌زند؛ اگر درست باشد او بیرون می‌رود.'),
  role('takavar', 'guard', 'نگهبان', T, '💂', 'اول شب بیدار می‌شود و یک یا دو نفر را در برابر گروگان‌گیر نگهبانی می‌کند.', { night: true, order: 10 }),
  role('takavar', 'commando', 'تکاور', T, '🪖', 'اگر مافیا به او شلیک کند یک تیر دارد: مافیا را بزند حذف می‌شود، رئیس را بزند کسی نمی‌رود، شهروند را بزند خودش می‌رود.', { night: true, order: 65 }),
  role('takavar', 'medic', 'پزشک', T, '🩺', 'هر شب یک نفر را نجات می‌دهد.', { kind: 'doctor', order: 68 }),
  role('takavar', 'gunner', 'تفنگ‌دار', T, '🔫', 'هر شب حداکثر دو تفنگ (مشقی یا جنگی) به بازیکنان می‌دهد که فردا در روز شلیک می‌کنند؛ به خودش تفنگ جنگی نمی‌دهد.', { night: true, order: 90 }),

  // بازپرس
  role('bazpors', 'boss', 'رئیس مافیا', M, '🎩', 'شلیک شب با اوست، استعلامش منفی است و یک بار می‌تواند سوداگری کند (یک مافیا را فدا کند تا یک شهروند ساده یا روئین‌تن مافیا شود).', { kind: 'godfather' }),
  role('bazpors', 'fraud', 'شیاد', M, '🃏', 'تنها بیدار می‌شود؛ اگر کارآگاه را انتخاب کند، استعلام آن شب کارآگاه منفی می‌شود.', { night: true, order: 30 }),
  role('bazpors', 'nato', 'ناتو', M, '🎯', 'یک بار در بازی به جای شلیک، نقش یک شهروند را حدس می‌زند؛ اگر درست باشد او بیرون می‌رود.'),
  role('bazpors', 'researcher', 'محقق', T, '🔗', 'از شب دوم هر شب خودش را به یک نفر گره می‌زند؛ اگر خودش بیرون برود آن فرد هم می‌رود (به‌جز رئیس مافیا).', { night: true, order: 10 }),
  role('bazpors', 'medic', 'پزشک', T, '🩺', 'هر شب یک نفر را نجات می‌دهد.', { kind: 'doctor', order: 70 }),
  role('bazpors', 'judge', 'بازپرس', T, '⚖️', 'یک بار در بازی دو نفر را برای بازپرسی انتخاب می‌کند تا فردا رأی‌گیری فقط بین آن دو باشد.', { night: true, order: 80 }),
  role('bazpors', 'tough', 'روئین‌تن', T, '🛡️', 'در شب کشته نمی‌شود.', { immune: true }),

  // نماینده
  role('namayande', 'don', 'دان مافیا', M, '🎩', 'استعلامش منفی است و با «رأی خیانت» رأی یکی از متهم‌ها را یکی کم یا زیاد می‌کند.', { kind: 'godfather' }),
  role('namayande', 'hacker', 'هکر', M, '💻', 'هر شب توانایی یک نفر را خنثی می‌کند (مثلاً نجات پزشک را بی‌اثر می‌کند).', { night: true, order: 25 }),
  role('namayande', 'rebel', 'یاغی', M, '🧨', 'اگر دان یا هکر بیرون بروند تروریست می‌شود و در روز می‌تواند یک نفر را با خودش بیرون ببرد.'),
  role('namayande', 'medic', 'پزشک', T, '🩺', 'هر شب یک نفر را نجات می‌دهد.', { kind: 'doctor' }),
  role('namayande', 'guide', 'راهنما', T, '🧭', 'یک نفر را انتخاب می‌کند؛ اگر شهروند باشد بیدار می‌شود و استعلام می‌گیرد و اگر مافیا باشد راهنما را می‌شناسد.', { night: true, order: 55 }),
  role('namayande', 'mine', 'مین‌گذار', T, '💥', 'شب اول جلوی خانه‌ی یک نفر مین می‌گذارد؛ اگر مافیا او را بزند، یک مافیا هم همراهش بیرون می‌رود.', { night: true, order: 56 }),
  role('namayande', 'lawyer', 'وکیل', T, '💼', 'یک بار در بازی وکالت یک نفر را می‌گیرد تا فردا وارد دفاعیه نشود.', { night: true, order: 57 }),
  role('namayande', 'bodyguard', 'محافظ', T, '🛡️', 'شب از یک نفر در برابر ترور یاغی محافظت می‌کند و خودش هم در برابر ترور ایمن است.', { night: true, order: 58 }),

  // مذاکره
  role('mozakere', 'boss', 'رئیس مافیا', M, '🎩', 'شلیک شب را تعیین می‌کند؛ استعلامش منفی است و تیر تک‌تیرانداز هم او را نمی‌کشد.', { kind: 'godfather', shotProof: true }),
  role('mozakere', 'negotiator', 'مذاکره‌کننده', M, '🤝', 'پس از خروج یکی از یارانش، یک بار به جای شلیک با یک نفر مذاکره می‌کند؛ فقط روی شهر ساده یا زره‌پوش موفق است.'),
  role('mozakere', 'reporter', 'خبرنگار', T, '📰', 'از شب مذاکره به بعد می‌تواند بپرسد آیا یک نفر به مافیا پیوسته است یا نه.', { night: true, order: 62 }),
  role('mozakere', 'sniper', 'تک‌تیرانداز', T, '🎯', 'یک تیر دارد؛ مافیا را بزند حذفش می‌کند، رئیس را بزند اثری ندارد و شهروند را بزند خودش می‌رود.', { kind: 'sniper', order: 70 }),
  role('mozakere', 'medic', 'پزشک', T, '🩺', 'هر شب یک نفر را نجات می‌دهد.', { kind: 'doctor', order: 80 }),
  role('mozakere', 'armor', 'زره‌پوش', T, '🦺', 'یک بار از تیر شب و یک بار از خروج با رأی جان سالم به در می‌برد.', { kind: 'diehard' }),

  // پدرخوانده
  role('pedarkhande', 'godfather', 'پدرخوانده', M, '🎩', 'شلیک شب با اوست، یک جلیقه دارد و می‌تواند به جای شلیک با «حس ششم» نقش کسی را درست حدس بزند تا او سلاخی شود.', { kind: 'godfather' }),
  role('pedarkhande', 'saul', 'ساول گودمن', M, '💼', 'اگر یک مافیا بیرون رفته باشد، یک بار به جای شلیک یک شهروند ساده را می‌خرد و مافیای ساده می‌کند.'),
  role('pedarkhande', 'matador', 'ماتادور', M, '🐂', 'هر شب توانایی یک نفر را برای همان شب می‌گیرد؛ دو شب پشت هم یک نفر را نه.', { night: true, order: 30 }),
  role('pedarkhande', 'nostradamus', 'نوستراداموس', 'indep', '🔮', 'شب معارفه تعداد مافیاهای میان سه نفر را می‌فهمد، سپس ساید برنده را انتخاب می‌کند و برای آن بازی می‌کند؛ در شب نمی‌میرد.', { night: true, order: 5, immune: true }),
  role('pedarkhande', 'doctor', 'دکتر', T, '🩺', 'هر شب جان یک نفر را نجات می‌دهد و فقط یک بار خودش را.', { kind: 'doctor' }),
  role('pedarkhande', 'leon', 'لئون', T, '🔫', 'حرفه‌ای شهر با دو تیر و یک جلیقه؛ اگر به شهروند شلیک کند خودش می‌میرد.', { kind: 'sniper', order: 55 }),
  role('pedarkhande', 'kane', 'همشهری کین', T, '📣', 'یک بار یک نفر را نشان می‌کند؛ اگر مافیا باشد صبح سایدش افشا می‌شود و خود کین شب بعد کشته می‌شود.', { night: true, order: 60 }),
  role('pedarkhande', 'constantine', 'کنستانتین', T, '✝️', 'یک بار یک بازیکن خارج‌شده (افشانشده) را به بازی برمی‌گرداند.', { night: true, order: 65 }),

  // کاپو
  role('capo', 'don', 'دان مافیا', M, '🎩', 'شلیک شب را تعیین می‌کند، استعلامش منفی است و یک پادزهر دارد.', { kind: 'godfather' }),
  role('capo', 'witch', 'جادوگر', M, '🧙', 'هر شب یک شهروند را جادو می‌کند تا توانایی‌اش روی خودش اعمال شود.', { night: true, order: 30 }),
  role('capo', 'executioner', 'جلاد', M, '🪓', 'یک بار به جای شلیک نقش یک شهروند را حدس می‌زند؛ اگر درست باشد او بیرون می‌رود.'),
  role('capo', 'armorer', 'زره‌ساز', T, '🛡️', 'هر شب یک نفر را نجات می‌دهد و فقط یک بار خودش را.', { kind: 'doctor' }),
  role('capo', 'herbalist', 'عطار', T, '🧪', 'یک زهر دارد که به یک نفر می‌دهد و شهر رأی می‌دهد که پادزهر بگیرد یا نه.', { night: true, order: 70 }),
  role('capo', 'heir', 'وارث', T, '👑', 'شب معارفه یک نفر را انتخاب می‌کند و با خروج او نقشش را به ارث می‌برد؛ تا آن زمان در شب نمی‌میرد.', { night: true, order: 5, immune: true }),
  role('capo', 'suspect', 'مظنون', T, '🤨', 'شهروند ساده‌ای که استعلامش برای کارآگاه مثبت است.', { detPos: true }),
];

export const SCENARIOS = [
  {
    id: 'classic',
    name: 'کلاسیک',
    players: 10,
    summary: 'سناریوی پایه: مافیا شب شلیک می‌کند، پزشک نجات می‌دهد، کارآگاه استعلام می‌گیرد و شهر در روز با رأی یک نفر را بیرون می‌کند.',
    roles: { s_classic_boss: 1, s_classic_terror: 1, mafia: 1, s_classic_medic: 1, detective: 1, s_classic_tough: 1 },
  },
  {
    id: 'takavar',
    name: 'تکاور',
    players: 10,
    summary: 'تفنگ‌دار شب تفنگ مشقی یا جنگی پخش می‌کند که فردا در روز شلیک می‌شود؛ گروگان‌گیر توانایی‌ها را می‌بندد و نگهبان از نقش‌ها محافظت می‌کند.',
    roles: { s_takavar_boss: 1, s_takavar_hostage: 1, s_takavar_nato: 1, s_takavar_guard: 1, detective: 1, s_takavar_commando: 1, s_takavar_medic: 1, s_takavar_gunner: 1 },
  },
  {
    id: 'bazpors',
    name: 'بازپرس',
    players: 10,
    summary: 'بازپرس یک بار دو نفر را به بازپرسی می‌برد تا شهر فقط بین آن دو رأی بدهد؛ رئیس مافیا هم یک بار با «سوداگری» یار تازه می‌گیرد.',
    roles: { s_bazpors_boss: 1, s_bazpors_fraud: 1, s_bazpors_nato: 1, s_bazpors_researcher: 1, detective: 1, s_bazpors_medic: 1, s_bazpors_judge: 1, s_bazpors_tough: 1 },
  },
  {
    id: 'namayande',
    name: 'نماینده',
    players: 10,
    summary: 'روز اول به جای رأی‌گیری آزاد دو نماینده انتخاب می‌شوند که هر کدام یک نفر را متهم می‌کنند؛ دان مافیا با «رأی خیانت» یک رأی کم یا زیاد می‌کند.',
    roles: { s_namayande_don: 1, s_namayande_hacker: 1, s_namayande_rebel: 1, s_namayande_medic: 1, s_namayande_guide: 1, s_namayande_mine: 1, s_namayande_lawyer: 1, s_namayande_bodyguard: 1 },
  },
  {
    id: 'mozakere',
    name: 'مذاکره',
    players: 10,
    summary: 'وقتی یکی از مافیاها بیرون رفته باشد، مذاکره‌کننده یک بار به جای شلیک با یک نفر مذاکره می‌کند؛ اگر او شهر ساده یا زره‌پوش باشد به مافیا می‌پیوندد.',
    roles: { s_mozakere_boss: 1, s_mozakere_negotiator: 1, mafia: 1, detective: 1, s_mozakere_reporter: 1, s_mozakere_sniper: 1, s_mozakere_medic: 1, s_mozakere_armor: 1 },
  },
  {
    id: 'pedarkhande',
    name: 'پدرخوانده',
    players: 11,
    summary: 'کسی که در روز با رأی بیرون می‌رود یک «کارت حرکت آخر» برمی‌دارد: سکوت بره‌ها، دستبند، افشای هویت، ذهن زیبا یا تغییر چهره.',
    roles: { s_pedarkhande_godfather: 1, s_pedarkhande_saul: 1, s_pedarkhande_matador: 1, s_pedarkhande_nostradamus: 1, s_pedarkhande_doctor: 1, s_pedarkhande_leon: 1, s_pedarkhande_kane: 1, s_pedarkhande_constantine: 1 },
  },
  {
    id: 'capo',
    name: 'کاپو',
    players: 10,
    summary: 'روز اول یک «معتمد» انتخاب می‌شود که دو تارگت تعیین می‌کند؛ مافیا یک تیر مشقی و یک تیر جنگی در تفنگ کاپو می‌گذارد و معتمد شلیک می‌کند.',
    roles: { s_capo_don: 1, s_capo_witch: 1, s_capo_executioner: 1, s_capo_armorer: 1, detective: 1, s_capo_herbalist: 1, s_capo_heir: 1, s_capo_suspect: 1 },
  },
];
