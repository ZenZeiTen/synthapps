---
name: "blender-game-asset-forge"
description: "Make game-ready Blender 4.5/5.x assets for Godot or three.js: level kits, colliders, LODs, rigs, multi-action glTF export, VFX meshes, baked textures and 8-direction pixel-art sprite renders. Works through the Blender MCP, or headless with bpy as a Python module when neither Blender nor the MCP is available."
---

# Blender Game Asset Forge

Make assets that load into the engine correctly the first time. The right scale, pivots,
colliders, animations, materials and names all have to arrive intact. The output is a
`.glb`, a sprite folder, or a clean `.blend`, plus a short import note for the engine side.

## Neighbouring skills: who owns what

| Situation | Skill |
|---|---|
| Models, kits, rigs, animations or sprite renders **for a game** | **this skill** |
| Flat 2D cartoon, explainer or motion graphic rendered as video | `blender-2d-forge` (read its `api-landmines.md`; the 5.x API notes apply here too) |
| Import settings, scenes and code inside Godot | `godot-forge` |
| Cleaning up or palette-locking rendered sprites | `aseprite-pixel-forge` |
| Pixel sprites lit in a 3D world | `hd2d-forge` |

## Facts checked on 2026-09-25 (re-check if more than about 3 months old)

- **Current: Blender 5.2.2 LTS** (5.2 released 14 Jul 2026, supported to Jul 2028). 4.5 LTS is still supported; 4.2 LTS has ended.
- **4.2** moved most add-ons to the Extensions Platform. Rigify is still bundled.
- **4.4** introduced slotted Actions: one Action can animate several data-blocks. The glTF exporter handles slots natively.
- **5.0** removed Collada (.dae) and broke several Python calls:
  - `action.fcurves` is gone; use channelbags;
  - the engine ID is now `BLENDER_EEVEE`;
  - `image_settings.media_type` must be set before `file_format`;
  - `material.use_nodes` is deprecated.
- **5.2** added glTF meshopt compression, Geometry Nodes Lists and a Mesh Bevel node, and online asset libraries.

In code, guard version-sensitive calls with `try/except`. Probe `bpy.app.version` first.

## Tools you have

The Blender MCP connector runs Python inside the user's open Blender:
- `execute_blender_code` runs code; assign a dict to `result` to return data.
- `get_objects_summary` and `get_object_detail_summary` inspect the scene.
- `render_viewport_to_path` and `render_thumbnail_to_path` produce images you can check.
- `search_api_docs` and `search_manual_docs` look up the API for the running version. Use them before guessing an API name.

The connector runs code **without guards**. Before a destructive step, save a copy
(`bpy.ops.wm.save_as_mainfile(filepath=..., copy=True)`).

For batch work without a UI:
```bash
blender -b file.blend --factory-startup --python-exit-code 1 --python script.py -- <args>
```
Read the args from `sys.argv` after the `--` separator.

Prefer the data API (`bpy.data.objects.new`, `collection.objects.link`) to `bpy.ops`. Operators
depend on the active object, mode and area, which you do not control over MCP.

**No Blender app and no MCP: bpy as a Python module** (measured with bpy 4.5.0, 2026-09-26)
- `pip install bpy==4.5.0`. The wheel exists only for the matching Python, which is 3.11
  for 4.5. Run the scripts with `python3.11 script.py`.
- A container also needs the Mesa GL libraries. Without them bpy aborts with `Couldn't
  open libEGL.so.1`. Install:
  `apt-get install -y libegl1 libgl1 libegl-mesa0 libgl1-mesa-dri libxkbcommon0 libsm6 libxi6 libxxf86vm1 libxfixes3 libxrender1`.
  After that, `EGL Error (0x3009): EGL_BAD_MATCH` lines are harmless noise.
- Write each script so it runs both as a module and inside Blender (`blender -b
  --python x.py -- args`). Read arguments as
  `sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]`.
