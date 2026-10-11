'use client';

import { useEffect, useState } from 'react';
import { Button } from '@platform/ui';
import type { MafiaPlayerView, MafiaRole, MafiaPhase } from '@platform/game-mafia';

// MINIMAL debug UI for Mafia (Milestone 7B). It only renders what the
// server already put in THIS player's view and sends raw actions back —
// no game rule lives here. The polished screens are Milestone 7C.

const ROLE_LABEL: Record<MafiaRole, string> = {
  MAFIA: 'مافیا',
  CITIZEN: 'شهروند',
  DOCTOR: 'دکتر',
  DETECTIVE: 'کارآگاه',
};

const PHASE_LABEL: Record<MafiaPhase, string> = {
  ROLE_REVEAL: 'نمایش نقش',
  NIGHT: 'شب',
  DAY_ANNOUNCEMENT: 'اعلام روز',
  DISCUSSION: 'بحث',
  VOTING: 'رأی‌گیری',
  VOTE_RESULT: 'نتیجه‌ی رأی',
  GAME_FINISHED: 'پایان بازی',
};

const CAUSE_LABEL = { MAFIA: 'کشته‌شده توسط مافیا', VOTE: 'حذف با رأی', LEFT: 'خروج از بازی' } as const;

function useSecondsLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

interface MafiaDebugViewProps {
  view: MafiaPlayerView;
  onAction: (action: unknown) => void;
}

