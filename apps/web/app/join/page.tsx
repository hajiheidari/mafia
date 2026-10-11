'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@platform/ui';
import { fetchRoomByCode, friendlyRoomError } from '../../lib/roomApi';
import { useAuth } from '../../lib/AuthProvider';
import { LoadingScreen } from '../../components/LoadingScreen';

export default function JoinPage() {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (authStatus === 'loading') return <LoadingScreen />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setError(null);
    setChecking(true);
    try {
      await fetchRoomByCode(trimmed); // validate before navigating, so errors show right here
      router.push(`/room/${trimmed}`);
    } catch (err) {
      setError(friendlyRoomError(err));
      setChecking(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-5 py-10">
      <h1 className="text-2xl font-extrabold">ورود به اتاق</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD12"
          maxLength={6}
          dir="ltr"
          autoFocus
          aria-label="کد اتاق"
          className="min-h-[56px] rounded-2xl border border-white/15 bg-surface px-4 text-center text-2xl font-black tracking-[0.3em] text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="text-center text-sm text-red-400">{error}</p>}
        <Button type="submit" fullWidth disabled={checking || code.trim().length === 0}>
          {checking ? 'در حال بررسی…' : 'ورود به اتاق'}
        </Button>
      </form>
    </main>
  );
}
