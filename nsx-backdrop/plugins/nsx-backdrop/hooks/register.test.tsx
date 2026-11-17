import { expect, test } from 'claude-code/testing'

const BACKDROP = { plugin: 'nsx-backdrop', component: 'Backdrop', requestId: 'backdrop' } as const

for (const name of ['night', 'tide', 'dawn', 'paper']) {
  test(`draws the ${name} scene on desktop`, async $ => {
    const ui = await $.ui.mount({
      ...BACKDROP,
      surface: 'desktop',
      props: { scene: `nsx-${name}`, plugin: 'nsx-backdrop', glass: false },
    })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })
}

test('leaves another mod with the same scene name alone', async $ => {
  const ui = await $.ui.mount({
    ...BACKDROP,
    surface: 'desktop',
    props: { scene: 'nsx-night', plugin: 'someone-else', glass: false },
  })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

// Nothing sits beneath the plugin in a test: these hooks stand for the engine.
// A call on `$` is answered `{ value }`. The store is a Map; the theme records each call.
function fakeEngine(on: any, store = new Map<string, unknown>()) {
  const themeCalls: unknown[] = []
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('theme.set', (_: unknown, e: unknown) => {
    themeCalls.push(e)
    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('theme.clear', () => {
    themeCalls.push('clear')
    return { value: { isDrawn: false, reason: 'the theme is cleared' } }
  })
  return { store, themeCalls }
}

const run = (args: string, command = 'nsx-backdrop') => ({
  command,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 },
})

test('/nsx-backdrop with no name lists the four scenes and sets nothing', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  const res = await $.command.run(run(''))
  for (const name of ['night', 'tide', 'dawn', 'paper']) expect(res.text).toContain(name)
  expect(themeCalls.length).toBe(0)
})

test('/nsx-backdrop with an unknown name says so and sets nothing', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  const res = await $.command.run(run('volcano'))
  expect(res.text).toContain('No scene called "volcano"')
  expect(themeCalls.length).toBe(0)
})

test('/nsx-backdrop tide sets scene, scheme and colors in one call, and saves it', async ($, on) => {
  const { store, themeCalls } = fakeEngine(on)
  const res = await $.command.run(run('tide'))
  expect(res.text).toContain('Backdrop: tide')
  expect(store.get('scene')).toBe('tide')
  const call = themeCalls[0] as { backdrop: { scene: string }; overrideColorScheme: string; colors: unknown }
  expect(call.backdrop.scene).toBe('nsx-tide')
  expect(call.overrideColorScheme).toBe('dark')
  expect(call.colors).toBeDefined()
})

test('dawn and paper are light scenes', async ($, on) => {
  const { themeCalls } = fakeEngine(on)
  await $.command.run(run('dawn'))
  await $.command.run(run('NSX-Paper'))
  const schemes = themeCalls.map(c => (c as { overrideColorScheme: string }).overrideColorScheme)
  expect(schemes).toEqual(['light', 'light'])
})

test('/nsx-plain clears the theme and remembers that', async ($, on) => {
  const { store, themeCalls } = fakeEngine(on, new Map([['scene', 'night']]))
  await $.command.run(run('', 'nsx-plain'))
  expect(themeCalls).toEqual(['clear'])
  expect(store.get('scene')).toBe('plain')
})
