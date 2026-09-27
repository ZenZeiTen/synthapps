import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceFragment } from '../src/render/trace.glsl.js';
import * as post from '../src/render/post.glsl.js';

// Vector constructors whose arguments mix integer literals with anything
// else, e.g. vec3(0, sign(x), 0). GLSL ES allows it, and SwiftShader and
// most drivers accept it, but ANGLE's Direct3D 11 backend (Chrome and
// Edge on Windows) turns it into an HLSL overload the compiler rejects
// ("error X3067: 'vec3_ctor_int_int': ambiguous function call"), and then
// nothing renders. The browser tests cannot see this, so check the source.
function mixedConstructors(src) {
  const found = [];
  const re = /\b(vec[234])\(/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, j = re.lastIndex, cur = '';
    const args = [];
    for (; depth > 0; j++) {
      const c = src[j];
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (depth === 0) break;
      if (c === ',' && depth === 1) { args.push(cur); cur = ''; } else cur += c;
    }
    args.push(cur);
    const isInt = (a) => /^\s*-?\d+\s*$/.test(a);
    if (args.length > 1 && args.some(isInt) && !args.every(isInt)) {
      const line = src.slice(0, m.index).split('\n').length;
      found.push(`line ${line}: ${src.slice(m.index, j + 1)}`);
    }
  }
  return found;
}

test('no shader mixes integer and float arguments in a vector constructor', () => {
  const sources = { trace: traceFragment(), ...Object.fromEntries(Object.entries(post).filter(([, v]) => typeof v === 'string')) };
  for (const [name, src] of Object.entries(sources)) {
    assert.deepEqual(mixedConstructors(src), [], `${name} shader`);
  }
});

test('the check itself catches the construct that broke Direct3D', () => {
  assert.equal(mixedConstructors('n = vec3(0, sign(p.y), 0);').length, 1);
  assert.equal(mixedConstructors('n = vec3(0.0, sign(p.y), 0.0); v = vec2(0, 1); ivec2(i, 0);').length, 0);
});