- Start from `bpy.ops.wm.read_factory_settings(use_empty=True)`, save the result with
  `bpy.ops.wm.save_as_mainfile(filepath=…, compress=True)`, and commit that `.blend` as
  the editable source.

## Asset contract (apply to every asset)

1. **Scale.** 1 Blender unit = 1 metre. That is also Godot's and glTF's unit. A door is about 2.1 m; a character about 1.7–1.8 m.
2. **Transforms applied.** Rotation and scale are applied (`transform_apply`) on meshes and on the armature before export. Unapplied scale breaks retargeting and collision.
3. **Pivot.** Put it where the engine will place the object: at the base centre for props and characters, at a grid corner for modular kit pieces.
4. **Forward axis.** Face characters along **−Y in Blender**. After the +Y-up conversion, that becomes +Z in glTF, which matches Godot's humanoid reference pose.
5. **Clean geometry.** Recalculate normals outward. Remove doubles. Check for non-manifold edges and zero-area faces (Select > All by Trait). They break colliders, bakes and decimation.
6. **Names mean something.** Object suffixes drive engine import (below). Action names drive animation names.

## World design

**Modular kits**
- Choose one grid step (1 m, 2 m or 4 m) and snap every piece to it: walls, floors, corners, doorways, stairs.
- Model each piece at the origin with its pivot on a grid corner, so pieces tile with integer offsets.
- Keep pieces as separate objects in one "kit" collection. Mark them as assets for the Asset Browser.
- In Godot, each piece becomes a `MeshLibrary` item for `GridMap`.

**Trim sheets and atlases**
- Share one material across the kit. Unwrap pieces onto horizontal strips of a trim texture (edges, panels, bricks), instead of giving each piece its own texture.
- It is cheaper to draw, and it batches. 5.1+ can pack UV islands into custom regions.

**Scatter and terrain**
- Geometry Nodes can place instances on a surface: rocks, grass, trees.
- For the engine, either realise the instances by applying the modifier on export, or export them as GPU instances (`export_gpu_instances=True`, which the manual marks experimental). Large scatter is often better done in-engine with MultiMesh.

**Colliders.** Build a separate low-poly proxy and name it so Godot converts it:

| Name ends with | Godot result |
|---|---|
| `-colonly` / `-convcolonly` | StaticBody3D collider only; the mesh is removed |
| `-col` / `-convcol` | Visible mesh plus collider |
| `-navmesh` | Navigation mesh |
| `-occonly` | Occluder only |
| `-noimp` | Not imported (reference and helper objects) |

Use convex boxes and hulls for props, and trimesh only for static level geometry. Empties used
as primitive colliders relied on Collada and no longer work.

**LODs.** Godot can generate LODs automatically on import (meshoptimizer), so hand-made LODs are
optional. When the art needs control, make copies with the **Decimate** modifier (Collapse, a
ratio of about 0.5 and then 0.25, with Symmetry on) and swap them in-engine with `visibility_range`.

**Lightmap UV2.** Let Godot generate it on import (Light Baking: Static Lightmaps). Author a second
UV map in Blender only when the automatic unwrap fails visibly.

## Characters

**Topology**
- Put edge loops at the shoulders, elbows, wrists, hips, knees and mouth, which are the places that bend.
- Spend polygons on the silhouette, not on flat areas.
- Keep to about 4 bone influences per vertex, and normalise weights.

**Rigs**
- **Rigify** (bundled) gives animators good controls, but its rig carries many non-deforming control and mechanism bones.
- Export with `export_def_bones=True`. Then check the bone hierarchy in the engine, because deform-only export can reparent bones.
- For simple game characters, a hand-built rig of about 20–60 deform bones is often cleaner.
- **Humanoid bone names for Godot retargeting.** Use common English names so `SkeletonProfileHumanoid` auto-maps them: Root > Hips > Spine > Chest > UpperChest > Neck > Head; LeftShoulder, LeftUpperArm, LeftLowerArm, LeftHand; LeftUpperLeg, LeftLowerLeg, LeftFoot, LeftToes; and the mirror for Right.
- Keep a **Root** bone at the floor, above Hips, for root motion.
- **Shape keys** (facial expressions, blinks) export as morph targets. With shape keys, export deform bones only, or Godot's shading goes wrong.

