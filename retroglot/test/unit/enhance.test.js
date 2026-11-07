import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  ENHANCEMENTS, enhancementPlan, normalizeEnhance, pickPsxHdBios, romInternalName, texturePackMount, zipNamesFromFile,
} from '../../src/enhance.js';
import { DISPLAY_SHADERS, createServer, glslForWebgl1 } from '../../src/server.js';
import { Store } from '../../src/store.js';
import { makeZip } from '../helpers/zip.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rg-enh-'));

/** A 64-byte N64 header in big-endian (.z64) order with the given internal name. */
function z64Header(name) {
  const h = Buffer.alloc(0x40);
  h.writeUInt32BE(0x80371240, 0);
  h.write(name.padEnd(20, ' '), 0x20, 'latin1');
  return h;
}

test('settings keep only known choices and drop defaults', () => {
  assert.deepEqual(normalizeEnhance('n64', { resolution: '1', smoothing: 'fxaa', bogus: 'x' }), { smoothing: 'fxaa' });
  assert.deepEqual(normalizeEnhance('psx', { renderer: 'hd', resolution: '2' }), { renderer: 'hd' });
  assert.throws(() => normalizeEnhance('n64', { resolution: '9' }), /unknown choice/);
  assert.deepEqual(normalizeEnhance('nes', { resolution: '2' }), {});
  // Every setting's first choice is its default and ids are unique.
  for (const spec of Object.values(ENHANCEMENTS)) {
    for (const def of Object.values(spec)) assert.equal(new Set(def.choices.map((c) => c.id)).size, def.choices.length);
  }
});

test('N64: every managed option is written, so turning a feature off resets it', () => {
  const off = enhancementPlan('n64', {});
  assert.equal(off.options['mupen64plus-43screensize'], '640x480');
  assert.equal(off.options['mupen64plus-aspect'], '4:3');
  assert.equal(off.options['mupen64plus-txHiresEnable'], 'False');
  assert.deepEqual(off.active, []);
  const on = enhancementPlan('n64', { resolution: '3', smoothing: 'msaa', textures: 'xbrz', widescreen: 'on' });
  assert.equal(on.options['mupen64plus-43screensize'], '1920x1440');
  assert.equal(on.options['mupen64plus-169screensize'], '2560x1440');
  assert.equal(on.options['mupen64plus-aspect'], '16:9 adjusted');
  assert.equal(on.options['mupen64plus-MultiSampling'], '4');
  assert.equal(on.options['mupen64plus-FXAA'], '0');
  assert.equal(on.options['mupen64plus-txEnhancementMode'], '4xBRZ');
  assert.deepEqual(Object.keys(on.options).sort(), Object.keys(off.options).sort());
  assert.equal(on.core, null); // same core as always
});

test('N64 texture packs go where GLideN64 looks for them', () => {
  const name = 'SUPER MARIO 64';
  assert.deepEqual(texturePackMount({ kind: 'zip', names: ['SUPER MARIO 64/a.png', 'SUPER MARIO 64/sub/b.png'] }, name), { key: '/Mupen64plus/hires_texture/', kind: 'zip' });
  assert.deepEqual(texturePackMount({ kind: 'zip', names: ['a.png', 'b.png'] }, name), { key: '/Mupen64plus/hires_texture/SUPER MARIO 64/', kind: 'zip' });
  assert.deepEqual(texturePackMount({ kind: 'zip', names: ['My HD Pack v2/a.png'] }, name), { key: '/Mupen64plus/hires_texture/SUPER MARIO 64/', kind: 'zip' });
  assert.deepEqual(texturePackMount({ kind: 'zip', names: ['Pack/a.png'] }, null), { key: '/Mupen64plus/hires_texture/', kind: 'zip' });
  assert.deepEqual(texturePackMount({ kind: 'hts' }, name), { key: '/Mupen64plus/cache/SUPER MARIO 64_HIRESTEXTURES.hts', kind: 'hts' });
  assert.match(texturePackMount({ kind: 'zip', names: ['readme.txt'] }, name).problem, /no PNG/);
  assert.match(texturePackMount(null, name).problem, /No HD texture pack/);
  assert.match(texturePackMount({ kind: 'zip', names: ['a.png'] }, null).problem, /internal name/);
  const plan = enhancementPlan('n64', { texturePack: 'on' }, { texturePack: { kind: 'zip', names: ['a.png'] }, romName: name });
  assert.equal(plan.options['mupen64plus-txHiresEnable'], 'True');
  assert.ok(plan.packMount);
  const missing = enhancementPlan('n64', { texturePack: 'on' }, {});
  assert.equal(missing.options['mupen64plus-txHiresEnable'], 'False');
  assert.equal(missing.problems.length, 1);
});

