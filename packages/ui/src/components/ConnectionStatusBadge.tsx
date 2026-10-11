export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'reconnected';

const CONFIG: Record<ConnectionStatus, { label: string; dot: string; pulse?: boolean }> = {
  connecting: { label: 'در حال اتصال…', dot: 'bg-yellow-400', pulse: true },
  connected: { label: 'متصل', dot: 'bg-green-400' },
  reconnecting: { label: 'ارتباط قطع شد. در حال اتصال مجدد…', dot: 'bg-red-400', pulse: true },
  reconnected: { label: 'دوباره متصل شدی', dot: 'bg-green-400' },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const { label, dot, pulse } = CONFIG[status];
  return (
    <div className="flex items-center gap-2 text-xs text-white/60" role="status" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
