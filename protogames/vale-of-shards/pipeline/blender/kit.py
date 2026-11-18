"""Shared Blender helpers for Vale of Shards: palette materials, primitives with pivots,
sprite and backdrop cameras, render settings. Written for bpy 5.0 (works on 4.5 too;
version-sensitive calls are guarded).

Scale: 1 Blender unit = 1 metre, and every sprite is rendered at PX_PER_M = 24 pixels per
metre (Orrin's 40 px hitbox is about 1.67 m). Models are written in pixel numbers through
px() so that "30 px wide" in a comment is 30 px in the render.

Measured facts this code relies on (bpy 5.0.1 as a Python module, Mesa llvmpipe):
  B1 Workbench renders headless once libEGL/libGL are installed; the "EGL Error (0x3009):
     EGL_BAD_MATCH" lines it prints are harmless.
  B2 Render anti-aliasing must be off at its real switch (scene.display.render_aa = 'OFF'),
     dither 0 and view transform 'Standard', or the palette lock turns edges into noise.
  B3 In 5.x image_settings.media_type must be set to 'IMAGE' before file_format.
"""
from __future__ import annotations

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
from palette import COLORS, N  # noqa: E402

PX_PER_M = 24
RENDERS = os.path.join(ROOT, "build", "renders")
BLENDS = os.path.join(ROOT, "art", "blender")


def px(v: float) -> float:
    """Pixels -> metres at the sprite density."""
    return v / PX_PER_M


def P(*v):
    """A tuple of pixel values -> metres."""
    return tuple(x / PX_PER_M for x in v)


