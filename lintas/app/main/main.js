// Lintas Browser — Electron main process.
import { app, BrowserWindow, ipcMain, session, protocol, net, dialog, shell, nativeTheme, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../../core/store.js';
import { Tms } from '../../core/tms.js';
import { detectLanguage, tokenize } from '../../core/text.js';
import { BrowserData } from './browserdata.js';
import { TabManager } from './tabs.js';
import { hardenSession } from './security.js';
import { Ai, MODELS } from './ai.js';
import * as page from './pagetools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const RENDERER = path.join(ROOT, 'app/renderer');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const isMac = process.platform === 'darwin';

if (process.env.LINTAS_DATA_DIR) app.setPath('userData', path.resolve(process.env.LINTAS_DATA_DIR));
// Sandbox every renderer and utility process. Chromium refuses to sandbox when
// run as root, so `--no-sandbox` (containers, CI) keeps only the per-page sandbox.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
app.setName('Lintas');
protocol.registerSchemesAsPrivileged([{ scheme: 'lintas-ui', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win, tabs, data, tms, ai, store;
const pendingPermissions = new Map();
const downloads = new Map();
const httpAllowed = new Set();
let permSeq = 0, dlSeq = 0;

const PARTITIONS = { normal: 'persist:lintas', private: 'lintas-private' };

function emit(event, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('lintas:event', event, payload);
}

function toast(kind, message) { emit('toast', { kind, message }); }

// ---------- renderer protocol ----------

const CSP = "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveRenderer(request) {
  const u = new URL(request.url);
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(RENDERER, rel);
  if (!file.startsWith(RENDERER + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404, headers: { 'content-security-policy': CSP } });
  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache',
    },
  });
}

// ---------- window ----------

function createWindow() {
  const s = data.settings();
  nativeTheme.themeSource = s.theme;
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Lintas', show: false,
    backgroundColor: dark ? '#1b1c1f' : '#f3f4f7',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e6e6e9' : '#2b2d33', height: 40 } }),
    webPreferences: {
      preload: path.join(ROOT, 'app/preload/chrome.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL('lintas-ui://app/index.html');

  tabs = new TabManager({
    win, data, emit, partitions: PARTITIONS, isMac,
    onContents: (wc, t) => {
      wc.on('did-finish-load', () => autoSaveOffline(t));
    },
  });

  win.on('close', () => { tabs.persist(); store.flushAll(); });
  win.on('closed', () => { win = null; });
  nativeTheme.on('updated', () => {
    if (!isMac && win) try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e6e9' : '#2b2d33', height: 40 }); } catch {}
  });

  const restore = s.restoreSession ? data.session().filter(x => x.url) : [];
  if (restore.length) {
    let activeId = null;
    for (const r of restore) {
      const t = tabs.create({ url: r.url, active: false, lazy: true, pinned: r.pinned });
      if (r.active) activeId = t.id;
    }
    tabs.activate(activeId ?? tabs.tabs[0].id);
  } else tabs.create({});
}

// ---------- offline ----------

async function pageInfo(wc) {
  try { return await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.EXTRACT_PARAGRAPHS }]); }
  catch { return { url: wc.getURL(), title: wc.getTitle(), paragraphs: [] }; }
}

async function saveOffline(t) {
  if (t.kind !== 'web' || !t.view) throw new Error('Only web pages can be saved for offline reading.');
  const wc = t.view.webContents;
  const url = wc.getURL();
  if (!/^https?:/.test(url)) throw new Error('This page is already a local copy.');
  const entry = data.offlineReserve(url);
  await wc.savePage(data.offlinePathFor(entry), 'MHTML');
  const info = await pageInfo(wc);
  const text = info.paragraphs.map(p => p.text).join('\n');
  const saved = data.offlineCommit(entry, { title: wc.getTitle(), lang: info.lang?.split('-')[0] || detectLanguage(text).lang, words: tokenize(text).length });
  tabs.changed();
  return saved;
}

async function autoSaveOffline(t) {
  if (!data.settings().autoSaveOffline || t.private || t.offlineCopy?.showing || t.error) return;
  const url = t.view?.webContents.getURL() || '';
  if (!/^https?:/.test(url)) return;
  try { await saveOffline(t); } catch {}
}

// ---------- downloads ----------

