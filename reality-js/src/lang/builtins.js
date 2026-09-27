// Functions and constants available in every .real file.
// Trigonometry works in degrees, like the rest of the language.

import { parseHex, rgb255, hsl, blackbody } from '../core/color.js';
import { random01, noise3, fbm3 } from '../core/noise.js';
import { EASINGS, bounce, fall, spring, orbit, pendulum, wobble } from '../scene/animation.js';
import { TIME } from './signal.js';

const R = Math.PI / 180;

const num = (name, v) => {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new TypeError(`${name}() needs a number, got ${describe(v)}`);
  return v;
};

export function describe(v) {
  if (Array.isArray(v)) return `a list of ${v.length}`;
  if (v === null || v === undefined) return 'nothing';
  if (typeof v === 'object' && v.kind) return `a ${v.kind}`;
  return typeof v === 'string' ? `the text "${v}"` : `${typeof v} ${v}`;
}

// Apply a scalar function to numbers or, component-wise, to lists.
const map1 = (name, f) => (x) => (Array.isArray(x) ? x.map((v) => f(num(name, v))) : f(num(name, x)));

const vec = (name, v) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) throw new TypeError(`${name}() needs a vector, got ${describe(v)}`);
  return v;
};

// Colors measured as reflectance at normal incidence (F0), linear sRGB.
export const METAL_COLORS = {
  gold: [1.0, 0.766, 0.336],
  silver: [0.972, 0.96, 0.915],
  copper: [0.955, 0.638, 0.538],
  aluminium: [0.913, 0.922, 0.924],
  aluminum: [0.913, 0.922, 0.924],
  iron: [0.562, 0.565, 0.578],
  chrome: [0.55, 0.556, 0.554],
  brass: [0.91, 0.778, 0.423],
  titanium: [0.542, 0.497, 0.449],
};

export const CONSTANTS = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  t: TIME,
  white: [1, 1, 1],
  black: [0, 0, 0],
  ...METAL_COLORS,
};

export const FUNCTIONS = {
  sin: map1('sin', (x) => Math.sin(x * R)),
  cos: map1('cos', (x) => Math.cos(x * R)),
  tan: map1('tan', (x) => Math.tan(x * R)),
  asin: map1('asin', (x) => Math.asin(x) / R),
  acos: map1('acos', (x) => Math.acos(x) / R),
  atan: map1('atan', (x) => Math.atan(x) / R),
  atan2: (y, x) => Math.atan2(num('atan2', y), num('atan2', x)) / R,
  sqrt: map1('sqrt', Math.sqrt),
  abs: map1('abs', Math.abs),
  floor: map1('floor', Math.floor),
  ceil: map1('ceil', Math.ceil),
  round: map1('round', Math.round),
  fract: map1('fract', (x) => x - Math.floor(x)),
  sign: map1('sign', Math.sign),
  exp: map1('exp', Math.exp),
  log: map1('log', Math.log),
  log2: map1('log2', Math.log2),
  pow: (a, b) => Math.pow(num('pow', a), num('pow', b)),
  mod: (a, b) => ((num('mod', a) % num('mod', b)) + b) % b,
  min: (...a) => Math.min(...a.flat()),
  max: (...a) => Math.max(...a.flat()),
  clamp: (x, lo = 0, hi = 1) => (Array.isArray(x) ? x.map((v) => Math.min(hi, Math.max(lo, v))) : Math.min(hi, Math.max(lo, num('clamp', x)))),
  mix: (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * num('mix', k)),
  lerp: (a, b, k) => FUNCTIONS.mix(a, b, k),
  step: (edge, x) => (num('step', x) < edge ? 0 : 1),
  smoothstep: (e0, e1, x) => {
    const k = Math.min(1, Math.max(0, (num('smoothstep', x) - e0) / (e1 - e0)));
    return k * k * (3 - 2 * k);
  },
  remap: (x, a, b, c, d) => c + ((num('remap', x) - a) * (d - c)) / (b - a),

  length: (v) => Math.hypot(...vec('length', v)),
  distance: (a, b) => Math.hypot(...vec('distance', a).map((x, i) => x - b[i])),
  normalize: (v) => {
    const l = Math.hypot(...vec('normalize', v));
    return l > 0 ? v.map((x) => x / l) : v;
  },
  dot: (a, b) => vec('dot', a).reduce((s, x, i) => s + x * b[i], 0),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (list) => (Array.isArray(list) ? list.length : String(list).length),

  // Colors. rgb() takes 0-255 sRGB, hsl() takes degrees and 0-1 (or %).
  rgb: (r, g, b) => rgb255(num('rgb', r), num('rgb', g), num('rgb', b)),
  hsl: (h, s, l) => hsl(num('hsl', h), num('hsl', s), num('hsl', l)),
  hex: (s) => parseHex(String(s)) ?? (() => { throw new TypeError(`hex() could not read "${s}"`); })(),
  kelvin: (k) => blackbody(num('kelvin', k)),
  linear: (r, g, b) => [r, g, b],
  gray: (v) => [v, v, v],
  grey: (v) => [v, v, v],

  // Randomness and noise, deterministic for a given seed.
  random: (seed = 0, lo = 0, hi = 1) => lo + (hi - lo) * random01(...(Array.isArray(seed) ? seed : [seed])),
  pick: (list, seed = 0) => list[Math.floor(random01(seed, 7) * list.length)],
  noise: (x, y = 0, z = 0) => noise3(num('noise', x), y, z),
  fbm: (x, y = 0, z = 0, octaves = 5) => fbm3(num('fbm', x), y, z, octaves),

  // Motion.
  ease: (name, x) => {
    const f = EASINGS[name];
    if (!f) throw new TypeError(`unknown easing "${name}"; try one of ${Object.keys(EASINGS).join(', ')}`);
    return f(Math.min(1, Math.max(0, num('ease', x))));
  },
  bounce,
  fall,
  spring,
  orbit,
  pendulum,
  wobble,
};
