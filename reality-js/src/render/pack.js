// Packs a sampled scene into flat float arrays that become GPU textures.
// The layouts here and the fetches in shaders.js must match exactly.
//
// All data textures are RGBA32F, DATA_WIDTH texels wide; element k of a
// record with N texels starts at texel k*N.
//
// Object (8 texels)
//   0: shape, material index, mesh root node (or -1), light index (or -1)
//   1-3: inverse world matrix rows at shutter open
//   4-6: inverse world matrix rows at shutter close
//   7: world scale along x, y, z (for patterns in metres), 0
// Material (8 texels)
//   0: color.rgb, roughness
//   1: metallic, transmission, ior, clearcoat
//   2: emission.rgb (nits), specular
//   3: pattern, pattern scale, bump, texture layer (-1 none)
//   4: color2.rgb, roughness2
//   5: flow.xyz, texture scale
//   6: absorption.rgb (per metre), clearcoat roughness
//   7: thin (0/1), bump scale, 0, 0
// Light (4 texels)
//   0: type (0 sphere, 1 quad, 2 disk), object index, area, 0
//   1: centre.xyz, radius
//   2: edge u.xyz, 0
//   3: edge v.xyz, 0
// BVH node (2 texels) and triangle (6 texels): see geometry/bvh.js and
// packMeshes below.

import { invert, column, cross, length, transformPoint } from '../core/math.js';

export const DATA_WIDTH = 1024;
export const SHAPES = { sphere: 0, box: 1, plane: 2, disk: 3, quad: 4, cylinder: 5, mesh: 6 };
export const OBJECT_TEXELS = 8;
export const MATERIAL_TEXELS = 8;
export const LIGHT_TEXELS = 4;

// Combine all meshes into one BVH node array and one triangle array.
// Returns { bvh, tris, roots: Map(key -> root node index) }.
export function packMeshes(meshes) {
  let nodeCount = 0, triCount = 0;
  for (const m of meshes.values()) { nodeCount += m.bvh.nodes.length / 8; triCount += m.count; }
  const bvh = new Float32Array(Math.max(1, nodeCount) * 8);
  const tris = new Float32Array(Math.max(1, triCount) * 24);
  const roots = new Map();
  let nOff = 0, tOff = 0;
  for (const [key, m] of meshes) {
    const src = m.bvh.nodes;
    const nNodes = src.length / 8;
    for (let i = 0; i < nNodes; i++) {
      const o = i * 8, d = (nOff + i) * 8;
      for (let k = 0; k < 8; k++) bvh[d + k] = src[o + k];
      const leaf = src[o + 7] > 0;
      bvh[d + 3] = src[o + 3] + (leaf ? tOff : nOff);
    }
    const P = m.positions, N = m.normals, U = m.uvs;
    for (let t = 0; t < m.count; t++) {
      const d = (tOff + t) * 24;
      for (let v = 0; v < 3; v++) {
        tris[d + v * 4] = P[t * 9 + v * 3];
        tris[d + v * 4 + 1] = P[t * 9 + v * 3 + 1];
        tris[d + v * 4 + 2] = P[t * 9 + v * 3 + 2];
        tris[d + v * 4 + 3] = U[t * 6 + v * 2];
        tris[d + 12 + v * 4] = N[t * 9 + v * 3];
        tris[d + 12 + v * 4 + 1] = N[t * 9 + v * 3 + 1];
        tris[d + 12 + v * 4 + 2] = N[t * 9 + v * 3 + 2];
        tris[d + 12 + v * 4 + 3] = U[t * 6 + v * 2 + 1];
      }
    }
    roots.set(key, nOff);
    nOff += nNodes;
    tOff += m.count;
  }
  return { bvh, tris, roots, nodeCount, triCount };
}

const colLen = (m, c) => length(column(m, c));

// World-space surface area of an object, for turning lumens into nits.
export function objectArea(obj, mesh) {
  const w = obj.world;
  const sx = colLen(w, 0), sy = colLen(w, 1), sz = colLen(w, 2);
  switch (obj.shape) {
    case 'sphere': { const r = (sx + sy + sz) / 3; return 4 * Math.PI * r * r; }
    case 'box': return 2 * (sx * sy + sy * sz + sz * sx);
    case 'quad': return length(cross(column(w, 0), column(w, 2)));
    case 'disk': return Math.PI * length(cross(column(w, 0), column(w, 2)));
    case 'cylinder': { const r = (sx + sz) / 2; return 2 * Math.PI * r * sy + 2 * Math.PI * r * r; }
    case 'mesh': return (mesh ? mesh.area() : 1) * ((sx * sy + sy * sz + sz * sx) / 3);
    default: return Infinity;
  }
}

