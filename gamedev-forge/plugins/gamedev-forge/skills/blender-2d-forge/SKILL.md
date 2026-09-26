---
name: blender-2d-forge
description: Build flat 2D animation, cartoons, and explainer video in Blender 4.4+/5.x through the Blender MCP connector. Covers procedural vector artwork, keyframe animation, orthographic staging, pixel-probe verification, and a handoff that opens correctly on the user's machine. Carries the Blender 5.x API landmines that break naive code, including Grease Pencil v3 fills that will not render, slotted Actions that removed action.fcurves, video output gated behind media_type, and sRGB pixel readback. ALWAYS trigger when the user wants a 2D animation, cartoon, explainer, or motion graphic in Blender; when driving Blender through MCP for anything visual; when Grease Pencil fills render black or transparent; when keyframe interpolation silently fails; when FFMPEG is rejected as a file_format; or on "bikin animasi 2D di Blender", "buat kartun pakai Blender", "animate this in Blender", "my Blender render looks wrong". Prefer this over generic 3D or video skills whenever the output is flat 2D rendered from Blender.
---

# Blender 2D Forge

Producing 2D animation in Blender through an MCP connector is not the same job as
modelling in Blender by hand. You cannot see the viewport. You cannot scrub the
timeline. You get one channel — Python in, JSON out — and every assumption you
carry from training data about the Grease Pencil API is probably wrong for the
version actually running.

This skill exists because a full 78-second children's animation was built, verified
numerically, declared finished, and then opened by the user into a viewport showing
mirrored text and flat slivers. The artwork was perfect. The handoff was not.

Read `references/api-landmines.md` before writing any Blender Python. It will save
you an hour of debugging that has already been done.

## Order of operations

Do these in order. Each step depends on the one before it, and skipping the
reconnaissance step is how people end up writing code for an API that isn't there.

### 0. Reconnaissance — always first

Never assume the Blender version or the API surface. Query it:

```python
import bpy
result = {
    "version": bpy.app.version_string,
    "engines": [e.bl_idname for e in bpy.types.RenderEngine.__subclasses__()
                if hasattr(e, "bl_idname")],       # HydraRenderEngine has none
    "workspaces": [w.name for w in bpy.data.workspaces],
    "scenes": {s.name: len(s.objects) for s in bpy.data.scenes},
    "tempdir": bpy.app.tempdir,
}
```

Two things in that result matter more than they look:

**`workspaces`** tells you what UI the file opens into. If it says `2D Animation`
or anything other than a normal Layout, the file came from a template and you must
fix it before handoff. See step 6.

**`version`** decides which animation API you use. 4.4 and later use slotted
Actions; `action.fcurves` no longer exists.

### 1. Establish the scene contract

Lock these before building anything, because every asset coordinate depends on them.

```python
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.fps = 24
sc.frame_start, sc.frame_end = 1, total_frames
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"   # critical for flat colour
cam.data.type = "ORTHO"
cam.data.ortho_scale = 16.0                    # world x spans [-8, 8]
cam.location = (0, 0, 20)                      # looking straight down -Z
cam.rotation_euler = (0, 0, 0)
```

`view_transform = "Standard"` is not optional. Under the default Filmic or AgX,
`#FF6B6B` renders as something else entirely and every colour check you run later
will be wrong.

The orthographic camera at +Z looking down −Z means **all artwork lives in the XY
plane**. Write that down; it is what makes the viewport trap in step 6 possible.

Derive the visible bounds from `ortho_scale` and stage everything inside them:

```
half_width  = ortho_scale / 2
half_height = half_width * (res_y / res_x)
```

### 2. Build artwork as flat mesh with emission shaders

**Do not use Grease Pencil in Blender 5.x.** GP v3 fills do not render at usable
opacity through any material configuration reachable from Python. Strokes render
correctly; fills reach roughly 4% alpha at best. The full test matrix and diagnosis
is in `references/api-landmines.md`.

Use flat polygons with Emission shaders instead. Same flat vector look, guaranteed
opaque, exact colour control, and it renders fast because there is nothing to light.

`scripts/art2d.py` gives you the whole layer: an sRGB→linear converter, a named
palette, an `emat()` emission material builder, an `Art` accumulator class that
bakes many coloured polygons into one mesh object, and shape generators
(`circle`, `ellipse`, `rect`, `rrect`, `arc`, `wedge`, `tri`, `star`, `blob`,
`drop`, `bubble_ring`).

Typical asset:

