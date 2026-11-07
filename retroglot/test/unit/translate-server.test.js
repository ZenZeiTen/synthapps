import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { createServer, romUrlName } from '../../src/server.js';
import { Store } from '../../src/store.js';
import { RESULT_SCHEMA, buildUserContent, estimateCost, normalizeResult, requestTranslation, setClient } from '../../src/translate.js';
import { startMockClaude } from '../helpers/mock-claude.js';

const game = { title: 'Hoshifuri', systemName: 'MS-DOS', region: 'JP', sourceLanguage: 'Japanese', notes: 'Lina is the heroine.' };
const settings = { model: 'claude-opus-5-5', effort: 'low', targetLanguage: 'Indonesian', style: 'natural' };

test('boxes are clamped to the image and turned into fractions', () => {
  const r = normalizeResult({
    source_language: 'Japanese',
    lines: [
      { original: 'はい', translation: 'Yes', speaker: '', kind: 'menu', box: { x: 100, y: 50, width: 50, height: 20 } },
      { original: 'x', translation: 'y', speaker: '', kind: 'weird', box: { x: 990, y: 590, width: 900, height: 900 } },
      { original: '', translation: 'dropped', speaker: '', kind: 'ui', box: { x: 0, y: 0, width: 1, height: 1 } },
    ],
    new_terms: [{ source: 'a', target: 'b', note: '' }, { source: '', target: 'c' }],
  }, 1000, 600);
  assert.deepEqual(r.lines[0].box, { x: 0.1, y: 50 / 600, w: 0.05, h: 20 / 600 });
  assert.equal(r.lines[1].kind, 'other');
  assert.ok(r.lines[1].box.x + r.lines[1].box.w <= 1 + 1e-9);
  assert.equal(r.lines.length, 2);
  assert.equal(r.newTerms.length, 1);
});

test('the request carries the game, glossary, recent lines and the picture', () => {
  const content = buildUserContent({ imageBase64: 'AAAA', width: 960, height: 600, game, settings, glossary: [{ source: 'リナ', target: 'Lina' }], recent: [{ speaker: 'Elder', original: 'ようこそ', translation: 'Selamat datang' }] });
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/png');
  const text = content[1].text;
  for (const want of ['Translate into: Indonesian', 'Screenshot size: 960 x 600', '- リナ = Lina', 'Elder: ようこそ => Selamat datang', 'Lina is the heroine.']) assert.ok(text.includes(want), want);
  // Strict structured output needs closed objects with every property required.
  const check = (s) => {
    if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(check); }
    if (s.type === 'array') check(s.items);
  };
  check(RESULT_SCHEMA);
});

test('cost estimate', () => {
  assert.equal(estimateCost('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24);
  assert.equal(estimateCost('unknown', { input_tokens: 1 }), 0);
});

let mock;
before(async () => { mock = await startMockClaude(); });
after(async () => { await mock.close(); });
const useMock = (url = mock.url) => setClient(new Anthropic({ apiKey: 'k', baseURL: url, maxRetries: 0 }));

test('requestTranslation sends a valid Messages request and reads the reply', async () => {
  useMock();
  const { result, usage } = await requestTranslation({ imageBase64: 'AAAA', width: 960, height: 600, game, settings });
  const req = mock.requests.at(-1);
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.system[0].cache_control.type, 'ephemeral');
  assert.equal(req.body.thinking, undefined);
  assert.equal(req.body.tool_choice, undefined);
  assert.match(req.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(result.lines[0].translation, 'Welcome, traveler. This is Starfall Village.');
  assert.equal(result.lines[0].speaker, 'Village Elder');
  assert.ok(Math.abs(result.lines[0].box.y - 148 / 200) < 1e-9);
  assert.equal(usage.input_tokens, 1800);
});

test('Haiku is asked without server-side fallbacks', async () => {
  useMock();
  await requestTranslation({ imageBase64: 'AAAA', width: 960, height: 600, game, settings: { ...settings, model: 'claude-haiku-5-5' } });
  const req = mock.requests.at(-1);
  assert.equal(req.body.fallbacks, undefined);
  assert.equal(req.headers['anthropic-beta'], undefined);
});

async function fakeApi(handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}

test('refusals, bad keys and cut-off answers become clear errors', async () => {
  const cases = [
    [(req, res) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'); }, /credentials/, 'auth'],
    [(req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'no' }, usage: {} })); }, /declined/, 'refusal'],
    [(req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '{"li' }], stop_reason: 'max_tokens', usage: {} })); }, /cut off/, 'max_tokens'],
  ];
  for (const [handler, re, code] of cases) {
    const api = await fakeApi(handler);
    useMock(api.url);
    await assert.rejects(requestTranslation({ imageBase64: 'AAAA', width: 10, height: 10, game, settings }), (e) => re.test(e.message) && e.code === code);
    await api.close();
  }
});

