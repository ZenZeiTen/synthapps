// Content area: reports the native-view rectangle to main, mounts internal pages and error pages,
// hosts the find bar. Web pages themselves are drawn by main on top of #viewport.
import { h, mount, debounce, errText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, emit, call, go, activeTab, parseInternal, setTitle } from '../lib/store.js';
import { iconBtn } from './widgets.js';

import newtab from '../pages/newtab.js';
import { historyPage, downloadsPage, bookmarksPage, offlinePage } from '../pages/library.js';
import settingsPage from '../pages/settings.js';
import errorPage from '../pages/error.js';
import tmsHome from '../tms/home.js';
import tmsProject from '../tms/project.js';
import tmsEditor from '../tms/editor.js';

const PAGES = { newtab, history: historyPage, downloads: downloadsPage, bookmarks: bookmarksPage, offline: offlinePage, settings: settingsPage, tms: tmsHome, 'tms-project': tmsProject, 'tms-file': tmsEditor };

let viewport, webSlot, findstrip, contentEl;
const hosts = new Map(); // tabId -> { key, el, dispose }
let lastBounds = '';

export function initContent() {
  contentEl = document.getElementById('content');
  viewport = document.getElementById('viewport');
  findstrip = document.getElementById('findstrip');
  webSlot = h('div.web-slot', { hidden: true });
  viewport.appendChild(webSlot);
  new ResizeObserver(reportBounds).observe(viewport);
  window.addEventListener('resize', reportBounds);
  on('tabs', render); on('panel', () => requestAnimationFrame(reportBounds)); on('settings', () => requestAnimationFrame(reportBounds));
  on('reload-internal', (id) => { const hst = hosts.get(id); if (hst) { drop(id); render(); } });
  on('find-result', showFindResult);
  render();
}

export function reportBounds() {
  const r = viewport.getBoundingClientRect();
  const b = { x: Math.round(r.left), y: Math.round(r.top), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) };
  const k = JSON.stringify(b); if (k === lastBounds) return; lastBounds = k;
  call(L().view.setBounds(b), { silent: true });
}

function drop(id) { const x = hosts.get(id); if (!x) return; try { x.dispose && x.dispose(); } catch (e) { console.error(e); } x.el.remove(); hosts.delete(id); }

function render() {
  const t = activeTab();
  for (const id of [...hosts.keys()]) if (!S.tabs.some((x) => x.id === id)) drop(id);
  if (!t) return;
  const internal = t.kind === 'internal';
  const key = internal ? 'page:' + t.url : t.error ? `error:${t.error.code}:${t.error.url || t.url}:${t.offlineCopy?.id || ''}:${S.online}` : null;
  for (const [id, x] of hosts) x.el.hidden = id !== t.id || !key;
  if (key) {
    let x = hosts.get(t.id);
    if (x && x.key !== key) { drop(t.id); x = null; }
    if (!x) {
      const el = h('div.page-host', { dataset: { tab: t.id } });
      viewport.appendChild(el);
      x = { key, el, dispose: null }; hosts.set(t.id, x);
      const ctx = { tab: t, tabId: t.id, url: t.url, params: internal ? parseInternal(t.url) : null, setTitle: (title) => setTitle(t.url, title), navigate: (url, opts) => go(url, { tabId: t.id, ...opts }) };
      try {
        const fn = internal ? (PAGES[ctx.params?.page] || notFound) : errorPage;
        const d = fn(el, ctx); if (typeof d === 'function') x.dispose = d;
      } catch (e) { console.error(e); mount(el, h('div.empty', icon('alert'), h('h3', 'This page could not be shown'), h('p', errText(e, 'Unexpected error.')))); }
    }
    x.el.hidden = false;
    webSlot.hidden = true;
  } else {
    drop(t.id);
    webSlot.hidden = false;
    webSlot.classList.toggle('native', !S.preview);
    if (S.preview) L().__preview.mount(webSlot, t);
  }
  // find bar belongs to one tab
  if (S.find.open && S.find.tabId !== t.id) closeFind();
  contentEl.classList.toggle('float-find', !!key);
  reportBounds();
}

