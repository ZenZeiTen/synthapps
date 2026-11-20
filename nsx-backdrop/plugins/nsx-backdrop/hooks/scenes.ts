// Every scene the picker can draw. A scene is an SVG backdrop plus the Code tab
// colors that go with it, because $.theme.set replaces both at once.
import type { ThemeColors, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { NN, TSUBAKI_DRAFT, meanLuminance, schemeOf } from './palette'

export type Drawn = {
  /** The backdrop scene id: nsx-<name>. Letters, digits, _ and - only, at most 64. */
  id: string
  alt: string
  svg: string
  /** Area-weighted luminance of the drawing, and the mode it implies. */
  lum: number
  scheme: 'light' | 'dark'
  look: ThemeSetArgs
  /** makeColors lines that would stop Desktop painting the colors (should be empty). */
  blocking: string[]
}

const HEAD = (vb = '0 0 1600 1000', par = 'xMidYMid slice'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="${par}">`

// Same output every time: a small seeded generator instead of Math.random.
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

// ---------- Code tab colors, from the palettes ----------

type Roles = { accent: string }
const ROLES = { danger: NN.fire[1], success: NN.teal[2], warning: NN.amber[2], pro: NN.wine[1] }

function darkColors(label: string, { accent }: Roles): { theme: ThemeColors; problems: string[] } {
  return makeColors({
    label, only: 'dark',
    roles: { ...ROLES, accent },
    dark: { gray: { anchors: {
      'surface-0': NN.night[0], 'surface-1': NN.night[1], 'surface-2': NN.night[2], 'surface-3': NN.night[2],
      'text-primary': NN.amber[4], 'text-secondary': NN.fog[3], 'text-muted': NN.fog[2],
    } } },
  })
}

function lightColors(label: string, { accent }: Roles): { theme: ThemeColors; problems: string[] } {
  return makeColors({
    label, only: 'light',
    roles: { ...ROLES, warning: NN.amber[1], accent },
    light: { gray: { anchors: {
      'surface-0': NN.fog[3],
      'text-primary': NN.night[0], 'text-secondary': NN.night[3], 'text-muted': NN.night[4],
    } } },
  })
}

function finish(id: string, alt: string, svg: string, parts: Array<readonly [string, number]>,
  colors: { theme: ThemeColors; problems: string[] }): Drawn {
  if (svg.length > 131072) throw new Error(`${id}: SVG is ${svg.length} characters, over 131072`)
  const lum = meanLuminance(parts)
  const scheme = schemeOf(lum)
  return {
    id, alt, svg, lum, scheme,
    look: { backdrop: { scene: id }, overrideColorScheme: scheme, colors: colors.theme },
    blocking: colors.problems.filter(l => l.startsWith("Desktop won't paint")),
  }
}

// ---------- 1. A sky that follows the clock ----------

function stars(n: number, maxY: number, seed: number): string {
  const r = seeded(seed)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const x = Math.round(r() * 1600), y = Math.round(r() * maxY)
    const rad = (0.6 + r() * 1.4).toFixed(1), o = (0.35 + r() * 0.6).toFixed(2)
    const fill = i % 4 === 0 ? NN.amber[4] : NN.fog[3]
    out.push(`<circle class="s${i % 3}" cx="${x}" cy="${y}" r="${rad}" fill="${fill}" opacity="${o}"/>`)
  }
  return out.join('')
}

const TWINKLE = `.s0{animation:tw 7s ease-in-out infinite}.s1{animation:tw 11s ease-in-out infinite 2s}
.s2{animation:tw 15s ease-in-out infinite 5s}@keyframes tw{0%,100%{opacity:.9}50%{opacity:.3}}`
const DRIFT = `.c{animation:fl 90s ease-in-out infinite alternate}.c2{animation-duration:130s}
@keyframes fl{from{transform:translateX(-120px)}to{transform:translateX(120px)}}`
const HILLS = `M0 930 L180 880 L360 915 L560 860 L760 905 L980 850 L1200 900 L1400 870 L1600 910 L1600 1000 L0 1000 Z`

const sky = (stops: Array<[number, string]>): string =>
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`

export const NIGHT = finish('nsx-night', 'A dark night sky with faint twinkling stars, a crescent moon and low hills',
  `${HEAD()}<style>${TWINKLE}</style><defs>${sky([[0, NN.night[0]], [0.65, NN.night[1]], [1, NN.night[2]]])}
<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${NN.amber[4]}" stop-opacity=".3"/><stop offset="1" stop-color="${NN.amber[4]}" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="1000" fill="url(#sky)"/>${stars(140, 760, 7)}
<svg width="1600" height="1000" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMin meet">
<circle cx="340" cy="55" r="48" fill="url(#glow)"/><circle cx="340" cy="55" r="16" fill="${NN.amber[4]}" opacity=".9"/>
<circle cx="347" cy="50" r="15" fill="${NN.night[0]}" opacity=".9"/></svg>
<path d="${HILLS}" fill="${NN.ink}"/></svg>`,
  [[NN.night[0], 0.4], [NN.night[1], 0.35], [NN.night[2], 0.25]],
  darkColors('nsx night', { accent: NN.fog[2] }))

export const DAWN = finish('nsx-dawn', 'A pale dawn sky warming to amber at the horizon, with a low sun and drifting clouds',
  `${HEAD()}<style>${DRIFT}</style><defs>${sky([[0, NN.fog[2]], [0.45, NN.fog[3]], [0.8, NN.amber[4]], [1, NN.amber[3]]])}
<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${NN.amber[3]}" stop-opacity=".95"/><stop offset=".45" stop-color="${NN.amber[2]}" stop-opacity=".35"/><stop offset="1" stop-color="${NN.amber[2]}" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
<svg width="1600" height="1000" viewBox="0 0 400 300" preserveAspectRatio="xMinYMax meet"><circle cx="60" cy="270" r="110" fill="url(#sun)"/></svg>
<g fill="${NN.amber[4]}" opacity=".6"><ellipse class="c" cx="300" cy="160" rx="170" ry="22"/><ellipse class="c c2" cx="1180" cy="120" rx="210" ry="26"/></g></svg>`,
  [[NN.fog[2], 0.25], [NN.fog[3], 0.4], [NN.amber[4], 0.25], [NN.amber[3], 0.1]],
  lightColors('nsx dawn', { accent: NN.amber[1] }))

export const DAY = finish('nsx-day', 'A clear, pale blue-grey day sky with soft drifting clouds',
  `${HEAD()}<style>${DRIFT}</style><defs>${sky([[0, NN.fog[2]], [0.5, NN.fog[3]], [1, NN.fog[3]]])}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
<g fill="${NN.amber[4]}" opacity=".5"><ellipse class="c" cx="260" cy="140" rx="200" ry="28"/><ellipse class="c c2" cx="1250" cy="90" rx="240" ry="30"/>
<ellipse class="c" cx="1400" cy="230" rx="140" ry="18"/></g></svg>`,
  [[NN.fog[2], 0.25], [NN.fog[3], 0.75]],
  lightColors('nsx day', { accent: NN.night[4] }))

export const DUSK = finish('nsx-dusk', 'A dusk sky fading from deep blue through wine to a thin band of fire at the horizon, with early stars',
  `${HEAD()}<style>${TWINKLE}</style><defs>${sky([[0, NN.night[2]], [0.5, NN.wine[0]], [0.78, NN.wine[1]], [0.9, NN.fire[1]], [1, NN.fire[2]]])}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>${stars(40, 380, 11)}
<path d="${HILLS}" fill="${NN.ink}"/></svg>`,
  [[NN.night[2], 0.5], [NN.wine[0], 0.25], [NN.wine[1], 0.13], [NN.fire[1], 0.08], [NN.fire[2], 0.04]],
  darkColors('nsx dusk', { accent: NN.fire[2] }))

/** dawn 05-07, day 08-16, dusk 17-19, night 20-04, by the local hour 0-23. */
export function skyForHour(hour: number): Drawn {
  if (hour >= 5 && hour < 8) return DAWN
  if (hour >= 8 && hour < 17) return DAY
  if (hour >= 17 && hour < 20) return DUSK
  return NIGHT
}

// ---------- 2. A backdrop per project ----------

/** Fixed pairs (ground, accent), all from Nusalexia Night; checked in the tests. */
export const PROJECT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [NN.night[0], NN.amber[2]],
  [NN.night[2], NN.teal[2]],
  [NN.wine[0], NN.amber[3]],
  [NN.teal[0], NN.teal[3]],
  [NN.amber[0], NN.amber[3]],
  [NN.fire[0], NN.fire[2]],
  [NN.night[3], NN.fog[3]],
  [NN.night[1], NN.fog[1]],
]

const CORNERS = [[0, 0], [1600, 0], [1600, 1000], [0, 1000]] as const

export const PROJECT_SCENES: readonly Drawn[] = PROJECT_PAIRS.map(([ground, accent], i) => {
  const [cx, cy] = CORNERS[i % 4] as readonly [number, number]
  return finish(`nsx-project-${i}`, 'A plain coloured ground with a soft glow in one corner, picked for this project',
    `${HEAD()}<defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="900" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${accent}" stop-opacity=".38"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ground}"/><stop offset="1" stop-color="${NN.ink}" stop-opacity=".55"/></linearGradient></defs>
<rect width="1600" height="1000" fill="${ground}"/><rect width="1600" height="1000" fill="url(#v)"/>
<rect width="1600" height="1000" fill="url(#g)"/><rect x="0" y="994" width="1600" height="6" fill="${accent}" opacity=".7"/></svg>`,
    [[ground, 0.85], [accent, 0.15]],
    darkColors(`nsx project ${i}`, { accent }))
})

/** FNV-1a 32-bit over the folder name, so a folder always gets the same pair. */
export function hashName(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export const folderName = (root: string): string =>
  root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root

export function projectFor(root: string): { scene: Drawn; index: number; folder: string } {
  const folder = folderName(root)
  const index = hashName(folder) % PROJECT_SCENES.length
  return { scene: PROJECT_SCENES[index] as Drawn, index, folder }
}

// ---------- 3. Sumi-e ink wash (Tsubaki) ----------

const T = TSUBAKI_DRAFT
export const SUMI_E = finish('nsx-sumi-e', 'Translucent ink-wash strokes drifting in from the edges of a pale paper ground',
  `${HEAD()}<style>
.w{animation:wash 60s ease-in-out infinite alternate}
.w2{animation-duration:85s}.w3{animation-duration:110s}
@keyframes wash{from{transform:translate(0,0);opacity:1}to{transform:translate(40px,-25px);opacity:.75}}
</style><defs>
<filter id="ink" x="-20%" y="-20%" width="140%" height="140%">
<feTurbulence type="fractalNoise" baseFrequency=".011" numOctaves="3" seed="4" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G"/>
<feGaussianBlur stdDeviation="5"/></filter>
<radialGradient id="clear" cx=".5" cy=".45" r=".62"><stop offset=".45" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></radialGradient>
<mask id="edges"><rect width="1600" height="1000" fill="url(#clear)"/></mask></defs>
<rect width="1600" height="1000" fill="${T.paper}"/>
<g mask="url(#edges)" filter="url(#ink)">
<ellipse class="w" cx="120" cy="140" rx="380" ry="170" fill="${T.washLight}" opacity=".55"/>
<ellipse class="w w2" cx="1480" cy="860" rx="420" ry="190" fill="${T.washLight}" opacity=".5"/>
<ellipse class="w w3" cx="1500" cy="120" rx="300" ry="120" fill="${T.washMid}" opacity=".35"/>
<path class="w w2" d="M-40 900 C200 820 420 980 700 930 L700 1040 L-40 1040 Z" fill="${T.washMid}" opacity=".4"/>
<path class="w" d="M-30 980 C160 900 300 1000 520 960" stroke="${T.ink}" stroke-width="26" fill="none" stroke-linecap="round" opacity=".55"/>
</g>
<g opacity=".8"><circle cx="1505" cy="92" r="11" fill="${T.accent}"/><circle cx="1524" cy="104" r="8" fill="${T.accent}"/><circle cx="1511" cy="114" r="7" fill="${T.accent}"/></g></svg>`,
  [[T.paper, 0.8], [T.washLight, 0.12], [T.washMid, 0.06], [T.ink, 0.02]],
  makeColors({
    label: 'nsx sumi-e (draft)', only: 'light',
    roles: { accent: T.accent, danger: T.accent, success: NN.teal[1], warning: NN.amber[1], pro: NN.wine[1] },
    light: { gray: { anchors: { 'surface-0': T.paper, 'text-primary': T.ink, 'text-secondary': T.textSecondary, 'text-muted': T.textMuted } } },
  }))

// ---------- 4. Pixel-noir skyline (Echoes of the Forgotten) ----------

function skyline(): string {
  // 320 x 200 art pixels; buildings stay under y=154 (the lowest 23%).
  const r = seeded(29)
  const rects: string[] = [], lit: string[] = []
  let x = 0
  while (x < 320) {
    const w = 10 + Math.floor(r() * 18), h = 18 + Math.floor(r() * 28)
    const top = 200 - h
    rects.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}"/>`)
    if (r() > 0.55) rects.push(`<rect x="${x + Math.floor(w / 2)}" y="${top - 4}" width="1" height="4"/>`)
    for (let wy = top + 3; wy < 196; wy += 4) {
      for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        const p = r()
        if (p > 0.93) {
          const c = p > 0.985 ? NN.teal[3] : p > 0.96 ? NN.amber[3] : NN.amber[2]
          lit.push(`<rect class="${p > 0.975 ? 'f' : ''}" x="${wx}" y="${wy}" width="1" height="1" fill="${c}"/>`)
        }
      }
    }
    x += w + (r() > 0.7 ? 1 : 0)
  }
  return `<g fill="${NN.ink}">${rects.join('')}</g>${lit.join('')}`
}

