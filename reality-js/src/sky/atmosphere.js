// Physically based daytime sky.
//
// Single scattering by air molecules (Rayleigh) and aerosols (Mie), with
// ozone absorption, integrated through a spherical atmosphere. Coefficients
// follow Hillaire, "A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique" (EGSR 2020). The result is an equirectangular
// radiance map in nits (cd/m²) plus the sun as a separate light, so the
// renderer can sample it directly.
//
// Equirectangular convention (shared with the shader and HDRIs):
//   u = azimuth / 360°, azimuth 0 = north (−Z), 90° = east (+X)
//   v = zenith angle / 180°, v = 0 is straight up, first row of the image.

const EARTH_R = 6360e3;
const ATMO_R = 6460e3;
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_H = 8000;
const MIE_SCATTER = 3.996e-6;
const MIE_EXTINCT = 4.44e-6;
const MIE_H = 1200;
const MIE_G = 0.8;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
// Illuminance of the sun above the atmosphere, lux.
export const SUN_ILLUMINANCE = 128000;
const CAMERA_ALT = 2;

export function dirFromEquirect(u, v) {
  const phi = u * 2 * Math.PI, th = v * Math.PI;
  const s = Math.sin(th);
  return [s * Math.sin(phi), Math.cos(th), -s * Math.cos(phi)];
}

export function equirectFromDir(d) {
  let u = Math.atan2(d[0], -d[2]) / (2 * Math.PI);
  if (u < 0) u += 1;
  const v = Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI;
  return [u, v];
}

function densities(h) {
  const r = Math.exp(-h / RAYLEIGH_H);
  const m = Math.exp(-h / MIE_H);
  const o = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  return [r, m, o];
}

// Distance along a ray from radius r (measured from the planet centre) with
// cosine mu against the local vertical to the top of the atmosphere.
function distToTop(r, mu) {
  const disc = r * r * (mu * mu - 1) + ATMO_R * ATMO_R;
  return -r * mu + Math.sqrt(Math.max(0, disc));
}
function hitsGround(r, mu) {
  return mu < 0 && r * r * (mu * mu - 1) + EARTH_R * EARTH_R >= 0;
}

// Transmittance lookup table over altitude and sun zenith cosine.
const T_H = 64, T_MU = 128;
function transmittanceLUT(haze) {
  const lut = new Float32Array(T_H * T_MU * 3);
  const steps = 40;
  for (let i = 0; i < T_H; i++) {
    const h = ((i / (T_H - 1)) ** 2) * (ATMO_R - EARTH_R);
    const r = EARTH_R + h;
    for (let j = 0; j < T_MU; j++) {
      const mu = -0.3 + (1.3 * j) / (T_MU - 1);
      const o = (i * T_MU + j) * 3;
      if (hitsGround(r, mu)) { lut[o] = lut[o + 1] = lut[o + 2] = 0; continue; }
      const L = distToTop(r, mu), ds = L / steps;
      let dr = 0, dm = 0, dz = 0;
      for (let k = 0; k < steps; k++) {
        const s = (k + 0.5) * ds;
        const hh = Math.sqrt(r * r + s * s + 2 * r * mu * s) - EARTH_R;
        const [a, b, c] = densities(hh);
        dr += a * ds; dm += b * ds; dz += c * ds;
      }
      for (let c = 0; c < 3; c++) lut[o + c] = Math.exp(-(RAYLEIGH[c] * dr + MIE_EXTINCT * haze * dm + OZONE[c] * dz));
    }
  }
  return (h, mu, out) => {
    const x = Math.sqrt(Math.max(0, Math.min(1, h / (ATMO_R - EARTH_R)))) * (T_H - 1);
    const y = ((mu + 0.3) / 1.3) * (T_MU - 1);
    if (y < 0) { out[0] = out[1] = out[2] = 0; return out; }
    const i0 = Math.min(T_H - 2, Math.floor(x)), j0 = Math.min(T_MU - 2, Math.floor(Math.min(y, T_MU - 1)));
    const fx = Math.min(1, x - i0), fy = Math.min(1, y - j0);
    for (let c = 0; c < 3; c++) {
      const a = lut[(i0 * T_MU + j0) * 3 + c], b = lut[((i0 + 1) * T_MU + j0) * 3 + c];
      const d = lut[(i0 * T_MU + j0 + 1) * 3 + c], e = lut[((i0 + 1) * T_MU + j0 + 1) * 3 + c];
      out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
    }
    return out;
  };
}

const rayleighPhase = (mu) => (3 / (16 * Math.PI)) * (1 + mu * mu);
const miePhase = (mu, g) => {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
};

