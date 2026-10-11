import type { DomainEvent, GameDefinition } from '@platform/types';
import { GameRegistry } from './registry';

/**
 * Generic, game-agnostic phase timer. A game opts in by implementing
 * `getPhaseEndsAt(state)`; when that moment passes the scheduler runs
 * `getNextPhase(state)` and writes the result with a compare-and-swap on
 * stateVersion, so a timer firing twice, or racing a player action / a
 * player leaving, can only ever advance the session ONCE.
 *
 * The scheduler holds no authoritative state of its own: every tick
 * re-reads the session from storage. Timers are an in-process optimisation;
 * `recoverAll()` rebuilds them from storage after a restart.
 */

export interface SchedulableSession {
  sessionId: string;
  roomId: string;
  gameId: string;
  stateVersion: number;
  state: unknown;
}

export interface PhaseSchedulerStorage {
  loadSession(sessionId: string): Promise<SchedulableSession | null>;
  /** Atomic: writes only if the stored version still equals expectedVersion. */
  casApplyTransition(params: {
    sessionId: string;
    expectedVersion: number;
    nextVersion: number;
    nextState: unknown;
  }): Promise<boolean>;
  persistEvents(sessionId: string, events: DomainEvent[]): Promise<void>;
  listActiveSessions(): Promise<SchedulableSession[]>;
  /** Marks the session ended (game reached its terminal state). */
  endSession(sessionId: string): Promise<void>;
}

export interface PhaseTransition {
  nextState: unknown;
  nextVersion: number;
  events: DomainEvent[];
  finished: boolean;
}

export interface PhaseSchedulerCallbacks {
  onTransition(session: SchedulableSession, transition: PhaseTransition): void | Promise<void>;
  onError?(err: unknown, sessionId: string): void;
}

export interface PhaseSchedulerOptions {
  now?: () => number;
  getDefinition?: (gameId: string) => GameDefinition<any, any, any> | undefined;
}

/** True once the game reports a result — used to set the session's endedAt. */
export function isGameFinished(definition: GameDefinition<any, any, any>, state: unknown): boolean {
  return definition.checkWinCondition(state) !== null;
}

export class PhaseScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private now: () => number;
  private getDefinition: (gameId: string) => GameDefinition<any, any, any> | undefined;

  constructor(
    private storage: PhaseSchedulerStorage,
    private callbacks: PhaseSchedulerCallbacks,
    options: PhaseSchedulerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.getDefinition = options.getDefinition ?? ((id) => GameRegistry.get(id));
  }

  /**
   * (Re)arms the timer for this session from its CURRENT state. Safe to call
   * after any state change (action, leave, start). If the phase is already
   * overdue the advance runs immediately and the returned promise settles
   * once that advance (and any chained overdue advances) is done.
   */
  async scheduleFromSession(session: SchedulableSession): Promise<void> {
    this.cancel(session.sessionId);

    const definition = this.getDefinition(session.gameId);
    if (!definition?.getPhaseEndsAt) return;
    if (isGameFinished(definition, session.state)) return;

    const endsAt = definition.getPhaseEndsAt(session.state);
    if (endsAt === null || endsAt === undefined) return;

    const delay = endsAt - this.now();
    if (delay <= 0) {
      await this.tryAdvance(session.sessionId, session.stateVersion);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(session.sessionId);
      void this.tryAdvance(session.sessionId, session.stateVersion);
    }, delay);
    timer.unref?.();
    this.timers.set(session.sessionId, timer);
  }

  /** On startup: re-arm every active session; overdue phases advance immediately. */
  async recoverAll(): Promise<void> {
    const sessions = await this.storage.listActiveSessions();
    for (const session of sessions) {
      try {
        await this.scheduleFromSession(session);
      } catch (err) {
        this.reportError(err, session.sessionId);
      }
    }
  }

  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Number of armed timers — for tests/diagnostics. */
  get pendingCount(): number {
    return this.timers.size;
  }

  private async tryAdvance(sessionId: string, expectedVersion: number): Promise<void> {
    try {
      const session = await this.storage.loadSession(sessionId);
      if (!session) return; // ended or deleted

      // Something else (an action, a leave, another timer) already moved
      // the session on. Not an error: just re-arm from what is stored now.
      if (session.stateVersion !== expectedVersion) {
        await this.scheduleFromSession(session);
        return;
      }

      const definition = this.getDefinition(session.gameId);
      if (!definition?.getPhaseEndsAt) return;

      // setTimeout may fire a hair early; never advance a phase before its time.
      const endsAt = definition.getPhaseEndsAt(session.state);
      if (endsAt === null || endsAt === undefined) return;
      if (endsAt > this.now()) {
        await this.scheduleFromSession(session);
        return;
      }

      const result = definition.getNextPhase(session.state);
      if (!result) return;

      const nextVersion = session.stateVersion + 1;
      const won = await this.storage.casApplyTransition({
        sessionId,
        expectedVersion: session.stateVersion,
        nextVersion,
        nextState: result.nextState,
      });
      if (!won) {
        // Lost the race — reload and re-arm, never blindly retry the write.
        const fresh = await this.storage.loadSession(sessionId);
        if (fresh) await this.scheduleFromSession(fresh);
        return;
      }

      const finished = isGameFinished(definition, result.nextState);
      await this.storage.persistEvents(sessionId, result.events);
      if (finished) await this.storage.endSession(sessionId);

      const nextSession: SchedulableSession = {
        ...session,
        stateVersion: nextVersion,
        state: result.nextState,
      };
      await this.callbacks.onTransition(session, {
        nextState: result.nextState,
        nextVersion,
        events: result.events,
        finished,
      });

      if (!finished) await this.scheduleFromSession(nextSession);
    } catch (err) {
      this.reportError(err, sessionId);
    }
  }

  private reportError(err: unknown, sessionId: string): void {
    if (this.callbacks.onError) this.callbacks.onError(err, sessionId);
    else console.error('PhaseScheduler error', sessionId, err);
  }
}
