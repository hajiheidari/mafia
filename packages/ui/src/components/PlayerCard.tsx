import { Avatar } from './Avatar';
import type { RoomMemberDTO } from '@platform/types';

interface PlayerCardProps {
  member: RoomMemberDTO;
  isYou?: boolean;
}

export function PlayerCard({ member, isYou }: PlayerCardProps) {
  const statusLabel = !member.isConnected
    ? 'در حال اتصال…'
    : member.role === 'HOST'
      ? 'میزبان'
      : member.isReady
        ? 'آماده'
        : null;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 transition-opacity ${
        member.isConnected ? 'border-white/10 bg-surface' : 'border-white/5 bg-surface/50 opacity-60'
      }`}
    >
      <Avatar displayName={member.displayName} avatarUrl={member.avatarUrl} ring={member.role === 'HOST'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-bold">{member.displayName}</span>
          {isYou && <span className="text-xs text-white/40">(شما)</span>}
        </div>
        {statusLabel && (
          <span
            className={`text-xs ${
              !member.isConnected
                ? 'text-white/40'
                : member.role === 'HOST'
                  ? 'text-accentSoft'
                  : 'text-green-400'
            }`}
          >
            {statusLabel}
          </span>
        )}
      </div>
      {member.isConnected && member.role !== 'HOST' && (
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${member.isReady ? 'bg-green-400' : 'bg-white/15'}`}
        />
      )}
    </div>
  );
}
