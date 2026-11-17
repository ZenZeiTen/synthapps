import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { en, type Dict } from './src/i18n/en.ts';
import { id } from './src/i18n/id.ts';

/**
 * The install details (name, description, shortcut) in one language. The
 * text comes from the app's dictionaries, so the installed app and the app
 * itself always use the same words.
 */
function manifestFor(d: Dict) {
  return {
    name: d.meta.installName,
    short_name: 'Vitalis',
    description: d.meta.installDescription,
    lang: d.meta.htmlLang,
    theme_color: '#14233C',
    background_color: '#F1F5F3',
    display: 'standalone' as const,
    orientation: 'portrait' as const,
    start_url: './',
    scope: './',
    categories: ['health', 'medical', 'lifestyle'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: d.meta.shortcutLog, short_name: d.meta.shortcutLogShort, url: './?log=1', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] }
    ]
  };
}

/** Writes the Indonesian manifest next to the English one the PWA plugin makes. */
function indonesianManifest(): Plugin {
  return {
    name: 'vitalis-manifest-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest-id.webmanifest', source: JSON.stringify(manifestFor(id)) });
    }
  };
}

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
      // English is the default; the app swaps in manifest-id.webmanifest in Indonesian (src/i18n/index.ts).
      manifest: manifestFor(en),
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}', 'manifest-id.webmanifest'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    }),
    indonesianManifest()
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900
  }
});
