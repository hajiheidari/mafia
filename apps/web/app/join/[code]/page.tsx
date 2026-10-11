'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchRoomByCode, friendlyRoomError } from '../../../lib/roomApi';
import { useAuth } from '../../../lib/AuthProvider';
import { LoadingScreen } from '../../../components/LoadingScreen';
import Link from 'next/link';

export default function JoinLinkPage() {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toString().toUpperCase();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'ready') return; // wait for guest session before touching the API
    let cancelled = false;
    fetchRoomByCode(code)
      .then(() => {
        if (!cancelled) router.replace(`/room/${code}`);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyRoomError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, code, router]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg text-red-400">{error}</p>
        <Link href="/join" className="text-accentSoft underline">
          ورود با کد دیگر
        </Link>
      </main>
    );
  }

  return <LoadingScreen label="در حال ورود به اتاق…" />;
}
