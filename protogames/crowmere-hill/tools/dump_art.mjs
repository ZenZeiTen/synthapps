// Dumps the ASCII art definitions to build/art_dump.json so tests/verify_art.py can
// compare exported pixels against their source without re-implementing art.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EGA, SPRITES, TEXTURES, fontSheetPixels } from '../pipeline/aseprite/art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'art_dump.json'), JSON.stringify({
  EGA,
  sprites: Object.fromEntries(Object.entries(SPRITES).map(([n, s]) => [n, { frames: s.frames, tags: s.tags }])),
  textures: TEXTURES,
  font_points: fontSheetPixels(),
}));
console.log('wrote build/art_dump.json');