function rain(): string {
  const r = seeded(83)
  const out: string[] = []
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * 320), y = Math.floor(r() * 200)
    out.push(`<rect x="${x}" y="${y}" width="1" height="${3 + Math.floor(r() * 3)}"/><rect x="${x}" y="${y - 200}" width="1" height="3"/>`)
  }
  return out.join('')
}

export const NOIR = finish('nsx-noir', 'A low pixel city skyline at night with a few lit windows and slow rain',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges"><style>
.r{animation:fall 7s linear infinite}
.f{animation:fl 9s steps(1) infinite}
@keyframes fall{from{transform:translateY(0)}to{transform:translateY(200px)}}
@keyframes fl{0%,100%{opacity:1}48%{opacity:1}50%{opacity:.25}54%{opacity:1}}
</style><defs>${sky([[0, NN.night[0]], [0.7, NN.night[1]], [1, NN.night[2]]])}</defs>
<rect width="320" height="200" fill="url(#sky)"/>
<rect x="0" y="140" width="320" height="18" fill="${NN.fog[0]}" opacity=".12"/>
<g class="r" fill="${NN.fog[2]}" opacity=".22">${rain()}</g>
${skyline()}</svg>`,
  [[NN.night[0], 0.45], [NN.night[1], 0.3], [NN.night[2], 0.1], [NN.ink, 0.15]],
  darkColors('nsx noir', { accent: NN.amber[2] }))

export function hourIn(now: number, zone: string): number | undefined {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' })
    return Number(f.format(new Date(now))) % 24
  } catch {
    return undefined
  }
}

// ---------- the picker ----------

export type Pick = {
  name: string
  blurb: string
  isDraft?: boolean
  /** Which scene this pick draws now. */
  resolve: (ctx: { hour: number; zone: string; root: string }) => { scene: Drawn; note: string }
}

export const PICKS: readonly Pick[] = [
  { name: 'sky', blurb: 'Follows the clock: dawn, day, dusk or night by the local hour, chosen at session start',
    resolve: ({ hour, zone }) => { const s = skyForHour(hour); return { scene: s, note: `${s.id.slice(4)} for hour ${hour} in ${zone}${zone === 'UTC' ? '; set timeZone in /config for your local hour' : ''}` } } },
  { name: 'dawn', blurb: 'Pale sky warming to amber, low sun (light)', resolve: () => ({ scene: DAWN, note: '' }) },
  { name: 'day', blurb: 'Clear pale sky, soft clouds (light)', resolve: () => ({ scene: DAY, note: '' }) },
  { name: 'dusk', blurb: 'Deep blue to wine to fire at the horizon (dark)', resolve: () => ({ scene: DUSK, note: '' }) },
  { name: 'night', blurb: 'Seeded star field and crescent moon (dark)', resolve: () => ({ scene: NIGHT, note: '' }) },
  { name: 'project', blurb: 'One of 8 fixed colour pairs, picked by hashing the project folder name (dark)',
    resolve: ({ root }) => { const p = projectFor(root); return { scene: p.scene, note: `pair ${p.index + 1} of ${PROJECT_SCENES.length} for "${p.folder}"` } } },
  { name: 'sumi-e', isDraft: TSUBAKI_DRAFT.isDraft, blurb: 'Tsubaki ink wash drifting in from the edges (light) - DRAFT colours until the Tsubaki palette is added',
    resolve: () => ({ scene: SUMI_E, note: '' }) },
  { name: 'noir', blurb: 'Echoes pixel-noir skyline, lit windows, slow rain (dark)', resolve: () => ({ scene: NOIR, note: '' }) },
]

export function findPick(input: string): Pick | undefined {
  const want = input.trim().toLowerCase().replace(/^nsx-/, '').replace(/^sumie$/, 'sumi-e')
  return PICKS.find(p => p.name === want)
}

export const ALL_SCENES: readonly Drawn[] = [DAWN, DAY, DUSK, NIGHT, ...PROJECT_SCENES, SUMI_E, NOIR]
export const sceneById = (id: string): Drawn | undefined => ALL_SCENES.find(s => s.id === id)
