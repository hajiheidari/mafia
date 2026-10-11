import { describe, test, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createGuestUser,
  createRoom,
  createGameSession,
  getSessionById,
  casApplyPhaseTransition,
  pool,
} from '@platform/db';
import { createDbPhaseSchedulerStorage } from '@platform/core';
import { PhaseScheduler, type PhaseTransition, type SchedulableSession } from '@platform/game-engine';
import type { GameDefinition } from '@platform/types';

/**
 * A tiny timed game, private to this file — the scheduler must work for
 * ANY game that implements getPhaseEndsAt, so it's tested without Mafia.
 * Phases: A → B → C → DONE. Each phase lasts `phaseMs`.
 */
interface TimedState {
  phase: 'A' | 'B' | 'C' | 'DONE' | 'UNTIMED';
  endsAt: number | null;
  phaseMs: number;
}

let clock = Date.now();
const now = () => clock;

const NEXT: Record<string, TimedState['phase']> = { A: 'B', B: 'C', C: 'DONE' };

const SchedulerTestGame: GameDefinition<TimedState, never, { phaseMs: number }> = {
  id: 'scheduler-test-game',
  name: 'scheduler test',
  description: '',
  icon: '',
  minPlayers: 1,
  maxPlayers: 10,
  defaultConfig: { phaseMs: 50 },
  createInitialState: (_p, c) => ({ phase: 'A', endsAt: now() + c.phaseMs, phaseMs: c.phaseMs }),
  validateAction: () => ({ valid: false }),
  applyAction: (s) => ({ nextState: s, events: [] }),
  getNextPhase(s) {
    const next = NEXT[s.phase];
    if (!next) return null;
    return {
      nextState: { ...s, phase: next, endsAt: next === 'DONE' ? null : now() + s.phaseMs },
      events: [{ type: 'PHASE_STARTED', phase: next, endsAt: null }],
    };
  },
  checkWinCondition: (s) => (s.phase === 'DONE' ? { winnerSide: 'nobody' } : null),
  getPlayerView: (s) => ({ phase: s.phase }),
  getPhaseEndsAt: (s) => (s.phase === 'UNTIMED' ? null : s.endsAt),
};

const getDefinition = (id: string) => (id === SchedulerTestGame.id ? SchedulerTestGame : undefined);

let roomId: string;

beforeAll(async () => {
  const user = await createGuestUser(`sched-test-${randomUUID()}`);
  const { room } = await createRoom({ hostUserId: user.id, gameId: null });
  roomId = room.id;
});

async function newSession(state: TimedState): Promise<SchedulableSession> {
  const row = await createGameSession(roomId, SchedulerTestGame.id, state);
  return { sessionId: row.id, roomId, gameId: row.gameId, stateVersion: 0, state };
}

function makeScheduler() {
  const transitions: { session: SchedulableSession; t: PhaseTransition }[] = [];
  const scheduler = new PhaseScheduler(
    createDbPhaseSchedulerStorage(),
    { onTransition: (session, t) => void transitions.push({ session, t }) },
    { now, getDefinition },
  );
  return { scheduler, transitions };
}