function wireDownloads(ses) {
  ses.on('will-download', (e, item) => {
    const id = 'd' + (++dlSeq);
    const dir = app.getPath('downloads');
    const base = item.getFilename().replace(/[\\/:*?"<>|]+/g, '_') || 'download';
    let file = path.join(dir, base), n = 1;
    while (fs.existsSync(file)) { const ext = path.extname(base); file = path.join(dir, `${path.basename(base, ext)} (${n++})${ext}`); }
    item.setSavePath(file);
    const rec = { id, item, filename: path.basename(file), url: item.getURL(), savePath: file };
    downloads.set(id, rec);
    const send = () => emit('download', dlPublic(rec));
    item.on('updated', send);
    item.once('done', (ev, state) => { send(); if (state === 'completed') toast('success', `Downloaded ${rec.filename}`); });
    send();
  });
}

function dlPublic(r) {
  const st = r.item.getState();
  return { id: r.id, filename: r.filename, url: r.url, state: st, received: r.item.getReceivedBytes(), total: r.item.getTotalBytes(), savePath: r.savePath };
}

// ---------- page translation ----------

async function translatePage(t, { targetLang, projectId }) {
  if (t.kind !== 'web' || !t.view) throw new Error('Open a web page to translate it.');
  const wc = t.view.webContents;
  const collected = await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.COLLECT_TEXT_NODES }]);
  const texts = collected.texts;
  if (!texts.length) throw new Error('No text was found on this page.');
  const results = new Array(texts.length).fill(null);
  let fromTm = 0, fromAi = 0;
  let doc = null;
  if (projectId) {
    doc = tms.doc(projectId);
    texts.forEach((s, i) => {
      const m = tms.lookup(projectId, s.trim()).matches[0];
      if (m && m.score >= 100) { results[i] = m.target; fromTm++; }
    });
  }
  const sourceLang = (collected.lang || '').split('-')[0] || detectLanguage(texts.join(' ')).lang;
  const todo = results.map((r, i) => (r == null ? i : -1)).filter(i => i >= 0);
  if (todo.length) {
    ai.ensure();
    // Batches of text nodes, sized for fast, reliable replies.
    const batches = [];
    let cur = [], chars = 0;
    for (const i of todo) {
      const len = texts[i].length;
      if (cur.length && (cur.length >= 80 || chars + len > 6000)) { batches.push(cur); cur = []; chars = 0; }
      cur.push(i); chars += len;
    }
    if (cur.length) batches.push(cur);
    let done = 0;
    const run = async (batch) => {
      const terms = doc ? dedupeTerms(batch.flatMap(i => tms.termHits(doc, texts[i]))) : [];
      const out = await ai.translateBatch(batch.map(i => texts[i].trim()), { sourceLang, targetLang, terms });
      const pairs = [];
      batch.forEach((i, k) => { if (out[k]) { results[i] = out[k]; pairs.push([i, out[k]]); fromAi++; } });
      if (!wc.isDestroyed()) await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.applyTranslations(pairs, targetLang) }]);
      done += batch.length;
      emit('translate-progress', { tabId: t.id, done, total: todo.length });
    };
    // Apply TM hits first so the page changes immediately.
    if (fromTm) await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.applyTranslations(results.map((r, i) => [i, r]).filter(([, r]) => r != null), targetLang) }]);
    const queue = [...batches];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) await run(queue.shift()); });
    await Promise.all(workers);
  } else {
    await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.applyTranslations(results.map((r, i) => [i, r]), targetLang) }]);
  }
  t.translated = { targetLang };
  tabs.changed();
  return { translated: fromTm + fromAi, fromTm, fromAi };
}

function dedupeTerms(hits) {
  const seen = new Set();
  return hits.filter(h => { const k = h.source + '\u0000' + h.target; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle('lintas:' + channel, async (e, ...args) => {
    if (!win || e.sender !== win.webContents) throw new Error('Not allowed.');
    try { return await fn(...args); }
    catch (err) { throw new Error(err?.message || String(err)); }
  });
}

function pickFiles(filters) {
  return dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
}

async function saveTo(defaultName, content, filters) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), defaultName), filters });
  if (r.canceled || !r.filePath) return { savedTo: null };
  fs.writeFileSync(r.filePath, content);
  return { savedTo: r.filePath };
}

