interface GameCardProps {
  icon: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  available: boolean;
  onPlay?: () => void;
}

// Generic by construction: takes plain metadata (the shape the Game
// Registry/API already returns), never a gameId switch statement. See
// Milestone 6 §4/§21 — "avoid if (gameId === 'mafia') inside generic UI".
export function GameCard({ icon, name, description, minPlayers, maxPlayers, available, onPlay }: GameCardProps) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border p-4 transition-transform ${
        available ? 'border-white/10 bg-surface active:scale-[0.98]' : 'border-white/5 bg-surface/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-3xl" aria-hidden="true">
          {icon}
        </span>
        {!available && (
          <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-xs text-white/50">به‌زودی</span>
        )}
      </div>
      <h3 className="text-lg font-extrabold">{name}</h3>
      <p className="text-sm text-white/60">{description}</p>
      <p className="text-xs text-white/40">
        {minPlayers} تا {maxPlayers} بازیکن
      </p>
      {available && onPlay && (
        <button
          onClick={onPlay}
          className="mt-2 min-h-[44px] rounded-xl bg-accent font-bold text-white transition-transform active:scale-[0.97]"
        >
          بازی کن
        </button>
      )}
    </div>
  );
}