test('PS1 HD needs its core and a BIOS for the disc region, else it stays standard', () => {
  const want = { renderer: 'hd' };
  assert.equal(enhancementPlan('psx', want, { coreInstalled: () => true, psxBios: null, region: 'JP' }).core, null);
  assert.match(enhancementPlan('psx', want, { coreInstalled: () => true, psxBios: null, region: 'JP' }).problems[0], /scph5500\.bin \(Japan\)/);
  assert.match(enhancementPlan('psx', want, { coreInstalled: () => false, psxBios: '/b' }).problems[0], /not downloaded/);
  const ok = enhancementPlan('psx', { renderer: 'hd', steady: 'off', resolution: '3', widescreen: 'on' }, { coreInstalled: () => true, psxBios: '/b' });
  assert.equal(ok.core, 'mednafen_psx_hw');
  assert.equal(ok.options.beetle_psx_hw_internal_resolution, '4x');
  assert.equal(ok.options.beetle_psx_hw_pgxp_mode, 'disabled');
  assert.equal(ok.options.beetle_psx_hw_widescreen_hack, 'enabled');
  assert.equal(enhancementPlan('psx', {}).core, null);
  // Beetle accepts only certain file names; scph1001 is not one of them.
  assert.equal(pickPsxHdBios(['scph1001.bin', 'SCPH-5501.bin'], 'US'), 'SCPH-5501.bin');
  assert.equal(pickPsxHdBios(['scph1001.bin', 'scph5501.bin'], 'JP'), null);
  assert.equal(pickPsxHdBios(['scph5502.bin'], null), 'scph5502.bin');
});

test('the internal name is read from z64, v64 and n64 byte orders', () => {
  const z64 = z64Header('ZELDA MAJORA\'S MASK');
  const v64 = Buffer.from(z64); for (let i = 0; i < v64.length; i += 2) [v64[i], v64[i + 1]] = [v64[i + 1], v64[i]];
  const n64 = Buffer.from(z64); for (let i = 0; i < n64.length; i += 4) n64.writeUInt32LE(z64.readUInt32BE(i), i);
  for (const h of [z64, v64, n64]) assert.equal(romInternalName(h), 'ZELDA MAJORA\'S MASK');
  assert.equal(romInternalName(Buffer.alloc(0x40)), null);
});

test('zip names come from the central directory only', () => {
  const f = path.join(tmp(), 'p.zip');
  fs.writeFileSync(f, makeZip({ 'GAME/a.png': 'x', 'GAME/b.png': 'y' }));
  assert.deepEqual(zipNamesFromFile(f), ['GAME/a.png', 'GAME/b.png']);
  fs.writeFileSync(f, 'not a zip');
  assert.equal(zipNamesFromFile(f), null);
});

