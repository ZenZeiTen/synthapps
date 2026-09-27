// Importance sampling tables for an equirectangular environment map.
//
// Each texel gets weight luminance * sin(theta) (texels near the poles
// cover less of the sphere). Rows are picked from the marginal CDF, columns
// from that row's conditional CDF, then a point is chosen uniformly inside
// the texel. The solid-angle density of a direction is
//   pdf = p_texel * W * H / (2 * pi^2 * sin(theta))
// The shader (render/shaders.js) implements the same sampling.

import { dirFromEquirect, equirectFromDir } from './atmosphere.js';

export function buildEnvDistribution({ width: W, height: H, data }) {
  const w = new Float64Array(W * H);
  let total = 0;
  for (let j = 0; j < H; j++) {
    const s = Math.sin(((j + 0.5) / H) * Math.PI);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      // A small floor keeps every direction reachable (avoids zero pdf).
      const v = (Math.max(0, lum) + 1e-4) * s;
      w[j * W + i] = v;
      total += v;
    }
  }
  const pdf = new Float32Array(W * H);
  const cond = new Float32Array(W * H);
  const marg = new Float32Array(H);
  let acc = 0;
  for (let j = 0; j < H; j++) {
    let row = 0;
    for (let i = 0; i < W; i++) row += w[j * W + i];
    let c = 0;
    for (let i = 0; i < W; i++) {
      c += w[j * W + i];
      cond[j * W + i] = row > 0 ? c / row : (i + 1) / W;
      pdf[j * W + i] = w[j * W + i] / total;
    }
    cond[j * W + W - 1] = 1;
    acc += row;
    marg[j] = acc / total;
  }
  marg[H - 1] = 1;
  return { width: W, height: H, pdf, cond, marg, total };
}

// First index whose CDF value is >= x.
function lowerBound(cdf, start, n, x) {
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[start + mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Reference implementations of what the shader does.
export function sampleEnv(dist, u1, u2, u3, u4) {
  const { width: W, height: H } = dist;
  const j = lowerBound(dist.marg, 0, H, u1);
  const i = lowerBound(dist.cond, j * W, W, u2);
  const d = dirFromEquirect((i + u3) / W, (j + u4) / H);
  return { dir: d, pdf: envPdf(dist, d) };
}

export function envPdf(dist, d) {
  const { width: W, height: H } = dist;
  const [u, v] = equirectFromDir(d);
  const i = Math.min(W - 1, Math.floor(u * W)), j = Math.min(H - 1, Math.floor(v * H));
  const s = Math.sin(v * Math.PI);
  if (s <= 0) return 0;
  return (dist.pdf[j * W + i] * W * H) / (2 * Math.PI * Math.PI * s);
}
