// Tabs: each web tab is a sandboxed WebContentsView. Internal pages
// (lintas://…) are drawn by the browser chrome renderer instead.
import { WebContentsView, Menu, clipboard, shell } from 'electron';
import { pathToFileURL } from 'node:url';
import { resolveInput } from './security.js';
import { stripHash } from './browserdata.js';

const INTERNAL_TITLES = {
  newtab: 'New Tab', tms: 'Translation Management', offline: 'Offline library', history: 'History',
  downloads: 'Downloads', bookmarks: 'Bookmarks', settings: 'Settings', extensions: 'Extensions',
};

let nextId = 1;

export class TabManager {
  constructor({ win, data, emit, partitions, onContents, onActivate, isMac }) {
    this.win = win;
    this.data = data;
    this.emit = emit;
    this.partitions = partitions;      // { normal, private } partition names
    this.onContents = onContents;      // (webContents, tab) => void, extra per-tab wiring
    this.onActivate = onActivate || (() => {});
    this.isMac = isMac;
    this.tabs = [];
    this.activeId = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.viewVisible = true;
    this.closed = [];
    this.attached = null;
    this.saveTimer = null;
  }

  // ---------- public state ----------

  get(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) throw new Error('That tab is no longer open.');
    return t;
  }

  active() { return this.tabs.find(t => t.id === this.activeId) || null; }

  byContents(wc) { return this.tabs.find(t => t.view && t.view.webContents === wc) || null; }

  serialize(t) {
    const wc = t.view?.webContents;
    const internal = t.kind === 'internal';
    const url = internal ? t.url : (t.offlineCopy?.showing ? t.offlineCopy.url : (wc && !wc.isDestroyed() ? wc.getURL() || t.url : t.url));
    let security = 'internal';
    if (!internal) {
      if (t.error) security = 'error';
      else if (t.offlineCopy?.showing) security = 'offline-copy';
      else if (url.startsWith('https://')) security = 'secure';
      else if (url.startsWith('file://')) security = 'file';
      else if (url.startsWith('http://')) security = 'insecure';
      else security = 'internal';
    }
    const copy = !internal && url ? this.data.offlineByUrl(url) : null;
    return {
      id: t.id, kind: t.kind, url, title: t.title || (internal ? INTERNAL_TITLES[internalName(t.url)] || 'Lintas' : url),
      favicon: internal ? null : t.favicon || null, loading: !!t.loading,
      canGoBack: !internal && !!wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack(),
      canGoForward: !internal && !!wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
      active: t.id === this.activeId, pinned: !!t.pinned, private: !!t.private,
      muted: !!(wc && !wc.isDestroyed() && wc.isAudioMuted()), audible: !!t.audible,
      security, blocked: t.blocked || 0, zoom: t.zoom || 1, error: t.error || null,
      offlineCopy: copy ? { id: copy.id, savedAt: copy.savedAt } : null,
      bookmarked: url ? this.data.isBookmarked(url) : false,
      translated: t.translated || null,
    };
  }

  list() { return this.tabs.map(t => this.serialize(t)); }

  changed() {
    this.emit('tabs', this.list());
    this.layout();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 800);
  }

  persist() {
    this.data.setSession(this.tabs.filter(t => !t.private).map(t => ({ url: this.serialize(t).url, pinned: !!t.pinned, active: t.id === this.activeId })));
  }

  // ---------- lifecycle ----------

  create({ url, active = true, private: priv = false, index, lazy = false, pinned = false, raw = false } = {}) {
    const t = { id: nextId++, kind: 'internal', url: 'lintas://newtab', title: '', private: !!priv, pinned: !!pinned, blocked: 0, zoom: 1, view: null };
    // raw: a URL that came from an extension (chrome-extension://, about:blank) and is loaded as is.
    const target = url ? (raw ? String(url) : resolveInput(url, this.data.settings().searchEngine)) : 'lintas://newtab';
    if (index == null) {
      // New tabs open after the pinned ones and next to the active tab, like other browsers.
      const ai = this.tabs.findIndex(x => x.id === this.activeId);
      index = ai >= 0 && !pinned ? ai + 1 : (pinned ? this.tabs.filter(x => x.pinned).length : this.tabs.length);
    }
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, t);
    if (target.startsWith('lintas://')) t.url = target;
    else if (lazy) { t.kind = 'web'; t.url = target; t.title = target; t.lazy = true; }
    else this.loadWeb(t, target);
    if (active) this.activate(t.id); else this.changed();
    return this.serialize(t);
  }

  ensureView(t) {
    if (t.view && !t.view.webContents.isDestroyed()) return t.view;
    const view = new WebContentsView({
      webPreferences: {
        partition: t.private ? this.partitions.private : this.partitions.normal,
        sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
        navigateOnDragDrop: false, safeDialogs: true, spellcheck: true, enableWebSQL: false,
      },
    });
    view.setBackgroundColor('#ffffffff');
    t.view = view;
    this.wire(t);
    return view;
  }

  loadWeb(t, url) {
    t.kind = 'web';
    t.lazy = false;
    t.error = null;
    t.url = url;
    if (t.offlineCopy) t.offlineCopy.showing = false;
    const view = this.ensureView(t);
    view.webContents.loadURL(url).catch(() => {}); // failures arrive through did-fail-load
  }

  activate(id) {
    const t = this.get(id);
    this.activeId = id;
    if (t.lazy) this.loadWeb(t, t.url);
    this.changed();
    if (t.view && !t.error && t.kind === 'web') { t.view.webContents.focus(); this.onActivate(t.view.webContents, t); }
  }

  close(id) {
    const i = this.tabs.findIndex(x => x.id === id);
    if (i < 0) return;
    const t = this.tabs[i];
    if (!t.private) {
      this.closed.push({ url: this.serialize(t).url, index: i, pinned: t.pinned });
      if (this.closed.length > 25) this.closed.shift();
    }
    this.tabs.splice(i, 1);
    if (t.view && this.attached === t.view) { this.win.contentView.removeChildView(t.view); this.attached = null; }
    if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.close();
    if (this.activeId === id) {
      const next = this.tabs[i] || this.tabs[i - 1];
      if (next) this.activeId = next.id;
      else { this.activeId = null; this.create({}); return; }
      const n = this.active();
      if (n?.lazy) this.loadWeb(n, n.url);
    }
    this.changed();
  }

  reopenClosed() {
    const c = this.closed.pop();
    if (!c) return null;
    return this.create({ url: c.url, index: c.index, pinned: c.pinned });
  }

  move(id, to) {
    const i = this.tabs.findIndex(x => x.id === id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    this.tabs.splice(Math.max(0, Math.min(to, this.tabs.length)), 0, t);
    this.changed();
  }

  pin(id, on) {
    const t = this.get(id);
    t.pinned = !!on;
    const i = this.tabs.indexOf(t);
    this.tabs.splice(i, 1);
    const pinnedCount = this.tabs.filter(x => x.pinned).length;
    this.tabs.splice(pinnedCount, 0, t); // pinned tabs end the pinned group; unpinned ones start the rest
    this.changed();
  }

  mute(id, on) {
    const t = this.get(id);
    t.view?.webContents.setAudioMuted(!!on);
    this.changed();
  }

  duplicate(id) {
    const t = this.get(id);
    return this.create({ url: this.serialize(t).url, index: this.tabs.indexOf(t) + 1, private: t.private });
  }

  // ---------- navigation ----------

  go(id, input) {
    const t = this.get(id);
    const url = resolveInput(input, this.data.settings().searchEngine);
    if (!url) return;
    if (url.startsWith('lintas://')) {
      t.kind = 'internal'; t.url = url; t.title = ''; t.error = null; t.translated = null;
      this.changed();
      return;
    }
    this.loadWeb(t, url);
    this.changed();
  }

  wcOf(id) {
    const t = this.get(id);
    if (t.kind !== 'web' || !t.view) throw new Error('This tab does not show a web page.');
    return t.view.webContents;
  }

  back(id) { const wc = this.wcOf(id); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  forward(id) { const wc = this.wcOf(id); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
  reload(id, { hard = false } = {}) {
    const t = this.get(id);
    if (t.kind !== 'web') return;
    if (t.error && t.view) { const u = t.error.url || t.url; t.error = null; this.loadWeb(t, u); this.changed(); return; }
    const wc = this.wcOf(id);
    hard ? wc.reloadIgnoringCache() : wc.reload();
  }
  stop(id) { this.wcOf(id).stop(); }

  zoom(id, how) {
    const t = this.get(id);
    const wc = this.wcOf(id);
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const cur = wc.getZoomFactor();
    let z = 1;
    if (how === 'in') z = steps.find(s => s > cur + 0.001) || 5;
    else if (how === 'out') z = [...steps].reverse().find(s => s < cur - 0.001) || 0.25;
    wc.setZoomFactor(z);
    t.zoom = z;
    this.changed();
    return z;
  }

  find(id, text, { forward = true, findNext = false } = {}) {
    const wc = this.wcOf(id);
    if (!text) { wc.stopFindInPage('clearSelection'); return { matches: 0, active: 0 }; }
    wc.findInPage(text, { forward, findNext });
    return { matches: null, active: null };
  }
  stopFind(id) { try { this.wcOf(id).stopFindInPage('clearSelection'); } catch {} }

  /** Show a saved MHTML copy in this tab. */
  showOffline(id, entry, filePath) {
    const t = this.get(id);
    t.offlineCopy = { id: entry.id, url: entry.url, showing: true };
    t.kind = 'web';
    t.error = null;
    t.lazy = false;
    const view = this.ensureView(t);
    t.title = entry.title;
    view.webContents.loadURL(pathToFileURL(filePath).toString()).catch(() => {});
    this.changed();
  }

  // ---------- layout ----------

  setBounds(b) {
    this.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
    this.layout();
  }

  setVisible(v) { this.viewVisible = !!v; this.layout(); }

  layout() {
    const t = this.active();
    const want = t && t.kind === 'web' && !t.error && this.viewVisible && t.view && !t.view.webContents.isDestroyed() ? t.view : null;
    if (this.attached && this.attached !== want) {
      try { this.win.contentView.removeChildView(this.attached); } catch {}
      this.attached = null;
    }
    if (want) {
      if (this.attached !== want) { this.win.contentView.addChildView(want); this.attached = want; }
      want.setBounds(this.bounds);
    }
  }

  // ---------- per-tab wiring ----------

  wire(t) {
    const wc = t.view.webContents;
    const update = () => this.changed();
    wc.on('did-start-loading', () => { t.loading = true; update(); });
    wc.on('did-stop-loading', () => { t.loading = false; update(); });
    wc.on('did-start-navigation', (e) => {
      if (!e.isMainFrame || e.isSameDocument) return;
      t.error = null;
      t.blocked = 0;
      t.translated = null;
      if (t.offlineCopy && !e.url.startsWith('file:')) t.offlineCopy.showing = false;
    });
    wc.on('page-title-updated', (e, title) => {
      t.title = title;
      if (!t.private && !t.offlineCopy?.showing) this.data.setHistoryTitle(wc.getURL(), title);
      update();
    });
    wc.on('page-favicon-updated', (e, icons) => { t.favicon = icons.find(u => /^https?:|^data:image\//.test(u)) || null; update(); });
    wc.on('did-navigate', (e, url) => {
      t.url = url;
      if (!url.startsWith('file:')) t.favicon = t.favicon && sameOrigin(t.favicon, url) ? t.favicon : null;
      if (!t.private && /^https?:/.test(url)) this.data.addHistory(url, wc.getTitle());
      update();
    });
    wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) { t.url = url; update(); } });
    wc.on('did-fail-load', (e, code, description, url, isMain) => {
      if (!isMain || code === -3) return; // -3: aborted (e.g. user navigated away)
      t.error = { code, description: describeError(code, description), url };
      t.loading = false;
      update();
    });
    wc.on('render-process-gone', (e, d) => {
      t.error = { code: -1000, description: d.reason === 'oom' ? 'This page ran out of memory.' : 'This page stopped working.', url: t.url };
      update();
    });
    wc.on('audio-state-changed', (e) => { t.audible = !!e.audible; update(); });
    wc.on('found-in-page', (e, r) => this.emit('find', { tabId: t.id, matches: r.matches, active: r.activeMatchOrdinal }));
    wc.on('zoom-changed', (e, dir) => this.zoom(t.id, dir === 'in' ? 'in' : 'out'));
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (/^(https?|chrome-extension):/.test(url)) this.create({ url, raw: true, active: disposition !== 'background-tab', private: t.private, index: this.tabs.indexOf(t) + 1 });
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e) => {
      const u = e.url;
      if (!/^(https?|file|data|blob|about|chrome-extension):/i.test(u)) {
        e.preventDefault();
        if (/^(mailto|tel|sms):/i.test(u)) shell.openExternal(u).catch(() => {});
      }
    });
    wc.on('before-input-event', (e, input) => this.handleKey(e, input, t));
    wc.on('context-menu', (e, p) => this.contextMenu(t, p));
    this.onContents(wc, t);
  }

  handleKey(e, input, t) {
    if (input.type !== 'keyDown') return;
    const mod = this.isMac ? input.meta : input.control;
    const k = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    const send = name => { e.preventDefault(); this.emit('shortcut', { name }); };
    if (input.key === 'F5' || (mod && k === 'r')) { e.preventDefault(); return this.reload(t.id, { hard: input.shift }); }
    if (input.key === 'F12' || (mod && input.shift && k === 'i')) { e.preventDefault(); return t.view.webContents.toggleDevTools(); }
    if (input.alt && !mod && input.key === 'ArrowLeft') { e.preventDefault(); return this.back(t.id); }
    if (input.alt && !mod && input.key === 'ArrowRight') { e.preventDefault(); return this.forward(t.id); }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); return this.zoom(t.id, 'in'); }
    if (mod && k === '-') { e.preventDefault(); return this.zoom(t.id, 'out'); }
    if (mod && k === '0') { e.preventDefault(); return this.zoom(t.id, 'reset'); }
    if (input.key === 'Escape' && t.loading) return this.stop(t.id);
    if (input.control && input.key === 'Tab') return send(input.shift ? 'prev-tab' : 'next-tab');
    if (!mod) return;
    if (input.shift) {
      const map = { t: 'reopen-tab', n: 'new-private-tab', e: 'toggle-panel', m: 'open-tms', b: 'toggle-bookmarks-bar' };
      if (map[k]) return send(map[k]);
      return;
    }
    const map = { l: 'focus-omnibox', f: 'find', t: 'new-tab', w: 'close-tab', d: 'bookmark', j: 'downloads', h: 'history', p: 'print', s: 'save-offline' };
    if (map[k]) return send(map[k]);
    if (input.key === 'PageDown') return send('next-tab');
    if (input.key === 'PageUp') return send('prev-tab');
    if (/^[1-9]$/.test(k)) return send('tab-' + k);
  }

  contextMenu(t, p) {
    const wc = t.view.webContents;
    const items = [];
    const sel = (p.selectionText || '').trim();
    const ui = action => () => this.emit('context', { action, tabId: t.id, selection: sel, pageURL: p.pageURL });
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push(
        { label: 'Open link in new tab', click: () => this.create({ url: p.linkURL, active: false, private: t.private, index: this.tabs.indexOf(t) + 1 }) },
        { label: 'Open link in private tab', click: () => this.create({ url: p.linkURL, private: true }) },
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push(
        { label: 'Open image in new tab', click: () => this.create({ url: p.srcURL, active: false, index: this.tabs.indexOf(t) + 1 }) },
        { label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { type: 'separator' });
    }
    if (p.isEditable) {
      for (const s of (p.dictionarySuggestions || []).slice(0, 4)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }, { type: 'separator' });
    } else if (sel) {
      items.push({ role: 'copy' }, { type: 'separator' });
    }
    if (sel) {
      items.push(
        { label: 'Look up in TM and termbase', click: ui('lookup') },
        { label: 'Add to termbase…', click: ui('add-term') },
        { label: 'Translate selection', click: ui('translate') },
        { label: 'Ask Claude about this', click: ui('ask') },
        { label: `Search the web for “${sel.length > 24 ? sel.slice(0, 24) + '…' : sel}”`, click: () => this.create({ url: sel, index: this.tabs.indexOf(t) + 1 }) },
        { type: 'separator' });
    }
    if (!p.linkURL && !sel && !p.isEditable && p.mediaType === 'none') {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => this.back(t.id) },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => this.forward(t.id) },
        { label: 'Reload', click: () => this.reload(t.id) },
        { type: 'separator' },
        { label: 'Save page for offline reading', click: () => this.emit('shortcut', { name: 'save-offline' }) },
        { label: 'Translate page…', click: ui('translate-page') },
        { label: 'Print…', click: () => wc.print() },
        { type: 'separator' });
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  destroyAll() {
    for (const t of this.tabs) if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.close();
  }
}

