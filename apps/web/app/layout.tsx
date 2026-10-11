import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/AuthProvider';

export const metadata: Metadata = {
  title: 'بازی‌های دورهمی آنلاین',
  description: 'دوستات رو دعوت کن، یه اتاق بساز و بازی رو شروع کن.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
