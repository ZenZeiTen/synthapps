import { useEffect, useRef } from "react";
import type { Mood } from "../core/model";
import type { KernelEvent } from "../types";

/**
 * The ambient scene behind the Neural Core, drawn on one <canvas>: constellations that twinkle, faint concentric
 * rings near the edges, the core's orbit rings and the particles drifting along them.
 *
 * - Orbits follow the `.core-orb` element (read once per frame), so they stay centred when panels move the stage.
 * - Particle and star counts are fixed and small; the loop pauses while the tab is hidden.
 * - With prefers-reduced-motion the scene is drawn still (no orbiting, no twinkle) and only redrawn on changes.
 *
 * The neurons follow what Nalara is doing:
 * - Each kernel event fires a short pulse (see PULSE_FOR): a tool call sends a spark from the core out to a neuron, a
 *   message between agents lights a synapse between two neurons, an agent waking up runs a wave along an orbit, a file
 *   or memory change lights a constellation, finished work flares the warm neurons, a failure flashes red. The same
 *   agent or tool always lands on the same neuron.
 * - Activity builds up energy that speeds the drift and brightens the dots, then settles back in a few seconds.
 * - The five warm neurons stand for running agents: one lights up per running agent.
 * - With reduced motion, pulses are brightness flashes in place; nothing travels.
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

type PulseKind = "spark" | "synapse" | "ripple" | "star" | "burst" | "fail";

/** Which pulse each kernel event fires; events not listed (logs, secrets) fire none. */
const PULSE_FOR: Partial<Record<KernelEvent["type"], PulseKind>> = {
  "tool.called": "spark",
  "tool.result": "spark",
  "tool.approval_requested": "spark",
  "tool.approval_resolved": "spark",
  "mcp.connected": "spark",
  "agent.message": "synapse",
  "relay.message": "synapse",
  "review.round": "synapse",
  "review.verdict": "synapse",
  "intent.received": "ripple",
  "intent.classified": "ripple",
  "workspace.generated": "ripple",
  "workspace.started": "ripple",
  "agent.summoned": "ripple",
  "agent.state": "ripple",
  "task.assigned": "ripple",
  "trigger.fired": "ripple",
  "kernel.resumed": "ripple",
  "file.created": "star",
  "file.updated": "star",
  "file.deleted": "star",
  "node.created": "star",
  "node.updated": "star",
  "edge.created": "star",
  "memory.updated": "star",
  "workspace.checkpoint": "star",
  "journal.undone": "star",
  "agent.finished": "burst",
  "task.completed": "burst",
  "workspace.completed": "burst",
  "deployment.succeeded": "burst",
  "agent.failed": "fail",
  "workspace.failed": "fail",
  "deployment.failed": "fail",
  "budget.exceeded": "fail",
  "kernel.halted": "fail",
  "mcp.disconnected": "fail",
};

/** How long each pulse lasts, in seconds. */
const LIFE: Record<PulseKind, number> = { spark: 1.5, synapse: 1.4, ripple: 1.8, star: 1.6, burst: 1.6, fail: 1.4 };
/** Energy each pulse adds; energy decays with a time constant of ENERGY_TAU seconds. */
const KICK: Record<PulseKind, number> = { spark: 0.22, synapse: 0.18, ripple: 0.26, star: 0.12, burst: 0.4, fail: 0.3 };
const ENERGY_MAX = 1.6;
const ENERGY_TAU = 3.2;
const MAX_PULSES = 40;
const FAIL_RGB: RGB = [240, 96, 84];

interface Pulse {
  kind: PulseKind;
  t0: number; // seconds (performance.now based)
  a: number; // particle, orbit or link index, by kind
  b: number; // second particle (synapse) or angle offset
}

