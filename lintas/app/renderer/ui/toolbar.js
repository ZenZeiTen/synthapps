// Toolbar: navigation buttons, omnibox (security chip, clean URL, suggestions), page actions, bubbles, main menu.
import { h, mount, clear, debounce, splitUrl, hostOf, fmtBytes, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, emit, call, go, activeTab, setPanel, openPanel, setSettings, refreshBookmarks, refreshDownloads, modLabel, isDarwin } from '../lib/store.js';
import { openMenu, openPopover, holdView, toast, openDialog } from './overlay.js';
import { ring, iconBtn, withBusy } from './widgets.js';
import { tabTitle } from './tabstrip.js';
import { openFind } from './content.js';
import { clearDataDialog } from '../pages/settings.js';

const SUGG_ICON = { url: 'globe', search: 'search', history: 'clock', bookmark: 'star', tab: 'tab', offline: 'saveOffline', tms: 'tms' };
const SUGG_LABEL = { tab: 'Switch to tab', offline: 'Offline', tms: 'TMS', bookmark: 'Bookmark' };
const PERM = {
  media: ['mic', 'use your camera and microphone'], geolocation: ['mapPin', 'know your location'], notifications: ['bell', 'show notifications'],
  'clipboard-read': ['clipboard', 'see text and images copied to the clipboard'], midi: ['bolt', 'control your MIDI devices'], pointerLock: ['eye', 'hide and lock your mouse pointer'],
};

let el = {}; // element refs
let sugg = [], sel = -1, typed = '', dropRelease = null, suggToken = 0;
const permQueue = []; let permOpen = null;

export function initToolbar() {
  const bar = document.getElementById('toolbar');
  const m = modLabel();
  el.back = iconBtn('back', `Back (${isDarwin() ? '⌘[' : 'Alt+←'})`, () => act((t) => L().nav.back(t.id)));
  el.fwd = iconBtn('forward', `Forward (${isDarwin() ? '⌘]' : 'Alt+→'})`, () => act((t) => L().nav.forward(t.id)));
  el.reload = iconBtn('reload', `Reload (${m}R)`, (e) => act((t) => (t.loading ? L().nav.stop(t.id) : reloadTab(t, e.shiftKey))));
  el.home = iconBtn('home', 'Home', () => go(S.settings.homepage || 'lintas://newtab'));

  el.sec = h('button.sec-chip', { type: 'button', onClick: () => siteInfo() });
  el.input = h('input.omni-input', { type: 'text', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', placeholder: 'Search or enter address', 'aria-label': 'Address and search bar', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'omni-drop', 'aria-autocomplete': 'list' });
  el.display = h('div.omni-display', { 'aria-hidden': 'true' });
  el.zoom = h('button.zoom-chip', { type: 'button', hidden: true, title: 'Reset zoom', onClick: () => act((t) => L().nav.zoom(t.id, 'reset')) });
  el.shield = h('button.shield-btn', { type: 'button', onClick: () => shieldInfo() });
  el.star = iconBtn('star', `Bookmark this page (${m}D)`, () => toggleBookmark());
  el.drop = h('div.omni-drop', { id: 'omni-drop', role: 'listbox', hidden: true });
  el.omni = h('div.omnibox', h('div.omni-field', el.sec, h('div.omni-input-wrap', el.input, el.display), h('div.omni-end', el.zoom, el.shield, el.star)), el.drop);

  // Chrome extension buttons (the <browser-action-list> element comes from the preload).
  el.ext = document.createElement('browser-action-list');
  el.ext.setAttribute('partition', 'persist:lintas');
  el.ext.setAttribute('alignment', 'bottom left');
  el.ext.className = 'ext-actions';
  el.translate = iconBtn('translate', 'Translate this page', () => openPanel('translate'));
  el.save = iconBtn('saveOffline', `Save page for offline (${m}S)`, () => saveOffline());
  el.panel = iconBtn('panel', `Side panel (${m}Shift+E)`, () => setPanel({ open: !S.panel.open }));
  el.dl = iconBtn('download', `Downloads (${m}J)`, () => downloadsBubble(), 'dl-btn');
  el.menu = iconBtn('more', 'Menu', () => mainMenu());
  el.offline = h('span.status-chip.offline', { hidden: true, title: 'No network connection. Saved pages and the TMS keep working.' }, icon('wifiOff'), 'Offline');
  el.preview = S.preview ? h('button.status-chip.preview', { type: 'button', title: 'Running without the Electron main process: all data is sample data.', onClick: (e) => previewMenu(e.currentTarget) }, icon('eye'), 'Preview mode') : null;
  el.loadbar = h('div#loadbar');

  mount(bar, h('div.nav-group', el.back, el.fwd, el.reload, el.home), el.omni, el.offline, el.preview,
    h('div.action-group', el.ext, el.translate, el.save, el.panel, el.dl, el.menu), el.loadbar);

  el.input.addEventListener('focus', () => { el.omni.classList.add('focused'); typed = el.input.value; el.input.select(); });
  // a click that focuses the field selects the whole address (like Chrome); later clicks place the caret
  el.input.addEventListener('mousedown', () => { if (document.activeElement !== el.input) el.input.addEventListener('mouseup', (e) => { if (el.input.selectionStart === el.input.selectionEnd) { e.preventDefault(); el.input.select(); } }, { once: true }); });
  el.input.addEventListener('blur', () => { el.omni.classList.remove('focused'); closeDrop(); syncOmni(true); });
  el.input.addEventListener('input', () => { typed = el.input.value; suggest(); });
  el.input.addEventListener('keydown', onOmniKey);
  el.omni.querySelector('.omni-field').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget || e.target === el.display) { e.preventDefault(); el.input.focus(); } });

  on('tabs', update); on('bookmarks', update); on('downloads', updateDl); on('online', update); on('panel', update); on('settings', update);
  update(); updateDl();
}

