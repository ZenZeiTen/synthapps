// Triangle meshes: a Wavefront OBJ reader and procedural generators
// (torus, terrain, rock). Every mesh ends up as flat triangle soup:
//   positions: Float32Array, 9 per triangle
//   normals:   Float32Array, 9 per triangle (per-vertex shading normals)
//   uvs:       Float32Array, 6 per triangle

import { fbm3, noise3, random01 } from '../core/noise.js';
import { buildBVH } from './bvh.js';

export class TriangleMesh {
  constructor(positions, normals, uvs) {
    this.positions = positions;
    this.normals = normals;
    this.uvs = uvs ?? new Float32Array((positions.length / 9) * 6);
  }

  get count() { return this.positions.length / 9; }

  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], this.positions[i + a]);
        hi[a] = Math.max(hi[a], this.positions[i + a]);
      }
    }
    return { lo, hi };
  }

  area() {
    const p = this.positions;
    let s = 0;
    for (let o = 0; o < p.length; o += 9) {
      const e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]];
      const e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
      const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      s += 0.5 * Math.hypot(c[0], c[1], c[2]);
    }
    return s;
  }

  // Scale and move so the largest side is `size` and the model rests on y=0,
  // centred in x and z.
  fit(size) {
    const { lo, hi } = this.bounds();
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    const k = size / ext;
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] = (this.positions[i] - cx) * k;
      this.positions[i + 1] = (this.positions[i + 1] - lo[1]) * k;
      this.positions[i + 2] = (this.positions[i + 2] - cz) * k;
    }
    return this;
  }

  // Build the BVH and reorder triangles to match it.
  withBVH() {
    const bvh = buildBVH(this.positions);
    const n = this.count;
    const P = new Float32Array(n * 9), N = new Float32Array(n * 9), U = new Float32Array(n * 6);
    for (let k = 0; k < n; k++) {
      const i = bvh.order[k];
      P.set(this.positions.subarray(i * 9, i * 9 + 9), k * 9);
      N.set(this.normals.subarray(i * 9, i * 9 + 9), k * 9);
      U.set(this.uvs.subarray(i * 6, i * 6 + 6), k * 6);
    }
    const m = new TriangleMesh(P, N, U);
    m.bvh = bvh;
    return m;
  }
}

// Build a mesh from an indexed grid or list. `verts` [[x,y,z]], `tris` [[a,b,c]].
// Normals are averaged per vertex (smooth) unless `flat` is set.
export function fromIndexed(verts, tris, { uvs = null, normals = null, flat = false } = {}) {
  const n = tris.length;
  const P = new Float32Array(n * 9), N = new Float32Array(n * 9), U = new Float32Array(n * 6);
  let vn = normals;
  if (!vn && !flat) {
    vn = verts.map(() => [0, 0, 0]);
    for (const [a, b, c] of tris) {
      const fn = faceNormal(verts[a], verts[b], verts[c]); // area-weighted
      for (const i of [a, b, c]) { vn[i][0] += fn[0]; vn[i][1] += fn[1]; vn[i][2] += fn[2]; }
    }
    vn = vn.map(norm);
  }
  tris.forEach(([a, b, c], k) => {
    const fn = flat ? norm(faceNormal(verts[a], verts[b], verts[c])) : null;
    [a, b, c].forEach((vi, j) => {
      P.set(verts[vi], k * 9 + j * 3);
      N.set(fn ?? vn[vi], k * 9 + j * 3);
      if (uvs) U.set(uvs[vi], k * 6 + j * 2);
    });
  });
  return new TriangleMesh(P, N, U);
}

function faceNormal(a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

export function torus(radius = 1, tube = 0.25, detail = 64) {
  const seg = Math.max(8, Math.round(detail)), ring = Math.max(6, Math.round(detail / 2));
  const verts = [], uvs = [], normals = [], tris = [];
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    for (let j = 0; j <= ring; j++) {
      const v = (j / ring) * Math.PI * 2;
      const cx = Math.cos(u), cz = Math.sin(u);
      verts.push([(radius + tube * Math.cos(v)) * cx, tube * Math.sin(v), (radius + tube * Math.cos(v)) * cz]);
      normals.push([Math.cos(v) * cx, Math.sin(v), Math.cos(v) * cz]);
      uvs.push([i / seg, j / ring]);
    }
  }
  const row = ring + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * row + j, b = (i + 1) * row + j;
      tris.push([a, a + 1, b], [b, a + 1, b + 1]);
    }
  }
  return fromIndexed(verts, tris, { uvs, normals });
}

