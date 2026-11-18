// Content lint: every id game.json mentions must exist, every point/zone/overlay it
// needs must be provided by the room.json the pipeline generated, and the vocabulary
// must be unambiguous. Cheap, and it catches the typo class that transcripts only
// catch if someone happens to type the broken command.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './harness.mjs';
import { pointInPoly } from '../web/src/core.js';
import { referencedNames } from '../tools/provisional_rooms.mjs';

const game = makeGame();
const { data, rooms } = game;
const VERBS = new Set([...Object.keys(data.vocab.verbs), '@enter', '_exit']);
const OBJ = new Set(Object.keys(data.objects));
const ENT = new Set([...OBJ, ...Object.keys(data.scenery)]);
const ROOMS = new Set(Object.keys(data.rooms));
const EXITS = new Set(Object.values(data.rooms).flatMap((r) => Object.keys(r.exits || {})));

function checkConds(conds, where, errs) {
  for (const c of conds || []) {
    const [k] = Object.keys(c);
    const v = c[k];
    if (['has', 'hasnt'].includes(k) && !OBJ.has(v)) errs.push(`${where}: ${k} unknown object ${v}`);
    if (['at', 'notat'].includes(k) && (!OBJ.has(v[0]) || !(v[1] === null || v[1] === 'inv' || ROOMS.has(v[1])))) errs.push(`${where}: ${k} ${JSON.stringify(v)}`);
    if (['room', 'notroom'].includes(k) && [].concat(v).some((r) => !ROOMS.has(r))) errs.push(`${where}: ${k} ${v}`);
    if (k === 'near' && !ENT.has(v)) errs.push(`${where}: near unknown entity ${v}`);
    if (!['flag', 'not', 'has', 'hasnt', 'at', 'notat', 'room', 'notroom', 'near'].includes(k)) errs.push(`${where}: unknown condition ${k}`);
  }
}

test('vocabulary has no conflicting verb phrases', () => {
  assert.deepEqual(game.conflicts, []);
});

test('rules reference only real verbs, entities, exits and rooms', () => {
  const errs = [];
  data.rules.forEach((r, i) => {
    const where = `rule #${i} (${[].concat(r.verb).join('/')} ${[].concat(r.noun ?? r.pair ?? '').join('/')})`;
    for (const v of [].concat(r.verb)) if (!VERBS.has(v)) errs.push(`${where}: unknown verb ${v}`);
    const nouns = [...[].concat(r.noun ?? []), ...[].concat(r.noun2 ?? []), ...[].concat(r.pair ?? [])].filter((n) => n !== '*');
    for (const n of nouns) {
      const ok = [].concat(r.verb).includes('_exit') ? EXITS.has(n) : ENT.has(n);
      if (!ok) errs.push(`${where}: unknown noun ${n}`);
    }
    if (r.near && !ENT.has(r.near)) errs.push(`${where}: near unknown ${r.near}`);
    for (const room of [].concat(r.room ?? [])) if (!ROOMS.has(room)) errs.push(`${where}: unknown room ${room}`);
    checkConds(r.if, where, errs);
    for (const e of r.do) {
      checkConds(e.if, where, errs);
      if (e.move && (!OBJ.has(e.move[0]) || !(e.move[1] === null || e.move[1] === 'inv' || ROOMS.has(e.move[1])))) errs.push(`${where}: move ${JSON.stringify(e.move)}`);
      if (e.redirect && (!VERBS.has(e.redirect[0]) || e.redirect.slice(1).some((n) => n && !ENT.has(n)))) errs.push(`${where}: redirect ${e.redirect}`);
    }
  });
  for (const id of Object.keys(data.scenery)) checkConds(data.scenery[id].if, `scenery ${id}`, errs);
  for (const [rid, room] of Object.entries(data.rooms)) {
    for (const [xid, x] of Object.entries(room.exits || {})) {
      if (!ROOMS.has(x.to)) errs.push(`exit ${xid}: unknown room ${x.to}`);
      for (const n of x.nouns || []) if (!ENT.has(n)) errs.push(`exit ${xid}: unknown noun ${n}`);
      checkConds(x.when, `exit ${xid}`, errs);
    }
    for (const [oid, conds] of Object.entries(room.overlays || {})) checkConds(conds, `overlay ${rid}.${oid}`, errs);
  }
  assert.deepEqual(errs, []);
});

test('score events add up to maxScore', () => {
  const events = {};
  for (const r of data.rules) for (const e of r.do) if (e.score) events[e.score[1]] = e.score[0];
  for (const [id, o] of Object.entries(data.objects)) if (o.score) events['take_' + id] = o.score;
  const total = Object.values(events).reduce((a, b) => a + b, 0);
  assert.equal(total, data.meta.maxScore, JSON.stringify(events));
});