test('libretro shaders are made to compile in WebGL 1', () => {
  const src = '#version 130\nvoid main() {\n  i4 = mul( mat4x3(I4, C1, A0, G5), y_weight * Y );\n}\n';
  const out = glslForWebgl1(src);
  assert.ok(!out.includes('#version'));
  assert.ok(!out.includes('mat4x3'));
  assert.ok(out.includes('i4 = vec4(dot(y_weight * Y, I4), dot(y_weight * Y, C1), dot(y_weight * Y, A0), dot(y_weight * Y, G5));'));
  const xbr = glslForWebgl1(fs.readFileSync(new URL('../../web/shaders/xbr-lv2.glsl', import.meta.url), 'utf8'));
  assert.ok(!/mat4x3|mat3x4|#version/.test(xbr));
});

// --- through the server ----------------------------------------------------------

let server; let base; let store; let n64; let psx; const oldRuntime = process.env.RETROGLOT_RUNTIME;
before(async () => {
  const home = tmp();
  const rt = path.join(home, 'runtime');
  fs.mkdirSync(path.join(rt, 'emulatorjs', 'data'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'emulatorjs', 'data', 'loader.js'), '');
  for (const c of ['mupen64plus_next', 'pcsx_rearmed', 'mednafen_psx_hw']) {
    fs.mkdirSync(path.join(rt, 'cores', c), { recursive: true });
    fs.writeFileSync(path.join(rt, 'cores', c, 'package.json'), '{}');
  }
  process.env.RETROGLOT_RUNTIME = rt;
  store = new Store(path.join(home, 'data'));
  fs.writeFileSync(path.join(store.dirs.library, 'Test Game (USA).z64'), Buffer.concat([z64Header('TEST GAME'), Buffer.alloc(4096)]));
  const bin = Buffer.alloc(2352 * 20); bin.write('PLAYSTATION', 2352 * 16 + 32);
  fs.writeFileSync(path.join(store.dirs.library, 'Disc (Japan).bin'), bin);
  fs.writeFileSync(path.join(store.dirs.library, 'Disc (Japan).cue'), 'FILE "Disc (Japan).bin" BINARY\n  TRACK 01 MODE2/2352\n');
  store.scan();
  n64 = store.list().find((g) => g.system === 'n64');
  psx = store.list().find((g) => g.system === 'psx');
  server = createServer({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  if (oldRuntime === undefined) delete process.env.RETROGLOT_RUNTIME; else process.env.RETROGLOT_RUNTIME = oldRuntime;
  return new Promise((r) => server.close(r));
});

const call = (p, { method = 'GET', body, type = 'application/json' } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base + p);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: body !== undefined ? { 'Content-Type': type } : {} }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve({ status: res.statusCode, buf, json: /json/.test(res.headers['content-type'] || '') ? JSON.parse(buf.toString()) : null, text: buf.toString() });
    });
  });
  req.on('error', reject);
  req.end(body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
});
const pageConfig = (html, name) => JSON.parse(new RegExp(`window\\.${name} = (.*);`).exec(html)[1]);

