import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  bootTestServer,
  loginAsNewGuest,
  createRoom,
  connectSocket,
  waitForEvent,
  waitForConnect,
  sleep,
  type TestContext,
  type GuestSession,
} from './testServer';
import { getSessionById, pool } from '@platform/db';
import { createDbPhaseSchedulerStorage } from '@platform/core';
import { PhaseScheduler } from '@platform/game-engine';
import { getPhaseScheduler } from '@platform/server/src/services';
import type { MafiaPlayerView, MafiaState } from '@platform/game-mafia';

// Integration tests for Mafia over the real Fastify + Socket.IO + Postgres
// + Redis stack. Roles are assigned with crypto randomness on the server,
// so tests look roles up in the authoritative DB state (test-only access).

let ctx: TestContext;

beforeAll(async () => {
  process.env.DISCONNECT_GRACE_PERIOD_MS = '700';
  ctx = await bootTestServer();
});

afterAll(async () => {
  await ctx.close();
  delete process.env.DISCONNECT_GRACE_PERIOD_MS;
});

type ClientSocket = ReturnType<typeof connectSocket>;
interface Seat {
  session: GuestSession;
  socket: ClientSocket;
  /** Everything this socket received, in order. */
  inbox: { event: string; payload: unknown }[];
  latest: () => { stateVersion: number; view: MafiaPlayerView } | undefined;
}

function record(socket: ClientSocket) {
  const inbox: { event: string; payload: unknown }[] = [];
  socket.onAny((event: string, payload: unknown) => inbox.push({ event, payload }));
  return inbox;
}

async function joinSeat(code: string, session: GuestSession): Promise<Seat> {
  const socket = connectSocket(ctx.baseUrl, session);
  await waitForConnect(socket);
  const inbox = record(socket);
  const roomState = waitForEvent(socket, 'ROOM_STATE');
  socket.emit('ROOM_JOIN', { code });
  await roomState;
  return {
    session,
    socket,
    inbox,
    latest: () => {
      const states = inbox.filter((m) => m.event === 'GAME_STATE');
      return states[states.length - 1]?.payload as { stateVersion: number; view: MafiaPlayerView } | undefined;
    },
  };
}

async function api(path: string, session: GuestSession, body?: unknown) {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json() };
}

async function waitUntil(cond: () => boolean | Promise<boolean>, timeoutMs = 3000, label = 'condition') {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await sleep(15);
  }
}

/** Boots a 6-player mafia room and starts the game. */
async function startMafia(n = 6) {
  const host = await loginAsNewGuest(ctx.baseUrl);
  const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 10, gameId: 'mafia' });
  const seats: Seat[] = [await joinSeat(room.code, host)];
  for (let i = 1; i < n; i++) seats.push(await joinSeat(room.code, await loginAsNewGuest(ctx.baseUrl)));

  const started = await api(`/api/rooms/${room.id}/start`, host);
  expect(started.status).toBe(200);
  await waitUntil(() => seats.every((s) => s.latest()), 3000, 'initial GAME_STATE');

  const { rows } = await pool.query(`SELECT id FROM game_sessions WHERE "roomId" = $1`, [room.id]);
  const sessionId: string = rows[0].id;
  const db = async () => (await getSessionById(sessionId))!;
  const state = async () => (await db()).state as MafiaState;
  const seatOf = async (role: string) => {
    const st = await state();
    const ids = st.players.filter((p) => p.role === role).map((p) => p.id);
    return seats.filter((s) => ids.includes(s.session.userId));
  };

  const act = (seat: Seat, action: unknown, version?: number) =>
    seat.socket.emit('GAME_ACTION', {
      roomId: room.id,
      actionId: randomUUID(),
      clientStateVersion: version ?? seat.latest()?.stateVersion ?? 0,
      action,
    });

  /** Pretend the current phase's timer ran out, then let the real scheduler react. */
  const expirePhase = async () => {
    const row = await db();
    const st = row.state as MafiaState;
    st.phaseEndsAt = Date.now() - 1;
    await pool.query(`UPDATE game_sessions SET state = $2 WHERE id = $1`, [sessionId, JSON.stringify(st)]);
    await getPhaseScheduler(ctx.io).scheduleFromSession({
      sessionId,
      roomId: room.id,
      gameId: 'mafia',
      stateVersion: row.stateVersion,
      state: st,
    });
  };

  const toPhase = async (phase: string) => {
    for (let i = 0; i < 12 && (await state()).phase !== phase; i++) await expirePhase();
    expect((await state()).phase).toBe(phase);
    const v = (await db()).stateVersion;
    await waitUntil(() => seats.every((s) => !s.socket.connected || (s.latest()?.stateVersion ?? -1) >= v), 3000, `${phase} views`);
  };

  const closeAll = () => seats.forEach((s) => s.socket.close());
  return { host, room, seats, sessionId, db, state, seatOf, act, expirePhase, toPhase, closeAll };
}

