// End-to-end smoke test: launches the real Electron app (under Xvfb on Linux)
// and exercises the window.lintas contract and real browsing.
import { createRequire } from 'node:module';
const { _electron: electron } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-e2e-'));
const site = http.createServer((req, res) => {
  if (req.url.startsWith('/track')) { res.end('x'); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><title>Test page</title><body><h1>Settings guide</h1>
  <p>Open the settings page to change your password.</p><p>Save your work before you close the app.</p>
  <script src="https://www.google-analytics.com/analytics.js"></script></body></html>`);
}).listen(0);
const port = site.address().port;
const shots = process.env.LINTAS_SHOTS;

const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: ['.', '--no-sandbox'],
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, LINTAS_DATA_DIR: dataDir },
});
const log = [];
try {
  const win = await app.firstWindow();
  win.on('console', m => { if (m.type() === 'error') log.push(m.text()); });
  win.on('pageerror', e => log.push('pageerror: ' + e.message));
  await win.waitForFunction(() => !!window.lintas, null, { timeout: 15000 });
  const L = (fn, ...a) => win.evaluate(fn, ...a);

  const st = await L(() => lintas.app.status());
  assert.equal(st.hasApiKey, false);
  assert.ok(st.models.length >= 3);

  // Browsing
  let tabsNow = await L(() => lintas.tabs.list());
  const tabId = tabsNow.find(t => t.active).id;
  await L(([id, url]) => lintas.nav.go(id, url), [tabId, `http://127.0.0.1:${port}/`]);
  await win.waitForFunction(id => lintas.tabs.list().then(ts => { const t = ts.find(x => x.id === id); window.__t = t; return t.title === 'Test page' && !t.loading; }), tabId, { timeout: 15000, polling: 300 });
  await new Promise(r => setTimeout(r, 3000));
  const t1 = await L(([id]) => lintas.tabs.list().then(ts => ts.find(x => x.id === id)), [tabId]);
  assert.equal(t1.security, 'insecure');
  assert.equal(t1.blocked, 1, 'the analytics script should be blocked');
  const hist = await L(() => lintas.history.list({}));
  assert.equal(hist[0].title, 'Test page');

  // In-page translation from the TM only (no API key needed when every text node has a 100 % match)
  const tp = await L(() => lintas.tms.createProject({ name: 'Page', sourceLang: 'en', targetLang: 'id' }));
  const tf = await L(([pid]) => lintas.tms.importText(pid, { name: 'p.txt', text: 'Settings guide\n\nOpen the settings page to change your password.\n\nSave your work before you close the app.\n\nTest page' }), [tp.id]);
  const tsegs = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [tp.id, tf.id])).segments;
  const tgt = ['Panduan pengaturan', 'Buka halaman pengaturan untuk mengubah kata sandi Anda.', "Simpan pekerjaan Anda sebelum menutup aplikasi. ');alert(1);('", 'Halaman uji'];
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
