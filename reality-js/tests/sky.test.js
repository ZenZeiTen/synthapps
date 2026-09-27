import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSky, dirFromEquirect, equirectFromDir } from '../src/sky/atmosphere.js';
import { parseHDR, encodeHDR } from '../src/sky/hdr.js';
import { buildEnvDistribution, sampleEnv, envPdf } from '../src/sky/envmap.js';
import { sunDirection } from '../src/scene/camera.js';
import { blackbody, whiteBalanceGains, parseHex, luminance } from '../src/core/color.js';

const small = (sunDir) => computeSky({ sunDir, width: 128, height: 64 });

test('equirect mapping round-trips', () => {
  for (const [u, v] of [[0.1, 0.2], [0.6, 0.5], [0.95, 0.9]]) {
    const [u2, v2] = equirectFromDir(dirFromEquirect(u, v));
    assert.ok(Math.abs(u - u2) < 1e-9 && Math.abs(v - v2) < 1e-9);
  }
});

test('midday: zenith sky is blue, sun gives about 100 klx', () => {
  const s = small(sunDirection(60, 180));
  const z = s.data.subarray(0, 3);
  assert.ok(z[2] > z[1] && z[1] > z[0], `zenith ${[...z]}`);
  const E = luminance(s.sunIlluminance);
  assert.ok(E > 80000 && E < 130000, `sun illuminance ${E}`);
});

test('sunset: the sun turns red and dims', () => {
  const noon = small(sunDirection(60, 180)), dusk = small(sunDirection(2, 180));
  const [r, g, b] = dusk.sunIlluminance;
  assert.ok(r > g && g > b);
  assert.ok(luminance(dusk.sunIlluminance) < luminance(noon.sunIlluminance) / 3);
});

test('more haze brightens the sky near the sun', () => {
  const clear = computeSky({ sunDir: sunDirection(30, 180), haze: 0.5, width: 64, height: 32 });
  const hazy = computeSky({ sunDir: sunDirection(30, 180), haze: 4, width: 64, height: 32 });
  const [u, v] = equirectFromDir(sunDirection(25, 180));
  const at = (s) => { const i = Math.floor(u * 64), j = Math.floor(v * 32); return luminance(s.data.subarray((j * 64 + i) * 4)); };
  assert.ok(at(hazy) > at(clear));
});

test('HDR files round-trip', () => {
  const img = { width: 8, height: 4, data: new Float32Array(8 * 4 * 4).map((_, i) => (i % 4 === 3 ? 1 : (i * 13.7) % 5000)) };
  const back = parseHDR(new Uint8Array(encodeHDR(img)));
  assert.equal(back.width, 8);
  for (let i = 0; i < img.data.length; i++) {
    if (i % 4 === 3) continue;
    assert.ok(Math.abs(back.data[i] - img.data[i]) <= img.data[i] * 0.01 + 1e-3);
  }
});

test('the example studio HDRI parses', () => {
  const img = parseHDR(readFileSync(new URL('../examples/assets/studio.hdr', import.meta.url)));
  assert.equal(img.width, 256);
  assert.equal(img.height, 128);
});

test('environment sampling: pdf integrates to 1 and matches sampling', () => {
  const s = small(sunDirection(40, 90));
  const dist = buildEnvDistribution(s);
  // Integrate pdf over the sphere.
  let sum = 0;
  const N = 200, M = 100;
  for (let j = 0; j < M; j++) {
    const th = ((j + 0.5) / M) * Math.PI;
    for (let i = 0; i < N; i++) {
      const d = dirFromEquirect((i + 0.5) / N, (j + 0.5) / M);
      sum += envPdf(dist, d) * Math.sin(th) * (Math.PI / M) * ((2 * Math.PI) / N);
    }
  }
  assert.ok(Math.abs(sum - 1) < 0.02, `integral ${sum}`);
  // Monte Carlo estimate of total radiance through importance sampling
  // matches direct integration.
  let direct = 0;
  for (let j = 0; j < s.height; j++) {
    const th = ((j + 0.5) / s.height) * Math.PI;
    for (let i = 0; i < s.width; i++) {
      direct += luminance(s.data.subarray((j * s.width + i) * 4)) * Math.sin(th) * (Math.PI / s.height) * ((2 * Math.PI) / s.width);
    }
  }
  let mc = 0, n = 20000, seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n; k++) {
    const { dir, pdf } = sampleEnv(dist, r(), r(), r(), r());
    const [u, v] = equirectFromDir(dir);
    const i = Math.min(s.width - 1, Math.floor(u * s.width)), j = Math.min(s.height - 1, Math.floor(v * s.height));
    mc += luminance(s.data.subarray((j * s.width + i) * 4)) / pdf;
  }
  mc /= n;
  assert.ok(Math.abs(mc - direct) / direct < 0.03, `mc ${mc} direct ${direct}`);
});

test('colour: blackbody ordering and white balance', () => {
  const warm = blackbody(2700), cool = blackbody(10000), d65 = blackbody(6504);
  assert.ok(warm[0] > warm[2] && cool[2] > cool[0]);
  assert.ok(Math.abs(d65[0] - d65[2]) < 0.1, `6504 K ${d65}`);
  const g = whiteBalanceGains(6504);
  g.forEach((v) => assert.ok(Math.abs(v - 1) < 0.02));
  const tungsten = whiteBalanceGains(3200);
  assert.ok(tungsten[2] > tungsten[0]); // cancel orange by boosting blue
  assert.deepEqual(parseHex('#fff').map((v) => +v.toFixed(6)), [1, 1, 1]);
});
