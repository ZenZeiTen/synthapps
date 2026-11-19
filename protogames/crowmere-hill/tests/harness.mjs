// Transcript harness (Node side). godot/tests/run_transcripts.gd mirrors this file;
// both must render events to the exact same lines.
//
// Transcript file format -- one file is both the input and the golden output:
//   # comment            echoed verbatim
//   @start               new game; emits the opening room description
//   @near <entity>       teleport to the entity's `at` point
//   @at <x> <y>          teleport to a pixel position
//   @walkin <exitId>     walk into an exit's zone on foot (the UI path, not typed)
//   > command            run a command; everything up to the next input line is its output
// Output lines are regenerated from the events, never read, so recording is a rewrite.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../web/src/core.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// CROWMERE_ROOT lets the mutation checks point every suite at a doctored copy of content/
const CONTENT_ROOT = process.env.CROWMERE_ROOT || ROOT;

export function loadContent(root = CONTENT_ROOT) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'content', 'game.json'), 'utf8'));
  const rooms = {};
  for (const id of Object.keys(data.rooms)) {
    const p = path.join(root, 'content', 'rooms', id, 'room.json');
    rooms[id] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }
  return { data, rooms };
}

export function renderEvents(game, state, events, out) {
  for (const e of events) {
    switch (e.t) {
      case 'say': out.push(e.text); break;
      case 'score': out.push(`[score +${e.delta} = ${e.total}]`); break;
      case 'room': out.push(`[room ${e.room}]`); break;
      case 'sound': out.push(`[sound ${e.name}]`); break;
      case 'meta': out.push(`[meta ${e.what}]`); break;
      case 'die': out.push(`[died] ${e.text}`); break;
      case 'win': out.push(`[won] ${e.text}`); break;
      case 'walkto': {
        if (e.exit) {
          out.push(`[walk ${e.exit}]`);
          const x = game.data.rooms[state.room].exits[e.exit];
          const z = game.zone(state.room, x.zone);
          if (z) state.pos = { x: z.target[0], y: z.target[1] };
          renderEvents(game, state, game.enterZone(state, e.exit).events, out);
        } else {
          out.push(`[walk to ${e.point}]`);
          const p = game.point(state.room, e.point);
          if (p) state.pos = { x: p[0], y: p[1] };
        }
        break;
      }
      default: throw new Error('unknown event ' + JSON.stringify(e));
    }
  }
}

const isInput = (line) => line.startsWith('>') || line.startsWith('@') || line.startsWith('#');

export function runTranscript(game, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let state = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!isInput(line)) continue;              // expected output: regenerated below
    out.push(line);
    if (line.startsWith('#')) continue;
    if (line === '@start') {
      state = game.newState();
      renderEvents(game, state, game.start(state), out);
    } else if (line.startsWith('@near ')) {
      const id = line.slice(6).trim();
      const at = game.entities[id] && game.entities[id].def.at;
      const p = at && game.point(state.room, at);
      if (!p) throw new Error(`@near ${id}: no point in ${state.room}`);
      state.pos = { x: p[0], y: p[1] };
    } else if (line.startsWith('@walkin ')) {
      // what the UI does when Gus walks into an exit zone on his own feet
      const exitId = line.slice(8).trim();
      const x = game.data.rooms[state.room].exits[exitId];
      if (!x) throw new Error(`@walkin ${exitId}: no such exit in ${state.room}`);
      const z = game.zone(state.room, x.zone);
      state.pos = { x: z.target[0], y: z.target[1] };
      const res = game.enterZone(state, exitId);
      renderEvents(game, state, res.events, out);
      if (res.blocked) out.push('[blocked]');
    } else if (line.startsWith('@at ')) {
      const [x, y] = line.slice(4).trim().split(/\s+/).map(Number);
      state.pos = { x, y };
    } else if (line.startsWith('>')) {
      if (!state) throw new Error('command before @start: ' + line);
      renderEvents(game, state, game.command(state, line.slice(1).trim()), out);
    } else {
      throw new Error('unknown directive ' + line);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const expected = lines.map((l) => l.replace(/\s+$/, ''));
  while (expected.length && expected[expected.length - 1] === '') expected.pop();
  return { actual: out.join('\n') + '\n', expected: expected.join('\n') + '\n' };
}

export function makeGame(root = CONTENT_ROOT) {
  const { data, rooms } = loadContent(root);
  return new Game(data, rooms);
}
