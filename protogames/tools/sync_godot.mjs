// Copies the engine-agnostic content package into the Godot project
// (godot/content), which Godot reads as raw bytes at runtime. A .gdignore keeps
// the editor from importing (and re-encoding) the PNGs.
//   node tools/sync_godot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'content');
const dst = path.join(ROOT, 'godot', 'content');
fs.rmSync(dst, { recursive: true, force: true });
let n = 0;
(function copy(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const s = path.join(a, e.name), d = path.join(b, e.name);
    if (e.isDirectory()) copy(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
})(src, dst);
fs.writeFileSync(path.join(dst, '.gdignore'), '');
console.log(`synced ${n} files -> godot/content`);
