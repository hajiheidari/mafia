'use client';

import { Button, PlayerCard, RoomCodeDisplay, ConnectionStatusBadge, type ConnectionStatus } from '@platform/ui';
import { ChatPanel } from './ChatPanel';
import type { RoomDTO, ChatMessageDTO } from '@platform/types';

interface LobbyProps {
  room: RoomDTO;
  currentUserId: string;
  connectionStatus: ConnectionStatus;
  messages: ChatMessageDTO[];
  gameMinPlayers: number;
  gameName: string;
  onReady: (isReady: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onRemovePlayer: (userId: string) => void;
  onSendChat: (text: string) => void;
}

export function Lobby({
  room,
  currentUserId,
  connectionStatus,
  messages,
  gameMinPlayers,
  gameName,
  onReady,
  onStart,
  onLeave,
  onRemovePlayer,
  onSendChat,
}: LobbyProps) {
  const me = room.members.find((m) => m.userId === currentUserId);
  const isHost = me?.role === 'HOST';
  const activePlayers = room.members.filter((m) => m.role === 'HOST' || m.role === 'PLAYER');
  const connectedActivePlayers = activePlayers.filter((m) => m.isConnected);
  const allReady = activePlayers.filter((m) => m.role === 'PLAYER').every((m) => m.isReady);
  const meetsMinPlayers = connectedActivePlayers.length >= gameMinPlayers;
  const canStart = isHost && meetsMinPlayers && allReady;

  const inviteUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/join/${room.code}` : `/join/${room.code}`;

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-bg p-4 text-white md:flex-row md:p-6">
      <div className="flex flex-1 flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">{gameName}</p>
            <h1 className="text-xl font-extrabold">اتاق انتظار</h1>
          </div>
          <ConnectionStatusBadge status={connectionStatus} />
        </header>

        <RoomCodeDisplay code={room.code} inviteUrl={inviteUrl} />

        <section aria-label="بازیکنان" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white/70">
              بازیکنان ({activePlayers.length}/{room.maxPlayers})
            </h2>
          </div>
          {activePlayers.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/40">
              هنوز کسی وارد اتاق نشده
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {activePlayers.map((member) => (
                <div key={member.id} className="group relative">
                  <PlayerCard member={member} isYou={member.userId === currentUserId} />
                  {isHost && member.userId !== currentUserId && (
                    <button
                      onClick={() => onRemovePlayer(member.userId)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-400 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={`حذف ${member.displayName}`}
                    >
                      حذف
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-auto flex flex-col gap-3">
          {isHost ? (
            <>
              {!meetsMinPlayers && (
                <p className="text-center text-sm text-yellow-400">حداقل {gameMinPlayers} بازیکن لازم است.</p>
              )}
              {meetsMinPlayers && !allReady && (
                <p className="text-center text-sm text-yellow-400">منتظر آماده شدن همه‌ی بازیکن‌ها…</p>
              )}
              <Button fullWidth disabled={!canStart} onClick={onStart}>
                شروع بازی
              </Button>
            </>
          ) : (
            <Button fullWidth variant={me?.isReady ? 'secondary' : 'primary'} onClick={() => onReady(!me?.isReady)}>
              {me?.isReady ? 'آماده' : 'آماده‌ام'}
            </Button>
          )}
          <Button fullWidth variant="ghost" onClick={onLeave}>
            خروج از اتاق
          </Button>
        </div>
      </div>

      <ChatPanel messages={messages} currentUserId={currentUserId} onSend={onSendChat} />
    </div>
  );
}
