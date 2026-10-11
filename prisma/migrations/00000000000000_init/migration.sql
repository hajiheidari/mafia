-- Initial schema. Written to match prisma/schema.prisma exactly.
--
-- NOTE ON PROVENANCE: this sandbox's outbound network allowlist does not
-- include binaries.prisma.sh, so `prisma migrate dev` cannot download the
-- schema-engine binary here (see explanation given to the user). This SQL
-- was authored by hand from the schema and applied directly via psql to
-- verify the relational design end-to-end. On a normal machine/CI with
-- unrestricted network, delete this note and run `npx prisma migrate dev`
-- against an empty database — Prisma will generate and apply an equivalent
-- migration itself and take over tracking from there.

CREATE TYPE "AuthProvider" AS ENUM ('GUEST', 'PHONE', 'EMAIL', 'GOOGLE', 'APPLE');
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'STARTING', 'IN_GAME', 'PAUSED', 'FINISHED', 'CLOSED');
CREATE TYPE "RoomVisibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "RoomRole" AS ENUM ('HOST', 'PLAYER', 'SPECTATOR', 'NARRATOR', 'MODERATOR', 'ADMIN');

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "auth_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "auth_methods_provider_providerId_key" ON "auth_methods"("provider", "providerId");
CREATE INDEX "auth_methods_userId_idx" ON "auth_methods"("userId");

CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "gameId" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
    "visibility" "RoomVisibility" NOT NULL DEFAULT 'PRIVATE',
    "maxPlayers" INTEGER NOT NULL DEFAULT 10,
    "skillRating" INTEGER,
    "queueStatus" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");

CREATE TABLE "room_members" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoomRole" NOT NULL DEFAULT 'PLAYER',
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "room_members_roomId_userId_key" ON "room_members"("roomId", "userId");
CREATE INDEX "room_members_roomId_idx" ON "room_members"("roomId");

CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "phase" TEXT,
    "state" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "game_sessions_roomId_idx" ON "game_sessions"("roomId");

CREATE TABLE "game_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "game_events_sessionId_createdAt_idx" ON "game_events"("sessionId", "createdAt");

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId", "createdAt");

CREATE TABLE "game_statistics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_statistics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "game_statistics_userId_gameId_key" ON "game_statistics"("userId", "gameId");

ALTER TABLE "auth_methods" ADD CONSTRAINT "auth_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_statistics" ADD CONSTRAINT "game_statistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
