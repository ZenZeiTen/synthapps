import { useEffect, useRef } from "react";
import type { Mood } from "../core/model";

/**
 * The ambient scene behind the Neural Core, drawn on one <canvas>: constellations that twinkle, faint concentric
 * rings near the edges, the core's orbit rings and the particles drifting along them.
 *
 * - Orbits follow the `.core-orb` element (read once per frame), so they stay centred when panels move the stage.
 * - Particle and star counts are fixed and small; the loop pauses while the tab is hidden.
 * - With prefers-reduced-motion the scene is drawn still (no orbiting, no twinkle) and only redrawn on changes.
 */

type RGB = [number, number, number];

interface Look {
  dot: RGB;
  warm: RGB;
  ring: RGB;
  ringAlpha: number;
  dotAlpha: number;
  speed: number;
}

const LOOK: Record<Mood, Look> = {
  idle: { dot: [96, 214, 232], warm: [255, 226, 160], ring: [84, 176, 214], ringAlpha: 0.15, dotAlpha: 0.85, speed: 1 },
  thinking: { dot: [128, 228, 255], warm: [250, 214, 150], ring: [110, 196, 240], ringAlpha: 0.28, dotAlpha: 0.95, speed: 2.4 },
  active: { dot: [140, 238, 255], warm: [255, 218, 150], ring: [120, 205, 250], ringAlpha: 0.32, dotAlpha: 1, speed: 3.4 },
  approval: { dot: [238, 186, 110], warm: [255, 214, 146], ring: [214, 160, 92], ringAlpha: 0.24, dotAlpha: 0.9, speed: 1.1 },
  settled: { dot: [110, 214, 196], warm: [240, 214, 160], ring: [80, 170, 170], ringAlpha: 0.13, dotAlpha: 0.75, speed: 0.55 },
  halted: { dot: [196, 72, 62], warm: [214, 96, 64], ring: [150, 52, 46], ringAlpha: 0.14, dotAlpha: 0.6, speed: 0.12 },
  offline: { dot: [112, 120, 134], warm: [128, 128, 132], ring: [96, 104, 118], ringAlpha: 0.1, dotAlpha: 0.45, speed: 0 },
};

interface Particle {
  rx: number; // in orb radii
  ry: number;
  rot: number;
  a: number;
  w: number; // rad/s
  size: number;
  warm: boolean;
}

interface Star {
  x: number; // 0..1 of width
  y: number; // 0..1 of height
  r: number;
  phase: number;
  period: number;
  base: number;
}

const ORBITS = [
  { rx: 1.96, ry: 1.78, rot: -6 },
  { rx: 1.08, ry: 1.62, rot: -24 },
  { rx: 1.78, ry: 1.22, rot: 22 },
];

/** Edge rings: centre (fractions of the viewport) and radii (fractions of its height). */
const EDGE_RINGS = [
  { x: 0.185, y: 0.33, radii: [0.09, 0.19, 0.29] },
  { x: 0.74, y: 0.78, radii: [0.12, 0.21] },
  { x: 0.93, y: 0.12, radii: [0.1] },
];

const PARTICLES = 52;
const WARM = 5;
const CLUSTERS = 17;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeParticles(): Particle[] {
  const r = seeded(7);
  const out: Particle[] = [];
  for (let i = 0; i < PARTICLES + WARM; i++) {
    const warm = i >= PARTICLES;
    const rx = warm ? 1.5 + r() * 0.55 : 1.12 + r() * 1.12;
    out.push({
      rx,
      ry: rx * (0.72 + r() * 0.28),
      rot: ((r() * 70 - 35) * Math.PI) / 180,
      a: r() * Math.PI * 2,
      w: (0.018 + r() * 0.04) * (r() < 0.8 ? 1 : -1),
      size: warm ? 1.9 : 1.05 + r() * 0.95,
      warm,
    });
  }
  return out;
}