```python
a = Art("PR_TrashCan", coll="Props", z=0.0)
a.fill(rrect(0, 0, 1.6, 2.0, 0.25), "bin")
a.fill(rect(0, 1.1, 1.9, 0.28), "bin2")
a.line(arc(0, 0.2, 0.5, 200, 340), 0.08, "white")
can = a.build()
```

One `Art` per logical object. One mesh per object. Per-polygon material indices
keep the polygon count low — a full 7-scene production came in at 453 polygons.

Store the library inside the .blend as a text datablock so the user can edit and
re-run it without you:

```python
t = bpy.data.texts.new("art2d.py")
t.write(source)
```

**Character rigs**: parent parts to an Empty. Put the head's origin at the neck and
each arm's origin at the shoulder, so rotation reads as a real joint. Keep the
Empty as the only thing you move and scale for staging.

### 3. Animate

Use `scripts/anim2d.py`. It handles the slotted-Action API correctly, which naive
code does not.

Core helpers: `K` (keyframe with interpolation control), `show` / `showg`
(visibility with constant interpolation), `pop` / `unpop` (squash-and-stretch
entrance and exit), `bob`, `swing`, `hold_rot` / `hold_loc` / `hold_scale`,
`cam_cut` / `cam_drift`, `caption`, `sparkle`.

**Visibility is how you cut between scenes.** There is no editor timeline here.
Key `hide_viewport` and `hide_render` together with CONSTANT interpolation, one
frame before the object appears and one frame after it leaves.

**Camera cuts** need a CONSTANT-interpolated key on the frame before the cut, then
the new value on the cut frame. Without the leading key the camera slides between
scenes instead of cutting.

**Rebuild visibility, never patch it.** Adjacent-frame keys collide and produce
objects that flicker or never appear. If you change a scene's frame range, delete
the object's visibility F-curves and re-key from scratch.

### 4. Verify with pixel probes

You cannot see the render. Numeric verification is the only ground truth available,
and it catches more than you would expect: missing objects, wrong positions,
occlusion, and colour errors.

`scripts/verify2d.py` gives you two functions:

- `probe({"label": (world_x, world_y)}, frame=N)` — samples exact world coordinates,
  honouring the animated camera transform and `ortho_scale`, returns hex per label.
- `verify(frame=N, cols=13, rows=8)` — returns a hex grid across the whole frame.

Both temporarily swap the output format to PNG, because **Blender refuses a
single-frame render while the output is configured for video**, then restore it.

Read the grid like a low-resolution picture of your own composition. A row of
`#9BDBF5` is sky. A block of `#7ED957` is grass. If the row where a character's
legs should be reads as caption-band colour, the band is covering them.

Probe at least one frame per scene, plus any frame where two elements might overlap.

**What this cannot tell you**: whether the artwork is any good. Say so explicitly
when you report. Numeric verification proves structure, not appeal.

### 5. Render

Video output is gated behind `media_type`. Set it first or the enum assignment fails:

```python
R.image_settings.media_type = "VIDEO"      # must come first
R.image_settings.file_format = "FFMPEG"
R.ffmpeg.format = "MPEG4"
R.ffmpeg.codec = "H264"
R.ffmpeg.constant_rate_factor = "MEDIUM"
R.ffmpeg.ffmpeg_preset = "GOOD"
R.ffmpeg.audio_codec = "AAC"
```

Launch the animation without blocking the MCP call:

```python
bpy.ops.render.render('INVOKE_DEFAULT', animation=True)
```

A blocking `bpy.ops.render.render(animation=True)` can hold the MCP connection open
for minutes and time out. `INVOKE_DEFAULT` returns immediately and renders in the
background.

Confirm completion by loading the result back and reading its real frame count:

```python
mc = bpy.data.movieclips.load(path)
frames, size = mc.frame_duration, (mc.size[0], mc.size[1])
bpy.data.movieclips.remove(mc)
```

File size alone proves nothing. Frame count does.

### 6. Fix the handoff before you declare victory

**This is the step that gets skipped, and it is the one the user actually sees.**

A .blend created from a template keeps that template's workspaces. The 2D Animation
template opens into a near-edge-on front view. Flat XY artwork viewed from the front
collapses into thin horizontal slivers and text reads mirrored. The scene is fine.
The render is fine. The user opens the file and sees garbage.

Run this before every handoff:

