import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { Server as SocketIOServer } from 'socket.io';
import { GameRegistry } from '@platform/game-engine';
import { FakeGameDefinition } from '@platform/game-fake';
import { MafiaGameDefinition } from '@platform/game-mafia';
import type { ClientToServerEvents, ServerToClientEvents } from '@platform/types';
import { registerAuthRoutes } from './plugins/auth.js';
import { registerRoomRoutes } from './plugins/rooms.js';
import { createSocketAuthMiddleware, type SocketData } from './realtime/socketAuth.js';
import { registerRealtimeHandlers } from './realtime/registerRealtimeHandlers.js';
import {
  getGuestAuth,
  getRoomService,
  getGameSessionService,
  getRateLimiter,
  getPhaseScheduler,
} from './services.js';

export type AppIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

let gameRegistered = false;

/**
 * Builds the Fastify app + Socket.IO server WITHOUT starting to listen —
 * lets both the real entrypoint (index.ts) and integration tests
 * (tests/realtime/*) share the exact same wiring instead of tests
 * re-implementing a parallel setup that could silently drift.
 */
export async function createServer(): Promise<{ app: FastifyInstance; io: AppIO }> {
  if (!gameRegistered) {
    // This is the ONLY place a game module is imported by the server.
    // Room/lobby/auth code never imports a concrete game.
    GameRegistry.register(FakeGameDefinition);
    GameRegistry.register(MafiaGameDefinition);
    gameRegistered = true;
  }

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(fastifyCookie);

  // Socket.IO attaches to Fastify's underlying http.Server, which exists
  // immediately (Fastify() creates it at construction, well before
  // .ready()/.listen()) — so it's safe to create `io` here and hand it to
  // REST route registration below, which needs it to broadcast realtime
  // updates for REST-triggered mutations (e.g. host removing a player).
  const io: AppIO = new SocketIOServer(app.server, {
    cors: { origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000', credentials: true },
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/games', async () => ({
    games: GameRegistry.all().map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
    })),
  }));

  // Hooks must be added before ready().
  const scheduler = getPhaseScheduler(io);
  app.addHook('onClose', async () => scheduler.cancelAll());

  await registerAuthRoutes(app);
  await registerRoomRoutes(app, io);

  await app.ready();

  io.use(createSocketAuthMiddleware(getGuestAuth()));

  registerRealtimeHandlers(io, {
    roomService: getRoomService(),
    gameSessionService: getGameSessionService(),
    rateLimiter: getRateLimiter(),
    scheduler,
  });

  // Restart recovery: re-arm every active session's phase timer; phases
  // that ran out while the server was down advance immediately.
  await scheduler.recoverAll();

  return { app, io };
}
