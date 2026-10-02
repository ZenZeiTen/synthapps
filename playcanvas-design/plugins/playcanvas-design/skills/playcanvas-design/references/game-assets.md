# Game-asset recipes

All commands assume `K=~/.claude/skills/playcanvas-design/scripts` and a copied template.

## 8-direction animated sprites from a GLB

```bash
cp -r ~/.claude/skills/playcanvas-design/templates/turntable work/tt && cp hero.glb work/tt/
node $K/render.mjs --root work/tt --page "index.html?model=hero.glb&dirs=8&fpd=6&animfps=12&elev=30" \
     --out work/hero_frames --width 256 --height 256 --frames 48 --alpha
python $K/review.py work/hero_frames --pick 0,6,12,18,24,30,36,42 --out work/hero_contact.png
python $K/spritesheet.py work/hero_frames work/hero_sheet.png --trim --names S,SW,W,NW,N,NE,E,SE --per-row 6
```

- **frames = dirs × fpd.** Direction i is yaw `yaw0 − i·360/dirs`, which is clockwise seen
  from above. With the camera on +Z, direction 0 shows the model's +Z face (glTF forward).
  If your model faces −Z, pass `yaw0=180`.
- **Direction names** (facing, from direction 0). The 4- and 8-direction orders were
  confirmed on rendered frames. The 16-direction order follows the same clockwise rule but
  has not been rendered:

  | dirs | `--names` |
  |---|---|
  | 4 | `S,W,N,E` |
  | 8 | `S,SW,W,NW,N,NE,E,SE` |
  | 16 | `S,SSW,SW,WSW,W,WNW,NW,NNW,N,NNE,NE,ENE,E,ESE,SE,SSE` |

  With fpd = 1, pass one name per frame and lay out with `--cols` (e.g. `--names S,W,N,E --cols 4`).
- **Fixed cell size** (e.g. 128 px cells). Render at 2× the cell, then
  `spritesheet.py --trim --cell 128x128 --fit`. `--trim` removes the empty margin left by
  bounding-sphere framing, and `--fit` scales every frame by one shared factor. Without
  `--fit`, an oversized frame stops the script instead of being cropped. Lower `pad` (e.g.
  1.0) to fill more of the cell. Bounding-sphere framing leaves room, because the model can
  turn in any direction.
- **Sampling.** Animation is sampled at `animfps` from t = 0: sample s is time s/animfps,
  wrapped by each clip's duration. Pick fpd = clipDuration × animfps for a seamless loop.
  Blender writes key times as frame/fps, so a clip "frames 1–24 at 24 fps" spans 0.0417–1.0 s.
- **Clips.** `clip=all` (the default) plays every clip together, each on its own anim layer.
  This is right for Blender's one-clip-per-object export. Use `clip=Walk` or `clip=2` for one
  action out of a character with several.
- **Constant scale.** Scale stays the same across directions because the camera frames the
  model's bounding sphere, not each view's box. `pad` adds margin. Ortho is the default; use
  `ortho=0&fov=30` for a perspective hero turntable.
- **Lighting.** Lights are fixed relative to the camera, so all directions are lit the same.
  That is the usual sprite convention.
- **Pixel art.** Render at the target cell size × 4, then
  `spritesheet.py --scale 0.25`, then quantize to a palette (a pixel-art tool's palette quantizer,
  or Pillow). Expect to hand-clean outlines; 3D-to-pixel never comes out perfect.