async function eventCount(sessionId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM game_events WHERE "sessionId" = $1`, [sessionId]);
  return rows[0].n;
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 2000) {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PhaseScheduler (generic, game-agnostic)', () => {
  test('advances automatically when the phase timer expires', async () => {
    clock = Date.now();
    const { scheduler, transitions } = makeScheduler();
    const session = await newSession({ phase: 'A', endsAt: clock + 40, phaseMs: 100_000 });

    await scheduler.scheduleFromSession(session);
    expect(scheduler.pendingCount).toBe(1);
    clock += 40; // the timer's own setTimeout fires in real time; our clock agrees it's due

    await waitFor(async () => (await getSessionById(session.sessionId))!.stateVersion === 1);
    const row = await getSessionById(session.sessionId);
    expect((row!.state as TimedState).phase).toBe('B');
    expect(transitions).toHaveLength(1);
    expect(await eventCount(session.sessionId)).toBe(1);
    scheduler.cancelAll();
  });

  test('a game without a timer (null endsAt) is never advanced', async () => {
    const { scheduler, transitions } = makeScheduler();
    const session = await newSession({ phase: 'UNTIMED', endsAt: null, phaseMs: 10 });
    await scheduler.scheduleFromSession(session);
    expect(scheduler.pendingCount).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect((await getSessionById(session.sessionId))!.stateVersion).toBe(0);
    expect(transitions).toHaveLength(0);
  });

  test('recoverAll() advances an overdue session immediately (restart recovery)', async () => {
    clock = Date.now();
    const session = await newSession({ phase: 'A', endsAt: clock - 5_000, phaseMs: 60_000 });

    // A brand-new scheduler = a freshly restarted server with no timers.
    const { scheduler, transitions } = makeScheduler();
    await scheduler.recoverAll();

    const row = await getSessionById(session.sessionId);
    expect(row!.stateVersion).toBe(1);
    expect((row!.state as TimedState).phase).toBe('B');
    expect(transitions.some((t) => t.session.sessionId === session.sessionId)).toBe(true);
    scheduler.cancelAll();
  });

  test('batch recovery: overdue phases chain forward until a non-overdue phase or the end', async () => {
    clock = Date.now();
    // phaseMs = 0 → every following phase is due immediately as well, so
    // recovery must walk A → B → C → DONE in order, one version each.
    const session = await newSession({ phase: 'A', endsAt: clock - 1, phaseMs: 0 });
    const { scheduler, transitions } = makeScheduler();
    await scheduler.recoverAll();

    const row = await getSessionById(session.sessionId);
    expect((row!.state as TimedState).phase).toBe('DONE');
    expect(row!.stateVersion).toBe(3);
    expect(row!.endedAt).not.toBeNull(); // finished game → session ended
    const mine = transitions.filter((t) => t.session.sessionId === session.sessionId);
    expect(mine.map((t) => (t.t.nextState as TimedState).phase)).toEqual(['B', 'C', 'DONE']);
    expect(mine[2]!.t.finished).toBe(true);
    expect(await eventCount(session.sessionId)).toBe(3);
  });

  test('race: two concurrent advances of the same due phase → exactly one wins, version +1 only', async () => {
    clock = Date.now();
    const session = await newSession({ phase: 'A', endsAt: clock - 1, phaseMs: 60_000 });

    // Two independent schedulers = e.g. a timer firing twice, or two
    // server processes; they share only the database.
    const s1 = makeScheduler();
    const s2 = makeScheduler();
    await Promise.all([s1.scheduler.scheduleFromSession(session), s2.scheduler.scheduleFromSession(session)]);

    const row = await getSessionById(session.sessionId);
    expect(row!.stateVersion).toBe(1);
    expect((row!.state as TimedState).phase).toBe('B');
    expect(s1.transitions.length + s2.transitions.length).toBe(1);
    expect(await eventCount(session.sessionId)).toBe(1);
    s1.scheduler.cancelAll();
    s2.scheduler.cancelAll();
  });

  test('CAS with a stale expectedVersion fails and leaves the row untouched', async () => {
    const session = await newSession({ phase: 'A', endsAt: null, phaseMs: 1 });
    expect(
      await casApplyPhaseTransition({ sessionId: session.sessionId, expectedVersion: 0, nextVersion: 1, nextState: { phase: 'B' } }),
    ).toBe(true);
    expect(
      await casApplyPhaseTransition({ sessionId: session.sessionId, expectedVersion: 0, nextVersion: 1, nextState: { phase: 'C' } }),
    ).toBe(false);
    const row = await getSessionById(session.sessionId);
    expect(row!.stateVersion).toBe(1);
    expect((row!.state as TimedState).phase).toBe('B');
  });
});
