# Tidebell: how everything is made

Every asset is built by a script from this folder, so any of it can be changed and built
again. The order below is the order to run them in. All commands run from `tidebell/`.

```
content/ (hand-edited)  ──sync_content.py──►  godot/content/, web/public/content/
pipeline/aseprite/art_*.py  ──►  art/aseprite/*.aseprite  ──export_art.py──►  sprites, tiles, backdrops, stills
pipeline/blender/*.py       ──►  build/renders/*.png  ──import_renders.py──►  art/aseprite/  (then export)
                            └─►  web/public/content/models/<theme>_mid.glb  (three.js)
pipeline/reality/*.real     ──►  build/renders/still_*.png  ──import_renders.py──►  art/aseprite/
pipeline/audio/*.py         ──►  content/music/*.ogg, content/sfx/*.wav  (both builds)
content/levels + the core   ──tests/make_routes.sh──►  content/routes/*.json
```

## 1. The contract: `pipeline/aseprite/manifest.py`

Every sprite's size, origin (the point placed on the object's feet), source and animation
tags. The drawing scripts assert against it, `export_art.py` writes
`content/data/manifest.json` from it, and both builds read that file to cut the strips.

## 2. Palette: `pipeline/aseprite/palette.py`

48 colours, each one of the Genesis's 512 (3 bits per channel, on the hardware's
non-linear level ladder). Every exported pixel must be in it; `tests/verify_art.py` checks.

## 3. Aseprite: sprites, tiles, portraits, font

```bash
bash pipeline/build_art.sh
```

This runs `art_people.py` (the three wardens and the people, drawn as a jointed puppet by
`puppet.py`), `art_creatures.py` (enemies and guardians), `art_tiles.py` (six tile sets) and
`art_ui.py` (HUD, windows, portraits, the font from `font_data.py`), then `export_art.py`.

- No Aseprite binary or MCP server was available, so `asefile.py` writes and reads the
  `.aseprite` format directly (indexed colour, one layer, tags). The files open in
  Aseprite, and an edit made there ships: `export_art.py` reads the `.aseprite` files, not
  the drawing code.
- With Aseprite installed, the same strip comes from
  `aseprite -b art/aseprite/kess.aseprite --sheet kess.png --sheet-type horizontal`.

## 4. Blender: backdrops, the Silt King, the bell

```bash
python3 pipeline/blender/backdrops.py            # all six themes (bpy as a Python module)
python3 pipeline/blender/sprites.py              # siltking, bell
python3 pipeline/aseprite/import_renders.py      # renders → palette → .aseprite
python3 pipeline/aseprite/export_art.py
```

- The scripts build every model from primitives and render with Cycles on the CPU. Each
  stage has a far layer (sky, distant shapes) and a mid layer (nearer silhouettes), 640×224
  and seamless sideways. `import_renders.py` reduces them to the palette with a 4×4 ordered
  dither and pushes the mid layer darker and bluer, so it never reads as a platform.
- `backdrops.py` also exports each mid scene as glTF (`web/public/content/models/`). The
  browser build shows it as real 3D, lit in three toon bands, behind the 2D layer.
- The `.blend` files are saved in `art/blender/`.
- The Blender MCP connector was not connected in this session. The scripts run the same way
  inside Blender (`blender -b --factory-startup --python pipeline/blender/backdrops.py --
  reach`) or through the MCP.

## 5. reality.js: the painted stills

The title, the Saltmarch map and the dawn of the ending are path-traced from
`pipeline/reality/{title,map,dawn}.real`. reality.js serves scenes only from inside its own
folder, so copy them there and render:

```bash
R=/path/to/synthapps/reality-js
mkdir -p $R/scenes/tidebell && cp pipeline/reality/*.real $R/scenes/tidebell/
(cd $R && for s in title map dawn; do
  node tools/render.mjs scenes/tidebell/$s.real -o "$OLDPWD/build/renders/still_$s.png"; done)
python3 pipeline/aseprite/import_renders.py && python3 pipeline/aseprite/export_art.py
```

Each scene sets its own render size and quality (320×224, 48 samples), so no flags are
needed. The renders are reduced to the palette like the Blender ones.

## 6. Audio

```bash
python3 pipeline/audio/make_music.py      # 13 tracks, Vorbis stereo 32 kHz
python3 pipeline/audio/make_sfx.py        # 34 effects, 16-bit mono 22 kHz
python3 tests/verify_audio.py
```

`synth.py` is the FM and pulse engine shared with Vale of Shards, plus a "harmonic" voice
for the bells. All music is original; the theme and the bell figure are described at the
top of `make_music.py`. Watch the size: the Windows 7z must stay under 30 MiB.

## 7. Levels and routes

- A level is a text grid in `content/levels/<stage>.txt`: a header (name, music, theme,
  chests, captives, guardian, talk, and `route:` waypoints for the long stages), a legend,
  then the rows. `level.gd`/`level.js` parse it; `tests/verify_content.py` checks it.
- After any level or rules change: `bash tests/make_routes.sh [stage...]`. It runs the
  beam search in `godot/tests/router.gd` over real inputs and writes
  `content/routes/<stage>.json`. `replay_routes.gd` and every `replay:` check use them.

## 8. The builds

| build | command |
|---|---|
| Godot, from the editor | open `godot/project.godot` (Godot 4.7) |
| Windows and Linux, checked and packed | `python3 tests/verify_export.py` |
| browser | `cd web && npm install && node tools/build.mjs` → `web/dist/` |

The browser build copies only the parts of three.js it uses into `web/dist/vendor/`, so
the folder runs offline from any static web server.

### The browser renderer (`web/src/view/render3d.js`)

The constraint budget, held for every layer:

| dial | value |
|---|---|
| resolution | 320×224 (the Genesis's H40 screen), nearest upscale at an integer scale, letterboxed |
| colour | the game's 48 colours, snapped per virtual pixel with a 4×4 ordered dither, before the upscale |
| vertices | subpixel (no snapping; the Genesis drew no polygons) |
| surfaces | nearest filtering |
| light | the 3D mid layer in 3 toon bands; the 2D layer unlit |
| signal | none |

Each frame: the far backdrop on a plane, the stage's glTF scene (three copies side by side
so it repeats) with a perspective camera that follows the play camera at the layer's
parallax, then the 2D layer (a canvas texture on an orthographic quad), all into one
320×224 target; then the palette pass to the screen.
