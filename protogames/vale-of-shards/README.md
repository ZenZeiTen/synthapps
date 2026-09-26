# Vale of Shards

An original side-scrolling platformer for Windows and Linux (Godot 4.7), with full gamepad
support.

Its rules are reverse-engineered from the released C source of **Xargon** (1993–95, Allen
W. Pilgrim, Epic MegaGames). The following all carry over with the source's numbers:
- the run, jump, climb and fall physics;
- the one-way ledges, vines and water;
- weapons and their on-screen limits;
- the trigger channels, doors, bridges, lifts, springs and moving planks;
- the item shop, the overworld map, and the enemy behaviours.

Everything you see and hear is new: the art, names, text, stages, map and music. See
`docs/ANALYSIS.md` for the source reading, and `docs/DESIGN.md` for what was kept, adapted
or dropped.

## The game

Orrin is a lamplighter. The Glass Regent has drawn the Vale's three sigils into his spire
of glass. Walk the Vale path, play six stages, and win back the Sigils of Root, Tide and
Ember. Then break the Regent's heart crystal.

| stage | what is in it |
|---|---|
| **Mossgate Hollow** | vines, ledges, crates, keys and doors, springs |
| **Lantern Mines** | breakable rock, crumbling floors, a lever bridge, a lift |
| **Sunken Aqueduct** | the diving Bell, torpedoes, fish and urchin mines |
| **Thornwood Canopy** | moth wings, blinking boughs, vine creepers, a floating plank |
| **Ember Foundry** | lava, fire drips, mashers, clockwork sentries, ember charges |
| **The Glass Spire** | hollow shades, the Glass Regent, the heart crystal |

Along the way:
- Shards buy health, extra bolts, rapid fire, ember charges and a ward from Tolly's pack.
- Sixteen berries make a new heart.
- The runes V-A-L-E, collected in order, are worth 4000 points.
- There are no lives. A fall returns you to the stage start or to the last lantern post
  you lit.

### Controls

| action | keyboard | gamepad |
|---|---|---|
| move, climb, look | arrows or WASD | D-pad or left stick |
| jump | Z, K, Alt, Ctrl | A (south) |
| fire | X, J, Shift, Space | X (west) or B (east) |
| items | I, Enter | Y (north) |
| Tolly's pack (shop) | B | Back / Select |
| menu, pause | Esc, P | Start |

In menus, confirm with Enter, Z or A and go back with Esc or B. Gamepads use Godot's
joypad support (SDL mappings) and can be plugged in or out during play. The options menu
has "Relaxed speed", the source's half-speed "granny mode". Saving happens on the Vale
map; the map also autosaves a Continue slot.

## Run it

| where | how |
|---|---|
| Windows | unpack `ValeOfShards-windows.7z` and run `vale-of-shards.exe` |
| Godot editor | open `godot/project.godot` in Godot 4.7 and press F5 |
| build it yourself | `godot --headless --path godot --export-release "Windows Desktop" ../dist/windows/vale-of-shards.exe` (or `"Linux"`). This needs the 4.7 export templates |

## How it was made

| tool | part |
|---|---|
| **Godot 4.7** (Compatibility renderer) | the game |
| **Aseprite format** | every sprite and tile sheet |
| **Blender 5** (`bpy`) | the diving bell, the sentry, drone, turret, geode, the Glass Regent, the heart crystal, and the six parallax backdrops and the title scene |
| numpy synthesis | 53 sound effects and 10 music tracks |

- **Godot:** a pure-GDScript rules core (`godot/scripts/core`) runs headless for the tests.
  The view (`godot/scripts/view`) draws it on a 320×180 canvas at integer scale. It
  interpolates between the source's 18.2 steps per second so motion is smooth.
- **Aseprite:** every sprite and tile sheet is an `.aseprite` file in `art/aseprite`, drawn
  in code (`pipeline/aseprite`) and exported by reading the files back. No Aseprite binary
  or MCP server was available, so the format is read and written directly
  (`pipeline/aseprite/asefile.py`).
- **Blender:** the models are built from primitives in code (`pipeline/blender`), rendered
  orthographically, then locked to the 48-colour palette. The Blender MCP connector was
  not connected in this session, so the scripts ran through `bpy` as a Python module. The
  same scripts run inside Blender or through the MCP.

`docs/PIPELINE.md` explains how to rebuild everything.

## Checks

```bash
bash tests/run_all.sh          # about 10 minutes
bash tests/run_all.sh --quick  # without the playthrough and the export
```

| check | what it proves |
|---|---|
| `godot/tests/run_tests.gd` | the physics against hand-computed numbers from the source: a 56 px jump, 90 px with boots, the 2-step launch pause, 8 px run steps, the 4,0,0,6,4,4 climb, one-way ledges, walls, bolt limits; every level parses; saves round-trip and replay identically |
| `tests/route.gd` + `tests/make_routes.sh` | a search over real inputs finishes every stage (hazards still kill), and the inputs are recorded |
| `godot/tests/replay_routes.gd` | the recorded routes still finish their stages |
| `--script=replay:<stage>:kb` and `:pad` | a stage finished from synthesized keyboard or gamepad events, through the input map, as a player's input would arrive |
| gamepad and keyboard menu scripts | title, new game, story, pause, items and options driven by pad buttons and keys |
| `godot/tests/playthrough.gd` | the whole game from New Game: the map walk and its gates, all six stages, both boss fights, the ending |
| `tests/verify_art.py`, `tests/verify_audio.py` | every asset matches its source and the palette; audio formats, levels and seamless loops |
| `tests/verify_export.py` | the exported build runs from a temporary folder and finishes stage 1 from gamepad events |

## Folders

```
docs/          ANALYSIS (the source), DESIGN (kept/adapted/dropped), PIPELINE
godot/         the Godot project; content/ holds the generated assets, text.json, levels, routes
pipeline/      manifest (the art contract), aseprite/, blender/, audio/
art/           aseprite/ sources and blender/ .blend files
tests/         run_all.sh, make_routes.sh, verify_*.py
tools/         mark_keep.py, contact_sheet.py
```
