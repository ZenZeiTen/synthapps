// Lintas browser chrome — entry point. Talks to main only through window.lintas (see docs/IPC.md).
import { S, L, on, emit, call, go, activeTab, loadPanelPrefs, setPanel, openPanel, refreshBookmarks, refreshDownloads, setSettings } from './lib/store.js';
import { isMod } from './lib/dom.js';
import { toast, viewHeld, closeAllPopovers } from './ui/overlay.js';
import { initTabstrip } from './ui/tabstrip.js';
import { initToolbar, focusOmnibox, toggleBookmark, saveOffline, downloadsBubble, queuePermission, openTms, openInternal, reloadTab } from './ui/toolbar.js';
import { initBookmarksBar } from './ui/bookmarksbar.js';
import { initContent, openFind, closeFind, reportBounds } from './ui/content.js';
import { initSidePanel } from './ui/sidepanel.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = S.settings.theme || 'system';
  document.documentElement.dataset.theme = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;
}

async function boot() {
  if (!window.lintas) {
    const { installMock } = await import('./mock.js');
    installMock(); S.preview = true;
    const p = new URLSearchParams(location.search).get('platform'); if (p) window.lintas.__preview.setPlatform(p);
  }
  const api = L();
  const [status, settings, tabs, bookmarks, downloads] = await Promise.all([api.app.status(), api.settings.get(), api.tabs.list(), api.bookmarks.list(), api.downloads.list()]);
  Object.assign(S, { status, settings, tabs, bookmarks, downloads, online: status.online !== false });
  document.documentElement.dataset.platform = status.platform || 'linux';
  if (S.preview) document.documentElement.dataset.preview = '1';
  loadPanelPrefs();
  applyTheme(); media.addEventListener('change', applyTheme); on('settings', applyTheme);

  on('toast', (t) => toast(t.kind || 'info', t.message));
  initTabstrip(); initToolbar(); initBookmarksBar(); initContent(); initSidePanel();

  api.on('tabs', (list) => { S.tabs = list || []; emit('tabs'); });
  api.on('find', (r) => emit('find-result', r));
  api.on('permission', (req) => queuePermission(req));
  const seen = new Set(S.downloads.map((d) => d.id));
  api.on('download', (d) => {
    const i = S.downloads.findIndex((x) => x.id === d.id);
    if (i >= 0) S.downloads[i] = d; else S.downloads.unshift(d);
    emit('downloads');
    if (!seen.has(d.id)) { seen.add(d.id); if (d.state === 'progressing') downloadsBubble(); }
  });
  api.on('context', onContext);
  api.on('online', ({ online }) => { S.online = online; S.status.online = online; emit('online'); emit('tabs'); });
  api.on('shortcut', ({ name }) => runShortcut(name));
  api.on('toast', (t) => toast(t.kind || 'info', t.message));
  api.on('settings', (s) => { if (s) { S.settings = s; emit('settings'); } });

  window.addEventListener('keydown', onKey);
  window.addEventListener('online', () => api.app.status().then((s) => { S.status = s; S.online = s.online !== false; emit('online'); emit('status'); }).catch(() => {}));
  window.addEventListener('offline', () => { S.online = false; emit('online'); });
  window.addEventListener('contextmenu', (e) => { if (!e.target.closest?.('input, textarea, .selectable, [contenteditable]')) e.preventDefault(); });
  window.addEventListener('dragover', (e) => e.preventDefault()); window.addEventListener('drop', (e) => e.preventDefault());
  document.documentElement.dataset.ready = '1';
  reportBounds();
}

function onContext({ action, tabId, selection }) {
  const view = { lookup: 'translate', translate: 'translate', 'translate-page': 'translate', 'add-term': 'terms', ask: 'assistant' }[action];
  if (!view) return;
  if (tabId != null && activeTab()?.id !== tabId) call(L().tabs.activate(tabId));
  openPanel(view, { action, selection: selection || '' });
}

/* ---------- keyboard ---------- */
const cycle = (d) => { const i = S.tabs.findIndex((t) => t.active); const n = S.tabs[(i + d + S.tabs.length) % S.tabs.length]; if (n) call(L().tabs.activate(n.id)); };
const withTab = (fn) => { const t = activeTab(); if (t) return call(fn(t)); };

