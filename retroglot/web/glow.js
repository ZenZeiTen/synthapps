// The light behind the home screen: a few slow, soft pools of the current
// system's colour, drawn small and stretched so they stay smooth and cheap.
export function startGlow(canvas, getColor) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 160, H = 100;
  canvas.width = W; canvas.height = H;
  const blobs = [
    { x: 0.18, y: 0.18, r: 0.75, sx: 0.00011, sy: 0.00007, p: 0, a: 0.55 },
    { x: 0.82, y: 0.3, r: 0.6, sx: 0.00008, sy: 0.00012, p: 2, a: 0.32 },
    { x: 0.5, y: 0.95, r: 0.7, sx: 0.00006, sy: 0.00009, p: 4, a: 0.22 },
  ];
  let last = 0;
  const draw = (t) => {
    if (!reduce) requestAnimationFrame(draw);
    if (t - last < 40) return; // about 25 frames a second is plenty for drifting light
    last = t;
    const c = getColor();
    ctx.fillStyle = '#090b17';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const x = (b.x + Math.sin(t * b.sx + b.p) * 0.12) * W;
      const y = (b.y + Math.cos(t * b.sy + b.p) * 0.1) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.r * W);
      g.addColorStop(0, rgba(c, b.a * 0.55));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  };
  requestAnimationFrame(draw);
  if (reduce) draw(performance.now() + 1000);
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