```python
for w in bpy.data.workspaces:
    try: w.object_mode = 'OBJECT'
    except Exception: pass
    for screen in w.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                for sp in area.spaces:
                    if sp.type != 'VIEW_3D': continue
                    sp.region_3d.view_perspective = 'CAMERA'
                    sp.region_3d.view_camera_zoom = 0.0
                    sp.region_3d.view_camera_offset = (0.0, 0.0)
                    sp.shading.type = 'RENDERED'
                    sp.overlay.show_floor = False
                    sp.overlay.show_axis_x = False
                    sp.overlay.show_axis_y = False
                    sp.overlay.show_cursor = False
            elif area.type == 'DOPESHEET_EDITOR':
                for sp in area.spaces:
                    if sp.type == 'DOPESHEET_EDITOR':
                        try: sp.mode = 'DOPESHEET'
                        except Exception: pass
```

Rename template workspaces to something honest (`2D Animation` → `Layout`), reset
`frame_current` to 1, drop obsolete text datablocks, purge orphans, and save.

Then render a contact sheet — one PNG per scene into a `storyboard/` folder — so the
user can judge the result without opening Blender at all. Present those files.

The full checklist is in `references/handoff-checklist.md`.

## Failure log

Every row here cost real debugging time. Check this table before inventing a theory.

| Symptom | Cause | Fix |
|---|---|---|
| Viewport shows flat slivers, text mirrored or upside down | File opened in a template workspace with a front-facing view; flat XY art seen edge-on | Force all 3D viewports to camera view (step 6) |
| Grease Pencil fill invisible or ~4% alpha | GP v3 material is a non-functional shim in 5.x; empty node tree | Abandon GP, use flat mesh + emission |
| GP object renders solid black | `layer.use_lights = True` with no lights in scene | Not worth fixing; see above |
| `AttributeError: 'Action' object has no attribute 'fcurves'` | Slotted Actions, Blender 4.4+ | `action.layers[0].strips[0].channelbags[0].fcurves` |
| `TypeError` setting `file_format = "FFMPEG"` | `media_type` still `IMAGE` | Set `media_type = "VIDEO"` first |
| `AttributeError: bl_idname` enumerating render engines | `HydraRenderEngine` has no `bl_idname` | Guard with `hasattr` |
| Colours read back too bright | `images.load().pixels` is already sRGB-encoded | Do not apply linear→sRGB on readback |
| Single-frame render refused | Output configured for video | Swap to PNG temporarily, then restore |
| Objects flicker or never appear | Colliding adjacent-frame visibility keys | Delete the F-curves and re-key |
| Camera slides between scenes | Missing CONSTANT key on the frame before the cut | Add the leading key |
| Rendered colours do not match the palette | View transform is Filmic or AgX | `view_transform = "Standard"` |
| MCP call times out during render | Blocking `render(animation=True)` | Use `'INVOKE_DEFAULT'` |

## Composition rules for flat 2D

- **Caption band versus feet.** A lower-third band and a standing character will
  fight for the same pixels. Decide the band's world-space span first, then place
  every character's feet above it. Probe the overlap zone to confirm.
- **Stage inside the tightest camera.** If the camera drifts to a smaller
  `ortho_scale`, everything must still be inside the frame at the tightest point.
  Compute the minimum and stage against that, not the widest shot.
- **Z-order by depth, not by luck.** Backgrounds far behind (z ≈ −8), characters and
  props near zero, effects and captions in front (z ≈ 2–3). Flat art with no depth
  sorting will z-fight.
- **Props built relative to their anchor inherit its transform.** Build a water
  stream aligned to the faucet it belongs to, parent or co-locate them, and moving
  the sink moves the water for free.

## Reference files

- `references/api-landmines.md` — the full Blender 4.4+/5.x API differences, the
  Grease Pencil test matrix and diagnosis, and version-safe code patterns.
- `references/flat-2d-pipeline.md` — asset construction, character rigging,
  palette discipline, and the collection layout that keeps a production navigable.
- `references/handoff-checklist.md` — the pre-delivery checklist, contact sheet
  generation, and what to tell the user.

## Bundled scripts

Write these into the .blend as text datablocks so the user inherits a working,
editable toolkit rather than a black box.

- `scripts/art2d.py` — palette, emission materials, `Art` class, shape generators.
- `scripts/anim2d.py` — keyframe helpers with slotted-Action support.
- `scripts/verify2d.py` — pixel probe and grid verification.

## What to tell the user

Report three things, in this order, every time:

1. **What is verified and how.** Name the method. "Pixel probe at frame 145 across
   the full frame" is honest; "looks good" is not.
2. **What you could not verify.** You cannot see the images. Say it plainly and
   point them at the contact sheet.
3. **Any deviation from their brief, with the reason.** If you swapped Grease Pencil
   for mesh, that is a change to what they asked for. Surface it, explain the
   evidence, and offer the alternative path.
