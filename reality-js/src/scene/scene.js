// Turns evaluated nodes into a Scene: checks every property against the
// schemas in nodes.js, flattens groups, and can sample the whole scene at
// any moment in time as plain numbers for the renderer.

import { RealityError, suggest } from '../lang/errors.js';
import { NodeValue, BareWord } from '../lang/evaluator.js';
import { resolve, isTimeVarying } from '../lang/signal.js';
import { describe } from '../lang/builtins.js';
import { MATERIAL_KINDS, ALL_KINDS, kindCategory } from './nodes.js';
import { blackbody } from '../core/color.js';
import { eulerToMat3, aimYMat3, compose, multiply, sub } from '../core/math.js';
import { cameraFrame, sunDirection } from './camera.js';

const PATTERN_INDEX = { none: 0, checker: 1, grid: 2, noise: 3, marble: 4, wood: 5, stripes: 6 };
const MESH_KINDS = new Set(['torus', 'mesh', 'terrain', 'rock']);
// Properties of mesh objects that define the geometry itself. They must not
// change over time because the triangles are built once.
const GEOMETRY_PROPS = {
  torus: ['radius', 'tube', 'detail'],
  mesh: ['src', 'fit', 'smooth'],
  terrain: ['size', 'height', 'detail', 'frequency', 'resolution', 'seed', 'flatten'],
  rock: ['radius', 'roughness', 'detail', 'seed'],
};

export class Scene {
  constructor() {
    this.settings = {}; // kind -> NodeValue (camera, sky, fog, film, timeline, render, hdri, background)
    this.environmentKind = 'sky';
    this.objects = []; // { node, parents: NodeValue[] }
    this.warnings = [];
  }

  get timeline() {
    return sampleProps(this.settings.timeline, 'timeline', 0, this);
  }

  get renderSettings() {
    return sampleProps(this.settings.render, 'render', 0, this);
  }

  // Geometry that has to be built before rendering (meshes, files).
  geometryRequests() {
    const out = new Map();
    for (const { node } of this.objects) {
      if (!MESH_KINDS.has(node.kind)) continue;
      const p = sampleProps(node, node.kind, 0, this);
      const params = { kind: node.kind };
      for (const k of GEOMETRY_PROPS[node.kind]) params[k] = p[k];
      out.set(geometryKey(params), params);
    }
    return [...out.values()];
  }

  // Image and HDR files the scene refers to.
  assetRequests() {
    const out = new Set();
    for (const { node } of this.objects) {
      const m = objectMaterialNode(node);
      const tex = m && m.kind !== 'light' ? sampleProps(m, m.kind, 0, this).texture : null;
      if (tex) out.add(tex);
    }
    return [...out];
  }

  // Everything the renderer needs at `time`, as plain values.
  sample(time) {
    const tl = this.timeline;
    const camProps = sampleProps(this.settings.camera, 'camera', time, this);
    const envKind = this.environmentKind;
    const env = sampleProps(this.settings[envKind], envKind, time, this);
    const fog = this.settings.fog ? sampleProps(this.settings.fog, 'fog', time, this) : null;
    const film = sampleProps(this.settings.film, 'film', time, this);

    const objects = [];
    for (const { node, parents } of this.objects) {
      const p = sampleProps(node, node.kind, time, this);
      if (!p.visible || parents.some((g) => !sampleProps(g, 'group', time, this).visible)) continue;
      let world = localMatrix(node.kind, p);
      for (let i = parents.length - 1; i >= 0; i--) {
        world = multiply(localMatrix('group', sampleProps(parents[i], 'group', time, this)), world);
      }
      const shape = shapeOf(node.kind);
      const material = objectMaterial(node, p, time, this);
      const obj = { kind: node.kind, shape, world, material };
      if (MESH_KINDS.has(node.kind)) {
        const params = { kind: node.kind };
        for (const k of GEOMETRY_PROPS[node.kind]) params[k] = p[k];
        obj.geometryKey = geometryKey(params);
      }
      objects.push(obj);
    }

    let environment;
    if (envKind === 'sky') {
      environment = { type: 'sky', ...env, sunDir: sunDirection(env.sun_elevation, env.sun_azimuth) };
    } else if (envKind === 'hdri') {
      environment = { type: 'hdri', ...env };
    } else {
      environment = { type: 'background', radiance: env.color.map((c) => c * env.intensity) };
    }

    return {
      time,
      camera: camProps,
      cameraFrame: (aspect) => cameraFrame(camProps, aspect, 1 / (2 * tl.fps)),
      environment,
      fog,
      film,
      objects,
    };
  }
}