// A square heightfield of `size` metres centred on the origin.
export function terrain({ size = 40, height = 4, detail = 6, frequency = 0.06, resolution = 160, seed = 1, flatten = 0 } = {}) {
  const res = Math.max(2, Math.min(1024, Math.round(resolution)));
  const H = (x, z) => {
    // Ridged-ish fractal: soft hills with sharper crests.
    const f = fbm3(x * frequency, seed * 13.7, z * frequency, Math.max(1, Math.round(detail)), seed);
    let h = Math.pow(Math.min(1, Math.max(0, 0.5 + 0.8 * f)), 1.6) * height;
    if (flatten > 0) {
      const d = Math.hypot(x, z);
      const k = Math.min(1, Math.max(0, (d - flatten) / flatten));
      h *= k * k * (3 - 2 * k);
    }
    return h;
  };
  const verts = [], uvs = [], tris = [];
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const x = (i / res - 0.5) * size, z = (j / res - 0.5) * size;
      verts.push([x, H(x, z), z]);
      uvs.push([i / res, j / res]);
    }
  }
  const row = res + 1;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * row + i, b = a + row;
      tris.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
  }
  return fromIndexed(verts, tris, { uvs });
}

// A rock: a subdivided icosahedron pushed around by noise, then cut by a
// few planes so it gets the flat faces real stones have.
export function rock({ radius = 0.5, roughness = 0.35, detail = 4, seed = 1 } = {}) {
  const { verts, tris } = icosphere(Math.max(1, Math.min(6, Math.round(detail))));
  const cuts = [];
  for (let k = 0; k < 5; k++) {
    const d = norm([random01(seed, k, 1) - 0.5, random01(seed, k, 2) - 0.5, random01(seed, k, 3) - 0.5]);
    cuts.push({ d, off: 0.72 + 0.2 * random01(seed, k, 4) });
  }
  const squash = [1 + 0.3 * (random01(seed, 9) - 0.5), 0.75 + 0.2 * random01(seed, 10), 1 + 0.3 * (random01(seed, 11) - 0.5)];
  const out = verts.map((v) => {
    let r = 1 + roughness * (0.6 * fbm3(v[0] * 1.3 + seed, v[1] * 1.3, v[2] * 1.3, 5, seed) + 0.15 * noise3(v[0] * 7, v[1] * 7, v[2] * 7, seed + 3));
    for (const c of cuts) {
      const along = v[0] * c.d[0] + v[1] * c.d[1] + v[2] * c.d[2];
      if (along > 0) r = Math.min(r, c.off / along + roughness * 0.02);
    }
    return [v[0] * r * radius * squash[0], v[1] * r * radius * squash[1], v[2] * r * radius * squash[2]];
  });
  const uvs = verts.map((v) => [0.5 + Math.atan2(v[2], v[0]) / (2 * Math.PI), 0.5 + Math.asin(v[1]) / Math.PI]);
  return fromIndexed(out, tris, { uvs });
}

export function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(norm);
  let tris = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(key)) {
        verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
        cache.set(key, verts.length - 1);
      }
      return cache.get(key);
    };
    const next = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  return { verts, tris };
}

// Wavefront OBJ: v, vn, vt and f (polygons are fanned into triangles,
// negative indices supported). Other statements are ignored.
export function parseOBJ(text, { smooth = true } = {}) {
  const v = [], vn = [], vt = [];
  const faces = []; // [[vi, ti, ni] x3]
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === 'v') v.push([+parts[1], +parts[2], +parts[3]]);
    else if (tag === 'vn') vn.push([+parts[1], +parts[2], +parts[3]]);
    else if (tag === 'vt') vt.push([+parts[1], +(parts[2] ?? 0)]);
    else if (tag === 'f') {
      const idx = parts.slice(1).map((p) => {
        const [a, b, c] = p.split('/');
        const fix = (s, len) => (s ? (+s < 0 ? len + +s : +s - 1) : -1);
        return [fix(a, v.length), fix(b, vt.length), fix(c, vn.length)];
      });
      for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]);
    }
  }
  if (faces.length === 0) throw new Error('the OBJ file has no faces');
  const hasNormals = faces.every((f) => f.every((c) => c[2] >= 0));
  if (!hasNormals) {
    // Normals are computed per position index; texture coordinates are
    // dropped in this case because they are indexed separately in OBJ.
    const tris = faces.map((f) => f.map((c) => c[0]));
    return fromIndexed(v, tris, { flat: !smooth });
  }
  const n = faces.length;
  const P = new Float32Array(n * 9), N = new Float32Array(n * 9), U = new Float32Array(n * 6);
  faces.forEach((f, k) => f.forEach(([vi, ti, ni], j) => {
    P.set(v[vi], k * 9 + j * 3);
    N.set(norm(vn[ni]), k * 9 + j * 3);
    if (ti >= 0 && vt[ti]) U.set(vt[ti], k * 6 + j * 2);
  }));
  return new TriangleMesh(P, N, U);
}

// Build the mesh for a geometry request from Scene.geometryRequests().
// `loadText(src)` fetches file contents for `mesh` requests.
export async function buildGeometry(params, loadText) {
  let mesh;
  switch (params.kind) {
    case 'torus': mesh = torus(params.radius, params.tube, params.detail); break;
    case 'terrain': mesh = terrain(params); break;
    case 'rock': mesh = rock(params); break;
    case 'mesh': {
      const text = await loadText(params.src);
      mesh = parseOBJ(text, { smooth: params.smooth });
      if (params.fit > 0) mesh.fit(params.fit);
      break;
    }
    default: throw new Error(`no geometry for ${params.kind}`);
  }
  return mesh.withBVH();
}