export function runShortcut(name) {
  const m = /^tab-(\d)$/.exec(name);
  if (m) { const n = Number(m[1]); const t = n === 9 ? S.tabs[S.tabs.length - 1] : S.tabs[n - 1]; if (t) call(L().tabs.activate(t.id)); return; }
  const map = {
    'focus-omnibox': () => focusOmnibox(),
    find: () => openFind(),
    'new-tab': () => call(L().tabs.create({})).then(() => focusOmnibox()),
    'close-tab': () => withTab((t) => L().tabs.close(t.id)),
    'reopen-tab': () => call(L().tabs.reopenClosed()),
    'next-tab': () => cycle(1), 'prev-tab': () => cycle(-1),
    'toggle-panel': () => setPanel({ open: !S.panel.open }),
    'open-tms': () => openTms(),
    bookmark: () => toggleBookmark(),
    downloads: () => downloadsBubble(),
    history: () => openInternal('lintas://history'),
    print: () => withTab((t) => (t.kind === 'web' ? L().nav.print(t.id) : Promise.resolve(window.print()))),
    'save-offline': () => saveOffline(),
    'new-private-tab': () => call(L().tabs.create({ private: true })),
    'toggle-bookmarks-bar': () => setSettings({ showBookmarksBar: !S.settings.showBookmarksBar }),
    reload: () => withTab((t) => reloadTab(t, false)),
    back: () => withTab((t) => L().nav.back(t.id)), forward: () => withTab((t) => L().nav.forward(t.id)),
    'zoom-in': () => withTab((t) => L().nav.zoom(t.id, 'in')), 'zoom-out': () => withTab((t) => L().nav.zoom(t.id, 'out')), 'zoom-reset': () => withTab((t) => L().nav.zoom(t.id, 'reset')),
    settings: () => openInternal('lintas://settings'),
  };
  closeAllPopoversIfNeeded(name);
  map[name]?.();
}
function closeAllPopoversIfNeeded(name) { if (viewHeld() && !['bookmark', 'save-offline'].includes(name) && !document.querySelector('#overlays .backdrop')) closeAllPopovers(); }

function onKey(e) {
  if (e.defaultPrevented) return;
  const mod = isMod(e), k = e.key.toLowerCase();
  const modal = !!document.querySelector('#overlays .backdrop');
  let name = null;
  if (mod && !e.altKey) {
    if (e.shiftKey) name = { t: 'reopen-tab', n: 'new-private-tab', e: 'toggle-panel', m: 'open-tms', b: 'toggle-bookmarks-bar', tab: 'prev-tab' }[k];
    else name = { t: 'new-tab', w: 'close-tab', l: 'focus-omnibox', f: 'find', r: 'reload', d: 'bookmark', j: 'downloads', h: 'history', p: 'print', s: 'save-offline', tab: 'next-tab', pagedown: 'next-tab', pageup: 'prev-tab', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', 0: 'zoom-reset', ',': 'settings', '[': 'back', ']': 'forward' }[k];
    if (!name && !e.shiftKey && /^[1-9]$/.test(e.key)) name = 'tab-' + e.key;
  } else if (e.altKey && !mod) {
    name = { arrowleft: 'back', arrowright: 'forward', d: 'focus-omnibox' }[k];
    if (name && name !== 'focus-omnibox' && e.target.closest?.('input, textarea')) name = null;
  } else if (!mod && !e.altKey) {
    if (e.key === 'F5') name = 'reload'; else if (e.key === 'F6') name = 'focus-omnibox'; else if (e.key === 'F3') name = 'find';
    else if (e.key === 'Escape') {
      if (S.find.open) { closeFind(); e.preventDefault(); return; }
      const t = activeTab(); if (t?.loading && !modal) { call(L().nav.stop(t.id)); e.preventDefault(); }
      return;
    }
  }
  if (!name) return;
  e.preventDefault();
  if (modal && !['next-tab', 'prev-tab'].includes(name)) return; // modal dialogs own the keyboard
  runShortcut(name);
}

boot().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre'); pre.style.cssText = 'padding:24px;white-space:pre-wrap;user-select:text';
  pre.textContent = 'Lintas could not start its interface.\n\n' + (e?.stack || e?.message || String(e)); document.body.appendChild(pre);
});
