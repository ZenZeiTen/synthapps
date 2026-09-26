# HD-2D art production

How to make sprites and environments that survive being lit in 3D. Pixel-art technique in
general (palettes, ramps, animation in Aseprite) belongs to `aseprite-pixel-forge`; 3D
models, kits and pre-rendered sprites belong to `blender-game-asset-forge`. This file covers
what is different when the art is lit by a real 3D renderer.

Labels: **Fact**, **Inference**, **Heuristic**, as in `rendering-pipeline.md`.

## Contents

1. The sprite sheet contract
2. Direction counts
3. Painting for dynamic light
4. Normal maps
5. Silhouette and outline rules
6. Building the environment
7. Checklist before art goes into the engine

---

## 1. The sprite sheet contract

Agree these before the first frame is drawn. Changing any of them later means re-exporting
every sheet.

| Term | Rule |
|---|---|
| Frame size | One size per character class (for example 32 × 48 texels), set from `sprite_h` (dial 2) plus headroom for weapons and hair |
| Grid | Frames on a fixed grid, no packing, no trimming. Row = direction or action, column = frame. Record the layout next to the sheet |
| Pivot | Feet at the bottom centre of the frame, on the same pixel row in every frame. The engine pivot sits there |
| Padding | Transparent columns inside the frame, not between frames. Frames touch; the grid does the separation |
| Alpha | Two values only: 0 and 255. No soft edges, no semi-transparent pixels |
| Colour | Authored in sRGB, in the project palette. No baked drop shadows |
| Companion maps | A normal sheet with exactly the same grid, frame for frame (and an emissive sheet if needed) |
| Naming | `<character>_<action>.png`, `<character>_<action>_n.png` for normals |

Why no trimming: a trimmed sheet stores per-frame offsets that the engine must re-apply, and
a missed offset makes sprites jitter. With a fixed grid and a fixed pivot, frames line up by
construction. (`aseprite-pixel-forge` covers trimmed export when atlas space really matters.)

Why no soft alpha: alpha-tested sprites cut at one threshold. Anti-aliased edge pixels are
either dropped (the edge looks nibbled) or kept at full opacity (the edge gets a dark or
light halo). The sprite also stops casting a clean shadow.

## 2. Direction counts

| Directions | Cost | Use |
|---|---|---|
| 1 (always faces camera) | Lowest | Props, NPCs that do not walk, many enemies |
| 2 (left/right, one mirrored) | Low | Side-on movement; classic battle sprites |
| 4 (down, up, left, right mirrored) | Medium | Town and field characters with a fixed camera yaw |
| 8 | High: roughly twice the frames of 4 | A camera that rotates freely around the character |

The direction count follows the **camera**, not the character. If the camera yaw is fixed
(most HD-2D exploration), 4 directions chosen from movement direction relative to the camera
is enough. If the camera orbits, pick the frame from the angle between the character's facing
and the camera, and budget for 8.

**Heuristic:** mirroring left/right halves the cost but flips lighting painted into the
sprite. Keep painted light neutral (next section) and mirroring stays invisible.

## 3. Painting for dynamic light

In a flat 2D game, the artist paints the light. In HD-2D, the renderer lights the sprite, so
painted light fights the real light whenever they disagree.

- **Paint form, not direction.** Shade for shape (ambient occlusion in folds, darker
  underside of the chin and arms) and keep strong directional highlights out. A sprite
  painted lit from the top left looks wrong the moment a torch is on its right.
- **Keep the value range in the middle.** Leave room above for lights to brighten and below
  for shadows to darken. Pure black and near-white pixels do not respond to light.
- **Limit hue shifts in ramps.** Strong hue-shifted ramps (warm light, cool shadow) are
  classic pixel-art technique, but the renderer adds its own coloured light. **Heuristic:**
  use gentler shifts than in unlit pixel art and let the lighting supply the temperature.
- **Emissive parts are separate.** Eyes, lanterns and magic that glow belong in an emissive
  map (or an emissive colour on a second quad), not painted as bright pixels. Only real
  emissive values above 1.0 in HDR reach the bloom threshold.