export function MafiaDebugView({ view, onAction }: MafiaDebugViewProps) {
  const secondsLeft = useSecondsLeft(view.phaseEndsAt);
  const nameOf = (id: string | null | undefined) =>
    id ? (view.players.find((p) => p.id === id)?.displayName ?? '؟') : '—';
  const me = view.you;
  const alivePlayers = view.players.filter((p) => p.alive);
  const teammateIds = new Set((view.mafiaTeammates ?? []).map((t) => t.id));

  let nightAction: { type: string; label: string; targets: typeof alivePlayers } | null = null;
  if (view.phase === 'NIGHT' && me.alive) {
    if (me.role === 'MAFIA') {
      nightAction = {
        type: 'MAFIA_SELECT_TARGET',
        label: 'هدف امشب را انتخاب کن',
        targets: alivePlayers.filter((p) => p.id !== me.id && !teammateIds.has(p.id)),
      };
    } else if (me.role === 'DOCTOR') {
      nightAction = {
        type: 'DOCTOR_PROTECT',
        label: 'چه کسی را نجات می‌دهی؟',
        targets: alivePlayers.filter((p) => p.id !== view.doctorLastProtectedId),
      };
    } else if (me.role === 'DETECTIVE' && !me.nightTargetId) {
      nightAction = {
        type: 'DETECTIVE_INVESTIGATE',
        label: 'از چه کسی استعلام می‌گیری؟',
        targets: alivePlayers.filter((p) => p.id !== me.id),
      };
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface p-5 text-start" data-testid="mafia-debug-view">
      <div className="flex items-center justify-between">
        <p className="font-bold">
          {PHASE_LABEL[view.phase]}
          {view.round > 0 && <span className="text-white/50"> · دور {view.round}</span>}
        </p>
        {secondsLeft !== null && <p className="tabular-nums text-accentSoft">{secondsLeft} ثانیه</p>}
      </div>

      {me.role && (
        <div className="rounded-xl bg-accent/10 px-4 py-3">
          <p className="text-xs text-white/50">نقش تو</p>
          <p className="text-2xl font-black text-accentSoft">{ROLE_LABEL[me.role]}</p>
          {!me.alive && <p className="text-sm text-red-400">تو از بازی حذف شده‌ای.</p>}
        </div>
      )}

      {view.winner && (
        <p className="rounded-xl bg-green-500/10 p-3 text-center font-bold text-green-400">
          {view.winner === 'MAFIA' ? 'مافیا برنده شد' : 'شهروندان برنده شدند'}
        </p>
      )}

      {view.phase === 'ROLE_REVEAL' && me.alive && (
        <Button disabled={me.roleReadyAcked} onClick={() => onAction({ type: 'ROLE_READY' })}>
          {me.roleReadyAcked ? 'منتظر بقیه…' : 'نقشم را دیدم'}
        </Button>
      )}

      {view.mafiaTeammates && view.mafiaTeammates.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-white/50">هم‌تیمی‌ها</p>
          <ul className="flex flex-col gap-1 text-sm">
            {view.mafiaTeammates.map((t) => (
              <li key={t.id} className="rounded-lg bg-white/5 px-3 py-1.5">
                {t.displayName} {t.alive ? '' : '(حذف‌شده)'}
                {view.phase === 'NIGHT' && t.alive && <span className="text-white/50"> → {nameOf(t.currentTargetId)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nightAction && (
        <div>
          <p className="mb-2 text-sm">{nightAction.label}</p>
          <div className="flex flex-wrap gap-2">
            {nightAction.targets.map((p) => (
              <Button
                key={p.id}
                variant={me.nightTargetId === p.id ? 'primary' : 'ghost'}
                onClick={() => onAction({ type: nightAction!.type, targetUserId: p.id })}
              >
                {p.displayName}
              </Button>
            ))}
          </div>
        </div>
      )}
      {view.phase === 'NIGHT' && me.alive && me.nightTargetId && (
        <p className="text-sm text-white/60">انتخاب تو: {nameOf(me.nightTargetId)}</p>
      )}
      {view.phase === 'NIGHT' && me.alive && me.role === 'CITIZEN' && (
        <p className="text-sm text-white/60">شب است… منتظر بمان.</p>
      )}

      {view.detectiveInvestigations && view.detectiveInvestigations.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-white/50">نتیجه‌ی استعلام‌ها</p>
          <ul className="flex flex-col gap-1 text-sm">
            {view.detectiveInvestigations.map((i) => (
              <li key={`${i.round}-${i.targetId}`} className="rounded-lg bg-white/5 px-3 py-1.5">
                دور {i.round}: {nameOf(i.targetId)} — {i.isMafia ? 'مافیاست' : 'مافیا نیست'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.phase === 'DAY_ANNOUNCEMENT' && view.lastNightOutcome && (
        <p className="rounded-xl bg-white/5 p-3 text-center">
          {view.lastNightOutcome.eliminatedPlayerId
            ? `دیشب ${nameOf(view.lastNightOutcome.eliminatedPlayerId)} کشته شد (${ROLE_LABEL[view.lastNightOutcome.revealedRole!]}).`
            : 'دیشب کسی کشته نشد.'}
        </p>
      )}

      {view.phase === 'VOTING' && me.alive && (
        <div>
          <p className="mb-2 text-sm">به چه کسی رأی می‌دهی؟</p>
          <div className="flex flex-wrap gap-2">
            {alivePlayers.map((p) => (
              <Button
                key={p.id}
                variant={view.currentVoteTally?.votes[me.id] === p.id ? 'primary' : 'ghost'}
                onClick={() => onAction({ type: 'PLAYER_VOTE', targetUserId: p.id })}
              >
                {p.displayName}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => onAction({ type: 'PLAYER_VOTE', targetUserId: null })}>
              ممتنع
            </Button>
          </div>
        </div>
      )}

      {view.currentVoteTally && (
        <div>
          <p className="mb-1 text-xs text-white/50">رأی‌ها</p>
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(view.currentVoteTally.votes).map(([voter, target]) => (
              <li key={voter}>
                {nameOf(voter)} ← {target ? nameOf(target) : 'ممتنع'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.phase === 'VOTE_RESULT' && view.lastVoteOutcome && (
        <p className="rounded-xl bg-white/5 p-3 text-center">
          {view.lastVoteOutcome.eliminatedPlayerId
            ? `${nameOf(view.lastVoteOutcome.eliminatedPlayerId)} با رأی حذف شد (${ROLE_LABEL[view.lastVoteOutcome.revealedRole!]}).`
            : view.lastVoteOutcome.wasTie
              ? 'رأی‌ها مساوی شد؛ کسی حذف نشد.'
              : 'کسی حذف نشد.'}
        </p>
      )}

      <div>
        <p className="mb-1 text-xs text-white/50">بازیکنان</p>
        <ul className="flex flex-col gap-1 text-sm">
          {view.players.map((p) => (
            <li key={p.id} className={`flex justify-between rounded-lg bg-white/5 px-3 py-1.5 ${p.alive ? '' : 'opacity-50'}`}>
              <span>
                {p.displayName}
                {p.id === me.id && ' (تو)'}
              </span>
              <span>{p.revealedRole ? ROLE_LABEL[p.revealedRole] : p.alive ? '' : 'حذف‌شده'}</span>
            </li>
          ))}
        </ul>
      </div>

      {view.eliminationHistory.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-white/50">تاریخچه</p>
          <ul className="flex flex-col gap-1 text-xs text-white/70">
            {view.eliminationHistory.map((e) => (
              <li key={`${e.round}-${e.playerId}`}>
                دور {e.round}: {nameOf(e.playerId)} — {CAUSE_LABEL[e.cause]} ({ROLE_LABEL[e.revealedRole]})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
