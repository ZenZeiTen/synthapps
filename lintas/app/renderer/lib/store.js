// Tiny shared state + event bus for the chrome renderer.
import { errText } from './dom.js';
export const S = {
  tabs: [], settings: {}, status: { models: [] }, online: true, bookmarks: [], downloads: [],
  preview: false,
  panel: { open: false, view: 'assistant', width: 384 },
  find: { open: false },
  /** file key -> segment id to focus when the editor opens (QA "go to segment"). */
  pendingSegment: new Map(),
  /** payload pushed by context-menu events / UI for the side panel views. */
  panelIntent: null,
  /** titles the renderer gives to internal pages (main leaves them empty). */
  titles: new Map(),
};

const subs = new Map();
export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => subs.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  for (const fn of [...(subs.get(evt) || [])]) { try { fn(data); } catch (e) { console.error(e); } }
}

export const L = () => window.lintas;
export const activeTab = () => S.tabs.find((t) => t.active) || null;
export const isDarwin = () => S.status.platform === 'darwin';
export const modLabel = () => (isDarwin() ? '⌘' : 'Ctrl+');

/** Wraps a lintas call: shows the (plain-language) rejection as a toast and returns undefined. */
export async function call(promise, { silent } = {}) {
  try { return await promise; }
  catch (e) { if (!silent) emit('toast', { kind: 'error', message: errText(e) }); return undefined; }
}

export function go(url, { newTab = false, tabId } = {}) {
  if (newTab) return call(L().tabs.create({ url, active: true }));
  const id = tabId ?? activeTab()?.id;
  if (id == null) return call(L().tabs.create({ url, active: true }));
  return call(L().nav.go(id, url));
}

export async function refreshBookmarks() { S.bookmarks = (await call(L().bookmarks.list())) || []; emit('bookmarks'); }
export async function refreshDownloads() { S.downloads = (await call(L().downloads.list())) || []; emit('downloads'); }
export async function refreshStatus() { const s = await call(L().app.status()); if (s) { S.status = s; S.online = s.online; emit('status'); } }
export async function setSettings(partial) {
  const s = await call(L().settings.set(partial));
  if (s) { S.settings = s; emit('settings'); }
  return s;
}

export function setPanel(patch) {
  Object.assign(S.panel, patch);
  try { localStorage.setItem('lintas.panel', JSON.stringify(S.panel)); } catch { /* storage unavailable */ }
  emit('panel');
}
export function loadPanelPrefs() {
  try { const p = JSON.parse(localStorage.getItem('lintas.panel') || 'null'); if (p) Object.assign(S.panel, { view: p.view || 'assistant', width: Math.min(640, Math.max(320, p.width || 384)), open: !!p.open }); } catch { /* ignore */ }
}
export function openPanel(view, intent) {
  if (intent) S.panelIntent = { view, ...intent };
  setPanel({ open: true, view });
}

export function parseInternal(url) {
  if (!url || !url.startsWith('lintas://')) return null;
  const rest = url.slice('lintas://'.length).split(/[?#]/)[0].replace(/\/+$/, '');
  const p = rest.split('/');
  if (p[0] === 'tms') {
    if (p[1] === 'project' && p[2]) return { page: 'tms-project', projectId: decodeURIComponent(p[2]) };
    if (p[1] === 'file' && p[2] && p[3]) return { page: 'tms-file', projectId: decodeURIComponent(p[2]), fileId: decodeURIComponent(p[3]) };
    return { page: 'tms' };
  }
  return { page: p[0] || 'newtab' };
}

export function setTitle(url, title) { if (S.titles.get(url) !== title) { S.titles.set(url, title); emit('titles'); } }