**Animations: how to get all of them out**
- The default glTF mode `ACTIONS` exports each object's active action **plus actions stashed or pushed down to the NLA**. Any action not in one of those places is **silently dropped**.
- Make one Action per move: `Idle`, `Walk-loop`, `Run-loop`, `Attack1`, `Hit`, `Die`. Push each one down to the NLA.
- Put `loop` or `cycle` at the start or end of looping names, so Godot imports them looping.
- Godot **strips the suffix** on import. `Hero_Idle-loop` arrives as `Hero_Idle` (looping), and the object `Crate-convcolonly` arrives as a StaticBody3D named `Crate`. Game code must use the stripped names. This was tested end to end: Blender 5.0.1, GLB, then Godot 4.7.2.
- Only object transforms, pose bones and shape-key values export. Light and material animation needs `KHR_animation_pointer`, so drive those effects in the engine instead.

```python
import bpy
arm = bpy.data.objects["Hero_Armature"]
ad = arm.animation_data or arm.animation_data_create()
for act in [a for a in bpy.data.actions if a.name.startswith("Hero_")]:
    track = ad.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)
ad.action = None
result = {"tracks": [t.name for t in ad.nla_tracks]}
```

## Visual-effects assets

- **VFX meshes:** slash arcs (half a torus, flattened), cylinders for beams and shockwaves, crossed quads ("cards") for flames. Unwrap them so a scrolling texture runs along the UV. The shader lives in the engine.
- **Vertex colours as masks:** paint R, G and B channels on the mesh to drive fades or tint zones in the engine shader.
  - The exporter's `export_vertex_color='MATERIAL'` exports colours only if the material uses them. Use `'ACTIVE'` to force it.
  - In Godot, the material needs `-vcol` or Vertex Color > Use As Albedo.
- **Baking** (Cycles, Bake panel):
  - Types include Normal (tangent), AO, Diffuse, Emit and Combined.
  - For Selected to Active, bake a high-poly mesh onto a low-poly one, using Extrusion or a cage.
  - The target is the **active Image Texture node** in the low-poly material. Without one, nothing is baked.
- **What survives glTF:**
  - It keeps Principled BSDF inputs, Image Texture nodes, tangent-space Normal Map, Separate Color (packed ORM: G = roughness, B = metallic), Emission, the Mapping node, and alpha as Opaque, Mask or Blend.
  - It drops procedural textures, Shader to RGB, custom node maths and non-tangent normals. **Bake them to images first.**
- **Backface culling** is off in Blender by default, so the engine renders both sides. Turn it on in the material for solid meshes, and leave it off for cards.
- **Vertex animation textures (VAT)** for baked destruction or cloth: there is no native feature. The **OpenVAT** extension (v1.1.1, Blender 4.2+) encodes them; its Godot support is basic.

## Pre-rendered sprites (3D → pixel art)

This is Dead Cells' approach: render a 3D model tiny and without anti-aliasing, then clean up or
palette-lock the frames in Aseprite.

