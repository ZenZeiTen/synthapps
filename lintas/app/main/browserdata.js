// Settings, bookmarks, history, session, site permissions and the offline
// library. Everything is stored locally in the user data folder.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  searchEngine: 'duckduckgo', homepage: 'lintas://newtab',
  httpsOnly: false, blockTrackers: true, blockThirdPartyCookies: true, sendDoNotTrack: true,
  autoSaveOffline: false, showBookmarksBar: true, theme: 'system',
  model: 'claude-opus-5-5', effort: 'medium', restoreSession: true,
  uiLanguage: 'en', defaultSourceLang: 'en', defaultTargetLang: 'id',
};

const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function stripHash(u) {
  try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return u; }
}

export class BrowserData {
  constructor(store, dataDir) {
    this.store = store;
    this.offlineDir = path.join(dataDir, 'offline');
    fs.mkdirSync(this.offlineDir, { recursive: true, mode: 0o700 });
    this.data = store.load('browser', () => ({ settings: { ...DEFAULT_SETTINGS }, bookmarks: [], history: [], session: [], permissions: {}, offline: [] }));
    this.data.settings = { ...DEFAULT_SETTINGS, ...this.data.settings };
    for (const k of ['bookmarks', 'history', 'session', 'offline']) this.data[k] ||= [];
    this.data.permissions ||= {};
  }

  save() { this.store.save('browser', this.data); }

  // settings
  settings() { return this.data.settings; }
  setSettings(patch) {
    for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULT_SETTINGS && typeof v === typeof DEFAULT_SETTINGS[k]) this.data.settings[k] = v;
    this.save();
    return this.data.settings;
  }

  // bookmarks
  bookmarks() { return this.data.bookmarks; }
  isBookmarked(url) { return this.data.bookmarks.some(b => b.url === url); }
  toggleBookmark({ url, title }) {
    const i = this.data.bookmarks.findIndex(b => b.url === url);
    if (i >= 0) { this.data.bookmarks.splice(i, 1); this.save(); return { bookmarked: false }; }
    this.data.bookmarks.push({ id: uid('b'), url, title: title || url, folder: null, createdAt: new Date().toISOString() });
    this.save();
    return { bookmarked: true };
  }
  removeBookmark(id) { this.data.bookmarks = this.data.bookmarks.filter(b => b.id !== id); this.save(); }

  // history
  addHistory(url, title) {
    if (!/^https?:/.test(url)) return;
    const h = this.data.history;
    const existing = h.find(x => x.url === url);
    const now = new Date().toISOString();
    if (existing) { existing.visits++; existing.visitedAt = now; if (title) existing.title = title; }
    else h.push({ url, title: title || url, visitedAt: now, visits: 1 });
    if (h.length > 6000) { h.sort((a, b) => a.visitedAt.localeCompare(b.visitedAt)); h.splice(0, h.length - 5000); }
    this.save();
  }
  setHistoryTitle(url, title) {
    const e = this.data.history.find(x => x.url === url);
    if (e && title) { e.title = title; this.save(); }
  }
  history({ q, limit = 200 } = {}) {
    let list = [...this.data.history].sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
    if (q) { const s = q.toLowerCase(); list = list.filter(x => x.url.toLowerCase().includes(s) || (x.title || '').toLowerCase().includes(s)); }
    return list.slice(0, limit);
  }
  clearHistory({ since } = {}) {
    this.data.history = since ? this.data.history.filter(x => x.visitedAt < since) : [];
    this.save();
  }

  // session restore
  setSession(tabs) { this.data.session = tabs; this.save(); }
  session() { return this.data.session; }

  // site permissions: { origin: { permission: bool } }
  permissionStore() {
    return {
      get: (origin, perm) => this.data.permissions[origin]?.[perm],
      set: (origin, perm, allow) => { (this.data.permissions[origin] ||= {})[perm] = allow; this.save(); },
    };
  }

  // offline library
  offlineList({ q } = {}) {
    let list = [...this.data.offline].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    if (q) { const s = q.toLowerCase(); list = list.filter(x => x.url.toLowerCase().includes(s) || (x.title || '').toLowerCase().includes(s)); }
    return list.map(publicOffline);
  }
  offlineByUrl(url) {
    const u = stripHash(url);
    return this.data.offline.find(x => x.url === u) || null;
  }
  offlineGet(id) { return this.data.offline.find(x => x.id === id) || null; }
  offlinePathFor(entry) { return path.join(this.offlineDir, entry.file); }
  /** Reserve (or reuse) an entry for a URL and return the path to write the MHTML to. */
  offlineReserve(url) {
    const u = stripHash(url);
    let e = this.offlineByUrl(u);
    if (!e) { e = { id: uid('o'), url: u, file: '', title: u, savedAt: '', bytes: 0, lang: null, words: 0 }; e.file = e.id + '.mhtml'; this.data.offline.push(e); }
    return e;
  }
  offlineCommit(entry, { title, lang, words }) {
    entry.title = title || entry.url;
    entry.lang = lang || null;
    entry.words = words || 0;
    entry.savedAt = new Date().toISOString();
    try { entry.bytes = fs.statSync(this.offlinePathFor(entry)).size; } catch { entry.bytes = 0; }
    this.save();
    return publicOffline(entry);
  }
  offlineRemove(id) {
    const e = this.offlineGet(id);
    if (!e) return;
    try { fs.unlinkSync(this.offlinePathFor(e)); } catch {}
    this.data.offline = this.data.offline.filter(x => x.id !== id);
    this.save();
  }
  offlineClear() {
    for (const e of this.data.offline) { try { fs.unlinkSync(this.offlinePathFor(e)); } catch {} }
    this.data.offline = [];
    this.save();
  }
}

function publicOffline(e) {
  const { file, ...rest } = e;
  return rest;
}
