// Regenerates screenshots of the UI with stand-in game files and the test stand-in for Claude.
// Run: node test/helpers/shots.mjs <out-dir>   (needs the runtime and Playwright; downloads box art).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { createServer } from '../../src/server.js'; import { Store } from '../../src/store.js'; import { setClient } from '../../src/translate.js';
import { startMockClaude } from './mock-claude.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2];
const only = process.argv[3] || 'all';
const mock = await startMockClaude();
setClient(new Anthropic({ apiKey: 'k', baseURL: mock.url, maxRetries: 0 }));
const home = process.env.SHOTS_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'rg-shots-'));
const store = new Store(home);
const fictional = process.env.SHOTS_FICTIONAL === '1'; // for pictures committed to the repository: no third-party box art
if (fictional) store.updateSettings({ downloadArt: false });
const names = fictional ? ['Seiken Saga (Japan).sfc', 'Moon Courier (Japan).gb', 'Neon Drift (USA).md', 'Pocket Kaiju (Japan).gba', 'Tower of Ash (Japan).chd', 'Mecha Pilot 64 (Japan).z64', 'Star Ferry (Japan).pce', 'Dungeon of Glass (1991).zip', 'Rail Knight (Japan).nes', 'Harbor Lights (Japan).sfc'] : ['Chrono Trigger (USA).sfc', 'Seiken Densetsu 3 (Japan).sfc', 'The Legend of Zelda - A Link to the Past (USA).sfc', 'Super Mario World (USA).sfc',
  'Sonic The Hedgehog (USA, Europe).md', 'Streets of Rage 2 (USA).md', 'Final Fantasy VII (USA) (Disc 1).chd', 'Mother 3 (Japan).gba', 'Pokemon - Red Version (USA, Europe).gb',
  'Super Mario Bros. 3 (USA).nes', 'Star Fox 64 (USA).z64', 'Bonk\'s Adventure (USA).pce'];
for (const n of names) if (!fs.existsSync(path.join(store.dirs.library, n))) fs.writeFileSync(path.join(store.dirs.library, n), Buffer.alloc(2048));
const server = createServer({ store }); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;
const demo = await (await fetch(`${base}/api/demo`, { method: 'POST' })).json();
store.update(demo.id, { played: true, addPlaySeconds: 1500 });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(base); await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/s-home.png` });
for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/s-home-2.png` });
await page.keyboard.press('e'); await page.keyboard.press('e'); await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/s-home-3.png` });
if (only === 'all' || only === 'play') {
  await page.goto(`${base}/play/${demo.id}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s-boot.png` });
  await page.waitForFunction(() => document.querySelector('#emu').contentWindow?.retroglotBridge?.started, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/s-play.png` });
  await page.keyboard.press('F2');
  await page.locator('.tl-box').first().waitFor();
  await page.waitForTimeout(600);
  await page.mouse.move(700, 40);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/s-translate.png` });
  await page.mouse.move(700, 500);
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${out}/s-immersive.png` });
  await page.keyboard.press('F1');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/s-panel.png` });
}
await page.setViewportSize({ width: 420, height: 860 }); await page.goto(base); await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/s-mobile.png` });
await browser.close(); server.close(); mock.close();
