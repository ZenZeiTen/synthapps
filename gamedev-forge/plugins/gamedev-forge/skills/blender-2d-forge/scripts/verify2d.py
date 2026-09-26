"""
verify2d.py — numeric render verification for Blender 4.4+/5.x

You cannot see the viewport through an MCP connector. This renders a frame,
reads the pixels back, and returns hex values you can compare against your
palette. It reliably catches missing objects, wrong positions, occlusion and
colour errors.

It cannot tell you whether the artwork is any good. Render a contact sheet for
that and let a human look at it.

Two things make this work:

  * view_transform = "Standard" — under Filmic or AgX the round trip is lossy
    and every comparison becomes a guess.
  * image.pixels is already sRGB-encoded. Do NOT apply a linear->sRGB
    conversion on readback; it double-converts and everything reads bright.

Blender refuses a single-frame render while the output is configured for video,
so _render_png swaps to PNG and restores afterwards. Restore order matters:
media_type before file_format.
"""

import bpy
import os


def _hex(r, g, b):
    f = lambda v: int(round(max(0.0, min(1.0, v)) * 255))
    return "#%02X%02X%02X" % (f(r), f(g), f(b))


def _render_png(frame, pct, tag):
    sc = bpy.context.scene
    R = sc.render
    keep = (R.image_settings.media_type, R.image_settings.file_format,
            R.filepath, R.resolution_percentage)
    if frame is not None:
        sc.frame_set(frame)
    path = os.path.join(bpy.app.tempdir, tag + ".png")
    R.image_settings.media_type = "IMAGE"
    R.image_settings.file_format = "PNG"
    R.resolution_percentage = pct
    R.filepath = path
    bpy.ops.render.render(write_still=True)
    R.image_settings.media_type, R.image_settings.file_format = keep[0], keep[1]
    R.filepath, R.resolution_percentage = keep[2], keep[3]
    return path


def probe(points, frame=None, pct=50, tag="p"):
    """Sample specific world (x, y) coordinates.

        probe({"nia_shirt": (-2.8, -2.1), "roof": (0.0, 3.4)}, frame=145)
        -> {"nia_shirt": "#FFD93D", "roof": "#FF6B6B"}

    Honours the animated camera transform and ortho_scale, so it stays correct
    when the camera cuts or drifts. Returns "OFFSCREEN" for points outside frame,
    which is itself a useful result when you expected something to be visible.
    """
    sc = bpy.context.scene
    path = _render_png(frame, pct, tag)
    cam = sc.camera
    ox = cam.matrix_world.translation.x
    oy = cam.matrix_world.translation.y
    sw = cam.data.ortho_scale
    sh = sw * (sc.render.resolution_y / float(sc.render.resolution_x))
    img = bpy.data.images.load(path, check_existing=False)
    W, Hh = img.size
    px = list(img.pixels)
    out = {}
    for lbl, (wx, wy) in points.items():
        i = int(((wx - ox) / sw + 0.5) * W)
        j = int(((wy - oy) / sh + 0.5) * Hh)
        if not (0 <= i < W and 0 <= j < Hh):
            out[lbl] = "OFFSCREEN"
            continue
        o = (j * W + i) * 4
        out[lbl] = _hex(px[o], px[o + 1], px[o + 2])
    bpy.data.images.remove(img)
    return out


def verify(frame=None, cols=8, rows=5, pct=25, tag="v"):
    """Hex grid across the whole frame — a low-resolution picture of the
    composition. Read it like an image: a row of sky colour is sky, a block of
    grass colour is ground. If the row where a character's legs belong reads as
    caption-band colour, the band is covering them.

    Rows are returned top-first, matching how you'd look at the frame.
    """
    path = _render_png(frame, pct, tag)
    img = bpy.data.images.load(path, check_existing=False)
    W, Hh = img.size
    px = list(img.pixels)
    g = []
    for j in range(rows):
        row = []
        for i in range(cols):
            x = int((i + 0.5) * W / cols)
            y = int((j + 0.5) * Hh / rows)
            o = (y * W + x) * 4
            row.append(_hex(px[o], px[o + 1], px[o + 2]))
        g.append(row)
    g.reverse()
    bpy.data.images.remove(img)
    return {"size": [W, Hh], "frame": bpy.context.scene.frame_current, "grid": g}


def contact_sheet(key_frames, out_dir, pct=50):
    """Render one PNG per scene so a human can judge the result.

        contact_sheet([(100, "S1_intro"), (620, "S3_wash")], "C:/out/storyboard/")

    This is the highest-value artifact in the whole delivery — it closes the gap
    between numeric verification and human judgement.
    """
    sc = bpy.context.scene
    R = sc.render
    os.makedirs(out_dir, exist_ok=True)
    keep = (R.image_settings.media_type, R.image_settings.file_format,
            R.filepath, R.resolution_percentage)
    R.image_settings.media_type = "IMAGE"
    R.image_settings.file_format = "PNG"
    R.resolution_percentage = pct
    made = []
    for frame, name in key_frames:
        sc.frame_set(frame)
        R.filepath = os.path.join(out_dir, "%04d_%s.png" % (frame, name))
        bpy.ops.render.render(write_still=True)
        made.append(os.path.basename(R.filepath))
    R.image_settings.media_type, R.image_settings.file_format = keep[0], keep[1]
    R.filepath, R.resolution_percentage = keep[2], keep[3]
    return made


def check_render(path, expected_frames):
    """File size proves nothing. Read the real frame count — a render
    interrupted halfway produces a perfectly valid, perfectly wrong MP4."""
    info = {"path": path, "exists": os.path.exists(path)}
    if not info["exists"]:
        return info
    info["bytes"] = os.path.getsize(path)
    try:
        mc = bpy.data.movieclips.load(path)
        info["frames"] = mc.frame_duration
        info["resolution"] = (mc.size[0], mc.size[1])
        info["complete"] = (mc.frame_duration == expected_frames)
        bpy.data.movieclips.remove(mc)
    except Exception as e:
        info["error"] = repr(e)
    return info
