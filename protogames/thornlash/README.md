# Thornlash: The Vigil of Hollowmoor

An original gothic whip-action platformer in the style of the 16-bit console era, built in
**Godot 4.7.2**. Sprites were assembled in **Aseprite**, and the castle blockout was made in
**Blender**.

Corvin Ashdown climbs Hollowmoor Keep block by block, stage by stage, to end the Pale
Margrave. There are six stages and seven boss forms.

> **All content is original.** That covers the title, the characters, the castle, the stage
> layouts, the bosses, the art, the music and the sound. The game belongs to the genre of the
> 1986 classic that inspired the request. It keeps that genre's mechanics and structure
> (listed below), but uses none of its names, maps, sprites or music.

## Run it

- **Windows build:** `dist/Thornlash/Thornlash.exe`. It is one self-contained file. Windows
  SmartScreen will warn about an unsigned exe; choose *More info → Run anyway*.
- **From source:** open `godot/project.godot` in Godot 4.7.2 and press F5.
- **Saves and options** live in `%APPDATA%\Godot\app_userdata\Thornlash\`.

## Controls

| Action | Keyboard | Gamepad (Xbox / PlayStation / Switch Pro / Steam Deck) |
|---|---|---|
| Move, climb stairs, crouch | Arrows or WASD | D-pad or left stick |
| Jump / menu OK | Z or Space | A / Cross / B |
| Whip | X or J | X / Square / Y |
| Sub-weapon / menu back | C or K (or Up + Whip) | B / Circle / A, and Y / Triangle / X |
| Rewind (hold) | R or Backspace | LB / L1 / L, or the left trigger |
| Pause | Enter or Esc | Menu / Options / + |
| Quick save / quick load | F5 / F9 | View / Share / − (save) |

Every action can be rebound, keyboard and pad separately, under *Options → Controls*. The
button prompts follow the device you last touched, so a PlayStation pad shows CROSS, SQUARE
and so on. Stairs work the classic way: stand near the foot or the top and hold Up or Down.

## What is in it

**Genre traits kept.**
- The whip, which upgrades twice, from leather cord to chain to a long barbed chain.
- Committed classic jumps with knockback when hit.
- Stairs, and candles that drop hearts.
- Hearts as sub-weapon ammunition. The sub-weapons are dagger, axe, blessed flask, sun-wheel
  and hourglass, plus double and triple shot.
- Hidden meat in breakable walls.
- A stage timer, a score with extra lives, and linear block-by-block stages with a boss at the
  end of each.

**Stages.**

| # | Stage | Blocks | Boss |
|---|---|---|---|
| 1 | The Gatehouse | Gatehouse Road, Hall of Lanterns, Belfry Walk | The Nightwing (giant bat) |
| 2 | The Catacombs | Ossuary Gate, Flooded Crypt, Charnel Deep | Ossuary Wyrm (a bone serpent) |
| 3 | The Ramparts | Western Rampart, Tower Climb (vertical), Lantern Bridge | Lantern Warden |
| 4 | The Dungeons | The Oubliette, Rack Galleries, Gaoler's Pit | The Chainmaster |
| 5 | The Clockwork Spire | Gear Hall, Pendulum Shaft (vertical), The Clock Face | The Horologist (ignores the hourglass) |
| 6 | The Throne of Ash | Long Gallery, Stair of Ash, Throne of Ash | The Pale Margrave, then the Ashen Beast |

**Modern options.** All are optional and set in *Options*:
- **Saving:** save anywhere into three slots, quick save and quick load, and an auto-save at
  every block.
- **Rewind:** hold to rewind, 5 to 30 seconds or off, recorded frame by frame. It can even
  undo a death.
- **Control feel:** *Classic* has committed jumps. *Modern* adds air control, variable jump
  height, ledge grace, jump buffering and softer knockback.
- **Difficulty:** easy halves damage taken, hard takes 1.5×.
- **Assists:** infinite lives, practice mode (any stage, fully armed), and game speed from 50%
  to 100%.
- **Presentation:** scanlines, fullscreen, vibration, music and sound volume.
- **Soundtrack:** a *16-bit* arrangement or an *8-bit* one of the same twelve original tunes.

## How it was made

- `godot/scripts/core/` holds the rules: plain data stepped at a fixed 60 Hz. Rewind and
  save-anywhere are exact because the whole world state is one dictionary.
- `godot/scripts/view/` and `main.gd` hold the rendering, UI, audio and input.
- Art is painted by scripts in `tools/art/`:
  - characters are painted from a 2D rig, with 16-colour hue-shifted palettes, light from the
    upper left, and plum outlines;
  - small icons are hand-authored character grids;
  - backgrounds use Bayer dithering, and the far castle is a Blender blockout repainted as
    pixel art.
- `tools/art/asebuild.py` assembles the frames into editable `art/*.aseprite` sources, with
  tags and durations. The game sheets are exported *from those files*, so a hand edit made in
  Aseprite is what ships.
- The music (`tools/audio/music.py`) is synthesised from original scores in both
  arrangements. The sound effects (`tools/audio/sfx.py`) are synthesised too.
- Stages 2–6 come from `tools/levels/build_levels.py`. Stage 1 is written by hand.

Rebuild everything:

```bash
python tools/gen_font.py
python tools/art/hero.py && python tools/art/asebuild.py all hero
python tools/art/props.py && python tools/art/asebuild.py all props
python tools/art/enemies.py && python tools/art/asebuild.py all enemies
python tools/art/bosses.py && python tools/art/asebuild.py all bosses
python tools/art/world.py && (cd tools/art && python screens.py)
python tools/audio/music.py && python tools/audio/sfx.py
python tools/levels/build_levels.py
python tools/sidecars.py
```

## Tests

```bash
godot --headless --path godot --script res://tests/run_tests.gd --quit-after 1000000
bash godot/tests/harness.sh
python tests/verify_audio.py
python godot/tests/mutation_core.py
python godot/tests/mutation_harness.py
```

- **Core suite, 26 tests:**
  - physics, stairs, whip reach, sub-weapons, pickups, saves and determinism;
  - a reachability lint over all 18 blocks;
  - a bot that fights every boss;
  - the final boss played through to the ending;
  - holds (death, stage clear, fades) keep gravity when started mid-jump;
  - art coverage.
- **End-to-end harness, 14 checks:** these run through the real input path. They cover menus,
  slots, rewind, game over, assists, rebinding, music and the ending back to the title. All 14
  pass on the exported exe too (`--main-pack`).
- **Planted-fault runs:** 5 of 5 caught in the rules and 4 of 4 in the app.
