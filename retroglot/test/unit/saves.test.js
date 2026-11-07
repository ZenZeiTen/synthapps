import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { enhancementPlan } from '../../src/enhance.js';
import { createServer } from '../../src/server.js';
import { Store, checkSavePath } from '../../src/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rg-saves-'));

test('save paths from the emulator are checked', () => {
  assert.deepEqual(checkSavePath('FCEUmm/Zelda%20(USA).srm'), ['FCEUmm', 'Zelda%20(USA).srm']);
  assert.deepEqual(checkSavePath('PPSSPP/PSP/SAVEDATA/ULUS10041/DATA.BIN').length, 5);
  for (const bad of ['../x', 'a/../b', '/abs', 'C:/x', 'a\\b', 'a//b', 'x/', 'name.', 'a/b/c/d/e/f/g/h/i']) {
    assert.throws(() => checkSavePath(bad), /Bad save path|too long/, bad);
  }
});

test('in-game saves are stored, unchanged files are not rewritten, the previous version is kept', () => {
  const store = new Store(tmp());
  const id = 'abcdef012345';
  assert.deepEqual(store.writeIngame(id, [{ path: 'FCEUmm/G.srm', data: Buffer.from([1, 2]) }]), ['FCEUmm/G.srm']);
  assert.deepEqual(store.writeIngame(id, [{ path: 'FCEUmm/G.srm', data: Buffer.from([1, 2]) }]), []);
  store.writeIngame(id, [{ path: 'FCEUmm/G.srm', data: Buffer.from([3]) }]);
  const [f] = store.listIngame(id);
  assert.equal(f.path, 'FCEUmm/G.srm');
  assert.deepEqual([...fs.readFileSync(f.file)], [3]);
  assert.deepEqual([...fs.readFileSync(store.ingameFile(id, 'FCEUmm/G.srm').replace(`${path.sep}ingame${path.sep}`, `${path.sep}ingame-previous${path.sep}`))], [1, 2]);
  assert.throws(() => store.writeIngame(id, [{ path: '../evil', data: Buffer.alloc(1) }]), /Bad save path/);
  assert.throws(() => store.ingameDir('../x'), /Bad save scope/);
  // PSP games share one memory stick; everything else has its own folder.
  assert.equal(store.ingameScope({ id, system: 'psp' }), '_psp-memory-stick');
  assert.equal(store.ingameScope({ id, system: 'nes' }), id);
});

test('settings: screen shape and autosave', () => {
  const store = new Store(tmp());
  assert.equal(store.settings.screen, 'original');
  assert.equal(store.settings.autosave, true);
  store.updateSettings({ screen: 'fill', autosave: false });
  assert.equal(store.settings.screen, 'fill');
  assert.throws(() => store.updateSettings({ screen: 'huge' }), /Screen shape/);
});

test('DS screen layout maps to melonDS', () => {
  assert.equal(enhancementPlan('nds', {}).options.melonds_screen_layout, 'Top/Bottom');
  assert.equal(enhancementPlan('nds', { layout: 'side' }).options.melonds_screen_layout, 'Left/Right');
  assert.deepEqual(enhancementPlan('nds', { layout: 'side' }).active, ['side by side']);
});

// --- through the server ---------------------------------------------------------
let server, base, store, game;
const oldRuntime = process.env.RETROGLOT_RUNTIME;
before(async () => {
  const home = tmp();
  const rt = path.join(home, 'runtime');
  fs.mkdirSync(path.join(rt, 'emulatorjs', 'data'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'emulatorjs', 'data', 'loader.js'), '');
  process.env.RETROGLOT_RUNTIME = rt;
  store = new Store(path.join(home, 'data'));
  fs.writeFileSync(path.join(store.dirs.library, 'Game (USA).nes'), Buffer.concat([Buffer.from('NES\x1a', 'latin1'), Buffer.alloc(16 + 16384)]));
  store.scan();
  game = store.list()[0];
  server = createServer({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  if (oldRuntime === undefined) delete process.env.RETROGLOT_RUNTIME; else process.env.RETROGLOT_RUNTIME = oldRuntime;
  return new Promise((r) => server.close(r));
});
const call = (p, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base + p);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve({ status: res.statusCode, headers: res.headers, buf, json: /json/.test(res.headers['content-type'] || '') ? JSON.parse(buf.toString()) : null, text: buf.toString() });
    });
  });
  req.on('error', reject);
  req.end(body === undefined ? undefined : JSON.stringify(body));
});
const pageConfig = (html) => JSON.parse(/window\.RETROGLOT = (.*);/.exec(html)[1]);

test('server: in-game saves go to disk, come back in the emulator page and can be downloaded', async () => {
  let r = await call(`/api/games/${game.id}/ingame`);
  assert.deepEqual(r.json, { shared: false, files: [] });
  const data = Buffer.from([0x42, 0x77, 0, 1]);
  r = await call(`/api/games/${game.id}/ingame`, { method: 'PUT', body: { files: [{ path: 'FCEUmm/Game%20(USA).srm', data: data.toString('base64') }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.written, ['FCEUmm/Game%20(USA).srm']);
  assert.equal(r.json.files[0].size, 4);
  for (const bad of [{ files: [{ path: '../x', data: 'AA==' }] }, { files: [{ path: 'a.srm', data: 'not base64!' }] }, { files: 'x' }]) {
    assert.equal((await call(`/api/games/${game.id}/ingame`, { method: 'PUT', body: bad })).status, 400);
  }
  // A write from another site is refused.
  assert.equal((await call(`/api/games/${game.id}/ingame`, { method: 'PUT', body: { files: [] }, headers: { Origin: 'http://evil.example' } })).status, 403);
  r = await call(`/emu/${game.id}`);
  const cfg = pageConfig(r.text);
  assert.equal(cfg.ingame.url, `/api/games/${game.id}/ingame`);
  assert.equal(cfg.ingame.shared, null);
  assert.deepEqual(cfg.ingame.files, [{ path: 'FCEUmm/Game%20(USA).srm', data: data.toString('base64') }]);
  assert.equal(cfg.screen, 'original');
  r = await call(`/api/games/${game.id}/ingame/file?path=${encodeURIComponent('FCEUmm/Game%20(USA).srm')}`);
  assert.deepEqual(r.buf, data);
  assert.match(r.headers['content-disposition'], /Game%20\(USA\)\.srm/);
  assert.equal((await call(`/api/games/${game.id}/ingame/file?path=..%2Fdb.json`)).status, 400);
  // The screen shape setting reaches the emulator page.
  await call('/api/settings', { method: 'PATCH', body: { screen: 'wide' } });
  assert.equal(pageConfig((await call(`/emu/${game.id}`)).text).screen, 'wide');
});
