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
import { randomUUID, randomBytes } from 'node:crypto';
import { dialog, ipcMain, session as electronSession, BrowserWindow } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { popupWindowOptions, liveContents } from './tabs.js';
import { installNativeMessaging } from './native-messaging.js';
import { GROUP_COLORS, filterContexts, nextGroupColor, shortcutFor, shortcutMatches, matchesTitle, matchesPattern, parseSetCookie, normalizeSite, restrictManifest } from './ext-util.js';
export { matchesPattern };
import { installChromeWebStore, installExtension, uninstallExtension } from 'electron-chrome-web-store';

const ID = /^[a-p]{32}$/;
// Beside a Web Store extension limited to some sites: its manifest as published (no leading "_": Chromium reserves those names)
const ORIGINAL_MANIFEST = 'lintas-original-manifest.json';
const SHIMS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'extension-shims.cjs');
const extIdOf = (url) => { const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || ''); return m ? m[1] : null; };
const USER_SCRIPT_WORLD = 2100; // isolated worlds 2100+ are used for extension user scripts
export class Extensions {
  static instances = new Map(); // session -> instance
  static nextGroupId = 1;       // tab group ids, unique across normal and private tabs

  constructor({ ses, dataDir, getWin, getTabs, getPanels, emit, owner = null }) {
    this.ses = ses;
    // The instance for private tabs (owner: the normal one). It runs the extensions the user allowed
    // in private tabs, in the private session; settings and installs live with the owner.
    this.owner = owner;
    this.isPrivate = !!owner;
    Extensions.instances.set(ses, this);
    this.getWin = getWin;
    this.getTabs = getTabs;
    this.getPanels = getPanels || (() => null);
    this.emit = emit || (() => {});
    this.groups = new Map();       // tab group id -> { id, title, color, collapsed }
    this.tabPanels = new Map();    // tab webContents id -> { extId, url, name }: side panels opened for one tab
    this.windowPanel = null;       // { extId, url, name }: a side panel opened for the whole window
    this.panelContents = new Set(); // webContents ids of pages shown in extension side panels (not tabs)
    this.panelBehavior = new Map(); // extension id -> { openPanelOnActionClick }
    this.listeners = new Map();    // extension id -> Set of senders for chrome.* events
    this.docIds = new Map();       // webContents id -> { contextId, documentId }
    this.popups = new Set();       // popup windows opened by extensions (chrome.windows.create)
    this.externalPending = new Map(); // message id -> a web page's sendMessage waiting for the extension's reply
    this.extensionsPath = path.join(dataDir, 'Extensions');
    this.unpackedFile = path.join(dataDir, 'unpacked-extensions.json');
    // The user's choices per extension (on/off, file URLs, private tabs, site access), as in Chrome's details page
    this.settingsFile = path.join(dataDir, 'extension-settings.json');
    try { this.prefs = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) || {}; } catch { this.prefs = {}; }
    this.known = new Map();        // extension id -> { path, type: 'store' | 'unpacked' }, loaded or turned off
    this.loading = new Set();      // ids Lintas is loading itself (others are Web Store installs and updates)
    // Our shims must load before electron-chrome-extensions' preload, which freezes `chrome`.
    ses.registerPreloadScript({ id: 'lintas-ext-shims-frame', type: 'frame', filePath: SHIMS });
    ses.registerPreloadScript({ id: 'lintas-ext-shims-sw', type: 'service-worker', filePath: SHIMS });
    this.api = new ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => {
        const tabs = this.getTabs();
        const t = tabs.get(tabs.create({ url: details.url || 'about:blank', active: details.active !== false, raw: true, private: this.isPrivate }).id);
        return [tabs.ensureView(t).webContents, this.getWin()];
      },
      // Tab details Chrome has and electron-chrome-extensions leaves out: position, pinned, group
      assignTabDetails: (details, wc) => this.assignTabDetails(details, wc),
      selectTab: (wc) => { const tabs = this.getTabs(); const t = tabs.byContents(wc); if (t) tabs.activate(t.id); },
      removeTab: (wc) => { const tabs = this.getTabs(); const t = tabs.byContents(wc); if (t) tabs.close(t.id); },
      createWindow: async (details) => {
        const urls = [].concat(details.url || 'about:blank').map(String);
        // chrome.windows.create({ type: 'popup' }) is a real popup window, as in Chrome (sign-in windows)
        if (details.type === 'popup' || details.type === 'panel') {
          const px = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
          const w = new BrowserWindow({ ...popupWindowOptions(process.platform === 'darwin'), width: px(details.width, 520), height: px(details.height, 680),
            ...(Number.isFinite(details.left) && Number.isFinite(details.top) ? { x: px(details.left), y: px(details.top) } : {}),
            webPreferences: { ...popupWindowOptions(false).webPreferences, session: this.ses } });
          this.getTabs()?.wirePopup?.(w, { private: this.isPrivate });
          this.popups.add(w);
          w.once('closed', () => this.popups.delete(w));
          this.api.addTab(w.webContents, w);
          w.webContents.loadURL(urls[0]).catch(() => {});
          return w;
        }
        const tabs = this.getTabs();
        for (const url of urls) tabs.create({ url, raw: true, private: this.isPrivate });
        return this.getWin();
      },
      // chrome.windows.remove: closes a popup; an extension cannot close the browser window itself
      removeWindow: async (w) => { if (w && w !== this.getWin() && !w.isDestroyed()) w.close(); },
    });
    installNativeMessaging(this.api);
    // "Open the side panel when the toolbar button is clicked" (chrome.sidePanel.setPanelBehavior)
    const ba = this.api.api?.browserAction;
    if (ba?.activateClick) {
      const click = ba.activateClick.bind(ba);
      ba.activateClick = (details) => {
        // The click is for the tab the user is looking at. Lintas's own pages (new tab, settings…) have
        // no web page, so such a tab gets an empty one for the extension to work with.
        try {
          const tabs = this.getTabs(); const t = tabs?.active();
          if (this.mine(t)) this.selectTab(liveContents(t) || tabs.ensureView(t).webContents);
        } catch {}
        const ext = this.ses.extensions.getExtension(details?.extensionId);
        if (ext && this.panelBehavior.get(ext.id)?.openPanelOnActionClick && !ba.getPopupUrl?.(ext.id, details.tabId)) {
          const tabs = this.getTabs(); const t = tabs?.active();
          return this.openSidePanel(ext, { tabId: t?.view?.webContents?.id, toggle: true }).catch(() => {});
        }
        return click(details);
      };
    }
  }

  /** chrome.* APIs Electron lacks, served to extension pages and service workers. */
  installShims() {
    // Private tabs keep user scripts in memory only, like the rest of their session
    this.userScriptsFile = this.owner ? null : path.join(path.dirname(this.unpackedFile), 'user-scripts.json');
    try { this.userScripts = this.userScriptsFile ? JSON.parse(fs.readFileSync(this.userScriptsFile, 'utf8')) : {}; } catch { this.userScripts = {}; }
    Extensions.installIpc();
    const seen = new Set();
    this.ses.serviceWorkers.on('running-status-changed', ({ versionId }) => {
      if (seen.has(versionId)) return;
      const sw = this.ses.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = extIdOf(sw?.scope);
      if (!id) return;
      seen.add(versionId);
      sw.ipc.handle('lintas-ext', (e, name, args) => this.shimCall(id, name, args, (ev, a) => { try { if (sw.isDestroyed?.()) return false; sw.send('lintas-ext-event', ev, a); return true; } catch { return false; } }));
    });
  }

  /** One set of IPC handlers for all instances: each call goes to the instance of the sender's session. */
  static installIpc() {
    if (Extensions.ipcReady) return;
    Extensions.ipcReady = true;
    const of = (e) => Extensions.instances.get(e.sender?.session) || null;
    // Each sender returns false once its page or worker is gone.
    ipcMain.handle('lintas-ext', (e, name, args) => {
      const x = of(e); if (!x) throw new Error('Extensions are not available here.');
      const wc = e.sender;
      return x.shimCall(extIdOf(e.senderFrame?.url), name, args, (ev, a) => { try { if (wc.isDestroyed()) return false; wc.send('lintas-ext-event', ev, a); return true; } catch { return false; } }, e.senderFrame === wc.mainFrame ? wc : null);
    });
    // Web pages an extension lists in "externally_connectable" can message it (claude.ai → Claude in Chrome)
    ipcMain.on('lintas-ext-connectable', (e) => { e.returnValue = of(e)?.connectableIds(e.senderFrame?.url) || []; });
    ipcMain.handle('lintas-ext-external', (e, extId, message) => {
      const x = of(e); if (!x) throw new Error('Could not establish connection. Receiving end does not exist.');
      return x.deliverExternal(e, String(extId), message);
    });
  }

  /** Whether a tab belongs to this instance: private tabs to the private one, the others to the normal one. */
  mine(t) { return !!t && !!t.private === this.isPrivate; }

  /** Docked panel keys: 'ext:tab:<tab webContents>' (unique) or 'ext:win:<extension>' (':p' in private tabs). */
  winKey(extId) { return 'ext:win:' + extId + (this.isPrivate ? ':p' : ''); }
  winKeyId(key) {
    const m = /^ext:win:([a-p]{32})(:p)?$/.exec(key || '');
    return m && !!m[2] === this.isPrivate ? m[1] : null;
  }
  ownsKey(key) {
    if (String(key).startsWith('ext:tab:')) return this.tabPanels.has(Number(key.slice(8)));
    return !!this.winKeyId(key);
  }

  get sidePanels() { return (this._sidePanels ||= new Map()); }

  requirePermission(ext, ...anyOf) {
    const perms = new Set([...(ext.manifest.permissions || []), ...(ext.manifest.host_permissions || [])].map(String));
    if (!anyOf.some(p => perms.has(p))) throw new Error(`This extension needs the "${anyOf[0]}" permission for this call.`);
  }

  tabWebContents(tabId) {
    const tabs = this.getTabs();
    const t = tabId != null ? this.tabByChromeId(tabId) : (this.mine(tabs.active()) ? tabs.active() : null);
    const wc = liveContents(t);
    if (!wc) throw new Error('No tab with id ' + tabId + '.');
    return wc;
  }

  async shimCall(extId, name, args = [], send = () => {}, page = null) {
    const ext = extId && this.ses.extensions.getExtension(extId);
    if (!ext) throw new Error('Only extensions can call this API.');
    switch (name) {
      // A page or worker announces itself so it receives events (tab groups) that nobody asked for.
      case 'events.hello': {
        const set = this.listeners.get(extId) || new Set();
        set.add(send); this.listeners.set(extId, set);
        return [...this.panelContents];
      }
      case 'window.close': {
        if (!page) return false;
        for (const [key, view] of this.getPanels()?.views || []) if (key.startsWith('ext:') && view.webContents === page) { this.closePanel(key); return true; }
        const tabs = this.getTabs(); const t = tabs?.byContents(page);
        if (t) { tabs.close(t.id); return true; }
        return false;
      }
      case 'runtime.externalReply': {
        const [id, response, handled] = args;
        const p = this.externalPending.get(String(id));
        if (!p || p.extId !== extId) return;
        if (handled) p.finish(response ?? undefined);
        else if (--p.left <= 0) p.finish(undefined);
        return;
      }
      case 'runtime.getContexts': return filterContexts(this.contexts(ext), args[0] && typeof args[0] === 'object' ? args[0] : {});
      // chrome.sidePanel: shown in Lintas's side panel, beside the page, for one tab or the whole window.
      case 'sidePanel.setOptions': {
        this.requirePermission(ext, 'sidePanel');
        const o = args[0] || {};
        const key = `${extId}:${o.tabId ?? '*'}`;
        const next = { ...(this.sidePanels.get(key) || {}), ...o };
        this.sidePanels.set(key, next);
        // An open panel follows its options: disabled closes it, a new page loads in it.
        const panelKey = o.tabId != null ? (this.tabPanels.get(Number(o.tabId))?.extId === extId ? 'ext:tab:' + Number(o.tabId) : null) : (this.windowPanel?.extId === extId ? this.winKey(extId) : null);
        if (panelKey) {
          if (next.enabled === false) this.closePanel(panelKey);
          else if (o.path) { const url = this.panelUrl(ext, next); const p = o.tabId != null ? this.tabPanels.get(Number(o.tabId)) : this.windowPanel; if (url && p.url !== url) { p.url = url; this.getPanels()?.navigate(panelKey, url); } }
        }
        return;
      }
      case 'sidePanel.getOptions': {
        const o = this.sidePanels.get(`${extId}:${args[0]?.tabId ?? '*'}`) || this.sidePanels.get(`${extId}:*`) || {};
        return { enabled: o.enabled !== false, path: o.path || ext.manifest.side_panel?.default_path, ...(args[0]?.tabId != null ? { tabId: args[0].tabId } : {}) };
      }
      case 'sidePanel.open': {
        this.requirePermission(ext, 'sidePanel');
        const o = args[0] || {};
        if (o.tabId == null && o.windowId == null) throw new Error('No active side panel for the given tabId or windowId.');
        return this.openSidePanel(ext, o);
      }
      case 'sidePanel.close': {
        this.requirePermission(ext, 'sidePanel');
        const o = args[0] || {};
        const key = o.tabId != null ? 'ext:tab:' + Number(o.tabId) : this.winKey(extId);
        if (o.tabId != null && this.tabPanels.get(Number(o.tabId))?.extId !== extId) throw new Error('No active side panel for tabId: ' + o.tabId + '.');
        if (o.tabId == null && this.windowPanel?.extId !== extId) throw new Error('No active side panel for windowId: ' + o.windowId + '.');
        this.closePanel(key);
        return;
      }
      case 'sidePanel.setPanelBehavior': {
        this.requirePermission(ext, 'sidePanel');
        this.panelBehavior.set(extId, { openPanelOnActionClick: !!args[0]?.openPanelOnActionClick });
        return;
      }
      case 'sidePanel.getPanelBehavior': return { openPanelOnActionClick: !!this.panelBehavior.get(extId)?.openPanelOnActionClick };

      // Tab groups: kept here and shown in the tab strip.
      case 'tabs.group': {
        const o = args[0] || {};
        const ids = [].concat(o.tabIds ?? []).map(Number);
        if (!ids.length) throw new Error('No tabs given.');
        const members = ids.map(id => { const t = this.tabByChromeId(id); if (!t) throw new Error('No tab with id: ' + id + '.'); return t; });
        let g;
        if (o.groupId != null) {
          g = this.groups.get(Number(o.groupId));
          if (!g) throw new Error('No group with id: ' + o.groupId + '.');
        } else {
          g = { id: Extensions.nextGroupId++, title: '', color: nextGroupColor([...this.groups.values()].map(x => x.color)), collapsed: false };
          this.groups.set(g.id, g);
          this.broadcastGroups('tabGroups.onCreated', [this.publicGroup(g)]);
        }
        const before = new Set();
        for (const t of members) { if (t.groupId === g.id) continue; if (t.groupId != null) before.add(t.groupId); t.groupId = g.id; t.pinned = false; }
        this.gatherGroup(g.id);
        for (const id of before) this.pruneGroup(id);
        this.groupsChanged(members);
        return g.id;
      }
      case 'tabs.ungroup': {
        const ids = [].concat(args[0] ?? []).map(Number);
        const touched = [], old = new Set();
        for (const id of ids) { const t = this.tabByChromeId(id); if (!t) throw new Error('No tab with id: ' + id + '.'); if (t.groupId != null) { old.add(t.groupId); delete t.groupId; touched.push(t); } }
        for (const id of old) this.pruneGroup(id);
        this.groupsChanged(touched);
        return;
      }
      case 'tabGroups.get': {
        const g = this.groups.get(Number(args[0]));
        if (!g) throw new Error('No group with id: ' + args[0] + '.');
        return this.publicGroup(g);
      }
      case 'tabGroups.query': {
        const q = args[0] || {};
        const win = this.windowId();
        return [...this.groups.values()].map(g => this.publicGroup(g)).filter(g =>
          (q.collapsed == null || g.collapsed === q.collapsed) && (q.color == null || g.color === q.color) &&
          (q.title == null || matchesTitle(String(q.title), g.title)) && (q.windowId == null || q.windowId === -2 || q.windowId === win));
      }
      case 'tabGroups.update': {
        const g = this.groups.get(Number(args[0]));
        if (!g) throw new Error('No group with id: ' + args[0] + '.');
        const u = args[1] || {};
        if (u.color != null) { if (!GROUP_COLORS.includes(u.color)) throw new Error('Invalid color: ' + u.color + '.'); g.color = u.color; }
        if (u.title != null) g.title = String(u.title);
        if (u.collapsed != null) g.collapsed = !!u.collapsed;
        this.broadcastGroups('tabGroups.onUpdated', [this.publicGroup(g)]);
        this.getTabs()?.changed();
        return this.publicGroup(g);
      }
      case 'tabGroups.move': {
        const g = this.groups.get(Number(args[0]));
        if (!g) throw new Error('No group with id: ' + args[0] + '.');
        this.moveGroup(g.id, Number(args[1]?.index ?? -1));
        this.broadcastGroups('tabGroups.onMoved', [this.publicGroup(g)]);
        this.getTabs()?.changed();
        return this.publicGroup(g);
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
        return this.getTabs().tabs.filter(x => liveContents(x) && this.mine(x)).map(x => { const wc = liveContents(x); return { type: 'page', id: String(wc.id), tabId: wc.id, attached: wc.debugger.isAttached(), title: x.title || '', url: x.url || '' }; });
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
        if (tabs?.wirePopup) tabs.wirePopup(w, { private: this.isPrivate });
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

  // ---------- site access for extension pages (cookies) ----------

  /**
   * The extension whose own page makes this request (directly, or from a frame inside it), when its
   * manifest gives it access to the address. Chrome then treats the request as coming from the site
   * itself, so the user's login cookies apply; Electron treats it as a stranger's. Claude in Chrome
   * depends on this: its side panel shows claude.ai with the user's claude.ai session.
   */
  pageAccess(details) {
    if (!/^https?:/i.test(details?.url || '')) return null;
    let top = '';
    try { top = details.frame?.top?.url || details.webContents?.getURL?.() || ''; } catch {}
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(top);
    const ext = m && this.ses.extensions.getExtension(m[1]);
    if (!ext) return null;
    const pats = [...(ext.manifest.host_permissions || []), ...(ext.manifest.manifest_version === 2 ? ext.manifest.permissions || [] : [])].map(String);
    return pats.some(p => matchesPattern(p, details.url)) ? ext : null;
  }

  /** The Cookie header the site itself would get for this address. */
  async cookieHeader(url) {
    try { return (await this.ses.cookies.get({ url })).map(c => `${c.name}=${c.value}`).join('; '); } catch { return ''; }
  }

  /** Stores Set-Cookie headers of a response the extension page was allowed to make. */
  async storeCookies(url, lines) {
    for (const line of lines) {
      const c = parseSetCookie(line, url);
      if (!c) continue;
      try { c.remove ? await this.ses.cookies.remove(url, c.name) : await this.ses.cookies.set(c); } catch {}
    }
  }

  // ---------- messages from web pages (externally_connectable) ----------

  /** Extensions that accept messages from this page: its address matches their externally_connectable.matches. */
  connectableIds(url) {
    if (!/^https?:/i.test(url || '')) return [];
    return this.ses.extensions.getAllExtensions()
      .filter(x => (x.manifest?.externally_connectable?.matches || []).some(p => matchesPattern(String(p), url)))
      .map(x => x.id);
  }

  /** chrome.runtime.sendMessage(extensionId, message) from a web page → the extension's runtime.onMessageExternal. */
  async deliverExternal(e, extId, message) {
    const noReceiver = () => new Error('Could not establish connection. Receiving end does not exist.');
    const frame = e.senderFrame;
    const url = frame?.url || '';
    if (!this.connectableIds(url).includes(extId)) throw noReceiver();
    const ext = this.ses.extensions.getExtension(extId);
    const wc = e.sender;
    const t = this.getTabs()?.byContents(wc);
    let tab;
    try { if (this.mine(t)) tab = this.api.api.tabs.getTabDetails(wc); } catch {}
    const sender = { url, origin: new URL(url).origin, frameId: frame === wc.mainFrame ? 0 : (frame?.routingId ?? -1), ...(tab ? { tab } : {}) };
    let targets = [...(this.listeners.get(extId) || [])];
    if (!targets.length) {
      // As in Chrome, a message wakes the extension's background worker.
      try { await this.ses.serviceWorkers.startWorkerForScope(ext.url); } catch {}
      for (let i = 0; i < 30 && !this.listeners.get(extId)?.size; i++) await new Promise(r => setTimeout(r, 100));
      targets = [...(this.listeners.get(extId) || [])];
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const p = { extId, left: 0, done: false };
      const timer = setTimeout(() => p.finish(undefined), 5 * 60_000);
      p.finish = (v, err) => { if (p.done) return; p.done = true; clearTimeout(timer); this.externalPending.delete(id); err ? reject(err) : resolve(v); };
      this.externalPending.set(id, p);
      for (const send of targets) {
        if (send('runtime.onMessageExternal', [message, sender, id]) === false) this.listeners.get(extId)?.delete(send);
        else p.left++;
      }
      if (!p.left) p.finish(undefined, noReceiver());
    });
  }

  // ---------- tabs as extensions see them ----------

  tabByChromeId(id) { return this.getTabs()?.tabs.find(x => this.mine(x) && liveContents(x)?.id === Number(id)) || null; }
  windowId() { const w = this.getWin(); return w && !w.isDestroyed() ? w.id : -1; }

  assignTabDetails(details, wc) {
    const tabs = this.getTabs()?.tabs || [];
    const i = tabs.findIndex(x => x.view?.webContents === wc);
    if (i < 0) return;
    const t = tabs[i];
    details.index = i;
    details.pinned = !!t.pinned;
    details.groupId = t.groupId != null && this.groups.has(t.groupId) ? t.groupId : -1;
  }

  /** Lets extensions see a tab's new details (chrome.tabs.onUpdated). */
  refreshTab(t) { try { const wc = t.view?.webContents; if (wc && !wc.isDestroyed()) this.api.api?.tabs?.onUpdated(wc.id); } catch {} }

  /** Extra fields for the browser interface's tab list. */
  tabExtras(t) {
    const g = t.groupId != null ? this.groups.get(t.groupId) : null;
    const p = this.panelFor(t);
    return { group: g ? { id: g.id, title: g.title, color: g.color, collapsed: g.collapsed } : null, extPanel: p ? { key: p.key, extId: p.extId, name: p.name } : null };
  }

  // ---------- keyboard shortcuts (manifest "commands") ----------

  /** Runs the extension command for this key, if any; true when one ran. Lintas's own shortcuts come first. */
  commandKey(input) {
    if (input?.type !== 'keyDown' || !(input.control || input.alt || input.meta)) return false;
    // As in Chrome, an extension cannot take a browser shortcut (Ctrl+T, Ctrl+Shift+E, Ctrl+1…)
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const k = String(input.key || '').length === 1 ? input.key.toLowerCase() : input.key;
    if (mod && !input.alt && (input.shift ? 'tnemib'.includes(k) : 'lftwdjhpsrnqk=+-0123456789,'.includes(k) || ['Tab', 'PageUp', 'PageDown'].includes(k))) return false;
    for (const ext of this.ses.extensions.getAllExtensions()) {
      for (const [name, c] of Object.entries(ext.manifest.commands || {})) {
        const key = shortcutFor(c?.suggested_key);
        if (key && shortcutMatches(key, input)) { this.runCommand(ext, name); return true; }
      }
    }
    return false;
  }

  runCommand(ext, name) {
    const t = this.getTabs()?.active();
    const wc = this.mine(t) ? liveContents(t) : null;
    if (name === '_execute_action' || name === '_execute_browser_action') {
      try { this.api.api.browserAction.activateClick({ extensionId: ext.id, tabId: wc ? wc.id : -1 }); } catch {}
      return;
    }
    if (name === '_execute_side_panel') { this.openSidePanel(ext, { tabId: wc?.id, toggle: true }).catch(() => {}); return; }
    let details;
    try { details = wc ? this.api.api.tabs.getTabDetails(wc) : undefined; } catch {}
    this.api.ctx.router.sendEvent(ext.id, 'commands.onCommand', name, details);
  }

  /** A side panel's page was created: extensions must not take it for a tab (see the shims). */
  panelCreated(key, wc) {
    if (!String(key).startsWith('ext:') || !wc || !this.ownsKey(key)) return;
    const id = wc.id;
    this.panelContents.add(id);
    wc.once('destroyed', () => { this.panelContents.delete(id); this.broadcastPanels(); });
    this.broadcastPanels();
  }

  broadcastPanels() {
    const ids = [...this.panelContents];
    for (const set of this.listeners.values()) for (const send of [...set]) if (send('panels.ids', [ids]) === false) set.delete(send);
  }

  // ---------- tab groups ----------

  publicGroup(g) { return { id: g.id, collapsed: g.collapsed, color: g.color, title: g.title, windowId: this.windowId() }; }

  broadcastGroups(name, args) {
    for (const [extId, set] of this.listeners) {
      const ext = this.ses.extensions.getExtension(extId);
      if (!ext || !(ext.manifest.permissions || []).includes('tabGroups')) continue;
      for (const send of [...set]) if (send(name, args) === false) set.delete(send);
    }
  }

  /** Grouped tabs sit next to each other, starting where the first one is. */
  gatherGroup(id) {
    const tabs = this.getTabs(); if (!tabs) return;
    const all = tabs.tabs;
    const first = all.findIndex(x => x.groupId === id);
    if (first < 0) return;
    const members = all.filter(x => x.groupId === id);
    const rest = all.filter(x => x.groupId !== id);
    const at = all.slice(0, first).filter(x => x.groupId !== id).length;
    all.splice(0, all.length, ...rest.slice(0, at), ...members, ...rest.slice(at));
  }

  moveGroup(id, index) {
    const tabs = this.getTabs(); if (!tabs) return;
    const all = tabs.tabs;
    const members = all.filter(x => x.groupId === id);
    const rest = all.filter(x => x.groupId !== id);
    const at = index < 0 || index > rest.length ? rest.length : index;
    all.splice(0, all.length, ...rest.slice(0, at), ...members, ...rest.slice(at));
  }

  /** Removes a group once its last tab has left or closed. */
  pruneGroup(id) {
    const g = this.groups.get(id);
    if (!g || (this.getTabs()?.tabs || []).some(x => x.groupId === id)) return;
    this.groups.delete(id);
    this.broadcastGroups('tabGroups.onRemoved', [this.publicGroup(g)]);
  }

  groupsChanged(touched) {
    this.getTabs()?.changed();
    for (const t of touched) this.refreshTab(t);
  }

  // ---------- side panels ----------

  panelUrl(ext, o) {
    const rel = String(o?.path || ext.manifest.side_panel?.default_path || '').replace(/^\/+/, '');
    if (!rel) return null;
    const url = new URL(rel, ext.url).href;
    return url.startsWith(ext.url) ? url : null;
  }

  /** The side panel the interface shows for a tab: the tab's own, or the window's. */
  panelFor(t) {
    if (!this.mine(t)) return null;
    const wc = t.view?.webContents;
    const own = wc && !wc.isDestroyed() ? this.tabPanels.get(wc.id) : null;
    if (own) return { ...own, key: 'ext:tab:' + wc.id };
    return this.windowPanel ? { ...this.windowPanel, key: this.winKey(this.windowPanel.extId) } : null;
  }

  /** What a docked panel view should load (WebPanels asks). */
  panelTarget(key) {
    if (key.startsWith('ext:tab:')) { const p = this.tabPanels.get(Number(key.slice(8))); return p ? { url: p.url, session: this.ses } : null; }
    const id = this.winKeyId(key);
    return id && this.windowPanel?.extId === id ? { url: this.windowPanel.url, session: this.ses } : null;
  }

  async openSidePanel(ext, o) {
    const extId = ext.id;
    const tabs = this.getTabs();
    let wc = null;
    if (o.tabId != null) { const t = this.tabByChromeId(o.tabId); if (!t) throw new Error('No tab with id: ' + o.tabId + '.'); wc = t.view.webContents; }
    const own = wc ? this.sidePanels.get(`${extId}:${wc.id}`) : null;
    const opts = own || this.sidePanels.get(`${extId}:*`) || {};
    if (opts.enabled === false) throw new Error('No active side panel for tabId: ' + o.tabId + '.');
    const url = this.panelUrl(ext, opts);
    if (!url) throw new Error('No active side panel for the given tabId or windowId.');
    let key;
    if (wc && own) {
      key = 'ext:tab:' + wc.id;
      if (o.toggle && this.tabPanels.has(wc.id)) { this.closePanel(key); return; }
      this.tabPanels.set(wc.id, { extId, url, name: ext.name });
    } else {
      key = this.winKey(extId);
      if (o.toggle && this.windowPanel?.extId === extId) { this.closePanel(key); return; }
      if (this.windowPanel && this.windowPanel.extId !== extId) this.getPanels()?.drop(this.winKey(this.windowPanel.extId));
      this.windowPanel = { extId, url, name: ext.name };
    }
    // The page starts loading now, as in Chrome, so the extension can talk to it straight away.
    this.getPanels()?.view(key);
    tabs?.changed();
    const t = wc ? tabs?.byContents(wc) : tabs?.active();
    this.emit('extpanel-open', { tabId: t?.id ?? null, key });
  }

  /** Closing a side panel ends its page, as in Chrome. */
  closePanel(key) {
    this.forgetPanel(key);
    this.getPanels()?.drop(key);
  }
  forgetPanel(key) {
    if (key.startsWith('ext:tab:')) this.tabPanels.delete(Number(key.slice(8)));
    else if (this.winKeyId(key) && this.windowPanel?.extId === this.winKeyId(key)) this.windowPanel = null;
    this.getTabs()?.changed();
  }

  // ---------- chrome.runtime.getContexts ----------

  docId(wcId) {
    let d = this.docIds.get(wcId);
    if (!d) { d = { contextId: randomUUID(), documentId: randomBytes(16).toString('hex').toUpperCase() }; this.docIds.set(wcId, d); }
    return d;
  }

  contexts(ext) {
    const list = [];
    const windowId = this.windowId();
    const origin = ext.url.replace(/\/$/, '');
    const add = (contextType, wc, tabId, win, loading) => {
      if (!wc || wc.isDestroyed()) return;
      // A panel that has only just been opened is still loading its page: report that page, as Chrome does.
      const documentUrl = wc.getURL() || loading || '';
      if (!documentUrl.startsWith(ext.url)) return;
      const d = this.docId(wc.id);
      list.push({ contextType, contextId: d.contextId, tabId, windowId: win, documentId: d.documentId, frameId: 0, documentUrl, documentOrigin: origin, incognito: false });
    };
    for (const [key, view] of this.getPanels()?.views || []) if (key.startsWith('ext:') && this.ownsKey(key)) add('SIDE_PANEL', view.webContents, key.startsWith('ext:tab:') ? Number(key.slice(8)) : -1, windowId, this.panelTarget(key)?.url);
    for (const t of this.getTabs()?.tabs || []) { const wc = liveContents(t); if (wc && this.mine(t)) add('TAB', wc, wc.id, windowId); }
    const off = this.offscreen?.get(ext.id);
    if (off && !off.isDestroyed()) add('OFFSCREEN_DOCUMENT', off.webContents, -1, -1);
    try {
      for (const [versionId, w] of Object.entries(this.ses.serviceWorkers.getAllRunning())) {
        if (!String(w.scope).startsWith(ext.url)) continue;
        const d = this.docId('sw' + versionId);
        list.push({ contextType: 'BACKGROUND', contextId: d.contextId, tabId: -1, windowId: -1, frameId: -1, documentUrl: w.scriptUrl, documentOrigin: origin, incognito: false });
      }
    } catch {}
    return list;
  }

  saveUserScripts() { if (!this.userScriptsFile) return; fs.writeFileSync(this.userScriptsFile, JSON.stringify(this.userScripts), { mode: 0o600 }); }

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
    // An install or update from the Web Store loads the extension itself; apply the user's settings to it.
    this.ses.extensions.on('extension-loaded', (_e, ext) => this.loadedElsewhere(ext));
    await installChromeWebStore({
      session: this.ses,
      extensionsPath: this.extensionsPath,
      // Lintas loads installed extensions itself, with each one's settings (turned off, file URLs, site access)
      loadExtensions: false,
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
    for (const { id, dir } of this.storeDirs()) {
      try { await this.loadOne(dir, 'store', id); } catch (e) { console.error('Could not load extension', id, e.message); }
    }
    for (const dir of this.unpackedDirs()) {
      try { await this.loadOne(dir, 'unpacked', this.idForPath(dir)); } catch (e) { console.error('Could not load unpacked extension', dir, e.message); }
    }
  }

  /** The instance for private tabs: same extensions folder, the private session, nothing saved to disk. */
  async startPrivate(ses) {
    if (this.owner || this.private) return this.private;
    const p = new Extensions({ ses, dataDir: path.dirname(this.unpackedFile), getWin: this.getWin, getTabs: this.getTabs, getPanels: this.getPanels, emit: this.emit, owner: this });
    p.installShims();
    this.private = p;
    for (const id of this.known.keys()) await this.syncPrivate(id);
    return p;
  }

  // ---------- per-extension settings ----------

  setting(id) {
    if (this.owner) return this.owner.setting(id);
    const s = (id && this.prefs[id]) || {};
    return { enabled: s.enabled !== false, fileAccess: !!s.fileAccess, private: !!s.private,
      siteAccess: s.siteAccess === 'sites' ? 'sites' : 'all', sites: Array.isArray(s.sites) ? s.sites.filter(x => typeof x === 'string') : [] };
  }

  savePrefs() { fs.writeFileSync(this.settingsFile, JSON.stringify(this.prefs, null, 1), { mode: 0o600 }); }

  idForPath(dir) {
    const p = path.resolve(dir);
    return Object.keys(this.prefs).find(id => this.prefs[id]?.path && path.resolve(this.prefs[id].path) === p) || null;
  }

  remember(id, dir, type) {
    this.known.set(id, { path: dir, type });
    if (this.owner) return;
    if (this.prefs[id]?.path !== dir) { this.prefs[id] = { ...(this.prefs[id] || {}), path: dir }; try { this.savePrefs(); } catch {} }
  }

  /** Web Store extensions on disk: Extensions/<id>/<version>_0/, the newest version of each. */
  storeDirs() {
    const out = [];
    let ids = [];
    try { ids = fs.readdirSync(this.extensionsPath).filter(x => ID.test(x)); } catch { return out; }
    const num = (v) => String(v).split(/[._]/).map(n => parseInt(n, 10) || 0);
    const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    for (const id of ids) {
      let best = null;
      for (const v of fs.readdirSync(path.join(this.extensionsPath, id))) {
        const dir = path.join(this.extensionsPath, id, v);
        if (fs.existsSync(path.join(dir, 'manifest.json')) && (!best || newer(v, path.basename(best)))) best = dir;
      }
      if (best) out.push({ id, dir: best });
    }
    return out;
  }

  /** "On specific sites": the manifest Electron loads keeps only those sites; the original is kept beside it. */
  applySiteAccess(dir, s) {
    const man = path.join(dir, 'manifest.json'), orig = path.join(dir, ORIGINAL_MANIFEST);
    if (s.siteAccess === 'sites') {
      if (!fs.existsSync(orig)) fs.copyFileSync(man, orig);
      fs.writeFileSync(man, JSON.stringify(restrictManifest(JSON.parse(fs.readFileSync(orig, 'utf8')), s.sites), null, 2));
    } else if (fs.existsSync(orig)) { fs.copyFileSync(orig, man); fs.rmSync(orig, { force: true }); }
  }

  originalManifest(dir) {
    for (const f of [ORIGINAL_MANIFEST, 'manifest.json']) { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {} }
    return null;
  }

  async loadOne(dir, type, id) {
    if (id) this.known.set(id, { path: dir, type });
    const s = this.setting(id);
    if (id && !s.enabled) return null;
    if (type === 'store' && id && !this.owner) this.applySiteAccess(dir, s);
    // Electron's "extension-loaded" for this load is ours (it can arrive after loadExtension resolves)
    this.loading.add(id || path.resolve(dir));
    let ext;
    try { ext = await this.ses.extensions.loadExtension(dir, { allowFileAccess: s.fileAccess }); }
    catch (e) { this.loading.delete(id || path.resolve(dir)); throw e; }
    if (!id) { this.loading.delete(path.resolve(dir)); }
    this.remember(ext.id, dir, type);
    if (!id && !this.setting(ext.id).enabled) { this.unload(ext.id); return null; }
    if (ext.manifest?.manifest_version === 3 && ext.manifest.background?.service_worker) {
      this.ses.serviceWorkers.startWorkerForScope(ext.url).catch(() => {});
    }
    if (!this.owner) await this.syncPrivate(ext.id);
    return ext;
  }

  /** A Web Store install or update loaded an extension: apply the user's settings to it. */
  loadedElsewhere(ext) {
    if (this.loading.delete(ext.id) || this.loading.delete(path.resolve(ext.path))) return;
    const type = this.known.get(ext.id)?.type || (ext.manifest?.key ? 'store' : 'unpacked');
    this.remember(ext.id, ext.path, type);
    const s = this.setting(ext.id);
    if (!s.enabled || s.fileAccess || s.siteAccess === 'sites') setTimeout(() => this.reload(ext.id).catch(e => console.error('Could not apply extension settings', e.message)), 0);
  }

  /** Ends an extension's pages and panels and unloads it; its files and data stay. */
  unload(id) {
    for (const [wcId, p] of [...this.tabPanels]) if (p.extId === id) this.closePanel('ext:tab:' + wcId);
    if (this.windowPanel?.extId === id) this.closePanel(this.winKey(id));
    if (this.ses.extensions.getExtension(id)) this.ses.extensions.removeExtension(id);
    if (this.private) this.private.unload(id);
  }

  /** Runs the extension in private tabs too, or stops it there, as its settings say. */
  async syncPrivate(id) {
    const p = this.private;
    const k = this.known.get(id);
    if (!p || !k) return;
    const s = this.setting(id);
    const want = s.enabled && s.private && !!this.ses.extensions.getExtension(id);
    p.unload(id);
    if (want) { try { await p.loadOne(k.path, k.type, id); } catch (e) { console.error('Could not run extension in private tabs', id, e.message); } }
  }

  async reload(id) {
    const k = this.known.get(id);
    if (!k) return;
    this.unload(id);
    await this.loadOne(k.path, k.type, id);
  }

  /** Changes an extension's settings, as on Chrome's details page, and reloads it if needed. */
  async setSettings(id, patch = {}) {
    const k = this.known.get(id);
    if (!k) throw new Error('No such extension.');
    const before = this.setting(id);
    const next = { ...before };
    for (const key of ['enabled', 'fileAccess', 'private']) if (key in patch) next[key] = !!patch[key];
    if ('siteAccess' in patch) next.siteAccess = patch.siteAccess === 'sites' ? 'sites' : 'all';
    if ('sites' in patch) {
      const bad = (patch.sites || []).filter(x => !normalizeSite(x));
      if (bad.length) throw new Error(`Not a site: ${bad[0]}. Use a name such as example.com or *.example.com.`);
      next.sites = [...new Set((patch.sites || []).map(normalizeSite))];
    }
    if (k.type !== 'store' && (next.siteAccess !== 'all')) throw new Error('Site access can be limited for Chrome Web Store extensions. An unpacked extension uses the sites in its own manifest.');
    this.prefs[id] = { ...(this.prefs[id] || {}), ...next, path: k.path };
    this.savePrefs();
    const sitesChanged = next.siteAccess !== before.siteAccess || (next.siteAccess === 'sites' && next.sites.join() !== before.sites.join());
    if (!next.enabled) this.unload(id);
    else if (!before.enabled || next.fileAccess !== before.fileAccess || sitesChanged) await this.reload(id);
    else if (next.private !== before.private) await this.syncPrivate(id);
    return this.list().find(x => x.id === id) || null;
  }

  addTab(wc) {
    this.api.addTab(wc, this.getWin());
    this.attachUserScripts(wc);
    const id = wc.id;
    // A closed tab takes its side panel with it, and leaves its group.
    wc.once('destroyed', () => {
      if (this.tabPanels.has(id)) this.closePanel('ext:tab:' + id);
      setTimeout(() => { for (const g of [...this.groups.keys()]) this.pruneGroup(g); }, 0);
    });
  }
  selectTab(wc) { try { this.api.selectTab(wc); } catch {} }

  unpackedDirs() {
    try { return JSON.parse(fs.readFileSync(this.unpackedFile, 'utf8')).filter(d => typeof d === 'string'); } catch { return []; }
  }

  saveUnpacked(dirs) { fs.writeFileSync(this.unpackedFile, JSON.stringify(dirs), { mode: 0o600 }); }

  list() {
    const unpacked = new Set(this.unpackedDirs().map(d => path.resolve(d)));
    const out = [];
    const ids = new Set([...this.ses.extensions.getAllExtensions().map(e => e.id), ...this.known.keys()]);
    for (const id of ids) {
      const e = this.ses.extensions.getExtension(id);
      const dir = e?.path || this.known.get(id)?.path;
      if (!dir || !fs.existsSync(dir)) continue;
      const m = this.originalManifest(dir) || e?.manifest || {};
      const store = this.known.get(id)?.type === 'store' || (!unpacked.has(path.resolve(dir)) && !!m.key);
      const options = m.options_ui?.page || m.options_page;
      out.push({
        id, name: e?.name || localName(dir, m, m.name) || id, version: e?.version || m.version || '',
        description: localName(dir, m, m.description) || '',
        manifestVersion: m.manifest_version || null,
        source: store ? 'store' : 'unpacked',
        loaded: !!e,
        optionsUrl: e && options ? `${e.url}${options}` : null,
        permissions: [...(m.permissions || []), ...(m.host_permissions || [])].map(String),
        ...this.setting(id),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
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
    const ext = await this.loadOne(dir, 'unpacked', this.idForPath(dir));
    this.saveUnpacked([...new Set([...this.unpackedDirs(), dir])]);
    return ext ? { id: ext.id, name: ext.name } : null;
  }

  async remove(id) {
    const ext = this.ses.extensions.getExtension(id);
    const dir = ext?.path || this.known.get(id)?.path;
    if (!dir) return;
    this.unload(id);
    const dirs = this.unpackedDirs();
    if (dirs.some(d => path.resolve(d) === path.resolve(dir))) {
      this.saveUnpacked(dirs.filter(d => path.resolve(d) !== path.resolve(dir)));
    } else {
      await uninstallExtension(id, { session: this.ses, extensionsPath: this.extensionsPath });
    }
    this.known.delete(id);
    delete this.prefs[id];
    try { this.savePrefs(); } catch {}
  }
}

/** A manifest string that may be "__MSG_name__", read from the extension's default locale. */
function localName(dir, m, value) {
  const k = /^__MSG_(.+)__$/.exec(String(value || ''))?.[1];
  if (!k) return value || '';
  for (const loc of [m.default_locale, 'en'].filter(Boolean)) {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8'));
      const hit = Object.entries(msgs).find(([n]) => n.toLowerCase() === k.toLowerCase());
      if (hit) return hit[1].message || '';
    } catch {}
  }
  return '';
}
