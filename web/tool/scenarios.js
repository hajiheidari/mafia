// Ready-made scenarios. `roles` maps role id → count; plain citizens are
// added on top to match the number of players (see fitScenario). Roles that
// are not built in are defined in SCENARIO_ROLES; ids start with `s_`.

export const SCENARIO_ROLES = [];

export const SCENARIOS = [
  {
    id: 'classic',
    name: 'کلاسیک ساده',
    players: 10,
    summary: 'پدرخوانده و مافیا در برابر دکتر و کارآگاه. مناسب شروع و جمع‌های تازه‌کار.',
    roles: { godfather: 1, mafia: 2, doctor: 1, detective: 1 },
  },
];
