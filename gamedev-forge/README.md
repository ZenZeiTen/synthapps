# Gamedev Forge

A game-development plugin for Claude Code. It turns an idea into a one-page game brief,
routes each job to a specialist skill, uses real tools (Godot, Blender, Aseprite) when
they are connected, and checks the build before a player sees it.

This folder holds two plugins, published through the repository's marketplace
(`.claude-plugin/marketplace.json` at the repository root):

| Plugin | What it adds | Starts servers? |
|---|---|---|
| [`gamedev-forge`](plugins/gamedev-forge/) | 15 skills and 1 agent | No |
| [`gamedev-forge-connectors`](plugins/gamedev-forge-connectors/) | Blender, Godot and Context7 MCP servers | Yes, when enabled |

The core plugin works on its own. The connectors plugin is optional: install it when you
have Blender or Godot on the same machine and want Claude to drive them directly.

- **[DESIGN.md](DESIGN.md)**: how the plugin is organised, how routing and fallbacks
  work, and why it is split in two.
- **[SANITIZATION.md](SANITIZATION.md)**: what was removed from the source skills before
  publishing, and the release check that keeps it out.

## Install

In Claude Code:

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install gamedev-forge@synthapps
/plugin install gamedev-forge-connectors@synthapps     # optional
```

Or from a shell:

```bash
claude plugin marketplace add ZenZeiTen/synthapps
claude plugin install gamedev-forge@synthapps
```

## Use

| You type | What happens |
|---|---|
| `/gamedev-forge:new-game a cat delivering noodles across night-market rooftops` | Writes the game brief, picks a track, builds and checks the first playable loop |
| "make a DOS-style dungeon crawler", "add music to my Godot game", "make a pixel tileset" | The matching skill loads on its own |
| `/gamedev-forge:release-check` | Runs the pre-release checks and asks the `playtest-auditor` agent for a second pass |

Plugin skills are namespaced, so every skill is also available as
`/gamedev-forge:<skill-name>`.

## What is inside

| Skill | Job |
|---|---|
| `game-director` | Entry point: game brief, originality check, track choice, routing, connector check, shared rules |
| `new-game`, `release-check` | Commands you run by name (Claude does not start them on its own) |
| `browser-arcade-game-forge` | One-screen browser arcade games, including remakes in the spirit of a classic |
| `game-creator-2d` | Multi-level NES/SNES/SEGA-style 2D games in one HTML file |
| `dos-game-forge` | 1981-96 PC-style games: CGA/EGA/VGA, PC speaker and FM sound, browser or real DOS .EXE |
| `threejs-retro-forge` | three.js scenes and games with PS1/N64/CRT/Y2K looks |
| `hd2d-forge` | Pixel sprites lit inside 3D worlds, with engine recipes |
| `godot-forge` | Godot 4 projects: scenes, GDScript, shaders, input, headless tests, exports |
| `aseprite-pixel-forge` | Palettes, tilesets, sprite animation and sheet export |
| `blender-game-asset-forge` | Game-ready 3D assets, glTF export, pre-rendered sprites |
| `blender-2d-forge` | Flat 2D animation, cutscenes and trailers rendered in Blender |
| `game-music-forge` | Original music and jingles: brief, sourcing, looping, engine integration |
| `game-loc-ops` | Localization pipeline: i18n readiness, LocKits, LQA, ratings and store compliance |
| `game-liveops-linguist` | Live-service game text: events, gacha and top-up copy, buffs, multimodal LQA |

| Agent | Job |
|---|---|
| `playtest-auditor` | Independent, read-only review of a build before release |

The core plugin adds roughly 3,500 tokens to every session (skill names and descriptions).
Each skill's full text loads only when it is used.

## Requirements

None to install. Individual skills use tools when they are present and fall back when
they are not: a Godot binary, Blender, Aseprite, Python 3, Node.js, `ffmpeg`, a headless
browser. Each skill says what it needs and what it does without it.

## Development

```bash
python gamedev-forge/tools/sanitize_scan.py                            # release gate
python -m unittest discover -s gamedev-forge/tests -t gamedev-forge    # 21 tests
claude plugin validate --strict .                                      # marketplace + plugins
```

Run these from the repository root. The scanner can also read a private deny-list of
names that must never be published; see [SANITIZATION.md](SANITIZATION.md).
