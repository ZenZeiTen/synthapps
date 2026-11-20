# Asset pipeline

Every pixel, model and sound in the game is made by the scripts below. They write into `godot/content/`, which the game loads raw at runtime. Nothing in `godot/content/` except `data/` and `levels/` is edited by hand.

```
pipeline/aseprite/art_*.py      pixel art drawn in code (textures, items, portraits, UI)
   └─ build_art.py ──────────> art/aseprite/*.aseprite            editable sources
pipeline/blender/sprites.py     monsters and NPCs from primitives (Blender, Workbench)
   └─────────────────────────> build/renders/<name>/*.png         raw frames
                               art/blender/sprites_<name>.blend   posed models
pipeline/aseprite/import_renders.py  palette lock + outline ─> art/aseprite/mob_*.aseprite
pipeline/aseprite/export_art.py  every .aseprite ─> godot/content/{textures,items,portraits,ui,sprites}/*.png (+ .json)
pipeline/blender/props.py       level kit ─> godot/content/models/*.glb, art/blender/kit.blend
pipeline/audio/make_sfx.py      ─> godot/content/sfx/*.wav   (35 effects)
pipeline/audio/make_music.py    ─> godot/content/music/*.wav (5 loops)
tools/mark_keep.py              .import sidecars (importer="keep") so exports carry the files as-is
```

## Rebuilding

Run from `gates-below/`. Art comes first, because the Blender kit samples the exported textures.

```bash
python3 pipeline/aseprite/build_art.py
```

```bash
python3 pipeline/blender/sprites.py
```

```bash
python3 pipeline/aseprite/import_renders.py
```

```bash
python3 pipeline/aseprite/export_art.py
```

```bash
python3 pipeline/blender/props.py
```

```bash
python3 pipeline/audio/make_sfx.py
```

```bash
python3 pipeline/audio/make_music.py
```

```bash
python3 tools/mark_keep.py
```

The Blender scripts run under `bpy` 4.5 as a Python module (`pip install bpy==4.5.0`, Python 3.11). The same scripts run inside Blender too:

```bash
blender -b --factory-startup --python pipeline/blender/sprites.py -- rat wisp
```

With the Blender MCP connected, `exec` the script in the live session instead.

## Aseprite without Aseprite

This machine had neither Aseprite nor its MCP server. `pipeline/aseprite/asefile.py` therefore reads and writes the `.aseprite` format directly, following Aseprite's published spec (`docs/ase-file-specs.md` in the aseprite repository). It writes:
- an RGBA header;
- an sRGB colour-profile chunk;
- a palette chunk holding the game's 32 colours;
- one layer;
- zlib-compressed image cels;
- animation tags.

Checks:
- **A1.** `ase-parser` (npm), an independent reader, parsed a written file back with the same size, frames, layer, tag and cel bytes (measured 2026-09-26).
- **A2.** `export_art.py` builds the game's PNGs by *reading* the `.aseprite` files, never from the drawing code. An edit made in Aseprite therefore ships.

  `tests/verify_art.py` compares every PNG with its source, pixel for pixel. With Aseprite installed, this is the equivalent export:

  ```bash
  aseprite -b art/aseprite/mob_rat.aseprite --sheet rat.png --data rat.json --format json-array --sheet-type horizontal --list-tags
  ```

The creation disc (`ui/disc`, 171 px, usable radius 75 as in the original) is drawn in `art_ui.py`. It has eight dithered wedges tinted by each profile's strong stats (red STR, blue MAG, green DEX, gold MOB), fading to plain stone at the balanced centre.

The palette (`pipeline/aseprite/palette.py`) has 32 colours in hue-shifted ramps. Darks lean violet and lights lean warm. The ramps are stone, wood, skin, moss, water/cold and blood/fire, plus gold.

## Monster sprites: Blender to Aseprite

1. `sprites.py` builds each creature from primitives. Humanoids get a jointed rig of empties, so a pose is just joint rotations.
2. It renders nine frames per monster: idle ×2, attack ×2, hurt, side walk ×2 and back walk ×2. NPCs get two idle frames.
3. The camera is orthographic, with Workbench studio light and anti-aliasing off. Density is **25 px/m for the whole cast**: normal canvases are 56 px, big ones (the Warden) 80 px.
4. Quadrupeds read badly head-on, so the rat's front frames are a three-quarter view.
5. `import_renders.py`:
   1. thresholds alpha at 50%;
   2. snaps every colour to the nearest palette entry (red-mean weighted RGB, no dithering);
   3. adds a 1-px outline in the near-black violet, outside the silhouette;
   4. writes a tagged `.aseprite` file.

The game picks the front, side (mirrored as needed) or back frames from the monster's facing relative to the camera.

## Measured facts

| # | fact | what the code does |
|---|---|---|
| B1 | `bpy` 4.5 renders headless once `libEGL.so.1`/`libGL` exist (Mesa llvmpipe). Without them it aborts with "Couldn't open libEGL.so.1" | install `libegl1 libgl1-mesa-dri` on a bare machine |
| B2 | Workbench renders a 56 px frame in well under a second. EEVEE's first render compiles shaders (~35 s) | sprites use Workbench |
| B3 | render anti-aliasing blends edge colours, which the palette lock turns into noise | `display.render_aa = 'OFF'` |
| B4 | glTF export keeps `Closest` image interpolation as a NEAREST sampler (magFilter 9728) | kit textures stay crisp in Godot |
| G1 | GDScript's `:=` cannot infer a type from an untyped expression (`lv.w`, `DX[d]`) and fails to parse | core modules use plain `var x = ...`, or explicit types |
| G2 | `Image.load_from_file` on a `res://` PNG warns that it "will not work on export" | textures are read as bytes (`FileAccess`) and decoded with `load_png_from_buffer`; the `keep` importer packs the raw PNG |
| G3 | `JSON.parse_string` returns every number as a float, so a JSON save does not round-trip exactly | saves use `var_to_str` / `str_to_var`, and the test compares the round trip byte for byte |
| G4 | the exported Linux build (Compatibility renderer) runs under Xvfb with Mesa and renders the same frame as the editor run | `tests/verify_export.py` |