describe('mafia over Socket.IO', () => {
  test('start: everyone gets a personal GAME_STATE with only their own role', async () => {
    const g = await startMafia();
    const st = await g.state();
    expect(st.phase).toBe('ROLE_REVEAL');
    for (const seat of g.seats) {
      const view = seat.latest()!.view;
      const mine = st.players.find((p) => p.id === seat.session.userId)!;
      expect(view.you.role).toBe(mine.role);
      expect(view.players.every((p) => p.revealedRole === null)).toBe(true);
    }
    // nothing about roles in any public event
    const publicEvents = g.seats.flatMap((s) => s.inbox.filter((m) => m.event === 'GAME_EVENT'));
    expect(JSON.stringify(publicEvents)).not.toMatch(/MAFIA|DOCTOR|DETECTIVE|CITIZEN/);
    g.closeAll();
  });

  test('invalid config is rejected server-side; starting twice is refused', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 10, gameId: 'mafia' });
    const seats = [await joinSeat(room.code, host)];
    for (let i = 1; i < 6; i++) seats.push(await joinSeat(room.code, await loginAsNewGuest(ctx.baseUrl)));

    const bad = await api(`/api/rooms/${room.id}/start`, host, { config: { mafiaCount: 3 } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CONFIG');

    const ok = await api(`/api/rooms/${room.id}/start`, host, { config: { nightSeconds: 30 } });
    expect(ok.status).toBe(200);
    const again = await api(`/api/rooms/${room.id}/start`, host);
    expect(again.status).toBe(409);
    seats.forEach((s) => s.socket.close());
  });

  test('too few players → the game cannot start', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 10, gameId: 'mafia' });
    const seat = await joinSeat(room.code, host);
    const res = await api(`/api/rooms/${room.id}/start`, host);
    expect(res.status).toBe(400);
    seat.socket.close();
  });

  test('ROLE_READY from everyone ends ROLE_REVEAL early (via the generic scheduler)', async () => {
    const g = await startMafia();
    for (const s of g.seats) g.act(s, { type: 'ROLE_READY' });
    await waitUntil(async () => (await g.state()).phase === 'NIGHT', 3000, 'NIGHT');
    const st = await g.state();
    expect(st.round).toBe(1);
    await waitUntil(() => g.seats.every((s) => s.latest()!.view.phase === 'NIGHT'), 3000, 'NIGHT views');
    g.closeAll();
  });

  test('a phase timer advances the game on its own', async () => {
    const g = await startMafia();
    const row = await g.db();
    const st = row.state as MafiaState;
    st.phaseEndsAt = Date.now() + 250;
    await pool.query(`UPDATE game_sessions SET state = $2 WHERE id = $1`, [g.sessionId, JSON.stringify(st)]);
    await getPhaseScheduler(ctx.io).scheduleFromSession({
      sessionId: g.sessionId, roomId: g.room.id, gameId: 'mafia', stateVersion: row.stateVersion, state: st,
    });
    expect((await g.state()).phase).toBe('ROLE_REVEAL');
    await waitUntil(async () => (await g.state()).phase === 'NIGHT', 3000, 'timer → NIGHT');
    g.closeAll();
  });

  test('a forged phaseEndsAt in the action payload changes nothing', async () => {
    const g = await startMafia();
    const before = await g.state();
    g.act(g.seats[0]!, { type: 'ROLE_READY', phaseEndsAt: 0, phase: 'GAME_FINISHED' });
    await waitUntil(async () => (await g.db()).stateVersion === 1, 3000, 'ack applied');
    const after = await g.state();
    expect(after.phase).toBe('ROLE_REVEAL');
    expect(after.phaseEndsAt).toBe(before.phaseEndsAt);
    g.closeAll();
  });

  test('detective result reaches ONLY the detective’s own GAME_STATE — never GAME_EVENT, never other sockets', async () => {
    const g = await startMafia();
    await g.toPhase('NIGHT');
    const [detective] = await g.seatOf('DETECTIVE');
    const [mafia] = await g.seatOf('MAFIA');
    for (const s of g.seats) s.inbox.length = 0;

    const v = (await g.db()).stateVersion;
    g.act(detective!, { type: 'DETECTIVE_INVESTIGATE', targetUserId: mafia!.session.userId });
    await waitUntil(() => g.seats.every((s) => (s.latest()?.stateVersion ?? 0) > v), 3000, 'post-investigation views');

    const own = detective!.latest()!.view;
    expect(own.detectiveInvestigations).toEqual([
      expect.objectContaining({ targetId: mafia!.session.userId, isMafia: true }),
    ]);
    for (const s of g.seats) {
      const everything = JSON.stringify(s.inbox);
      if (s !== detective) {
        expect(everything).not.toContain('isMafia');
        expect(everything).not.toContain('detectiveInvestigations');
      }
      expect(s.inbox.filter((m) => m.event === 'GAME_EVENT')).toEqual([]); // private: no public event at all
    }
    // the private choice is not persisted as an event either
    const { rows } = await pool.query(`SELECT type FROM game_events WHERE "sessionId" = $1`, [g.sessionId]);
    expect(rows.map((r) => r.type)).not.toContain('DETECTIVE_INVESTIGATION_COMPLETED');
    g.closeAll();
  });

  test('reconnecting mid-game restores the same phase, round and role — secrets stay hidden', async () => {
    const g = await startMafia();
    await g.toPhase('NIGHT');
    const [citizen] = await g.seatOf('CITIZEN');
    const st = await g.state();

    citizen!.socket.disconnect();
    await sleep(100);
    const inbox: { event: string; payload: unknown }[] = [];
    citizen!.socket.onAny((event: string, payload: unknown) => inbox.push({ event, payload }));
    citizen!.socket.connect();
    await waitUntil(() => inbox.some((m) => m.event === 'GAME_STATE'), 3000, 'resync GAME_STATE');

    const view = (inbox.find((m) => m.event === 'GAME_STATE')!.payload as { view: MafiaPlayerView }).view;
    expect(view.phase).toBe('NIGHT');
    expect(view.round).toBe(st.round);
    expect(view.you.role).toBe('CITIZEN');
    expect(view.you.alive).toBe(true);
    expect(view.mafiaTeammates).toBeUndefined();
    expect(view.players.every((p) => p.revealedRole === null)).toBe(true);
    g.closeAll();
  });

  test('chat: alive players talk; dead players get NOT_AUTHORIZED (no broadcast, no DB row); open again after the game', async () => {
    const g = await startMafia();
    await g.toPhase('NIGHT');
    const [mafia] = await g.seatOf('MAFIA');
    const citizens = await g.seatOf('CITIZEN');
    const victim = citizens[0]!;
    g.act(mafia!, { type: 'MAFIA_SELECT_TARGET', targetUserId: victim.session.userId });
    await waitUntil(async () => Object.keys((await g.state()).currentNightActions.mafiaVotes).length === 1);
    await g.toPhase('DISCUSSION');
    expect((await g.state()).players.find((p) => p.id === victim.session.userId)!.alive).toBe(false);

    const alive = citizens[1]!;
    const heard = waitForEvent<{ text: string }>(g.seats[0]!.socket, 'CHAT_MESSAGE');
    alive.socket.emit('CHAT_SEND', { roomId: g.room.id, text: 'سلام' });
    expect((await heard).text).toBe('سلام');
    await waitUntil(() => g.seats.every((s) => s.inbox.some((m) => m.event === 'CHAT_MESSAGE')), 3000, 'chat fan-out');

    for (const s of g.seats) s.inbox.length = 0;
    const err = waitForEvent<{ code: string }>(victim.socket, 'ERROR');
    victim.socket.emit('CHAT_SEND', { roomId: g.room.id, text: 'from the grave' });
    expect((await err).code).toBe('NOT_AUTHORIZED');
    await sleep(150);
    expect(g.seats.some((s) => s.inbox.some((m) => m.event === 'CHAT_MESSAGE'))).toBe(false);
    const { rows } = await pool.query(`SELECT 1 FROM chat_messages WHERE "roomId" = $1 AND text = 'from the grave'`, [g.room.id]);
    expect(rows).toHaveLength(0);

    // The only mafia leaves for good → town wins → session ended → chat open for everyone.
    mafia!.socket.emit('ROOM_LEAVE', { roomId: g.room.id });
    await waitUntil(async () => (await g.db()).endedAt !== null, 3000, 'session ended');
    expect((await g.state()).winner).toBe('TOWN');
    const heardDead = waitForEvent<{ text: string }>(g.seats.find((s) => s !== mafia)!.socket, 'CHAT_MESSAGE');
    victim.socket.emit('CHAT_SEND', { roomId: g.room.id, text: 'gg' });
    expect((await heardDead).text).toBe('gg');
    g.closeAll();
  });

  test('fake-game keeps unrestricted chat (no canSendMessage hook)', async () => {
    const host = await loginAsNewGuest(ctx.baseUrl);
    const room = await createRoom(ctx.baseUrl, host, { maxPlayers: 4, gameId: 'fake-game' });
    const a = await joinSeat(room.code, host);
    const b = await joinSeat(room.code, await loginAsNewGuest(ctx.baseUrl));
    expect((await api(`/api/rooms/${room.id}/start`, host)).status).toBe(200);
    const heard = waitForEvent<{ text: string }>(a.socket, 'CHAT_MESSAGE');
    b.socket.emit('CHAT_SEND', { roomId: room.id, text: 'hi' });
    expect((await heard).text).toBe('hi');
    a.socket.close();
    b.socket.close();
  });

  test('explicit ROOM_LEAVE mid-NIGHT → public PLAYER_LEFT with revealed role, phase continues', async () => {
    const g = await startMafia(8);
    await g.toPhase('NIGHT');
    const [doctor] = await g.seatOf('DOCTOR');
    const others = g.seats.filter((s) => s !== doctor);
    const ev = waitForEvent<{ events: unknown[] }>(others[0]!.socket, 'GAME_EVENT');
    const before = await g.state();
    doctor!.socket.emit('ROOM_LEAVE', { roomId: g.room.id });
    expect((await ev).events).toContainEqual({ type: 'PLAYER_LEFT', playerId: doctor!.session.userId, revealedRole: 'DOCTOR' });
    const after = await g.state();
    expect(after.phase).toBe('NIGHT');
    expect(after.phaseEndsAt).toBe(before.phaseEndsAt);
    await waitUntil(() => others.every((s) => s.latest()!.view.players.find((p) => p.id === doctor!.session.userId)!.revealedRole === 'DOCTOR'));
    g.closeAll();
  });

  test('host kick mid-VOTING removes the vote and reveals the role', async () => {
    const g = await startMafia(8);
    await g.toPhase('VOTING');
    const citizens = await g.seatOf('CITIZEN');
    const kicked = citizens.find((s) => s !== g.seats[0])!;
    g.act(kicked, { type: 'PLAYER_VOTE', targetUserId: null });
    await waitUntil(async () => kicked.session.userId in (await g.state()).currentVotes.votes);
    const res = await api(`/api/rooms/${g.room.id}/remove-player`, g.host, { targetUserId: kicked.session.userId });
    expect(res.status).toBe(200);
    await waitUntil(async () => !(await g.state()).players.find((p) => p.id === kicked.session.userId)!.alive);
    const st = await g.state();
    expect(st.currentVotes.votes).not.toHaveProperty(kicked.session.userId);
    expect(st.players.find((p) => p.id === kicked.session.userId)!.eliminationCause).toBe('LEFT');
    g.closeAll();
  });

  test('grace period: back in time → still alive; gone past grace → onPlayerLeft', async () => {
    const g = await startMafia(8);
    await g.toPhase('NIGHT');
    const [c1, c2] = await g.seatOf('CITIZEN');

    // c1 drops and returns well within the 700ms grace period
    c1!.socket.disconnect();
    await sleep(200);
    c1!.socket.connect();
    await waitForEvent(c1!.socket, 'GAME_STATE');
    await sleep(900);
    expect((await g.state()).players.find((p) => p.id === c1!.session.userId)!.alive).toBe(true);

    // c2 never comes back
    c2!.socket.disconnect();
    await waitUntil(
      async () => (await g.state()).players.find((p) => p.id === c2!.session.userId)!.eliminationCause === 'LEFT',
      4000,
      'grace expiry → LEFT',
    );
    g.closeAll();
  });

  test('phase transition safety: concurrent timer fires + an action → advanced exactly once', async () => {
    const g = await startMafia();
    const row = await g.db();
    const st = row.state as MafiaState;
    st.phaseEndsAt = Date.now() - 1;
    await pool.query(`UPDATE game_sessions SET state = $2 WHERE id = $1`, [g.sessionId, JSON.stringify(st)]);
    const session = { sessionId: g.sessionId, roomId: g.room.id, gameId: 'mafia', stateVersion: row.stateVersion, state: st };

    const scheduler = getPhaseScheduler(ctx.io);
    const restarted = new PhaseScheduler(createDbPhaseSchedulerStorage(), { onTransition: () => {} });
    g.act(g.seats[1]!, { type: 'ROLE_READY' }, row.stateVersion); // races the timers
    await Promise.all([
      scheduler.scheduleFromSession(session),
      scheduler.scheduleFromSession(session),
      restarted.scheduleFromSession(session),
    ]);
    await sleep(200);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM game_events WHERE "sessionId" = $1 AND type = 'NIGHT_STARTED'`,
      [g.sessionId],
    );
    expect(rows[0].n).toBe(1);
    const final = await g.db();
    expect((final.state as MafiaState).phase).toBe('NIGHT');
    // +1 for the night, and at most +1 more if the ROLE_READY won the race before it
    expect(final.stateVersion - row.stateVersion).toBeGreaterThanOrEqual(1);
    expect(final.stateVersion - row.stateVersion).toBeLessThanOrEqual(2);
    restarted.cancelAll();
    g.closeAll();
  });

  test('restart recovery: a phase that expired while the server was down advances on boot', async () => {
    const g = await startMafia();
    const row = await g.db();
    const st = row.state as MafiaState;
    st.phaseEndsAt = Date.now() - 60_000;
    await pool.query(`UPDATE game_sessions SET state = $2 WHERE id = $1`, [g.sessionId, JSON.stringify(st)]);

    // A second server process booting = createServer() → scheduler.recoverAll()
    const second = await bootTestServer();
    await waitUntil(async () => (await g.state()).phase === 'NIGHT', 3000, 'recovered → NIGHT');
    expect((await g.db()).stateVersion).toBe(row.stateVersion + 1);
    await second.close();
    g.closeAll();
  });
});
