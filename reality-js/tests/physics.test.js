import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounce, fall, spring, orbit, pendulum, wobble, sampleKeys, EASINGS, GRAVITY } from '../src/scene/animation.js';
import { ev100, exposureFromEV100, cameraFrame, sunDirection, SUNNY_16_EV100 } from '../src/scene/camera.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('free fall follows h - g t² / 2', () => {
  close(fall(0.5, 10), 10 - 0.5 * GRAVITY * 0.25, 1e-12);
  assert.equal(fall(100, 10), 0);
});

test('bounce hits the ground at sqrt(2h/g) and rises to e² h', () => {
  const h = 2, e = 0.7;
  const tHit = Math.sqrt((2 * h) / GRAVITY);
  close(bounce(tHit, h, e), 0, 1e-9);
  // Apex of the first bounce: speed e*v0, so height (e v0)²/2g = e² h.
  const v1 = e * Math.sqrt(2 * GRAVITY * h);
  close(bounce(tHit + v1 / GRAVITY, h, e), e * e * h, 1e-9);
  assert.equal(bounce(1000, h, e), 0);
  // Never below the ground.
  for (let t = 0; t < 5; t += 0.01) assert.ok(bounce(t, h, e) >= 0);
});

test('spring settles at its target and overshoots when underdamped', () => {
  close(spring(20, 0, 1, 1.5, 0.3), 1, 1e-6);
  let max = 0;
  for (let t = 0; t < 3; t += 0.005) max = Math.max(max, spring(t, 0, 1, 1.5, 0.3));
  assert.ok(max > 1.2);
  let maxCrit = 0;
  for (let t = 0; t < 3; t += 0.005) maxCrit = Math.max(maxCrit, spring(t, 0, 1, 1.5, 1));
  assert.ok(maxCrit <= 1 + 1e-9);
  assert.deepEqual(spring(0, [0, 0], [1, 2]), [0, 0]);
});

test('pendulum period follows the length (with amplitude correction)', () => {
  const L = 1, A = 10;
  const T = 2 * Math.PI * Math.sqrt(L / GRAVITY) * (1 + ((A * Math.PI) / 180) ** 2 / 16);
  close(pendulum(T, L, A), A, 1e-9);
  close(pendulum(T / 2, L, A), -A, 1e-9);
});

test('orbit keeps its radius', () => {
  for (const t of [0, 0.3, 1.7]) {
    const [x, , z] = orbit(t, [0, 0, 0], 2, 4);
    close(Math.hypot(x, z), 2, 1e-12);
  }
});

test('wobble is smooth and bounded', () => {
  let prev = wobble(0, 0.05);
  for (let t = 0.01; t < 5; t += 0.01) {
    const w = wobble(t, 0.05);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(w[k]) < 0.1);
      assert.ok(Math.abs(w[k] - prev[k]) < 0.01);
    }
    prev = w;
  }
});

test('easings start at 0 and end at 1', () => {
  for (const [name, f] of Object.entries(EASINGS)) {
    close(f(0), 0, 1e-9);
    close(f(1), 1, 1e-9);
    assert.ok(Number.isFinite(f(0.5)), name);
  }
});

test('keys hold outside their range', () => {
  const k = [{ time: 1, value: 5 }, { time: 2, value: 7 }];
  assert.equal(sampleKeys(k, 0), 5);
  assert.equal(sampleKeys(k, 3), 7);
});

test('sunny 16: a white page in sunlight lands near mid-scale', () => {
  // f/16, 1/100 s, ISO 100 is about EV 14.6.
  close(SUNNY_16_EV100, 14.64, 0.01);
  const lum = (0.9 * 100000) / Math.PI; // luminance of a white page under ~100k lux
  const v = lum * exposureFromEV100(SUNNY_16_EV100);
  assert.ok(v > 0.8 && v < 1.3, `exposed value ${v}`);
});

test('EV follows the exposure triangle', () => {
  close(ev100(2.8, 1 / 60, 100) - ev100(2.8, 1 / 60, 400), 2, 1e-12);
  close(ev100(4, 1 / 60, 100) - ev100(2.8, 1 / 60, 100), 1, 0.05); // f/2.8 is nominally sqrt(8)
});

test('camera frame: field of view, depth of field, orthonormal basis', () => {
  const p = {
    position: [0, 0, 5], look_at: [0, 0, 0], up: [0, 1, 0], roll: 0, lens: 0.05, sensor: 0.036, fov: null,
    aperture: 2, focus: 'auto', shutter: null, iso: 100, exposure: 'auto', exposure_compensation: 0,
    blades: 0, blade_rotation: 0, rolling_shutter: 0, distortion: 0,
  };
  const c = cameraFrame(p, 1.5, 1 / 48);
  close(c.tanHalfW, 0.36, 1e-12);
  close(c.tanHalfH, 0.24, 1e-12);
  close(c.focus, 5, 1e-12);
  close(c.lensRadius, 0.05 / 2 / 2, 1e-12);
  close(c.shutter, 1 / 48, 1e-12);
  assert.deepEqual(c.forward, [0, 0, -1]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  close(dot(c.right, c.up), 0, 1e-12);
  close(dot(c.right, c.forward), 0, 1e-12);
});

test('sun direction: azimuth 90 is east (+X)', () => {
  const d = sunDirection(0, 90);
  close(d[0], 1, 1e-12);
  close(sunDirection(90, 0)[1], 1, 1e-12);
});
