// Time-varying values.
//
// In reality.js any value can depend on time. The name `t` is a Signal
// (seconds since the start of the timeline), and any arithmetic or function
// call that touches a Signal produces another Signal. Scenes are resolved to
// plain values at a given time only when they are rendered, which is what
// lets the renderer sample several instants inside one frame for motion blur.

export class Signal {
  constructor(fn) {
    this.fn = fn;
  }
  at(time) {
    return resolve(this.fn(time), time);
  }
}

export const TIME = new Signal((time) => time);

export function isTimeVarying(v) {
  if (v instanceof Signal) return true;
  if (Array.isArray(v)) return v.some(isTimeVarying);
  return false;
}

// Replace every Signal inside `v` with its value at `time`. Nodes are left
// alone: they resolve their own properties when the scene is sampled.
export function resolve(v, time) {
  if (v instanceof Signal) return v.at(time);
  if (Array.isArray(v) && v.some(isTimeVarying)) return v.map((x) => resolve(x, time));
  return v;
}

// Apply `fn` to `args`; if any argument varies with time, defer the call.
export function lift(fn, args) {
  if (args.some(isTimeVarying)) {
    return new Signal((time) => fn(...args.map((a) => resolve(a, time))));
  }
  return fn(...args);
}
