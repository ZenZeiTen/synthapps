# nsx-backdrop

A backdrop picker mod for Claude Code. It puts a scene behind the conversation in the Claude Desktop app (Code tab) and the mobile app, with a matching set of Code tab colors.

## Commands

| Command | What it does |
| :- | :- |
| `/nsx-backdrop` | Lists the picks and marks the current one |
| `/nsx-backdrop <name>` | Sets that pick with `$.theme.set` and remembers it for the next session |
| `/nsx-plain` | Clears the theme with `$.theme.clear`, back to the app's own look, and remembers that |

## Picks

| Name | What it draws | Mode |
| :- | :- | :- |
| `sky` | Follows the clock: `dawn` 05–07, `day` 08–16, `dusk` 17–19, `night` 20–04, by the local hour | per scene |
| `dawn` | Pale sky warming to amber, low sun, drifting clouds | light |
| `day` | Clear pale sky, soft clouds | light |
| `dusk` | Deep blue through wine to a thin band of fire, early stars | dark |
| `night` | Seeded star field, crescent moon, low hills | dark |
| `project` | One of 8 fixed colour pairs, picked by hashing the project folder name | dark |
| `sumi-e` | Tsubaki ink wash drifting in from the edges, fading before the reading area | light |
| `noir` | Echoes pixel-noir skyline in the bottom fifth, a few lit windows, slow rain | dark |

`sky` and `project` are worked out again at every session start. A session that runs past 20:00 keeps its dusk sky until the next session.

## Settings

- **`timeZone`** (in `/config`): the IANA time zone used by `sky`, such as `Asia/Jakarta`. The mod runtime runs on UTC whatever the machine's zone (checked on v2.1.326, where `TZ=Asia/Jakarta` still read UTC). So the mod uses this setting first, then the `TZ` environment variable, then UTC. When it falls back to UTC, the command's reply says so.

## Where the colours come from

- **`sky`, `project`, `noir`:** only the 24-colour "Nusalexia Night" palette from the *Echoes of the Forgotten* series bible, §7.2 (`hooks/palette.ts`). A test checks that `noir` uses no other colour.
- **`sumi-e`: draft colours.** No Tsubaki palette was found in the project notes. `TSUBAKI_DRAFT` in `hooks/palette.ts` holds neutral paper and ink greys, marked `[Draft/Inferred]`, and `/nsx-backdrop` labels the pick DRAFT. Replace those values to finish it.
- **Light or dark:** each scene's `overrideColorScheme` comes from the area-weighted WCAG luminance of its colours (above 0.179 is light).
- **Project pairs:** every pair is checked ahead of time by a test: the ground is dark with margin (scene luminance under 0.16), the accent is at least 3:1 on the ground, and no two grounds repeat. The hash (FNV-1a of the folder name) only chooses among these pairs.

## Things to know

- **It replaces your Code tab colors.** `$.theme.set` sets the backdrop and the Code tab colors together, so a pick overrides any custom Code tab colors and any theme another mod set. `/nsx-plain` clears them all.
- **Nothing changes until you pick.** After a pick, the mod sets it again at every session start, because a reload or `--resume` drops the theme.
- **Where it draws:** only the Desktop app's Code tab and the mobile app draw backdrops.
- **SVG filters:** `sumi-e` uses `feTurbulence` and `feDisplacementMap`. The engine's backdrop check accepts them (it refuses `feImage` and `<image>`; both were tested), and Chromium draws them. Mobile drawing is not yet seen. A scene the app finds too heavy is shown still.
- **No Client element:** the rain, twinkling and drift are CSS animations inside the SVG, so they work wherever the SVG does. With reduced motion on, Desktop shows the scenes still, each in a finished resting state.

## Files

- `hooks/register.tsx`: commands, session-start restore, time zone, and the `Backdrop` render hook (it answers only for its own scenes).
- `hooks/scenes.ts`: every scene (SVG, Code tab colors, `$.theme.set` argument) and the picks.
- `hooks/palette.ts`: Nusalexia Night, the Tsubaki draft, and the luminance and contrast functions.
- `hooks/make-colors.js`, `hooks/make-colors.d.ts`: copied unchanged from Claude Code's mod authoring skill. Copy them again when Claude Code updates, then rerun the tests.
- `hooks/register.test.tsx`: 20 tests (`claude plugin test .`).

## Requirements

Claude Code v2.1.324 or later. Built and checked against v2.1.326.

## Install

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install nsx-backdrop@synthapps
```

To try it from a checkout: `claude --plugin-dir nsx-backdrop/plugins/nsx-backdrop`.
