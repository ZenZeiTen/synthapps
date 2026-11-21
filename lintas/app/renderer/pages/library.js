// lintas://history, lintas://downloads, lintas://bookmarks, lintas://offline
import { h, mount, hostOf, fmtTime, dayLabel, dayStart, fmtBytes, fmtNum, relTime, fmtDate, debounce, favLetter, hueFor, langName } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, emit, call, go, refreshBookmarks } from '../lib/store.js';
import { searchField, emptyState, iconBtn, btn } from '../ui/widgets.js';
import { confirmDialog, toast } from '../ui/overlay.js';
import { dlItem } from '../ui/toolbar.js';
import { clearDataDialog } from './settings.js';

const head = (ic, title, sub, ...right) => h('div.page-head', h('div', h('h1', icon(ic), title), sub ? h('div.sub', sub) : null), h('span.grow'), right);

export function historyPage(el, ctx) {
  const list = h('div'); let q = '';
  const sf = searchField('Search history', debounce((v) => { q = v; load(); }, 180), { width: 280 }); sf.input.dataset.pageSearch = '1';
  async function load() {
    const items = (await call(L().history.list({ q: q || undefined, limit: 300 }))) || [];
    if (!items.length) return mount(list, h('div.card', emptyState('history', q ? 'No history matches your search' : 'No browsing history', q ? 'Try a different word.' : 'Pages you visit will appear here. Private tabs are never recorded.')));
    const groups = new Map();
    for (const it of items) { const d = dayStart(it.visitedAt); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(it); }
    mount(list, [...groups].map(([d, rows]) => [h('div.day-head', dayLabel(d)), h('div.card.list-card', rows.map((it) =>
      h('button.list-row', { type: 'button', title: it.url, onClick: (e) => go(it.url, { tabId: ctx.tabId, newTab: e.ctrlKey || e.metaKey }) },
        h('span.time', fmtTime(it.visitedAt)), favLetter(it.url), h('span.lr-main', h('span.lr-title', { dir: 'auto' }, it.title || it.url), h('span.lr-sub', hostOf(it.url) + (it.visits > 1 ? ` · ${it.visits} visits` : ''))))))]));
  }
  mount(el, h('div.page', head('history', 'History', 'Stored only on this computer.', sf, btn('Clear browsing data…', { ic: 'trash', onClick: async () => { if (await clearDataDialog()) load(); } })), list));
  load();
  const off = on('tabs', debounce(() => { if (!el.hidden) load(); }, 800));
  return off;
}

export function downloadsPage(el) {
  const list = h('div.card.list-card');
  const draw = () => mount(list, S.downloads.length ? S.downloads.map((d) => dlItem(d)) : emptyState('download', 'No downloads', 'Files you download and TMS exports appear here.'));
  mount(el, h('div.page', head('download', 'Downloads', `${S.downloads.length} item${S.downloads.length === 1 ? '' : 's'}`), list));
  draw();
  return on('downloads', draw);
}

