// Chrome extension support for normal (non-private) tabs:
// - chrome.* APIs beyond Electron's built-ins (action, tabs, windows, contextMenus…)
//   through electron-chrome-extensions;
// - installing from the Chrome Web Store ("Add to Chrome" on chromewebstore.google.com)
//   and automatic updates through electron-chrome-web-store;
// - loading unpacked extensions from a folder (developer mode).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dialog, ipcMain, session as electronSession, BrowserWindow } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { popupWindowOptions } from './tabs.js';
import { installChromeWebStore, installExtension, uninstallExtension } from 'electron-chrome-web-store';

const ID = /^[a-p]{32}$/;
const SHIMS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'extension-shims.cjs');
const USER_SCRIPT_WORLD = 2100; // isolated worlds 2100+ are used for extension user scripts

/** Chrome match patterns: <all_urls>, *://*.example.com/path*, https://host/* */
export function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(url);
  const m = /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  const scheme = u.protocol.slice(0, -1);
  if (m[1] === '*' ? !['http', 'https'].includes(scheme) : m[1] !== scheme) return false;
  const host = m[2];
  if (host !== '*' && !(host.startsWith('*.') ? (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))) : u.hostname === host)) return false;
  const re = new RegExp('^' + m[3].split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

export class Extensions {
  constructor({ ses, dataDir, getWin, getTabs }) {
    this.ses = ses;
    this.getWin = getWin;
    this.getTabs = getTabs;
    this.extensionsPath = path.join(dataDir, 'Extensions');
    this.unpackedFile = path.join(dataDir, 'unpacked-extensions.json');
    // Our shims must load before electron-chrome-extensions' preload, which freezes `chrome`.
    ses.registerPreloadScript({ id: 'lintas-ext-shims-frame', type: 'frame', filePath: SHIMS });
    ses.registerPreloadScript({ id: 'lintas-ext-shims-sw', type: 'service-worker', filePath: SHIMS });
    this.api = new ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => {
        const tabs = this.getTabs();
        const t = tabs.get(tabs.create({ url: details.url || 'about:blank', active: details.active !== false, raw: true }).id);
        return [tabs.ensureView(t).webContents, this.getWin()];
      },
      selectTab: (wc) => { const tabs = this.getTabs(); const t = tabs.byContents(wc); if (t) tabs.activate(t.id); },
      removeTab: (wc) => { const tabs = this.getTabs(); const t = tabs.byContents(wc); if (t) tabs.close(t.id); },
      createWindow: async (details) => {
        const tabs = this.getTabs();
        for (const url of [].concat(details.url || 'about:blank')) tabs.create({ url, raw: true });
        return this.getWin();
      },
    });
  }

  /** chrome.* APIs Electron lacks, served to extension pages and service workers. */
  installShims() {
    this.userScriptsFile = path.join(path.dirname(this.unpackedFile), 'user-scripts.json');
    try { this.userScripts = JSON.parse(fs.readFileSync(this.userScriptsFile, 'utf8')); } catch { this.userScripts = {}; }
    const extIdOf = (url) => { const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || ''); return m ? m[1] : null; };
    ipcMain.handle('lintas-ext', (e, name, args) => this.shimCall(extIdOf(e.senderFrame?.url), name, args, (ev, a) => { try { if (!e.sender.isDestroyed()) e.sender.send('lintas-ext-event', ev, a); } catch {} }));
    const seen = new Set();
    this.ses.serviceWorkers.on('running-status-changed', ({ versionId }) => {
      if (seen.has(versionId)) return;
      const sw = this.ses.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = extIdOf(sw?.scope);
      if (!id) return;
      seen.add(versionId);
      sw.ipc.handle('lintas-ext', (e, name, args) => this.shimCall(id, name, args, (ev, a) => { try { sw.send('lintas-ext-event', ev, a); } catch {} }));
    });
  }

  requirePermission(ext, ...anyOf) {
    const perms = new Set([...(ext.manifest.permissions || []), ...(ext.manifest.host_permissions || [])].map(String));
    if (!anyOf.some(p => perms.has(p))) throw new Error(`This extension needs the "${anyOf[0]}" permission for this call.`);
  }

  tabWebContents(tabId) {
    const tabs = this.getTabs();
    const t = tabId != null ? tabs.tabs.find(x => x.view && x.view.webContents.id === Number(tabId)) : tabs.active();
    if (!t?.view) throw new Error('No tab with id ' + tabId + '.');
    return t.view.webContents;
  }

  async shimCall(extId, name, args = [], send = () => {}) {
    const ext = extId && this.ses.extensions.getExtension(extId);
    if (!ext) throw new Error('Only extensions can call this API.');
    switch (name) {
      // chrome.sidePanel: Lintas shows an extension's side panel as a tab next to the page.
      case 'sidePanel.setOptions': {
        this.requirePermission(ext, 'sidePanel');
        const o = args[0] || {};
        const m = (this.sidePanels ||= new Map());
        const key = `${extId}:${o.tabId ?? '*'}`;
        m.set(key, { ...(m.get(key) || {}), ...o });
        return;
      }
      case 'sidePanel.getOptions': {
        const m = this.sidePanels || new Map();
        const o = m.get(`${extId}:${args[0]?.tabId ?? '*'}`) || m.get(`${extId}:*`) || {};
        return { enabled: o.enabled !== false, path: o.path || ext.manifest.side_panel?.default_path, tabId: args[0]?.tabId };
      }
      case 'sidePanel.open': {
        this.requirePermission(ext, 'sidePanel');
        const m = this.sidePanels || new Map();
        const o = m.get(`${extId}:${args[0]?.tabId ?? '*'}`) || m.get(`${extId}:*`) || {};
        const rel = String(o.path || ext.manifest.side_panel?.default_path || '').replace(/^\/+/, '');
        if (!rel) throw new Error('This extension has no side panel page.');
        const url = new URL(rel, ext.url).href;
        if (!url.startsWith(ext.url)) throw new Error('The side panel page must belong to the extension.');
        const tabs = this.getTabs();
        const open = tabs.tabs.find(x => x.view && x.url === url);
        if (open) tabs.activate(open.id); else tabs.create({ url, raw: true });
        return;
      }
      // chrome.offscreen: one hidden page per extension.
      case 'offscreen.createDocument': {
        this.requirePermission(ext, 'offscreen');
        const docs = (this.offscreen ||= new Map());
        if (docs.has(extId)) throw new Error('Only a single offscreen document may be created.');
        const url = new URL(String(args[0]?.url || ''), ext.url).href;
        if (!url.startsWith(ext.url)) throw new Error('The offscreen page must belong to the extension.');
        const w = new BrowserWindow({ show: false, webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        docs.set(extId, w);
        w.on('closed', () => { if (docs.get(extId) === w) docs.delete(extId); });
        await w.loadURL(url);
        return;
      }
      case 'offscreen.hasDocument': return !!this.offscreen?.has(extId);
      case 'offscreen.closeDocument': { const w = this.offscreen?.get(extId); if (w && !w.isDestroyed()) w.destroy(); this.offscreen?.delete(extId); return; }
      // chrome.debugger, over Electron's own debugger for the tab.
      case 'debugger.attach': {
        this.requirePermission(ext, 'debugger');
        const tabId = args[0]?.tabId;
        const wc = this.tabWebContents(tabId);
        if (wc.debugger.isAttached()) throw new Error('Another debugger is already attached to the tab with id: ' + tabId + '.');
        wc.debugger.attach(/^\d+\.\d+$/.test(String(args[1])) ? String(args[1]) : undefined);
        const d = (this.debuggees ||= new Map());
        const onMsg = (e, method, params, sessionId) => send('debugger.onEvent', [{ tabId, ...(sessionId ? { sessionId } : {}) }, method, params]);
        const onDetach = (e, reason) => { d.delete(wc.id); wc.debugger.off('message', onMsg); send('debugger.onDetach', [{ tabId }, reason === 'target closed' ? 'target_closed' : 'canceled_by_user']); };
        wc.debugger.on('message', onMsg); wc.debugger.once('detach', onDetach);
        d.set(wc.id, { extId });
        return;
      }
      case 'debugger.detach': {
        const wc = this.tabWebContents(args[0]?.tabId);
        if (this.debuggees?.get(wc.id)?.extId !== extId) throw new Error('Debugger is not attached to the tab with id: ' + args[0]?.tabId + '.');
        wc.debugger.detach();
        return;
      }
      case 'debugger.sendCommand': {
        const wc = this.tabWebContents(args[0]?.tabId);
        if (this.debuggees?.get(wc.id)?.extId !== extId) throw new Error('Debugger is not attached to the tab with id: ' + args[0]?.tabId + '.');
        return wc.debugger.sendCommand(String(args[1]), args[2] && typeof args[2] === 'object' ? args[2] : {}, args[0]?.sessionId);
      }
      case 'debugger.getTargets': {
        this.requirePermission(ext, 'debugger');
        return this.getTabs().tabs.filter(x => x.view && !x.private).map(x => ({ type: 'page', id: String(x.view.webContents.id), tabId: x.view.webContents.id, attached: x.view.webContents.debugger.isAttached(), title: x.title || '', url: x.url || '' }));
      }
      case 'tabs.captureVisibleTab': {
        this.requirePermission(ext, '<all_urls>', 'activeTab');
        const opts = args.find(a => a && typeof a === 'object') || {};
        const img = await this.tabWebContents(null).capturePage();
        return opts.format === 'png' ? img.toDataURL() : 'data:image/jpeg;base64,' + img.toJPEG(Math.max(0, Math.min(100, opts.quality ?? 92))).toString('base64');
      }
      case 'pageCapture.saveAsMHTML': {
        this.requirePermission(ext, 'pageCapture');
        const wc = this.tabWebContents(args[0]?.tabId);
        const file = path.join(os.tmpdir(), `lintas-capture-${process.pid}-${Date.now()}.mhtml`);
        try { await wc.savePage(file, 'MHTML'); return fs.readFileSync(file, 'utf8'); }
        finally { fs.rm(file, { force: true }, () => {}); }
      }
      case 'identity.launchWebAuthFlow': {
        // As in Chrome: interactive sign-in opens in a popup window; a non-interactive check
        // loads hidden and fails if the provider needs the user.
        this.requirePermission(ext, 'identity');
        const o = args[0] || {};
        const url = String(o.url || '');
        if (!/^https:\/\//.test(url)) throw new Error('launchWebAuthFlow needs an https URL.');
        const interactive = !!o.interactive;
        const redirect = `https://${extId}.chromiumapp.org/`;
        const w = new BrowserWindow({ ...popupWindowOptions(process.platform === 'darwin'), show: interactive, title: 'Sign in', parent: interactive ? this.getWin() || undefined : undefined,
          webPreferences: { ...popupWindowOptions(false).webPreferences, session: this.ses } });
        const tabs = this.getTabs();
        if (tabs?.wirePopup) tabs.wirePopup(w, { private: false });
        const wc = w.webContents;
        return new Promise((resolve, reject) => {
          let timer = null, settled = false;
          const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); if (!w.isDestroyed()) w.destroy(); fn(v); };
          const onNav = (e) => { if (e.isMainFrame && e.url.startsWith(redirect)) { e.preventDefault?.(); done(resolve, e.url); } };
          wc.on('will-redirect', onNav); wc.on('will-navigate', onNav); wc.on('did-start-navigation', onNav); wc.on('did-redirect-navigation', onNav);
          w.on('closed', () => done(reject, new Error('The user did not approve access.')));
          if (!interactive) {
            const ms = Math.max(0, Number(o.timeoutMsForNonInteractive) || 0);
            if (o.abortOnLoadForNonInteractive !== false) wc.on('did-finish-load', () => setTimeout(() => done(reject, new Error('User interaction required.')), 50));
            timer = setTimeout(() => done(reject, new Error('User interaction required.')), ms || 60000);
          }
          wc.loadURL(url).catch((e) => { if (!settled && !String(e?.message).includes('ERR_ABORTED')) done(reject, new Error('Authorization page could not be loaded.')); });
        });
      }
      case 'userScripts.register': case 'userScripts.update': {
        this.requirePermission(ext, 'userScripts');
        const list = this.userScripts[extId] ||= [];
        for (const sc of [].concat(args[0] || [])) {
          if (!sc?.id) throw new Error('Each user script needs an id.');
          const i = list.findIndex(x => x.id === sc.id);
          if (name === 'userScripts.register' && i >= 0) throw new Error(`A user script with id "${sc.id}" is already registered.`);
          const next = { ...(i >= 0 ? list[i] : {}), ...sc };
          i >= 0 ? (list[i] = next) : list.push(next);
        }
        this.saveUserScripts();
        return;
      }
      case 'userScripts.unregister': {
        this.requirePermission(ext, 'userScripts');
        const ids = args[0]?.ids;
        this.userScripts[extId] = ids ? (this.userScripts[extId] || []).filter(x => !ids.includes(x.id)) : [];
        this.saveUserScripts();
        return;
      }
      case 'userScripts.getScripts': {
        this.requirePermission(ext, 'userScripts');
        const ids = args[0]?.ids;
        return (this.userScripts[extId] || []).filter(x => !ids || ids.includes(x.id));
      }
      case 'userScripts.configureWorld': this.requirePermission(ext, 'userScripts'); return;
      default: throw new Error(`chrome.${name} is not supported.`);
    }
  }

  saveUserScripts() { fs.writeFileSync(this.userScriptsFile, JSON.stringify(this.userScripts), { mode: 0o600 }); }

  /** Run registered user scripts in a tab at the requested time. */
  attachUserScripts(wc) {
    const run = async (when) => {
      const url = wc.getURL();
      let world = USER_SCRIPT_WORLD;
      for (const [extId, scripts] of Object.entries(this.userScripts)) {
        world++;
        if (!this.ses.extensions.getExtension(extId)) continue;
        for (const sc of scripts) {
          const at = sc.runAt || 'document_idle';
          if ((at === 'document_idle') !== (when === 'idle')) continue;
          if (!(sc.matches || []).some(p => matchesPattern(p, url)) || (sc.excludeMatches || []).some(p => matchesPattern(p, url))) continue;
          const sources = [];
          for (const js of sc.js || []) {
            if (typeof js.code === 'string') sources.push({ code: js.code });
            else if (js.file) { const ext = this.ses.extensions.getExtension(extId); try { sources.push({ code: fs.readFileSync(path.join(ext.path, js.file), 'utf8') }); } catch {} }
          }
          if (!sources.length) continue;
          try { sc.world === 'MAIN' ? await wc.executeJavaScript(sources.map(x => x.code).join(';\n')) : await wc.executeJavaScriptInIsolatedWorld(world, sources); }
          catch (e) { console.error('User script failed', sc.id, e.message); }
        }
      }
    };
    wc.on('dom-ready', () => run('ready'));
    wc.on('did-finish-load', () => run('idle'));
  }

  async init() {
    this.installShims();
    // The browser interface runs in the default session; extension icons load from crx://.
    ElectronChromeExtensions.handleCRXProtocol(electronSession.defaultSession);
    await installChromeWebStore({
      session: this.ses,
      extensionsPath: this.extensionsPath,
      allowUnpackedExtensions: false,
      beforeInstall: async (d) => {
        const perms = [...(d.manifest?.permissions || []), ...(d.manifest?.host_permissions || [])].map(String);
        const r = await dialog.showMessageBox(this.getWin(), {
          type: 'question', buttons: ['Add extension', 'Cancel'], defaultId: 1, cancelId: 1,
          message: `Add “${d.localizedName}”?`,
          detail: perms.length ? `It can:\n• ${perms.slice(0, 12).join('\n• ')}${perms.length > 12 ? '\n• …' : ''}` : 'It asks for no special permissions.',
        });
        return { action: r.response === 0 ? 'allow' : 'deny' };
      },
    });
    for (const dir of this.unpackedDirs()) {
      try { await this.ses.extensions.loadExtension(dir, { allowFileAccess: false }); } catch (e) { console.error('Could not load unpacked extension', dir, e.message); }
    }
  }

  addTab(wc) { this.api.addTab(wc, this.getWin()); this.attachUserScripts(wc); }
  selectTab(wc) { try { this.api.selectTab(wc); } catch {} }

  unpackedDirs() {
    try { return JSON.parse(fs.readFileSync(this.unpackedFile, 'utf8')).filter(d => typeof d === 'string'); } catch { return []; }
  }

  saveUnpacked(dirs) { fs.writeFileSync(this.unpackedFile, JSON.stringify(dirs), { mode: 0o600 }); }

  list() {
    const unpacked = new Set(this.unpackedDirs().map(d => path.resolve(d)));
    return this.ses.extensions.getAllExtensions().map(e => ({
      id: e.id, name: e.name, version: e.version,
      description: e.manifest?.description || '',
      manifestVersion: e.manifest?.manifest_version || null,
      source: unpacked.has(path.resolve(e.path)) ? 'unpacked' : 'store',
      optionsUrl: e.manifest?.options_ui?.page || e.manifest?.options_page ? `${e.url}${e.manifest.options_ui?.page || e.manifest.options_page}` : null,
      permissions: [...(e.manifest?.permissions || []), ...(e.manifest?.host_permissions || [])].map(String),
    }));
  }

  /** Install from the Chrome Web Store by ID or store URL. */
  async installFromStore(input) {
    const id = String(input || '').trim().match(/[a-p]{32}/)?.[0];
    if (!id || !ID.test(id)) throw new Error('Paste a Chrome Web Store link or a 32-letter extension ID.');
    await installExtension(id, { session: this.ses, extensionsPath: this.extensionsPath });
    return this.list().find(e => e.id === id) || null;
  }

  async loadUnpacked() {
    const r = await dialog.showOpenDialog(this.getWin(), { title: 'Load unpacked extension', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('That folder has no manifest.json, so it is not an extension.');
    const ext = await this.ses.extensions.loadExtension(dir, { allowFileAccess: false });
    this.saveUnpacked([...new Set([...this.unpackedDirs(), dir])]);
    return { id: ext.id, name: ext.name };
  }

  async remove(id) {
    const ext = this.ses.extensions.getExtension(id);
    if (!ext) return;
    const dirs = this.unpackedDirs();
    if (dirs.some(d => path.resolve(d) === path.resolve(ext.path))) {
      this.ses.extensions.removeExtension(id);
      this.saveUnpacked(dirs.filter(d => path.resolve(d) !== path.resolve(ext.path)));
    } else {
      await uninstallExtension(id, { session: this.ses, extensionsPath: this.extensionsPath });
    }
  }
}