- **Using the sheet in PlayCanvas.**
  - Editor (verified 2026-10-02 up to stored asset data, not yet drawn in an Editor scene):
    1. `upload_assets {path, type:'textureatlas', name}`.
    2. `modify_sprite_asset {id: atlasId, props: {frames: <the "frames" object from
       hero_sheet.playcanvas.json>}}`.
    3. `create_assets [{type:'sprite', options:{name, textureAtlas: atlasId, frameKeys:['0','1',...], pixelsPerUnit, renderMode:0}}]`,
       one sprite asset per direction or clip.

    The Editor kept a non-power-of-two sheet at its size (1166×1738), so the rects stay valid.
    New atlases default to linear filtering without mipmaps. For pixel art, set
    `data.minfilter`/`data.magfilter` to `nearest` with `modify_assets`.
  - Code: the JSON holds arrays (the Editor asset format), but the runtime atlas needs
    vectors. Assigning `atlas.frames = json.frames` directly gives NaN bounds and a blank
    sprite (found by the test run). Convert first:
    ```js
    const atlas = new pc.TextureAtlas();
    atlas.texture = textureAsset.resource;
    atlas.frames = Object.fromEntries(Object.entries(json.frames).map(([k, f]) => [k, {
        rect: new pc.Vec4(...f.rect), pivot: new pc.Vec2(...f.pivot), border: new pc.Vec4(...f.border)
    }]));
    const sprite = new pc.Sprite(app.graphicsDevice, { atlas, frameKeys: Object.keys(atlas.frames),
        pixelsPerUnit: 100, renderMode: pc.SPRITE_RENDERMODE_SIMPLE });
    entity.addComponent('sprite', { type: 'simple', sprite, frame: 0 });
    ```
    For pixel art, set `textureAsset.resource.minFilter = magFilter = pc.FILTER_NEAREST`.

## Hero / product turntable video

```bash
node $K/render.mjs --root work/tt --page "index.html?model=product.glb&dirs=180&ortho=0&fov=30&elev=15" \
     --out work/turn --width 1920 --height 1080 --frames 180 --fps 30
python $K/encode.py work/turn work/turntable.mp4
```

180 directions at 30 fps is a 6 s revolution. The last frame is 2° short of the first, so it
loops seamlessly. For a background, render without `--alpha` (the template clears to dark
grey) or composite the alpha frames later.

## Icons and thumbnails

Use the turntable with `dirs=1&yaw0=35&elev=25&pad=1.05`, `--frames 1 --alpha`, at 512×512.
For an icon set, run once per model and batch the outputs with spritesheet.py `--cols N`. Keep
the same elev, yaw0 and pad across the set so icons line up.

## Trailer or gameplay capture from an Editor project

1. Build the shot in the Editor. Give the camera keyframe-animator with `lookAt`, or let a
   game camera follow.
2. `download_build` the scene (static), then unzip.
3. Write a hook that plays the input:
   ```js
   window.__renderHook = (k) => {
       if (k === 30) { __renderKey('down', 'w'); }
       if (k === 120) { __renderKey('up', 'w'); __renderKey('down', 'Space'); }
       if (k === 122) { __renderKey('up', 'Space'); }
   };
   ```
4. `render.mjs --root build --hook hook.js --fps 60 --duration 8 --width 1920 --height 1080`
5. Then run review.py and encode.py.

Input is frame-exact, so the take is repeatable; iterate on the hook, not on your reflexes.
Check scripts for frame-rate dependence (impulses applied without dt); see measured-facts #15.

## Exporting composed assets as GLB

Compose in the Editor (kitbash primitives, store/Sketchfab parts, materials) or in a code
scene, then export:
- Code scene: call the template's `exportGlb(group, 'prop.glb')` inside `buildScene()`
  before the timeline moves anything.
- Editor build: from a `--hook`, as below.

```js
const buf = await new pc.GltfExporter().build(pc.app.root.findByName('Prop'), { maxTextureSize: 1024 });
await __renderSave('prop.glb', buf);   // lands next to the frames
```

Verify by re-importing: Blender `import_scene.gltf`, then count meshes and materials and check
the names. Exported meshes keep the entity hierarchy and names. Primitive render components
export as real geometry.

## Blender → PlayCanvas

- Blender: `export_scene.gltf(export_format='GLB', export_animations=True)`.
- Editor: `upload_assets {path, type:'scene'}` creates a container, render and material assets.
  Code: `loadContainer('x.glb')`.
- Units: Blender metres become PlayCanvas units. Blender −Y forward becomes glTF +Z forward.
- For pixel-exact Blender rendering instead, see the separate Blender notes; this skill renders
  in PlayCanvas so the result matches what the game shows.