test('every referenced point and zone exists in room.json', () => {
  const { pts, zones } = referencedNames(data);
  const errs = [];
  for (const room of Object.keys(data.rooms)) {
    const r = rooms[room];
    if (!r) { errs.push(`${room}: no room.json`); continue; }
    for (const p of pts[room]) if (!r.points || !r.points[p]) errs.push(`${room}: missing point ${p}`);
    for (const z of zones[room]) if (!r.zones || !r.zones[z]) errs.push(`${room}: missing zone ${z}`);
  }
  assert.deepEqual(errs, []);
});

// Where Gus can be put down in `room`: arrival points of exits leading here, the start
// point, and `goto` destinations.
function arrivals(room) {
  const names = new Set();
  if (data.start.room === room) names.add(data.start.point);
  for (const r of Object.values(data.rooms)) for (const x of Object.values(r.exits || {})) if (x.to === room && x.at) names.add(x.at);
  for (const rule of data.rules) for (const e of [].concat(rule.do || [])) if (e.goto && e.goto[0] === room && e.goto[1]) names.add(e.goto[1]);
  return [...names].filter((n) => rooms[room].points[n]);
}

// Pixels reachable on foot from the arrivals, 8-connected like the A* walker, never
// crossing an exit zone (stepping into one leaves the room).
function reach(room) {
  const r = rooms[room], W = r.walk.w, H = r.walk.h;
  const polys = Object.values(r.zones || {}).map((z) => z.poly);
  const zone = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (polys.some((p) => pointInPoly(p, x + 0.5, y + 0.5))) zone[y * W + x] = 1;
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !zone[y * W + x] && game.walkable(room, x, y);
  const seen = new Uint8Array(W * H), stack = [];
  for (const n of arrivals(room)) {
    const [x, y] = r.points[n];
    if (game.walkable(room, x, y)) { seen[y * W + x] = 1; stack.push(y * W + x); }
  }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if ((dx || dy) && free(nx, ny) && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  // an exit target counts as reached if its own zone touches the reached floor
  const zoneReached = (poly) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!pointInPoly(poly, x + 0.5, y + 0.5) || !game.walkable(room, x, y)) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && seen[ny * W + nx]) return true;
      }
    }
    return false;
  };
  return { at: (x, y) => !!seen[Math.floor(y) * W + Math.floor(x)], zoneReached };
}

test('every point is reachable on foot, and every exit can be walked into, from where Gus enters', () => {
  const errs = [];
  for (const room of Object.keys(data.rooms)) {
    const r = rooms[room];
    if (!r) continue;
    const R = reach(room);
    for (const [name, p] of Object.entries(r.points)) {
      const inZone = Object.values(r.zones || {}).some((z) => pointInPoly(z.poly, p[0] + 0.5, p[1] + 0.5));
      if (!inZone && !R.at(p[0], p[1])) errs.push(`${room}: point ${name} ${p} unreachable from ${arrivals(room).join('/')}`);
    }
    // walking into the zone is how an exit fires; one that lies off the picture (the
    // gate's "leave" once did) answers typed commands but never a player's feet
    for (const [name, z] of Object.entries(r.zones || {})) if (!R.zoneReached(z.poly)) errs.push(`${room}: exit zone ${name} can't be walked into`);
  }
  assert.deepEqual(errs, []);
});

test('walk-mask probes: each spot is walkable or blocked as its room declares', () => {
  const errs = [];
  let n = 0;
  for (const room of Object.keys(data.rooms)) {
    const r = rooms[room];
    if (!r || !r.probes) continue;
    const R = reach(room);
    for (const [name, p] of Object.entries(r.probes)) {
      n++;
      const got = game.walkable(room, p.x, p.y);
      if (got !== p.walkable) errs.push(`${room}: probe ${name} should be ${p.walkable ? 'walkable' : 'blocked'}`);
      else if (got && !R.at(p.x, p.y)) errs.push(`${room}: probe ${name} is walkable but unreachable`);
    }
  }
  assert.ok(n > 0, 'no probes found: rooms declare them with R.probe() in pipeline/blender/rooms/*.py');
  assert.deepEqual(errs, []);
});

test('every point and zone target stands on walkable floor', () => {
  const errs = [];
  for (const room of Object.keys(data.rooms)) {
    const r = rooms[room];
    if (!r) continue;
    for (const [name, p] of Object.entries(r.points || {})) if (!game.walkable(room, p[0], p[1])) errs.push(`${room}: point ${name} ${p} not walkable`);
    for (const [name, z] of Object.entries(r.zones || {})) if (!game.walkable(room, z.target[0], z.target[1])) errs.push(`${room}: zone ${name} target not walkable`);
  }
  assert.deepEqual(errs, []);
});
