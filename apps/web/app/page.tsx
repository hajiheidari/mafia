import Link from 'next/link';
import { t } from '@platform/i18n';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-10 px-5 py-10">
      <section className="flex w-full max-w-md flex-col items-center gap-4 pt-6 text-center">
        <div className="text-4xl">🎉</div>
        <h1 className="bg-gradient-to-l from-accent to-accentSoft bg-clip-text text-3xl font-extrabold leading-relaxed text-transparent">
          {t('home.title')}
        </h1>
        <p className="text-base text-white/70">{t('home.subtitle')}</p>

        <div className="mt-4 flex w-full flex-col gap-3">
          <Link
            href="/games"
            className="w-full rounded-2xl bg-accent py-4 text-center text-lg font-bold shadow-lg shadow-accent/30 transition-transform active:scale-[0.98]"
          >
            {t('home.cta.primary')}
          </Link>
          <Link
            href="/join"
            className="w-full rounded-2xl border border-white/15 bg-surface py-4 text-center text-lg font-semibold transition-transform active:scale-[0.98]"
          >
            {t('home.cta.secondary')}
          </Link>
        </div>
      </section>
    </main>
  );
}
