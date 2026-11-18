// Which background track plays when (web/src/music.js). godot/tests/music_policy.gd
// checks the GDScript twin against the same cases; tests/verify_music.py checks the
// rendered audio itself.
//   node --test tests/music.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { musicFor } from '../web/src/music.js';
import { ROOT } from './harness.mjs';

const INDEX = { tracks: { t: {}, a: {}, b: {}, e: {} }, title: 't', ending: 'e', rooms: { hall: 'a', cellar: 'b' } };

test('the title screen and the ending have their own tracks', () => {
  assert.equal(musicFor('title', undefined, INDEX), 't');
  assert.equal(musicFor('ending', { room: 'cellar' }, INDEX), 'e');
});

test('each room plays the track its index names', () => {
  assert.equal(musicFor('play', { room: 'hall', dead: false }, INDEX), 'a');
  assert.equal(musicFor('play', { room: 'cellar', dead: false }, INDEX), 'b');
});

test('silence while Gus lies dead, in unlisted rooms, and without an index', () => {
  assert.equal(musicFor('play', { room: 'hall', dead: true }, INDEX), null);
  assert.equal(musicFor('play', { room: 'attic', dead: false }, INDEX), null);
  assert.equal(musicFor('play', { room: 'hall', dead: false }, null), null);
});

test('the shipped index gives every room, the title and the ending a real track', () => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'music', 'music.json'), 'utf8'));
  const game = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'game.json'), 'utf8'));
  const missing = [];
  for (const room of Object.keys(game.rooms)) {
    const id = musicFor('play', { room, dead: false }, index);
    if (!id || !index.tracks[id]) missing.push(room);
  }
  for (const mode of ['title', 'ending']) if (!index.tracks[musicFor(mode, undefined, index)]) missing.push(mode);
  assert.deepEqual(missing, []);
});