// ---------- server ----------
let server, base, store;
before(async () => {
  store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'retroglot-srv-')));
  fs.writeFileSync(path.join(store.dirs.library, 'Range Test.nes'), Buffer.from('NES\x1a0123456789'));
  store.scan();
  server = createServer({ store, translate: async ({ width, height }) => ({ result: normalizeResult({ source_language: 'Japanese', lines: [{ original: 'はい', translation: 'Yes', speaker: '', kind: 'menu', box: { x: 0, y: 0, width: width / 2, height: height / 2 } }], new_terms: [] }, width, height), usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-opus-5-5' }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const request = (p, opts = {}) => new Promise((resolve, reject) => {
  const u = new URL(p, base);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end(opts.body);
});

test('every response is cross-origin isolated (DOSBox Pure needs threads)', async () => {
  const r = await request('/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(r.headers['cross-origin-embedder-policy'], 'require-corp');
});

test('unknown host names and cross-site changes are refused', async () => {
  assert.equal((await request('/api/status', { headers: { Host: 'evil.example' } })).status, 403);
  const r = await request('/api/settings', { method: 'PATCH', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{"targetLanguage":"x"}' });
  assert.equal(r.status, 403);
  assert.notEqual(store.settings.targetLanguage, 'x');
});

test('game files are served with byte ranges', async () => {
  const id = store.list()[0].id;
  const r = await request(`/rom/${id}/Range%20Test.nes`, { headers: { Range: 'bytes=4-7' } });
  assert.equal(r.status, 206);
  assert.equal(r.body.toString(), '0123');
  assert.equal(r.headers['content-range'], 'bytes 4-7/14');
});

test('paths outside the app are not served', async () => {
  for (const p of ['/assets/..%2f..%2fpackage.json', '/assets/%2e%2e/%2e%2e/src/server.js', '/ejs/..%2f..%2fpackage.json', '/bios/..%2fdb.json']) {
    const r = await request(p);
    assert.ok(r.status === 404, `${p} gave ${r.status}`);
  }
});

test('translate endpoint caches identical screens per language', async () => {
  const id = store.list()[0].id;
  const body = JSON.stringify({ image: 'AAAA', width: 640, height: 480, hash: 'abc' });
  const post = () => request(`/api/games/${id}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const first = JSON.parse((await post()).body);
  assert.equal(first.cached, false);
  assert.equal(first.lines[0].translation, 'Yes');
  const second = JSON.parse((await post()).body);
  assert.equal(second.cached, true);
  assert.equal(second.usage.requests, 1);
  const bad = await request(`/api/games/${id}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"width":1}' });
  assert.equal(bad.status, 400);
});

test('save states round-trip through the API', async () => {
  const id = store.list()[0].id;
  const pic = Buffer.from('PNGDATA');
  const state = Buffer.from('STATEBYTES');
  const put = await request(`/api/games/${id}/saves/2`, { method: 'PUT', headers: { 'X-Picture-Length': String(pic.length), 'Content-Type': 'application/octet-stream' }, body: Buffer.concat([pic, state]) });
  assert.equal(put.status, 200);
  assert.equal((await request(`/api/games/${id}/saves/2/state`)).body.toString(), 'STATEBYTES');
  assert.equal((await request(`/api/games/${id}/saves/2/png`)).body.toString(), 'PNGDATA');
});

test('DOS programs get a short name the DOS shell can run', () => {
  assert.equal(romUrlName({ system: 'dos', fileName: 'Hoshifuri (Japan) (Demo).com' }), 'HOSHIFUR.COM');
  assert.equal(romUrlName({ system: 'dos', fileName: 'game.zip' }), 'game.zip');
  assert.equal(romUrlName({ system: 'snes', fileName: 'Long Name (J).sfc' }), 'Long Name (J).sfc');
});
