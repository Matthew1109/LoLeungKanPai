import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this project site from https://<user>.github.io/LoLeungKanPai/.
// This is the single source of truth: the dev server, `npm run preview` and the deployed build all use it.
// VITE_BASE can override it (for example VITE_BASE=/ for a copy hosted at a domain root).
const base = process.env.VITE_BASE ?? '/LoLeungKanPai/';

// Privacy guard: in production builds the browser itself refuses any request that is not to our own origin.
// (Not applied in dev, where Vite injects inline scripts.)
const cspPlugin = {
  name: 'lkp-csp',
  apply: 'build' as const,
  transformIndexHtml() {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ');
    return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' as const }];
  },
};

export default defineConfig({
  base,
  plugins: [
    react(),
    cspPlugin,
    VitePWA({
      registerType: 'prompt', // never reload the app underneath the user; we show an "update ready" prompt
      includeAssets: ['apple-touch-icon.png', 'favicon.png'],
      manifest: {
        name: 'LoLeungKanPai',
        short_name: 'LoLeungKanPai',
        description: 'A private drinks and cocktail journal. Everything stays on your device.',
        scope: base,
        start_url: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d0d0f',
        theme_color: '#0d0d0f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