// open, close: Scene.sample() snapshots at shutter open and close.
// meshRoots: Map(geometryKey -> root). textureLayers: Map(path -> layer).
export function packScene(open, close, { meshRoots = new Map(), meshes = new Map(), textureLayers = new Map() } = {}) {
  const objs = open.objects;
  const matched = close.objects.length === objs.length ? close.objects : objs;
  const n = objs.length;
  const objects = new Float32Array(Math.max(1, n) * OBJECT_TEXELS * 4);
  const materials = new Float32Array(Math.max(1, n) * MATERIAL_TEXELS * 4);
  const lights = [];
  const warnings = [];

  for (let i = 0; i < n; i++) {
    const obj = objs[i];
    const m = obj.material;
    const mesh = obj.geometryKey ? meshes.get(obj.geometryKey) : null;

    // Emission in nits. Lights given in lumens spread their flux over the
    // area: a Lambertian emitter has radiance = flux / (pi * area).
    let emission = m.emission ?? [0, 0, 0];
    if (m.isLight && m.power != null) {
      const area = objectArea(obj, mesh);
      if (!Number.isFinite(area)) {
        warnings.push(`a light with power on an infinite ${obj.kind} has no area; use intensity instead`);
        emission = [0, 0, 0];
      } else {
        emission = m.emissionColor.map((c) => (c * m.power) / (Math.PI * area));
      }
    }
    const emits = emission[0] + emission[1] + emission[2] > 0;

    let lightIndex = -1;
    if (emits && (obj.shape === 'sphere' || obj.shape === 'quad' || obj.shape === 'disk')) {
      lightIndex = lights.length;
      lights.push({ obj, index: i });
    }

    let o = i * OBJECT_TEXELS * 4;
    const root = obj.geometryKey != null ? meshRoots.get(obj.geometryKey) ?? -1 : -1;
    objects.set([SHAPES[obj.shape], i, root, lightIndex], o);
    const inv0 = invert(obj.world), inv1 = invert(matched[i].world);
    objects.set(inv0, o + 4);
    objects.set(inv1, o + 16);
    objects.set([colLen(obj.world, 0), colLen(obj.world, 1), colLen(obj.world, 2), 0], o + 28);

    o = i * MATERIAL_TEXELS * 4;
    const absorb = m.tint.map((c) => -Math.log(Math.max(1e-4, Math.min(1, c))) / m.tintDistance);
    const layer = m.texture && textureLayers.has(m.texture) ? textureLayers.get(m.texture) : -1;
    materials.set([
      ...m.color, m.roughness,
      m.metallic, m.transmission, m.ior, m.clearcoat,
      ...emission, m.specular,
      m.pattern, m.patternScale, m.bump, layer,
      ...m.color2, m.roughness2,
      ...m.flow, m.textureScale,
      ...absorb, m.clearcoatRoughness,
      m.thin ? 1 : 0, m.bumpScale, 0, 0,
    ], o);
  }

  const lightData = new Float32Array(Math.max(1, lights.length) * LIGHT_TEXELS * 4);
  lights.forEach(({ obj, index }, k) => {
    const w = obj.world;
    const centre = transformPoint(w, [0, 0, 0]);
    const u = column(w, 0), v = column(w, 2);
    const o = k * LIGHT_TEXELS * 4;
    if (obj.shape === 'sphere') {
      const r = (colLen(w, 0) + colLen(w, 1) + colLen(w, 2)) / 3;
      lightData.set([0, index, 4 * Math.PI * r * r, 0, ...centre, r, ...u, 0, ...v, 0], o);
    } else {
      const type = obj.shape === 'quad' ? 1 : 2;
      const area = objectArea(obj);
      lightData.set([type, index, area, 0, ...centre, 0, ...u, 0, ...v, 0], o);
    }
  });

  // Shader features this scene needs (see TRACE_FEATURES in trace.glsl.js).
  const features = [];
  if (objs.some((o) => o.shape === 'mesh')) features.push('HAS_MESH');
  if (lights.length) features.push('HAS_LIGHTS');
  if (objs.some((o) => o.material.texture && textureLayers.has(o.material.texture))) features.push('HAS_TEXTURES');
  if (objs.some((o) => o.material.pattern > 0 || o.material.bump > 0)) features.push('HAS_PATTERNS');

  return { objects, materials, lights: lightData, objectCount: n, lightCount: lights.length, features, warnings };
}
