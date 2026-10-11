import type { ReactNode } from 'react';
import { ConnectionStatusBadge, type ConnectionStatus } from './ConnectionStatusBadge';
import { Button } from './Button';

interface GameShellProps {
  gameName: string;
  connectionStatus: ConnectionStatus;
  onLeave: () => void;
  /** Main game board/content — entirely owned by the game module. */
  children: ReactNode;
  /** Optional turn/phase timer, rendered under the header. */
  timer?: ReactNode;
  /** Player roster — generic PlayerCard list, owned by the caller. */
  playerArea?: ReactNode;
  /** Chat panel — reused as-is from the Lobby. */
  chat?: ReactNode;
}

/**
 * Shared by every game module (Mafia, Spy, ... in future milestones).
 * NEVER put game-specific UI here — only structure. See Milestone 6 §13.
 */
export function GameShell({ gameName, connectionStatus, onLeave, children, timer, playerArea, chat }: GameShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-bg text-white">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold">{gameName}</h1>
          <ConnectionStatusBadge status={connectionStatus} />
        </div>
        <Button variant="ghost" onClick={onLeave} aria-label="خروج از بازی">
          خروج
        </Button>
      </header>

      {timer && <div className="border-b border-white/10 px-4 py-2">{timer}</div>}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row">
        <main className="flex-1">{children}</main>
        {playerArea && <aside className="w-full shrink-0 md:w-64">{playerArea}</aside>}
      </div>

      {chat}
    </div>
  );
}
