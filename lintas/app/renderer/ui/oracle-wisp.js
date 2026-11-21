// AI Oracle — Jade Wisp mascot and the Council of Minds strip.
// No dependencies. Everything visual lives in styles/oracle.css; this module only builds DOM
// and flips classes/attributes, so all motion is CSS transform/opacity.

const NS = 'http://www.w3.org/2000/svg';
export const ROLES = ['research', 'planning', 'memory', 'action'];
export const ROLE_LABELS = {
  research: 'Researcher gathering evidence',
  planning: 'Strategist forming a plan',
  memory: 'Memory recalling context',
  action: 'Agent taking action',
};
const ROLE_SHORT = { research: 'Researcher', planning: 'Strategist', memory: 'Memory', action: 'Agent' };
// One closed outline (fills when lit) + one stroked detail per role: the shape tells the role, not the colour.
const GLYPH = {
  research: ['M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3Z', 'M12 10.4v3.2M10.4 12h3.2'],
  planning: ['M12 2.6l8.1 4.7v9.4L12 21.4l-8.1-4.7V7.3Z', 'M12 8.2l3.4 5.9H8.6Z'],
  memory: ['M7 3.5h10A3.5 3.5 0 0 1 20.5 7v10a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17V7A3.5 3.5 0 0 1 7 3.5Z', 'M8 8.5h8M8 12h4.5M8 15.5h8M14.5 12v3.5'],
  action: ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18Z', 'M7.5 12h8.5M12.5 8l4 4-4 4'],
};
const MANIFEST_GAP = 15 * 60 * 1000;
const MANIFEST_MS = 4200;
let lastManifest = -Infinity;
let uid = 0;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  for (const k of kids) if (k) el.appendChild(k);
  return el;
}
function h(tag, cls, ...kids) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k != null) el.append(k);
  return el;
}
const svg = (cls, box, ...kids) => { const el = s('svg', { viewBox: box, focusable: 'false' }, ...kids); el.setAttribute('class', cls); return el; };
const stops = (list) => list.map(([o, c, a]) => s('stop', a == null ? { offset: o, 'stop-color': c } : { offset: o, 'stop-color': c, 'stop-opacity': a }));
const glyph = (role, cls = 'o-glyph') => svg(cls, '0 0 24 24', s('path', { class: 'o', d: GLYPH[role][0] }), s('path', { class: 'i', d: GLYPH[role][1] }));
const polar = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [+(r * Math.cos(a)).toFixed(2), +(r * Math.sin(a)).toFixed(2)]; };
const ngon = (r, n, rot = 0) => 'M' + Array.from({ length: n }, (_, i) => polar(r, rot + (360 / n) * i).join(' ')).join('L') + 'Z';

// Pause every mascot/council animation while the window is hidden.
const live = new Set();
let watching = false;
function track(el) {
  live.add(new WeakRef(el));
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    for (const ref of live) {
      const node = ref.deref();
      if (!node) live.delete(ref); else node.classList.toggle('is-paused', document.hidden);
    }
  });
}

