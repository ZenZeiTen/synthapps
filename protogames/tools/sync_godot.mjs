// Copies the engine-agnostic content package into the Godot project (godot/content),
// which Godot reads as raw bytes at runtime.
//   node tools/sync_godot.mjs
//
// Every PNG and WAV gets a `<file>.import` sidecar saying importer="keep": the editor
// leaves the file untouched (no re-encoding) AND the exporter packs it byte for byte.
// (A .gdignore would also stop re-encoding, but Godot then leaves the folder out of
// exported builds -- measured; tests/verify_godot_export.py guards this.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'content');
const dst = path.join(ROOT, 'godot', 'content');
const KEEP = new Set(['.png', '.wav']);
fs.rmSync(dst, { recursive: true, force: true });
let n = 0, kept = 0;
(function copy(a, b) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const s = path.join(a, e.name), d = path.join(b, e.name);
    if (e.isDirectory()) { copy(s, d); continue; }
    fs.copyFileSync(s, d);
    n++;
    if (KEEP.has(path.extname(e.name).toLowerCase())) {
      fs.writeFileSync(d + '.import', '[remap]\n\nimporter="keep"\n');
      kept++;
    }
  }
})(src, dst);
console.log(`synced ${n} files -> godot/content (${kept} marked keep, exported as-is)`);
