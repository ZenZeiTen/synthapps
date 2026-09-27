// Deterministic hashing and gradient noise (Ken Perlin's improved noise).
// Used for terrain, rocks, camera wobble and the `noise()` and `random()`
// functions of the language. The GPU uses its own noise for materials.

// 32-bit integer hash (lowbias32 by Chris Wellons).
export function hash32(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// Uniform float in [0, 1) from any number of numeric seeds.
export function random01(...seeds) {
  let h = 0x9e3779b9;
  for (const s of seeds) {
    const f = new Float64Array([s]);
    const u = new Uint32Array(f.buffer);
    h = hash32(h ^ u[0]);
    h = hash32(h ^ u[1]);
  }
  return h / 4294967296;
}

const perms = new Map();
function perm(seed) {
  seed = seed | 0;
  if (perms.has(seed)) return perms.get(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let h = hash32(seed + 1);
  for (let i = 255; i > 0; i--) {
    h = hash32(h + i);
    const j = h % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  perms.set(seed, out);
  return out;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// Gradient noise in roughly [-1, 1].
export function noise3(x, y = 0, z = 0, seed = 0) {
  const p = perm(seed);
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
  const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u),
      lerp(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u),
      lerp(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
    w,
  );
}

// Fractal sum of noise octaves, normalised to roughly [-1, 1].
export function fbm3(x, y, z, octaves = 5, seed = 0, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z, seed + i * 17);
    norm += amp;
    amp *= gain;
    x *= lacunarity; y *= lacunarity; z *= lacunarity;
  }
  return sum / norm;
}
