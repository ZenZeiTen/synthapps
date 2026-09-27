// Renders scenes in headless Chromium (WebGL2 on SwiftShader, no GPU
// needed) and checks the results. Slower than the unit tests:
//   npm run test:browser
// Skips with a message when Playwright is not installed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let b = null, skip = null;
before(async () => {
  try {
    const { launch } = await import('./run.mjs');
    b = await launch();
  } catch (err) {
    skip = `Playwright/Chromium not available: ${err.message.split('\n')[0]}`;
  }
});
after(async () => { await b?.close(); });

const still = (opts) => b.page.evaluate((o) => window.renderStill(o), { width: 160, height: 90, ...opts });
const lum = ([r, g, b2]) => 0.2126 * r + 0.7152 * g + 0.0722 * b2;

test('the shaders compile and a scene renders', async (t) => {
  if (skip) return t.skip(skip);
  const r = await still({ source: 'sky {}\nground {}\nsphere { position: [0, 1, 0] }', samples: 4 });
  assert.equal(r.glError, 0);
  assert.ok(lum(r.mean) > 30 && lum(r.mean) < 230, `mean ${r.mean}`);
  assert.deepEqual(b.logs, []);
});

test('the sky is bluer at the top than the ground is', async (t) => {
  if (skip) return t.skip(skip);
  const r = await still({ source: 'camera { look_at: [0, 1.6, -1] }\nsky { sun_elevation: 50 }\nground {}', samples: 4, probes: [[80, 5], [80, 85]] });
  const [sky, ground] = r.probes;
  assert.ok(sky[2] > sky[0], `sky ${sky}`);
  assert.ok(sky[2] - sky[0] > ground[2] - ground[0], `ground ${ground}`);
});

// White furnace: a white object lit by a uniform environment of the same
// brightness must disappear. Any energy gain or loss in the integrator
// shows up as a visible sphere.
for (const [name, material] of [
  ['diffuse', 'material { color: 1, specular: 0, roughness: 1 }'],
  ['mirror', 'metal { color: 1, roughness: 0 }'],
  ['glass', 'glass { }'],
]) {
  test(`white furnace: a ${name} sphere vanishes`, async (t) => {
    if (skip) return t.skip(skip);
    const source = `
      camera { position: [0, 0, 4], look_at: [0, 0, 0], exposure: manual, iso: 100, shutter: 1/100s, aperture: f/8 }
      background { color: 1, intensity: 100 }
      film { tonemap: none, bloom: 0, vignette: 0, denoise: false, clamp: 0, white_balance: 6504 }
      render { bounces: 64 }
      sphere { radius: 1, material: ${material} }`;
    const r = await still({ source, samples: 64, probes: [[80, 45, 6], [5, 5, 3]] });
    const [centre, corner] = r.probes;
    assert.ok(Math.abs(lum(centre) - lum(corner)) < 6, `centre ${centre} vs background ${corner}`);
  });
}

test('manual exposure: two more stops of ISO is brighter', async (t) => {
  if (skip) return t.skip(skip);
  const scene = (iso) => `camera { exposure: manual, iso: ${iso}, shutter: 1/4000s, aperture: f/16 }\nsky {}\nground {}\nfilm { tonemap: none, bloom: 0 }`;
  const a = await still({ source: scene(100), samples: 2 });
  const c = await still({ source: scene(400), samples: 2 });
  assert.ok(lum(c.mean) > lum(a.mean) * 1.5, `${lum(a.mean)} -> ${lum(c.mean)}`);
});

test('motion blur smears a moving object', async (t) => {
  if (skip) return t.skip(skip);
  const scene = (speed) => `
    timeline { duration: 1s, time: 0.5s }
    camera { position: [0, 0, 5], look_at: [0, 0, 0], shutter: 1/10s, aperture: 0 }
    background { color: 0.05 }
    film { bloom: 0 }
    sphere { position: [${speed} * (t - 0.5), 0, 0], radius: 0.4, material: material { emission: 1, emission_strength: 50 } }`;
  // Probe just outside the resting sphere's edge, along the motion.
  const still_ = await still({ source: scene(0), samples: 16, probes: [[100, 45, 2]] });
  const moving = await still({ source: scene(20), samples: 16, probes: [[100, 45, 2]] });
  assert.ok(lum(moving.probes[0]) > lum(still_.probes[0]) + 10, `${still_.probes[0]} vs ${moving.probes[0]}`);
});

test('meshes, textures and an HDRI load from files', async (t) => {
  if (skip) return t.skip(skip);
  const r = await still({ url: '/examples/studio-product.real', samples: 2, width: 160, height: 90 });
  assert.equal(r.glError, 0);
  assert.deepEqual(r.warnings, []);
  assert.ok(lum(r.mean) > 30);
});

test('scene errors come back formatted with the line', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(still({ source: 'sphere {\n  radius: 1\n  colr: #fff\n}' }), /line 3.*no property "colr"[\s\S]*did you mean "color"/);
});

test('a timeline renders to a WebM a browser can play', async (t) => {
  if (skip) return t.skip(skip);
  const source = 'timeline { duration: 0.25s, fps: 24 }\nsky {}\nground {}\nsphere { position: [t * 4, 1, 0] }';
  const v = await b.page.evaluate((s) => window.renderMovie({ source: s, samples: 2, width: 96, height: 54 }), source);
  if (v.frames) return t.skip('this Chromium has no WebCodecs video encoder');
  const probe = await b.page.evaluate((d) => window.probeVideo(d), v.data);
  assert.equal(probe.width, 96);
  assert.equal(probe.height, 54);
  assert.ok(Math.abs(probe.duration - 0.25) < 0.05, `duration ${probe.duration}`);
});
