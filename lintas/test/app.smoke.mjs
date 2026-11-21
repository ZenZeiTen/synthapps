// End-to-end smoke test: launches the real Electron app (under Xvfb on Linux)
// and exercises the window.lintas contract and real browsing.
import { createRequire } from 'node:module';
const { _electron: electron } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-e2e-'));
// A fake Chrome profile for "Import from another browser"
const importHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-e2e-home-'));
const chromeProfile = path.join(importHome, '.config', 'google-chrome', 'Default');
fs.mkdirSync(chromeProfile, { recursive: true });
fs.writeFileSync(path.join(chromeProfile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Imported KBBI', url: 'https://kbbi.kemdikbud.go.id/' }, { type: 'folder', name: 'Klien', children: [{ type: 'url', name: 'Client portal', url: 'https://client.example/' }] }] }, other: { type: 'folder', children: [] } } }));
fs.writeFileSync(path.join(chromeProfile, 'Preferences'), JSON.stringify({ default_search_provider_data: { template_url_data: { keyword: 'bing.com' } } }));
// A small MV3 extension (content script + toolbar action), loaded as an unpacked extension.
fs.writeFileSync(path.join(dataDir, 'unpacked-extensions.json'), JSON.stringify([path.resolve(import.meta.dirname, 'fixtures/hello-ext')]));

function mcpCall(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.resolve(import.meta.dirname, '../app/mcp/server.cjs')], { env: { ...process.env, LINTAS_DATA_DIR: dataDir } });
    let out = '';
    p.stdout.on('data', d => { out += d; if (out.includes('\n')) p.stdin.end(); });
    p.on('close', () => { try { const r = JSON.parse(out.split('\n')[0]).result; r.isError ? reject(new Error(r.content[0].text)) : resolve(JSON.parse(r.content[0].text)); } catch (e) { reject(e); } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }) + '\n');
  });
}
const site = http.createServer((req, res) => {
  if (req.url.startsWith('/track')) { res.end('x'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><title>Test page</title><body><h1>Settings guide</h1>
  <p>Open the settings page to change your password.</p><p>Save your work before you close the app.</p>
  <script src="https://www.google-analytics.com/analytics.js"></script></body></html>`);
}).listen(0);
const port = site.address().port;
const shots = process.env.LINTAS_SHOTS;

// LINTAS_TEST_SANDBOX=1 runs with Chromium's sandbox (needs a non-root user). Only then do
// extension service workers get the extra chrome.* APIs (electron/electron#54322).
const SANDBOX = process.env.LINTAS_TEST_SANDBOX === '1';
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  // Launched the way Windows opens a link once Lintas is the default browser: Lintas.exe -- "<url>"
  args: [...(SANDBOX ? ['.'] : ['.', '--no-sandbox']), '--', `http://127.0.0.1:${port}/?from=os`],
  chromiumSandbox: SANDBOX,
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, LINTAS_DATA_DIR: dataDir, LINTAS_IMPORT_HOME: importHome },
});
const log = [];
try {
  // Tabs are pages too, so wait for the browser window itself rather than the first page
  const isMain = (p) => p.url().startsWith('lintas-ui://app/index.html');
  let win = null;
  for (const end = Date.now() + 30000; !win && Date.now() < end; await new Promise(r => setTimeout(r, 200))) win = app.windows().find(isMain) || null;
  assert.ok(win, 'browser window not found: ' + app.windows().map(p => p.url()).join(', '));
  win.on('console', m => { if (m.type() === 'error') log.push(m.text()); });
  win.on('pageerror', e => log.push('pageerror: ' + e.message));
  await win.waitForFunction(() => !!window.lintas, null, { timeout: 15000 });
  const L = (fn, ...a) => win.evaluate(fn, ...a);

  const st = await L(() => lintas.app.status());
  assert.equal(st.hasApiKey, false);
  assert.ok(st.models.length >= 3);
  assert.equal(st.sandbox, SANDBOX);

  // A link passed on the command line opens in a tab
  await win.waitForFunction(u => lintas.tabs.list().then(ts => ts.some(t => t.url === u)), `http://127.0.0.1:${port}/?from=os`, { timeout: 15000, polling: 300 });

  // Browsing
  let tabsNow = await L(() => lintas.tabs.list());
  const tabId = tabsNow.find(t => t.active).id;
  await L(([id, url]) => lintas.nav.go(id, url), [tabId, `http://127.0.0.1:${port}/`]);
  await win.waitForFunction(id => lintas.tabs.list().then(ts => { const t = ts.find(x => x.id === id); window.__t = t; return t.title === 'Test page' && !t.loading; }), tabId, { timeout: 15000, polling: 300 });
  await new Promise(r => setTimeout(r, 3000));
  const t1 = await L(([id]) => lintas.tabs.list().then(ts => ts.find(x => x.id === id)), [tabId]);
  assert.equal(t1.security, 'insecure');
  assert.equal(t1.blocked, 1, 'the analytics script should be blocked');
  // Chrome extension: listed, content script ran, toolbar button shown
  const exts = await L(() => lintas.extensions.list());
  assert.ok(exts.some(e => e.name === 'Lintas test extension'), JSON.stringify(exts));
  await win.waitForFunction(() => { const el = document.querySelector('browser-action-list'); return !!customElements.get('browser-action-list') && el?.shadowRoot?.querySelectorAll('.action, button').length > 0; }, null, { timeout: 15000, polling: 300 });
  // The extension's background worker answered its content script
  const sw = await app.evaluate(async ({ webContents }, url) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === url);
    for (let i = 0; wc && i < 75; i++) {
      const v = await wc.executeJavaScript('document.documentElement.dataset.lintasSw || ""');
      if (v) return JSON.parse(v);
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  }, `http://127.0.0.1:${port}/`);
  assert.ok(sw && !sw.error, 'background worker reply: ' + JSON.stringify(sw));
  if (SANDBOX) {
    for (const k of ['windows', 'contextMenus', 'identity', 'pageCapture', 'userScripts', 'sidePanel', 'offscreen', 'debugger', 'alarms', 'tabGroups']) assert.equal(sw[k], 'object', k + ': ' + JSON.stringify(sw));
    assert.equal(sw.alarm, 'tick');
    assert.equal(sw.debugger1plus1, 2);
    assert.equal(sw.groupColor, 'blue');
    assert.match(sw.redirect, /^https:\/\/[a-p]{32}\.chromiumapp\.org\/cb$/);
    assert.equal(sw.capture, 'data:image/jpeg;base64,');
    assert.equal(sw.mhtml, 'multipart/related');
  }

  // Closing a tab that has no web view (an internal page) while another internal page is active
  const i1 = await L(() => lintas.tabs.create({ url: 'lintas://settings' }));
  const i2 = await L(() => lintas.tabs.create({ url: 'lintas://extensions' }));
  assert.equal((await L(() => lintas.tabs.list())).find(t => t.id === i2.id).title, 'Extensions');
  await L(id => lintas.tabs.close(id), i1.id);
  await L(id => lintas.tabs.close(id), i2.id);
  await L(id => lintas.tabs.activate(id), tabId);

  // Sign-in popups: a sized window.open becomes a real popup that keeps window.opener, so a
  // provider on another origin can hand its result back (Google, Microsoft and Apple sign-in)
  const idp = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>Provider</title><script>window.opener && window.opener.postMessage("signed-in:" + navigator.userAgent.includes("Chrome"), "*"); setTimeout(() => window.close(), 300);</script>'); }).listen(0);
  await L(([id, u]) => lintas.nav.go(id, u), [tabId, `http://127.0.0.1:${port}/`]);
  await win.waitForFunction(id => lintas.tabs.list().then(ts => !ts.find(x => x.id === id).loading), tabId, { timeout: 15000, polling: 300 });
  const tabCount = (await L(() => lintas.tabs.list())).length;
  const popupResult = await app.evaluate(async ({ webContents, BrowserWindow }, [pageUrl, idpUrl]) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL() === pageUrl);
    await wc.executeJavaScript(`window.__got = new Promise(r => addEventListener('message', e => r(e.data))); window.open(${JSON.stringify(idpUrl)}, 'signin', 'width=480,height=600'); 1`, true);
    const got = await Promise.race([wc.executeJavaScript('window.__got', true), new Promise(r => setTimeout(() => r('timeout'), 10000))]);
    await new Promise(r => setTimeout(r, 1200));
    return { got, windows: BrowserWindow.getAllWindows().length };
  }, [`http://127.0.0.1:${port}/`, `http://localhost:${idp.address().port}/oauth`]);
  idp.close();
  assert.equal(popupResult.got, 'signed-in:true', JSON.stringify(popupResult));
  assert.equal(popupResult.windows, 1, 'the popup closed itself');
  assert.equal((await L(() => lintas.tabs.list())).length, tabCount, 'a sized popup does not open a tab');

  // Import from another browser
  const browsers = await L(() => lintas.importer.detect());
  assert.deepEqual(browsers.map(b => b.id), ['chrome'], JSON.stringify(browsers));
  const imp = await L(() => lintas.importer.run({ browserId: 'chrome', profileId: 'Default' }));
  assert.equal(imp.bookmarks, 2, JSON.stringify(imp));
  assert.deepEqual(imp.settings, ['searchEngine']);
  const bms = await L(() => lintas.bookmarks.list());
  assert.ok(bms.some(b => b.title === 'Client portal' && b.folder === 'Klien'), JSON.stringify(bms));
  assert.equal((await L(() => lintas.settings.get())).searchEngine, 'bing');
  assert.equal((await L(() => lintas.importer.run({ browserId: 'chrome', profileId: 'Default' }))).bookmarks, 0, 'a second import adds nothing');
  await L(() => lintas.settings.set({ searchEngine: 'duckduckgo' }));

  // Minimize to the notification area: the setting creates the tray icon without errors
  await L(() => lintas.settings.set({ minimizeToTray: true }));
  await L(() => lintas.settings.set({ minimizeToTray: false }));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);

  // Claude Desktop route: turn access on, then use the real MCP server
  await L(() => lintas.settings.set({ claudeDesktop: true }));
  const mcpTabs = await mcpCall('browser_list_tabs');
  assert.ok(mcpTabs.tabs.some(t => t.title === 'Test page'), JSON.stringify(mcpTabs));
  const read = await mcpCall('browser_read_page', { tabId });
  const readText = read.paragraphs.map(p => p.text).join(' ');
  assert.match(readText, /Open the settings page/);
  assert.match(readText, /Added by a Chrome extension/);
  const projects = await mcpCall('tms_list_projects');
  assert.ok(projects.projects.length >= 1);
  await L(() => lintas.settings.set({ claudeDesktop: false }));
  await assert.rejects(mcpCall('lintas_status'), /Claude Desktop access/);

  const hist = await L(() => lintas.history.list({}));
  assert.equal(hist[0].title, 'Test page');

  // In-page translation from the TM only (no API key needed when every text node has a 100 % match)
  const tp = await L(() => lintas.tms.createProject({ name: 'Page', sourceLang: 'en', targetLang: 'id' }));
  const tf = await L(([pid]) => lintas.tms.importText(pid, { name: 'p.txt', text: 'Settings guide\n\nOpen the settings page to change your password.\n\nSave your work before you close the app.\n\nTest page\n\nAdded by a Chrome extension.' }), [tp.id]);
  const tsegs = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [tp.id, tf.id])).segments;
  const tgt = ['Panduan pengaturan', 'Buka halaman pengaturan untuk mengubah kata sandi Anda.', "Simpan pekerjaan Anda sebelum menutup aplikasi. ');alert(1);('", 'Halaman uji', 'Ditambahkan oleh ekstensi Chrome.'];
  for (let k = 0; k < tsegs.length; k++) await L(([pid, fid, sid, t]) => lintas.tms.updateSegment(pid, fid, sid, { target: t, status: 'translated' }), [tp.id, tf.id, tsegs[k].id, tgt[k]]);
  const tr = await L(([id, pid]) => lintas.ai.translatePage(id, { targetLang: 'id', projectId: pid }), [tabId, tp.id]);
  assert.equal(tr.fromAi, 0);
  assert.ok(tr.fromTm >= 3, JSON.stringify(tr));
  const cap = await L(([id, pid]) => lintas.tms.capturePage(id, pid), [tabId, tp.id]);
  const capSegs = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [tp.id, cap.id])).segments.map(x => x.source);
  assert.ok(capSegs.includes('Buka halaman pengaturan untuk mengubah kata sandi Anda.'), capSegs.join(' | '));
  assert.ok(capSegs.some(x => x.includes("');alert(1);('")), 'quotes in translations stay text');
  await L(([id]) => lintas.ai.restorePage(id), [tabId]);
  const cap2 = await L(([id, pid]) => lintas.tms.capturePage(id, pid), [tabId, tp.id]);
  const back = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [tp.id, cap2.id])).segments.map(x => x.source);
  assert.ok(back.includes('Open the settings page to change your password.'), back.join(' | '));

  // Offline library
  const saved = await L(id => lintas.offline.save(id), tabId);
  assert.ok(saved.bytes > 100 && saved.words >= 10, JSON.stringify(saved));
  const lib = await L(() => lintas.offline.list({}));
  await L(([id]) => lintas.offline.open(id, { newTab: true }), [lib[0].id]);
  await win.waitForFunction(() => lintas.tabs.list().then(ts => ts.some(t => t.security === 'offline-copy' && !t.loading)), null, { timeout: 15000, polling: 300 });

  // Navigation errors keep the offline copy offer
  site.close();
  await L(([id, url]) => lintas.nav.go(id, url), [tabId, `http://127.0.0.1:${port}/`]);
  await win.waitForFunction(id => lintas.tabs.list().then(ts => { const t = ts.find(x => x.id === id); return t.error && t.offlineCopy; }), tabId, { timeout: 15000, polling: 300 });

  // TMS through IPC
  const p = await L(() => lintas.tms.createProject({ name: 'Website', sourceLang: 'en', targetLang: 'id' }));
  const f = await L(([pid]) => lintas.tms.importText(pid, { name: 'ui.txt', text: 'Open the settings page. Save your work.' }), [p.id]);
  const file = await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [p.id, f.id]);
  await L(([pid, fid, sid]) => lintas.tms.updateSegment(pid, fid, sid, { target: 'Buka halaman pengaturan.', status: 'translated' }), [p.id, f.id, file.segments[0].id]);
  const look = await L(([pid]) => lintas.tms.lookup(pid, 'Open the settings page.'), [p.id]);
  assert.equal(look.matches[0].score, 100);
  const an = await L(([pid]) => lintas.tms.analyze(pid), [p.id]);
  assert.equal(an.bands.length, 8);
  await assert.rejects(L(([pid, fid, sid]) => lintas.ai.suggest(pid, fid, sid), [p.id, f.id, file.segments[1].id]), /API key|offline/);

  // Omnibox
  const sug = await L(() => lintas.omnibox.suggest('test'));
  assert.ok(sug.length >= 1);

  // Settings round trip; the key is validated and never returned
  await assert.rejects(L(() => lintas.settings.setApiKey('not-a-key')), /does not look like/);
  const s = await L(() => lintas.settings.set({ httpsOnly: true }));
  assert.equal(s.httpsOnly, true);

  if (shots) await win.screenshot({ path: path.join(shots, 'e2e-window.png') });
  console.log('E2E OK');
  if (log.length) console.log('Renderer console errors:\n' + log.join('\n'));
} finally {
  await app.close();
  site.close();
}
