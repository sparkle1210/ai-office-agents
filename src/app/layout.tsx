import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Agents Office',
  description: 'บริษัทซอฟต์แวร์ที่พนักงานเป็น AI ทั้งหมด แยกแผนก แยกโซน',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Noto+Sans+Thai:wght@400;600;800&family=Prompt:wght@600;700&display=swap"
        />
      </head>
      <body suppressHydrationWarning><Providers>{children}</Providers></body>
    </html>
  );
}
