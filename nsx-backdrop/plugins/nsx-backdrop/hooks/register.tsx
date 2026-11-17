// nsx-backdrop: a theme picker.
//   /nsx-backdrop          lists the scenes
//   /nsx-backdrop <name>   puts that scene behind the conversation, with its Code tab colors
//   /nsx-plain             clears the theme, back to the app's own look
// The last pick is remembered in $.store and put back at every session start,
// because neither a reload nor --resume keeps a theme.
import type { Register } from 'claude-code'

import { SCENES, bySceneId, findScene, sceneId, type Scene } from './scenes'

const STORE_KEY = 'scene'
const PLAIN = 'plain'

function listText(current: string | undefined): string {
  const rows = SCENES.map(s => `${s.name === current ? '>' : ' '} ${s.name.padEnd(6)} ${s.blurb}`)
  return [
    'Scenes (use /nsx-backdrop <name>, or /nsx-plain to clear):',
    ...rows,
    'Each scene also replaces the Code tab colors, including any custom ones.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nsx-backdrop',
      description: 'Pick a backdrop scene (night, tide, dawn, paper); no name lists them',
      argumentHint: '[name]',
      immediate: true,
    })
    await $.command.register({
      name: 'nsx-plain',
      description: 'Take the backdrop and its Code tab colors off',
      immediate: true,
    })

    // Put the last pick back. Nothing picked yet, or /nsx-plain last: leave the theme alone.
    const saved = await $.store.get(STORE_KEY)
    const scene = typeof saved === 'string' ? findScene(saved) : undefined
    if (scene !== undefined) {
      const res = await $.theme.set(scene.look)
      if (!res.isDrawn) $.ui.log(`nsx-backdrop: ${scene.name} not drawn: ${res.reason}`, { to: 'debug' })
    }

    return next(e)
  })

  on('command.run', { command: 'nsx-backdrop' }, async ($, e) => {
    const arg = e.args.trim()
    const saved = await $.store.get(STORE_KEY)
    const current = typeof saved === 'string' && saved !== PLAIN ? saved : undefined

    if (arg === '') return { text: listText(current) }

    const scene: Scene | undefined = findScene(arg)
    if (scene === undefined) {
      return { text: `No scene called "${arg}".\n${listText(current)}` }
    }
    if (scene.blocking.length > 0) {
      // Would only happen after make-colors.js is updated; Desktop would ignore the colors.
      $.ui.log(`nsx-backdrop: ${scene.name}: ${scene.blocking[0]}`, { to: 'debug' })
    }

    const res = await $.theme.set(scene.look)
    await $.store.set(STORE_KEY, scene.name)

    return {
      text: res.isDrawn
        ? `Backdrop: ${scene.name}. Code tab colors replaced to match.`
        : `Saved ${scene.name}, but nothing draws it here: ${res.reason}`,
    }
  })

  on('command.run', { command: 'nsx-plain' }, async $ => {
    const res = await $.theme.clear()
    await $.store.set(STORE_KEY, PLAIN)
    return { text: res.isDrawn ? 'Theme cleared.' : `Theme cleared (${res.reason}).` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // The hook runs for every mod's backdrop: answer only for our own scenes.
    if (e.props.plugin !== $.plugin.name) return next(e)
    const scene = bySceneId(e.props.scene)
    if (scene === undefined) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (scene.svg.length > 131072) return next(e)

    const { Svg } = $.ui.resolve(e)
    return <Svg source={scene.svg} alt={scene.alt} />
  })
}

