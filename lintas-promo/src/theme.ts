import { Easing, interpolate } from "remotion";

export const C = {
  teal: "#0E8C86",
  deep: "#096A66",
  ink: "#0B1416",
  paper: "#F2F5F7",
  jade: "#3CBF9A",
  jade2: "#4FD8C8",
  glow: "#A8FFF2",
  gold: "#D4AF37",
  goldHi: "#F4D96B",
};

export const FONT =
  'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
export const SERIF = 'Georgia, "Times New Roman", serif';

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.inOut(Easing.cubic);

/** 0 -> 1 progress between start and start+dur, clamped. */
export const prog = (
  frame: number,
  start: number,
  dur: number,
  easing: (t: number) => number = ease,
) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Scene lengths (frames) and the overlap used by every transition.
export const T = 15;
export const SCENES = {
  intro: 210,
  hook: 120,
  browse: 360,
  translate: 360,
  tms: 450,
  oracle: 450,
  ext: 360,
  secure: 240,
  outro: 270,
};
export const TOTAL =
  Object.values(SCENES).reduce((a, b) => a + b, 0) -
  T * (Object.keys(SCENES).length - 1);
