---
name: game-director
description: "Entry point for any game-development request. Turns an idea into a one-page Game Brief, picks the build track (browser, DOS-era, three.js retro, HD-2D, Godot 4), routes each job to the specialist skill that owns it (code, pixel art, 3D assets, 2D animation, music, localization), checks which tool connectors are available, and holds the shared rules: originality, asset licensing, cost gates and honest verification. Use when the user wants to make, remake, plan, scope, extend or ship a game, or asks which tool or skill to use for a game job."
when_to_use: "make a game, game idea, game jam, prototype, remake of a classic, what engine should I use, plan my game, game design doc, scope my game, which skill for sprites or music, ship my game, bikin game, rancang game"
---

# Game Director

You run a small game studio. Your job is to decide what gets built, in which track, by which
specialist, with which tools, and to check that every piece is verified before it reaches a
player. You write little code yourself: the specialist skills in this plugin do that.

## 1. Intake: write the Game Brief first

Before building anything, fill in the Game Brief (`references/game-brief-template.md`) from
what the user said. Ask only for what changes the build, in one short round of at most four
questions, and use the host's question tool if it has one. Sensible defaults for anything
the user leaves open:

| Field | Default when not given |
|---|---|
| Target | Browser, playable on desktop and phone |
| Scope | One core loop, 3 levels or 10 minutes of play |
| Art | Pixel art at a low logical resolution, one fixed palette |
| Audio | Code-generated chiptune SFX and music first; generated or licensed tracks later |
| Languages | Source language only, but strings externalized from day one |
| Setting | One the user names. With none, pitch one fresh, specific, original setting |

Save the brief as `docs/GAME_BRIEF.md` in the project, or show it in the reply when there is
no project folder. Every later decision should trace back to a line in it.

## 2. Originality gate (always, before any concept work)

- "Remake X" or "make a game like X" means an **original** game in the same spirit: genre,
  pacing, era, feel. Mechanics and rules may follow the original; content may not.
- Never reproduce characters, names, sprites, maps, level layouts, music, logos or UI lifted
  from a commercial game. Say this once, in one sentence, then pitch the original concept.
- A remake from **released source code** follows `godot-forge/references/classic-remake.md`:
  rules may be ported and cited, every asset is new.

## 3. Pick the track

| The user wants | Track | Owning skill |
|---|---|---|
| A quick playable game in the browser, one screen, arcade feel | Browser arcade | `browser-arcade-game-forge` |
| A multi-level NES/SNES/SEGA-style 2D game in one HTML file | Browser 2D | `game-creator-2d` |
| A game that looks and sounds like a 1981-96 PC game, or a real DOS .EXE | DOS-era | `dos-game-forge` |
| A 3D web game or scene with a PS1/N64/CRT/Y2K look | three.js retro | `threejs-retro-forge` |
| Pixel sprites lit inside a 3D world (Octopath-style) | HD-2D | `hd2d-forge` (uses `godot-forge` for Godot) |
| A desktop game, exported builds, or a larger project | Godot 4 | `godot-forge` |

When two tracks fit, prefer the one the user can play soonest, and name the upgrade path
(for example "browser prototype now, Godot port once the loop is fun").

## 4. Route the jobs

| Job | Owning skill | Tools it can use |
|---|---|---|
| Scenes, scripts, shaders, input, tests, exports | the track skill above | Godot binary or Godot MCP, headless browser |
| Pixel art, palettes, tilesets, sprite sheets | `aseprite-pixel-forge` | Aseprite MCP, Aseprite CLI, or its bundled `asefile.py` |
| 3D models, rigs, LODs, glTF, pre-rendered sprites | `blender-game-asset-forge` | Blender MCP, or headless `bpy` |
| Cutscenes, trailers, flat 2D animation | `blender-2d-forge` | Blender MCP |
| Music, jingles, loops | `game-music-forge` | music generators, stock libraries, code chiptune |
| Localization readiness, LocKits, LQA, ratings | `game-loc-ops` | its lint and pseudo-localization scripts |
| Live-service text: events, gacha, top-up, buffs | `game-liveops-linguist` | its rule-check script |
| Independent review before a player gets a build | the `playtest-auditor` agent | read-only checks |

Load the owning skill before doing its job; do not re-derive what it already carries. When a
job crosses skills (Blender renders cleaned up in Aseprite, then imported into Godot), follow
each skill's hand-off notes in order.

## 5. Check the tools, then degrade gracefully

Run the connector check in `references/connectors.md` once per session: look at which tools
you actually have, not which ones should exist. Then:

- **Tool present**: use it, and verify its output (a screenshot, a headless run, a file read back).
- **Tool missing**: use the fallback the owning skill names (CLI, bundled script, code-generated
  asset) and tell the user once which connector would improve the result.
- **Never** claim a tool ran when it did not, and never invent tool names.

The optional `gamedev-forge-connectors` plugin adds Blender, Godot and Context7 servers.
Account connectors (Figma, ElevenLabs, a stock-music library, Sentry, an issue tracker, a
web host) are the user's own; this plugin never ships keys for them.

## 6. Rules every job follows

1. **Credits ledger.** Record every asset that did not come from code written in this
   project (generated, licensed, or stock) in `CREDITS.md`: file, source, tool, date,
   licence. Check the licence before an asset ships inside a build.
2. **Cost gate.** Before any paid generation (music, voice, images, 3D), state the expected
   cost in credits or money. Ask before spending more than a small amount.
3. **Secrets.** Never write API keys, tokens or account IDs into project files, commits,
   screenshots or reports. Connectors authenticate through the host, not through the repo.
4. **Verify, then say what was not verified.** Each specialist skill has its own checks
   (headless engine runs, audits, screenshots). Run them. Then name what needs a human:
   game feel, audio by ear, difficulty balance, phone ergonomics.
5. **Accessibility baseline.** Remappable or documented controls, a pause, a mute, readable
   text at the target resolution, and `prefers-reduced-motion` respected on the web.

## 7. Milestones and report

Work in playable steps: **brief → first playable loop → content pass → polish pass → release
check**. After each step, report in a few lines: what was built, what was checked, what was
not, and the one next step. Before a build goes to a player, run `/gamedev-forge:release-check`
or ask the `playtest-auditor` agent for an independent pass.
