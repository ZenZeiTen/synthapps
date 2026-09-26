# Blender 4.4+ / 5.x API landmines

Everything here was found empirically against Blender 5.2.1 LTS on Windows through
an MCP connector. Training-data knowledge of these APIs is unreliable — the 4.x to
5.x transition changed several of them without much fanfare.

## Contents

1. [Grease Pencil v3 fills do not render](#1-grease-pencil-v3-fills-do-not-render)
2. [Slotted Actions removed `action.fcurves`](#2-slotted-actions-removed-actionfcurves)
3. [Video output is gated behind `media_type`](#3-video-output-is-gated-behind-media_type)
4. [Render engine enumeration crashes](#4-render-engine-enumeration-crashes)
5. [Image pixel readback is sRGB, not linear](#5-image-pixel-readback-is-srgb-not-linear)
6. [Single-frame render refused under video output](#6-single-frame-render-refused-under-video-output)
7. [Template workspaces persist in the saved file](#7-template-workspaces-persist-in-the-saved-file)
8. [Version-safe patterns](#8-version-safe-patterns)

---

## 1. Grease Pencil v3 fills do not render

**Symptom.** Strokes render correctly with the right colour. Fills render at roughly
4% alpha, or not at all. A pure red fill over white reads back as `#FFF5F5`.

**Test matrix.** Every one of these was tried and failed:

| Approach | Result |
|---|---|
| `mat.grease_pencil.show_fill = True` + `fill_color` | Fill invisible. `show_stroke = False` also ignored |
| Per-stroke `fill_color` alpha 1.0, `fill_opacity = 1.0` | No change |
| `drawing.tag_positions_changed()` | No change |
| `layer.use_lights = False` | No change to fills |
| Emission node tree on the GP material | Fill reached ~4% alpha |
| Principled BSDF with emission | Same |
| `mat.diffuse_color` | Ignored |
| `surface_render_method = "DITHERED"` | No change |

**The reference-object test that settled it.** Create Blender's own GP object:

```python
bpy.ops.object.grease_pencil_add(type='MONKEY')
```

It renders solid black, and every one of its materials reports `show_fill = False` —
on an object that is unmistakably meant to be filled. That rules out user error.

Black, not transparent, because `layer.use_lights` defaults to `True` and the scene
had no lights. Turning lights off on the layer makes it invisible rather than
correct, which is not an improvement.

**Diagnosis.** GP materials carry `use_nodes = True` with an **empty node tree**, and
the `mat.grease_pencil.*` properties are a non-functional compatibility shim. Strokes
still shade correctly because they take a different code path.

**Resolution.** Do not use Grease Pencil for filled 2D artwork in 5.x. Use flat mesh
polygons with Emission shaders. If Grease Pencil authoring is a hard requirement, the
only workable path is building fills out of *thick strokes*, which is a different and
more laborious construction.

**Worth testing if it matters:** this may be a 5.2-specific regression. 4.5 LTS is
worth a check before concluding GP is unusable everywhere.

**Genuinely useful GP v3 API notes**, if you end up there anyway:

- `drawing.add_strokes([sizes])` takes a list of point counts.
- Points expose `position`, `radius`, `opacity`, `vertex_color`.
- Strokes expose `cyclic`, `fill_color`, `fill_opacity`, `material_index`,
  `curve_type` (1 = POLY).
- `bpy.types.GreasePencilStroke` does not exist as a type name.

---

## 2. Slotted Actions removed `action.fcurves`

Blender 4.4 introduced slotted Actions. `action.fcurves` no longer exists. Code that
worked for a decade now raises `AttributeError`.

The new path:

```
action.layers[0].strips[0].channelbags[0].fcurves
```

Or, correctly scoped to the object's own slot:

```
strip.channelbag(animation_data.action_slot).fcurves
```

Write a compatibility accessor once and route everything through it:

```python
def _fcurves(idb):
    ad = getattr(idb, "animation_data", None)
    if not (ad and ad.action):
        return []
    act = ad.action
    legacy = getattr(act, "fcurves", None)
    if legacy is not None:
        try: return list(legacy)
        except Exception: pass
    out, slot = [], getattr(ad, "action_slot", None)
    for layer in act.layers:
        for strip in layer.strips:
            cb = None
            if slot is not None:
                try: cb = strip.channelbag(slot)
                except Exception: cb = None
            if cb is not None:
                out.extend(cb.fcurves)
            else:
                for c in strip.channelbags:
                    out.extend(c.fcurves)
    return out
```

This is what `scripts/anim2d.py` uses. Setting keyframe interpolation, deleting
F-curves, and inspecting animation all depend on it.

**Note.** `keyframe_insert()` itself is unchanged. Only *reading back* the curves
broke. Code that writes keys and never inspects them will appear to work while
silently ignoring your interpolation settings.

---

## 3. Video output is gated behind `media_type`

Assigning `file_format = "FFMPEG"` fails with an enum error unless `media_type` is
set to `"VIDEO"` first. Order matters:

```python
R.image_settings.media_type  = "VIDEO"     # first
R.image_settings.file_format = "FFMPEG"    # then this becomes legal
```

To go back to stills, reverse it: set `media_type = "IMAGE"` before
`file_format = "PNG"`.

---

## 4. Render engine enumeration crashes

`bpy.types.RenderEngine.__subclasses__()` includes `HydraRenderEngine`, which has no
`bl_idname`. Naive enumeration raises `AttributeError`:

```python
engines = [e.bl_idname for e in bpy.types.RenderEngine.__subclasses__()
           if hasattr(e, "bl_idname")]
```

In 5.2 the engine enum offers only `BLENDER_EEVEE` — the `_NEXT` suffix from the 4.x
era is gone.

---

## 5. Image pixel readback is sRGB, not linear

`bpy.data.images.load(path).pixels` returns **display-referred sRGB** values, not
scene-linear. Applying a linear→sRGB conversion on readback double-converts and
brightens everything, which will make your verification report false failures.

Convert only in the other direction — when *authoring* colour from hex:

```python
def _s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
```

And read back raw:

```python
def _hex(r, g, b):
    f = lambda v: int(round(max(0.0, min(1.0, v)) * 255))
    return "#%02X%02X%02X" % (f(r), f(g), f(b))
```

With `view_transform = "Standard"`, a source hex round-trips exactly. That exactness
is what makes pixel probing a reliable test — any mismatch is a real problem, not a
colour-management artifact.

---

## 6. Single-frame render refused under video output

Once the scene is configured for FFMPEG output, `bpy.ops.render.render(write_still=True)`
will not produce a usable still. Swap formats around the call and restore afterwards:

```python
keep = (R.image_settings.media_type, R.image_settings.file_format,
        R.filepath, R.resolution_percentage)
R.image_settings.media_type  = "IMAGE"
R.image_settings.file_format = "PNG"
R.resolution_percentage = pct
R.filepath = path
bpy.ops.render.render(write_still=True)
R.image_settings.media_type, R.image_settings.file_format = keep[0], keep[1]
R.filepath, R.resolution_percentage = keep[2], keep[3]
```

Restore in that order — `media_type` before `file_format`, same as section 3.

---

## 7. Template workspaces persist in the saved file

A .blend created from the 2D Animation template keeps `2D Animation` and
`2D Full Canvas` as its only workspaces, with a Grease Pencil paint object mode and a
front-facing viewport. Nothing in the scene data hints at this — object rotations are
all zero, the camera is correct, the render is correct.

The user opens the file and sees flat artwork edge-on.

Always check `[w.name for w in bpy.data.workspaces]` during reconnaissance, and always
run the workspace fix before handoff. See `handoff-checklist.md`.

---

## 8. Version-safe patterns

**Guard optional properties.** Several material and shading properties come and go
between versions. Wrap them:

```python
try: mat.surface_render_method = "DITHERED"
except Exception: pass
```

**Guard operators that depend on context.** `mesh.shade_flat()` exists as a mesh
method in 5.x but the operator form needs an active object and the right mode.

```python
try: me.shade_flat()
except Exception: pass
```

**Probe before you build.** One cheap reconnaissance call at the start costs a few
hundred tokens. Discovering the API is different halfway through a 400-line asset
build costs far more.

**Prefer data-API over operators.** `bpy.data.objects.new()` and
`collection.objects.link()` behave predictably through MCP. `bpy.ops.*` depends on
context — the active object, the current area, the current mode — none of which you
control reliably from outside the UI.
