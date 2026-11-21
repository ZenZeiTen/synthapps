// Lintas Browser — Electron main process.
import { app, BrowserWindow, ipcMain, session, protocol, net, dialog, shell, nativeTheme, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../../core/store.js';
import { Tms } from '../../core/tms.js';
import { detectLanguage, tokenize } from '../../core/text.js';
import { BrowserData } from './browserdata.js';
import { TabManager } from './tabs.js';
import { WebPanels, WEB_APPS } from './webpanel.js';
import { hardenSession, urlsFromArgs } from './security.js';
import { execFile } from 'node:child_process';
import { detectBrowsers, readProfile, parseBookmarksHtml } from './importer.js';
import { Ai, MODELS } from './ai.js';
import { Oracle } from './oracle.js';
import * as page from './pagetools.js';
import { Extensions } from './extensions.js';
import { Bridge, claudeConfigPath, claudeEntry, readClaudeConfig, writeClaudeConfig } from './bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const RENDERER = path.join(ROOT, 'app/renderer');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const isMac = process.platform === 'darwin';
const APP_ID = 'com.zenzeiten.lintas';
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (process.env.LINTAS_DATA_DIR) app.setPath('userData', path.resolve(process.env.LINTAS_DATA_DIR));
// Sandbox every renderer and utility process. Chromium refuses to sandbox when
// run as root, so `--no-sandbox` (containers, CI) keeps only the per-page sandbox.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
// Electron skips service-worker preloads without the sandbox (electron/electron#54322), so
// extension background workers then lack the chrome.* APIs Lintas adds.
else console.warn('Lintas: --no-sandbox is set. Chrome extension background workers will miss windows, contextMenus, identity, pageCapture and userScripts.');
app.setName('Lintas');
protocol.registerSchemesAsPrivileged([{ scheme: 'lintas-ui', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let win, tabs, webPanels, data, tms, ai, store, extensions, bridge, oracle;
const pendingPermissions = new Map();
const downloads = new Map();
const httpAllowed = new Set();
let permSeq = 0, dlSeq = 0;

// Private tabs normally use a session kept in memory only. Electron cannot run extensions in such a
// session, so while an extension is allowed in private tabs, new private tabs use privateExt instead:
// a session on disk that Lintas erases when it starts and when it quits.
const PARTITIONS = { normal: 'persist:lintas', private: 'lintas-private', privateExt: 'persist:lintas-private-ext' };
const TAB_PARTITIONS = {
  normal: PARTITIONS.normal,
  get private() { return extensions?.private?.ses.extensions.getAllExtensions().length ? PARTITIONS.privateExt : PARTITIONS.private; },
};
/** Extensions for a tab: the normal instance, or the one for private tabs (only in the session it runs in). */
const extFor = (t) => (!t ? extensions : t.private ? (t.partition === PARTITIONS.privateExt ? extensions?.private : null) : extensions) || null;

function emit(event, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('lintas:event', event, payload);
}

function toast(kind, message) { emit('toast', { kind, message }); }

// ---------- renderer protocol ----------

const CSP = "default-src 'self'; img-src 'self' data: https: http: crx:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveRenderer(request) {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-security-policy': CSP } });
  let rel;
  try { rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'; } catch { return notFound(); }
  if (rel.includes('\0')) return notFound();
  const file = path.resolve(RENDERER, rel);
  if (!file.startsWith(RENDERER + path.sep)) return notFound();
  let body;
  try { body = fs.readFileSync(file); } catch { return notFound(); } // missing file or a directory
  return new Response(body, {
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
    ...(process.platform === 'linux' ? { icon: path.join(ROOT, 'app/assets/icon.png') } : {}),
    backgroundColor: dark ? '#1b1c1f' : '#f3f4f7',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#e6e6e9' : '#2b2d33', height: 40 } }),
    webPreferences: {
      preload: path.join(ROOT, 'app/preload/chrome.bundle.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // With "minimize to the notification area" on, a minimized window leaves the taskbar
  win.on('minimize', () => { if (data.settings().minimizeToTray && tray) win.hide(); });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Extension shortcuts (manifest "commands") also work while the address bar or a panel has focus
  win.webContents.on('before-input-event', (e, input) => { if (extFor(tabs?.active())?.commandKey(input)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL('lintas-ui://app/index.html');

  tabs = new TabManager({
    win, data, emit, partitions: TAB_PARTITIONS, isMac,
    onContents: (wc, t) => {
      wc.on('did-finish-load', () => autoSaveOffline(t));
      extFor(t)?.addTab(wc);
    },
    onActivate: (wc, t) => { extFor(t)?.selectTab(wc); },
    extras: (t) => extFor(t)?.tabExtras(t) || {},
    commandKey: (input) => !!extFor(tabs?.active())?.commandKey(input),
  });

  webPanels = new WebPanels({ win, ses: session.fromPartition(PARTITIONS.normal), tabs,
    resolve: (key) => extensions?.panelTarget(key) || extensions?.private?.panelTarget(key) || null,
    onGone: (key) => { extensions?.forgetPanel(key); extensions?.private?.forgetPanel(key); },
    onCreated: (key, wc) => { extensions?.panelCreated(key, wc); extensions?.private?.panelCreated(key, wc); },
    commandKey: (input) => !!extFor(tabs?.active())?.commandKey(input) });
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
  handle('view.setVisible', v => { tabs.setVisible(v); webPanels?.setVisible(v); });
  handle('webpanel.apps', () => WEB_APPS.map(({ id, name, icon }) => ({ id, name, icon })));
  handle('webpanel.show', (id, bounds) => webPanels.show(typeof id === 'string' ? id : null, bounds && typeof bounds === 'object' ? bounds : null));
  handle('webpanel.reload', id => webPanels.reload(String(id)));
  handle('webpanel.home', id => webPanels.home(String(id)));
  handle('webpanel.openInTab', id => webPanels.openInTab(String(id)));
  handle('extpanel.close', key => { if (typeof key === 'string' && key.startsWith('ext:')) for (const x of [extensions, extensions?.private]) if (x?.ownsKey(key)) x.closePanel(key); });

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
  handle('app.defaultBrowser', () => defaultBrowser());
  handle('importer.detect', () => detectBrowsers(importOpts()));
  handle('importer.run', ({ browserId, profileId, bookmarks = true, history = true, settings = true } = {}) => {
    const b = detectBrowsers(importOpts()).find(x => x.id === browserId);
    const p = b?.profiles.find(x => x.id === profileId) || b?.profiles[0];
    if (!b || !p) throw new Error('That browser profile was not found on this computer.');
    const r = readProfile(b, p);
    return applyImport(r, { bookmarks, history, settings }, `${b.name} (${p.name})`);
  });
  handle('importer.fromFile', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Import bookmarks from an HTML file', properties: ['openFile'], filters: [{ name: 'Bookmarks file', extensions: ['html', 'htm'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const html = fs.readFileSync(res.filePaths[0], 'utf8');
    return applyImport({ bookmarks: parseBookmarksHtml(html), history: [], settings: {} }, { bookmarks: true }, path.basename(res.filePaths[0]));
  });
  handle('app.makeDefault', () => makeDefaultBrowser());
  handle('settings.get', () => data.settings());
  handle('settings.set', async patch => {
    const s = data.setSettings(patch);
    if ('theme' in patch) nativeTheme.themeSource = s.theme;
    if ('claudeDesktop' in patch) await syncBridge();
    if ('minimizeToTray' in patch) syncTray();
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

  // Chrome extensions
  handle('extensions.list', () => extensions.list());
  handle('extensions.installFromStore', input => extensions.installFromStore(input));
  handle('extensions.loadUnpacked', () => extensions.loadUnpacked());
  handle('extensions.remove', id => extensions.remove(id));
  handle('extensions.setSettings', (id, patch) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') throw new Error('Bad request.');
    const { sites, ...rest } = patch;
    return extensions.setSettings(id, Array.isArray(sites) ? { ...rest, sites: sites.map(String).slice(0, 200) } : rest);
  });
  handle('extensions.openOptions', id => {
    const e = extensions.list().find(x => x.id === id);
    if (!e?.optionsUrl) throw new Error('This extension has no options page.');
    tabs.create({ url: e.optionsUrl, raw: true });
  });

  // Claude Desktop (MCP)
  handle('claude.status', () => claudeStatus());
  handle('claude.connect', async () => {
    const file = writeClaudeConfig(claudeEntry({ execPath: process.execPath, appPath: app.getAppPath(), dataDir: app.getPath('userData') }));
    if (!data.settings().claudeDesktop) { data.setSettings({ claudeDesktop: true }); emit('settings', data.settings()); }
    await syncBridge();
    return { ...claudeStatus(), configPath: file };
  });

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

  handle('oracle.ask', (tabId, text, o) => {
    if (!Number.isInteger(tabId)) throw new Error('Open a web page to ask about it.');
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('Type a question (up to 20,000 characters).');
    const history = Array.isArray(o?.history) ? o.history.slice(-20).map(h => ({ role: h?.role, content: typeof h?.content === 'string' ? h.content : '' })) : [];
    return oracle.ask(tabId, text, { history });
  });
  handle('oracle.approve', (runId, callId, allow) => {
    if (typeof runId !== 'string' || typeof callId !== 'string') throw new Error('Not allowed.');
    return oracle.approve(runId, callId, allow === true);
  });
  handle('oracle.stop', runId => { if (typeof runId !== 'string') throw new Error('Not allowed.'); return oracle.stop(runId); });
  handle('oracle.memory', () => oracle.memory());
  handle('oracle.forget', id => { if (typeof id !== 'string' || !id || id.length > 64) throw new Error('Not allowed.'); return oracle.forget(id); });
}

/** The attached tab's page for the Oracle; never a private tab. */
async function oracleReadPage(tabId) {
  const t = tabs.get(Number(tabId));
  if (t.private) throw new Error('Oracle cannot see private tabs.');
  if (t.kind !== 'web' || !t.view) throw new Error('This tab does not show a web page. Open a web page to ask about it.');
  const info = await pageInfo(t.view.webContents);
  return { url: info.url, title: info.title, paragraphs: info.paragraphs };
}

async function syncBridge() {
  try {
    if (data.settings().claudeDesktop) await bridge.start(); else bridge.stop();
  } catch (e) { toast('error', 'Claude Desktop access could not start: ' + e.message); }
}

function claudeStatus() {
  let configured = false, configError = null;
  try { configured = !!readClaudeConfig()?.mcpServers?.lintas; } catch (e) { configError = e.message; }
  return { enabled: !!data.settings().claudeDesktop, running: bridge.running, configured, configPath: claudeConfigPath(), configError,
    entry: claudeEntry({ execPath: process.execPath, appPath: app.getAppPath(), dataDir: app.getPath('userData') }) };
}

function activeOr(tabId) {
  const t = tabId != null ? tabs.get(Number(tabId)) : tabs.active();
  if (!t) throw new Error('No tab is open.');
  return t;
}

/** Tools called by Claude Desktop through the MCP bridge. */
async function mcpTool(name, a) {
  switch (name) {
    case 'lintas_status': { const st = status(); return { version: st.version, online: st.online, hasApiKey: st.hasApiKey, tabs: tabs.tabs.length }; }
    case 'browser_list_tabs': return { tabs: tabs.list().map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active, private: t.private, security: t.security })) };
    case 'browser_open': {
      if (a.tabId != null) { tabs.go(Number(a.tabId), a.url); return { tabId: Number(a.tabId) }; }
      return { tabId: tabs.create({ url: a.url }).id };
    }
    case 'browser_read_page': {
      const t = activeOr(a.tabId);
      if (t.private) throw new Error('Private tabs are not shared with Claude Desktop.');
      if (t.kind !== 'web' || !t.view) throw new Error('That tab does not show a web page.');
      const info = await pageInfo(t.view.webContents);
      const max = Math.min(Math.max(Number(a.maxChars) || 60000, 1000), 200000);
      let used = 0;
      const paragraphs = info.paragraphs.filter(p => (used += p.text.length) <= max);
      return { tabId: t.id, url: info.url, title: info.title, lang: info.lang, paragraphs, truncated: paragraphs.length < info.paragraphs.length };
    }
    case 'browser_get_selection': {
      const t = activeOr(a.tabId);
      if (t.private) throw new Error('Private tabs are not shared with Claude Desktop.');
      return { text: t.view ? await t.view.webContents.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.SELECTION }]) : '' };
    }
    case 'browser_save_offline': return saveOffline(activeOr(a.tabId));
    case 'offline_list': return { pages: data.offlineList({ q: a.q }) };
    case 'tms_list_projects': return { projects: tms.dashboard().projects };
    case 'tms_create_project': return tms.createProject({ name: a.name, sourceLang: a.sourceLang, targetLang: a.targetLang });
    case 'tms_get_project': return tms.getProject(a.projectId);
    case 'tms_get_segments': return tms.getFile(a.projectId, a.fileId, { offset: Number(a.offset) || 0, limit: Math.min(Number(a.limit) || 100, 500), status: a.status, q: a.q });
    case 'tms_update_segment': {
      const patch = {};
      for (const k of ['target', 'status', 'comment']) if (a[k] !== undefined) patch[k] = a[k];
      const r = tms.updateSegment(a.projectId, a.fileId, a.segmentId, patch);
      emit('tms-changed', { projectId: a.projectId, fileId: a.fileId });
      return r;
    }
    case 'tms_lookup': return tms.lookup(a.projectId, a.text);
    case 'tms_search_terms': return { terms: tms.listTerms(a.termbaseId, { q: a.q }) };
    case 'tms_add_term': return tms.addTerm(a.termbaseId, { source: a.source, target: a.target || '', status: a.status, note: a.note });
    case 'tms_qa': return tms.qa(a.projectId, a.fileId);
    case 'tms_import_text': return tms.importText(a.projectId, { name: a.name, text: a.text });
    case 'tms_capture_page': {
      const t = activeOr(a.tabId);
      if (t.private) throw new Error('Private tabs are not shared with Claude Desktop.');
      if (t.kind !== 'web' || !t.view) throw new Error('That tab does not show a web page.');
      const info = await t.view.webContents.executeJavaScriptInIsolatedWorld(page.WORLD_ID, [{ code: page.PAGE_HTML }]);
      return tms.importWebPage(a.projectId, { url: info.url, title: info.title, html: info.html });
    }
    default: throw new Error('Unknown tool.');
  }
}

function status() {
  const s = data.settings();
  return { version: VERSION, online: net.isOnline(), hasApiKey: ai.hasKey(), model: s.model, models: MODELS, platform: process.platform, dataDir: app.getPath('userData'), sandbox: !app.commandLine.hasSwitch('no-sandbox') };
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

// ---------- import from other browsers ----------

// LINTAS_IMPORT_HOME lets the end-to-end test point the importer at a fake home folder.
const importOpts = () => process.env.LINTAS_IMPORT_HOME ? { home: process.env.LINTAS_IMPORT_HOME, env: {} } : {};
function applyImport(r, what, source) {
  const out = { source, bookmarks: 0, history: 0, settings: [] };
  if (what.bookmarks) out.bookmarks = data.importBookmarks(r.bookmarks);
  if (what.history) out.history = data.importHistory(r.history);
  if (what.settings && r.settings && Object.keys(r.settings).length) {
    const before = data.settings();
    const s = data.setSettings(r.settings);
    out.settings = Object.keys(r.settings).filter(k => s[k] !== before[k] || s[k] === r.settings[k]);
    emit('settings', s);
  }
  return out;
}

// ---------- minimize to the notification area (tray) ----------

let tray = null;
function showWindow() {
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
function syncTray() {
  const want = !!data?.settings().minimizeToTray;
  if (!want) { tray?.destroy(); tray = null; if (win && !win.isVisible()) showWindow(); return; }
  if (tray) return;
  const base = nativeImage.createFromPath(path.join(ROOT, 'app/assets/icon.png'));
  const size = process.platform === 'linux' ? 24 : 16;
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, width: size, height: size, buffer: base.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  img.addRepresentation({ scaleFactor: 2, width: size * 2, height: size * 2, buffer: base.resize({ width: size * 2, height: size * 2, quality: 'best' }).toPNG() });
  tray = new Tray(img);
  tray.setToolTip('Lintas');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Lintas', click: showWindow },
    { label: 'New tab', click: () => { showWindow(); tabs?.create({}); } },
    { type: 'separator' },
    { label: 'Quit Lintas', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
}

// ---------- startup ----------

// Links and files from the operating system: at start, and when Lintas is already running
const fileExists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function openFromArgs(argv, cwd, skip = process.defaultApp ? 2 : 1) {
  if (!tabs) return;
  for (const url of urlsFromArgs(argv, { cwd, skip, exists: fileExists })) tabs.create({ url, active: true });
}
let pendingOpen = [];
app.on('open-url', (e, url) => { e.preventDefault(); if (tabs) openFromArgs(['--', url], undefined, 0); else pendingOpen.push(url); });
app.on('open-file', (e, file) => { e.preventDefault(); if (tabs) openFromArgs(['--', file], undefined, 0); else pendingOpen.push(file); });
app.on('second-instance', (e, argv, cwd) => {
  if (!win) return;
  showWindow();
  openFromArgs(argv, cwd);
});

// Default browser. Windows 10 and 11 let only the user choose, in Settings > Default apps.
const regQuery = (key) => new Promise(resolve => execFile('reg', ['query', key, '/v', 'ProgId'], { windowsHide: true }, (err, out) => resolve(err ? '' : String(out))));
async function defaultBrowser() {
  if (process.platform === 'win32') {
    const out = await regQuery('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice');
    return { isDefault: /\bLintasURL\b/.test(out), canSetDirectly: false };
  }
  return { isDefault: app.isDefaultProtocolClient('https'), canSetDirectly: true };
}
async function makeDefaultBrowser() {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Lintas');
    return { ...(await defaultBrowser()), openedSettings: true };
  }
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  return defaultBrowser();
}

app.on('web-contents-created', (e, wc) => {
  wc.on('will-attach-webview', ev => ev.preventDefault());
});

app.on('certificate-error', (e, wc, url, error, cert, callback) => callback(false));

app.whenReady().then(async () => {
  store = new JsonStore(path.join(app.getPath('userData'), 'data'));
  data = new BrowserData(store, app.getPath('userData'));
  tms = new Tms(store);
  ai = new Ai(app.getPath('userData'), () => data.settings());
  oracle = new Oracle({ ai, runTool: mcpTool, readPage: oracleReadPage, emit, dataDir: app.getPath('userData') });
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
    // Extension pages use the cookies of the session they run in (normal or private tabs)
    const x = () => Extensions.instances.get(ses) || null;
    hardenSession(ses, { ...ctx,
      extensionAccess: details => x()?.pageAccess(details) || null,
      extensionCookies: url => x().cookieHeader(url),
      extensionSetCookies: (url, lines) => x().storeCookies(url, lines) });
    wireDownloads(ses);
    ses.setSpellCheckerLanguages(['en-US', 'id'].filter(l => ses.availableSpellCheckerLanguages.includes(l)));
  }
  seedSample();
  extensions = new Extensions({ ses: session.fromPartition(PARTITIONS.normal), dataDir: app.getPath('userData'), getWin: () => win, getTabs: () => tabs, getPanels: () => webPanels, emit });
  const privateExt = session.fromPartition(PARTITIONS.privateExt);
  await erasePrivateExt();
  try { await extensions.init(); await extensions.startPrivate(privateExt); } catch (e) { console.error('Chrome extension support failed to start:', e); }
  bridge = new Bridge({ dataDir: app.getPath('userData'), run: mcpTool });
  await syncBridge();
  registerIpc();
  if (!isMac) Menu.setApplicationMenu(null);
  else Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow();
  openFromArgs(process.argv, process.cwd());
  syncTray();
  for (const u of pendingOpen.splice(0)) openFromArgs(['--', u], undefined, 0);

  let wasOnline = net.isOnline();
  setInterval(() => {
    const now = net.isOnline();
    if (now !== wasOnline) { wasOnline = now; emit('online', { online: now }); }
  }, 2000);
});

app.on('activate', () => showWindow());
app.on('window-all-closed', () => { store?.flushAll(); app.quit(); });
let privateErased = false;
app.on('before-quit', (e) => {
  tabs?.persist(); store?.flushAll(); bridge?.stop();
  // Private browsing data from tabs that ran extensions is erased before Lintas exits
  if (!privateErased && app.isReady()) {
    e.preventDefault();
    privateErased = true;
    erasePrivateExt().finally(() => app.quit());
  }
});

/** Erases what private tabs with extensions stored (cookies, storage, cache); the extensions stay installed. */
async function erasePrivateExt() {
  const ses = session.fromPartition(PARTITIONS.privateExt);
  await Promise.allSettled([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache(), ses.clearHostResolverCache()]);
}

