// Easing curves, keyframe interpolation and closed-form physical motion.
//
// Every motion helper is a pure function of time. That matters: motion blur
// samples many instants inside one frame, and a video can be rendered from
// any frame without replaying the frames before it.

import { noise3 } from '../core/noise.js';

export const GRAVITY = 9.81; // m/s²

export const EASINGS = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  in_out: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  smooth: (x) => x * x * (3 - 2 * x),
  sine_in: (x) => 1 - Math.cos((x * Math.PI) / 2),
  sine_out: (x) => Math.sin((x * Math.PI) / 2),
  sine_in_out: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  expo_in: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  expo_out: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  expo_in_out: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  back_in: (x) => 2.70158 * x * x * x - 1.70158 * x * x,
  back_out: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  step: (x) => (x < 1 ? 0 : 1),
};

const mixValue = (a, b, k) => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => mixValue(v, b[i], k));
  return k < 1 ? a : b;
};

// entries: [{ time, value, ease }] sorted by time. An entry's `ease` shapes
// the segment that arrives at it; the default is in_out.
export function sampleKeys(entries, time) {
  if (time <= entries[0].time) return entries[0].value;
  const last = entries[entries.length - 1];
  if (time >= last.time) return last.value;
  let i = 1;
  while (entries[i].time < time) i++;
  const a = entries[i - 1], b = entries[i];
  const span = b.time - a.time;
  const x = span > 0 ? (time - a.time) / span : 1;
  const ease = EASINGS[b.ease ?? 'in_out'];
  return mixValue(a.value, b.value, ease(x));
}

// Height of a ball dropped from `height` at time `start`, bouncing on y = 0
// and keeping `restitution` of its speed each bounce. Returns metres.
export function bounce(time, height = 1, restitution = 0.6, start = 0, gravity = GRAVITY) {
  let t = time - start;
  if (t <= 0) return height;
  const fall = Math.sqrt((2 * height) / gravity);
  if (t < fall) return height - 0.5 * gravity * t * t;
  t -= fall;
  let v = Math.sqrt(2 * gravity * height) * restitution;
  for (let k = 0; k < 200 && v > 1e-3; k++) {
    const flight = (2 * v) / gravity;
    if (t < flight) return Math.max(0, v * t - 0.5 * gravity * t * t);
    t -= flight;
    v *= restitution;
  }
  return 0;
}

// Free fall from `height` starting at `start`, stopping at the ground.
export function fall(time, height = 1, start = 0, gravity = GRAVITY) {
  const t = Math.max(0, time - start);
  return Math.max(0, height - 0.5 * gravity * t * t);
}

// Damped spring moving from `from` to `to`, released at `start` with zero
// velocity. `frequency` in Hz, `damping` as a ratio (1 = no overshoot).
export function spring(time, from, to, frequency = 1.5, damping = 0.3, start = 0) {
  const t = time - start;
  if (t <= 0) return from;
  const w = 2 * Math.PI * frequency;
  const z = Math.max(0, damping);
  let k;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    k = Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  } else {
    k = (1 + w * t) * Math.exp(-w * t);
  }
  return mixValue(to, from, k);
}

// Position on a horizontal circle around `center`. `period` in seconds per
// turn, `phase` in degrees.
export function orbit(time, center = [0, 0, 0], radius = 1, period = 4, phase = 0) {
  const a = (2 * Math.PI * time) / period + (phase * Math.PI) / 180;
  return [center[0] + radius * Math.cos(a), center[1], center[2] + radius * Math.sin(a)];
}

// Swing angle in degrees of a pendulum of `length` metres released from
// `amplitude` degrees at `start`. Uses the large-amplitude period correction
// and an optional exponential `damping` per second.
export function pendulum(time, length = 1, amplitude = 30, start = 0, damping = 0) {
  const t = Math.max(0, time - start);
  const th0 = (amplitude * Math.PI) / 180;
  const period = 2 * Math.PI * Math.sqrt(length / GRAVITY) * (1 + (th0 * th0) / 16);
  return amplitude * Math.exp(-damping * t) * Math.cos((2 * Math.PI * t) / period);
}

// Smooth random drift, like a hand-held camera: a 3-vector in roughly
// [-amount, amount]. `frequency` is the rough number of sways per second.
export function wobble(time, amount = 0.01, frequency = 0.6, seed = 0) {
  const f = (s) => {
    const x = time * frequency;
    return (noise3(x, s * 7.1, seed * 3.3) + 0.5 * noise3(x * 2.1, s * 7.1 + 50, seed * 3.3)) / 0.75;
  };
  return [f(1) * amount, f(2) * amount, f(3) * amount * 0.5];
}
