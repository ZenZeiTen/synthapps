// "Nusalexia Night", the 24-colour palette from the series bible
// NUSALEXIA: ECHOES OF THE FORGOTTEN, section 7.2 (read 17 Nov 2026).
// Every colour in the clock, project and noir scenes comes from here.
export const NN = {
  night: ['#0B0A14', '#141327', '#1E1D3A', '#2A2C52', '#3B4170'],
  fog: ['#4F5A86', '#6D7AA3', '#95A1C2', '#C4CCE0'],
  amber: ['#6B3A12', '#A8591B', '#E08A2C', '#FFC45C', '#FFE9B0'],
  teal: ['#12403F', '#1F6E68', '#3FA59A', '#A8E3DA'],
  fire: ['#7A1E12', '#C2401C', '#F2762A'],
  wine: ['#4A1426', '#8C2440'],
  ink: '#050409',
} as const

// Tsubaki (sumi-e). [Draft/Inferred] PLACEHOLDER: no Tsubaki palette was found
// in the project notes (Notion page and memory notes hold no colours). These are
// neutral paper and ink greys. Replace all of them with the real palette.
export const TSUBAKI_DRAFT = {
  isDraft: true,
  paper: '#F1ECE2',
  washLight: '#B9B4AA',
  washMid: '#7D7970',
  ink: '#2B2A27',
  textSecondary: '#46443F',
  textMuted: '#57544E',
  accent: '#8E3B32',
} as const

// WCAG 2.x relative luminance of a six-digit hex colour, 0..1.
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

/** Area-weighted mean luminance: each colour with the share of the area it covers. */
export function meanLuminance(parts: ReadonlyArray<readonly [string, number]>): number {
  const total = parts.reduce((a, [, w]) => a + w, 0)
  return parts.reduce((a, [hex, w]) => a + luminance(hex) * w, 0) / total
}

// 0.179 is where black text and white text have equal contrast.
export const schemeOf = (lum: number): 'light' | 'dark' => (lum > 0.179 ? 'light' : 'dark')

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
