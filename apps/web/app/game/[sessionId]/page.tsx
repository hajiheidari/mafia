'use client';

import Link from 'next/link';

// NOTE (Milestone 6 deviation, documented in the milestone report): the
// active game experience is rendered inside /room/[code] itself (Lobby and
// GameShell are two states of the same page), not at a separate
// /game/[sessionId] URL. A GameSession's id isn't something the client
// ever needs to know or navigate to — the room is the durable, shareable
// unit; the game happening inside it is just a state of that room. Doing
// it this way also avoids an unnecessary full navigation (and the
// Socket.IO reconnect/rejoin churn that would come with it) at the exact
// moment a game starts. This route is kept only so the URL exists.
export default function GameSessionRedirectPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center text-white">
      <p className="text-white/60">صفحه‌ی بازی از طریق اتاق در دسترس است.</p>
      <Link href="/join" className="text-accentSoft underline">
        ورود به اتاق
      </Link>
    </main>
  );
}
