// nsx-backdrop: a theme picker.
//   /nsx-backdrop          lists the picks
//   /nsx-backdrop <name>   sets that pick, with its Code tab colors, and remembers it
//   /nsx-plain             clears the theme, back to the app's own look
// The last pick is kept in $.store and resolved again at every session start,
// because neither a reload nor --resume keeps a theme. "sky" resolves by the
// local hour and "project" by the project folder, both once per session.
import type { EngineInterface as Engine, Register } from 'claude-code'

import { PICKS, findPick, hourIn, sceneById, type Pick } from './scenes'

const STORE_KEY = 'scene'
const PLAIN = 'plain'

// The module runtime runs on UTC whatever the machine's zone (checked on
// v2.1.326: TZ=Asia/Jakarta still reads UTC), so the zone comes from the
// timeZone option, then the TZ variable, then UTC.
async function context($: Engine, zoneOption: string): Promise<{ hour: number; zone: string; root: string }> {
  const now = await $.clock.now()
  const tz = (await $.env.get('TZ')) ?? ''
  let zone = 'UTC'
  let hour = new Date(now).getUTCHours()
  for (const candidate of [zoneOption.trim(), tz.trim()]) {
    const h = candidate === '' ? undefined : hourIn(now, candidate)
    if (h !== undefined) { zone = candidate; hour = h; break }
  }
  const root = await $.session.root()
  return { hour, zone, root }
}

async function apply($: Engine, pick: Pick, zoneOption: string): Promise<string> {
  const { scene, note } = pick.resolve(await context($, zoneOption))
  if (scene.blocking.length > 0) $.ui.log(`nsx-backdrop: ${scene.id}: ${scene.blocking[0]}`, { to: 'debug' })
  const res = await $.theme.set(scene.look)
  const what = note === '' ? pick.name : `${pick.name} (${note})`
  if (!res.isDrawn) {
    $.ui.log(`nsx-backdrop: ${scene.id} not drawn: ${res.reason}`, { to: 'debug' })
    return `Saved ${what}, but nothing draws it here: ${res.reason}`
  }
  return `Backdrop: ${what}. Code tab colors replaced to match.${pick.isDraft ? ' Colours are a draft.' : ''}`
}

function listText(current: string | undefined): string {
  const width = Math.max(...PICKS.map(p => p.name.length))
  return [
    'Backdrops (/nsx-backdrop <name>; /nsx-plain to clear):',
    ...PICKS.map(p => `${p.name === current ? '>' : ' '} ${p.name.padEnd(width)}  ${p.blurb}`),
    'Each one also replaces the Code tab colors, including any custom ones.',
  ].join('\n')
}

export const register: Register = (on, options) => {
  const zoneOption = typeof options.timeZone === 'string' ? options.timeZone : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nsx-backdrop',
      description: 'Pick a backdrop: sky, dawn, day, dusk, night, project, sumi-e, noir; no name lists them',
      argumentHint: '[name]',
      immediate: true,
    })
    await $.command.register({ name: 'nsx-plain', description: 'Take the backdrop and its Code tab colors off', immediate: true })

    const saved = await $.store.get(STORE_KEY)
    const pick = typeof saved === 'string' ? findPick(saved) : undefined
    if (pick !== undefined) await apply($, pick, zoneOption)

    return next(e)
  })

  on('command.run', { command: 'nsx-backdrop' }, async ($, e) => {
    const arg = e.args.trim()
    const saved = await $.store.get(STORE_KEY)
    const current = typeof saved === 'string' && saved !== PLAIN ? saved : undefined
    if (arg === '') return { text: listText(current) }

    const pick = findPick(arg)
    if (pick === undefined) return { text: `No backdrop called "${arg}".\n${listText(current)}` }

    const text = await apply($, pick, zoneOption)
    await $.store.set(STORE_KEY, pick.name)
    return { text }
  })

  on('command.run', { command: 'nsx-plain' }, async $ => {
    const res = await $.theme.clear()
    await $.store.set(STORE_KEY, PLAIN)
    return { text: res.isDrawn ? 'Theme cleared.' : `Theme cleared (${res.reason}).` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Every mod's backdrop comes through here: answer only for our own scenes.
    if (e.props.plugin !== $.plugin.name) return next(e)
    const scene = sceneById(e.props.scene)
    if (scene === undefined) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)

    const { Svg } = $.ui.resolve(e)
    return <Svg source={scene.svg} alt={scene.alt} />
  })
}
