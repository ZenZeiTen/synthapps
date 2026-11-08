// Offline support for the hosted web app: the app files are cached so it opens
// without a connection. API calls always go to the network (never cached).
const CACHE = 'keyhold-app-v2';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/ui.js', 'js/crypto.js', 'js/model.js', 'js/totp.js',
  'js/generator.js', 'js/importers.js', 'js/storage.js', 'js/session.js', 'js/views.js', 'js/workbench.js', 'icons/icon.svg', 'manifest.webmanifest',
  'words/eff_large_wordlist.txt'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates arrive at once; the cache is the offline fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
