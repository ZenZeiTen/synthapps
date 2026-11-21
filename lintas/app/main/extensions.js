// Chrome extension support for normal (non-private) tabs:
// - chrome.* APIs beyond Electron's built-ins (action, tabs, windows, contextMenus…)
//   through electron-chrome-extensions;
// - installing from the Chrome Web Store ("Add to Chrome" on chromewebstore.google.com)
//   and automatic updates through electron-chrome-web-store;
// - loading unpacked extensions from a folder (developer mode).
import path from 'node:path';
import fs from 'node:fs';
import { dialog, session as electronSession } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { installChromeWebStore, installExtension, uninstallExtension } from 'electron-chrome-web-store';

const ID = /^[a-p]{32}$/;

export class Extensions {
  constructor({ ses, dataDir, getWin, getTabs }) {
    this.ses = ses;
    this.getWin = getWin;
    this.getTabs = getTabs;
    this.extensionsPath = path.join(dataDir, 'Extensions');
    this.unpackedFile = path.join(dataDir, 'unpacked-extensions.json');
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

  async init() {
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

  addTab(wc) { this.api.addTab(wc, this.getWin()); }
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
