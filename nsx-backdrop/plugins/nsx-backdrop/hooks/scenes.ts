// The four scenes the picker offers. Each one is a backdrop drawing plus the
// Code tab colors that go with it, because $.theme.set replaces both at once.
import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

export type SceneName = 'night' | 'tide' | 'dawn' | 'paper'

export type Scene = {
  /** The name typed after /nsx-backdrop. Letters, digits, _ and - only. */
  name: SceneName
  /** One line for the list. */
  blurb: string
  /** Alt text for the drawing. */
  alt: string
  /** The colour that covers most of the drawing; decides light or dark. */
  dominant: string
  /** The SVG source, at most 131,072 characters. */
  svg: string
  /** The full $.theme.set argument for this scene. */
  look: ThemeSetArgs
  /** Contrast notes from makeColors that would stop Desktop painting the colors. */
  blocking: string[]
}

// WCAG 2.x relative luminance of a six-digit hex colour, 0..1.
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

// 0.179 is where black text and white text have equal contrast.
export function schemeFor(hex: string): 'light' | 'dark' {
  return luminance(hex) > 0.179 ? 'light' : 'dark'
}

const SVG_HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">'

// Same stars every time: a small seeded generator instead of Math.random.
function stars(): string {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: string[] = []
  for (let i = 0; i < 140; i++) {
    const x = Math.round(rnd() * 1600)
    const y = Math.round(rnd() * 760)
    const r = (0.6 + rnd() * 1.4).toFixed(1)
    const o = (0.35 + rnd() * 0.6).toFixed(2)
    out.push(`<circle class="s${i % 3}" cx="${x}" cy="${y}" r="${r}" fill="#e8eeff" opacity="${o}"/>`)
  }
  return out.join('')
}

const NIGHT_SVG = `${SVG_HEAD}
<style>
.s0{animation:tw 7s ease-in-out infinite}
.s1{animation:tw 11s ease-in-out infinite 2s}
.s2{animation:tw 15s ease-in-out infinite 5s}
@keyframes tw{0%,100%{opacity:.9}50%{opacity:.3}}
</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#05070f"/><stop offset=".65" stop-color="#0b1020"/><stop offset="1" stop-color="#16203a"/>
</linearGradient>
<radialGradient id="moonglow" cx=".5" cy=".5" r=".5">
<stop offset="0" stop-color="#f4f1e6" stop-opacity=".35"/><stop offset="1" stop-color="#f4f1e6" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
${stars()}
<svg x="0" y="0" width="1600" height="1000" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMin meet">
<circle cx="340" cy="55" r="48" fill="url(#moonglow)"/>
<circle cx="340" cy="55" r="16" fill="#f4f1e6" opacity=".9"/>
<circle cx="347" cy="50" r="15" fill="#0b1020" opacity=".85"/>
</svg>
<path d="M0 930 L180 880 L360 915 L560 860 L760 905 L980 850 L1200 900 L1400 870 L1600 910 L1600 1000 L0 1000 Z" fill="#04060c"/>
</svg>`

const TIDE_SVG = `${SVG_HEAD}
<style>
.w{animation:drift 40s linear infinite}
.w2{animation-duration:55s;animation-direction:reverse}
.w3{animation-duration:70s}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(-1600px)}}
</style>
<defs>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0a2a33"/><stop offset=".55" stop-color="#071c22"/><stop offset="1" stop-color="#03100f"/>
</linearGradient>
</defs>
<rect width="1600" height="1000" fill="url(#sea)"/>
<g opacity=".18" fill="#3fa7b3">
<path class="w w3" d="M0 820 Q200 790 400 820 T800 820 T1200 820 T1600 820 T2000 820 T2400 820 T2800 820 T3200 820 L3200 1000 L0 1000 Z"/>
</g>
<g opacity=".22" fill="#2b8c99">
<path class="w w2" d="M0 870 Q200 845 400 870 T800 870 T1200 870 T1600 870 T2000 870 T2400 870 T2800 870 T3200 870 L3200 1000 L0 1000 Z"/>
</g>
<g opacity=".3" fill="#1d6f7a">
<path class="w" d="M0 920 Q200 900 400 920 T800 920 T1200 920 T1600 920 T2000 920 T2400 920 T2800 920 T3200 920 L3200 1000 L0 1000 Z"/>
</g>
</svg>`

const DAWN_SVG = `${SVG_HEAD}
<style>
.c{animation:float 90s linear infinite}
.c2{animation-duration:120s}
@keyframes float{from{transform:translateX(0)}to{transform:translateX(220px)}}
</style>
<defs>
<linearGradient id="dawnsky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#e9eef6"/><stop offset=".55" stop-color="#f3e3d6"/><stop offset="1" stop-color="#f6d2b8"/>
</linearGradient>
<radialGradient id="sun" cx=".5" cy=".5" r=".5">
<stop offset="0" stop-color="#ffd7a8" stop-opacity=".9"/><stop offset=".4" stop-color="#ffc58f" stop-opacity=".35"/><stop offset="1" stop-color="#ffc58f" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="1600" height="1000" fill="url(#dawnsky)"/>
<svg x="0" y="0" width="1600" height="1000" viewBox="0 0 400 300" preserveAspectRatio="xMinYMax meet">
<circle cx="60" cy="250" r="110" fill="url(#sun)"/>
</svg>
<g fill="#ffffff" opacity=".55">
<ellipse class="c" cx="300" cy="160" rx="160" ry="22"/>
<ellipse class="c c2" cx="1150" cy="110" rx="200" ry="26"/>
<ellipse class="c" cx="1350" cy="240" rx="130" ry="18"/>
</g>
</svg>`