export const geometryKey = (params) => JSON.stringify(params);

const shapeOf = (kind) => {
  switch (kind) {
    case 'sphere': case 'bulb': return 'sphere';
    case 'box': return 'box';
    case 'plane': case 'ground': return 'plane';
    case 'disk': return 'disk';
    case 'quad': case 'softbox': return 'quad';
    case 'cylinder': return 'cylinder';
    default: return 'mesh';
  }
};

function localMatrix(kind, p) {
  let rot = eulerToMat3(...p.rotate ?? [0, 0, 0]);
  const position = p.position.slice();
  if (p.aim) {
    const a = aimYMat3(sub(p.aim, position));
    rot = mul3(a, rot);
  }
  const s = p.scale ?? [1, 1, 1];
  let shape = [1, 1, 1];
  switch (kind) {
    case 'sphere': case 'bulb': shape = [p.radius, p.radius, p.radius]; break;
    case 'box': shape = p.size; break;
    case 'disk': shape = [p.radius, 1, p.radius]; break;
    case 'quad': case 'softbox': shape = [p.size[0], 1, p.size[1]]; break;
    case 'cylinder': shape = [p.radius, p.height, p.radius]; break;
    case 'ground': position[1] += p.height; break;
  }
  return compose(position, rot, [s[0] * shape[0], s[1] * shape[1], s[2] * shape[2]]);
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

function objectMaterialNode(node) {
  if (node.kind === 'bulb' || node.kind === 'softbox') return null;
  return node.get('material') ?? null;
}

// The material of an object as principled parameters. Light output given in
// lumens is kept as `power` and turned into radiance once the object's area
// is known (see render/pack.js).
function objectMaterial(node, p, time, scene) {
  if (node.kind === 'bulb' || node.kind === 'softbox') {
    return lightMaterial({ color: p.color, temperature: p.temperature, power: p.power, intensity: null });
  }
  let m = p.material;
  if (!m) {
    const base = defaultMaterial(p.color);
    return base;
  }
  const mp = sampleProps(m, m.kind, time, scene);
  if (m.kind === 'light') return lightMaterial(mp);
  return principled(mp);
}

function lightMaterial(mp) {
  const color = mp.color ?? blackbody(mp.temperature);
  return {
    ...principled(sampleDefaults('matte')),
    color: [0, 0, 0],
    emissionColor: color,
    power: mp.power, // lumens, or null
    emission: mp.power == null ? color.map((c) => c * mp.intensity) : null,
    isLight: true,
  };
}

function defaultMaterial(color) {
  const d = sampleDefaults('matte');
  d.color = color ?? [0.6, 0.6, 0.6];
  return principled(d);
}

const defaultsCache = new Map();
function sampleDefaults(kind) {
  if (!defaultsCache.has(kind)) {
    const out = {};
    for (const [k, spec] of Object.entries(ALL_KINDS[kind].props)) out[k] = normalizeValue(spec, spec.default);
    defaultsCache.set(kind, out);
  }
  return { ...defaultsCache.get(kind) };
}

function principled(mp) {
  return {
    color: mp.color,
    roughness: clamp01(mp.roughness),
    metallic: clamp01(mp.metallic),
    specular: Math.max(0, mp.specular),
    transmission: clamp01(mp.transmission),
    ior: Math.max(1.0001, mp.ior),
    tint: mp.tint,
    tintDistance: Math.max(1e-4, mp.tint_distance),
    thin: !!mp.thin,
    clearcoat: clamp01(mp.clearcoat),
    clearcoatRoughness: clamp01(mp.clearcoat_roughness),
    emission: mp.emission.map((c) => c * mp.emission_strength),
    pattern: PATTERN_INDEX[mp.pattern] ?? 0,
    patternScale: mp.pattern_scale,
    color2: mp.color2,
    roughness2: clamp01(mp.roughness2 ?? mp.roughness),
    bump: Math.max(0, mp.bump),
    bumpScale: mp.bump_scale,
    flow: mp.flow,
    texture: mp.texture,
    textureScale: mp.texture_scale,
  };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Resolve a node's properties at `time`, filling in defaults and checking
// types. `node` may be undefined, in which case the defaults are returned.
export function sampleProps(node, kind, time, scene) {
  const schema = ALL_KINDS[kind];
  const out = {};
  for (const [name, spec] of Object.entries(schema.props)) {
    const entry = node?.props.get(name);
    if (!entry) {
      out[name] = normalizeValue(spec, spec.default);
      continue;
    }
    const v = resolve(entry.value, time);
    try {
      out[name] = normalizeValue(spec, checkType(spec, v), name, kind, scene, entry.loc);
    } catch (err) {
      if (err instanceof RealityError) throw err;
      throw new RealityError(`${kind} ${name}: ${err.message}`, entry.loc);
    }
  }
  return out;
}

function checkType(spec, v) {
  if (v instanceof BareWord) {
    if (spec.type === 'enum' || spec.type === 'auto') v = v.name;
    else throw new RealityError(`"${v.name}" is not defined`, v.loc, v.hint);
  }
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const vecOf = (n) => Array.isArray(v) && v.length === n && v.every(isNum);
  switch (spec.type) {
    case 'number':
      if (v === null && spec.default === null) return v;
      if (!isNum(v)) throw new TypeError(`needs a number, got ${describe(v)}`);
      return v;
    case 'vec3':
      if (v === null && spec.default === null) return v;
      if (!vecOf(3)) throw new TypeError(`needs [x, y, z], got ${describe(v)}`);
      return v;
    case 'vec2':
      if (!vecOf(2)) throw new TypeError(`needs [a, b], got ${describe(v)}`);
      return v;
    case 'color':
      if (isNum(v)) return [v, v, v];
      if (!vecOf(3)) throw new TypeError(`needs a colour like #ffcc88 or [r, g, b], got ${describe(v)}`);
      return v;
    case 'size3':
      if (isNum(v)) return [v, v, v];
      if (!vecOf(3)) throw new TypeError(`needs a number or [x, y, z], got ${describe(v)}`);
      return v;
    case 'size2':
      if (isNum(v)) return [v, v];
      if (!vecOf(2)) throw new TypeError(`needs a number or [width, depth], got ${describe(v)}`);
      return v;
    case 'bool':
      if (typeof v !== 'boolean') throw new TypeError(`needs true or false, got ${describe(v)}`);
      return v;
    case 'string':
      if (typeof v !== 'string') throw new TypeError(`needs text in quotes, got ${describe(v)}`);
      return v;
    case 'enum': {
      const s = typeof v === 'string' ? v : null;
      if (!s || !spec.values.includes(s)) {
        const hint = s ? suggest(s, spec.values) : null;
        throw new TypeError(`needs one of ${spec.values.join(', ')}${hint ? ` (did you mean "${hint}"?)` : ''}, got ${describe(v)}`);
      }
      return s;
    }
    case 'auto':
      if (v === 'auto' || isNum(v)) return v;
      throw new TypeError(`needs a number or "auto", got ${describe(v)}`);
    case 'material':
      if (!(v instanceof NodeValue) || !(v.kind in MATERIAL_KINDS)) {
        throw new TypeError(`needs a material such as matte { ... } or metal { ... }, got ${describe(v)}`);
      }
      return v;
  }
  return v;
}

function normalizeValue(spec, v, name, kind, scene, loc) {
  if (v === null || v === undefined) return v ?? null;
  if (spec.type === 'size3' && typeof v === 'number') return [v, v, v];
  if (spec.type === 'size2' && typeof v === 'number') return [v, v];
  if (spec.type === 'color' && typeof v === 'number') return [v, v, v];
  // Lens and sensor sizes written without a unit are almost always meant
  // as millimetres ("lens: 50"). No real lens is a metre long.
  if (kind === 'camera' && (name === 'lens' || name === 'sensor') && v >= 1) {
    scene?.warn(`camera ${name}: ${v} read as ${v}mm; write ${v}mm to be explicit`, loc);
    return v / 1000;
  }
  return v;
}

// Build a Scene from the evaluator's top-level nodes.
export function buildScene(nodes, warnings = []) {
  const scene = new Scene();
  const seenWarnings = new Set();
  scene.warn = (msg, loc) => {
    const key = msg + (loc ? `@${loc.line}:${loc.col}` : '');
    if (seenWarnings.has(key)) return;
    seenWarnings.add(key);
    scene.warnings.push({ message: msg, loc });
  };
  for (const w of warnings) scene.warnings.push(w);

  const addObject = (node, parents) => {
    validateNode(node, scene);
    if (node.kind === 'group') {
      for (const child of node.children) {
        if (kindCategory(child.kind) !== 'object') {
          throw new RealityError(`a group can only contain objects, not ${child.kind}`, child.loc);
        }
        addObject(child, [...parents, node]);
      }
      return;
    }
    scene.objects.push({ node, parents });
  };

  for (const node of nodes) {
    const cat = kindCategory(node.kind);
    if (!cat) {
      const s = suggest(node.kind, Object.keys(ALL_KINDS));
      throw new RealityError(`unknown kind "${node.kind}"`, node.loc, s ? `did you mean "${s}"?` : `see LANGUAGE.md for the list of kinds`);
    }
    if (cat === 'material') {
      throw new RealityError(`a ${node.kind} on its own does nothing; name it with let, or put it on an object: material: ${node.kind} { ... }`, node.loc);
    }
    if (cat === 'settings') {
      validateNode(node, scene);
      if (scene.settings[node.kind]) scene.warn(`more than one ${node.kind}; the last one is used`, node.loc);
      scene.settings[node.kind] = node;
      if (node.kind === 'sky' || node.kind === 'hdri' || node.kind === 'background') scene.environmentKind = node.kind;
      continue;
    }
    addObject(node, []);
  }
  if (scene.objects.length === 0) scene.warn('the scene has no objects yet; try adding: sphere { position: [0, 1, 0] }');
  return scene;
}

function validateNode(node, scene) {
  const schema = ALL_KINDS[node.kind];
  for (const [name, entry] of node.props) {
    if (!(name in schema.props)) {
      const s = suggest(name, Object.keys(schema.props));
      throw new RealityError(`${node.kind} has no property "${name}"`, entry.loc,
        s ? `did you mean "${s}"?` : `${node.kind} understands: ${Object.keys(schema.props).join(', ')}`);
    }
  }
  if (node.children.length && !schema.children) {
    throw new RealityError(`${node.kind} cannot contain other objects; wrap them in a group { ... }`, node.children[0].loc);
  }
  // Type-check now, at time 0, so mistakes show up before rendering.
  sampleProps(node, node.kind, 0, scene);
  for (const [, entry] of node.props) {
    if (entry.value instanceof NodeValue) validateNode(entry.value, scene);
  }
  if (GEOMETRY_PROPS[node.kind]) {
    for (const k of GEOMETRY_PROPS[node.kind]) {
      const e = node.props.get(k);
      if (e && isTimeVarying(e.value)) throw new RealityError(`${node.kind} ${k} cannot change over time; animate position, rotate or scale instead`, e.loc);
    }
  }
  if (node.kind === 'mesh' && !node.props.get('src')) throw new RealityError('mesh needs src: "file.obj"', node.loc);
  if (node.kind === 'hdri' && !node.props.get('src')) throw new RealityError('hdri needs src: "file.hdr"', node.loc);
}

