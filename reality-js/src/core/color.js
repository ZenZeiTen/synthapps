// Color helpers. All colors inside reality.js are linear Rec.709 / sRGB
// primaries, stored as [r, g, b]. Colors people type (hex, rgb(), hsl())
// are sRGB-encoded and get decoded here.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function parseHex(hex) {
  let h = hex.replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
}

export const rgb255 = (r, g, b) => [r, g, b].map((v) => srgbToLinear(v / 255));

// h in degrees, s and l in 0..1. Returns linear RGB.
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => srgbToLinear(v + m));
}

export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// CIE 1931 colour matching functions, multi-lobe Gaussian fit from
// Wyman, Sloan and Shirley, "Simple Analytic Approximations to the CIE XYZ
// Color Matching Functions" (JCGT 2013).
function g(x, mu, s1, s2) {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
export function cieXYZ(lambdaNm) {
  const l = lambdaNm;
  const x = 1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2);
  const y = 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1);
  const z = 1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}

export function xyzToLinearSrgb([x, y, z]) {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

const blackbodyCache = new Map();

// Colour of a black body at `kelvin`, as linear sRGB normalised to
// luminance 1. Out-of-gamut negatives are clipped.
export function blackbody(kelvin) {
  const key = Math.round(kelvin);
  if (blackbodyCache.has(key)) return blackbodyCache.get(key);
  const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const m = l * 1e-9;
    const planck = (2 * h * c * c) / (m ** 5 * (Math.exp((h * c) / (m * k * kelvin)) - 1));
    const [xb, yb, zb] = cieXYZ(l);
    X += planck * xb; Y += planck * yb; Z += planck * zb;
  }
  const rgb = xyzToLinearSrgb([X / Y, 1, Z / Y]).map((v) => Math.max(0, v));
  const lum = luminance(rgb);
  const out = rgb.map((v) => v / lum);
  blackbodyCache.set(key, out);
  return out;
}

// RGB gains that neutralise a light of colour temperature `kelvin`
// (a simple von Kries-style white balance in linear sRGB). The gains are
// relative to D65 (6504 K) so 6504 K returns roughly [1, 1, 1].
export function whiteBalanceGains(kelvin) {
  const ref = blackbody(6504);
  const src = blackbody(kelvin);
  const gains = [ref[0] / src[0], ref[1] / src[1], ref[2] / src[2]];
  const l = luminance(gains);
  return gains.map((v) => v / l);
}