function act(fn) { const t = activeTab(); if (t) return call(fn(t)); }
export function reloadTab(t, hard) { if (t.kind === 'internal') { emit('reload-internal', t.id); return Promise.resolve(); } return L().nav.reload(t.id, { hard: !!hard }); }

/* ---------- state → UI ---------- */
function update() {
  const t = activeTab(); if (!t) return;
  el.back.disabled = !t.canGoBack; el.fwd.disabled = !t.canGoForward;
  mount(el.reload, icon(t.loading ? 'close' : 'reload'));
  el.reload.title = t.loading ? 'Stop loading (Esc)' : `Reload (${modLabel()}R)`; el.reload.setAttribute('aria-label', t.loading ? 'Stop loading' : 'Reload');
  el.loadbar.classList.toggle('on', !!t.loading);
  // security chip
  const s = t.private && t.security === 'internal' ? 'internal' : t.security;
  const map = { secure: ['lock', '', 'Connection is secure'], insecure: ['warning', 'Not secure', 'Your connection to this site is not secure'], internal: ['layers', 'Lintas', 'This is a built-in Lintas page'],
    'offline-copy': ['saveOffline', 'Offline copy', 'You are viewing a copy saved on this computer'], error: ['info', '', 'This page could not be loaded'], file: ['file', 'File', 'A file on this computer'] };
  const [ic, label, tip] = map[s] || map.error;
  el.sec.className = `sec-chip s-${s}${label ? ' labelled' : ''}`; mount(el.sec, icon(ic), label || null);
  el.sec.title = tip; el.sec.setAttribute('aria-label', tip);
  // zoom, shield, star
  el.zoom.hidden = !(t.kind === 'web' && Math.abs((t.zoom || 1) - 1) > 0.001); el.zoom.textContent = Math.round((t.zoom || 1) * 100) + '%';
  const web = t.kind === 'web';
  el.shield.hidden = !web; el.shield.classList.toggle('has', t.blocked > 0);
  mount(el.shield, icon(S.settings.blockTrackers ? 'shieldCheck' : 'shield'), t.blocked > 0 ? String(t.blocked) : null);
  el.shield.title = S.settings.blockTrackers ? `${t.blocked || 0} trackers and ads blocked on this page` : 'Tracker blocking is off'; el.shield.setAttribute('aria-label', el.shield.title);
  const isNew = t.url === 'lintas://newtab';
  const marked = t.bookmarked ?? S.bookmarks.some((b) => b.url === t.url);
  el.star.hidden = isNew; el.star.classList.toggle('starred', !!marked); mount(el.star, icon(marked ? 'starFilled' : 'star'));
  el.star.title = marked ? 'Remove bookmark' : `Bookmark this page (${modLabel()}D)`; el.star.setAttribute('aria-pressed', String(!!marked));
  // actions
  el.translate.disabled = !web || !!t.error; el.translate.classList.toggle('on', !!t.translated);
  el.translate.title = t.translated ? `Translated to ${String(t.translated.targetLang).toUpperCase()} — open translation panel` : 'Translate this page';
  el.save.disabled = !web || !!t.error; mount(el.save, icon(t.offlineCopy ? 'offlineDone' : 'saveOffline'));
  el.save.title = t.offlineCopy ? `Saved for offline ${relTime(t.offlineCopy.savedAt)} — save again` : `Save page for offline (${modLabel()}S)`;
  el.panel.classList.toggle('on', S.panel.open); el.panel.setAttribute('aria-pressed', String(S.panel.open));
  el.offline.hidden = S.online !== false;
  syncOmni(false);
  pumpPermissions();
}

