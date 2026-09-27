// Physical camera maths: field of view from lens and sensor, depth of field
// from the f-number, and exposure from aperture, shutter and ISO.

import { DEG, normalize, cross, sub, length, scale, add } from '../core/math.js';

// EV100 for aperture N (f-number), shutter t (seconds) and ISO.
export function ev100(N, t, iso) {
  return Math.log2((N * N) / t) - Math.log2(iso / 100);
}

// Multiplier that maps scene luminance (nits) to sensor value, using the
// saturation-based sensitivity convention: a luminance of 1.2 * 2^EV100
// just saturates the sensor. See Lagarde and de Rousiers, "Moving Frostbite
// to Physically Based Rendering" (2014), section 4.
export function exposureFromEV100(ev) {
  return 1 / (1.2 * Math.pow(2, ev));
}

// The "sunny 16" rule, for tests: f/16, 1/ISO seconds.
export const SUNNY_16_EV100 = ev100(16, 1 / 100, 100);

// Resolve camera properties (already sampled at one instant) into the
// numbers the renderer needs.
export function cameraFrame(p, aspect, defaultShutter) {
  const forward = normalize(sub(p.look_at, p.position));
  let up0 = normalize(p.up);
  if (Math.abs(forward[0] * up0[0] + forward[1] * up0[1] + forward[2] * up0[2]) > 0.999) up0 = [0, 0, 1];
  let right = normalize(cross(forward, up0));
  let up = cross(right, forward);
  if (p.roll) {
    const c = Math.cos(p.roll * DEG), s = Math.sin(p.roll * DEG);
    const r2 = add(scale(right, c), scale(up, s));
    up = add(scale(right, -s), scale(up, c));
    right = r2;
  }

  const focal = p.lens;
  const tanHalfW = p.fov ? Math.tan((p.fov * DEG) / 2) : p.sensor / (2 * focal);
  const tanHalfH = tanHalfW / aspect;

  const focus = p.focus === 'auto' ? Math.max(0.01, length(sub(p.look_at, p.position))) : Math.max(0.01, p.focus);
  // Aperture diameter = focal length / f-number. With fov set there is no
  // physical focal length, so derive one from the default sensor.
  const effFocal = p.fov ? p.sensor / (2 * tanHalfW) : focal;
  const lensRadius = p.aperture > 0 ? effFocal / p.aperture / 2 : 0;
  const shutter = p.shutter ?? defaultShutter;

  let exposure = null;
  if (p.exposure === 'manual') {
    const N = p.aperture > 0 ? p.aperture : 8;
    exposure = exposureFromEV100(ev100(N, shutter, p.iso)) * Math.pow(2, p.exposure_compensation);
  }

  return {
    position: p.position, forward, right, up,
    tanHalfW, tanHalfH, focus, lensRadius, shutter,
    rolling: Math.max(0, p.rolling_shutter),
    blades: Math.max(0, Math.round(p.blades)),
    bladeRotation: p.blade_rotation * DEG,
    distortion: p.distortion,
    exposure, // null means auto exposure
    compensation: p.exposure_compensation,
  };
}

// Unit vector toward the sun. Azimuth 0 is north (−Z), 90 is east (+X).
export function sunDirection(elevationDeg, azimuthDeg) {
  const e = elevationDeg * DEG, a = azimuthDeg * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