- **Environment art follows the same rules**: form shading only, no painted cast shadows;
  the renderer casts them.

## 4. Normal maps

Every lit sprite needs one. Choose how to make it:

| Method | Quality | Cost | Use |
|---|---|---|---|
| Generated from alpha and luminance (`scripts/sprite_normalmap.py`) | Rounded cushion plus light relief | Seconds per sheet | Default for every character and prop |
| Generated, then hand-corrected | Good | Minutes per frame | Hero characters, faces, capes |
| Hand-painted | Best, fully art-directed | Hours per sheet | Key art sprites, large bosses |
| Rendered from a 3D model (Blender) | Accurate | Needs the model | Pre-rendered sprites (`blender-game-asset-forge`) |

Using the bundled script:

```bash
python scripts/sprite_normalmap.py hero_walk.png hero_walk_n.png --frame 32x48 --bevel 2
python scripts/sprite_normalmap.py hero_walk.png hero_walk_n_dx.png --frame 32x48 --flip-green  # Unreal
```

- `--frame` bevels each frame on its own, so neighbouring frames never lean on each other.
- `--bevel` is the rim width in texels; 2-3 suits 32-64 texel characters.
- `--luma` lifts bright painted pixels slightly; lower it for noisy textures.
- Transparent pixels get a flat normal and keep their alpha, so the alpha test cuts both
  maps identically.

Hand-painting conventions: red = right, green = up (OpenGL), blue = toward the viewer.
Paint the flat-facing plateau as (128, 128, 255). Keep normals unit length; most editors
have a "normalize" filter. Mark the texture as a normal map / linear data in the engine.

## 5. Silhouette and outline rules

- **Readable at 1×.** Check every frame at the final on-screen size, in the lit scene, not
  on a white canvas. Density-contract sprites are small; a silhouette that relies on
  interior detail disappears.
- **Outlines are lit too.** A pure black 1-texel outline does not respond to light and reads
  as a sticker edge in bright scenes. **Heuristic:** use a dark, saturated version of the
  adjacent colour (selective outline), or no outline on the lit side.
- **Hard alpha, clean corners.** The alpha threshold defines the shadow shape too; stray
  single transparent pixels inside a body become pinholes of light in the shadow.
- **Feet are the contact point.** The lowest opaque row is where the blob decal and contact
  shadow meet the sprite; keep it on the pivot row in every frame, including jump frames
  (move the whole sprite for a jump, not the feet within the frame).

## 6. Building the environment

The environment is **real 3D geometry with pixel-art textures**, not a painted backdrop.

- **Texel density at `env_ratio`.** With `texel = 1/32` and `env_ratio = 2`, environment
  textures carry 64 texels per world unit on every visible face. Set UVs so every face hits
  that density; mixed densities are the "smoother than its neighbour" defect.
- **Modular kits on the grid.** Wall, floor, stair and roof pieces sized in whole texels of
  the environment grid, so textures line up across pieces.
- **Trim sheets and tiling.** Reuse a few pixel-art trim sheets for edges and mouldings;
  tile floors and walls with nearest filtering and no rotation of the pixel grid.
- **Geometry does the silhouettes, texture does the detail.** Model what changes the
  outline or casts a shadow (eaves, steps, barrels). Paint what does not (bricks, planks).
- **Normal maps for environment textures** are optional; the geometry already has real
  normals. Use them for large surfaces where relief should catch moving lights.
- **Lights live in the kit.** Lanterns, braziers and windows carry their point lights and
  emissive textures, so every placement brings its light with it (and counts against the
  `lights` budget).

## 7. Checklist before art goes into the engine

- [ ] Frame size, grid, pivot row and direction layout recorded next to the sheet
- [ ] Alpha is 0 or 255 only
- [ ] No painted directional light or cast shadows
- [ ] Normal sheet made with the same grid (`--frame`), convention matches the engine
- [ ] Emissive parts separate
- [ ] Every frame checked at 1× inside a lit test scene
- [ ] Environment UVs at `env_ratio` × sprite density, nearest filtering, sprites without mipmaps
