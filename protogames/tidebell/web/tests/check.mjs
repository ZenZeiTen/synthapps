// The browser build's checks, in headless Chromium (Playwright; WebGL through SwiftShader).
// Each case loads the built page with a harness script (?script=..., the same commands as
// the Godot build) and reads what it prints to the console.
//   node web/tests/check.mjs [outdir]        (tests/run_web.sh builds first)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../tools/serve.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? resolve(WEB, '..', 'build', 'web'));
mkdirSync(OUT, { recursive: true });

const WALK = 'tap:enter,wait:30,dump,tap:z,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:10,dump,tap:down,tap:enter,wait:30,dump,tap:z,wait:10,dump,tap:down,tap:enter,dump,tap:c,dump,tap:down,tap:enter,dump,tap:right,tap:enter,dump,tap:up,tap:up,tap:up,tap:enter,wait:20,dump,key:right,wait:30,keyup:right,dump,tap:enter,dump,tap:esc,wait:6,dump,tap:enter,tap:down,tap:down,dump,tap:enter,wait:6,dump,quit';
const FINAL = 'replay:brinecrow:pad:talk:end,waittalk,dump,wait:30,ptap:start,waittalk,dump,wait:30,ptap:start,wait:30,ptap:start,waittalk,dump,wait:30,ptap:start,wait:30,ptap:start,wait:30,ptap:start,wait:200,dump,pad:x,wait:120,padup:x,wait:60,dump,ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,dump,wait:60,ptap:a,wait:30,dump,wait:200,dump,quit';
const FIT = 'fitall,fit,tap:enter,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:10,set:score:9999999,set:done:4,wait:6,fit,set:done:5,wait:6,fit,tap:down,tap:down,tap:down,tap:enter,wait:6,fit,tap:right,wait:6,tap:right,wait:6,fit,quit';

const CASES = [
  { name: 'boot', script: 'wait:30,dump,quit', want: ['DUMP mode=title'], shot: 'title.png' },
  { name: 'shot_reach', script: 'stage:reach,key:right,wait:90,tap:x,wait:10,keyup:right,dump,quit', want: ['stage=reach'], shot: 'reach.png' },
  { name: 'shot_cliffs', script: 'stage:cliffs,key:right,wait:60,keyup:right,dump,quit', want: ['stage=cliffs'], shot: 'cliffs.png' },
  ...['reach', 'harbor', 'village', 'cliffs', 'abbey', 'brinecrow'].map((s) => (
    { name: `replay_${s}_pad`, script: `replay:${s}:pad`, want: [`REPLAY ${s} ok`] })),
  { name: 'replay_reach_kb', script: 'replay:reach:kb', want: ['REPLAY reach ok'] },
  { name: 'replay_abbey_kb', script: 'replay:abbey:kb', want: ['REPLAY abbey ok'] },
  { name: 'walk', script: WALK, want: ['mode=pages page=0/4', 'mode=hub cur=1', 'mode=map', 'mode=hub cur=2', 'mode=heroes',
    'mode=hub cur=3 .*hero=june', 'mode=pause cur=2', 'DUMP mode=title'], moved: true },
  { name: 'final', script: FINAL, want: ['who=villager', 'who=grane', 'page=0/3 who=grane', 'REPLAY brinecrow ok',
    'phase=bells', 'phase=credits', 'DUMP mode=title'] },
  { name: 'fit', script: FIT, want: ['FIT ok'], noFitFail: true },
];

const server = await serve(resolve(WEB, 'dist'), 0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
for (const c of CASES.filter((k) => !ONLY || ONLY.test(k.name))) {
  const page = await browser.newPage({ viewport: { width: 960, height: 672 } });
  const lines = [];
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/favicon/.test(t)) errors.push(t);
    lines.push(t);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${port}/?fast=8&script=${encodeURIComponent(c.script)}`;
  await page.goto(url);
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 600000) {
    if (lines.some((l) => l.startsWith('HARNESS done')) || errors.length) { done = true; break; }
    await page.waitForTimeout(250);
  }
  if (c.shot) await page.screenshot({ path: resolve(OUT, c.shot) });
  writeFileSync(resolve(OUT, `${c.name}.log`), lines.join('\n') + '\n');
  const problems = [];
  if (!done) problems.push('timed out');
  if (errors.length) problems.push('errors: ' + errors.slice(0, 3).join(' | '));
  if (lines.some((l) => l.startsWith('HARNESS unknown'))) problems.push('unknown harness command');
  for (const w of c.want) if (!lines.some((l) => new RegExp(w).test(l))) problems.push(`missing '${w}'`);
  if (c.noFitFail && lines.some((l) => /^FIT [0-9]/.test(l))) problems.push('text outside its frame: ' + lines.filter((l) => /^FIT [0-9]/.test(l)).join(' | '));
  if (c.moved && !lines.some((l) => /DUMP mode=play stage=reach pos=(1[0-9][0-9]|[2-9][0-9][0-9]),/.test(l))) problems.push('the hero did not move');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (problems.length) {
    failed += 1;
    console.log(`FAIL web ${c.name} (${secs}s): ${problems.join('; ')}`);
  } else {
    console.log(`ok   web ${c.name} (${secs}s)`);
  }
  await page.close();
}
await browser.close();
server.close();
console.log(failed ? `WEB FAIL (${failed})` : 'WEB ok');
process.exit(failed ? 1 : 0);
