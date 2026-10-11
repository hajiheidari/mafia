// Display metadata per registered game id. The server registry decides
// WHICH games exist; this only decides how the web app labels them.

export interface GamePresentation {
  icon: string;
  name: string;
  description: string;
}

const PRESENTATION: Record<string, GamePresentation> = {
  'fake-game': {
    icon: '🎮',
    name: 'بازی نمایشی',
    description: 'برای تست پلتفرم — به‌زودی بازی‌های واقعی جایگزین می‌شوند',
  },
  mafia: {
    icon: '🕵️',
    name: 'مافیا',
    description: 'بازی گروهی و نقش مخفی',
  },
};

export function presentGame(gameId: string | null | undefined, fallback?: { name?: string; description?: string }): GamePresentation {
  return (
    (gameId ? PRESENTATION[gameId] : undefined) ?? {
      icon: '🎲',
      name: fallback?.name ?? 'بازی',
      description: fallback?.description ?? '',
    }
  );
}
