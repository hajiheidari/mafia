'use client';

import { useState } from 'react';
import { Button } from './Button';

interface RoomCodeDisplayProps {
  code: string;
  inviteUrl: string;
}

export function RoomCodeDisplay({ code, inviteUrl }: RoomCodeDisplayProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  async function copy(text: string, which: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard API can be unavailable (older mobile browsers, insecure
      // context) — fail silently rather than showing a raw error; the code
      // is already visible on screen for manual copy.
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'دعوت به بازی', text: `به اتاق من بپیوند: ${code}`, url: inviteUrl });
      } catch {
        // user cancelled the share sheet — not an error
      }
    } else {
      copy(inviteUrl, 'link');
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-surface p-6 text-center">
      <span className="text-sm text-white/50">کد اتاق</span>
      <span className="text-4xl font-black tracking-[0.3em] text-accentSoft" dir="ltr">
        {code}
      </span>
      <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row">
        <Button variant="secondary" fullWidth onClick={() => copy(code, 'code')}>
          {copied === 'code' ? 'کپی شد ✓' : 'کپی کد'}
        </Button>
        <Button variant="secondary" fullWidth onClick={() => copy(inviteUrl, 'link')}>
          {copied === 'link' ? 'کپی شد ✓' : 'کپی لینک دعوت'}
        </Button>
        <Button variant="primary" fullWidth onClick={share}>
          اشتراک‌گذاری
        </Button>
      </div>
    </div>
  );
}
