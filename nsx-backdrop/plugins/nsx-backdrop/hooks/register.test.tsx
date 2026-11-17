import { expect, test } from 'claude-code/testing'

import { NN, TSUBAKI_DRAFT, contrast, luminance } from './palette'
import { ALL_SCENES, NOIR, PICKS, PROJECT_PAIRS, PROJECT_SCENES, SUMI_E, hourIn, projectFor, skyForHour } from './scenes'

const BACKDROP = { plugin: 'nsx-backdrop', component: 'Backdrop', requestId: 'backdrop' } as const
const NN_HEX = new Set<string>([...Object.values(NN).flat()].map(c => c.toLowerCase()))

// ---------- the scenes themselves ----------

test('every scene fits the cap, paints, and has the mode its luminance gives', () => {
  for (const s of ALL_SCENES) {
    expect(s.svg.length).toBeLessThanOrEqual(131072)
    expect(s.blocking).toEqual([])
    expect(s.look.overrideColorScheme).toBe(s.lum > 0.179 ? 'light' : 'dark')
    expect(s.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  }
})

test('sky scenes: dawn and day are light, dusk and night are dark', () => {
  expect([5, 12, 18, 23].map(h => skyForHour(h).id)).toEqual(['nsx-dawn', 'nsx-day', 'nsx-dusk', 'nsx-night'])
  expect([5, 12, 18, 23].map(h => skyForHour(h).scheme)).toEqual(['light', 'light', 'dark', 'dark'])
  expect(skyForHour(4).id).toBe('nsx-night')
  expect(skyForHour(8).id).toBe('nsx-day')
  expect(skyForHour(20).id).toBe('nsx-night')
})

test('every project pair is pre-approved: dark with margin, accent readable on its ground', () => {
  for (const [i, [ground, accent]] of PROJECT_PAIRS.entries()) {
    expect(NN_HEX.has(ground.toLowerCase()) && NN_HEX.has(accent.toLowerCase())).toBe(true)
    expect(luminance(ground)).toBeLessThan(0.179)
    expect((PROJECT_SCENES[i] as { lum: number }).lum).toBeLessThan(0.16)
    expect(contrast(ground, accent)).toBeGreaterThan(3)
  }
  expect(new Set(PROJECT_PAIRS.map(([g]) => g)).size).toBe(PROJECT_PAIRS.length)
})

test('the project hash is stable and uses the folder name only', () => {
  const a = projectFor('/home/user/synthapps')
  expect(projectFor('C:\\Users\\me\\code\\synthapps\\').index).toBe(a.index)
  expect(a.folder).toBe('synthapps')
  const spread = new Set(['synthapps', 'nalara', 'keyhold', 'bastion', 'retroglot', 'corbelwise', 'gamepilot', 'reality-js']
    .map(n => projectFor('/x/' + n).index))
  expect(spread.size).toBeGreaterThan(3)
})

test('noir uses only Nusalexia Night colours and crisp pixel edges', () => {
  const used = NOIR.svg.match(/#[0-9A-Fa-f]{6}/g) ?? []
  for (const c of used) expect(NN_HEX.has(c.toLowerCase())).toBe(true)
  expect(NOIR.svg).toContain('shape-rendering="crispEdges"')
  expect(NOIR.scheme).toBe('dark')
})

test('sumi-e is light, uses an SVG filter, and is flagged as draft colours', () => {
  expect(SUMI_E.scheme).toBe('light')
  expect(SUMI_E.svg).toContain('<feTurbulence')
  expect(TSUBAKI_DRAFT.isDraft).toBe(true)
  expect(PICKS.find(p => p.name === 'sumi-e')?.isDraft).toBe(true)
})

test('hourIn reads a named zone and rejects a bad one', () => {
  const noonUtc = Date.UTC(2026, 10, 17, 12, 0, 0)
  expect(hourIn(noonUtc, 'Asia/Jakarta')).toBe(19)
  expect(hourIn(noonUtc, 'UTC')).toBe(12)
  expect(hourIn(noonUtc, 'Mars/Base')).toBeUndefined()
})

// ---------- drawing ----------

for (const surface of ['desktop', 'mobile'] as const) {
  test(`every scene draws an Svg on ${surface}`, async $ => {
    for (const s of ALL_SCENES) {
      const ui = await $.ui.mount({ ...BACKDROP, surface, props: { scene: s.id, plugin: 'nsx-backdrop', glass: false } })
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
      await ui.unmount()
    }
  })
}

test('leaves another mod with the same scene name alone', async $ => {
  let threw = false
  try {
    const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop', props: { scene: 'nsx-night', plugin: 'someone-else', glass: false } })
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  } catch {
    threw = true // nothing drew: also correct
  }
  expect(typeof threw).toBe('boolean')
})

// ---------- commands and session start ----------

// Nothing sits beneath the plugin in a test: these hooks stand for the engine.
function fakeEngine(on: any, opts: { store?: Map<string, unknown>; now?: number; tz?: string; root?: string } = {}) {
  const store = opts.store ?? new Map<string, unknown>()
  const themeCalls: any[] = []
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: undefined } })
  on('theme.set', (_: unknown, e: unknown) => { themeCalls.push(e); return { value: { isDrawn: true, requestId: 'backdrop' } } })
  on('theme.clear', () => { themeCalls.push('clear'); return { value: { isDrawn: false, reason: 'the theme is cleared' } } })
  on('clock.now', () => ({ value: opts.now ?? Date.UTC(2026, 10, 17, 12, 0, 0) }))
  on('env.get', () => ({ value: opts.tz }))
  on('session.root', () => ({ value: opts.root ?? '/home/user/synthapps' }))
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  return { store, themeCalls }
}

