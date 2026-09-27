import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBVH, intersectBVH, intersectTri } from '../src/geometry/bvh.js';
import { torus, terrain, rock, parseOBJ, icosphere } from '../src/geometry/mesh.js';
import { packMeshes } from '../src/render/pack.js';
import { invert, multiply, compose, eulerToMat3, IDENTITY } from '../src/core/math.js';

function randomRays(n, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const ro = [r() * 8 - 4, r() * 4 + 0.5, r() * 8 - 4];
    const d = [r() - 0.5, -r(), r() - 0.5];
    const l = Math.hypot(...d);
    return [ro, d.map((v) => v / l)];
  });
}

function bruteForce(P, n, ro, rd) {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = intersectTri(P, i, ro, rd);
    if (t > 1e-7 && t < best) best = t;
  }
  return best;
}

for (const [name, make] of [['torus', () => torus(1, 0.3, 48)], ['terrain', () => terrain({ size: 8, resolution: 48 })], ['rock', () => rock({ detail: 3 })]]) {
  test(`BVH over a ${name} finds the same hits as brute force`, () => {
    const m = make().withBVH();
    for (const [ro, rd] of randomRays(200)) {
      const a = intersectBVH(m.bvh, m.positions, ro, rd).t;
      const b = bruteForce(m.positions, m.count, ro, rd);
      if (a === Infinity || b === Infinity) assert.equal(a, b);
      else assert.ok(Math.abs(a - b) < 1e-6);
    }
  });
}

test('every triangle sits in exactly one leaf and inside its bounds', () => {
  const m = torus(1, 0.3, 32);
  const { nodes, order } = buildBVH(m.positions);
  const seen = new Int32Array(m.count);
  const walk = (i) => {
    const o = i * 8;
    if (nodes[o + 7] > 0) {
      for (let k = nodes[o + 3]; k < nodes[o + 3] + nodes[o + 7]; k++) {
        const t = order[k];
        seen[t]++;
        for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
          const x = m.positions[t * 9 + v * 3 + a];
          assert.ok(x >= nodes[o + a] - 1e-6 && x <= nodes[o + 4 + a] + 1e-6);
        }
      }
    } else {
      walk(nodes[o + 3]);
      walk(nodes[o + 3] + 1);
    }
  };
  walk(0);
  assert.ok(seen.every((c) => c === 1));
});

test('generated normals point outward', () => {
  const r = rock({ seed: 3 });
  for (let i = 0; i < r.positions.length; i += 3) {
    const d = r.positions[i] * r.normals[i] + r.positions[i + 1] * r.normals[i + 1] + r.positions[i + 2] * r.normals[i + 2];
    assert.ok(d > 0);
  }
  const { verts } = icosphere(2);
  assert.equal(verts.length, 162);
});

test('OBJ: polygons, negative indices, missing normals', () => {
  const quad = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nf -4 -3 -2 -1\n');
  assert.equal(quad.count, 2);
  assert.ok(Math.abs(Math.abs(quad.normals[1]) - 1) < 1e-6);
  assert.throws(() => parseOBJ('v 0 0 0\n'), /no faces/);
});

test('the example vase loads and fits', () => {
  const m = parseOBJ(readFileSync(new URL('../examples/assets/vase.obj', import.meta.url), 'utf8'));
  assert.ok(m.count > 1000);
  const b = m.fit(1).bounds();
  assert.ok(Math.abs(b.lo[1]) < 1e-6);
  assert.ok(Math.abs(Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]) - 1) < 1e-6);
});

test('packing several meshes offsets node and triangle indices', () => {
  const a = torus(1, 0.2, 16).withBVH(), b = torus(1, 0.2, 24).withBVH();
  const packed = packMeshes(new Map([['a', a], ['b', b]]));
  const rootB = packed.roots.get('b');
  assert.equal(rootB, a.bvh.nodes.length / 8);
  // Walk mesh b inside the packed arrays and count its triangles.
  let tris = 0;
  const walk = (i) => {
    const o = i * 8;
    if (packed.bvh[o + 7] > 0) {
      assert.ok(packed.bvh[o + 3] >= a.count);
      tris += packed.bvh[o + 7];
    } else {
      walk(packed.bvh[o + 3]);
      walk(packed.bvh[o + 3] + 1);
    }
  };
  walk(rootB);
  assert.equal(tris, b.count);
});

test('matrix inverse and composition', () => {
  const m = compose([1, 2, 3], eulerToMat3(10, 20, 30), [2, 3, 4]);
  const id = multiply(m, invert(m));
  id.forEach((v, i) => assert.ok(Math.abs(v - IDENTITY[i]) < 1e-12));
});
