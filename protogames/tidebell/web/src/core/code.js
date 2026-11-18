// The tide-code (DESIGN S6): 6 letters of a 16-letter alphabet. A port of
// godot/scripts/core/code.gd; the bit layout is described there.
const ALPHA = 'BCDFGHJKLMNPRSTW';
const HP_STEPS = [71, 95, 119, 127];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function check(v) {
  let s = 0x2B;
  for (let i = 0; i < 3; i++) s = (s * 7 + ((v >> (i * 6)) & 63)) & 63;
  return s;
}

export function encode(p) {
  let hpStep = 0;
  for (let i = 0; i < HP_STEPS.length; i++) if ((p.maxhp | 0) >= HP_STEPS[i]) hpStep = i;
  let v = clamp(p.done | 0, 0, 6);
  v |= (clamp(p.lives | 0, 1, 8) - 1) << 3;
  v |= hpStep << 6;
  v |= clamp(p.difficulty | 0, 0, 2) << 8;
  v |= clamp(p.items.knives | 0, 0, 9) << 10;
  v |= clamp(p.items.tonic | 0, 0, 9) << 14;
  v |= check(v) << 18;
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHA[(v >> (i * 4)) & 15];
  return s;
}

// Returns null for a code that is not valid.
export function decode(code) {
  const c = code.trim().toUpperCase();
  if (c.length !== 6) return null;
  let v = 0;
  for (let i = 0; i < 6; i++) {
    const k = ALPHA.indexOf(c[i]);
    if (k < 0) return null;
    v |= k << (i * 4);
  }
  const body = v & 0x3FFFF;
  if ((v >> 18) !== check(body)) return null;
  const done = body & 7;
  const diff = (body >> 8) & 3;
  const knives = (body >> 10) & 15;
  const tonic = (body >> 14) & 15;
  if (done > 6 || diff > 2 || knives > 9 || tonic > 9) return null;
  return { done, lives: ((body >> 3) & 7) + 1, maxhp: HP_STEPS[(body >> 6) & 3], difficulty: diff,
    items: { knives, tonic } };
}

export { ALPHA };