export function bookmarksPage(el, ctx) {
  const list = h('div'); let q = '';
  const sf = searchField('Search bookmarks', (v) => { q = v.toLowerCase(); draw(); }, { width: 280 }); sf.input.dataset.pageSearch = '1';
  function draw() {
    const items = S.bookmarks.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
    if (!items.length) return mount(list, h('div.card', emptyState('star', q ? 'No bookmarks match' : 'No bookmarks yet', q ? '' : 'Use the star in the address bar to bookmark a page.')));
    const folders = [...new Set(items.map((b) => b.folder || ''))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
    mount(list, folders.map((f) => [h('div.day-head', f ? [icon('folder', 14), ' ', f] : 'Bookmarks bar'), h('div.card.list-card', items.filter((b) => (b.folder || '') === f).map((b) => h('div.list-row',
      h('button.list-row', { type: 'button', style: { padding: 0, background: 'none' }, title: b.url, onClick: (e) => go(b.url, { tabId: ctx.tabId, newTab: e.ctrlKey || e.metaKey }) }, favLetter(b.url), h('span.lr-main', h('span.lr-title', { dir: 'auto' }, b.title), h('span.lr-sub', b.url))),
      h('span.muted', { style: { fontSize: '12px', flex: 'none' } }, fmtDate(b.createdAt)),
      h('span.lr-actions', iconBtn('external', 'Open in new tab', () => go(b.url, { newTab: true }), 'sm'), iconBtn('trash', 'Remove bookmark', async () => { await call(L().bookmarks.remove(b.id)); refreshBookmarks(); }, 'sm')))))]));
  }
  mount(el, h('div.page', head('star', 'Bookmarks', null, sf), list));
  draw();
  return on('bookmarks', draw);
}

export function offlinePage(el, ctx) {
  const grid = h('div'), stats = h('div.stat-strip'); let q = '';
  const sf = searchField('Search saved pages', debounce((v) => { q = v; load(); }, 180), { width: 280 }); sf.input.dataset.pageSearch = '1';
  async function load() {
    const pages = (await call(L().offline.list({ q: q || undefined }))) || [];
    if (!q) mount(stats,
      h('div.card.stat', h('b', fmtNum(pages.length)), h('span', 'Saved pages')),
      h('div.card.stat', h('b', fmtBytes(pages.reduce((a, p) => a + (p.bytes || 0), 0)) || '0 B'), h('span', 'On this computer')),
      h('div.card.stat', h('b', fmtNum(pages.reduce((a, p) => a + (p.words || 0), 0))), h('span', 'Words available offline')),
      h('div.card.stat', h('div.row', { style: { height: '36px' } }, h('input.switch', { type: 'checkbox', checked: !!S.settings.autoSaveOffline, 'aria-label': 'Auto-save visited pages', onChange: async (e) => { const { setSettings } = await import('../lib/store.js'); setSettings({ autoSaveOffline: e.target.checked }); } })), h('span', 'Auto-save visited pages')));
    if (!pages.length) return mount(grid, h('div.card', emptyState('saveOffline', q ? 'No saved pages match' : 'Your offline library is empty', q ? '' : 'Open a page and choose “Save page for offline” in the toolbar. Saved pages open without a network connection.')));
    mount(grid, h('div.off-grid', pages.map((p) => h('article.card.off-card',
      h('div.thumb', { style: { background: `linear-gradient(135deg, hsl(${hueFor(hostOf(p.url))} 48% 46%), hsl(${hueFor(hostOf(p.url)) + 36} 52% 34%))` } }, hostOf(p.url)),
      h('h3', { dir: 'auto', title: p.title }, p.title),
      h('div.meta', p.lang ? h('span.chip', langName(p.lang)) : null, h('span', `${fmtNum(p.words)} words`), h('span', '·'), h('span', fmtBytes(p.bytes)), h('span', '·'), h('span', { title: fmtDate(p.savedAt) }, relTime(p.savedAt))),
      h('div.acts', h('button.btn.sm.primary', { type: 'button', onClick: () => call(L().offline.open(p.id, { newTab: false })) }, 'Open'),
        h('button.btn.sm', { type: 'button', onClick: () => call(L().offline.open(p.id, { newTab: true })) }, 'New tab'), h('span.grow'),
        iconBtn('globe', 'Open the live page', () => go(p.url, { tabId: ctx.tabId }), 'sm'),
        iconBtn('trash', 'Remove from library', async () => { if (await confirmDialog({ title: 'Remove saved page?', message: `“${p.title}” will be removed from your offline library.`, ok: 'Remove', danger: true })) { await call(L().offline.remove(p.id)); toast('success', 'Removed from offline library', 2000); emit('offline-changed'); } }, 'sm'))))));
  }
  mount(el, h('div.page', head('saveOffline', 'Offline library', 'Complete pages saved on this computer. They open without a network connection.', sf), stats, grid));
  load();
  return on('offline-changed', load);
}
