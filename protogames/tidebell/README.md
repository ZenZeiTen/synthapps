# Tidebell

An original side-scrolling sword game with full gamepad support, in two builds: a desktop
game (Godot 4.7, Windows and Linux) and a browser game (three.js).

Its rules are reverse-engineered from the Sega Genesis cartridge **The Pirates of Dark
Water** (USA, 1994). The ROM was run in an emulator and its memory read frame by frame, and
its 68000 code was disassembled. These carry over with the measured numbers:
- the walk, the fixed-height jump and the timing of every attack;
- health, damage, knock-back and invulnerability, pits and lives;
- the timed item effects and the health cost of the special move;
- the hub between stages, the password and the choice of button layouts.

Everything you see and hear is new: the world, people, names, story, stages, art and music.
None of the cartridge's text, graphics or sound is used, and the ROM is not in this
repository. See `docs/ANALYSIS.md` for what was measured and how, and `docs/DESIGN.md` for
what was kept, changed or dropped.

## The game

The Saltmarch is a chain of tidal islands. Six bronze bells ring around the Maw and keep
the Grey Tide asleep. The raider captain Ossery Grane has taken the bells, and the tide is
rising. Pell, an old hermit crab who keeps the lantern-house, sends a warden to bring them
home. Before each stage you pick one of three wardens:

| warden | weapon | how she or he plays |
|---|---|---|
| Kess Marrow | cutlass | the all-rounder |
| June Rook | twin hook-knives | quick, short reach, each cut hits twice |
| Brannoch Tull | boarding anchor | slow, long reach, heavy cuts |

| stage | what is in it | guardian |
|---|---|---|
| **Mangrove Reach** | roots and boardwalks, trunks to climb | Vell the Netter |
| **Lantern Harbor** | piers, crates, bottle throwers | the Hullbreaker |
| **Stilt Village** | ropes, high and low routes | the Tallyman |
| **Gullstone Cliffs** | two screens high, wind gulls | Old Grey |
| **Drowned Abbey** | flooded halls, a key and a locked gate, wisps | the Bell Warden |
| **The Brinecrow** | the flagship's decks | Captain Grane, then the Silt King |

Along the way:
- Chests and captives give a tonic, heartroot, throwing knives, a gull feather, a squall
  charm, stoneskin or fury salt.
- The Tide Cleave is a special cut that costs 12 health, and needs 24 health or more.
- You have three lives. A pit costs health and returns you to firm ground.
- The lantern-house hub has Talk, the map, the wardens, and the tide-code (a 6-letter
  password that brings you back to the same place).
- Grane meets you before the last fight and becomes the Silt King. After him, the six
  bells ring, the dawn comes, the credits roll, and the game returns to the title.

### Controls

| action | keyboard | gamepad (Xbox / PlayStation) |
|---|---|---|
| move, climb | arrows or WASD | D-pad or left stick |
| jump (hold for higher) | Z, K or Space | A / Cross |
| attack | X or J | X / Square |
| use item | C or L | B / Circle |
| next item | Up + item | Up + B / Circle |
| Tide Cleave | V or I | Y / Triangle |
| pause, items | Enter or Esc | Start |

Down + jump drops through a thin ledge. In menus, jump or Enter confirms and item or Esc
goes back. Options → Buttons has two more layouts, as the cartridge had. Pads can be
plugged in or out during play: the desktop build uses Godot's joypad support (SDL
mappings), the browser build the Gamepad API (standard mapping).

## Run it

| where | how |
|---|---|
| Windows | unpack `Tidebell-windows.7z` and run `tidebell.exe` |
| browser | `cd web && npm install && node tools/build.mjs && node tools/serve.mjs`, then open the address it prints. `web/dist/` is a static folder that any web server can host |
| Godot editor | open `godot/project.godot` in Godot 4.7 and press F5 |
| build the exe | `godot --headless --path godot --export-release "Windows Desktop" ../dist/windows/tidebell.exe` (or `"Linux"`). This needs the 4.7 export templates |

## How it was made

| tool | part |
|---|---|
| **stable-retro** (Genesis Plus GX) and **capstone** | the measurements and the disassembly (`tools/rom/probe.py`) |
| **Godot 4.7** (Compatibility renderer) | the desktop game and most of the checks |
| **three.js** 0.186 | the browser game: the 2D layer composited over the stages' Blender scenes as real 3D, then a 48-colour palette pass |
| **reality.js** | the three painted stills (title, map, dawn), path-traced from `.real` scenes |
| **Aseprite format** | every sprite, tile set, portrait and the font, as `.aseprite` files in `art/aseprite` |
| **Blender 5** (`bpy`) | the six parallax backdrops, their low-poly scenes as glTF for three.js, and the Silt King and the bell |
| numpy synthesis | 13 music tracks and 34 sound effects |

- **One set of rules, two builds.** The rules core exists in GDScript
  (`godot/scripts/core`) and in JavaScript (`web/src/core`). Both run in 16.16 fixed point
  at 60 steps per second with the same random numbers, and `tests/parity.sh` proves that
  they reach the same state on every recorded route.
- **Aseprite:** no Aseprite binary or MCP server was available, so the files are drawn in
  code (`pipeline/aseprite`) and the format is written and read directly
  (`pipeline/aseprite/asefile.py`). They open in Aseprite for hand editing.
- **Blender:** the Blender MCP connector was not connected in this session, so the scripts
  in `pipeline/blender` ran through `bpy` as a Python module. The same scripts run inside
  Blender or through the MCP.

`docs/PIPELINE.md` explains how to rebuild everything.

## Checks

```bash
bash tests/run_all.sh          # everything, about 25 minutes
bash tests/run_all.sh --quick  # without the playthrough, the export and the browser
bash tests/run_web.sh          # only the browser build
```

| check | what it proves |
|---|---|
| `godot/tests/run_tests.gd` | the rules against the measured numbers: the 0.375 first step and 2.75 top speed, the 81 px jump and its 38 frames, attack lengths, damage, knock-back, 100 frames of invulnerability, pits, items and their timers |
| `tests/make_routes.sh` | a search over real inputs finishes every stage, and the inputs are recorded |
| `--script=replay:<stage>:kb` and `:pad` | every stage finished from synthesized keyboard or gamepad events, through the input map |
| the walk and final checks | the screens reached with real keys and pad buttons: title, opening, hub, talk, map, wardens, a stage, pause, and the Brinecrow through the Silt King, the ending and the credits back to the title |
| `fit` | no text outside its frame, with the longest real data |
| `godot/tests/playthrough.gd` | the whole game from the first stage to the last, with progress carried |
| `tests/parity.sh` | the GDScript and JavaScript cores match, hash for hash |
| `web/tests/check.mjs` | the browser build in headless Chromium: every stage from a virtual Gamepad API pad, two from the keyboard, the screen walk, the final check and the fit audit |
| `tests/verify_*.py` | content copies, every pixel in the palette, audio formats and loops, the exported build |

## Folders

```
docs/          ANALYSIS (the cartridge), DESIGN (kept/changed/dropped), PIPELINE
content/       the hand-edited data: rules numbers, text, levels, routes
godot/         the Godot project (content/ holds the generated copies)
web/           the three.js build (src/core, src/view, tools, tests)
pipeline/      aseprite/, blender/, reality/, audio/, sync_content.py
art/           aseprite/ sources and blender/ .blend files
tests/         run_all.sh, run_web.sh, parity.sh, make_routes.sh, verify_*.py
tools/         rom/probe.py, contact_sheet.py, mark_keep.py
```