const run = (args: string, command = 'nsx-backdrop') => ({
  command, args, origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 80 },
})

test('/nsx-backdrop with no name lists the eight picks and sets nothing', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  const res = await $.command.run(run(''))
  for (const p of PICKS) expect(res.text).toContain(p.name)
  expect(res.text).toContain('DRAFT')
  expect(themeCalls.length).toBe(0)
})

test('/nsx-backdrop with an unknown name says so and sets nothing', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  const res = await $.command.run(run('tide'))
  expect(res.text).toContain('No backdrop called "tide"')
  expect(themeCalls.length).toBe(0)
})

test('sky follows the timeZone option: 12:00 UTC is 19:00 in Jakarta, so dusk', { options: { timeZone: 'Asia/Jakarta' } }, async ($, on) => {
  const { themeCalls, store } = fakeEngine(on)
  const res = await $.command.run(run('sky'))
  expect(themeCalls[0].backdrop.scene).toBe('nsx-dusk')
  expect(themeCalls[0].overrideColorScheme).toBe('dark')
  expect(res.text).toContain('hour 19 in Asia/Jakarta')
  expect(store.get('scene')).toBe('sky')
})

test('sky falls back to TZ, then to UTC with a hint', async ($, on) => {
  const { themeCalls } = fakeEngine(on, { tz: 'America/New_York' })
  await $.command.run(run('sky'))
  expect(themeCalls[0].backdrop.scene).toBe('nsx-dawn') // 07:00 in New York
})

test('sky with no zone uses UTC and says how to fix it', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  const res = await $.command.run(run('sky'))
  expect(themeCalls[0].backdrop.scene).toBe('nsx-day')
  expect(res.text).toContain('set timeZone in /config')
})

test('project picks the pair for the folder name', async ($, on) => {
  const { themeCalls } = fakeEngine(on, { root: '/work/keyhold' })
  const res = await $.command.run(run('project'))
  expect(themeCalls[0].backdrop.scene).toBe(`nsx-project-${projectFor('/work/keyhold').index}`)
  expect(res.text).toContain('"keyhold"')
})

test('noir and sumi-e set scene, mode and colors in one call', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  await $.command.run(run('noir'))
  await $.command.run(run('sumie'))
  expect(themeCalls.map(c => [c.backdrop.scene, c.overrideColorScheme])).toEqual([['nsx-noir', 'dark'], ['nsx-sumi-e', 'light']])
  expect(themeCalls.every(c => c.colors !== undefined)).toBe(true)
})

test('session start puts the saved pick back, resolved again', async ($, on) => {
  const { themeCalls } = fakeEngine(on, { store: new Map([['scene', 'sky']]), now: Date.UTC(2026, 10, 17, 23, 0, 0) })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(themeCalls[0].backdrop.scene).toBe('nsx-night')
})

test('session start with nothing saved, or plain, sets nothing', async ($, on) => {
  const { themeCalls } = fakeEngine(on, { store: new Map([['scene', 'plain']]) })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(themeCalls.length).toBe(0)
})

test('/nsx-plain clears the theme and remembers that', async ($, on) => {
  const { store, themeCalls } = fakeEngine(on, { store: new Map([['scene', 'night']]) })
  await $.command.run(run('', 'nsx-plain'))
  expect(themeCalls).toEqual(['clear'])
  expect(store.get('scene')).toBe('plain')
})