function rules(): string {
  const out: string[] = []
  for (let y = 120; y < 1000; y += 40) out.push(`<line x1="0" y1="${y}" x2="1600" y2="${y}"/>`)
  return out.join('')
}

const PAPER_SVG = `${SVG_HEAD}
<defs>
<radialGradient id="vignette" cx=".5" cy=".45" r=".75">
<stop offset=".6" stop-color="#efe6d3" stop-opacity="0"/><stop offset="1" stop-color="#d9ccb2" stop-opacity=".6"/>
</radialGradient>
</defs>
<rect width="1600" height="1000" fill="#efe6d3"/>
<g stroke="#9db4c8" stroke-width="1" opacity=".35">${rules()}</g>
<line x1="120" y1="0" x2="120" y2="1000" stroke="#c98a86" stroke-width="1.5" opacity=".45"/>
<rect width="1600" height="1000" fill="url(#vignette)"/>
</svg>`

type Def = Omit<Scene, 'look' | 'blocking'> & { palette: Parameters<typeof makeColors>[0] }

const DEFS: Def[] = [
  {
    name: 'night',
    blurb: 'Night sky: slow-twinkling stars, a crescent moon, dark.',
    alt: 'A dark night sky with faint twinkling stars and a crescent moon',
    dominant: '#0b1020',
    svg: NIGHT_SVG,
    palette: {
      label: 'nsx night', only: 'dark',
      roles: { accent: '#7aa2f7', danger: '#e0787a', success: '#8cc68a', warning: '#d9a65b', pro: '#b18cf0' },
      dark: { gray: { anchors: { 'surface-0': '#0b1020', 'surface-1': '#121a2e', 'surface-2': '#18223a', 'surface-3': '#1a2440',
        'text-primary': '#e6ebf5', 'text-secondary': '#b9c3d8', 'text-muted': '#8f9bb5' } } },
    },
  },
  {
    name: 'tide',
    blurb: 'Tide: deep teal water with slow waves along the bottom, dark.',
    alt: 'Deep teal water with slow waves drifting along the bottom',
    dominant: '#071c22',
    svg: TIDE_SVG,
    palette: {
      label: 'nsx tide', only: 'dark',
      roles: { accent: '#4fb8c4', danger: '#e07d6e', success: '#7cc49a', warning: '#d8ab5e', pro: '#9f97e0' },
      dark: { gray: { anchors: { 'surface-0': '#071c22', 'surface-1': '#0c262d', 'surface-2': '#0e2b32', 'surface-3': '#112f37',
        'text-primary': '#e2f1f2', 'text-secondary': '#b4ccce', 'text-muted': '#87a3a6' } } },
    },
  },
  {
    name: 'dawn',
    blurb: 'Dawn: pale sky warming to peach, low sun, drifting clouds, light.',
    alt: 'A pale dawn sky warming to peach, with a low sun and thin drifting clouds',
    dominant: '#f3e3d6',
    svg: DAWN_SVG,
    palette: {
      label: 'nsx dawn', only: 'light',
      roles: { accent: '#b4532a', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#7a4f94' },
      light: { gray: { anchors: { 'surface-0': '#f3e3d6', 'surface-1': '#f7ebe1', 'surface-2': '#fbf3ec', 'surface-3': '#fbf3ec',
        'text-primary': '#2b1f1a', 'text-secondary': '#55433a', 'text-muted': '#6c5a50' } } },
    },
  },
  {
    name: 'paper',
    blurb: 'Paper: warm ruled notebook page with a margin line, still, light.',
    alt: 'A warm notebook page with faint ruled lines and a red margin line',
    dominant: '#efe6d3',
    svg: PAPER_SVG,
    palette: {
      label: 'nsx paper', only: 'light',
      roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#6d4f94' },
      light: { gray: { anchors: { 'surface-0': '#efe6d3', 'surface-1': '#f4ecdc', 'surface-2': '#faf5e9', 'surface-3': '#faf5e9',
        'text-primary': '#2a241d', 'text-secondary': '#544a3d', 'text-muted': '#6a5f50' } } },
    },
  },
]

export const SCENES: readonly Scene[] = DEFS.map(({ palette, ...d }) => {
  const { theme, problems } = makeColors(palette)
  return {
    ...d,
    look: {
      backdrop: { scene: `nsx-${d.name}` },
      overrideColorScheme: schemeFor(d.dominant),
      colors: theme,
    },
    blocking: problems.filter(line => line.startsWith("Desktop won't paint")),
  }
})

/** The backdrop scene id sent to $.theme.set, e.g. nsx-night. */
export const sceneId = (s: Scene): string => `nsx-${s.name}`

export function findScene(input: string): Scene | undefined {
  const want = input.trim().toLowerCase().replace(/^nsx-/, '')
  return SCENES.find(s => s.name === want)
}

export function bySceneId(id: string): Scene | undefined {
  return SCENES.find(s => sceneId(s) === id)
}
