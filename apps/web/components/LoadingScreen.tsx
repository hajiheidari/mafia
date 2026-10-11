export function LoadingScreen({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-white">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-accent" />
      <p className="text-sm text-white/50">{label}</p>
    </main>
  );
}
