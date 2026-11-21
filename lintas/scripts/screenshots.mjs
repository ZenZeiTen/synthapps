// Captures the "Under the hood" screenshots in docs/screenshots from the real app: real tracker
// blocking, page translation from the TM, the CAT editor, analysis, extensions, Claude Desktop and offline.
// Needs Playwright and ImageMagick (convert). Run as a normal user so Chromium's sandbox is on:
//   xvfb-run -a -s "-screen 0 3200x2000x24" node scripts/screenshots.mjs "$PWD" docs/screenshots
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [ROOT, OUT] = process.argv.slice(2);
const require = createRequire(path.join(ROOT, 'package.json'));
const { _electron: electron } = require('playwright');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-shots-'));
const dataDir = path.join(tmp, 'data'), home = path.join(tmp, 'home');
fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'unpacked-extensions.json'), JSON.stringify([path.join(ROOT, 'test/fixtures/hello-ext')]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- a small, realistic help-centre site, with the usual trackers ----
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payment links · Northwind Pay</title>
<style>
 body{margin:0;font:16px/1.6 system-ui,"Segoe UI",Roboto,sans-serif;color:#1d2433;background:#f6f7fb}
 header{display:flex;align-items:center;gap:28px;padding:18px 56px;background:#14213d;color:#fff}
 header b{font-size:19px;letter-spacing:.2px} nav{display:flex;gap:22px;opacity:.85}
 main{max-width:760px;margin:40px auto;padding:36px 44px;background:#fff;border-radius:14px;box-shadow:0 2px 14px #0001}
 h1{font-size:32px;margin:0 0 14px} h2{font-size:22px;margin:28px 0 8px} p{margin:0 0 12px}
 .tag{display:inline-block;font-size:13px;font-weight:600;color:#7a4b00;background:#fff1d6;border-radius:99px;padding:2px 12px;margin-bottom:12px}
 button{font:inherit;margin-top:18px;background:#fca311;border:0;border-radius:10px;padding:10px 20px;font-weight:600}
</style>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X1"></script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<script src="https://static.doubleclick.net/instream/ad_status.js"></script>
<script src="https://bat.bing.com/bat.js"></script>
<script src="https://static.hotjar.com/c/hotjar-1.js"></script>
</head><body>
<header><b>Northwind Pay</b><nav><span>Home</span><span>Payments</span><span>Payouts</span><span>Help center</span></nav></header>
<main>
<span class="tag">Help center</span>
<h1>Payment links</h1>
<p>Create a payment link to get paid without a website.</p>
<p>Share the link by email, chat or a QR code.</p>
<p>Customers pay with a card, a bank transfer or an e-wallet.</p>
<h2>Refunds</h2>
<p>You can refund a payment within 30 days.</p>
<p>Refunds usually reach the customer in 3 to 5 business days.</p>
<button>Contact support</button>
</main>
<img src="https://www.facebook.com/tr?id=1&ev=PageView" width="1" height="1" alt="">
</body></html>`;
const PAIRS = [
  ['Northwind Pay', 'Northwind Pay'], ['Home', 'Beranda'], ['Payments', 'Pembayaran'], ['Payouts', 'Pencairan'], ['Help center', 'Pusat bantuan'],
  ['Payment links', 'Tautan pembayaran'],
  ['Create a payment link to get paid without a website.', 'Buat tautan pembayaran untuk menerima pembayaran tanpa situs web.'],
  ['Share the link by email, chat or a QR code.', 'Bagikan tautan lewat email, chat, atau kode QR.'],
  ['Customers pay with a card, a bank transfer or an e-wallet.', 'Pelanggan membayar dengan kartu, transfer bank, atau dompet digital.'],
  ['Refunds', 'Pengembalian dana'],
  ['You can refund a payment within 30 days.', 'Anda dapat mengembalikan dana pembayaran dalam 30 hari.'],
  ['Refunds usually reach the customer in 3 to 5 business days.', 'Pengembalian dana biasanya sampai ke pelanggan dalam 3 sampai 5 hari kerja.'],
  ['Contact support', 'Hubungi dukungan'],
];
let up = true;
const site = http.createServer((req, res) => {
  if (!up) { req.socket.destroy(); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE);
}).listen(0);
const port = site.address().port;
const PAGE_URL = `http://localhost:${port}/help/payment-links`;

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['--force-device-scale-factor=2', '.', ...(process.getuid() === 0 ? ['--no-sandbox'] : [])],
  chromiumSandbox: process.getuid() !== 0,
  cwd: ROOT,
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), LINTAS_DATA_DIR: dataDir },
});
try {
  const isMain = (p) => p.url().startsWith('lintas-ui://app/index.html');
  let win = null;
  for (let i = 0; i < 150 && !win; i++) { win = app.windows().find(isMain) || null; if (!win) await sleep(200); }
  await win.waitForFunction(() => !!window.lintas);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
  const L = (fn, ...a) => win.evaluate(fn, ...a);
  await L(() => lintas.settings.set({ theme: 'light' }));
  await sleep(1500);

  // Window + every visible tab view, composited as the user sees them
  async function shot(name) {
    await sleep(700);
    const parts = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const out = [{ x: 0, y: 0, png: (await w.webContents.capturePage()).toPNG().toString('base64') }];
      for (const v of w.contentView.children) {
        if (!v.webContents || v.webContents === w.webContents) continue;
        if (typeof v.getVisible === 'function' && !v.getVisible()) continue;
        const b = v.getBounds(); if (b.width < 2 || b.height < 2) continue;
        out.push({ x: b.x, y: b.y, png: (await v.webContents.capturePage()).toPNG().toString('base64') });
      }
      return { parts: out, width: w.getContentSize()[0] };
    });
    const files = parts.parts.map((p, i) => { const f = path.join(tmp, `${name}-${i}.png`); fs.writeFileSync(f, Buffer.from(p.png, 'base64')); return { ...p, f }; });
    const basePx = Buffer.from(parts.parts[0].png, 'base64').readUInt32BE(16);
    const k = basePx / parts.width;
    const args = [files[0].f];
    for (const p of files.slice(1)) args.push(p.f, '-geometry', `+${Math.round(p.x * k)}+${Math.round(p.y * k)}`, '-composite');
    args.push(path.join(OUT, name + '.png'));
    execFileSync('convert', args);
    console.log('wrote', name, `(${parts.parts.length - 1} tab view${parts.parts.length === 2 ? '' : 's'})`);
  }
  const activeTab = async () => (await L(() => lintas.tabs.list())).find(t => t.active);
  const goInternal = async (url) => { const t = await activeTab(); await L(([id, u]) => lintas.nav.go(id, u), [t.id, url]); await sleep(1200); };

  // 1. Tracker blocking on a real page load
  let t = await activeTab();
  await L(([id, u]) => lintas.nav.go(id, u), [t.id, PAGE_URL]);
  await win.waitForFunction(id => lintas.tabs.list().then(ts => { const x = ts.find(y => y.id === id); return x && !x.loading && x.title.includes('Northwind'); }), t.id, { timeout: 20000, polling: 300 });
  await sleep(2500);
  t = await activeTab();
  console.log('trackers blocked:', t.blocked);
  await shot('tech-tracker-blocking');

  // 2. TM: project, translated file, terms
  const p = await L(() => lintas.tms.createProject({ name: 'Northwind Pay · Help center', sourceLang: 'en', targetLang: 'id', client: 'Northwind Pay' }));
  const f1 = await L(([pid, text]) => lintas.tms.importText(pid, { name: 'payment-links.html', text }), [p.id, PAIRS.map(x => x[0]).join('\n\n')]);
  const segs1 = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [p.id, f1.id])).segments;
  for (const s of segs1) {
    const pair = PAIRS.find(x => x[0] === s.source);
    if (pair) await L(([pid, fid, sid, tgt]) => lintas.tms.updateSegment(pid, fid, sid, { target: tgt, status: 'approved' }), [p.id, f1.id, s.id, pair[1]]);
  }
  const tb = p.termbaseIds[0];
  for (const term of [
    { source: 'payment link', target: 'tautan pembayaran', status: 'preferred', note: 'Product name in the dashboard' },
    { source: 'refund', target: 'pengembalian dana', status: 'preferred' },
    { source: 'e-wallet', target: 'dompet digital', status: 'preferred' },
    { source: 'payout', target: 'pencairan', status: 'preferred' },
    { source: 'refund', target: 'refund', status: 'forbidden', note: 'Do not borrow the English word' },
  ]) await L(([id, x]) => lintas.tms.addTerm(id, x), [tb, term]);

  // 3. In-page translation from the TM alone (no AI, no network), through the side panel
  await win.click('button[title="Translate this page"]');
  await sleep(800);
  await win.selectOption('select[aria-label="Target language"]', 'id');
  await win.selectOption('select[aria-label="Project"]', p.id);
  await win.click('.sp-section button.btn.primary');
  try { await win.waitForFunction(() => /This page is shown in Indonesian/.test(document.body.innerText), null, { timeout: 20000 }); }
  catch (e) { console.log('PANEL:', await win.evaluate(() => [...document.querySelectorAll('.sp-section')].map(x => x.innerText).join(' || ').slice(0, 900))); await shot('debug'); throw e; }
  await shot('tech-page-translation-tm');
  await L(([id]) => lintas.ai.restorePage(id), [t.id]);
  await win.click('button[title*="side panel" i], button[aria-label*="side panel" i]').catch(() => {});

  // 4. CAT editor: fuzzy matches with diffs, termbase hits, QA
  const f2 = await L(([pid]) => lintas.tms.importText(pid, { name: 'help-center-update.html', text: [
    'Create a payment link to get paid without an online store.',
    'You can refund a payment within 60 days.',
    'Share the link by email or a QR code.',
    'Payouts reach your bank account every business day.',
    'Customers pay with a card or an e-wallet.',
  ].join('\n\n') }), [p.id]);
  const segs2 = (await L(([pid, fid]) => lintas.tms.getFile(pid, fid, {}), [p.id, f2.id])).segments;
  await L(([pid, fid, sid]) => lintas.tms.updateSegment(pid, fid, sid, { target: 'Anda dapat melakukan refund pembayaran dalam 30 hari.', status: 'translated' }), [p.id, f2.id, segs2[1].id]);
  await L(([pid, fid, sid]) => lintas.tms.updateSegment(pid, fid, sid, { target: 'Bagikan tautan lewat email atau kode QR.', status: 'reviewed' }), [p.id, f2.id, segs2[2].id]);
  const tabEd = await L(() => lintas.tabs.create({ url: 'lintas://tms' }));
  await sleep(500);
  await goInternal(`lintas://tms/file/${encodeURIComponent(p.id)}/${encodeURIComponent(f2.id)}`);
  await sleep(1500);
  await shot('tech-cat-editor');

  // 5. Project overview: match-band analysis and QA
  await goInternal(`lintas://tms/project/${encodeURIComponent(p.id)}`);
  await sleep(1200);
  await win.click('button:has-text("Analyze")');
  await sleep(1500);
  await shot('tech-tms-project');
  await win.keyboard.press('Escape'); await sleep(500);

  // 6. Chrome extensions
  await goInternal('lintas://extensions');
  await shot('tech-chrome-extensions');

  // 7. Claude Desktop (MCP), in dark mode
  await L(() => lintas.settings.set({ theme: 'dark', claudeDesktop: true }));
  await L(() => lintas.claude.connect());
  await goInternal('lintas://settings');
  await win.click('button[data-sec="claude"]');
  await sleep(800);
  await shot('tech-claude-desktop-mcp');

  // 8. Offline: save, lose the network, get the saved copy offered
  await L(() => lintas.settings.set({ theme: 'light' }));
  const t2 = await L(([u]) => lintas.tabs.create({ url: u }), [PAGE_URL]);
  await sleep(3000);
  const tid = (await activeTab()).id;
  await L(id => lintas.offline.save(id), tid);
  up = false; site.closeAllConnections?.();
  await L(id => lintas.nav.reload(id), tid);
  await sleep(4000);
  await shot('tech-offline-fallback');
} finally {
  await app.close().catch(() => {});
  site.close();
}
