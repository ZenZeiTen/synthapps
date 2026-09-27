import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../src/lang/lexer.js';
import { parse } from '../src/lang/parser.js';
import { evaluate } from '../src/lang/evaluator.js';
import { resolve, isTimeVarying } from '../src/lang/signal.js';
import { RealityError } from '../src/lang/errors.js';

const nodes = (src) => evaluate(parse(src)).nodes;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('numbers carry units into base units', () => {
  const t = tokenize('50mm 12deg 1.5m 500ms 3200K 50% 2rad');
  close(t[0].value, 0.05);
  close(t[1].value, 12);
  close(t[2].value, 1.5);
  close(t[3].value, 0.5);
  close(t[4].value, 3200);
  close(t[5].value, 0.5);
  close(t[6].value, 2 * 180 / Math.PI);
});

test('f-numbers, colours and comments', () => {
  const t = tokenize('aperture: f/2.8 # comment\ncolor: #ff8800 // also a comment\n/* block */ x');
  assert.deepEqual(t.filter((k) => k.type !== 'eof').map((k) => k.type), ['ident', 'op', 'fstop', 'ident', 'op', 'color', 'ident']);
  assert.equal(t[2].value, 2.8);
});

test('unknown units get a suggestion', () => {
  assert.throws(() => tokenize('5mn'), (e) => e instanceof RealityError && /unknown unit/.test(e.message) && e.hint.includes('"m'));
});

test('a range is not swallowed by the number before it', () => {
  const t = tokenize('0..10');
  assert.deepEqual(t.slice(0, 3).map((k) => k.value), [0, '..', 10]);
});

test('operator precedence and vectors', () => {
  const [n] = nodes('sphere { position: [1 + 2 * 3, -2 ^ 2, (1 + 1) * 2], radius: 10 % 4 }');
  assert.deepEqual(n.get('position'), [7, -4, 4]);
  assert.equal(n.get('radius'), 2);
});

test('vector arithmetic broadcasts scalars', () => {
  const [n] = nodes('sphere { position: [1, 2, 3] * 2 + [1, 1, 1] }');
  assert.deepEqual(n.get('position'), [3, 5, 7]);
});

test('trigonometry is in degrees', () => {
  const [n] = nodes('sphere { radius: sin(90) + cos(180) + sin(90deg) }');
  close(n.get('radius'), 1);
});

test('let, repeat and if', () => {
  const out = nodes(`
    let r = 0.5
    repeat i in 0..4 {
      if i % 2 == 0 { sphere { radius: r, position: [i, 0, 0] } } else { box { size: r } }
    }
    repeat c in [1, 2] { disk { radius: c } }
  `);
  assert.deepEqual(out.map((n) => n.kind), ['sphere', 'box', 'sphere', 'box', 'disk', 'disk']);
  assert.deepEqual(out[2].get('position'), [2, 0, 0]);
});

test('inclusive range', () => {
  assert.equal(nodes('repeat i in 1..=3 { sphere {} }').length, 3);
});

test('copying a node with changes', () => {
  const out = nodes(`
    let ball = sphere { radius: 0.2, position: [0, 0.2, 0] }
    ball { position: [1, 0.2, 0] }
    ball
  `);
  assert.equal(out.length, 2);
  assert.equal(out[0].get('radius'), 0.2);
  assert.deepEqual(out[0].get('position'), [1, 0.2, 0]);
  assert.deepEqual(out[1].get('position'), [0, 0.2, 0]);
});

test('an if-block body is not read as a node', () => {
  const out = nodes('let on = true\nif on { sphere {} }');
  assert.equal(out.length, 1);
});

test('time makes values into signals that resolve per instant', () => {
  const [n] = nodes('sphere { position: [t * 2, sin(t * 90), 0] }');
  const p = n.get('position');
  assert.ok(isTimeVarying(p));
  assert.deepEqual(resolve(p, 0).map((v) => +v.toFixed(9)), [0, 0, 0]);
  assert.deepEqual(resolve(p, 1).map((v) => +v.toFixed(9)), [2, 1, 0]);
});

test('ternary with a time-varying condition', () => {
  const [n] = nodes('sphere { radius: t < 1 ? 1 : 2 }');
  assert.equal(resolve(n.get('radius'), 0.5), 1);
  assert.equal(resolve(n.get('radius'), 1.5), 2);
});

test('keys interpolate with easing', () => {
  const [n] = nodes('sphere { position: keys { 0s: [0, 0, 0]  2s: [2, 0, 0] ease linear  3s: [2, 1, 0] } }');
  const p = n.get('position');
  assert.deepEqual(resolve(p, -1), [0, 0, 0]);
  assert.deepEqual(resolve(p, 1), [1, 0, 0]);
  assert.deepEqual(resolve(p, 2.5), [2, 0.5, 0]); // in_out at the midpoint
  assert.deepEqual(resolve(p, 9), [2, 1, 0]);
});

test('repeat and if refuse to depend on time', () => {
  assert.throws(() => nodes('repeat i in 0..t { sphere {} }'), /cannot change over time|fixed range/);
  assert.throws(() => nodes('if t > 1 { sphere {} }'), /cannot depend on time/);
});

test('swizzles and indexing', () => {
  const [n] = nodes('let v = [1, 2, 3]\nsphere { position: v.zyx, radius: v[-1] }');
  assert.deepEqual(n.get('position'), [3, 2, 1]);
  assert.equal(n.get('radius'), 3);
});

test('errors point at the line and suggest names', () => {
  const src = 'let radius = 1\nsphere {\n  radius: radus + 1\n}';
  try {
    nodes(src);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof RealityError);
    assert.equal(e.loc.line, 3);
    assert.match(e.hint, /radius/);
    assert.match(e.format(src), /\n\s+3 \|   radius: radus \+ 1\n\s+\^/);
  }
});

test('a line that does nothing is an error', () => {
  assert.throws(() => nodes('1 + 2'), /does nothing/);
});

test('parser reports missing braces', () => {
  assert.throws(() => parse('sphere { radius: 1'), /missing "}"/);
});

test('imports are evaluated in place', () => {
  const lib = parse('let gold2 = metal { roughness: 0.1 }');
  const { nodes: out } = evaluate(parse('import "lib.real"\nsphere { material: gold2 }'), { imports: new Map([['lib.real', lib]]) });
  assert.equal(out[0].get('material').kind, 'metal');
});