// Returns { width, height, data (RGBA float, nits), sunRadiance, sunIlluminance,
//           sunDir, sunCosMax, groundRadiance }.
export function computeSky({ sunDir, haze = 1, sunSize = 0.53, intensity = 1, ground = [0.18, 0.17, 0.15], width = 512, height = 256 }) {
  haze = Math.max(0, haze);
  const T = transmittanceLUT(haze);
  const tmp = [0, 0, 0];
  const E0 = SUN_ILLUMINANCE * intensity;
  const r0 = EARTH_R + CAMERA_ALT;
  const data = new Float32Array(width * height * 4);
  const viewSteps = 32;

  const skyRadiance = (d, out) => {
    const mu = d[1];
    const L = hitsGround(r0, mu) ? null : distToTop(r0, mu);
    if (L === null) { out[0] = out[1] = out[2] = 0; return out; }
    const nu = d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2];
    const pr = rayleighPhase(nu), pm = miePhase(nu, MIE_G);
    let sr = [0, 0, 0];
    const od = [0, 0, 0];
    // Non-uniform steps: denser near the camera where the air is thick.
    let prev = 0;
    for (let k = 0; k < viewSteps; k++) {
      const s1 = L * ((k + 1) / viewSteps) ** 2;
      const ds = s1 - prev;
      const s = prev + ds * 0.5;
      prev = s1;
      // Sample point, in a frame where the camera is at (0, r0, 0).
      const px = d[0] * s, py = r0 + d[1] * s, pz = d[2] * s;
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const h = r - EARTH_R;
      const [dr, dm, dz] = densities(h);
      const odPrev = [od[0], od[1], od[2]];
      for (let c = 0; c < 3; c++) od[c] += (RAYLEIGH[c] * dr + MIE_EXTINCT * haze * dm + OZONE[c] * dz) * ds;
      const muSun = (px * sunDir[0] + py * sunDir[1] + pz * sunDir[2]) / r;
      T(h, muSun, tmp);
      for (let c = 0; c < 3; c++) {
        // Average transmittance across the step for stability.
        const tv = 0.5 * (Math.exp(-odPrev[c]) + Math.exp(-od[c]));
        sr[c] += tv * tmp[c] * (RAYLEIGH[c] * dr * pr + MIE_SCATTER * haze * dm * pm) * ds;
      }
    }
    out[0] = sr[0] * E0; out[1] = sr[1] * E0; out[2] = sr[2] * E0;
    return out;
  };

  // Upper hemisphere first.
  const half = height / 2;
  const px = [0, 0, 0];
  for (let j = 0; j < half; j++) {
    const v = (j + 0.5) / height;
    for (let i = 0; i < width; i++) {
      const d = dirFromEquirect((i + 0.5) / width, v);
      skyRadiance(d, px);
      const o = (j * width + i) * 4;
      data[o] = px[0]; data[o + 1] = px[1]; data[o + 2] = px[2]; data[o + 3] = 1;
    }
  }

  // Sun as seen from the ground.
  const sunT = [0, 0, 0];
  T(CAMERA_ALT, sunDir[1], sunT);
  const halfAngle = ((sunSize / 2) * Math.PI) / 180;
  const sunCosMax = Math.cos(halfAngle);
  const sunOneMinusCos = 2 * Math.sin(halfAngle / 2) ** 2; // 1 - cos, without cancellation
  const solid = 2 * Math.PI * sunOneMinusCos;
  const sunIlluminance = sunT.map((t) => t * E0);
  const sunRadiance = sunIlluminance.map((e) => e / solid);

  // Sky irradiance on a horizontal surface (cosine-weighted integral).
  const skyE = [0, 0, 0];
  for (let j = 0; j < half; j++) {
    const th = ((j + 0.5) / height) * Math.PI;
    const w = Math.cos(th) * Math.sin(th) * (Math.PI / height) * ((2 * Math.PI) / width);
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4;
      for (let c = 0; c < 3; c++) skyE[c] += data[o + c] * w;
    }
  }
  const cosSun = Math.max(0, sunDir[1]);
  const groundRadiance = ground.map((a, c) => (a / Math.PI) * (sunIlluminance[c] * cosSun + skyE[c]));

  // Lower hemisphere: the ground, fading into the horizon haze.
  for (let j = half; j < height; j++) {
    const v = (j + 0.5) / height;
    for (let i = 0; i < width; i++) {
      const d = dirFromEquirect((i + 0.5) / width, v);
      const horizon = (((half - 1) * width) + i) * 4;
      const k = Math.min(1, -d[1] / 0.08);
      const w = k * k * (3 - 2 * k);
      const o = (j * width + i) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = data[horizon + c] * (1 - w) + groundRadiance[c] * w;
      data[o + 3] = 1;
    }
  }

  return { width, height, data, sunDir, sunRadiance, sunIlluminance, sunCosMax, sunOneMinusCos, groundRadiance, skyIrradiance: skyE };
}