1. **Camera.** Orthographic, tilted to the game's view angle (about 30–45° down for top-down or ¾ views). Parent it to an empty at the character's origin. The empty is the turntable.
2. **Resolution.** The final sprite size, for example 64×64, at `resolution_percentage = 100`.
3. **Lighting and shading.**
   - Workbench (flat) or EEVEE with one key light. Workbench is far faster for sprites. On
     a 64×64 test render, Workbench took 4.5 s and EEVEE 34 s, because EEVEE compiles
     shaders on its first render.
   - For toon bands, use **Shader to RGB → ColorRamp (Constant)**, which works in EEVEE only.
   - Turn on **Film > Transparent**.
   - **Turn anti-aliasing off at its real switch.** For Workbench that is
     `scene.display.render_aa = "OFF"`. The film filter size has no effect there. For
     EEVEE and Cycles, set the film filter size to its minimum.
   - **Keep palette colours exact.** Set `render.dither_intensity = 0` and
     `view_settings.view_transform = "Standard"`; 4.x defaults to AgX, which shifts every
     colour. Give materials the palette colour converted from sRGB to linear. With FLAT
     lighting the render then outputs exactly that palette colour.

   Measured in bpy 4.5.0 (Workbench, FLAT light, 32×32 cube, material colour sRGB 208,70,72):

   | settings | edge pixels with partial alpha | opaque colours | centre pixel |
   |---|---|---|---|
   | defaults (AA 8, AgX, dither on) | 156 | 5 | 194,145,144 |
   | + `filter_size = 0.01` | 156 | 5 | 194,145,144 |
   | `render_aa = "OFF"` | 0 | 5 | 194,145,144 |
   | + `dither_intensity = 0`, `view_transform = "Standard"` | 0 | 1 | 233,143,145 |
   | + material colour converted sRGB → linear | 0 | 1 | **208,70,72** |
4. **Output.** PNG, RGBA. In 5.x, set `media_type = "IMAGE"` before `file_format = "PNG"`.
5. **Render every direction and frame:**

```python
import bpy, math, os
sc = bpy.context.scene
pivot = bpy.data.objects["CamPivot"]           # empty; camera is its child
out = bpy.path.abspath("//renders")
os.makedirs(out, exist_ok=True)
sc.render.film_transparent = True
sc.render.resolution_percentage = 100
try:
    sc.render.image_settings.media_type = "IMAGE"
except Exception:
    pass
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.dither_intensity = 0.0                # dither noise becomes palette noise
sc.view_settings.view_transform = "Standard"    # AgX (the 4.x default) shifts colours
if sc.render.engine == "BLENDER_WORKBENCH":
    sc.display.render_aa = "OFF"                # Workbench's AA switch; filter_size does nothing here
else:
    sc.render.filter_size = 0.01                # EEVEE/Cycles: smallest film filter = crisp edges
dirs = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]  # calibrate: frame 0 must face the camera
for i, d in enumerate(dirs):
    pivot.rotation_euler.z = math.radians(i * 45)
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        sc.render.filepath = os.path.join(out, f"{d}_{f:03d}.png")
        bpy.ops.render.render(write_still=True)
result = {"frames": len(dirs) * (sc.frame_end - sc.frame_start + 1), "dir": out}
```

- You can save frames by mirroring the three western directions in the engine (`flip_h`). Do this only if the design is left-right symmetric.
- Then hand the folder to `aseprite-pixel-forge`: import the frames, run `quantize_to_palette` to lock the ramp, clean the silhouette by hand, then tag and export.
- Keep the camera distance and resolution **fixed for the whole cast**. Mixed pixel density is the most visible failure of this pipeline. Fix one pixels-per-metre value and derive the orthographic scale from it: `cam.data.ortho_scale = canvas_px / PX_PER_M`. For example, 25 px/m gives a 56 px canvas of 2.24 m.
- **Check a contact sheet of the raw renders before the palette lock.** Tile every frame at 3× zoom, and look at it. In one cast, a rat was unreadable at 25 px/m and two figures were too dark. Scaling the model up and choosing lighter palette entries fixed them before any clean-up work was wasted.

## Export