function syncOmni(force) {
  if (document.activeElement === el.input && !force) return;
  const t = activeTab(); if (!t) return;
  const url = t.url === 'lintas://newtab' ? '' : (t.error?.url || t.url);
  el.input.value = url; typed = url;
  clear(el.display);
  if (url) { const p = splitUrl(url); mount(el.display, p.scheme || null, h('b', p.host), p.rest || null); }
  el.input.classList.toggle('has-display', !!url);
}

export function focusOmnibox() { el.input.focus(); el.input.select(); }

/* ---------- suggestions ---------- */
const suggest = debounce(async () => {
  const text = el.input.value; const tk = ++suggToken;
  if (!text.trim()) return closeDrop();
  const r = (await call(L().omnibox.suggest(text), { silent: true })) || [];
  if (tk !== suggToken || document.activeElement !== el.input) return;
  sugg = r.slice(0, 8); sel = sugg.length ? 0 : -1;
  renderDrop();
}, 70);

function renderDrop() {
  if (!sugg.length) return closeDrop();
  mount(el.drop, sugg.map((s, i) => h('div.sugg', { class: i === sel ? 'sel' : '', role: 'option', id: 'sugg-' + i, 'aria-selected': String(i === sel),
    onMousedown: (e) => e.preventDefault(), onClick: () => commit(s), onMousemove: () => { if (sel !== i) { sel = i; markSel(); } } },
    icon(SUGG_ICON[s.type] || 'globe'), h('span.s-title', { dir: 'auto' }, s.title || s.url), s.detail ? h('span.s-detail', { dir: 'auto' }, s.detail) : h('span.grow'),
    SUGG_LABEL[s.type] ? h('span.s-type', SUGG_LABEL[s.type]) : null)));
  if (el.drop.hidden) { el.drop.hidden = false; el.omni.classList.add('open'); el.input.setAttribute('aria-expanded', 'true'); dropRelease = holdView(); }
  markSel();
}
function markSel() {
  [...el.drop.children].forEach((c, i) => { c.classList.toggle('sel', i === sel); c.setAttribute('aria-selected', String(i === sel)); });
  if (sel >= 0) el.input.setAttribute('aria-activedescendant', 'sugg-' + sel); else el.input.removeAttribute('aria-activedescendant');
}
function closeDrop() {
  suggToken++; suggest.cancel(); sugg = []; sel = -1;
  if (!el.drop.hidden) { el.drop.hidden = true; el.omni.classList.remove('open'); el.input.setAttribute('aria-expanded', 'false'); dropRelease && dropRelease(); dropRelease = null; }
}
function onOmniKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugg.length) { if (e.key === 'ArrowDown') suggest.flush(); return; }
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length; markSel();
    const s = sugg[sel]; el.input.value = sel === 0 ? typed : (s.type === 'search' ? s.title : s.url);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const text = el.input.value.trim(); if (!text) return;
    if (sel > 0 && sugg[sel]) commit(sugg[sel]); else { const t = activeTab(); closeDrop(); el.input.blur(); if (e.altKey) call(L().tabs.create({ url: text })); else if (t) call(L().nav.go(t.id, text)); }
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    if (!el.drop.hidden) { closeDrop(); el.input.value = typed; } else { el.input.blur(); }
  }
}
function commit(s) {
  const t = activeTab(); closeDrop(); el.input.blur();
  if (s.type === 'tab' && (s.tabId != null || S.tabs.some((x) => x.url === s.url))) return call(L().tabs.activate(s.tabId ?? S.tabs.find((x) => x.url === s.url).id));
  if (s.type === 'offline' && s.offlineId != null) return call(L().offline.open(s.offlineId, { newTab: false }));
  if (t) call(L().nav.go(t.id, s.type === 'search' && !s.url ? s.title : s.url));
}

