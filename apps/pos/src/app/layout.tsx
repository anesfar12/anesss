// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Next.js 15 Root Layout
// PWA manifest, offline service worker, Arabic/English i18n
// ═══════════════════════════════════════════════════════════════════════════

import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Arabic } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LUXE POS',
  description: 'LUXE Parfums — Point of Sale Terminal v5.1',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LUXE POS',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
    icon: '/icons/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#1a1a1a',
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${inter.variable} ${notoArabic.variable} font-sans antialiased bg-neutral-950 text-neutral-50 select-none`}>
        <div id="pos-root" className="h-screen w-screen overflow-hidden">
          {children}
        </div>
        {/* Toast portal */}
        <div id="toast-portal" />
      </body>
    </html>
  );
}