```python
import bpy, json, struct
vl = bpy.context.view_layer
vl.update()   # REQUIRED: objects linked via the data API are missing from vl.objects until this runs
ship = [o for o in vl.objects if o.name.startswith("Hero")]
assert ship, "nothing selected - check names"
for o in vl.objects:
    o.select_set(o in ship)
vl.objects.active = bpy.data.objects["Hero_Armature"]
out = bpy.path.abspath("//export/hero.glb")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",            # one file; GLTF_SEPARATE gives diffable text + loose textures
    use_selection=True,
    export_apply=True,              # apply modifiers (not armature)
    export_yup=True,
    export_extras=True,             # custom properties -> glTF extras (readable in engine)
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_def_bones=True,
    export_morph=True,
    export_image_format="AUTO",
)
# read the GLB's JSON chunk back: this is the proof, not the operator's {'FINISHED'}
blob = open(out, "rb").read()
gltf = json.loads(blob[20:20 + struct.unpack("<I", blob[12:16])[0]])
result = {
    "shipped": [o.name for o in ship],
    "nodes": [n["name"] for n in gltf["nodes"]],
    "meshes": len(gltf.get("meshes", [])),
    "animations": [a["name"] for a in gltf.get("animations", [])],
}
```

This was tested in Blender 5.0.1 (bpy). Without `vl.update()`, a mesh created and linked earlier
in the same script was silently left out, and the export succeeded with zero meshes. Compare
`result["nodes"]` and `result["meshes"]` against what you meant to ship, every time.

- Keep `export_apply=True`. With it False, the modifiers (mirror, bevel, subdivision) are not baked into the export.
- For many assets, use **Collection Exporters** (collection properties > Exporters). They re-export a collection to its own file, from the UI or with `collection.exporters.new(...)` in Python.
- **three.js** reads the same `.glb`. Add `export_draco_mesh_compression_enable` or meshopt (5.2+) only if the loader is set up with the matching decoder.

## Pitfalls checklist (run before handoff)

1. **Unapplied scale or rotation:** giant or rotated imports, broken retargeting.
2. **Actions not active or in the NLA:** missing from the export.
3. **Procedural or Shader-to-RGB materials:** grey in the engine. Bake them.
4. **Shape keys with non-deform bones exported:** wrong shading in Godot.
5. **Collider proxies without a suffix,** or Empties used as colliders: no collision.
6. **Flipped normals:** hidden by Blender's disabled backface culling, visible in the engine.
7. **Sprite renders with anti-aliasing or a large film filter:** blurry edges that the palette lock turns into noise.
8. **Pre-5.0 script calls** (`action.fcurves`, `BLENDER_EEVEE_NEXT`, `file_format` set before `media_type`) crash on 5.x.
9. **Selecting by walking `view_layer.objects` right after creating objects with the data API:** new objects are missing until `view_layer.update()`, so `use_selection=True` exports without them. The export still reports success.
10. **Vertex count is higher in the engine than Blender shows:** UV seams and hard edges split vertices, which is expected. Budget with the engine's number.
11. **Pixel textures on a kit exported with Linear sampling:** blurred walls in the engine. Set the Image Texture node's `interpolation = "Closest"`, and the GLB carries NEAREST samplers. Measured: Closest exports `magFilter 9728`, `minFilter 9984`; Linear exports `9729`, `9987`. Read `samplers` from the GLB's JSON to confirm.
12. **Sprite renders under the 4.x defaults** (AgX view transform, dither on, Workbench AA on): off-palette colours and soft edges that the palette lock turns into noise. See the table under "Pre-rendered sprites".

## Verify before handoff

- Read the exported `.glb` back (the export snippet already returns its nodes, meshes and animations). Confirm every shipped object, collider and animation is present.
- When a Godot binary is available, run `godot --headless --path <proj> --import` on a project containing the file. Then check the imported scene for the expected collider bodies and looping animations (see `godot-forge`).
- Render one thumbnail per asset with `render_thumbnail_to_path` and look at it.
- Tell the user the file paths, the animation list, the collider objects, and anything only the engine can confirm, such as retarget quality and material look.