/** Constellations: small clusters near the edges, joined by thin lines. Nothing lands on the core's area. */
function makeStars(): { stars: Star[]; links: [number, number][] } {
  const r = seeded(11);
  const stars: Star[] = [];
  const links: [number, number][] = [];
  let guard = 0;
  while (stars.length < CLUSTERS * 3 && guard++ < 500) {
    const cx = 0.03 + r() * 0.94;
    const cy = 0.08 + r() * 0.88;
    const e = ((cx - 0.5) / 0.3) ** 2 + ((cy - 0.52) / 0.44) ** 2;
    if (e < 1) continue; // keep the core's field clear
    if (cy > 0.76 && cx > 0.26 && cx < 0.74) continue; // and the intent dock
    const n = 2 + Math.floor(r() * 3);
    const first = stars.length;
    for (let k = 0; k < n; k++) {
      stars.push({
        x: cx + (r() - 0.5) * 0.07,
        y: cy + (r() - 0.5) * 0.1,
        r: 0.9 + r() * 1.1,
        phase: r() * Math.PI * 2,
        period: 4 + r() * 6,
        base: 0.35 + r() * 0.35,
      });
      if (k > 0) links.push([first + k - 1, first + k]);
    }
    if (n > 2 && r() < 0.4) links.push([first, first + n - 1]);
  }
  return { stars, links };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

interface Props {
  mood: Mood;
  /** Draw the core's orbits and particles (off in the Field view). */
  orbits: boolean;
}

export function Scene({ mood, orbits }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  const orbitsRef = useRef(orbits);
  const redraw = useRef<() => void>(() => {});
  moodRef.current = mood;
  orbitsRef.current = orbits;

  useEffect(() => redraw.current(), [mood, orbits]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const particles = makeParticles();
    const { stars, links } = makeStars();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let look: Look = { ...LOOK[moodRef.current] };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const ease = (dt: number) => {
      const target = LOOK[moodRef.current];
      const k = Math.min(1, dt * 1.6);
      look = {
        dot: mix(look.dot, target.dot, k),
        warm: mix(look.warm, target.warm, k),
        ring: mix(look.ring, target.ring, k),
        ringAlpha: look.ringAlpha + (target.ringAlpha - look.ringAlpha) * k,
        dotAlpha: look.dotAlpha + (target.dotAlpha - look.dotAlpha) * k,
        speed: look.speed + (target.speed - look.speed) * k,
      };
    };

    const draw = (still: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Edge rings.
      ctx.lineWidth = 1;
      for (const g of EDGE_RINGS) {
        for (let i = 0; i < g.radii.length; i++) {
          ctx.strokeStyle = `rgba(78,120,170,${(0.075 - i * 0.012).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(g.x * w, g.y * h, g.radii[i] * h, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Constellations.
      ctx.strokeStyle = "rgba(92,150,170,0.16)";
      ctx.beginPath();
      for (const [a, b] of links) {
        ctx.moveTo(stars[a].x * w, stars[a].y * h);
        ctx.lineTo(stars[b].x * w, stars[b].y * h);
      }
      ctx.stroke();
      for (const s of stars) {
        const tw = still ? 1 : 0.65 + 0.35 * Math.sin((clock / s.period) * Math.PI * 2 + s.phase);
        ctx.fillStyle = `rgba(88,168,188,${(s.base * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!orbitsRef.current) return;
      const orb = document.querySelector<HTMLElement>(".core-orb");
      let cx = w / 2;
      let cy = h * 0.53;
      let R = h * 0.133;
      if (orb) {
        const b = orb.getBoundingClientRect();
        if (b.width > 0) {
          cx = b.left + b.width / 2;
          cy = b.top + b.height / 2;
          R = b.width / 2;
        }
      }

      // Orbit rings.
      ctx.strokeStyle = rgba(look.ring, look.ringAlpha);
      for (const o of ORBITS) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.rx * R, o.ry * R, (o.rot * Math.PI) / 180, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Particles (the orb sits on top of the canvas, so the ones behind it are hidden).
      for (const p of particles) {
        const ca = Math.cos(p.a);
        const sa = Math.sin(p.a);
        const cr = Math.cos(p.rot);
        const sr = Math.sin(p.rot);
        const ex = ca * p.rx * R;
        const ey = sa * p.ry * R;
        const x = cx + ex * cr - ey * sr;
        const y = cy + ex * sr + ey * cr;
        const c = p.warm ? look.warm : look.dot;
        ctx.fillStyle = rgba(c, look.dotAlpha * (p.warm ? 0.3 : 0.14));
        ctx.beginPath();
        ctx.arc(x, y, p.size * (p.warm ? 2.3 : 2.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(c, look.dotAlpha);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      ease(dt);
      for (const p of particles) p.a += p.w * look.speed * dt;
      draw(false);
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      stop();
      if (reduce.matches) {
        look = { ...LOOK[moodRef.current] };
        draw(true);
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    redraw.current = () => {
      if (reduce.matches) {
        look = { ...LOOK[moodRef.current] };
        draw(true);
      }
    };

    resize();
    start();
    // In reduced motion there is no loop; redraw now and then so the orbits follow a moved stage.
    const still = window.setInterval(() => {
      if (reduce.matches && !document.hidden) draw(true);
    }, 700);
    const onResize = () => {
      resize();
      if (reduce.matches) draw(true);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMotion = () => start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    reduce.addEventListener("change", onMotion);
    return () => {
      stop();
      window.clearInterval(still);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener("change", onMotion);
      redraw.current = () => {};
    };
  }, []);

  return <canvas ref={ref} className="scene" aria-hidden="true" />;
}
