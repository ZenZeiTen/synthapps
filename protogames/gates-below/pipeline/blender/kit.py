"""Shared Blender helpers for Gates Below: palette materials, primitives with pivots,
render settings. Works with Blender 4.5 LTS and 5.x (version-sensitive calls are guarded).

Measured facts this code relies on (Blender 4.5.0 as a Python module, Mesa llvmpipe):
  B1 Workbench, EEVEE and Cycles all render headless once libEGL/libGL are present;
     without them bpy aborts with "Couldn't open libEGL.so.1".
  B2 Workbench renders a 56x56 sprite in well under a second; EEVEE's first render
     compiles shaders (~35 s). Sprites therefore use Workbench.
  B3 Render anti-aliasing must be off (scene.display.render_aa = 'OFF'), or edges get
     blended colours that the palette lock turns into noise.
"""
from __future__ import annotations

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
from palette import RGB  # noqa: E402


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_mats: dict = {}


def mat(idx: int, emit: bool = False) -> bpy.types.Material:
    """A material in palette colour idx (see pipeline/aseprite/palette.py)."""
    key = (idx, emit)
    if key in _mats and _mats[key].name in bpy.data.materials:
        return _mats[key]
    r, g, b = (srgb_to_linear(v / 255.0) for v in RGB[idx])
    m = bpy.data.materials.new(f"p{idx:02d}{'e' if emit else ''}")
    m.diffuse_color = (r, g, b, 1.0)
    m.roughness = 0.8
    m["palette"] = idx
    _mats[key] = m
    return m


def clear_mats():
    _mats.clear()


def _link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name: str, loc=(0, 0, 0), parent=None) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.location = loc
    return _link(e, parent)


def _prim(kind: str, name: str, loc, scale, rot, color: int, parent, emit=False, segments=16):
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(6, segments // 2), radius=0.5)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=0.5, depth=1.0)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=0.5, radius2=0.0, depth=1.0)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=8, major_radius=0.5, minor_radius=0.12)
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.scale = scale
    o.rotation_euler = [math.radians(a) for a in rot]
    o.data.materials.append(mat(color, emit))
    if parent is not None:
        o.parent = parent
    return o


def box(name, loc, size, color, parent=None, rot=(0, 0, 0)):
    return _prim("cube", name, loc, size, rot, color, parent)


def ball(name, loc, size, color, parent=None, rot=(0, 0, 0), emit=False, segments=16):
    return _prim("sphere", name, loc, size, rot, color, parent, emit, segments)


def cyl(name, loc, size, color, parent=None, rot=(0, 0, 0), segments=12):
    return _prim("cyl", name, loc, size, rot, color, parent, segments=segments)


def cone(name, loc, size, color, parent=None, rot=(0, 0, 0), emit=False):
    return _prim("cone", name, loc, size, rot, color, parent, emit)


def ring(name, loc, size, color, parent=None, rot=(0, 0, 0)):
    return _prim("torus", name, loc, size, rot, color, parent)


def limb(name, parent, joint, length, radius, color, rot=(0, 0, 0), end_ball=0.0, end_color=None):
    """A joint (empty) with a cylinder hanging down from it; rotate the joint to pose."""
    j = empty(name, joint, parent)
    j.rotation_euler = [math.radians(a) for a in rot]
    cyl(name + "_m", (0, 0, -length / 2), (radius * 2, radius * 2, length), color, j)
    if end_ball:
        ball(name + "_end", (0, 0, -length), (end_ball, end_ball, end_ball), end_color if end_color is not None else color, j)
    return j


def pose(parts: dict, spec: dict):
    """spec: part name -> (rx, ry, rz) degrees, or ('loc', (x, y, z))."""
    for k, v in spec.items():
        o = parts[k]
        if isinstance(v, tuple) and len(v) == 2 and v[0] == "loc":
            o.location = v[1]
        elif isinstance(v, tuple) and len(v) == 2 and v[0] == "scale":
            o.scale = v[1]
        else:
            o.rotation_euler = [math.radians(a) for a in v]


def sprite_camera(ortho: float, center_z: float, px: int, flat: bool = False):
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, -10, center_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = px
    sc.render.resolution_y = px
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.dither_intensity = 0.0
    try:
        sc.display.render_aa = "OFF"
    except Exception:
        pass
    sh = sc.display.shading
    sh.light = "FLAT" if flat else "STUDIO"
    sh.color_type = "MATERIAL"
    try:
        sh.studio_light = "outdoor.sl" if not flat else sh.studio_light
    except Exception:
        pass
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sc.view_settings.view_transform = "Standard"
    try:
        sc.render.image_settings.media_type = "IMAGE"
    except Exception:
        pass
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    for attr in ("use_stamp", "use_stamp_date", "use_stamp_time", "use_stamp_render_time", "use_stamp_frame"):
        if hasattr(sc.render, attr):
            setattr(sc.render, attr, False)
    return cam


def render_to(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