function notFound(el, ctx) {
  mount(el, h('div.empty', icon('info'), h('h3', 'There is no Lintas page at this address'), h('p', ctx.url), h('button.btn.primary', { type: 'button', onClick: () => ctx.navigate('lintas://newtab') }, 'Open a new tab page')));
}

/* ---------- find bar ---------- */
let findInput, findCount, localRanges = [], localIdx = 0;

export function openFind() {
  const t = activeTab(); if (!t) return;
  // pages with their own search field use it instead
  const own = hosts.get(t.id)?.el.querySelector('[data-page-search]');
  if (own) { own.focus(); own.select?.(); return; }
  if (!S.find.open) {
    S.find = { open: true, tabId: t.id };
    findInput = h('input.input', { type: 'search', placeholder: 'Find in page', 'aria-label': 'Find in page', spellcheck: false, dir: 'auto' });
    findCount = h('span.count', { 'aria-live': 'polite' });
    mount(findstrip, h('div.findbar', { role: 'search' }, findInput, findCount,
      iconBtn('chevUp', 'Previous match (Shift+Enter)', () => runFind(true, false), 'sm'), iconBtn('chevDown', 'Next match (Enter)', () => runFind(true, true), 'sm'), iconBtn('close', 'Close find bar (Esc)', closeFind, 'sm')));
    findstrip.hidden = false;
    const run = debounce(() => runFind(false, true), 120);
    findInput.addEventListener('input', run);
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runFind(true, !e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    reportBounds();
  }
  findInput.focus(); findInput.select();
}

export function closeFind() {
  if (!S.find.open) return;
  const id = S.find.tabId; S.find = { open: false };
  findstrip.hidden = true; mount(findstrip);
  clearLocal();
  const t = S.tabs.find((x) => x.id === id);
  if (t && t.kind === 'web') call(L().nav.stopFind(id), { silent: true });
  reportBounds();
}

async function runFind(findNext, forward) {
  const t = activeTab(); if (!t) return; const text = findInput.value;
  if (t.kind === 'web' && !t.error) {
    if (!text) { showCount(0, 0, true); return call(L().nav.stopFind(t.id), { silent: true }); }
    const r = await call(L().nav.find(t.id, text, { forward, findNext }), { silent: true });
    if (r && typeof r.matches === 'number') showCount(r.matches, r.active);
  } else localFind(text, findNext, forward);
}
function showFindResult(r) { if (S.find.open && r.tabId === S.find.tabId && findInput?.value) showCount(r.matches, r.active); }
function showCount(matches, active, blank) {
  if (!findCount) return;
  findCount.textContent = blank ? '' : matches ? `${active || 1} of ${matches}` : 'No results'; findCount.classList.toggle('none', !blank && !matches);
}

// Internal pages: search the page host's text with the CSS Custom Highlight API (no DOM changes).
function clearLocal() { localRanges = []; localIdx = 0; try { CSS.highlights?.delete('lintas-find'); CSS.highlights?.delete('lintas-find-cur'); } catch { /* unsupported */ } }
function localFind(text, findNext, forward) {
  const rootEl = hosts.get(activeTab()?.id)?.el;
  if (!rootEl || !window.Highlight || !CSS.highlights) return showCount(0, 0, !text);
  if (!findNext || !localRanges.length) {
    clearLocal(); if (!text) return showCount(0, 0, true);
    const q = text.toLowerCase(); const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement; if (!p || p.closest('[hidden], script, style') || !p.offsetParent) continue;
      const s = n.data.toLowerCase(); let i = 0, k;
      while ((k = s.indexOf(q, i)) >= 0 && localRanges.length < 2000) { const r = new Range(); r.setStart(n, k); r.setEnd(n, k + q.length); localRanges.push(r); i = k + q.length; }
    }
    localIdx = 0;
    if (localRanges.length) CSS.highlights.set('lintas-find', new Highlight(...localRanges));
  } else localIdx = (localIdx + (forward ? 1 : -1) + localRanges.length) % localRanges.length;
  if (localRanges.length) {
    CSS.highlights.set('lintas-find-cur', new Highlight(localRanges[localIdx]));
    localRanges[localIdx].startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }
  showCount(localRanges.length, localIdx + 1);
}

export function activePageHost() { return hosts.get(activeTab()?.id)?.el || null; }
export { emit };
