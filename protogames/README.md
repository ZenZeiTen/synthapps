# The House on Crowmere Hill

*A Gus Pickett Misadventure.* A paperboy, a runaway dog, a crow, and a house that
wants you to touch things you shouldn't. It's an original parser adventure in the
idiom of 1990 EGA games: 16 colours, 320x200, arrow keys plus a typed parser, sudden
comic deaths, and a score out of 80.

The game is built twice from one content package:

- **Browser.** A software renderer in plain JavaScript (`web/`), which also ships as
  a single self-contained HTML file.
- **Godot 4.7.** A GDScript port (`godot/`) of the same core, with shaders for the
  lighting effects.

Every room was modelled in **Blender** and every sprite, texture and glyph drawn in
**Aseprite**, both driven through their MCP servers. The rooms were then rendered and
dithered down to the EGA palette. See [docs/PIPELINE.md](docs/PIPELINE.md).

The music is four original pieces, synthesized by the pipeline from plain-text scores
in the style of a 1990 AdLib card.

All characters, text, puzzles, art, sound and music are original to this project.

## Play

| build | how |
|---|---|
| single file | `node tools/bundle_web.mjs`, then open `dist/crowmere-hill.html` (offline). Fonts are the only thing it fetches |
| dev page | serve the repo root (below) and open http://localhost:8766/web/index.html |
| Godot | `node tools/sync_godot.mjs`, then open `godot/project.godot` in Godot 4.7 and press F5 |
| Windows .exe | `node tools/sync_godot.mjs`, then `godot --headless --path godot --export-release "Windows Desktop"`. This writes one self-contained `dist/godot/crowmere-hill.exe`. It needs Godot's export templates, installed once (Editor → Manage Export Templates) |

```bash
python -m http.server 8766 --bind 127.0.0.1
```

Controls:

- **Arrow keys**, or click the picture, to walk. Clicking a doorway leaves through it.
- Type a command and press **Enter**. `help` and `hint` exist.
- **F2** sound, **F3** music, **F5** save, **F7** restore, **F9** restart. The sound
  and music settings are remembered.
- **F4** switches between 4:3 and square pixels (web build only).

## Layout

```
content/     the engine-agnostic package: game.json, rooms, sprites, font, sfx, music
web/         browser build: core.js (pure rules) + gfx, ui, world, audio, main
godot/       Godot 4.7 build: scripts/core.gd (port of core.js), main.gd, shaders
pipeline/    asset pipeline: aseprite/, blender/ (kit + one script per room), post/, audio/
art/         editable sources: .aseprite files, textures, .blend scenes
build/       intermediate Blender passes (regenerable)
tests/       lint, golden transcripts, bundle tests, mutation checks, art verification
tools/       record transcripts, sync Godot, bundle the web build, dump art
docs/        PIPELINE.md, ENGINE_SPEC.md, DESIGN.md (spoilers)
dist/        the single-file build
```

## Checks

```bash
node --test tests/lint.test.mjs tests/transcripts.test.mjs tests/bundle.test.mjs tests/death.test.mjs tests/music.test.mjs
```

```bash
node tests/mutation.mjs
```

```bash
node tests/mutation_bundle.mjs
```

```bash
node tests/mutation_walk.mjs
```

```bash
node tools/dump_art.mjs && python tests/verify_art.py
```

```bash
python tests/verify_music.py
```

```bash
python tests/mutation_music.py
```

```bash
godot --headless --path godot --script res://tests/run_transcripts.gd
```

```bash
godot --headless --path godot --script res://tests/death_policy.gd
```

```bash
godot --headless --path godot --script res://tests/music_policy.gd
```

```bash
python tests/mutation_godot.py
```

```bash
python tests/verify_godot_export.py --run
```

What each check proves:

- The **golden transcripts** (`tests/transcripts/*.txt`) are replayed by both cores
  and must match byte for byte. A pass on both is engine parity.
- The **mutation checks** plant faults and require the tests to catch every one.
  A suite that can't fail proves nothing.
- `verify_art.py` compares every exported pixel with the ASCII art it was drawn
  from.
- The **walk checks** in the lint suite require every point to be reachable on foot,
  and every exit to be enterable on foot, from where Gus enters. They also check each
  room's probes, such as "behind the kitchen table is walkable, under it is not".
- The **death-policy tests** hold both engines to the same rule: every death offers
  an undo to the moment before the fatal step.
- `verify_music.py` re-renders every melody and measures each note against the
  written score. It also checks that every loop seam is inaudible. The
  **music-policy tests** hold both engines to the same choice of track.

Status on 2026-09-24:

- 25/25 node tests pass.
- Mutants caught: 7/7 in the core suite, 7/7 in the bundle suite, 5/5 in the walk
  checks, 5/5 in the music synth, 5/5 in the GDScript core.
- Godot parity: 4/4 transcripts, 5/5 death-policy cases, 7/7 music-policy cases.
- Music: 4 seamless loops, and all 152 melody notes at their written pitch.
- Windows export: a single 112 MB `crowmere-hill.exe`, run on its own from an unrelated
  folder.
  - Its pack carries all 61 content files byte for byte.
  - The export check caught 3/3 planted faults.
  - Closing the window quits without leaks.
- Art is pixel-exact: 36 sprite frames, the font sheet and 49 textures.
- An end-to-end browser run of the walkthrough, with real pathfinding (20
  auto-walks), wins 80/80 on the bundled file.

## Not done yet

- **Other export targets.** Only a Windows preset exists (`godot/export_presets.cfg`).
  The same content setup works for any other platform preset.
- **Planned but cut:** a rocking-chair animation, and a dawn version of the gate for
  the ending, which currently reuses the night scene.
