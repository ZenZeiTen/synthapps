// Writes placeholder content/rooms/<id>/room.json files so the engine can be tested
// before the Blender pipeline has produced real geometry. Every point and zone name
// game.json refers to gets a spot on a flat rectangular floor. Real room.json files
// (without "provisional": true) are never overwritten.
//
//   node tools/provisional_rooms.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../tests/harness.mjs';

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/game.json'), 'utf8'));

export function referencedNames(data) {
  const pts = {}, zones = {};
  for (const id of Object.keys(data.rooms)) { pts[id] = new Set(); zones[id] = new Set(); }
  const add = (room, name) => { if (room && name && pts[room]) pts[room].add(name); };
  add(data.start.room, data.start.point);
  for (const id of Object.keys(data.scenery)) {
    const s = data.scenery[id];
    if (s.at && typeof s.room === 'string' && s.room !== '*') add(s.room, s.at);
  }
  for (const id of Object.keys(data.objects)) {
    const o = data.objects[id];
    if (o.at && typeof o.start === 'string' && o.start !== 'inv') add(o.start, o.at);
  }
  // objects revealed by rules: the room they are moved into
  for (const r of data.rules) for (const e of r.do || []) {
    if (e.move && typeof e.move[1] === 'string' && e.move[1] !== 'inv' && data.objects[e.move[0]].at) add(e.move[1], data.objects[e.move[0]].at);
  }
  for (const id of Object.keys(data.rooms)) {
    for (const x of Object.values(data.rooms[id].exits || {})) {
      zones[id].add(x.zone);
      add(x.to, x.at);
    }
  }
  return { pts, zones };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pts, zones } = referencedNames(data);
  for (const room of Object.keys(data.rooms)) {
    const file = path.join(ROOT, 'content/rooms', room, 'room.json');
    if (fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, 'utf8')).provisional) {
      console.log(`${room}: real room.json present, left alone`);
      continue;
    }
    const W = 320, H = 168, top = 100, bottom = 165, left = 8, right = 311;
    const rows = [];
    for (let y = 0; y < H; y++) rows.push(y >= top && y <= bottom ? [left, right - left + 1] : []);
    const names = [...pts[room]].sort();
    const points = {};
    names.forEach((n, i) => {
      const cols = 6, cx = i % cols, cy = Math.floor(i / cols);
      points[n] = [left + 20 + cx * 50, top + 8 + cy * 20];
    });
    const zoneOut = {};
    [...zones[room]].sort().forEach((z, i) => {
      const x0 = left + 4 + i * 60, y0 = bottom - 12;
      zoneOut[z] = { poly: [[x0, y0], [x0 + 20, y0], [x0 + 20, y0 + 10], [x0, y0 + 10]], target: [x0 + 10, y0 + 5] };
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ id: room, provisional: true, size: [W, H], walk: { w: W, h: H, rows }, points, zones: zoneOut }, null, 1) + '\n');
    console.log(`${room}: provisional room.json with ${names.length} points, ${Object.keys(zoneOut).length} zones`);
  }
}
