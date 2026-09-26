# Handoff checklist

The scene can be correct and the render can be correct while the delivery is still a
failure. This checklist exists because that happened: a finished animation, verified
numerically, opened by the user into a viewport showing mirrored text and flat
slivers, because the file still carried a Grease Pencil template workspace.

Run every item before you tell the user the work is done.

## 1. Workspace repair

**Why it matters.** A .blend inherits its workspaces from whatever template created
it. The 2D Animation template opens into a front-facing viewport. Flat XY artwork
viewed from the front collapses into thin horizontal streaks, and text reads mirrored.
Nothing in the scene data indicates a problem.

```python
import bpy

rename = {"2D Animation": "Layout", "2D Full Canvas": "Preview"}
for old, new in rename.items():
    w = bpy.data.workspaces.get(old)
    if w and not bpy.data.workspaces.get(new):
        w.name = new

for w in bpy.data.workspaces:
    try: w.object_mode = 'OBJECT'
    except Exception: pass
    for screen in w.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                for sp in area.spaces:
                    if sp.type != 'VIEW_3D': continue
                    sp.region_3d.view_perspective  = 'CAMERA'
                    sp.region_3d.view_camera_zoom  = 0.0
                    sp.region_3d.view_camera_offset = (0.0, 0.0)
                    sp.shading.type = 'RENDERED'
                    sp.overlay.show_floor  = False
                    sp.overlay.show_axis_x = False
                    sp.overlay.show_axis_y = False
                    sp.overlay.show_cursor = False
                    sp.clip_start, sp.clip_end = 0.1, 200.0
            elif area.type == 'DOPESHEET_EDITOR':
                for sp in area.spaces:
                    if sp.type == 'DOPESHEET_EDITOR':
                        try: sp.mode = 'DOPESHEET'
                        except Exception: pass
```

`shading.type = 'RENDERED'` matters more than it looks. Solid shading shows emission
materials as flat grey; the user would see a colourless scene and assume it is broken.

## 2. File hygiene

```python
sc.frame_set(1)                                    # open on frame 1, not mid-scene

t = bpy.data.texts.get("obsolete_lib.py")          # drop superseded libraries
if t: bpy.data.texts.remove(t)

bpy.ops.outliner.orphans_purge(do_local_ids=True,
                               do_linked_ids=True,
                               do_recursive=True)
bpy.ops.wm.save_mainfile()
```

Also confirm there is no leftover template content — a stray Grease Pencil object, a
default cube, an unused scene:

```python
inv = {
    "scenes": {s.name: len(s.objects) for s in bpy.data.scenes},
    "types": {},
}
for o in bpy.data.objects:
    inv["types"].setdefault(o.type, []).append(o.name)
```

## 3. Contact sheet

Render one PNG per scene so the user can judge the result without opening Blender.
This is the single highest-value artifact you produce, because it is the only thing
that closes the gap between numeric verification and human judgement.

```python
OUT = "<output_dir>/storyboard/"
os.makedirs(OUT, exist_ok=True)
keep = (R.image_settings.media_type, R.image_settings.file_format,
        R.filepath, R.resolution_percentage)
R.image_settings.media_type  = "IMAGE"
R.image_settings.file_format = "PNG"
R.resolution_percentage = 50

for frame, name in KEY_FRAMES:            # one representative frame per scene
    sc.frame_set(frame)
    R.filepath = OUT + ("%04d_%s.png" % (frame, name))
    bpy.ops.render.render(write_still=True)

R.image_settings.media_type, R.image_settings.file_format = keep[0], keep[1]
R.filepath, R.resolution_percentage = keep[2], keep[3]
```

Name the files by frame number and content, so a directory listing reads as a
storyboard: `0620_S3_scrub_handwashing.png`.

Present the files with whatever file-delivery tool is available.

## 4. Verify the render actually completed

File size proves nothing. Read the real frame count:

```python
mc = bpy.data.movieclips.load(path)
frames    = mc.frame_duration
resolution = (mc.size[0], mc.size[1])
bpy.data.movieclips.remove(mc)
```

Compare `frames` against `frame_end - frame_start + 1`. A render interrupted at frame
900 of 1872 produces a perfectly valid, perfectly wrong MP4.

If the render was launched with `'INVOKE_DEFAULT'`, also confirm the file has stopped
growing:

```python
s1 = os.path.getsize(path); time.sleep(1.5); s2 = os.path.getsize(path)
still_rendering = (s1 != s2)
```

## 5. Path assumptions

A brief that says `/renders/project/` has no meaning on Windows without a drive letter.
Pick something sensible, then **tell the user what you picked and why**. Do not let a
silently invented path be discovered later.

## 6. What to say

Three things, in this order:

**What is verified, and by what method.** Name it. "Pixel probe at frame 145 across
the full frame, all palette colours matched exactly" is a claim the user can evaluate.
"Everything looks good" is not.

**What you could not verify.** You cannot see images. Numeric probing proves
structure — objects present, correctly positioned, not occluded, correctly coloured.
It says nothing about whether the artwork is appealing or the timing feels right.
State that plainly and point at the contact sheet.

**Any deviation from the brief.** If the user asked for Grease Pencil and you
delivered mesh, that is a change to what they requested. Lead with it, give the
evidence, name the trade-off, and offer the alternative path. Burying it in a
paragraph near the end is how a reasonable engineering decision turns into a surprise.

## 7. Reopen test

The last thing to do, if you can: query the file's state as a fresh reader would see
it. Active workspace, viewport perspective, shading mode, current frame. If any of
those would confuse someone opening the file cold, fix it before you sign off.
