// Mutation check for the walk-mask lint tests (probes and reachability): doctor a copy
// of the content package one fault at a time and confirm tests/lint.test.mjs goes red.
//   node tests/mutation_walk.mjs
// The first two mutants are the bug a player reported in the kitchen: the old walk mask
// let Gus walk through the chopping table and put an invisible wall behind it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './harness.mjs';

const SUITE = path.join(ROOT, 'tests', 'lint.test.mjs');
const game = fs.readFileSync(path.join(ROOT, 'content', 'game.json'), 'utf8');
const roomIds = Object.keys(JSON.parse(game).rooms);
const original = Object.fromEntries(roomIds.map((id) => [id, fs.readFileSync(path.join(ROOT, 'content', 'rooms', id, 'room.json'), 'utf8')]));

const decode = (walk) => walk.rows.map((runs) => {
  const row = new Uint8Array(walk.w);
  for (let i = 0; i < runs.length; i += 2) row.fill(1, runs[i], runs[i] + runs[i + 1]);
  return row;
});
const encode = (grid) => grid.map((row) => {
  const runs = [];
  for (let x = 0; x < row.length;) {
    if (!row[x]) { x++; continue; }
    const s = x;
    while (x < row.length && row[x]) x++;
    runs.push(s, x - s);
  }
  return runs;
});
function box(grid, cx, cy, rx, ry, value, ringOnly = false) {
  for (let y = Math.floor(cy) - ry; y <= Math.floor(cy) + ry; y++) for (let x = Math.floor(cx) - rx; x <= Math.floor(cx) + rx; x++) {
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;
    const edge = Math.abs(y - Math.floor(cy)) === ry || Math.abs(x - Math.floor(cx)) === rx;
    if (!ringOnly || edge) grid[y][x] = value;
  }
}
function withKitchenMask(edit) {
  return (rooms) => {
    const r = JSON.parse(rooms.kitchen);
    const grid = decode(r.walk);
    edit(grid, r);
    r.walk.rows = encode(grid);
    rooms.kitchen = JSON.stringify(r);
  };
}

const MUTANTS = [
  ['floor under the table is walkable (walk through it)',
    withKitchenMask((g, r) => box(g, r.probes.under_table.x, r.probes.under_table.y, 6, 3, 1))],
  ['floor behind the table is a hole (invisible wall)',
    withKitchenMask((g, r) => box(g, r.probes.behind_table.x, r.probes.behind_table.y, 14, 3, 0))],
  ['a point walled in by a ring of blocked floor',
    withKitchenMask((g, r) => box(g, r.points.table[0], r.points.table[1], 5, 4, 0, true))],
  ['an exit zone slides off the bottom of the picture',
    (rooms) => {
      const r = JSON.parse(rooms.gate);
      r.zones.leave.poly = r.zones.leave.poly.map(([x, y]) => [x, y + 10]);
      rooms.gate = JSON.stringify(r);
    }],
  ['a room loses its probes',
    (rooms) => { for (const id of roomIds) { const r = JSON.parse(rooms[id]); delete r.probes; rooms[id] = JSON.stringify(r); } }],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crowmere-walk-mut-'));
function stage(rooms) {
  fs.rmSync(path.join(tmp, 'content'), { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'content'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'content', 'game.json'), game);
  for (const id of roomIds) {
    fs.mkdirSync(path.join(tmp, 'content', 'rooms', id), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'content', 'rooms', id, 'room.json'), rooms[id]);
  }
}
const run = () => spawnSync(process.execPath, ['--test', SUITE], { env: { ...process.env, CROWMERE_ROOT: tmp }, encoding: 'utf8' });

stage({ ...original });
const base = run();
if (base.status !== 0) {
  console.error('the undoctored copy fails the lint suite; fix that before trusting any result\n' + base.stdout.slice(-2000));
  process.exit(2);
}

let survivors = 0;
for (const [name, mutate] of MUTANTS) {
  const rooms = { ...original };
  mutate(rooms);
  stage(rooms);
  const caught = run().status !== 0;
  if (!caught) survivors++;
  console.log(`${caught ? 'caught  ' : 'SURVIVED'}  ${name}`);
}
console.log(`${MUTANTS.length - survivors}/${MUTANTS.length} mutants caught`);
process.exit(survivors ? 1 : 0);
