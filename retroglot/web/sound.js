// Small menu sounds made on the fly (no audio files): a soft tick to move,
// a rising pair to confirm, a falling note to go back.
let ctx = null;
let enabled = true;

export function setSounds(on) {
  enabled = !!on;
}

function tone(freq, start, dur, type = 'triangle', gain = 0.05) {
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function play(kind) {
  if (!enabled) return;
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'move') tone(1320, 0, 0.05, 'sine', 0.025);
    else if (kind === 'switch') { tone(660, 0, 0.07, 'triangle', 0.035); tone(990, 0.04, 0.08, 'triangle', 0.03); }
    else if (kind === 'select') { tone(784, 0, 0.09, 'triangle', 0.05); tone(1175, 0.07, 0.14, 'triangle', 0.05); }
    else if (kind === 'back') tone(523, 0, 0.12, 'triangle', 0.04);
    else if (kind === 'fav') { tone(1047, 0, 0.07, 'sine', 0.04); tone(1568, 0.05, 0.12, 'sine', 0.035); }
  } catch { /* audio unavailable */ }
}
