import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/lang/compile.js';
import { RealityError } from '../src/lang/errors.js';
import { transformPoint, column } from '../src/core/math.js';

const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('defaults fill in an almost empty scene', () => {
  const s = compile('sphere {}');
  const snap = s.sample(0);
  assert.equal(snap.objects.length, 1);
  assert.equal(snap.environment.type, 'sky');
  assert.equal(snap.film.tonemap, 'agx');
  assert.equal(snap.camera.exposure, 'auto');
});

test('unknown properties and kinds get suggestions', () => {
  assert.throws(() => compile('sphere { radiu: 1 }'), (e) => e instanceof RealityError && e.hint === 'did you mean "radius"?');
  assert.throws(() => compile('sphre {}'), (e) => e.hint === 'did you mean "sphere"?');
});

test('types are checked with the property named', () => {
  assert.throws(() => compile('sphere { radius: [1, 2] }'), /sphere radius: needs a number/);
  assert.throws(() => compile('sphere { material: #ff0000 }'), /needs a material/);
  assert.throws(() => compile('film { tonemap: agxx }'), /did you mean "agx"/);
});

test('enum values can be bare words, even names of functions', () => {
  const s = compile('sphere { material: matte { pattern: noise } }\nfilm { tonemap: aces }');
  assert.equal(s.sample(0).objects[0].material.pattern, 3);
  assert.equal(s.sample(0).film.tonemap, 'aces');
});

test('a bare word that is not an allowed value is "not defined"', () => {
  assert.throws(() => compile('sphere { radius: big }'), /"big" is not defined/);
});

test('lens without a unit is read as millimetres, with a warning', () => {
  const s = compile('camera { lens: 50 }\nsphere {}');
  assert.equal(s.sample(0).camera.lens, 0.05);
  assert.match(s.warnings[0].message, /read as 50mm/);
});

test('groups compose transforms', () => {
  const s = compile('group { position: [1, 0, 0], rotate: [0, 90, 0]\n  sphere { position: [0, 0, 1], radius: 2 } }');
  const w = s.sample(0).objects[0].world;
  // Local +Z rotated 90° about Y points to +X.
  assert.ok(near(transformPoint(w, [0, 0, 0]), [2, 0, 0]));
  assert.ok(near(column(w, 0).map(Math.abs), [0, 0, 2]));
});

test('aim points local +Y at a target', () => {
  const s = compile('softbox { position: [0, 3, 0], aim: [0, 0, 0] }');
  const w = s.sample(0).objects[0].world;
  assert.ok(near(column(w, 1), [0, -1, 0]));
});

test('animated positions sample at any time', () => {
  const s = compile('sphere { position: [t, 0, 0] }\ntimeline { duration: 2s }');
  assert.ok(near(transformPoint(s.sample(1.5).objects[0].world, [0, 0, 0]), [1.5, 0, 0]));
});

test('geometry parameters may not change over time', () => {
  assert.throws(() => compile('torus { tube: 0.1 + t }'), /cannot change over time/);
});

test('mesh geometry requests are collected and de-duplicated', () => {
  const s = compile('torus { position: [0,0,0] }\ntorus { position: [1,0,0] }\nterrain { size: 10 }');
  assert.equal(s.geometryRequests().length, 2);
});

test('bulbs become light materials with power in lumens', () => {
  const s = compile('bulb { power: 800lm, temperature: 2700K }');
  const o = s.sample(0).objects[0];
  assert.equal(o.shape, 'sphere');
  assert.equal(o.material.isLight, true);
  assert.equal(o.material.power, 800);
});

test('materials can only go on objects', () => {
  assert.throws(() => compile('metal {}'), /does nothing/);
  assert.throws(() => compile('sphere { sphere {} }'), /wrap them in a group/);
});

test('hdri needs a file', () => {
  assert.throws(() => compile('hdri {}\nsphere {}'), /hdri needs src/);
});
