'use client';

import { Button } from '@platform/ui';
import type { FakePlayerView } from '@platform/game-fake';

interface FakeGameViewProps {
  view: FakePlayerView;
  onPing: () => void;
}

/**
 * Renders the placeholder "fake-game" used only to prove the Game Engine
 * pipeline end-to-end (see packages/games/fake-game). This is intentionally
 * the ONLY place in the frontend that knows fake-game's shape — GameShell
 * itself has no idea this game exists. Real games (Mafia, ...) get their
 * own view component the same way, in a future milestone.
 */
export function FakeGameView({ view, onPing }: FakeGameViewProps) {
  return (
    <div className="flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-surface p-6 text-center">
      <p className="text-sm text-white/50">
        دور {view.round} از {view.maxRounds}
      </p>

      <div className="rounded-2xl bg-accent/10 px-6 py-4">
        <p className="text-xs text-white/50">عدد مخفی شما</p>
        <p className="text-4xl font-black text-accentSoft">{view.you.secretNumber}</p>
      </div>

      <div className="w-full text-start">
        <p className="mb-2 text-xs text-white/50">امتیازها</p>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
            <span>شما</span>
            <span className="font-bold">{view.you.score}</span>
          </li>
          {view.others.map((o) => (
            <li key={o.id} className="flex justify-between rounded-lg bg-white/5 px-3 py-1.5">
              <span>{o.displayName}</span>
              <span className="font-bold">{o.score}</span>
            </li>
          ))}
        </ul>
      </div>

      {view.finished ? (
        <p className="font-bold text-green-400">بازی تمام شد 🎉</p>
      ) : (
        <Button onClick={onPing}>امتیاز بگیر</Button>
      )}
    </div>
  );
}
