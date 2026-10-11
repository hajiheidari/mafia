import { createServer } from '@platform/server';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@platform/types';

export interface TestContext {
  baseUrl: string;
  close: () => Promise<void>;
  io: Awaited<ReturnType<typeof createServer>>['io'];
}

export async function bootTestServer(): Promise<TestContext> {
  const { app, io } = await createServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    io,
    close: async () => {
      await app.close();
    },
  };
}

export interface GuestSession {
  userId: string;
  displayName: string;
  accessToken: string;
  cookie: string; // Set-Cookie header value, reusable for a follow-up request
}

/** Logs in a brand-new guest (no cookie sent) — mirrors what a fresh browser tab does. */
export async function loginAsNewGuest(baseUrl: string): Promise<GuestSession> {
  const res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
  const body = await res.json();
  const setCookie = res.headers.get('set-cookie') ?? '';
  return {
    userId: body.user.id,
    displayName: body.user.displayName,
    accessToken: body.accessToken,
    cookie: setCookie.split(';')[0], // "session=xxxx"
  };
}

export async function createRoom(
  baseUrl: string,
  session: GuestSession,
  opts?: { maxPlayers?: number; gameId?: string },
) {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
  const body = await res.json();
  return body.room as { id: string; code: string };
}

type AppClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectSocket(baseUrl: string, session: GuestSession): AppClientSocket {
  return ioClient(baseUrl, {
    auth: { token: session.accessToken },
    transports: ['websocket'],
    forceNew: true,
  }) as unknown as AppClientSocket;
}

/** Waits for a specific event once, with a timeout so a hung test fails fast instead of stalling. */
export function waitForEvent<T = unknown>(socket: AppClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event as never, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function waitForConnect(socket: AppClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for connect')), 3000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