def args() -> list[str]:
    """Arguments after '--' (inside Blender) or after the script name (bpy module)."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


# ------------------------------------------------------------------ materials

_mats: dict = {}


def rgb_of(c) -> tuple[int, int, int]:
    """c: palette name ('gold1'), palette index, or an (r, g, b) tuple 0..255."""
    if isinstance(c, str):
        return COLORS[N[c]]
    if isinstance(c, int):
        return COLORS[c]
    return tuple(int(v) for v in c)


def mix(a, b, t: float) -> tuple[int, int, int]:
    """Blend two colours (any form rgb_of takes); t=0 -> a, t=1 -> b."""
    A, B = rgb_of(a), rgb_of(b)
    return tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))


def mat(c, emit: float = 0.0) -> bpy.types.Material:
    """A material whose Workbench colour is c. emit>0 also sets an EEVEE emission."""
    rgb = rgb_of(c)
    key = (rgb, emit)
    if key in _mats and _mats[key].name in bpy.data.materials:
        return _mats[key]
    lin = [srgb_to_linear(v / 255.0) for v in rgb]
    m = bpy.data.materials.new("c%02x%02x%02x%s" % (*rgb, "e" if emit else ""))
    m.diffuse_color = (*lin, 1.0)
    m.roughness = 0.9
    m.metallic = 0.0
    m["emit"] = emit
    try:  # EEVEE look (nodes exist by default in 5.x; use_nodes is deprecated)
        if not m.node_tree:
            m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.9
            if emit:
                bsdf.inputs["Emission Color"].default_value = (*lin, 1.0)
                bsdf.inputs["Emission Strength"].default_value = emit
    except Exception:
        pass
    _mats[key] = m
    return m


# ------------------------------------------------------------------ primitives

def _link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name: str, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.rotation_euler = [math.radians(a) for a in rot]
    return _link(e, parent)


def _prim(kind, name, loc, scale, rot, color, parent, segments=16, rings=None, flat=False, emit=0.0):
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings or max(6, segments // 2), radius=0.5)
    elif kind == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=segments, radius=0.5)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=0.5, depth=1.0)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=0.5, radius2=0.0, depth=1.0)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_segments=segments, minor_segments=8, major_radius=0.5,
                                         minor_radius=rings or 0.12)
    elif kind == "plane":
        bpy.ops.mesh.primitive_plane_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.location = loc
    o.scale = scale
    o.rotation_euler = [math.radians(a) for a in rot]
    o.data.materials.append(mat(color, emit))
    if kind in ("sphere", "cyl", "cone", "torus") and not flat:
        for p in o.data.polygons:
            p.use_smooth = True
    if parent is not None:
        o.parent = parent
    return o


def box(name, loc, size, color, parent=None, rot=(0, 0, 0), emit=0.0):
    return _prim("cube", name, loc, size, rot, color, parent, emit=emit)


def ball(name, loc, size, color, parent=None, rot=(0, 0, 0), segments=16, flat=False, emit=0.0):
    return _prim("sphere", name, loc, size, rot, color, parent, segments, flat=flat, emit=emit)


def gem(name, loc, size, color, parent=None, rot=(0, 0, 0), subdiv=1, emit=0.0):
    """Faceted icosphere (flat shaded): rocks, crystals."""
    return _prim("ico", name, loc, size, rot, color, parent, subdiv, flat=True, emit=emit)


def cyl(name, loc, size, color, parent=None, rot=(0, 0, 0), segments=16, flat=False, emit=0.0):
    return _prim("cyl", name, loc, size, rot, color, parent, segments, flat=flat, emit=emit)


def cone(name, loc, size, color, parent=None, rot=(0, 0, 0), segments=12, flat=False, emit=0.0):
    return _prim("cone", name, loc, size, rot, color, parent, segments, flat=flat, emit=emit)


def ring(name, loc, size, color, parent=None, rot=(0, 0, 0), segments=24, thick=0.12):
    return _prim("torus", name, loc, size, rot, color, parent, segments, rings=thick)


def prism(name, loc, radius, depth, color, sides=6, parent=None, rot=(0, 0, 0), emit=0.0):
    """Flat-shaded n-sided prism along local Z."""
    return _prim("cyl", name, loc, (radius * 2, radius * 2, depth), rot, color, parent, sides, flat=True, emit=emit)


def spike(name, loc, radius, length, color, parent=None, rot=(0, 0, 0), sides=5, emit=0.0):
    """Flat-shaded pointed crystal: a cone whose base sits at loc, pointing along local +Z."""
    j = empty(name, loc, parent, rot)
    _prim("cone", name + "_m", (0, 0, length / 2), (radius * 2, radius * 2, length), (0, 0, 0), color, j, sides,
          flat=True, emit=emit)
    return j


def recolor(obj, color):
    """Give obj (and its mesh children) a different palette colour."""
    for o in [obj] + list(obj.children_recursive):
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(mat(color))


def set_rot(o, rx=0.0, ry=0.0, rz=0.0):
    o.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))


# ------------------------------------------------------------------ render settings

def _common_output(sc, w, h, transparent):
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.dither_intensity = 0.0
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    try:
        sc.render.image_settings.media_type = "IMAGE"   # 5.x: before file_format
    except Exception:
        pass
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.render.image_settings.color_depth = "8"
    for attr in ("use_stamp", "use_stamp_date", "use_stamp_time", "use_stamp_render_time", "use_stamp_frame"):
        if hasattr(sc.render, attr):
            setattr(sc.render, attr, False)


KEY_LIGHT = (-0.55, 0.55, 0.62)   # Workbench view-space direction: from the upper left, in front


def key_light(direction=KEY_LIGHT, ambient: float = 0.2, diffuse: float = 0.8, smooth: float = 0.0):
    """One hard directional light for Workbench's 'Default' studio light (the preference
    solid lights). read_factory_settings resets preferences, so call this after reset()."""
    sysp = bpy.context.preferences.system
    L = sysp.solid_lights
    for i in range(1, len(L)):
        L[i].use = False
    L[0].use = True
    L[0].direction = direction
    L[0].diffuse_color = (diffuse, diffuse, diffuse)
    L[0].specular_color = (0, 0, 0)
    L[0].smooth = smooth
    sysp.light_ambient = (ambient, ambient, ambient)


def workbench(light: str = "STUDIO", studio: str | None = "Default"):
    sc = bpy.context.scene
    key_light()
    sc.render.engine = "BLENDER_WORKBENCH"
    try:
        sc.display.render_aa = "OFF"
    except Exception:
        pass
    sh = sc.display.shading
    sh.light = light
    sh.color_type = "MATERIAL"
    if studio:
        try:
            sh.studio_light = studio
        except Exception:
            pass
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.show_shadows = False
    try:
        sh.use_dof = False
    except Exception:
        pass


def ortho_camera(w: int, h: int, center=(0.0, 0.0), ppm: float = PX_PER_M, tilt: float = 0.0,
                 transparent: bool = True, name="cam"):
    """Orthographic camera looking along +Y at the XZ plane, w x h pixels at ppm pixels per
    metre, canvas centre at world (center[0], center[1]) in X/Z. tilt: degrees looking down."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new(name)
    cd.type = "ORTHO"
    cd.ortho_scale = max(w, h) / ppm
    cd.clip_start = 0.01
    cd.clip_end = 400.0
    cam = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(cam)
    t = math.radians(tilt)
    dist = 60.0
    cam.location = (center[0], -dist * math.cos(t), center[1] + dist * math.sin(t))
    cam.rotation_euler = (math.radians(90) - t, 0, 0)
    sc.camera = cam
    _common_output(sc, w, h, transparent)
    return cam


