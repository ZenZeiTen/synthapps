import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Relative base so the same build works at a domain root, in a sub-folder
// (for example GitHub Pages) and inside the Android app's WebView.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Vitalis Health Tracker',
        short_name: 'Vitalis',
        description:
          'Record blood pressure, heart rate, blood glucose and uric acid. See trends, get plain-language insights and share a PDF report with your doctor.',
        theme_color: '#14233C',
        background_color: '#F1F5F3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        categories: ['health', 'medical', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Log a reading', short_name: 'Log', url: './?log=1', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900
  }
});
