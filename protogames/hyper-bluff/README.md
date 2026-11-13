# Hyper Bluff!! Starlight Showdown

An original 90s-anime-style poker battle. Climb the five floors of Starlight Tower, one
heads-up no-limit hold'em match per floor, and take the crown from Baron Onyx.

- **Aura Meter**: a live estimate of your chance to win the hand, recomputed whenever
  you learn something new (a new table card, a peeked card).
- **Spirit powers** (keys 1 2 3): Hawk Eye, Wild Swap, Iron Guard, Overdrive, Future
  Sight, Demon Glare. You hold up to three; showdown wins, fever hands and 777 stars
  grant more. Rivals from floor 2 up carry their own.
- **Random bonus points**: a bonus mission every hand, star cards on the table that fill a
  star pot (100 to 1000 each), and fever hands that triple the points.
- Five different rooms, one per floor, and a PACE option (relaxed, normal, fast).
- Four player avatars, five rivals, an opening, a scene before the boss, an ending and
  credits. Keyboard, mouse and gamepad.

## Controls

| Action | Keyboard | Mouse | Pad |
|---|---|---|---|
| Move / pick button | Arrows or WASD | point | D-pad |
| Confirm | Z, Enter, Space | click | A |
| Back | X, Backspace | | B |
| Fold / Call / Raise | F / C / R | click the button | LB folds |
| Raise size | Up / Down | wheel, or - and + | D-pad up / down |
| Spirit power 1 2 3 | 1 2 3 | click the icon | X, Y, RB |
| Pause menu | Esc, P | MENU | Start |

## Open it

Open `godot/project.godot` in Godot 4.4 or newer, or in Summer Engine (a Godot 4
compatible editor for Windows and macOS), wait for the import, and press Play.

## How it was made

- **Aseprite**: characters, cards and icons live as `.aseprite` sources under `art/`
  (layers, tags, palettes). `tools/art/*.py` paint them and export the game sheets from
  the `.aseprite` files, so a hand edit in Aseprite is what ships. `ase_crosscheck.py`
  opens every source in the real Aseprite CLI and compares it pixel for pixel.
- **Blender 4.2**: the table, boss and title backdrops, chips, star and trophy are
  modelled by `tools/blender/build_scenes.py`, rendered with Cycles and reduced to pixel
  art by `pixelize.py`. Scenes are saved in `art/blender/*.blend`.
- **Audio**: music and effects are synthesised by `tools/audio/`.
- **Engine**: a plain Godot 4 project (`godot/`), GDScript only, no add-ons.

Checks: `bash tests/run_all.sh`. Details in `CLAUDE.md` and `docs/DESIGN.md`.