/** FNV-1a, so one agent or tool keeps one neuron. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function field(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const v = (data as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : undefined;
}

/** 0 → 1 quickly, then back to 0 over the rest of the pulse. */
function envelope(age: number, life: number): number {
  if (age < 0 || age > life) return 0;
  const rise = Math.min(0.18, life * 0.15);
  return age < rise ? age / rise : 1 - (age - rise) / (life - rise);
}

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

const brighten = (c: RGB, t: number): RGB => mix(c, [255, 255, 255], t);

interface Props {
  mood: Mood;
  /** Draw the core's orbits and particles (off in the Field view). */
  orbits: boolean;
  /** Agents running now; each lights one warm neuron (up to five). */
  activeAgents?: number;
  /** Subscribe to kernel events; returns the unsubscribe function. */
  onEvent?: (listener: (ev: KernelEvent) => void) => () => void;
}

export function Scene({ mood, orbits, activeAgents = 0, onEvent }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  const orbitsRef = useRef(orbits);
  const agentsRef = useRef(activeAgents);
  const redraw = useRef<() => void>(() => {});
  const spawn = useRef<(ev: KernelEvent) => void>(() => {});
  moodRef.current = mood;
  orbitsRef.current = orbits;
  agentsRef.current = activeAgents;

  useEffect(() => redraw.current(), [mood, orbits, activeAgents]);
  useEffect(() => (onEvent ? onEvent((ev) => spawn.current(ev)) : undefined), [onEvent]);

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
    const pulses: Pulse[] = [];
    let energy = 0;
    let energyAt = performance.now() / 1000;
    let fired = 0;
    const counts: Record<PulseKind, number> = { spark: 0, synapse: 0, ripple: 0, star: 0, burst: 0, fail: 0 };
    // Where each particle was last drawn, for pulses that aim at it.
    const px = new Float32Array(particles.length);
    const py = new Float32Array(particles.length);
    const dots = PARTICLES; // the cool neurons; warm ones stand for agents
    const seconds = () => performance.now() / 1000;
    const energyNow = (t: number) => energy * Math.exp(-(t - energyAt) / ENERGY_TAU);

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

    spawn.current = (ev) => {
      const kind = PULSE_FOR[ev.type];
      if (!kind) return;
      // The stream replays recent history on (re)connect; only live events fire pulses.
      const at = Date.parse(ev.ts);
      if (Number.isFinite(at) && Date.now() - at > 5000) return;
      const t = seconds();
      energy = Math.min(ENERGY_MAX, energyNow(t) + KICK[kind]);
      energyAt = t;
      const d = ev.data;
      const who = field(d, "agentId") ?? field(d, "from") ?? field(d, "tool") ?? field(d, "name") ?? ev.source ?? ev.type;
      const h = hash(who);
      let a = h % dots;
      let b = 0;
      if (kind === "synapse") {
        const to = field(d, "to") ?? field(d, "workspaceId") ?? ev.correlationId ?? `${ev.seq}`;
        b = hash(to) % dots;
        if (b === a) b = (a + 7) % dots;
      } else if (kind === "ripple") {
        a = h % ORBITS.length;
        b = (h >>> 8) % 628 / 100;
      } else if (kind === "star") {
        a = links.length ? hash(field(d, "path") ?? field(d, "key") ?? who) % links.length : 0;
      }
      pulses.push({ kind, t0: t, a, b });
      if (pulses.length > MAX_PULSES) pulses.splice(0, pulses.length - MAX_PULSES);
      fired++;
      counts[kind]++;
      // For tests and curious people: how many pulses the scene has fired, by kind.
      canvas.dataset.pulses = String(fired);
      canvas.dataset.pulseKinds = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}:${n}`)
        .join(" ");
      if (reduce.matches && !document.hidden) draw(true);
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

      const t = seconds();
      while (pulses.length && t - pulses[0].t0 > 2.5) pulses.shift();
      const e = energyNow(t);

      // A file, node or memory change lights one constellation link and its two stars.
      for (const p of pulses) {
        if (p.kind !== "star" || !links.length) continue;
        const k = envelope(t - p.t0, LIFE.star);
        if (k <= 0) continue;
        const [i, j] = links[p.a];
        const A = stars[i];
        const B = stars[j];
        ctx.strokeStyle = `rgba(150,226,240,${(0.55 * k).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(A.x * w, A.y * h);
        ctx.lineTo(B.x * w, B.y * h);
        ctx.stroke();
        ctx.lineWidth = 1;
        for (const s of [A, B]) {
          ctx.fillStyle = `rgba(150,226,240,${(0.22 * k).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x * w, s.y * h, s.r * (3 + 3 * k), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(200,244,252,${(0.9 * k).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(s.x * w, s.y * h, s.r * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
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

      // Orbit rings: a little brighter while there is activity.
      const ringAlpha = Math.min(0.5, look.ringAlpha * (1 + 0.5 * e));
      ctx.strokeStyle = rgba(look.ring, ringAlpha);
      for (const o of ORBITS) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, o.rx * R, o.ry * R, (o.rot * Math.PI) / 180, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Particles (the orb sits on top of the canvas, so the ones behind it are hidden). Activity brightens and swells
      // the cool neurons a little; each warm neuron is an agent slot, lit while an agent runs.
      const lit = Math.min(WARM, Math.max(0, Math.round(agentsRef.current)));
      const dotAlpha = Math.min(1, look.dotAlpha * (1 + 0.22 * e));
      const swell = 1 + 0.18 * Math.min(1, e);
      for (let n = 0; n < particles.length; n++) {
        const p = particles[n];
        const ca = Math.cos(p.a);
        const sa = Math.sin(p.a);
        const cr = Math.cos(p.rot);
        const sr = Math.sin(p.rot);
        const ex = ca * p.rx * R;
        const ey = sa * p.ry * R;
        const x = cx + ex * cr - ey * sr;
        const y = cy + ex * sr + ey * cr;
        px[n] = x;
        py[n] = y;
        let alpha = dotAlpha;
        let size = p.size * swell;
        let halo = p.warm ? 0.3 : 0.14;
        if (p.warm) {
          const slot = n - PARTICLES;
          if (slot < lit) {
            // A running agent: brighter, larger, and its glow beats gently (steady with reduced motion).
            const beat = still ? 1 : 0.8 + 0.2 * Math.sin(clock * 2.6 + slot * 1.3);
            alpha = Math.min(1, dotAlpha * 1.1);
            size = p.size * 1.3;
            halo = 0.42 * beat;
          } else {
            alpha = dotAlpha * 0.4;
            halo = 0.1;
          }
        }
        const c = p.warm ? look.warm : look.dot;
        ctx.fillStyle = rgba(c, alpha * halo);
        ctx.beginPath();
        ctx.arc(x, y, size * (p.warm ? 2.3 : 2.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(c, alpha);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pulses around the core.
      const flare = (x: number, y: number, c: RGB, k: number, r: number) => {
        ctx.fillStyle = rgba(c, 0.28 * k);
        ctx.beginPath();
        ctx.arc(x, y, r * (2.5 + 5 * k), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(brighten(c, 0.55), Math.min(1, 0.95 * k + 0.1));
        ctx.beginPath();
        ctx.arc(x, y, r * (1 + 0.8 * k), 0, Math.PI * 2);
        ctx.fill();
      };
      for (const p of pulses) {
        const age = t - p.t0;
        const life = LIFE[p.kind];
        const k = envelope(age, life);
        if (k <= 0) continue;
        const f = age / life;
        if (p.kind === "spark") {
          // From the core's rim out to the neuron, then the neuron flares.
          const tx = px[p.a];
          const ty = py[p.a];
          const ang = Math.atan2(ty - cy, tx - cx);
          const sx = cx + Math.cos(ang) * R * 1.02;
          const sy = cy + Math.sin(ang) * R * 1.02;
          const travel = still ? 1 : Math.min(1, f / 0.4);
          if (!still && travel < 1) {
            for (let i = 0; i < 6; i++) {
              const q = Math.max(0, travel - i * 0.05);
              ctx.fillStyle = rgba(brighten(look.dot, 0.5), (0.85 - i * 0.13) * Math.min(1, k * 1.4));
              ctx.beginPath();
              ctx.arc(sx + (tx - sx) * q, sy + (ty - sy) * q, 1.8 - i * 0.22, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            ctx.strokeStyle = rgba(look.dot, 0.18 * k);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            flare(tx, ty, look.dot, k, particles[p.a].size);
          }
        } else if (p.kind === "synapse") {
          // Two neurons joined for a moment; a signal runs along the link.
          const ax = px[p.a];
          const ay = py[p.a];
          const bx = px[p.b];
          const by = py[p.b];
          ctx.strokeStyle = rgba(brighten(look.dot, 0.3), 0.45 * k);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(cx + (ax + bx - 2 * cx) * 0.15, cy + (ay + by - 2 * cy) * 0.15, bx, by);
          ctx.stroke();
          ctx.lineWidth = 1;
          if (!still) {
            const q = Math.min(1, f / 0.75);
            const mx = cx + (ax + bx - 2 * cx) * 0.15;
            const my = cy + (ay + by - 2 * cy) * 0.15;
            const hx = (1 - q) * (1 - q) * ax + 2 * (1 - q) * q * mx + q * q * bx;
            const hy = (1 - q) * (1 - q) * ay + 2 * (1 - q) * q * my + q * q * by;
            ctx.fillStyle = rgba(brighten(look.dot, 0.6), k);
            ctx.beginPath();
            ctx.arc(hx, hy, 1.9, 0, Math.PI * 2);
            ctx.fill();
          }
          flare(ax, ay, look.dot, k * 0.7, particles[p.a].size);
          flare(bx, by, look.dot, still ? k : k * Math.min(1, f / 0.75), particles[p.b].size);
        } else if (p.kind === "ripple") {
          // A wave runs once along one orbit.
          const o = ORBITS[p.a];
          const rot = (o.rot * Math.PI) / 180;
          ctx.strokeStyle = rgba(brighten(look.ring, 0.2), Math.min(0.45, look.ringAlpha + 0.18 * k));
          ctx.beginPath();
          ctx.ellipse(cx, cy, o.rx * R, o.ry * R, rot, 0, Math.PI * 2);
          ctx.stroke();
          if (!still) {
            const head = p.b + f * Math.PI * 2;
            ctx.strokeStyle = rgba(brighten(look.dot, 0.5), 0.85 * k);
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.ellipse(cx, cy, o.rx * R, o.ry * R, rot, head - 0.7, head);
            ctx.stroke();
          }
          ctx.lineWidth = 1;
        } else if (p.kind === "burst" || p.kind === "fail") {
          // Finished work flares the warm neurons and sends one ring out; a failure does the same in red.
          const c = p.kind === "fail" ? FAIL_RGB : look.warm;
          const ringR = R * (still ? 1.5 : 1.05 + 1.1 * f);
          ctx.strokeStyle = rgba(c, 0.4 * k);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
          if (p.kind === "burst") {
            for (let n = PARTICLES; n < particles.length; n++) flare(px[n], py[n], c, k, particles[n].size);
          } else {
            for (let i = 0; i < 3; i++) {
              const n = (p.a + i * 17) % dots;
              flare(px[n], py[n], c, k, particles[n].size);
            }
          }
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      ease(dt);
      // Activity and running agents speed the drift up; nothing moves while offline.
      const boost = look.speed > 0 ? 1 + 0.55 * Math.min(1.2, energyNow(seconds())) + 0.06 * Math.min(6, agentsRef.current) : 1;
      for (const p of particles) p.a += p.w * look.speed * boost * dt;
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
      spawn.current = () => {};
    };
  }, []);

  return <canvas ref={ref} className="scene" aria-hidden="true" />;
}