def render_to(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.view_layer.update()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def save_blend(name: str):
    os.makedirs(BLENDS, exist_ok=True)
    path = os.path.join(BLENDS, name + ".blend")
    bpy.context.preferences.filepaths.save_version = 0     # no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    return path


# ------------------------------------------------------------------ toon shading
# Sprites are rendered in two Workbench passes and combined into one image:
#   ID pass    FLAT light, material colours: every pixel is exactly a palette colour;
#   light pass STUDIO light (one hard key from the upper left), all objects white;
# then each pixel steps up or down its own colour ramp (SHADE_CHAINS) by how lit it is.
# This keeps hues on the palette's ramps (a lit brass pixel stays brass instead of
# snapping to whichever colour happens to be nearest), which a plain lit render plus
# nearest-colour lock does not. Objects made with emit>0 are never shaded (lamps, glows).

SHADE_CHAINS = {   # family -> ramp dark..light, extended past the family's own ends
    "stone": ["ink", "stone0", "stone1", "stone2", "stone3", "stone4", "white"],
    "wood": ["ink", "wood0", "wood1", "wood2", "wood3", "wood4", "skin2"],
    "gold": ["wood0", "wood1", "gold0", "gold1", "gold2", "white"],
    "skin": ["wood1", "skin0", "skin1", "skin2", "dawn0"],
    "moss": ["ink", "moss0", "moss1", "moss2", "moss3", "moss4"],
    "shard": ["water0", "shard0", "shard1", "shard2", "shard3", "white"],
    "water": ["ink", "water0", "water1", "water2", "water3", "water4", "white"],
    "violet": ["ink", "violet0", "violet1", "violet2", "violet3", "dawn0"],
    "fire": ["ink", "fire0", "fire1", "fire2", "fire3", "fire4", "fire5", "white"],
    "berry": ["fire0", "berry0", "berry1", "berry2", "dawn0"],
    "dawn": ["violet1", "dawn2", "dawn1", "dawn0", "white"],
    "white": ["stone3", "stone4", "white"],
    "ink": ["ink"],
}
_CHAIN_OF: dict[int, tuple[list[int], int]] = {}
for _fam, _ch in SHADE_CHAINS.items():
    for _i, _n in enumerate(_ch):
        if _n.rstrip("0123456789") == _fam:
            _CHAIN_OF[N[_n]] = ([N[n] for n in _ch], _i)
assert len(_CHAIN_OF) == len(COLORS), sorted(set(range(len(COLORS))) - set(_CHAIN_OF))

# light level -> ramp step (checked top-down; the first threshold the level reaches wins)
BANDS = [(0.93, 1), (0.60, 0), (0.40, -1), (0.0, -2)]
EMIT_MARK = (1.0, 0.0, 0.0, 1.0)


def _read_png(path):
    import numpy as np
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return (a.reshape(h, w, 4) * 255.0).round().astype(np.int32)   # bottom row first


def write_png(path, arr):
    """arr: h x w x 4 ints 0..255, bottom row first (Blender's order)."""
    import numpy as np
    h, w = arr.shape[:2]
    im = bpy.data.images.new("out", w, h, alpha=True)
    im.pixels.foreach_set((arr.astype(np.float32) / 255.0).ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def _palette_index(rgb) -> int:
    from palette import nearest
    return nearest(*rgb)


def toon_render(path: str, bands=None, lift: int = 0, keep_passes: bool = True):
    """Render the scene's camera view to path with ramp-stepped shading (see above).
    lift shifts every step (for example -1 for a dimmed pose)."""
    import numpy as np
    bands = bands or BANDS
    sc = bpy.context.scene
    sh = sc.display.shading
    d = os.path.join(os.path.dirname(path), "_passes")
    base = os.path.splitext(os.path.basename(path))[0]
    idp, ltp = os.path.join(d, base + "_id.png"), os.path.join(d, base + "_light.png")
    # ID pass
    sh.light = "FLAT"
    sh.color_type = "MATERIAL"
    render_to(idp)
    # light pass: object colour white, emissive objects marked red
    for o in sc.objects:
        if o.type == "MESH":
            em = any(m is not None and m.get("emit", 0) > 0 for m in o.data.materials)
            o.color = EMIT_MARK if em else (1.0, 1.0, 1.0, 1.0)
    sh.light = "STUDIO"
    sh.studio_light = "Default"
    sh.color_type = "OBJECT"
    render_to(ltp)
    sh.color_type = "MATERIAL"
    ida, lta = _read_png(idp), _read_png(ltp)
    out = np.zeros_like(ida)
    cache: dict = {}
    h, w = ida.shape[:2]
    for y in range(h):
        for x in range(w):
            r, g, b, a = ida[y, x]
            if a < 128:
                continue
            k = (int(r), int(g), int(b))
            if k not in cache:
                cache[k] = _palette_index(k)
            idx = cache[k]
            lr, lg, lb, la = lta[y, x]
            if lr > 0 and lg == 0 and lb == 0:
                step = 0   # emissive: flat colour
            else:
                lv = (lr + lg + lb) / (3 * 255.0)
                step = next(s for t, s in bands if lv >= t) + lift
            chain, pos = _CHAIN_OF.get(idx, ([idx], 0))
            j = max(0, min(len(chain) - 1, pos + step))
            out[y, x] = (*COLORS[chain[j]], 255)
    write_png(path, out)
    if not keep_passes:
        os.remove(idp)
        os.remove(ltp)