const IMPORTABLE = [{ name: 'Translatable files', extensions: ['txt', 'md', 'html', 'htm', 'docx', 'srt', 'vtt', 'po', 'pot', 'xlf', 'xliff', 'json', 'csv', 'tsv', 'tmx'] }, { name: 'All files', extensions: ['*'] }];

function registerIpc() {
  handle('view.setBounds', b => tabs.setBounds(b));
  handle('view.setVisible', v => tabs.setVisible(v));

  handle('tabs.list', () => tabs.list());
  handle('tabs.create', (o = {}) => tabs.create(o));
  handle('tabs.close', id => tabs.close(id));
  handle('tabs.activate', id => tabs.activate(id));
  handle('tabs.move', (id, to) => tabs.move(id, to));
  handle('tabs.pin', (id, on) => tabs.pin(id, on));
  handle('tabs.mute', (id, on) => tabs.mute(id, on));
  handle('tabs.duplicate', id => tabs.duplicate(id));
  handle('tabs.reopenClosed', () => tabs.reopenClosed());

  handle('nav.go', (id, input) => tabs.go(id, input));
  handle('nav.back', id => tabs.back(id));
  handle('nav.forward', id => tabs.forward(id));
  handle('nav.reload', (id, o) => tabs.reload(id, o));
  handle('nav.stop', id => tabs.stop(id));
  handle('nav.zoom', (id, how) => tabs.zoom(id, how));
  handle('nav.find', (id, text, o) => tabs.find(id, text, o));
  handle('nav.stopFind', id => tabs.stopFind(id));
  handle('nav.print', id => tabs.wcOf(id).print());
  handle('nav.devtools', id => tabs.wcOf(id).toggleDevTools());
  handle('nav.allowHttp', id => {
    const t = tabs.get(id);
    const u = t.error?.url || t.url;
    const http = u.replace(/^https:/, 'http:');
    httpAllowed.add(new URL(http).hostname);
    tabs.loadWeb(t, http);
    tabs.changed();
  });

  handle('permissions.answer', (requestId, { allow, remember }) => {
    const p = pendingPermissions.get(requestId);
    if (!p) return;
    pendingPermissions.delete(requestId);
    if (remember) data.permissionStore().set(p.origin, p.permission, !!allow);
    p.resolve(!!allow);
  });

  handle('omnibox.suggest', text => suggest(text));

  handle('bookmarks.list', () => data.bookmarks());
  handle('bookmarks.toggle', b => { const r = data.toggleBookmark(b); tabs.changed(); return r; });
  handle('bookmarks.remove', id => { data.removeBookmark(id); tabs.changed(); });
  handle('history.list', (o = {}) => data.history(o));
  handle('history.clear', (o = {}) => data.clearHistory(o));
  handle('downloads.list', () => [...downloads.values()].map(dlPublic).reverse());
  handle('downloads.open', id => { const r = downloads.get(id); if (r) shell.openPath(r.savePath); });
  handle('downloads.show', id => { const r = downloads.get(id); if (r) shell.showItemInFolder(r.savePath); });
  handle('downloads.cancel', id => downloads.get(id)?.item.cancel());

  handle('offline.save', async tabId => { const r = await saveOffline(tabs.get(tabId)); toast('success', 'Saved for offline reading'); return r; });
  handle('offline.list', (o = {}) => data.offlineList(o));
  handle('offline.open', (id, { newTab = false } = {}) => {
    const e = data.offlineGet(id);
    if (!e) throw new Error('That saved page no longer exists.');
    const file = data.offlinePathFor(e);
    if (!fs.existsSync(file)) throw new Error('The saved copy is missing from disk.');
    const t = newTab || !tabs.active() ? tabs.get(tabs.create({}).id) : tabs.active();
    tabs.showOffline(t.id, e, file);
  });
  handle('offline.remove', id => { data.offlineRemove(id); tabs.changed(); });

  handle('app.status', () => status());
  handle('settings.get', () => data.settings());
  handle('settings.set', patch => {
    const s = data.setSettings(patch);
    if ('theme' in patch) nativeTheme.themeSource = s.theme;
    emit('settings', s);
    return s;
  });
  handle('settings.setApiKey', key => ai.setKey(key));
  handle('privacy.clearData', async ({ cache, cookies, history, offline } = {}) => {
    for (const p of Object.values(PARTITIONS)) {
      const ses = session.fromPartition(p);
      if (cache) await ses.clearCache();
      if (cookies) await ses.clearStorageData();
    }
    if (history) data.clearHistory();
    if (offline) data.offlineClear();
    tabs.changed();
  });

  // TMS
  handle('tms.dashboard', () => tms.dashboard());
  handle('tms.createProject', o => tms.createProject({ sourceLang: data.settings().defaultSourceLang, targetLang: data.settings().defaultTargetLang, ...o }));
  handle('tms.updateProject', (id, p) => tms.updateProject(id, p));
  handle('tms.deleteProject', id => tms.deleteProject(id));
  handle('tms.getProject', id => tms.getProject(id));
  handle('tms.importFiles', async projectId => {
    const r = await pickFiles(IMPORTABLE);
    if (r.canceled) return [];
    const out = [], errors = [];
    for (const f of r.filePaths) {
      try { out.push(tms.importBuffer(projectId, path.basename(f), fs.readFileSync(f))); }
      catch (e) { errors.push(`${path.basename(f)}: ${e.message}`); }
    }
    if (errors.length) toast('error', errors.join(' '));
    return out;
  });
  handle('tms.importText', (projectId, o) => tms.importText(projectId, o));
  handle('tms.capturePage', async (tabId, projectId) => {
    const t = tabs.get(tabId);
    if (t.kind !== 'web' || !t.view) throw new Error('Pick a tab that shows a web page.');
    const wc = t.view.webContents;
    const info = await wc.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.PAGE_HTML }]);
    const url = t.offlineCopy?.showing ? t.offlineCopy.url : info.url;
    return tms.importWebPage(projectId, { url, title: info.title, html: info.html });
  });
  handle('tms.deleteFile', (p, f) => tms.deleteFile(p, f));
  handle('tms.getFile', (p, f, o) => tms.getFile(p, f, o));
  handle('tms.updateSegment', (p, f, s, patch) => tms.updateSegment(p, f, s, patch));
  handle('tms.lookup', (p, text) => tms.lookup(p, text));
  handle('tms.pretranslate', async (p, f, { minScore = 100, useAi = false } = {}) => {
    const r = tms.pretranslate(p, f, { minScore });
    let fromAi = 0;
    if (useAi && r.remaining.length) {
      ai.ensure();
      const { doc, file } = tms.fileDoc(p, f);
      const segs = file.segments.filter(s => r.remaining.includes(s.id));
      for (let i = 0; i < segs.length; i += 40) {
        const batch = segs.slice(i, i + 40);
        const terms = dedupeTerms(batch.flatMap(s => tms.termHits(doc, s.source)));
        const out = await ai.translateBatch(batch.map(s => s.source), { sourceLang: doc.sourceLang, targetLang: doc.targetLang, terms });
        batch.forEach((s, k) => {
          if (out[k] && !s.target) { tms.updateSegment(p, f, s.id, { target: out[k], origin: 'mt-ai', status: 'draft' }); fromAi++; }
        });
        emit('pretranslate-progress', { projectId: p, fileId: f, done: Math.min(i + 40, segs.length), total: segs.length });
      }
    }
    return { filled: r.fromTm + fromAi, fromTm: r.fromTm, fromAi };
  });
  handle('tms.analyze', p => tms.analyze(p));
  handle('tms.qa', (p, f) => tms.qa(p, f));
  handle('tms.export', (p, f, type) => {
    const out = tms.exportFile(p, f, type);
    const ext = path.extname(out.filename).slice(1);
    return saveTo(out.filename, out.data, [{ name: ext.toUpperCase(), extensions: [ext] }]);
  });
  handle('tms.listTms', () => tms.listTms());
  handle('tms.createTm', o => tms.createTm({ sourceLang: data.settings().defaultSourceLang, targetLang: data.settings().defaultTargetLang, ...o }));
  handle('tms.deleteTm', id => tms.deleteTm(id));
  handle('tms.importTmx', async id => {
    const r = await pickFiles([{ name: 'TMX', extensions: ['tmx'] }]);
    if (r.canceled) return { added: 0 };
    let added = 0;
    for (const f of r.filePaths) added += tms.importTmx(id, fs.readFileSync(f, 'utf8')).added;
    return { added };
  });
  handle('tms.exportTm', id => saveTo((tms.tmSummary(id)?.name || 'memory').replace(/[^\w -]+/g, '') + '.tmx', tms.exportTmx(id), [{ name: 'TMX', extensions: ['tmx'] }]));
  handle('tms.searchTm', (id, o) => tms.searchTm(id, o));
  handle('tms.listTermbases', () => tms.listTermbases());
  handle('tms.createTermbase', o => tms.createTermbase({ sourceLang: data.settings().defaultSourceLang, targetLang: data.settings().defaultTargetLang, ...o }));
  handle('tms.deleteTermbase', id => tms.deleteTermbase(id));
  handle('tms.listTerms', (id, o) => tms.listTerms(id, o));
  handle('tms.addTerm', (id, t) => tms.addTerm(id, t));
  handle('tms.updateTerm', (id, tid, p) => tms.updateTerm(id, tid, p));
  handle('tms.deleteTerm', (id, tid) => tms.deleteTerm(id, tid));
  handle('tms.importTermbase', async id => {
    const r = await pickFiles([{ name: 'Termbases', extensions: ['tbx', 'csv', 'tsv'] }]);
    if (r.canceled) return { added: 0 };
    let added = 0;
    for (const f of r.filePaths) added += tms.importTermbase(id, path.basename(f), fs.readFileSync(f)).added;
    return { added };
  });
  handle('tms.exportTermbase', id => saveTo((tms.tbSummary(id)?.name || 'termbase').replace(/[^\w -]+/g, '') + '.tbx', tms.exportTermbase(id), [{ name: 'TBX', extensions: ['tbx'] }]));

  // AI
  handle('ai.suggest', (p, f, s) => ai.suggest(tms.segmentContext(p, f, s)));
  handle('ai.review', (p, f, s) => ai.review(tms.segmentContext(p, f, s)));
  handle('ai.extractTerms', (p, f) => {
    const { doc, file } = tms.fileDoc(p, f);
    return ai.extractTerms(doc, file.segments.map(s => s.source).join('\n'));
  });
  handle('ai.translatePage', (tabId, o) => translatePage(tabs.get(tabId), o || {}));
  handle('ai.restorePage', async tabId => {
    const t = tabs.get(tabId);
    if (t.view) await t.view.webContents.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.RESTORE }]);
    t.translated = null;
    tabs.changed();
  });
  handle('ai.translateText', async (text, { targetLang, projectId } = {}) => {
    let terms = [];
    if (projectId) terms = tms.termHits(tms.doc(projectId), text);
    const [out] = await ai.translateBatch([text], { targetLang: targetLang || data.settings().defaultTargetLang, terms });
    return { text: out || '' };
  });
  handle('ai.ask', async (tabId, question, { history } = {}) => {
    const t = tabs.get(tabId);
    if (t.kind !== 'web' || !t.view) throw new Error('Open a web page to ask about it.');
    const info = await pageInfo(t.view.webContents);
    let total = 0;
    const paragraphs = info.paragraphs.filter(p => (total += p.text.length) < 120000);
    return ai.ask({ url: info.url, title: info.title, paragraphs, question, history });
  });
  handle('ai.highlight', async (tabId, n) => {
    const t = tabs.get(tabId);
    if (t.view) return t.view.webContents.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.highlight(n) }]);
    return false;
  });
  handle('ai.selection', async tabId => {
    const t = tabs.get(tabId);
    return t.view ? t.view.webContents.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.SELECTION }]) : '';
  });
  handle('ai.usage', () => ai.usage());
}

