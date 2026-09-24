// The single-file build (tools/bundle_web.mjs): its hand-rolled ES-module linker and the
// content embedding. The shipped page is only as trustworthy as these two pieces.
//   node --test tests/bundle.test.mjs
// CROWMERE_BUNDLER=<path> points the suite at another copy (tests/mutation_bundle.mjs
// uses that to prove each test can fail).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './harness.mjs';

const BUNDLER = process.env.CROWMERE_BUNDLER || path.join(ROOT, 'tools', 'bundle_web.mjs');
const { exportedNames, linkModules, buildBundle } = await import(pathToFileURL(BUNDLER).href);

function tempDir(files, prefix = 'crowmere-link-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('exportedNames sees every declarator, across lines and past comments', () => {
  const src = [
    "export const A = 1, B = [1, 2], C = { d: 'x, y' };   // it's a comment, with a comma",
    'export const EGA = [',
    "  [0, 0, 0],  // Gus's black, (unbalanced",
    '  [1, 1, 1],',
    '];',
    'export function f(a, b) { return a + b; }',
    'export class K {}',
    'const hidden = 1;',
  ].join('\n');
  assert.deepEqual([...exportedNames(src)].sort(), ['A', 'B', 'C', 'EGA', 'K', 'f']);
});

test('linked modules run, alias correctly and see their dependencies first', async () => {
  const dir = tempDir({
    'main.js': [
      "import { A as X, B } from './a.js';",
      "import { twice } from './b.js';",
      'globalThis.__crowmereLink = [X, B, twice(B)];',
    ].join('\n'),
    'a.js': 'export const A = 1, B = 2;\n',
    'b.js': "import { B } from './a.js';\nexport function twice(v) { return v * B; }\n",
  });
  const { js, order } = linkModules(dir, 'main.js');
  assert.deepEqual(order, ['a.js', 'b.js', 'main.js']);
  const out = path.join(dir, 'out.mjs');
  fs.writeFileSync(out, js);
  await import(pathToFileURL(out).href);
  assert.deepEqual(globalThis.__crowmereLink, [1, 2, 4]);
});

test('the linker refuses what it does not understand, and says why', () => {
  const cases = [
    ['export default 1;\n', /export default/],
    ['export const Z = 1;\n', /imports Y, which a\.js does not export/],
    ["export const Y = () => import('./x.js');\n", /dynamic import/],
  ];
  for (const [aSrc, why] of cases) {
    const dir = tempDir({ 'main.js': "import { Y } from './a.js';\nY;\n", 'a.js': aSrc });
    assert.throws(() => linkModules(dir, 'main.js'), why);
  }
});

test('the real game links into valid module syntax, entry last', () => {
  const { js, order } = linkModules(path.join(ROOT, 'web', 'src'), 'main.js');
  assert.equal(order.at(-1), 'main.js');
  assert.ok(order.indexOf('gfx.js') < order.indexOf('world.js'));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crowmere-check-')), 'bundle.mjs');
  fs.writeFileSync(out, js);
  const r = spawnSync(process.execPath, ['--check', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('content is embedded whole, and no "<" survives to end the script early', () => {
  const dir = tempDir({
    'game.json': JSON.stringify({ text: 'Beware </script> and <!-- here' }),
    'sfx/a.wav': 'RIFF',
    'rooms/x/bg.png': 'PNG',
  }, 'crowmere-content-');
  const data = buildBundle(dir);
  assert.ok(!data.includes('<'), 'a raw "<" reached the inline script');
  const b = JSON.parse(data);
  assert.deepEqual(Object.keys(b).sort(), ['game.json', 'rooms/x/bg.png', 'sfx/a.wav']);
  assert.equal(b['game.json'].text, 'Beware </script> and <!-- here');
  assert.equal(b['sfx/a.wav'], 'data:audio/wav;base64,' + Buffer.from('RIFF').toString('base64'));

  const real = JSON.parse(buildBundle(path.join(ROOT, 'content')));
  assert.equal(typeof real['game.json'].rooms, 'object');
  for (const id of Object.keys(real['game.json'].rooms)) assert.ok(real[`rooms/${id}/room.json`], `rooms/${id}/room.json missing`);
});