/* ---------- page actions ---------- */
export async function toggleBookmark() {
  const t = activeTab(); if (!t || t.url === 'lintas://newtab') return;
  const r = await call(L().bookmarks.toggle({ url: t.url, title: tabTitle(t) }));
  if (r) { toast('success', r.bookmarked ? 'Bookmark added' : 'Bookmark removed', 2200); await refreshBookmarks(); }
}
export async function saveOffline() {
  const t = activeTab(); if (!t || t.kind !== 'web' || t.error) return toast('info', 'Open a web page to save it for offline reading.');
  await withBusy(el.save, async () => { const p = await call(L().offline.save(t.id)); if (p) { toast('success', `Saved for offline · ${fmtBytes(p.bytes)}`); emit('offline-changed'); } });
}

function siteInfo() {
  const t = activeTab(); if (!t) return;
  const rows = [];
  const kv = (ic, text, extra) => h('div.row-kv', icon(ic), h('span.grow', text), extra || null);
  let head, text;
  if (t.kind === 'internal') { head = 'Lintas page'; text = 'This page is part of the browser. Its data stays on this computer.'; }
  else if (t.security === 'secure') { head = 'Connection is secure'; text = 'Information you send to this site (passwords, card numbers) is encrypted in transit.'; }
  else if (t.security === 'offline-copy') { head = 'Offline copy'; text = `You are reading a copy saved on this computer${t.offlineCopy ? ' ' + relTime(t.offlineCopy.savedAt) : ''}. It may be older than the live page.`; }
  else if (t.security === 'file') { head = 'Local file'; text = 'This file is stored on your computer.'; }
  else if (t.security === 'error') { head = 'Page not loaded'; text = t.error?.description || 'The page could not be loaded.'; }
  else { head = 'Not secure'; text = 'This site does not use an encrypted connection. Do not enter passwords or payment details here.'; }
  if (t.kind === 'web') {
    rows.push(kv(S.settings.blockTrackers ? 'shieldCheck' : 'shield', S.settings.blockTrackers ? `${t.blocked || 0} trackers and ads blocked` : 'Tracker blocking is off'));
    rows.push(kv('cookie', S.settings.blockThirdPartyCookies ? 'Third-party cookies blocked' : 'Third-party cookies allowed'));
    if (S.settings.httpsOnly) rows.push(kv('lock', 'HTTPS-only mode is on'));
    if (t.offlineCopy && t.security !== 'offline-copy') rows.push(kv('offlineDone', `Saved copy from ${relTime(t.offlineCopy.savedAt)}`, h('button.btn.sm', { type: 'button', onClick: () => { pop.close(); call(L().offline.open(t.offlineCopy.id, { newTab: false })); } }, 'Open')));
  }
  const pop = openPopover(el.sec, h('div.bubble.site-info', h('h3', icon(el.sec.querySelector('svg') ? (t.security === 'secure' ? 'lock' : t.security === 'insecure' ? 'warning' : 'info') : 'info'), h('span.grow', head)),
    t.kind === 'web' ? h('div.perm-origin', hostOf(t.url)) : null, h('p', text), rows.length ? h('div', rows) : null,
    h('div.actions', h('button.btn.sm.ghost', { type: 'button', onClick: () => { pop.close(); go('lintas://settings'); } }, 'Privacy settings'))), { gap: 8 });
}

function shieldInfo() {
  const t = activeTab(); if (!t) return;
  const sw = h('input.switch', { type: 'checkbox', checked: !!S.settings.blockTrackers, 'aria-label': 'Block trackers and ads', onChange: async (e) => { await setSettings({ blockTrackers: e.target.checked }); toast('info', e.target.checked ? 'Tracker blocking on. Reload the page to apply.' : 'Tracker blocking off. Reload the page to apply.'); } });
  openPopover(el.shield, h('div.bubble', h('h3', icon('shieldCheck'), h('span.grow', 'Privacy protection')),
    h('div.perm-ask', h('strong', { style: { fontSize: '22px' } }, String(t.blocked || 0)), h('span', 'trackers and ads blocked on ', h('b', hostOf(t.url)))),
    h('label.check-row', h('span.grow', 'Block trackers and ads'), sw),
    h('p', S.settings.blockThirdPartyCookies ? 'Third-party cookies are blocked and sites are told not to track you.' : 'Third-party cookies are currently allowed.')), { align: 'right', gap: 8 });
}

