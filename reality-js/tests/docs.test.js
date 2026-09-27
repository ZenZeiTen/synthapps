import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { updated } from '../tools/gen-reference.mjs';
import { compile } from '../src/lang/compile.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('LANGUAGE.md reference matches the schemas', () => {
  const text = read('../LANGUAGE.md');
  assert.equal(updated(text), text, 'run: node tools/gen-reference.mjs');
});

test('every example compiles without warnings', () => {
  const dir = new URL('../examples/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.real'));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const scene = compile(read(`../examples/${f}`));
    assert.deepEqual(scene.warnings, [], f);
  }
});

test('code blocks in LANGUAGE.md that look like whole scenes compile', () => {
  const text = read('../LANGUAGE.md');
  const blocks = [...text.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  let checked = 0;
  for (const b of blocks) {
    // Skip fragments (property lists, loops with "...", error output).
    if (/\.\.\.|^\s*\w+:/m.test(b.split('\n')[0]) || b.includes('line 3') || b.includes('show_floor')) continue;
    if (!/^\s*(sky|let|timeline|camera|repeat)\b/m.test(b)) continue;
    compile(b);
    checked++;
  }
  assert.ok(checked >= 3, `checked ${checked} blocks`);
});

test('the README example compiles', () => {
  const block = read('../README.md').match(/```\n([\s\S]*?)```/)[1];
  assert.ok(block.includes('camera'));
  assert.deepEqual(compile(block).warnings, []);
});
