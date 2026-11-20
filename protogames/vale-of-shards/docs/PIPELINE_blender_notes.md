# Blender art pipeline: notes

The Blender-sourced sprites (`bell sentry drone turret geode regent heartcrystal`) and
the backdrops (`bg_moss bg_mine bg_water bg_wood bg_ember bg_spire title`) are modelled
from primitives in code, rendered headless, and then locked to the 48-colour palette.

## Commands

```sh
python3 pipeline/blender/sprites.py [name ...]      # build/renders/<name>/<tag>_<i>.png, art/blender/<name>.blend
python3 pipeline/blender/backdrops.py [name ...]    # build/renders/bg_*/far.png, build/renders/title/scene.png, art/blender/<name>.blend
python3 pipeline/aseprite/import_renders.py [name ...]   # palette lock -> art/aseprite/<name>.aseprite
python3 pipeline/aseprite/export_art.py
python3 tests/verify_art.py
```

`bpy` 5.0.1 runs as a Python module (`python3`). Each script also runs inside a Blender
binary: `blender -b --factory-startup --python pipeline/blender/sprites.py -- bell`.
`pipeline/blender/kit.py` holds the shared helpers: palette materials, primitives, the
cameras, the toon render and the .blend save.

## How the sprites are made

- **One pixel density.** Every sprite is rendered at 24 px per metre
  (`kit.PX_PER_M`). The camera is orthographic, looks along +Y, and renders at exactly the
  manifest frame size. Models are written in pixel numbers through `kit.P()`/`kit.px()`.
  Each model leaves a 1 px margin inside its hitbox for the ink outline.
- **Two-pass toon render** (`kit.toon_render`). Both passes are Workbench with
  anti-aliasing off, `dither_intensity = 0` and the `Standard` view transform.
  1. The ID pass uses FLAT light and the material colours. Every pixel is exactly one
     palette colour.
  2. The light pass uses STUDIO light with one hard key light from the upper left. Every
     object is drawn white, and emissive parts are marked red.
  
  Each pixel then steps up or down its own colour ramp (`kit.SHADE_CHAINS`) according to
  how much light it gets. Lamps, lenses and glows keep their flat colour. The passes are
  kept in `build/renders/<name>/_passes/` for debugging.
- **Poses** are set in code for each frame (joint empties rotated), so no Actions are
  needed. `walk_l` renders the mirrored model (`scale.x = -1`), which keeps the cannon arm
  on the near side and the light on the upper left.
- **Import** (`import_renders.py`) thresholds alpha at 50%, snaps each pixel to
  `palette.nearest()`, adds a 1 px ink outline, then calls `save_sprite`.

## How the backdrops are made

- EEVEE renders through an orthographic camera at 12 px per metre, so 480 px = 40 m. A
  single shared surface material reads its colour from the object colour and its glow from
  the object property `emit`. Mist bands, light shafts and lamp halos are three soft
  transparent materials. The sky is an emission gradient plane, because an orthographic
  camera sees the world background as one flat colour.
- **Dim and low contrast.**
  - `fog()` pulls each colour towards the theme's haze according to its depth.
  - `grade()` then keeps 75–80% of the contrast around the haze, applies a gain, and caps
    the brightest channel.
  - Measured on the palette-locked results, with the tile sheets for comparison (mean
    luminance / std dev):

    | theme | backdrop | tiles |
    |---|---|---|
    | moss | 59 / 16 | 66 / 48 |
    | mine | 37 / 14 | 74 / 45 |
    | water | 55 / 21 | 72 / 49 |
    | wood | 58 / 13 | 76 / 48 |
    | ember | 33 / 15 | 65 / 50 |
    | spire | 44 / 16 | 68 / 56 |

  - In a mock-up with the tiles and the hero composited over each backdrop, all of them
    stand out.
- **Horizontal tiling.** Every object is copied to x ± 40 m (`tile_horizontally`), so
  column 479 continues into column 0. Measured on the raw renders, the mean colour
  difference across the seam is about the same as between any two neighbouring columns.
  One exception: an object whose edge falls exactly on the seam shows that edge there,
  which is correct.
- **Title** (320×180): a dusk gradient with three stars in the top 70 px and nothing else
  there, the glass spire on the horizon, the Vale's hills, a river, and a village with lit
  windows and street lamps.
- **Import.** Each pixel is ordered-dithered with a 4×4 Bayer matrix between two palette
  colours, in proportion to where the pixel lies between them. The two colours are the
  pair, among the pixel's 4 nearest palette colours, whose connecting line passes closest
  to the pixel. A small penalty (`PAIR_SPREAD`) favours pairs that are close together.
  There is no outline.

## Measured timings (bpy 5.0.1, Mesa llvmpipe, this container)

| step | time |
|---|---|
| `sprites.py`, all 7 sprites, 41 frames, 2 passes each | 3.1 s wall |
| `backdrops.py`, all 7 scenes | 5 min 22 s wall (moss 73 s, mine 62 s, water 13 s, wood 68 s, ember 54 s, spire 37 s, title 14 s) |
| first EEVEE render in a process (shader compile), 480×148 test scene | ~16 s, then ~2.5 s per render |
| `import_renders.py`, all 14 | 3.0 s |

Backdrop time grows with object count, because the tiling triples it. The moss scene has
about 100 fern fronds, for example.

## API problems met (Blender 5.0.1)

1. **`EGL Error (0x3009): EGL_BAD_MATCH`** is printed on every render. It is harmless once
   libegl1 and libgl1-mesa-dri are installed.
2. **Workbench studio lights are soft,** and a lit render snapped to the nearest palette
   colour drifts in hue: brass came out olive. The hard key light is the "Default" studio
   light, driven by `preferences.system.solid_lights`.
   - `read_factory_settings` resets the preferences, so `kit.workbench()` sets the light
     again after every reset.
   - Preferences are not stored in a .blend. Opening a saved sprite .blend in Blender
     shows your own solid lights, not the key light.
3. **EEVEE collection instances return the instancer's object colour** from the Object
   Info node. That colour is white, so every instanced copy rendered white.
   `tile_horizontally` therefore copies the objects themselves (`obj.copy()`, sharing mesh
   data).
4. **Boolean cutters and copies.** A copied wall keeps a modifier that points at the
   original cutters, so it would be cut in the wrong place. The aqueduct walls are
   evaluated with `bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))` and the
   cutters deleted before tiling.
5. **Materials and worlds get node trees by default in 5.0.** `World.use_nodes` raises a
   deprecation warning ("removed in Blender 6.0") and is not needed.
6. **`image_settings.media_type = 'IMAGE'` must be set before `file_format`** in 5.x.
   The call is guarded, so the scripts also run on 4.5.
7. The `engine` enum reached through `RenderSettings.bl_rna` listed only `BLENDER_EEVEE`
   here. `BLENDER_WORKBENCH` is still accepted and works.
8. **Pixel readback.** For an 8-bit PNG, `bpy.data.images.load(...).pixels` returns the
   file's sRGB bytes divided by 255, checked against PIL to be identical. `kit._read_png`
   and `kit.write_png` rely on this, so the toon composite and the grade need no PIL
   inside Blender.
9. **Dithering between the literal two nearest colours** often picked two colours on the
   same side of the pixel's colour. Sky gradients then collapsed into flat bands with
   orange blotches at the horizon. The bracketing pair described above fixed this.
10. Saving over an existing .blend leaves `.blend1` backups. `kit.save_blend` sets
    `preferences.filepaths.save_version = 0`.