/* ---------- downloads ---------- */
function updateDl() {
  const active = S.downloads.filter((d) => d.state === 'progressing');
  el.dl.querySelector('.ring')?.remove();
  el.dl.classList.toggle('pulse', active.length > 0);
  if (active.length) { const rec = active.reduce((a, d) => a + d.received, 0), tot = active.reduce((a, d) => a + (d.total || 0), 0); el.dl.appendChild(ring(tot ? rec / tot : null, { size: 26, stroke: 2.5, label: false })); }
  if (dlList) renderDlList();
}
let dlList = null, dlPop = null;
export function dlItem(d, { compact } = {}) {
  const prog = d.state === 'progressing';
  const sub = prog ? `${fmtBytes(d.received)} of ${d.total ? fmtBytes(d.total) : 'unknown size'}` : d.state === 'completed' ? `${fmtBytes(d.total || d.received)} · ${hostOf(d.url) || 'Lintas'}` : d.state === 'cancelled' ? 'Cancelled' : 'Interrupted — download failed';
  return h('div.dl-item', { class: d.state === 'cancelled' || d.state === 'interrupted' ? 'failed' : '' },
    h('div.dl-ic', prog ? ring(d.total ? d.received / d.total : null, { size: 36, stroke: 3, label: false }) : null, icon(d.state === 'completed' ? 'fileText' : prog ? 'download' : 'alert', prog ? 16 : 18)),
    h('div.dl-name', { title: d.savePath || d.filename, dir: 'auto' }, d.filename), h('div.dl-sub', sub),
    h('div.dl-acts',
      d.state === 'completed' ? [iconBtn('external', 'Open file', () => call(L().downloads.open(d.id)), 'sm'), iconBtn('folder', 'Show in folder', () => call(L().downloads.show(d.id)), 'sm')] : null,
      prog ? iconBtn('close', 'Cancel download', () => call(L().downloads.cancel(d.id)), 'sm') : null));
}
function renderDlList() {
  mount(dlList, S.downloads.length ? S.downloads.slice(0, 5).map((d) => dlItem(d)) : h('p', { style: { padding: '8px' } }, 'Files you download appear here.'));
}
export function downloadsBubble() {
  if (dlPop) return;
  dlList = h('div');
  renderDlList();
  dlPop = openPopover(el.dl, h('div.bubble', { style: { width: '380px', gap: '6px' } }, h('h3', h('span.grow', 'Downloads')), dlList,
    h('div.actions', h('button.btn.sm.ghost', { type: 'button', onClick: () => { dlPop.close(); go('lintas://downloads'); } }, 'Show all downloads'))), { align: 'right', gap: 8, onClose: () => { dlList = null; dlPop = null; } });
}