export function internalName(url) {
  return String(url || '').replace(/^lintas:\/\//, '').split(/[/?#]/)[0] || 'newtab';
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

const ERRORS = {
  '-105': 'The site address could not be found (DNS lookup failed).',
  '-106': 'You are not connected to the internet.',
  '-109': 'The address is unreachable.',
  '-100': 'The connection was closed unexpectedly.',
  '-101': 'The connection was reset.',
  '-102': 'The site refused the connection.',
  '-118': 'The connection timed out.',
  '-137': 'The site address could not be resolved.',
  '-200': 'The site\'s security certificate is not trusted (it does not match the address).',
  '-201': 'The site\'s security certificate has expired or is not yet valid.',
  '-202': 'The site\'s security certificate is not issued by a trusted authority.',
  '-207': 'The site\'s security certificate is invalid.',
  '-107': 'A secure connection could not be established (SSL protocol error).',
  '-113': 'The site uses an outdated or insecure security protocol.',
  '-501': 'The page could not be loaded over HTTPS.',
  '-20': 'This page was blocked.',
  '-21': 'The network changed while loading.',
  '-324': 'The site sent an empty response.',
};

function describeError(code, fallback) {
  return ERRORS[String(code)] || (fallback ? fallback.replace(/^ERR_/, '').replace(/_/g, ' ').toLowerCase() : 'The page could not be loaded.');
}
