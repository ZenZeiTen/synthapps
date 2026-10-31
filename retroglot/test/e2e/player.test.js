// End to end: the real emulator in a real browser, translation against a mock Claude API.
// Needs the runtime (`npm run setup`) and Playwright with Chromium; skipped otherwise.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { emulatorjsDataDir, installedCores } from '../../src/runtime.js';
import { createServer } from '../../src/server.js';
import { Store } from '../../src/store.js';
import { setClient } from '../../src/translate.js';
import { startMockClaude } from '../helpers/mock-claude.js';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* not installed */ }
const ready = chromium && emulatorjsDataDir() && installedCores().includes('dosbox_pure');
const skip = ready ? false : 'needs `npm run setup` and Playwright';

let mock, server, base, browser, page, home, gameId;
const logs = [];

before(async () => {
  if (skip) return;
  mock = await startMockClaude();
  setClient(new Anthropic({ apiKey: 'test-key', baseURL: mock.url, maxRetries: 0 }));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'retroglot-e2e-'));
  server = createServer({ store: new Store(home) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(e.message));
});

after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  await mock?.close();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

const frameEval = (fn, arg) => page.frame({ url: /\/emu\// }).evaluate(fn, arg);

async function pressInGame(key) {
  await page.evaluate(() => document.querySelector('#emu').focus());
  await frameEval(() => window.retroglotBridge.focus());
  await page.keyboard.press(key);
}

test('the library adds the demo game', { skip }, async () => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Add the Japanese demo game' }).click();
  const card = page.getByRole('link', { name: /Play Hoshifuri/ });
  await card.waitFor({ timeout: 10000 });
  gameId = (await (await fetch(`${base}/api/games`)).json())[0].id;
  assert.match(gameId, /^[0-9a-f]{12}$/);
});

test('the demo boots in DOSBox Pure', { skip }, async () => {
  await page.goto(`${base}/play/${gameId}`);
  await page.waitForFunction(() => document.querySelector('#emu').contentWindow?.retroglotBridge?.started, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const size = await frameEval(async () => {
    const png = await window.retroglotBridge.screenshot();
    const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    return [bmp.width, bmp.height];
  });
  assert.deepEqual(size, [320, 200]);
});

test('Translate draws the translation over the dialogue window', { skip }, async () => {
  await page.getByRole('button', { name: /Translate/ }).click();
  const box = page.locator('.tl-box').first();
  await box.waitFor({ timeout: 20000 });
  assert.match(await box.textContent(), /Welcome, traveler\. This is Starfall Village\./);
  assert.match(await box.textContent(), /Village Elder/);
  // The box sits over the lower part of the picture, where the window is.
  const r = await box.boundingBox();
  const stage = await page.locator('#stage').boundingBox();
  assert.ok(r.y > stage.y + stage.height * 0.55, `box at y=${r.y} is not over the dialogue window`);
  assert.equal(await page.locator('#script .line').count(), 1);

  const req = mock.requests.at(-1).body;
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.match(req.messages[0].content[1].text, /Screenshot size: 960 x 600/);
  assert.match(mock.requests.at(-1).headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
});

test('the same screen comes from memory the second time', { skip }, async () => {
  const before = mock.requests.length;
  await page.keyboard.press('F2');
  await page.waitForTimeout(2500);
  assert.equal(mock.requests.length, before, 'a repeated screen must not call Claude again');
  assert.match(await page.locator('#cost').textContent(), /1 from memory/);
});

test('the glossary picks up the new place name', { skip }, async () => {
  await page.getByRole('tab', { name: 'Glossary' }).click();
  const inputs = page.locator('.gl-row input');
  await inputs.first().waitFor();
  assert.equal(await inputs.nth(0).inputValue(), '星降る村');
  assert.equal(await inputs.nth(1).inputValue(), 'Starfall Village');
  await page.getByRole('tab', { name: 'Script' }).click();
});

test('auto-translate follows the dialogue to the next screen', { skip }, async () => {
  await page.getByRole('button', { name: /Auto: off/ }).click();
  await pressInGame('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#script .line').length >= 2, null, { timeout: 30000 });
  assert.match(await page.locator('#script .line').last().textContent(), /old book of magic/);
  await page.getByRole('button', { name: /Auto: on/ }).click();
  // The second request carried the first line as context.
  assert.match(mock.requests.at(-1).body.messages[0].content[1].text, /Recent dialogue[\s\S]*Welcome, traveler/);
});

test('quick save and load restore the earlier screen', { skip }, async () => {
  await page.keyboard.press('F6');
  await page.waitForFunction(async (id) => (await (await fetch(`/api/games/${id}/saves`)).json()).length === 1, gameId, { timeout: 10000 });
  const sigOf = async () => frameEval(async () => {
    const png = await window.retroglotBridge.screenshot();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', png))].slice(0, 8).join(',');
  });
  const saved = await sigOf();
  await pressInGame('Enter');
  await page.waitForTimeout(800);
  assert.notEqual(await sigOf(), saved);
  await page.keyboard.press('F7');
  await page.waitForTimeout(1200);
  assert.equal(await sigOf(), saved);
});

test('the script exports as TMX', { skip }, async () => {
  const tmx = await (await fetch(`${base}/api/games/${gameId}/export?format=tmx`)).text();
  assert.match(tmx, /<tuv xml:lang="ja"><seg>ようこそ、旅の人。ここは星降る村です。<\/seg><\/tuv>/);
  assert.match(tmx, /<tuv xml:lang="en"><seg>Welcome, traveler\. This is Starfall Village\.<\/seg><\/tuv>/);
  assert.deepEqual(logs.filter((l) => !/Wake Lock|favicon|AudioContext/i.test(l)), []);
});

test('an NES cartridge boots on FCEUmm (a core without threads)', { skip: skip || (!installedCores().includes('fceumm') && 'needs the fceumm core') }, async () => {
  // Smallest valid iNES image: 16 KB of PRG that loops forever, 8 KB of empty CHR.
  const rom = Buffer.alloc(16 + 16384 + 8192);
  rom.write('NES\x1a', 0, 'latin1');
  rom[4] = 1; rom[5] = 1;
  rom.set([0x78, 0x4c, 0x01, 0x80], 16); // sei; jmp $8001
  rom.writeUInt16LE(0x8000, 16 + 0x3ffa); // NMI
  rom.writeUInt16LE(0x8000, 16 + 0x3ffc); // reset
  rom.writeUInt16LE(0x8000, 16 + 0x3ffe); // IRQ
  const up = await fetch(`${base}/api/upload?name=${encodeURIComponent('Loop Test.nes')}`, { method: 'PUT', body: rom });
  assert.equal(up.status, 201);
  const nes = await up.json();
  assert.equal(nes.system, 'nes');
  await page.goto(`${base}/play/${nes.id}`);
  await page.waitForFunction(() => document.querySelector('#emu').contentWindow?.retroglotBridge?.started, null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const size = await frameEval(async () => {
    const bmp = await createImageBitmap(new Blob([await window.retroglotBridge.screenshot()], { type: 'image/png' }));
    return [bmp.width, bmp.height];
  });
  assert.equal(size[0], 256);
  assert.equal(await frameEval(() => window.retroglotBridge.core()), 'fceumm');
});