/* ---------- permission prompts (anchored under the omnibox, like Chrome) ---------- */
export function queuePermission(req) { permQueue.push(req); pumpPermissions(); }
function pumpPermissions() {
  if (permOpen) return;
  const t = activeTab(); if (!t) return;
  const i = permQueue.findIndex((r) => r.tabId == null || r.tabId === t.id); if (i < 0) return;
  const req = permQueue.splice(i, 1)[0];
  const [ic, what] = PERM[req.permission] || ['info', `use “${req.permission}”`];
  const remember = h('input.check', { type: 'checkbox', checked: true });
  let answered = false;
  const answer = (allow) => { if (answered) return; answered = true; call(L().permissions.answer(req.requestId, { allow, remember: allow === null ? false : remember.checked })); pop.close('answered'); };
  const pop = openPopover(el.sec, h('div.bubble', { role: 'alertdialog', 'aria-label': 'Permission request' },
    h('h3', h('span.grow', h('span.perm-origin', hostOf(req.origin) || req.origin), ' wants to'), h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss (asks again next time)', onClick: () => { answered = true; call(L().permissions.answer(req.requestId, { allow: false, remember: false })); pop.close('answered'); } }, icon('close'))),
    h('div.perm-ask', icon(ic), h('span', what.replace(/^./, (c) => c.toUpperCase()) + (req.detail && req.permission !== 'media' ? ` (${req.detail})` : req.detail ? ` — ${req.detail}` : ''))),
    h('div.actions', h('label.check-row', { style: { marginRight: 'auto' } }, remember, h('span', 'Remember for this site')),
      h('button.btn', { type: 'button', onClick: () => answer(false) }, 'Block'), h('button.btn.primary', { type: 'button', autofocus: true, onClick: () => answer(true) }, 'Allow'))),
  { dismissable: false, gap: 8, restoreFocus: false, onClose: () => { permOpen = null; if (!answered) call(L().permissions.answer(req.requestId, { allow: false, remember: false })); setTimeout(pumpPermissions, 150); } });
  permOpen = pop;
}

/* ---------- main menu ---------- */
function mainMenu() {
  const t = activeTab(); const m = modLabel(); const web = t?.kind === 'web';
  const zoomVal = h('span.zoom-val', Math.round((t?.zoom || 1) * 100) + '%');
  const z = async (dir) => { if (!web) return; const v = await call(L().nav.zoom(t.id, dir)); if (v) zoomVal.textContent = Math.round(v * 100) + '%'; };
  const zoomRow = h('div.menu-row', icon('search', 16), h('span.grow', { style: { marginLeft: '8px' } }, 'Zoom'),
    h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Zoom out', disabled: !web, onClick: () => z('out') }, icon('minus')), zoomVal,
    h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Zoom in', disabled: !web, onClick: () => z('in') }, icon('plus')),
    h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Reset zoom', title: 'Reset', disabled: !web, onClick: () => z('reset') }, icon('undo')));
  openMenu(el.menu, [
    { label: 'New tab', icon: 'plus', shortcut: `${m}T`, onClick: () => call(L().tabs.create({})) },
    { label: 'New private tab', icon: 'private', shortcut: `${m}Shift+N`, onClick: () => call(L().tabs.create({ private: true })) },
    { sep: true },
    { label: 'History', icon: 'history', shortcut: `${m}H`, onClick: () => go('lintas://history', { newTab: !isNewTab() }) },
    { label: 'Downloads', icon: 'download', shortcut: `${m}J`, onClick: () => go('lintas://downloads', { newTab: !isNewTab() }) },
    { label: 'Bookmarks', icon: 'star', onClick: () => go('lintas://bookmarks', { newTab: !isNewTab() }) },
    { label: 'Show bookmarks bar', checked: !!S.settings.showBookmarksBar, shortcut: `${m}Shift+B`, onClick: () => setSettings({ showBookmarksBar: !S.settings.showBookmarksBar }) },
    { sep: true },
    { label: 'Offline library', icon: 'saveOffline', onClick: () => go('lintas://offline', { newTab: !isNewTab() }) },
    { label: 'Translation — TMS', icon: 'tms', shortcut: `${m}Shift+M`, onClick: () => openTms() },
    { sep: true },
    { custom: zoomRow },
    { label: 'Find in page…', icon: 'search', shortcut: `${m}F`, onClick: () => openFind() },
    { label: 'Print…', icon: 'print', shortcut: `${m}P`, disabled: !web, onClick: () => act((x) => L().nav.print(x.id)) },
    { label: 'Clear browsing data…', icon: 'trash', onClick: () => clearDataDialog() },
    { sep: true },
    { label: 'Settings', icon: 'settings', onClick: () => go('lintas://settings', { newTab: !isNewTab() }) },
    { label: 'About Lintas', icon: 'info', onClick: () => aboutDialog() },
  ], { align: 'right', width: 280, gap: 8 });
}
const isNewTab = () => activeTab()?.url === 'lintas://newtab';
export function openTms() {
  const ex = S.tabs.find((x) => x.url.startsWith('lintas://tms'));
  if (ex) return call(L().tabs.activate(ex.id));
  return go('lintas://tms', { newTab: !isNewTab() });
}
export function openInternal(url) { const ex = S.tabs.find((x) => x.url === url); if (ex) return call(L().tabs.activate(ex.id)); return go(url, { newTab: !isNewTab() }); }

function aboutDialog() {
  const s = S.status;
  openDialog({ title: 'About Lintas', width: 440, content: [
    h('p', 'Lintas is a fast, private browser for linguists, with a translation management system built in. It works online and offline; your projects, translation memories and termbases stay on this computer.'),
    h('div.sp-note', h('div', 'Version ', h('b', s.version || '—')), h('div', 'Data folder: ', s.dataDir || '—'), h('div', 'AI: ', s.hasApiKey ? `ready (${s.model || 'default model'})` : 'no API key set')),
  ], actions: [{ label: 'Close', kind: 'primary', primary: true }] });
}

function previewMenu(anchor) {
  const acts = L().__preview?.actions || [];
  openMenu(anchor, [{ header: 'Preview mode — sample data' }, ...acts.map((a) => ({ label: a.label, icon: a.icon, onClick: () => a.run() }))], { align: 'right', width: 300, gap: 8 });
}
