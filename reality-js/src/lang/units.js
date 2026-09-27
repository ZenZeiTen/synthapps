// Units a number literal may carry, written directly after the digits
// (`50mm`, `12deg`, `1/48s`). Each unit converts to the base unit shown.
// Base units: metres, degrees, seconds, kelvin, lumens, nits (cd/m²).

export const UNITS = {
  // length → metres
  m: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  // angle → degrees (reality.js measures angles in degrees)
  deg: 1,
  rad: 180 / Math.PI,
  turn: 360,
  // time → seconds
  s: 1,
  ms: 0.001,
  min: 60,
  // colour temperature
  K: 1,
  // light
  lm: 1, // luminous flux (lumens)
  nit: 1, // luminance (cd/m²)
  nits: 1,
  lx: 1, // illuminance (lux)
  // exposure
  ev: 1,
  EV: 1,
  // ratio
  '%': 0.01,
  x: 1, // "2x" multiplier, reads well for zoom and speed
};

export const unitNames = () => Object.keys(UNITS);
