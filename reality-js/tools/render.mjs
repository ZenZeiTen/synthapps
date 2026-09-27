#!/usr/bin/env node
// Render a .real scene to a PNG or a WebM video from the command line.
//
//   node tools/render.mjs examples/golden-hour.real -o golden.png
//   node tools/render.mjs examples/bouncing-balls.real --video -o balls.webm
//
// Options
//   -o, --out FILE      output file (.png, or .webm with --video)
//   --samples N         samples per pixel (default: the scene's render settings)
//   --size WxH          resolution (default: the scene's render settings)
//   --time SECONDS      moment to render for a still
//   --video             render the timeline to WebM
//   --frames DIR        render the timeline to numbered PNGs in DIR
//   --fps N, --duration SECONDS   override the timeline
//   --gpu               use the GPU instead of the CPU (SwiftShader) renderer
//
// Needs Playwright (npm i -D playwright) or a global Playwright install.

import { writeFileSync, mkdirSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/browser/run.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const o = { file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-o' || a === '--out') o.out = next();
    else if (a === '--samples') o.samples = Number(next());
    else if (a === '--size') { const [w, h] = next().split('x').map(Number); o.width = w; o.height = h; }
    else if (a === '--time') o.time = Number(next());
    else if (a === '--video') o.video = true;
    else if (a === '--frames') o.frames = next();
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--duration') o.duration = Number(next());
    else if (a === '--gpu') o.gpu = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.file) o.file = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts.file) {
  console.log('usage: node tools/render.mjs SCENE.real [-o out.png] [--samples N] [--size WxH] [--time S] [--video] [--frames DIR] [--gpu]');
  process.exit(opts.help ? 0 : 1);
}

const scenePath = resolve(opts.file);
const rel = relative(ROOT, scenePath);
if (rel.startsWith('..')) {
  console.error('reality.js: the scene must be inside the reality-js folder so its files can be served');
  process.exit(1);
}

const b = await launch({ gpu: opts.gpu });
let lastPct = -1;
await b.page.exposeFunction('progress', (done, total) => {
  const pct = Math.floor((100 * done) / total);
  if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r${pct}%`); }
});
try {
  const url = '/' + rel.split('\\').join('/');
  const common = { url, samples: opts.samples, width: opts.width, height: opts.height };
  if (opts.video || opts.frames) {
    const r = await b.page.evaluate((o) => window.renderMovie(o), { ...common, fps: opts.fps, duration: opts.duration, format: opts.frames ? 'png' : 'webm' });
    process.stdout.write('\r');
    if (r.data) {
      const out = opts.out ?? scenePath.replace(/\.real$/, '.webm');
      writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log(`wrote ${out} (${r.codec})`);
    } else {
      const dir = opts.frames ?? scenePath.replace(/\.real$/, '-frames');
      mkdirSync(dir, { recursive: true });
      r.frames.forEach((f, i) => writeFileSync(join(dir, `frame-${String(i).padStart(5, '0')}.png`), Buffer.from(f, 'base64')));
      console.log(`wrote ${r.frames.length} frames to ${dir}`);
    }
  } else {
    const r = await b.page.evaluate((o) => window.renderStill(o), { ...common, time: opts.time });
    process.stdout.write('\r');
    const out = opts.out ?? scenePath.replace(/\.real$/, '.png');
    writeFileSync(out, Buffer.from(r.png, 'base64'));
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    console.log(`wrote ${out} (${r.width}x${r.height}, ${r.samples} samples, ${(r.ms / 1000).toFixed(1)} s)`);
  }
} catch (err) {
  process.stdout.write('\r');
  console.error(String(err.message).replace(/^page\.evaluate: (Error: )?/, ''));
  process.exitCode = 1;
} finally {
  await b.close();
}
