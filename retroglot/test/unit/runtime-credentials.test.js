import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { FileSecrets, looksLikeApiKey } from '../../src/credentials.js';
import { EMULATORJS_VERSION, fetchPackage, untar } from '../../src/runtime.js';
import { createServer } from '../../src/server.js';
import { Store } from '../../src/store.js';
import { getClient, resetClient, setClient, testCredentials, useSecrets } from '../../src/translate.js';
import { startMockClaude } from '../helpers/mock-claude.js';
import { makeTgz } from '../helpers/tar.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retroglot-rt-'));

/** A tiny npm registry serving the given packages. */
async function mockRegistry(packages) {
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, { tgz, integrity }] of Object.entries(packages)) {
      if (req.url === `/${name}/${EMULATORJS_VERSION}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ name, version: EMULATORJS_VERSION, dist: { tarball: `${base}/t/${encodeURIComponent(name)}.tgz`, integrity, unpackedSize: 10 } }));
      }
      if (req.url === `/t/${encodeURIComponent(name)}.tgz`) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': tgz.length });
        return res.end(tgz);
      }
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
const sri = (b) => `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`;
/** fetch that sends registry requests to the mock. */
const via = (url) => (u, o) => globalThis.fetch(String(u).replace('https://registry.npmjs.org', url), o);

test('untar reads names and contents', () => {
  const files = [];
  untar(zlib.gunzipSync(makeTgz({ 'a.txt': 'hello', 'data/loader.js': 'x' })), (n, d) => files.push([n, d.toString()]));
  assert.deepEqual(files, [['package/a.txt', 'hello'], ['package/data/loader.js', 'x']]);
});

test('fetchPackage checks the checksum and unpacks without the package/ folder', async () => {
  const good = makeTgz({ 'package.json': JSON.stringify({ version: EMULATORJS_VERSION }), 'data/loader.js': '// loader' });
  const reg = await mockRegistry({
    '@emulatorjs/emulatorjs': { tgz: good, integrity: sri(good) },
    '@emulatorjs/core-bad': { tgz: good, integrity: sri(Buffer.from('other')) },
    '@emulatorjs/core-evil': { tgz: makeTgz({ '../../escape.txt': 'no' }), integrity: '' },
  });
  try {
    const dest = path.join(tmp(), 'emulatorjs');
    const fetch = via(reg.url);
    const r = await fetchPackage('@emulatorjs/emulatorjs', EMULATORJS_VERSION, dest, { fetch: (u, o) => fetch(String(u).replace(/^https?:\/\/[^/]+(?=\/@)/, reg.url), o) });
    assert.equal(r.bytes, good.length);
    assert.equal(fs.readFileSync(path.join(dest, 'data', 'loader.js'), 'utf8'), '// loader');
    const f2 = (u, o) => fetch(String(u).replace(/^https?:\/\/[^/]+(?=\/@)/, reg.url), o);
    await assert.rejects(fetchPackage('@emulatorjs/core-bad', EMULATORJS_VERSION, path.join(tmp(), 'b'), { fetch: f2 }), /damaged/);
    const evilDest = path.join(tmp(), 'deep', 'e');
    await assert.rejects(fetchPackage('@emulatorjs/core-evil', EMULATORJS_VERSION, evilDest, { fetch: f2 }), /Unsafe path/);
    await assert.rejects(fetchPackage('@emulatorjs/core-missing', EMULATORJS_VERSION, path.join(tmp(), 'm'), { fetch: f2 }), /answered 404/);
  } finally {
    await reg.close();
  }
});

test('saved API keys stay on disk, readable only by the user', () => {
  const file = path.join(tmp(), 'credentials.json');
  const s = new FileSecrets(file);
  assert.equal(s.get(), null);
  s.set('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  assert.equal(s.get(), 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  s.clear();
  assert.equal(s.get(), null);
  assert.ok(looksLikeApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!looksLikeApiKey('hello'));
  assert.ok(!looksLikeApiKey('sk-ant-short'));
});

let server, base, mock, store;
before(async () => {
  mock = await startMockClaude();
  store = new Store(tmp());
  server = createServer({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await mock.close();
  setClient(null);
});

const call = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};

test('the key is saved through the API, never returned, and used for requests', async () => {
  const bad = await call('/api/credentials', 'PUT', { apiKey: 'not a key' });
  assert.equal(bad.status, 400);
  const key = 'sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZwxyz';
  const saved = await call('/api/credentials', 'PUT', { apiKey: key });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.saved, true);
  assert.equal(saved.body.hint, '…wxyz');
  assert.ok(!JSON.stringify((await call('/api/status')).body).includes(key), 'the key must never reach the browser');
  // The real client (no test override) sends the saved key.
  setClient(null);
  resetClient();
  const client = getClient();
  assert.equal(client.apiKey, key);
  const status = (await call('/api/credentials', 'DELETE')).body;
  assert.equal(status.saved, false);
});

test('testCredentials reports a rejected key in plain words', async () => {
  setClient(new Anthropic({ apiKey: 'sk-ant-bad', baseURL: mock.url, maxRetries: 0 }));
  const r = await testCredentials();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'auth');
  setClient(new Anthropic({ apiKey: 'sk-ant-good', baseURL: mock.url, maxRetries: 0 }));
  assert.deepEqual(await testCredentials(), { ok: true });
  setClient(null);
  useSecrets(new FileSecrets(path.join(store.home, 'credentials.json')));
});

test('the emulator installs through the API with progress', async () => {
  const runtime = tmp();
  process.env.RETROGLOT_RUNTIME = runtime;
  const pkgs = {};
  const add = (name, files) => { const t = makeTgz(files); pkgs[name] = { tgz: t, integrity: sri(t) }; };
  add('@emulatorjs/emulatorjs', { 'package.json': JSON.stringify({ version: EMULATORJS_VERSION }), 'data/loader.js': '//' });
  add('@emulatorjs/core-fceumm', { 'package.json': JSON.stringify({ version: EMULATORJS_VERSION }), 'fceumm-wasm.data': 'x' });
  const reg = await mockRegistry(pkgs);
  const srv = createServer({ store: new Store(tmp()), fetch: (u, o) => fetch(String(u).replace(/^https?:\/\/[^/]+(?=\/@|\/t\/)/, reg.url), o) });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const start = await fetch(`${b}/api/runtime/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cores: ['fceumm'] }) });
    assert.equal(start.status, 202);
    let st;
    for (let i = 0; i < 50; i++) {
      st = await (await fetch(`${b}/api/runtime/install`)).json();
      if (!st.running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(st.error, null);
    assert.equal(st.done, 2);
    const status = await (await fetch(`${b}/api/status`)).json();
    assert.equal(status.runtime.installed, true);
    assert.deepEqual(status.runtime.cores, ['fceumm']);
    const bad = await fetch(`${b}/api/runtime/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cores: ['nope'] }) });
    assert.equal(bad.status, 400);
  } finally {
    delete process.env.RETROGLOT_RUNTIME;
    await new Promise((r) => srv.close(r));
    await reg.close();
  }
});