test('server: the emulator page carries the core options, the upscaling shaders and the seed', async () => {
  assert.equal(n64.system, 'n64');
  let r = await call(`/api/games/${n64.id}`, { method: 'PATCH', body: { enhance: { resolution: '2', smoothing: 'fxaa' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.enhance, { resolution: '2', smoothing: 'fxaa' });
  assert.equal((await call(`/api/games/${n64.id}`, { method: 'PATCH', body: { enhance: { resolution: '99' } } })).status, 400);
  r = await call(`/emu/${n64.id}`);
  assert.equal(r.status, 200);
  const opts = pageConfig(r.text, 'EJS_defaultOptions');
  assert.equal(opts['mupen64plus-43screensize'], '1280x960');
  assert.equal(opts['mupen64plus-FXAA'], '1');
  assert.equal(opts.retroarch_core, 'mupen64plus_next');
  const shaders = pageConfig(r.text, 'EJS_shaders');
  for (const name of [DISPLAY_SHADERS.xbr, DISPLAY_SHADERS.scalefx]) {
    assert.ok(shaders[name].shader.value.startsWith('shaders = '));
    for (const res of shaders[name].resources) assert.ok(!res.value.startsWith('#version') && res.value.length > 1000, res.name);
  }
  assert.match(shaders[DISPLAY_SHADERS.scalefx].shader.value, /shaders = 5[\s\S]*scale4 = 3\.0/);
  const seed = pageConfig(r.text, 'RETROGLOT').coreOptions;
  assert.equal(seed.key, `ejs-1-n64-${n64.title}-settings`);
  assert.equal(seed.options['mupen64plus-43screensize'], '1280x960');
  assert.equal(seed.options.shader, DISPLAY_SHADERS[store.settings.display]);
  const info = (await call(`/api/games/${n64.id}/enhance`)).json;
  assert.equal(info.available, true);
  assert.equal(info.romName, 'TEST GAME');
  assert.deepEqual(info.active, ['2× resolution', 'FXAA']);
  assert.equal((await call(`/api/games/${psx.id}/texture-pack?name=a.zip`, { method: 'PUT', body: 'x', type: 'application/octet-stream' })).status, 400);
});

test('server: an N64 texture pack is stored, served and mounted', async () => {
  const zip = makeZip({ 'a.png': 'png1', 'b.png': 'png2' });
  assert.equal((await call(`/api/games/${n64.id}/texture-pack?name=pack.rar`, { method: 'PUT', body: 'x', type: 'application/octet-stream' })).status, 400);
  assert.equal((await call(`/api/games/${n64.id}/texture-pack?name=pack.zip`, { method: 'PUT', body: 'not a zip', type: 'application/octet-stream' })).status, 400);
  let r = await call(`/api/games/${n64.id}/texture-pack?name=My Pack.zip`, { method: 'PUT', body: zip, type: 'application/octet-stream' });
  assert.equal(r.status, 200);
  assert.equal(r.json.texturePack.name, 'My Pack.zip');
  assert.match(r.json.problems.join(''), /^$/); // the pack is not switched on yet
  await call(`/api/games/${n64.id}`, { method: 'PATCH', body: { enhance: { texturePack: 'on' } } });
  r = await call(`/emu/${n64.id}`);
  const files = pageConfig(r.text, 'EJS_externalFiles');
  assert.deepEqual(files, { '/Mupen64plus/hires_texture/TEST GAME/': `/api/games/${n64.id}/texture-pack/file/pack.zip` });
  assert.equal(pageConfig(r.text, 'EJS_defaultOptions')['mupen64plus-txHiresEnable'], 'True');
  r = await call(`/api/games/${n64.id}/texture-pack/file/pack.zip`);
  assert.deepEqual(r.buf, zip);
  r = await call(`/api/games/${n64.id}/texture-pack`, { method: 'DELETE' });
  assert.equal(r.json.texturePack, null);
  assert.equal(r.json.problems.length, 1);
  r = await call(`/emu/${n64.id}`);
  assert.ok(!/EJS_externalFiles/.test(r.text));
  assert.equal(pageConfig(r.text, 'EJS_defaultOptions')['mupen64plus-txHiresEnable'], 'False');
});

test('server: PS1 switches to the HD core only with a matching BIOS', async () => {
  assert.equal(psx.system, 'psx');
  await call(`/api/games/${psx.id}`, { method: 'PATCH', body: { enhance: { renderer: 'hd' } } });
  let r = await call(`/emu/${psx.id}`);
  assert.equal(pageConfig(r.text, 'EJS_core'), 'pcsx_rearmed');
  assert.equal(pageConfig(r.text, 'EJS_defaultOptions').retroarch_core, 'pcsx_rearmed');
  assert.match((await call(`/api/games/${psx.id}/enhance`)).json.problems[0], /scph5500/);
  fs.writeFileSync(path.join(store.dirs.bios, 'scph5500.bin'), Buffer.alloc(16));
  r = await call(`/emu/${psx.id}`);
  assert.equal(pageConfig(r.text, 'EJS_core'), 'mednafen_psx_hw');
  assert.equal(pageConfig(r.text, 'EJS_biosUrl'), '/bios/scph5500.bin');
  assert.equal(pageConfig(r.text, 'EJS_defaultOptions').beetle_psx_hw_internal_resolution, '2x');
  assert.equal(pageConfig(r.text, 'RETROGLOT').coreOptions.key, `ejs-1-psx-${psx.title}-settings`);
  // Changing the system clears choices made for the old one.
  await call(`/api/games/${psx.id}`, { method: 'PATCH', body: { system: 'segaCD' } });
  assert.deepEqual(store.get(psx.id).enhance, {});
});