function status() {
  const s = data.settings();
  return { version: VERSION, online: net.isOnline(), hasApiKey: ai.hasKey(), model: s.model, models: MODELS, platform: process.platform, dataDir: app.getPath('userData') };
}

function suggest(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const add = x => { if (out.length < 8 && !out.some(o => o.url === x.url)) out.push(x); };
  const looksUrl = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) || /^https?:\/\//.test(q);
  if (looksUrl) add({ type: 'url', title: q, url: /^https?:/.test(q) ? q : 'https://' + q, detail: 'Go to site' });
  for (const t of tabs.list()) if (t.kind === 'web' && ((t.title || '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) && !t.active) add({ type: 'tab', title: t.title, url: t.url, detail: 'Switch to this tab', tabId: t.id });
  for (const b of data.bookmarks()) if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) add({ type: 'bookmark', title: b.title, url: b.url, detail: b.url });
  for (const h of data.history({ q, limit: 6 })) add({ type: 'history', title: h.title, url: h.url, detail: h.url });
  for (const o of data.offlineList({ q }).slice(0, 2)) add({ type: 'offline', title: o.title, url: o.url, detail: 'Saved for offline reading', offlineId: o.id });
  for (const p of tms.dashboard().projects) if (p.name.toLowerCase().includes(q)) add({ type: 'tms', title: p.name, url: 'lintas://tms/project/' + p.id, detail: `Translation project · ${p.sourceLang} → ${p.targetLang}` });
  if (!looksUrl) out.unshift({ type: 'search', title: text.trim(), url: text.trim(), detail: `Search with ${data.settings().searchEngine}` });
  return out.slice(0, 8);
}

// ---------- first run ----------

function seedSample() {
  if (store.exists('seeded')) return;
  store.save('seeded', { at: new Date().toISOString() });
  try {
    const p = tms.createProject({ name: 'Welcome to Lintas (sample)', sourceLang: 'en', targetLang: 'id', client: 'Sample' });
    const dir = path.join(ROOT, 'samples');
    tms.importBuffer(p.id, 'welcome.en.txt', fs.readFileSync(path.join(dir, 'welcome.en.txt')));
    tms.importBuffer(p.id, 'ui-strings.en-id.csv', fs.readFileSync(path.join(dir, 'ui-strings.en-id.csv')));
    const tb = p.termbaseIds[0];
    tms.addTerm(tb, { source: 'translation memory', target: 'memori terjemahan', status: 'preferred', note: 'Common abbreviation: TM' });
    tms.addTerm(tb, { source: 'termbase', target: 'basis istilah', status: 'preferred' });
    tms.addTerm(tb, { source: 'settings', target: 'pengaturan', status: 'preferred' });
    tms.addTerm(tb, { source: 'settings', target: 'setelan', status: 'forbidden', note: 'Use "pengaturan" in software UI' });
    tms.addTerm(tb, { source: 'offline', target: 'luring', status: 'admitted', note: '"offline" is also accepted in UI text' });
  } catch (e) { console.error('Could not create the sample project:', e.message); }
}

// ---------- startup ----------

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.on('web-contents-created', (e, wc) => {
  wc.on('will-attach-webview', ev => ev.preventDefault());
});

app.on('certificate-error', (e, wc, url, error, cert, callback) => callback(false));

app.whenReady().then(() => {
  store = new JsonStore(path.join(app.getPath('userData'), 'data'));
  data = new BrowserData(store, app.getPath('userData'));
  tms = new Tms(store);
  ai = new Ai(app.getPath('userData'), () => data.settings());
  protocol.handle('lintas-ui', serveRenderer);

  const ctx = {
    settings: () => data.settings(),
    tabForContents: wc => tabs?.byContents(wc) || null,
    onBlocked: t => { t.blocked = (t.blocked || 0) + 1; clearTimeout(t.blockedTimer); t.blockedTimer = setTimeout(() => tabs.changed(), 250); },
    askPermission: ({ tab, origin, permission, detail }) => new Promise(resolve => {
      const requestId = 'perm' + (++permSeq);
      pendingPermissions.set(requestId, { origin, permission, resolve });
      emit('permission', { requestId, tabId: tab.id, origin, permission, detail });
      setTimeout(() => { if (pendingPermissions.has(requestId)) { pendingPermissions.delete(requestId); resolve(false); } }, 120000);
    }),
    permissionStore: data.permissionStore(),
    httpAllowed,
  };
  for (const p of Object.values(PARTITIONS)) {
    const ses = session.fromPartition(p);
    hardenSession(ses, ctx);
    wireDownloads(ses);
    ses.setSpellCheckerLanguages(['en-US', 'id'].filter(l => ses.availableSpellCheckerLanguages.includes(l)));
  }
  seedSample();
  registerIpc();
  if (!isMac) Menu.setApplicationMenu(null);
  else Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow();

  let wasOnline = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now !== wasOnline) { wasOnline = now; emit('online', { online: now }); }
  }, 2000);
});

app.on('window-all-closed', () => { store?.flushAll(); app.quit(); });
app.on('before-quit', () => { tabs?.persist(); store?.flushAll(); });

