// Self-test for the desktop build, run with `--smoke` (CI and `npm run smoke`).
// It goes through first use like a player would: the emulator download, the demo
// game, a running picture and the "no API key yet" message, then quits with
// exit code 0 (all good) or 1, leaving screenshots and result.json behind.
import fs from 'node:fs';
import path from 'node:path';

export async function runSmoke({ app, win, baseUrl }) {
  const out = path.resolve(process.env.RETROGLOT_SMOKE_OUT || 'smoke-out');
  fs.mkdirSync(out, { recursive: true });
  const steps = [];
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (what, code, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      try { if (await js(code)) return; } catch { /* page still loading */ }
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await wait(500);
    }
  };
  const shot = async (name) => fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  const step = async (name, fn) => {
    const t = Date.now();
    try {
      await fn();
      steps.push({ name, ok: true, ms: Date.now() - t });
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t, error: String(e?.message || e) });
      throw e;
    }
  };
  let ok = false;
  try {
    await step('library page loads', () => until('the library', "document.querySelector('#summary')?.textContent?.length > 0 && !document.querySelector('#summary').textContent.includes('Loading')", 30000));
    await step('page is cross-origin isolated (needed by DOSBox Pure)', async () => {
      if (!(await js('crossOriginIsolated'))) throw new Error('crossOriginIsolated is false');
    });
    await step('emulator downloads on first start', () => until('the emulator download',
      "fetch('/api/status').then(r => r.json()).then(s => s.runtime.installed && !s.runtime.installing)", 10 * 60000));
    await shot('library.png');
    let id;
    await step('demo game is added', async () => {
      id = await js("fetch('/api/demo', { method: 'POST' }).then(r => r.json()).then(g => g.id)");
      if (!/^[0-9a-f]{12}$/.test(id || '')) throw new Error(`bad game id ${id}`);
    });
    await step('demo boots in DOSBox Pure', async () => {
      await win.loadURL(`${baseUrl}/play/${id}`);
      await until('the game to start', "!!document.querySelector('#emu').contentWindow?.retroglotBridge?.started", 120000);
      await wait(3000);
      const size = await js(`(async () => {
        const png = await document.querySelector('#emu').contentWindow.retroglotBridge.screenshot();
        const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
        return [bmp.width, bmp.height];
      })()`);
      if (size[0] !== 320 || size[1] !== 200) throw new Error(`unexpected picture size ${size}`);
    });
    await shot('play.png');
    await step('translation explains a missing API key', async () => {
      const r = await js(`fetch('/api/games/${id}/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'AAAA', width: 10, height: 10 }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`);
      if (process.env.ANTHROPIC_API_KEY) return; // a real key would really translate
      if (r.status !== 401 || r.body.code !== 'auth') throw new Error(`expected a 401 auth answer, got ${r.status} ${JSON.stringify(r.body)}`);
    });
    ok = true;
  } catch {
    try { await shot('failure.png'); } catch { /* window gone */ }
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok, steps, version: app.getVersion(), platform: process.platform }, null, 2));
  console.log(`smoke ${ok ? 'passed' : 'FAILED'}:`);
  for (const s of steps) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name} (${s.ms} ms)${s.error ? `: ${s.error}` : ''}`);
  app.exit(ok ? 0 : 1);
}
