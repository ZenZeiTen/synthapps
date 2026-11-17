# nsx-backdrop

A theme picker mod for Claude Code. It puts one of four scenes behind the conversation in the Claude Desktop app (Code tab) and the mobile app, with a matching set of Code tab colors.

## Commands

| Command | What it does |
| :- | :- |
| `/nsx-backdrop` | Lists the scenes and marks the current one |
| `/nsx-backdrop <name>` | Sets that scene with `$.theme.set`, and remembers it for the next session |
| `/nsx-plain` | Clears the theme with `$.theme.clear`, back to the app's own look, and remembers that |

## Scenes

| Name | Look | Mode | Motion |
| :- | :- | :- | :- |
| `night` | Dark night sky, faint stars, crescent moon, low hills | dark | Stars twinkle slowly |
| `tide` | Deep teal water, waves along the bottom | dark | Waves drift slowly |
| `dawn` | Pale sky warming to peach, low sun, thin clouds | light | Clouds drift slowly |
| `paper` | Warm ruled notebook page with a margin line | light | None |

Names are not case-sensitive, and an `nsx-` prefix is accepted (`/nsx-backdrop NSX-Tide` works).

## Things to know

- **It replaces your Code tab colors.** `$.theme.set` sets the backdrop and the Code tab colors together, so picking a scene overrides any custom Code tab colors you use, and overrides a theme another mod set. `/nsx-plain` clears them all.
- **Nothing changes until you pick.** On first install the mod sets no theme. After a pick, it puts that scene back at every session start, because a reload or `--resume` drops the theme.
- **Where it draws.** Only the Desktop app's Code tab and the mobile app draw backdrops. In a terminal-only session the command still saves your pick and says why nothing is drawn.
- **Light or dark.** Each scene sets `overrideColorScheme` from the WCAG relative luminance of its main colour (above 0.179 is light).
- **Reduced motion.** With reduced motion on, Desktop draws the scenes still. Each one is designed to look finished that way.

## Files

- `hooks/register.tsx`: commands, session-start restore, and the `Backdrop` render hook (it only answers for its own scenes).
- `hooks/scenes.ts`: the four scenes: SVG, colour palette and the `$.theme.set` argument for each.
- `hooks/make-colors.js`, `hooks/make-colors.d.ts`: copied unchanged from Claude Code's mod authoring skill; they turn a few anchor colours into a full Code tab palette. Copy them again when Claude Code updates, then rerun the tests.
- `hooks/register.test.tsx`: 10 tests (`claude plugin test .`).

## Requirements

Claude Code v2.1.324 or later. Built and checked against v2.1.326, which uses `backdrop: { scene }` and a top-level `overrideColorScheme`.

## Install

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install nsx-backdrop@synthapps
```

To try it from a checkout: `claude --plugin-dir nsx-backdrop/plugins/nsx-backdrop`.
