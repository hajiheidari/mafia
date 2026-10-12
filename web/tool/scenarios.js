// Ready-made scenarios. `roles` maps role id → count for the standard deck;
// plain citizens are added or removed to match the number of players (see
// fitScenario). `langs` lists the languages that offer the scenario: the
// Persian scenarios are Iranian, others suit the rest of the world, and
// Russia has its own club formats. Names and texts live in lang/<code>.js
// under 'sc.<id>' / 'sc.<id>.summary' and, for scenario roles,
// 'sr.<role id>' / 'sr.<role id>.desc'.
//
// A scenario role either borrows a built-in mechanic through `kind` (e.g. the
// boss works like the godfather: detective reads negative) or, with
// `night: true`, is woken by the tool and its effect applied by the narrator.
// `order` is its place in the night (mafia team 20, doctor 50, detective 60,
// sniper 70). Iranian rosters follow the 10-player decks of mafia.farid.one
// (11 for pedarkhande); house rules vary, so every role stays editable.

const WORLD = ['en', 'ar', 'ur', 'ru'];

export const SCENARIO_ROLES = [
  { id: 's_classic_boss', scenario: 'classic', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_classic_terror', scenario: 'classic', team: 'mafia', icon: '💣' },
  { id: 's_classic_medic', scenario: 'classic', team: 'town', icon: '🩺', kind: 'doctor' },
  { id: 's_classic_tough', scenario: 'classic', team: 'town', icon: '🛡️', immune: true },
  { id: 's_takavar_boss', scenario: 'takavar', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_takavar_hostage', scenario: 'takavar', team: 'mafia', icon: '⛓️', night: true, order: 15 },
  { id: 's_takavar_nato', scenario: 'takavar', team: 'mafia', icon: '🎯' },
  { id: 's_takavar_guard', scenario: 'takavar', team: 'town', icon: '💂', night: true, order: 10 },
  { id: 's_takavar_commando', scenario: 'takavar', team: 'town', icon: '🪖', night: true, order: 65 },
  { id: 's_takavar_medic', scenario: 'takavar', team: 'town', icon: '🩺', kind: 'doctor', order: 68 },
  { id: 's_takavar_gunner', scenario: 'takavar', team: 'town', icon: '🔫', night: true, order: 90 },
  { id: 's_bazpors_boss', scenario: 'bazpors', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_bazpors_fraud', scenario: 'bazpors', team: 'mafia', icon: '🃏', night: true, order: 30 },
  { id: 's_bazpors_nato', scenario: 'bazpors', team: 'mafia', icon: '🎯' },
  { id: 's_bazpors_researcher', scenario: 'bazpors', team: 'town', icon: '🔗', night: true, order: 10 },
  { id: 's_bazpors_medic', scenario: 'bazpors', team: 'town', icon: '🩺', kind: 'doctor', order: 70 },
  { id: 's_bazpors_judge', scenario: 'bazpors', team: 'town', icon: '⚖️', night: true, order: 80 },
  { id: 's_bazpors_tough', scenario: 'bazpors', team: 'town', icon: '🛡️', immune: true },
  { id: 's_namayande_don', scenario: 'namayande', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_namayande_hacker', scenario: 'namayande', team: 'mafia', icon: '💻', night: true, order: 25 },
  { id: 's_namayande_rebel', scenario: 'namayande', team: 'mafia', icon: '🧨' },
  { id: 's_namayande_medic', scenario: 'namayande', team: 'town', icon: '🩺', kind: 'doctor' },
  { id: 's_namayande_guide', scenario: 'namayande', team: 'town', icon: '🧭', night: true, order: 55 },
  { id: 's_namayande_mine', scenario: 'namayande', team: 'town', icon: '💥', night: true, order: 56 },
  { id: 's_namayande_lawyer', scenario: 'namayande', team: 'town', icon: '💼', night: true, order: 57 },
  { id: 's_namayande_bodyguard', scenario: 'namayande', team: 'town', icon: '🛡️', night: true, order: 58 },
  { id: 's_mozakere_boss', scenario: 'mozakere', team: 'mafia', icon: '🎩', kind: 'godfather', shotProof: true },
  { id: 's_mozakere_negotiator', scenario: 'mozakere', team: 'mafia', icon: '🤝' },
  { id: 's_mozakere_reporter', scenario: 'mozakere', team: 'town', icon: '📰', night: true, order: 62 },
  { id: 's_mozakere_sniper', scenario: 'mozakere', team: 'town', icon: '🎯', kind: 'sniper', order: 70 },
  { id: 's_mozakere_medic', scenario: 'mozakere', team: 'town', icon: '🩺', kind: 'doctor', order: 80 },
  { id: 's_mozakere_armor', scenario: 'mozakere', team: 'town', icon: '🦺', kind: 'diehard' },
  { id: 's_pedarkhande_godfather', scenario: 'pedarkhande', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_pedarkhande_saul', scenario: 'pedarkhande', team: 'mafia', icon: '💼' },
  { id: 's_pedarkhande_matador', scenario: 'pedarkhande', team: 'mafia', icon: '🐂', night: true, order: 30 },
  { id: 's_pedarkhande_nostradamus', scenario: 'pedarkhande', team: 'indep', icon: '🔮', night: true, order: 5, immune: true },
  { id: 's_pedarkhande_doctor', scenario: 'pedarkhande', team: 'town', icon: '🩺', kind: 'doctor' },
  { id: 's_pedarkhande_leon', scenario: 'pedarkhande', team: 'town', icon: '🔫', kind: 'sniper', order: 55 },
  { id: 's_pedarkhande_kane', scenario: 'pedarkhande', team: 'town', icon: '📣', night: true, order: 60 },
  { id: 's_pedarkhande_constantine', scenario: 'pedarkhande', team: 'town', icon: '✝️', night: true, order: 65 },
  { id: 's_capo_don', scenario: 'capo', team: 'mafia', icon: '🎩', kind: 'godfather' },
  { id: 's_capo_witch', scenario: 'capo', team: 'mafia', icon: '🧙', night: true, order: 30 },
  { id: 's_capo_executioner', scenario: 'capo', team: 'mafia', icon: '🪓' },
  { id: 's_capo_armorer', scenario: 'capo', team: 'town', icon: '🛡️', kind: 'doctor' },
  { id: 's_capo_herbalist', scenario: 'capo', team: 'town', icon: '🧪', night: true, order: 70 },
  { id: 's_capo_heir', scenario: 'capo', team: 'town', icon: '👑', night: true, order: 5, immune: true },
  { id: 's_capo_suspect', scenario: 'capo', team: 'town', icon: '🤨', detPos: true },

  // Rest of the world
  { id: 's_w_jester', scenario: 'w_jester', team: 'indep', icon: '🤡' },

  // Russia: sport and city mafia
  { id: 's_ru_don', scenario: 'ru_sport', team: 'mafia', icon: '🎩', night: true, order: 25 },
  { id: 's_ru_sheriff', scenario: 'ru_sport', team: 'town', icon: '⭐', kind: 'detective' },
  { id: 's_ru_commissar', scenario: 'ru_city', team: 'town', icon: '🕵️', kind: 'detective' },
  { id: 's_ru_lover', scenario: 'ru_city', team: 'town', icon: '💋', night: true, order: 15 },
  { id: 's_ru_maniac', scenario: 'ru_city', team: 'indep', icon: '🔪', night: true, order: 75 },
];

export const SCENARIOS = [
  { id: 'classic', players: 10, roles: { s_classic_boss: 1, s_classic_terror: 1, mafia: 1, s_classic_medic: 1, detective: 1, s_classic_tough: 1 }, langs: ['fa'] },
  { id: 'takavar', players: 10, roles: { s_takavar_boss: 1, s_takavar_hostage: 1, s_takavar_nato: 1, s_takavar_guard: 1, detective: 1, s_takavar_commando: 1, s_takavar_medic: 1, s_takavar_gunner: 1 }, langs: ['fa'] },
  { id: 'bazpors', players: 10, roles: { s_bazpors_boss: 1, s_bazpors_fraud: 1, s_bazpors_nato: 1, s_bazpors_researcher: 1, detective: 1, s_bazpors_medic: 1, s_bazpors_judge: 1, s_bazpors_tough: 1 }, langs: ['fa'] },
  { id: 'namayande', players: 10, roles: { s_namayande_don: 1, s_namayande_hacker: 1, s_namayande_rebel: 1, s_namayande_medic: 1, s_namayande_guide: 1, s_namayande_mine: 1, s_namayande_lawyer: 1, s_namayande_bodyguard: 1 }, langs: ['fa'] },
  { id: 'mozakere', players: 10, roles: { s_mozakere_boss: 1, s_mozakere_negotiator: 1, mafia: 1, detective: 1, s_mozakere_reporter: 1, s_mozakere_sniper: 1, s_mozakere_medic: 1, s_mozakere_armor: 1 }, langs: ['fa'] },
  { id: 'pedarkhande', players: 11, roles: { s_pedarkhande_godfather: 1, s_pedarkhande_saul: 1, s_pedarkhande_matador: 1, s_pedarkhande_nostradamus: 1, s_pedarkhande_doctor: 1, s_pedarkhande_leon: 1, s_pedarkhande_kane: 1, s_pedarkhande_constantine: 1 }, langs: ['fa'] },
  { id: 'capo', players: 10, roles: { s_capo_don: 1, s_capo_witch: 1, s_capo_executioner: 1, s_capo_armorer: 1, detective: 1, s_capo_herbalist: 1, s_capo_heir: 1, s_capo_suspect: 1 }, langs: ['fa'] },
  { id: 'w_classic', players: 8, langs: WORLD, roles: { mafia: 2, doctor: 1, detective: 1 } },
  { id: 'w_godfather', players: 10, langs: WORLD, roles: { godfather: 1, mafia: 2, doctor: 1, detective: 1, sniper: 1 } },
  { id: 'w_jester', players: 10, langs: WORLD, roles: { godfather: 1, mafia: 2, doctor: 1, detective: 1, s_w_jester: 1 } },
  { id: 'ru_sport', players: 10, langs: ['ru'], roles: { s_ru_don: 1, mafia: 2, s_ru_sheriff: 1 } },
  { id: 'ru_city', players: 10, langs: ['ru'], roles: { mafia: 2, s_ru_commissar: 1, doctor: 1, s_ru_lover: 1, s_ru_maniac: 1 } },
];
