'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { GameShell, PlayerCard } from '@platform/ui';
import { useAuth } from '../../../lib/AuthProvider';
import { useRoom } from '../../../lib/useRoom';
import { LoadingScreen } from '../../../components/LoadingScreen';
import { Lobby } from '../../../components/Lobby';
import { ChatPanel } from '../../../components/ChatPanel';
import { FakeGameView } from '../../../components/FakeGameView';
import { MafiaDebugView } from '../../../components/MafiaDebugView';
import { presentGame } from '../../../lib/gamePresentation';
import { startGame as startGameRequest, removePlayer as removePlayerRequest, fetchGames, friendlyRoomError } from '../../../lib/roomApi';

export default function RoomPage() {
  const { status: authStatus, user } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toString().toUpperCase();

  const {
    room,
    connectionStatus,
    messages,
    gameState,
    gameStarted,
    error: realtimeError,
    joinByCode,
    leaveRoom,
    setReady,
    sendChat,
    sendGameAction,
    clearError,
  } = useRoom();

  const [minPlayers, setMinPlayers] = useState(2);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'ready') return;
    joinByCode(code);
    // Only re-run if the code itself changes or auth just became ready —
    // NOT on every joinByCode identity change (it's stable via useCallback).
  }, [authStatus, code]);

  useEffect(() => {
    fetchGames().then((games) => {
      const match = room?.gameId ? games.find((g) => g.id === room.gameId) : null;
      if (match) setMinPlayers(match.minPlayers);
    });
  }, [room?.gameId]);

  if (authStatus === 'loading') return <LoadingScreen />;

  if (realtimeError) {
    const message =
      realtimeError.code === 'ROOM_NOT_FOUND'
        ? 'این اتاق پیدا نشد.'
        : realtimeError.code === 'ROOM_FULL'
          ? 'ظرفیت اتاق تکمیل شده.'
          : realtimeError.code === 'INVALID_ROOM_STATE'
            ? 'این اتاق دیگر فعال نیست.'
            : realtimeError.message || 'خطایی پیش آمد.';
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center text-white">
        <p className="text-lg text-red-400">{message}</p>
        <Link
          href="/join"
          className="text-accentSoft underline"
          onClick={() => clearError()}
        >
          ورود با کد دیگر
        </Link>
      </main>
    );
  }

  if (!room || !user) return <LoadingScreen label="در حال ورود به اتاق…" />;

  async function handleStart() {
    setActionError(null);
    try {
      await startGameRequest(room!.id);
    } catch (err) {
      setActionError(friendlyRoomError(err));
    }
  }

  async function handleRemovePlayer(targetUserId: string) {
    try {
      await removePlayerRequest(room!.id, targetUserId);
    } catch (err) {
      setActionError(friendlyRoomError(err));
    }
  }

  function handleLeave() {
    leaveRoom();
    router.push('/');
  }

  const gameName = presentGame(room.gameId).name;

  function renderGameView(view: unknown) {
    if (room!.gameId === 'mafia') {
      return (
        <MafiaDebugView
          view={view as import('@platform/game-mafia').MafiaPlayerView}
          onAction={sendGameAction}
        />
      );
    }
    return (
      <FakeGameView
        view={view as import('@platform/game-fake').FakePlayerView}
        onPing={() => sendGameAction({ type: 'PING' })}
      />
    );
  }

  if (gameStarted) {
    const activePlayers = room.members.filter((m) => m.role === 'HOST' || m.role === 'PLAYER');
    return (
      <GameShell
        gameName={gameName}
        connectionStatus={connectionStatus}
        onLeave={handleLeave}
        playerArea={
          <div className="flex flex-col gap-2">
            {activePlayers.map((m) => (
              <PlayerCard key={m.id} member={m} isYou={m.userId === user.id} />
            ))}
          </div>
        }
        chat={<ChatPanel messages={messages} currentUserId={user.id} onSend={sendChat} />}
      >
        {gameState ? (
          renderGameView(gameState.view)
        ) : (
          <p className="text-center text-white/50">در حال دریافت وضعیت بازی…</p>
        )}
      </GameShell>
    );
  }

  return (
    <>
      {actionError && (
        <div className="fixed inset-x-0 top-0 z-40 bg-red-500/90 p-3 text-center text-sm text-white">
          {actionError}
        </div>
      )}
      <Lobby
        room={room}
        currentUserId={user.id}
        connectionStatus={connectionStatus}
        messages={messages}
        gameMinPlayers={minPlayers}
        gameName={gameName}
        onReady={setReady}
        onStart={handleStart}
        onLeave={handleLeave}
        onRemovePlayer={handleRemovePlayer}
        onSendChat={sendChat}
      />
    </>
  );
}
