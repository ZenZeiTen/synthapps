// Prints the JS core's state hash every 30 steps while replaying each route; the Godot
// side (godot/tests/parity.gd) prints the same lines; tests/parity.sh compares them.
//   node web/tests/parity.mjs > js.txt
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, newProgress } from '../src/core/game.js';
import { unpack } from '../src/core/inputs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const defs = JSON.parse(readFileSync(resolve(ROOT, 'content/data/defs.json'), 'utf8'));
// the routes, plus a stretch of every stage with the items used (item presses and cycling)
for (const stage of defs.stages) {
  const r = JSON.parse(readFileSync(resolve(ROOT, `content/routes/${stage}.json`), 'utf8'));
  const text = readFileSync(resolve(ROOT, `content/levels/${stage}.txt`), 'utf8');
  for (const variant of ['route', 'items']) {
    const g = new Game(defs);
    const prog = newProgress(defs, 1);
    if (variant === 'items') for (const k of defs.items) prog.items[k] = 3;
    g.start(stage, text, prog, r.hero ?? 'kess');
    let i = 0;
    for (const c of r.inputs) {
      const inp = unpack(c);
      if (variant === 'items' && i % 97 === 50) inp.item = true;
      if (variant === 'items' && i % 211 === 100) { inp.item = true; inp.dy = -1; }
      if (variant === 'items' && i % 331 === 7) inp.special = true;
      g.step(inp);
      for (const e of g.events) if (e.t === 'talk') g.closeTalk();
      g.events = [];
      i += 1;
      if (i % 30 === 0) console.log(`${stage} ${variant} ${i} ${g.stateHash()}`);
    }
    console.log(`${stage} ${variant} end ${i} ${g.stateHash()} mode=${g.mode}`);
  }
}
