import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/lang/compile.js';
import { packScene, objectArea, OBJECT_TEXELS, MATERIAL_TEXELS, LIGHT_TEXELS, SHAPES } from '../src/render/pack.js';
import { invert } from '../src/core/math.js';

test('objects carry inverse matrices at shutter open and close', () => {
  const s = compile('sphere { position: [t, 0, 0] }');
  const packed = packScene(s.sample(0), s.sample(1));
  const o = packed.objects;
  assert.equal(o[0], SHAPES.sphere);
  assert.equal(o[3], -1); // not a light
  // Row 0 of the inverse translation: x - t.
  assert.equal(o[4 + 3], -0);
  assert.equal(o[16 + 3], -1);
});

test('lights in lumens become radiance over their area', () => {
  const s = compile('bulb { position: [0, 1, 0], radius: 0.1, power: 1000lm, color: [1, 1, 1] }');
  const snap = s.sample(0);
  const packed = packScene(snap, snap);
  assert.equal(packed.lightCount, 1);
  const L = packed.materials[8]; // texel 2: emission.r
  const area = 4 * Math.PI * 0.01;
  assert.ok(Math.abs(L / (1000 / (Math.PI * area)) - 1) < 1e-6);
  // Light record: sphere, object 0, area, centre, radius.
  const l = packed.lights;
  assert.equal(l[0], 0);
  assert.ok(Math.abs(l[2] / area - 1) < 1e-6);
  assert.deepEqual([...l.subarray(4, 8)].map((v) => +v.toFixed(6)), [0, 1, 0, 0.1]);
});

test('softbox area and one-sided quad light', () => {
  const s = compile('softbox { position: [0, 2, 0], size: [2, 0.5], power: 1000lm }');
  const snap = s.sample(0);
  assert.ok(Math.abs(objectArea(snap.objects[0]) - 1) < 1e-9);
  const packed = packScene(snap, snap);
  assert.equal(packed.lights[0], 1);
});

test('an emissive plane with power warns instead of dividing by infinity', () => {
  const s = compile('plane { material: light { power: 100lm } }');
  const snap = s.sample(0);
  const packed = packScene(snap, snap);
  assert.equal(packed.warnings.length, 1);
  assert.equal(packed.lightCount, 0);
});

test('record sizes match the shader constants', () => {
  const s = compile('sphere {}\nbox {}\nquad { material: light {} }');
  const snap = s.sample(0);
  const p = packScene(snap, snap);
  assert.equal(p.objects.length, 3 * OBJECT_TEXELS * 4);
  assert.equal(p.materials.length, 3 * MATERIAL_TEXELS * 4);
  assert.equal(p.lights.length, 1 * LIGHT_TEXELS * 4);
  const inv = invert(snap.objects[1].world);
  assert.deepEqual([...p.objects.subarray(OBJECT_TEXELS * 4 + 4, OBJECT_TEXELS * 4 + 16)], inv.map(Math.fround));
});
