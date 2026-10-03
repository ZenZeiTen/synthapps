// The Claude Code skill in plugins/reality-js must stay true to the language:
// its cheat sheet is generated from the schemas, its templates compile
// cleanly, and its checker reports what it claims to.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cheatsheet, FILE } from '../tools/gen-cheatsheet.mjs';
import { compile } from '../src/lang/compile.js';

const SKILL = fileURLToPath(new URL('../plugins/reality-js/skills/reality-js/', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = join(SKILL, 'scripts', 'check.mjs');

function check(file, ...extra) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CHECK, file, '--root', ROOT, ...extra], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: err.stdout };
  }
}

test('the skill cheat sheet matches the schemas', () => {
  assert.equal(readFileSync(FILE, 'utf8'), cheatsheet(), 'run: node tools/gen-cheatsheet.mjs');
});

test('every skill template compiles without warnings', () => {
  const dir = join(SKILL, 'templates');
  const files = readdirSync(dir).filter((f) => f.endsWith('.real'));
  assert.ok(files.length >= 7);
  for (const f of files) {
    const scene = compile(readFileSync(join(dir, f), 'utf8'));
    scene.sample(scene.timeline.time);
    assert.deepEqual(scene.warnings, [], f);
  }
});

test('the checker passes a clean scene and estimates its cost', () => {
  const r = check(join(SKILL, 'templates', 'night-bokeh.real'), '--json');
  assert.equal(r.code, 0);
  const report = JSON.parse(r.out);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.summary.features, ['HAS_LIGHTS']);
  assert.equal(report.summary.exposure, 'manual');
  assert.equal(report.estimate.stillPaths, 1280 * 720 * 512);
});

test('the checker reports errors with a hint and flags common mistakes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reality-check-'));
  try {
    const bad = join(dir, 'bad.real');
    writeFileSync(bad, 'sphere { colr: #fff }\n');
    const r1 = check(bad);
    assert.equal(r1.code, 1);
    assert.match(r1.out, /did you mean "color"/);

    const risky = join(dir, 'risky.real');
    writeFileSync(risky, [
      'background { intensity: 0.5 }',
      'box { material: light { intensity: 500 } }',
      'sphere { position: [sin(t * 90), 1, 0], material: glass { } }',
      'render { bounces: 3 }',
      'mesh { src: "missing.obj" }',
    ].join('\n'));
    const r2 = JSON.parse(check(risky, '--json').out);
    const text = [...r2.errors, ...r2.warnings, ...r2.notes].join('\n');
    assert.match(text, /missing\.obj" not found/);
    assert.match(text, /not sampled directly/);
    assert.match(text, /exposure is auto/);
    assert.match(text, /bounces: 3 looks dark/);
    assert.match(text, /timeline duration is 0/);

    const glow = join(dir, 'glow.real');
    writeFileSync(glow, 'background { intensity: 0.2 }\nbulb { position: [0, 2, 0] }\nfilm { bloom: 0.06, halation: 0.3 }\nground { }\n');
    const r3 = JSON.parse(check(glow, '--json').out);
    assert.ok(r3.warnings.some((w) => /bloom 0.06 with lamps/.test(w)), r3.warnings.join('\n'));
    assert.ok(!r3.warnings.some((w) => /halation/.test(w)), 'halation is safe with lamps in view');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the checker estimates with a measured CPU speed', () => {
  const scene = join(SKILL, 'templates', 'physics-motion.real');
  const idle = JSON.parse(check(scene, '--json', '--size', '320x180', '--samples', '16').out).estimate;
  const busy = JSON.parse(check(scene, '--json', '--size', '320x180', '--samples', '16', '--cpu-speed', '0.1').out).estimate;
  assert.equal(idle.videoPaths, 320 * 180 * 16 * 96);
  assert.ok(Math.abs(busy.videoCpu / idle.videoCpu - 3) < 1e-9);
});
