import { describe, expect, test } from 'vitest';
import { GameRegistry, createInitialSession } from '@platform/game-engine';
import { FakeGameDefinition } from '@platform/game-fake';
import type { GamePlayer } from '@platform/types';

// This test is written ONCE, at the engine level, and automatically covers
// every game registered in GameRegistry — including future games like
// Mafia. See ARCHITECTURE.md §7. It never needs to know what a "secret"
// looks like for a given game beyond: whatever appears in one player's view
// under a field the game calls secret-ish must not appear in another
// player's view.

const players: GamePlayer[] = [
  { id: 'p1', displayName: 'Player One', avatarUrl: null },
  { id: 'p2', displayName: 'Player Two', avatarUrl: null },
  { id: 'p3', displayName: 'Player Three', avatarUrl: null },
];

// Registration happens at module load time (not inside beforeAll) because
// Vitest collects `test()` calls by evaluating the file synchronously,
// before any beforeAll hook runs — the for-loop below needs the registry
// populated already.
GameRegistry._resetForTests();
GameRegistry.register(FakeGameDefinition);

describe('information leak prevention (runs for every registered game)', () => {
  for (const definition of GameRegistry.all()) {
    test(`${definition.id}: no player view exposes another player's secretNumber`, () => {
      const session = createInitialSession(definition, players, definition.defaultConfig);

      const views = players.map((p) => ({
        playerId: p.id,
        view: definition.getPlayerView(session.state, p.id) as {
          you: { secretNumber: number };
        },
      }));

      for (const { playerId, view } of views) {
        const viewStr = JSON.stringify(view);
        for (const other of players) {
          if (other.id === playerId) continue;
          const otherView = views.find((v) => v.playerId === other.id)!.view;
          const otherSecret = String(otherView.you.secretNumber);
          // Exact-value match on the "secretNumber":<n> field, not a plain
          // substring search — "secretNumber":6 is a substring of
          // "secretNumber":60, which would false-positive as a leak between
          // two DIFFERENT numbers that merely share a digit prefix. The
          // regex requires the number to end exactly there (comma/brace/
          // whitespace or end of string follows).
          const exactFieldPattern = new RegExp(`"secretNumber":${otherSecret}(?=[,}\\s]|$)`);
          expect(exactFieldPattern.test(viewStr)).toBe(false);
        }
      }
    });

    test(`${definition.id}: each player only sees their own secretNumber`, () => {
      const session = createInitialSession(definition, players, definition.defaultConfig);
      for (const p of players) {
        const view = definition.getPlayerView(session.state, p.id) as {
          you: { id: string; secretNumber: number };
          others: { id: string }[];
        };
        expect(view.you.id).toBe(p.id);
        expect(view.others.every((o) => !('secretNumber' in o))).toBe(true);
      }
    });
  }
});
