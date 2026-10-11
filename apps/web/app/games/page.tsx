'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameCard } from '@platform/ui';
import { LoadingScreen } from '../../components/LoadingScreen';
import { useAuth } from '../../lib/AuthProvider';
import { fetchGames, createRoom, friendlyRoomError, type GameSummary } from '../../lib/roomApi';

// Real games (Milestone 7+) will come entirely from the Game Registry API
// below. These three are marketed on the homepage/games grid as "coming
// soon" per Milestone 6 §3/§4 — deliberately NOT wired to any create-room
// action, so they can never appear playable before they exist.
const COMING_SOON = [
  { icon: '🕵️', name: 'مافیا', description: 'بازی گروهی و نقش مخفی', minPlayers: 6, maxPlayers: 20 },
  { icon: '🎭', name: 'جاسوس', description: 'یک نفر جاسوسه، بقیه باید پیداش کنن', minPlayers: 4, maxPlayers: 10 },
  { icon: '📝', name: 'اسم فامیل', description: 'سریع فکر کن، سریع بنویس', minPlayers: 2, maxPlayers: 10 },
];

export default function GamesPage() {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGames()
      .then(setGames)
      .catch(() => setGames([]));
  }, []);

  async function handlePlay(game: GameSummary) {
    setError(null);
    setCreating(true);
    try {
      const room = await createRoom({ gameId: game.id, maxPlayers: game.maxPlayers });
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(friendlyRoomError(err));
      setCreating(false);
    }
  }

  if (authStatus === 'loading' || games === null) {
    return <LoadingScreen label="در حال بارگذاری بازی‌ها…" />;
  }

  return (
    <main className="min-h-screen px-5 py-8">
      <h1 className="mb-1 text-2xl font-extrabold">انتخاب بازی</h1>
      <p className="mb-6 text-sm text-white/50">یه بازی رو انتخاب کن و اتاق بساز</p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {games.map((game) => (
          <GameCard
            key={game.id}
            icon="🎮"
            name="بازی نمایشی"
            description="برای تست پلتفرم — به‌زودی بازی‌های واقعی جایگزین می‌شوند"
            minPlayers={game.minPlayers}
            maxPlayers={game.maxPlayers}
            available
            onPlay={creating ? undefined : () => handlePlay(game)}
          />
        ))}
        {COMING_SOON.map((game) => (
          <GameCard key={game.name} {...game} available={false} />
        ))}
      </div>

      {creating && <p className="mt-4 text-center text-sm text-white/50">در حال ساخت اتاق…</p>}
    </main>
  );
}
