// Usage statistics and medals. A game counts once it ends with a winner.
// The same numbers feed Game Center (weekly and monthly leaderboards of
// games hosted, achievements) on iPhone and the "Stats and medals" card on
// every platform. Pure functions; app.js stores the result.

export const LEADERBOARDS = {
  week: 'com.espadna.mafia.games.week',
  month: 'com.espadna.mafia.games.month',
};

const ACH = 'com.espadna.mafia.ach.';
const DAY = 24 * 60 * 60 * 1000;

const ratio = (have, need) => Math.min(100, Math.floor((100 * have) / need));

/**
 * Medals: `key` names the texts ('medal.<key>' and 'medal.<key>.desc' in
 * the language files), `points` are Game Center points (total ≤ 1000),
 * `progress(stats, library)` returns 0–100.
 */
export const MEDALS = [
  { key: 'first_game', points: 10, progress: (s) => ratio(s.total, 1) },
  { key: 'games_10', points: 20, progress: (s) => ratio(s.total, 10) },
  { key: 'games_50', points: 40, progress: (s) => ratio(s.total, 50) },
  { key: 'games_100', points: 60, progress: (s) => ratio(s.total, 100) },
  { key: 'games_250', points: 100, progress: (s) => ratio(s.total, 250) },
  { key: 'big_table', points: 30, progress: (s) => (s.games.some((g) => g.players >= 15) ? 100 : 0) },
  { key: 'long_game', points: 30, progress: (s) => (s.games.some((g) => g.nights >= 5) ? 100 : 0) },
  { key: 'explorer', points: 30, progress: (s) => ratio(new Set(s.games.map((g) => g.scenario || 'auto')).size, 3) },
  { key: 'own_brand', points: 20, progress: (s, lib) => (lib?.brand?.name?.trim() || lib?.brand?.logo ? 100 : 0) },
  { key: 'own_role', points: 20, progress: (s, lib) => (lib?.roles?.length ? 100 : 0) },
  { key: 'own_scenario', points: 20, progress: (s, lib) => (lib?.scenarios?.length ? 100 : 0) },
].map((m) => ({ ...m, id: ACH + m.key }));

const KEEP = 600; // enough for any month; older games only add to `total`

export function emptyStats() {
  return { total: 0, games: [] };
}

/** Adds a finished game unless it was already counted (undo, reload). */
export function recordGame(stats, game) {
  const s = stats && Array.isArray(stats.games) ? stats : emptyStats();
  if (s.games.some((g) => g.id === game.id)) return s;
  const games = [...s.games, { id: game.id, at: game.at, players: game.players, nights: game.nights, scenario: game.scenario }];
  return { total: (s.total || 0) + 1, games: games.slice(-KEEP) };
}

/** Games in the last 7 and 30 days (the phone's own view; Game Center keeps its own periods). */
export function recentCounts(stats, now = Date.now()) {
  const games = stats?.games || [];
  return {
    week: games.filter((g) => g.at > now - 7 * DAY).length,
    month: games.filter((g) => g.at > now - 30 * DAY).length,
    total: stats?.total || 0,
  };
}

/** [{ id, key, points, percent }] for every medal. */
export function medalProgress(stats, library) {
  const s = stats && Array.isArray(stats.games) ? stats : emptyStats();
  return MEDALS.map((m) => ({ id: m.id, key: m.key, points: m.points, percent: m.progress(s, library) }));
}
