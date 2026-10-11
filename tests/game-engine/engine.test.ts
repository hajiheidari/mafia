import { describe, expect, test, beforeEach } from 'vitest';
import { createInitialSession, processAction, type IdempotencyStore, type ActionOutcome } from '@platform/game-engine';
import { FakeGameDefinition } from '@platform/game-fake';
import type { GamePlayer } from '@platform/types';

const players: GamePlayer[] = [
  { id: 'p1', displayName: 'Player One', avatarUrl: null },
  { id: 'p2', displayName: 'Player Two', avatarUrl: null },
];

// In-memory stand-in for the Redis-backed store the real server uses.
// See ARCHITECTURE.md §8.
function createMemoryIdempotencyStore(): IdempotencyStore {
  const store = new Map<string, ActionOutcome>();
  return {
    async get(actionId) {
      return store.get(actionId);
    },
    async set(actionId, outcome) {
      store.set(actionId, outcome);
    },
  };
}

describe('game engine action pipeline', () => {
  let idempotency: IdempotencyStore;

  beforeEach(() => {
    idempotency = createMemoryIdempotencyStore();
  });

  test('applying a valid action increments stateVersion and returns events', async () => {
    const session = createInitialSession(FakeGameDefinition, players, FakeGameDefinition.defaultConfig);
    const outcome = await processAction(
      FakeGameDefinition,
      session,
      'p1',
      { actionId: 'action-1', clientStateVersion: 0, action: { type: 'PING' } },
      idempotency,
    );

    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') {
      expect(outcome.session.stateVersion).toBe(1);
      expect(outcome.events.some((e) => e.type === 'PLAYER_ACTION')).toBe(true);
    }
  });

  test('replaying the same actionId returns the cached outcome, not a second increment', async () => {
    const session = createInitialSession(FakeGameDefinition, players, FakeGameDefinition.defaultConfig);
    const envelope = { actionId: 'dup-action', clientStateVersion: 0, action: { type: 'PING' as const } };

    const first = await processAction(FakeGameDefinition, session, 'p1', envelope, idempotency);
    expect(first.kind).toBe('APPLIED');
    const sessionAfterFirst = first.kind === 'APPLIED' ? first.session : session;

    // Simulate the client retrying the exact same action (e.g. after a
    // dropped ack during a reconnect).
    const second = await processAction(FakeGameDefinition, sessionAfterFirst, 'p1', envelope, idempotency);

    expect(second).toEqual(first);
    if (second.kind === 'APPLIED') {
      expect(second.session.stateVersion).toBe(1); // NOT 2 — action was not re-applied
    }
  });

  test('a stale clientStateVersion triggers SYNC_REQUIRED instead of applying', async () => {
    let session = createInitialSession(FakeGameDefinition, players, FakeGameDefinition.defaultConfig);

    const bump = await processAction(
      FakeGameDefinition,
      session,
      'p1',
      { actionId: 'a1', clientStateVersion: 0, action: { type: 'PING' } },
      idempotency,
    );
    if (bump.kind === 'APPLIED') session = bump.session; // stateVersion now 1

    const stale = await processAction(
      FakeGameDefinition,
      session,
      'p2',
      { actionId: 'a2-stale', clientStateVersion: 0, action: { type: 'PING' } }, // client still thinks version 0
      idempotency,
    );

    expect(stale.kind).toBe('SYNC_REQUIRED');
  });

  test('an invalid action is rejected without mutating state', async () => {
    const session = createInitialSession(FakeGameDefinition, players, FakeGameDefinition.defaultConfig);
    const outcome = await processAction(
      FakeGameDefinition,
      session,
      'not-a-real-player',
      { actionId: 'bad-1', clientStateVersion: 0, action: { type: 'PING' } },
      idempotency,
    );
    expect(outcome.kind).toBe('REJECTED');
  });

  test('acceptsStaleClientVersion (opt-in) lets a one-broadcast-behind client act; default still requires a sync', async () => {
    const session = { ...createInitialSession(FakeGameDefinition, players, FakeGameDefinition.defaultConfig), stateVersion: 3 };
    const env = { actionId: 'stale-1', clientStateVersion: 2, action: { type: 'PING' } as const };
    expect((await processAction(FakeGameDefinition, session, 'p1', env, idempotency)).kind).toBe('SYNC_REQUIRED');

    const lenient = { ...FakeGameDefinition, acceptsStaleClientVersion: true };
    const outcome = await processAction(lenient, session, 'p1', { ...env, actionId: 'stale-2' }, idempotency);
    expect(outcome.kind).toBe('APPLIED');
    if (outcome.kind === 'APPLIED') expect(outcome.session.stateVersion).toBe(4);
  });
});
