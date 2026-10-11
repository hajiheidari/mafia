interface AvatarProps {
  displayName: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  ring?: boolean;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-xl',
};

// Deterministic color from the name so the same guest always gets the same
// avatar color across the session, without needing an image.
const PALETTE = ['#7C5CFC', '#F97316', '#22C55E', '#EC4899', '#06B6D4', '#EAB308'];
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

export function Avatar({ displayName, avatarUrl, size = 'md', ring }: AvatarProps) {
  const initial = displayName.trim().charAt(0) || '?';
  const bg = colorFor(displayName);

  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className={`${SIZE_CLASSES[size]} rounded-full object-cover ${ring ? 'ring-2 ring-accentSoft' : ''}`}
      />
    );
  }

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0 ${ring ? 'ring-2 ring-accentSoft' : ''}`}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
