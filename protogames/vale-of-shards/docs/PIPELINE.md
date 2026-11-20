# Asset and level pipeline

Scripts make every pixel, sound and route in the game. They write into `godot/content/`,
which the game loads raw at runtime. The only hand-edited files in `godot/content/` are
these:

- `data/text.json` (all in-game text);
- `levels/*.txt` (the stage and map files, see `scripts/core/level.gd`).

```
pipeline/manifest.py              the art contract: every sprite's size, origin, tags, source
                                    (writes pipeline/manifest.json and godot/content/data/manifest.json)
pipeline/aseprite/art_*.py        pixel art drawn in code ─> art/aseprite/*.aseprite
   └─ build_art.py                  runs them all
pipeline/blender/sprites.py       bell, sentry, drone, turret, geode, regent, heart crystal
pipeline/blender/backdrops.py     six parallax backdrops, the title scene (dusk) and the ending's dawn scene
   └─ build/renders/…  ─> pipeline/aseprite/import_renders.py (palette lock) ─> art/aseprite/*.aseprite
pipeline/aseprite/export_art.py   every .aseprite ─> godot/content/{sprites,tiles}/*.png (+ .json)
pipeline/audio/make_sfx.py        ─> godot/content/sfx/*.wav   (53 effects)
pipeline/audio/make_music.py      ─> godot/content/music/*.ogg (10 tracks)
tests/make_routes.sh              the route checker ─> godot/content/routes/*.json
tools/mark_keep.py                .import sidecars (importer="keep") so exports carry files as-is
```

## Rebuilding

Run from `vale-of-shards/`, in this order:

```bash
python3 pipeline/manifest.py
python3 pipeline/aseprite/build_art.py
python3 pipeline/blender/sprites.py
python3 pipeline/blender/backdrops.py      # about 5 minutes
python3 pipeline/aseprite/import_renders.py
python3 pipeline/aseprite/export_art.py
python3 pipeline/audio/make_sfx.py
python3 pipeline/audio/make_music.py
python3 tools/mark_keep.py
bash tests/make_routes.sh                  # after any change to a level or to the rules
```

Setup notes:
- **Python packages:** Pillow, numpy, soundfile and `bpy` 5.0 (`pip install bpy`,
  Python 3.11).
- **Blender:** the Blender scripts also run inside Blender
  (`blender -b --factory-startup --python pipeline/blender/sprites.py -- bell`). With the
  Blender MCP connected, run the same scripts in the live session.
- **Aseprite:** this machine had neither Aseprite nor its MCP server, so
  `pipeline/aseprite/asefile.py` reads and writes the `.aseprite` format directly, as in
  Gates Below. `export_art.py` builds the PNGs by reading the `.aseprite` files, so an edit
  made in Aseprite is what ships. `tests/verify_art.py` compares every export with its
  source, pixel for pixel.

`docs/PIPELINE_blender_notes.md` has the Blender details: the two-pass toon render,
backdrop tiling and dimming, measured timings, and the Blender 5 API problems met.

## Art rules

- **48 colours** (`pipeline/aseprite/palette.py`) in hue-shifted ramps. Every exported
  pixel is on the palette and fully opaque or fully clear. `verify_art.py` checks this.
- **Sprites** are horizontal strips. Their JSON gives the frame size, the origin (the
  offset from the object's hitbox to the frame) and the tags.
  - The hitbox sizes are the source's (`INCLUDE/X_OBJ.DEF`), so a sprite never changes
    the rules.
  - The hero is a 24×40 hitbox in a 32×48 frame.
- **Tile sheets** are 16×6 slots of 16 px (`SIDE_LAYOUT`, `MAP_LAYOUT` in the manifest).
  The view autotiles solid ground, back walls, ledges and the map's path, water, forest and
  rock by their four neighbours.
- **HUD slots** are in `pipeline/aseprite/art_ui.py HUD_SLOTS`, and `scripts/view/ui.gd`
  follows them.

## Levels

`godot/content/levels/<name>.txt` has three parts:
- a header;
- an ASCII map, with one character per 16 px cell (`scripts/core/level.gd TILE_CHARS`);
- a legend that turns marker characters into objects with parameters.

For example:

```
K key color=amber
D door color=amber channel=2
Y platform xd=2
```

A marker's cell takes the tile of its passable neighbour, or the tile named with
`on=<char>`. Objects sit on their cell's floor unless given `align=top`.

The header's `route:` line lists the goals the route checker must reach in order (see
`tests/route.gd`). `tests/make_routes.sh` records a route for each stage. The playthrough,
the replay tests and the attract-mode demo all use those recordings.

## Measured facts

| # | fact | what the project does |
|---|---|---|
| G1 | GDScript's `:=` cannot infer a type from an untyped expression (`o.x`, `arr[i]`). Such lines fail to parse | the code uses `var x: int = ...` there |
| G2 | a script named `Font` shadows the engine class | the pixel font is `PixFont` |
| G3 | a method named `log()` shadows the math function and fails to parse when called with a String | the router uses `say()` |
| G4 | a SceneTree script whose `_init` errors never quits | every Godot run in `tests/run_all.sh` has a `timeout` |
| G5 | packed arrays are shared on assignment in GDScript (not copy-on-write between variables) | `game.gd clone()` shares the board and copies it on the first write (`board_owned`) |
| G6 | `Input.parse_input_event` plus `flush_buffered_events` updates action states at once, headless too | the harness drives the game through synthesized key and joypad events |
| G7 | `AudioStreamOggVorbis.load_from_file` and `AudioStreamWAV.load_from_file` read raw files that the `keep` importer packs | music and effects load the same way in the editor and in exports |
| R1 | best-first search with per-step inputs finds a stage route in 1 to 150 s with dense waypoints. Without waypoints, a vine 50 cells away took 58,000 expansions | levels list waypoints; moving planks use `ride` and `until:` |
