// Builds every pixel asset through the Aseprite MCP server (see mcp.mjs).
//
//   node pipeline/aseprite/build_art.mjs [--only sprites,textures,font]
//
// Outputs
//   art/aseprite/*.aseprite         editable sources (open them in Aseprite)
//   art/textures/*.png              surface textures, consumed by the Blender rooms
//   content/sprites/<name>.png/.json  sprite sheets + Aseprite JSON sidecars (engines)
//   content/sprites/anims.json      anchors and walk cycles for both engines
//   content/font/font.png/.json     the 5x9 pixel font

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './mcp.mjs';
import { EGA, SPRITES, TEXTURES, FONT, validateFrames, fontSheetPixels } from './art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (...p) => path.join(ROOT, ...p).replace(/\\/g, '/');

// Measured 2026-09-24: this repo lives on exFAT (E:), whose last-write time has 2 s
// granularity. The MCP server confirms every mutating call by requiring the file's
// mtime to advance, so two edits to one .aseprite within 2 s are reported as FAILED
// writes (E-WRITE-UNCONFIRMED) although the bytes landed. Edit on the NTFS temp
// drive instead and copy the finished sources into art/aseprite afterwards.
const WORK = path.join(os.tmpdir(), 'crowmere-aseprite').replace(/\\/g, '/');
fs.mkdirSync(WORK, { recursive: true });
const workFile = (name) => `${WORK}/${name}.aseprite`;
const keepSource = (name) => fs.copyFileSync(workFile(name), P('art/aseprite', `${name}.aseprite`));
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k) => only.length === 0 || only.includes(k);

for (const d of ['art/aseprite', 'art/textures', 'content/sprites', 'content/font']) fs.mkdirSync(P(d), { recursive: true });

function points(rows) {
  const pts = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (EGA[c]) pts.push({ x, y, color: EGA[c] }); }));
  return pts;
}

const m = await connect();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const texFilter = (process.argv.find((a) => a.startsWith('--tex=')) || '').slice(6).split(',').filter(Boolean);
if (want('textures')) {
  for (const [name, rows] of Object.entries(TEXTURES)) {
    if (texFilter.length && !texFilter.includes(name)) continue;
    const src = workFile(`tex_${name}`);
    await m.call('create_sprite', { path: src, width: rows[0].length, height: rows.length, color_mode: 'rgb', overwrite: true });
    await m.call('draw_pixels', { sprite: src, points: points(rows) });
    await m.call('export_png', { sprite: src, dest: P('art/textures', `${name}.png`), overwrite: true });
    keepSource(`tex_${name}`);
  }
  log(`textures: ${Object.keys(TEXTURES).length}`);
}

if (want('sprites')) {
  const anims = {};
  for (const [name, spr] of Object.entries(SPRITES)) {
    validateFrames(spr, name);
    const [w, h] = spr.size;
    const src = workFile(name);
    await m.call('create_sprite', { path: src, width: w, height: h, color_mode: 'rgb', overwrite: true });
    for (let i = 0; i < spr.frames.length; i++) {
      if (i > 0) await m.call('add_frame', { sprite: src });
      const pts = points(spr.frames[i][1]);
      if (pts.length) await m.call('draw_pixels', { sprite: src, frame: i + 1, points: pts });
    }
    for (const [tag, from, to] of spr.tags) await m.call('add_tag', { sprite: src, name: tag, from_frame: from, to_frame: to });
    const res = await m.call('export_spritesheet', {
      sprite: src, layout: 'horizontal', dest: P('content/sprites', `${name}.png`), json_dest: P('content/sprites', `${name}.json`), overwrite: true,
    });
    keepSource(name);
    anims[name] = { size: spr.size, anchor: spr.anchor, frames: spr.frames.map((f) => f[0]), anims: spr.anims || {} };
    log(`sprite ${name}: ${spr.frames.length} frames -> ${path.basename(res.dest || name)}`);
  }
  fs.writeFileSync(P('content/sprites/anims.json'), JSON.stringify(anims, null, 1) + '\n');
}

if (want('font')) {
  const w = FONT.cols * FONT.cell[0];
  const h = Math.ceil((FONT.last - FONT.first + 1) / FONT.cols) * FONT.cell[1];
  const src = workFile('font');
  await m.call('create_sprite', { path: src, width: w, height: h, color_mode: 'rgb', overwrite: true });
  await m.call('draw_pixels', { sprite: src, color: '#FFFFFF', points: fontSheetPixels() });
  await m.call('export_png', { sprite: src, dest: P('content/font', 'font.png'), overwrite: true });
  keepSource('font');
  const { glyphs, ...metrics } = FONT;
  fs.writeFileSync(P('content/font/font.json'), JSON.stringify({ ...metrics, sheet: [w, h] }, null, 1) + '\n');
  log(`font: ${w}x${h}`);
}

log(`done, ${m.calls} MCP calls`);
await m.close();