/* ------------------------------------------------------------------ Jade Wisp */
function buildRings(id) {
  const gold = s('linearGradient', { id: `${id}g`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops([[0, '#F4D96B'], [0.45, '#D4AF37'], [1, '#83621A']]));
  const studs = [0, 90, 180, 270].map((d) => { const [x, y] = polar(46, d); return s('path', { d: `M${x} ${y - 3.2}l2.6 3.2-2.6 3.2-2.6-3.2Z`, fill: '#F4D96B', stroke: '#83621A', 'stroke-width': 0.5 }); });
  const outer = svg('o-wisp-ring outer', '-50 -50 100 100', s('defs', null, gold),
    s('circle', { r: 46, fill: 'none', stroke: `url(#${id}g)`, 'stroke-width': 3.4 }),
    s('circle', { r: 46, fill: 'none', stroke: '#83621A', 'stroke-width': 1.5, 'stroke-dasharray': '1.1 4.92', opacity: 0.85 }),
    s('circle', { r: 43.6, fill: 'none', stroke: '#F4D96B', 'stroke-width': 0.5, opacity: 0.7 }), ...studs);
  const marks = [36, 108, 180, 252, 324].map((d) => { const [x, y] = polar(37, d); return s('path', { d: `M${x} ${y - 2.4}l1.8 2.4-1.8 2.4-1.8-2.4Z`, fill: 'none', stroke: '#D4AF37', 'stroke-width': 0.8 }); });
  const mid = svg('o-wisp-ring mid', '-50 -50 100 100',
    s('circle', { r: 37, fill: 'none', stroke: '#4FD8C8', 'stroke-width': 2.2, 'stroke-dasharray': '31 15.5', 'stroke-linecap': 'round', opacity: 0.8, transform: 'rotate(-110)' }),
    s('circle', { r: 37, fill: 'none', stroke: '#EFFFFB', 'stroke-width': 0.7, 'stroke-dasharray': '2 3 9 32.5', opacity: 0.9, transform: 'rotate(-100)' }), ...marks);
  const inner = svg('o-wisp-ring inner', '-50 -50 100 100',
    s('ellipse', { rx: 29, ry: 11, fill: 'none', stroke: '#A8FFF2', 'stroke-width': 1.1, transform: 'rotate(-24)' }),
    s('ellipse', { rx: 29, ry: 11, fill: 'none', stroke: '#4FD7FF', 'stroke-width': 0.8, 'stroke-dasharray': '10 6', opacity: 0.8, transform: 'rotate(40)' }),
    s('circle', { cx: polar(29, 66)[0], cy: polar(11, 66)[1], r: 1.7, fill: '#EFFFFB', transform: 'rotate(-24)' }));
  return [outer, mid, inner];
}

function buildCore(id) {
  const orb = svg('o-wisp-orb', '-25 -25 50 50',
    s('defs', null, s('radialGradient', { id: `${id}o`, cx: 0.38, cy: 0.32, r: 0.75 }, ...stops([[0, '#EFFFFB'], [0.22, '#A8FFF2'], [0.55, '#4FD8C8'], [0.84, '#3CBF9A'], [1, '#1F7F6E']]))),
    s('circle', { r: 25, fill: `url(#${id}o)` }),
    s('path', { d: 'M-25 0L-9 -14 8 -9 25 0 9 13 -10 9ZM-9 -14L-10 9M8 -9L9 13M-9 -14L0 -25 8 -9M-10 9L0 25 9 13', fill: 'none', stroke: '#EFFFFB', 'stroke-width': 0.5, opacity: 0.4 }));
  const flowA = svg('o-wisp-flow a', '-25 -25 50 50',
    s('path', { d: 'M-18 6C-12 -10 2 -16 14 -8M-6 18C8 20 18 10 18 -2', fill: 'none', stroke: '#EFFFFB', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.5 }));
  const flowB = svg('o-wisp-flow b', '-25 -25 50 50',
    s('path', { d: 'M-12 -12C-2 -4 2 6 -4 16M6 -18C14 -8 12 6 4 12', fill: 'none', stroke: '#4FD7FF', 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: 0.55 }));
  const shine = svg('o-wisp-shine', '-25 -25 50 50', s('ellipse', { cx: -8, cy: -11, rx: 7, ry: 4, fill: '#fff', opacity: 0.7, transform: 'rotate(-32 -8 -11)' }));
  const mark = svg('o-wisp-mark', '-25 -25 50 50', s('path', { d: 'M0 -11v12M0 8v.1', fill: 'none', stroke: '#fff', 'stroke-width': 4.2, 'stroke-linecap': 'round' }));
  return h('div', 'o-wisp-core', orb, flowA, flowB, shine, mark);
}

function buildTail(id) {
  return svg('o-wisp-tail', '-50 -50 100 100',
    s('defs', null, s('linearGradient', { id: `${id}t`, x1: 0.6, y1: 0, x2: 0.2, y2: 1 }, ...stops([[0, '#4FD8C8', 0.95], [0.55, '#3CBF9A', 0.6], [1, '#A8FFF2', 0]]))),
    s('path', { d: 'M-10 12C-17 34 -3 50 -27 71C-8 67 9 52 11 30C12 22 10 16 10 12Z', fill: `url(#${id}t)` }),
    s('path', { d: 'M1 18C2 36 -6 52 -21 66', fill: 'none', stroke: '#EFFFFB', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: 0.6 }));
}

function buildFx(role) {
  const box = '-75 -75 150 150';
  const star = (deg, r, k, cls) => { const [x, y] = polar(r, deg); return s('path', { class: cls, d: GLYPH.research[0], transform: `translate(${x - 12 * k} ${y - 12 * k}) scale(${k})` }); };
  let parts;
  if (role === 'research') {
    parts = [svg('o-fx-spin', box, s('circle', { r: 58, fill: 'none', stroke: '#4FD7FF', 'stroke-width': 1.2, 'stroke-dasharray': '2 7' }), s('circle', { r: 62.5, fill: 'none', stroke: '#4FD7FF', 'stroke-width': 0.6, opacity: 0.6 })),
      svg('o-fx-stars', box, star(-52, 66, 0.62, 't1'), star(34, 68, 0.42, 't2'), star(148, 66, 0.52, 't3'),
        s('path', { d: `M${polar(66, -52)}L${polar(60, -8)}L${polar(68, 34)}`, fill: 'none', stroke: '#4FD7FF', 'stroke-width': 0.6, opacity: 0.55 }))];
  } else if (role === 'planning') {
    const [a, b, c] = [polar(64, 200), polar(54, 255), polar(66, 310)];
    parts = [svg('o-fx-spin', box, s('path', { d: ngon(63, 3), fill: 'none', stroke: '#F4D96B', 'stroke-width': 1.2, 'stroke-linejoin': 'round' })),
      svg('o-fx-spin rev', box, s('path', { d: ngon(57, 6, 30), fill: 'none', stroke: '#D4AF37', 'stroke-width': 1, 'stroke-dasharray': '9 4' })),
      svg('o-fx-route', box, s('path', { d: `M${a}L${b}L${c}`, fill: 'none', stroke: '#F4D96B', 'stroke-width': 1, 'stroke-dasharray': '1.5 3' }),
        ...[a, b, c].map(([x, y]) => s('circle', { cx: x, cy: y, r: 2.2, fill: '#F4D96B', stroke: '#83621A', 'stroke-width': 0.6 })))];
  } else if (role === 'memory') {
    const rune = (deg, d, cls) => { const [x, y] = polar(64, deg); return s('path', { class: cls, d, transform: `translate(${x - 5} ${y - 5})`, fill: 'none', 'stroke-width': 1.4, 'stroke-linecap': 'round' }); };
    parts = [svg('o-fx-threads', box, s('path', { d: 'M-20 -14C-44 -30 -52 -52 -40 -66M22 12C44 26 58 44 52 64M-18 18C-40 30 -60 28 -68 14', fill: 'none', stroke: '#A8FFF2', 'stroke-width': 0.8, 'stroke-dasharray': '1 3.4', 'stroke-linecap': 'round' })),
      svg('o-fx-runes', box, rune(-34, 'M1 1h8M5 1v8M1 9h8', 't1'), rune(52, 'M1 1v8h8M5 5h4', 't2'), rune(140, 'M1 5h8M1 1l4 4-4 4', 't3'), rune(236, 'M1 1h8v8H1ZM1 5h4', 't2'))];
  } else {
    const streak = (x, y, len, cls) => s('path', { class: cls, d: `M${x} ${y}l${-len} ${len}m0 0h5.5m-5.5 0v-5.5`, fill: 'none', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    parts = [svg('o-fx-streams', box, streak(-38, 36, 20, 't1'), streak(-22, 50, 15, 't2'), streak(-52, 20, 15, 't3'))];
  }
  const el = h('div', 'o-wisp-fx', ...parts);
  el.dataset.role = role;
  return el;
}

function buildDragon(id) {
  const pt = (deg, off = 0) => { const a = deg * Math.PI / 180; const r = 100 + off + 9 * Math.sin(a * 6); return `${(150 + r * Math.cos(a)).toFixed(1)} ${(150 + r * Math.sin(a)).toFixed(1)}`; };
  const arc = (from, to, off) => { let d = ''; for (let a = from; a <= to; a += 4) d += (d ? 'L' : 'M') + pt(a, off); return d; };
  const body = (to, w, o) => s('path', { d: arc(24, to), fill: 'none', stroke: `url(#${id}d)`, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: o });
  const [hx, hy] = pt(24).split(' ').map(Number);
  const head = s('g', { transform: `translate(${hx} ${hy}) rotate(-64) scale(1.35)` },
    s('path', { d: 'M-6 -10C-14 -20 -24 -22 -32 -18M-8 9C-15 17 -25 19 -33 15', fill: 'none', stroke: `url(#${id}d)`, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    s('path', { d: 'M-10 -9C0 -16 14 -11 26 -2C14 6 0 11 -10 9C-15 3 -15 -3 -10 -9Z', fill: `url(#${id}d)` }),
    s('path', { d: 'M22 -5C31 -16 15 -25 2 -22M22 2C31 13 15 22 2 19', fill: 'none', stroke: '#A8FFF2', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
    s('circle', { cx: 10, cy: -4, r: 1.9, fill: '#0F0F12' }));
  return h('div', 'o-wisp-dragon', svg('o-wisp-dragon-art', '0 0 300 300',
    s('defs', null, s('linearGradient', { id: `${id}d`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops([[0, '#A8FFF2'], [0.5, '#4FD8C8'], [1, '#3CBF9A']]))),
    body(318, 4.5, 0.75), body(240, 9, 0.85), body(156, 14, 0.95),
    s('path', { d: arc(34, 300, 9), fill: 'none', stroke: '#A8FFF2', 'stroke-width': 3, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round', opacity: 0.8 }),
    s('path', { d: arc(30, 230, 0), fill: 'none', stroke: '#EFFFFB', 'stroke-width': 1.2, 'stroke-dasharray': '1 6', opacity: 0.8 }),
    head));
}

/**
 * The Jade Wisp. Decorative: `el` is aria-hidden; pair it with createCouncil() for screen readers.
 * @param {{ size?: number, title?: string }} [opts]
 * @returns {{ el: HTMLElement, setState(state: 'idle'|'thinking'|'speaking'|'error'): void,
 *   setRoles(active: Set<string>|string[]): void, manifest(): boolean, destroy(): void }}
 */
export function createWisp({ size = 75, title } = {}) {
  const id = `ow${++uid}`;
  const el = h('div', 'o-wisp');
  el.setAttribute('aria-hidden', 'true');
  if (title) el.title = title;
  el.style.setProperty('--wisp-size', `${size}px`);
  el.dataset.state = 'idle';

  const frags = h('div', 'o-wisp-frags', ...ROLES.map((r) => { const f = h('i', 'o-wisp-frag', glyph(r)); f.dataset.role = r; return f; }));
  const body = h('div', 'o-wisp-body', buildTail(id), h('i', 'o-wisp-glow'), ...buildRings(id), buildCore(id), ...ROLES.map(buildFx), frags);
  el.append(h('div', 'o-wisp-float', body));

  let state = 'idle', hover = false, dragon = null, timer = 0, dead = false;
  let active = new Set(), seen = new Set();
  const RATE = { idle: 1, thinking: 2.6, speaking: 0.7, error: 0.12 };

  // Ring speed changes go through playbackRate so they ease instead of jumping.
  const applyRate = () => {
    if (dead || !el.isConnected || typeof el.getAnimations !== 'function') return;
    const rate = (RATE[state] || 1) * (hover ? 1.9 : 1);
    for (const a of el.getAnimations({ subtree: true })) {
      if (a.animationName === 'o-spin' && a.effect?.target?.classList.contains('o-wisp-ring')) a.updatePlaybackRate(rate);
    }
  };
  const queueRate = () => requestAnimationFrame(applyRate);
  const onEnter = () => { hover = true; el.classList.add('is-hover'); queueRate(); };
  const onLeave = () => { hover = false; el.classList.remove('is-hover'); queueRate(); };
  body.addEventListener('pointerenter', onEnter);
  body.addEventListener('pointerleave', onLeave);
  el.addEventListener('animationstart', queueRate);

  const paint = () => {
    const council = seen.size >= 2;
    el.classList.toggle('is-council', council);
    for (const r of ROLES) {
      el.classList.toggle(`has-${r}`, active.has(r));
      frags.children[ROLES.indexOf(r)].classList.toggle('is-lit', active.has(r));
    }
    el.dataset.roles = [...active].join(' ');
  };

  track(el);
  if (typeof document !== 'undefined' && document.hidden) el.classList.add('is-paused');

  return {
    el,
    setState(next) {
      if (!(next in RATE) || dead) return;
      // A new run starts when thinking begins from rest: forget the roles of the previous answer.
      if (next === 'thinking' && (state === 'idle' || state === 'error')) seen = new Set(active);
      state = next;
      el.dataset.state = next;
      paint();
      queueRate();
    },
    setRoles(next) {
      if (dead) return;
      active = new Set([...(next || [])].filter((r) => ROLES.includes(r)));
      for (const r of active) seen.add(r);
      paint();
    },
    manifest() {
      const now = Date.now();
      if (dead || !el.isConnected || reduced() || document.hidden || now - lastManifest < MANIFEST_GAP) return false;
      lastManifest = now;
      if (!dragon) { dragon = buildDragon(id); el.append(dragon); }
      el.classList.remove('is-manifest');
      void el.offsetWidth; // restart the keyframes
      el.classList.add('is-manifest');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('is-manifest'), MANIFEST_MS + 80);
      return true;
    },
    destroy() {
      dead = true;
      clearTimeout(timer);
      body.removeEventListener('pointerenter', onEnter);
      body.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('animationstart', queueRate);
      el.remove();
    },
  };
}

/** Preview and tests only: lets manifest() play again without waiting 15 minutes. */
export function resetManifestLimit() { lastManifest = -Infinity; }

/* ------------------------------------------------------------------ Council of Minds */
/**
 * The "Wisdom Council Convening" strip. A seal appears the first time its role becomes active and stays
 * (as "done") until reset(). Role changes are announced politely through a visually hidden live region.
 * @returns {{ el: HTMLElement, update(states: Record<string, 'idle'|'active'|'done'>, status?: { running: boolean, waiting: boolean }): void, reset(): void }}
 */
export function createCouncil() {
  const title = h('span', 'o-council-title', 'Wisdom Council Convening');
  const count = h('span', 'o-council-count');
  const list = h('ol', 'o-council-list');
  const sr = h('span', 'o-sr');
  sr.setAttribute('aria-live', 'polite');
  sr.setAttribute('role', 'status');
  const el = h('section', 'o-council', h('div', 'o-council-head', h('span', 'o-council-kicker', 'Active agents'), title, count), list, sr);
  el.setAttribute('aria-label', 'Council of Minds');
  el.hidden = true;
  el.dataset.phase = 'idle';

  const seals = {};
  const now = {};
  for (const r of ROLES) {
    const st = h('span', 'o-seal-state');
    const li = h('li', 'o-seal', h('span', 'o-seal-mark', glyph(r)), h('span', 'o-seal-label', ROLE_LABELS[r]), st);
    li.dataset.role = r;
    li.dataset.state = 'idle';
    li.hidden = true;
    seals[r] = { li, st };
    now[r] = 'idle';
    list.append(li);
  }
  track(el);

  // `run`: { running, waiting } from the caller. While a run is still going (or waiting for the user's
  // permission) the council never claims to be done, even between steps.
  let run = { running: false, waiting: false };
  const render = (said) => {
    const shown = ROLES.filter((r) => !seals[r].li.hidden);
    const working = shown.filter((r) => now[r] === 'active');
    const going = working.length > 0 || run.running;
    el.hidden = !shown.length;
    el.dataset.phase = going ? 'convening' : shown.length ? 'rested' : 'idle';
    title.textContent = going || !shown.length ? 'Wisdom Council Convening' : 'The council has spoken';
    count.textContent = working.length ? `${working.length} working` : run.waiting ? 'Waiting for you' : run.running ? 'Between steps' : shown.length ? 'All done' : '';
    if (said.length) sr.textContent = said.join('. ') + '.';
  };

  return {
    el,
    update(states = {}, status) {
      if (status && typeof status === 'object') run = { running: !!status.running, waiting: !!status.waiting };
      const said = [];
      let order = 0;
      for (const r of ROLES) {
        const next = states[r];
        if (!next || next === now[r] || !['idle', 'active', 'done'].includes(next)) continue;
        const { li, st } = seals[r];
        // An idle role that never worked stays out of sight: the strip shows only real activity.
        if (next !== 'idle' && li.hidden) { li.hidden = false; li.style.setProperty('--i', order++); list.append(li); }
        now[r] = next;
        li.dataset.state = next;
        st.textContent = next === 'active' ? 'Working' : next === 'done' ? 'Done' : 'Waiting';
        if (next === 'active') said.push(ROLE_LABELS[r]);
        else if (next === 'done') said.push(`${ROLE_SHORT[r]} finished`);
      }
      render(said);
    },
    reset() {
      for (const r of ROLES) { now[r] = 'idle'; seals[r].li.hidden = true; seals[r].li.dataset.state = 'idle'; seals[r].st.textContent = ''; }
      sr.textContent = '';
      run = { running: false, waiting: false };
      render([]);
    },
  };
}
