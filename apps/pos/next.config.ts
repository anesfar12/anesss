// ═══════════════════════════════════════════════════════════════════════════
// LUXE POS v5.1 — Next.js 15 Configuration
// PWA headers, offline service worker, security headers
// ═══════════════════════════════════════════════════════════════════════════

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Output for Docker deployment
  output: 'standalone',

  // Experimental features (Next.js 15)
  experimental: {
    // PPR (Partial Pre-Rendering) for faster initial load
    ppr: false,
    // React 19 optimizations
    reactCompiler: false,
  },

  // PWA / Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Security
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // PWA
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      // Static assets — long cache
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Service Worker
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },

  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_APP_VERSION: '5.1.0',
    NEXT_PUBLIC_APP_NAME: 'LUXE POS',
  },

  // Webpack customisation
  webpack: (config) => {
    // Allow top-level await for Dexie
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
};

export default nextConfig;
