"""Parallax backdrops and the title scene for Vale of Shards, built from primitives and
rendered with EEVEE through an orthographic camera.

    python3 pipeline/blender/backdrops.py [name ...]          # bpy as a Python module
    blender -b --factory-startup --python pipeline/blender/backdrops.py -- [name ...]

Writes build/renders/bg_<theme>/far.png (480x148) and build/renders/title/scene.png
(320x180), and saves each scene to art/blender/<name>.blend. Then
pipeline/aseprite/import_renders.py dithers them onto the palette.

Rules the scenes follow:
  * DIM and low contrast. The backdrops scroll at 1/4 speed behind the playfield, so the
    foreground tiles must stand out. Every colour is pulled towards the theme's haze by
    its depth (fog()), lights are weak, and a final grade (GRADE) compresses the result
    towards the haze colour and caps its brightness.
  * They tile horizontally. The camera is orthographic and 480 px = TILE_W metres wide;
    every scene object is copied to x - TILE_W and x + TILE_W, so anything crossing an edge
    continues on the other side, and column 479 runs on into column 0.
  * One shared surface material reads its colour from the object colour and its glow
    strength from the object property "emit", so a scene compiles only a few shaders.
    Soft transparent planes (mist bands, light shafts, lamp halos) use three more.
"""
from __future__ import annotations

import math
import os
import random
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import mix, rgb_of, srgb_to_linear  # noqa: E402

BG_PPM = 12                       # backdrop pixels per metre
BG_W, BG_H = 480, 148
TILE_W = BG_W / BG_PPM            # 40 m
TILE_H = BG_H / BG_PPM            # 12.33 m

_mats: dict = {}
_haze = (0, 0, 0)


# ------------------------------------------------------------------ materials

def _node(nt, kind, loc=(0, 0)):
    n = nt.nodes.new(kind)
    n.location = loc
    return n


def surface_mat() -> bpy.types.Material:
    """Principled surface; colour = object colour, emission strength = object['emit']."""
    if "surface" in _mats:
        return _mats["surface"]
    m = bpy.data.materials.new("surface")
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    info = _node(nt, "ShaderNodeObjectInfo", (-500, 0))
    em = _node(nt, "ShaderNodeAttribute", (-500, -250))
    em.attribute_type = "OBJECT"
    em.attribute_name = "emit"
    nt.links.new(info.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(info.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(em.outputs["Fac"], bsdf.inputs["Emission Strength"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    _mats["surface"] = m
    return m


def soft_mat(mode: str) -> bpy.types.Material:
    """Unlit transparent plane: colour = object colour x object['emit'], opacity =
    object['alpha'] x a falloff. mode 'band': fades out at top and bottom (constant across,
    so bands can tile); 'shaft': fades at both sides and towards the bottom; 'halo': radial."""
    key = "soft_" + mode
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        m.blend_method = "BLEND"
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    tc = _node(nt, "ShaderNodeTexCoord", (-1200, 0))
    sep = _node(nt, "ShaderNodeSeparateXYZ", (-1000, 0))
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])

    def bump(sock, loc):   # 0 at 0 and 1, 1 in the middle, smooth
        r = _node(nt, "ShaderNodeValToRGB", loc)
        r.color_ramp.interpolation = "EASE"
        r.color_ramp.elements[0].position = 0.0
        r.color_ramp.elements[0].color = (0, 0, 0, 1)
        r.color_ramp.elements[1].position = 0.5
        r.color_ramp.elements[1].color = (1, 1, 1, 1)
        e = r.color_ramp.elements.new(1.0)
        e.color = (0, 0, 0, 1)
        nt.links.new(sock, r.inputs[0])
        return r.outputs[0]

    if mode == "band":
        fall = bump(sep.outputs["Y"], (-800, 0))
    elif mode == "shaft":
        fx = bump(sep.outputs["X"], (-800, 150))
        r = _node(nt, "ShaderNodeValToRGB", (-800, -150))
        r.color_ramp.interpolation = "EASE"
        r.color_ramp.elements[0].color = (0, 0, 0, 1)
        r.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(sep.outputs["Y"], r.inputs[0])
        mul = _node(nt, "ShaderNodeMath", (-600, 0))
        mul.operation = "MULTIPLY"
        nt.links.new(fx, mul.inputs[0])
        nt.links.new(r.outputs[0], mul.inputs[1])
        fall = mul.outputs[0]
    else:  # halo
        vec = _node(nt, "ShaderNodeVectorMath", (-800, 0))
        vec.operation = "DISTANCE"
        vec.inputs[1].default_value = (0.5, 0.5, 0.5)
        nt.links.new(tc.outputs["Generated"], vec.inputs[0])
        r = _node(nt, "ShaderNodeValToRGB", (-600, 0))
        r.color_ramp.interpolation = "EASE"
        r.color_ramp.elements[0].position = 0.0
        r.color_ramp.elements[0].color = (1, 1, 1, 1)
        r.color_ramp.elements[1].position = 0.5
        r.color_ramp.elements[1].color = (0, 0, 0, 1)
        nt.links.new(vec.outputs["Value"], r.inputs[0])
        fall = r.outputs[0]
    info = _node(nt, "ShaderNodeObjectInfo", (-800, 300))
    a = _node(nt, "ShaderNodeAttribute", (-800, -400))
    a.attribute_type = "OBJECT"
    a.attribute_name = "alpha"
    e = _node(nt, "ShaderNodeAttribute", (-800, 450))
    e.attribute_type = "OBJECT"
    e.attribute_name = "emit"
    fac = _node(nt, "ShaderNodeMath", (-400, -100))
    fac.operation = "MULTIPLY"
    nt.links.new(fall, fac.inputs[0])
    nt.links.new(a.outputs["Fac"], fac.inputs[1])
    emis = _node(nt, "ShaderNodeEmission", (-400, 200))
    nt.links.new(info.outputs["Color"], emis.inputs["Color"])
    nt.links.new(e.outputs["Fac"], emis.inputs["Strength"])
    tr = _node(nt, "ShaderNodeBsdfTransparent", (-400, 0))
    mx = _node(nt, "ShaderNodeMixShader", (-150, 0))
    nt.links.new(fac.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(emis.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    _mats[key] = m
    return m


def sky_mat(stops) -> bpy.types.Material:
    """Unlit vertical gradient over the plane's height: stops = [(0..1 from the bottom, colour)]."""
    m = bpy.data.materials.new("sky")
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    tc = _node(nt, "ShaderNodeTexCoord", (-900, 0))
    sep = _node(nt, "ShaderNodeSeparateXYZ", (-700, 0))
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    r = _node(nt, "ShaderNodeValToRGB", (-500, 0))
    r.color_ramp.interpolation = "LINEAR"
    els = r.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, c) in zip(els, stops):
        el.position = pos
        el.color = (*[srgb_to_linear(v / 255) for v in rgb_of(c)], 1.0)
    nt.links.new(sep.outputs["Y"], r.inputs[0])
    em = _node(nt, "ShaderNodeEmission", (-250, 0))
    nt.links.new(r.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m


# ------------------------------------------------------------------ scene helpers

def fog(c, d: float):
    """Colour c seen through d (0 = none .. 1 = all haze) of the scene's haze."""
    return mix(c, _haze, max(0.0, min(1.0, d)))


def _paint(o, c, emit=0.0, alpha=None):
    o.color = (*[srgb_to_linear(v / 255) for v in rgb_of(c)], 1.0)
    o["emit"] = float(emit)
    if alpha is not None:
        o["alpha"] = float(alpha)
    return o


def solid(kind, loc, size, c, rot=(0, 0, 0), emit=0.0, parent=None, segments=12, flat=True, subdiv=1):
    """A lit primitive in colour c. kind: cube sphere ico cyl cone torus."""
    seg = subdiv if kind == "ico" else segments
    o = kit._prim(kind, kind, loc, size, rot, (0, 0, 0), parent, seg, flat=flat)
    o.data.materials.clear()
    o.data.materials.append(surface_mat())
    return _paint(o, c, emit)


def soft(mode, loc, size, c, alpha, emit=1.0, rot=(0, 0, 0)):
    """A soft transparent plane facing the camera: size = (width, height)."""
    o = kit._prim("plane", "soft_" + mode, loc, (size[0], size[1], 1), (90 + rot[0], rot[1], rot[2]), (0, 0, 0), None)
    o.data.materials.clear()
    o.data.materials.append(soft_mat(mode))
    return _paint(o, c, emit, alpha)


def point_light(loc, c, watts, radius=0.3):
    ld = bpy.data.lights.new("lamp", "POINT")
    ld.energy = watts
    ld.color = [srgb_to_linear(v / 255) for v in rgb_of(c)]
    ld.shadow_soft_size = radius
    o = bpy.data.objects.new("lamp", ld)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    return o


def sun(rot, c, strength):
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = strength
    ld.color = [srgb_to_linear(v / 255) for v in rgb_of(c)]
    ld.angle = math.radians(8)
    o = bpy.data.objects.new("sun", ld)
    o.rotation_euler = [math.radians(a) for a in rot]
    bpy.context.scene.collection.objects.link(o)
    return o


def setup(w, h, haze, sky_stops, ambient, ambient_strength=1.0, ppm=BG_PPM):
    """Fresh EEVEE scene with an orthographic camera over x -w/2..w/2, z 0..h (metres)."""
    global _haze
    kit.reset()
    _mats.clear()
    _haze = rgb_of(haze)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    ww, hh = w / ppm, h / ppm
    kit.ortho_camera(w, h, (0.0, hh / 2), ppm=ppm, transparent=False)
    sc.render.filter_size = 1.0
    sc.eevee.taa_render_samples = 16
    try:
        sc.eevee.use_raytracing = False
    except Exception:
        pass
    wd = bpy.data.worlds.new("world")
    sc.world = wd
    bg = wd.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*[srgb_to_linear(v / 255) for v in rgb_of(ambient)], 1.0)
    bg.inputs["Strength"].default_value = ambient_strength
    # the sky: a gradient plane behind everything, exactly the frame's height
    sky = kit._prim("plane", "sky", (0, 150, hh / 2), (ww * 3, hh, 1), (90, 0, 0), (0, 0, 0), None)
    sky.data.materials.clear()
    sky.data.materials.append(sky_mat(sky_stops))
    return ww, hh


def tile_horizontally(width_m: float):
    """Copy every scene object (except the camera and sky) to x - width_m and x + width_m,
    so the frame wraps around seamlessly. (Collection instances would be lighter, but EEVEE
    gives instanced objects the instancer's object colour, which breaks surface_mat.)"""
    sc = bpy.context.scene
    roots = [o for o in sc.objects if o.parent is None and o.type != "CAMERA" and not o.name.startswith("sky")]

    def dup(o, parent):
        c = o.copy()
        sc.collection.objects.link(c)
        if parent is not None:
            c.parent = parent
            c.matrix_parent_inverse = o.matrix_parent_inverse.copy()
        for ch in o.children:
            dup(ch, c)
        return c

    for dx in (-width_m, width_m):
        for o in roots:
            c = dup(o, None)
            c.location.x += dx


# ------------------------------------------------------------------ grading

def grade(path, haze, keep: float, cap: float, gain: float = 1.0):
    """Pull the render towards the haze colour (keep = share of the original contrast),
    scale it by gain, and cap its brightness (cap = max channel value 0..255). Writes the
    file in place."""
    import numpy as np
    a = kit._read_png(path).astype(np.float64)
    hz = np.array(rgb_of(haze), dtype=np.float64)
    rgb = a[..., :3]
    rgb = (hz + (rgb - hz) * keep) * gain
    m = rgb.max(axis=2, keepdims=True)
    over = np.maximum(m / cap, 1.0)
    rgb = rgb / over
    a[..., :3] = np.clip(rgb, 0, 255)
    a[..., 3] = 255
    kit.write_png(path, a.round().astype(np.int32))


def out_path(name):
    return os.path.join(kit.RENDERS, name, "scene.png" if name == "title" else "far.png")


def finish(name, haze, keep=0.8, cap=200, tile=True, gain=1.0):
    if tile:
        tile_horizontally(TILE_W)
    p = out_path(name)
    kit.render_to(p)
    grade(p, haze, keep, cap, gain)
    kit.save_blend(name)
    return p


# ================================================================== the scenes

def bg_moss():
    """Mossgate Hollow: a misty hollow of mossy boulders and ferns at dawn."""
    haze = (112, 98, 128)
    setup(BG_W, BG_H, haze, [(0.0, (124, 100, 132)), (0.3, (156, 116, 138)), (0.5, (124, 94, 134)),
                             (0.78, (82, 60, 108)), (1.0, (50, 36, 82))], (130, 116, 150), 0.9)
    rnd = random.Random("moss")
    sun((62, 0, -40), (255, 218, 196), 2.4)
    soft("halo", (6, 140, 4.2), (18, 9), (200, 146, 146), 0.35)
    # far wall of the hollow: tall mossy crags with pines along the top
    for i in range(8):
        x = -20 + i * 5 + rnd.uniform(-1, 1)
        h = rnd.uniform(5.5, 9.0)
        cw = rnd.uniform(4.5, 6.5)
        solid("ico", (x, 95, h / 2 - 0.5), (cw, 4, h), fog("stone1", 0.6),
              rot=(0, rnd.uniform(-8, 8), rnd.uniform(0, 90)), subdiv=2)
        solid("ico", (x, 93.5, h - 1.3), (cw * 0.8, 3.2, 1.4), fog("moss1", 0.4), subdiv=2)
        for k in range(rnd.randint(2, 4)):
            ph = rnd.uniform(1.6, 2.8)
            solid("cone", (x + rnd.uniform(-cw / 3, cw / 3), 92, h - 1.0 + ph / 2), (0.9, 0.9, ph),
                  fog("moss0", 0.4), segments=6)
    soft("band", (0, 75, 2.4), (TILE_W, 4.0), haze, 0.55)
    # middle: slim old trees rising out of frame, standing stones and boulder piles
    for i in range(3):
        x = -17 + i * 40 / 3 + rnd.uniform(-1, 1)
        solid("cyl", (x, 50, TILE_H / 2), (1.0, 1.0, TILE_H + 1), fog("wood1", 0.42), rot=(0, rnd.uniform(-4, 4), 0))
        for sx in (-1, 1):
            solid("cyl", (x + sx * 1.2, 50, 9.6), (0.3, 0.3, 3.0), fog("wood1", 0.42), rot=(0, sx * 50, 0))
        for k in range(8):
            solid("ico", (x + rnd.uniform(-3.5, 3.5), 48 + k * 0.1, rnd.uniform(10.0, 13.0)),
                  (rnd.uniform(2.4, 3.8), 2.5, rnd.uniform(1.6, 2.4)),
                  fog(rnd.choice(["moss1", "moss2"]), 0.3), rot=(0, 0, rnd.uniform(0, 90)), subdiv=2)
    for i in range(5):
        x = -20 + i * 8 + 3 + rnd.uniform(-1.5, 1.5)
        h = rnd.uniform(2.6, 4.2)
        solid("ico", (x, 45, h / 2), (1.6, 1.4, h), fog("stone1", 0.36), rot=(0, rnd.uniform(-10, 10), 30), subdiv=1)
        solid("ico", (x, 44.4, h - 0.3), (1.8, 1.5, 0.9), fog("moss2", 0.25), subdiv=1)
        for k in range(2):
            r = rnd.uniform(1.2, 2.0)
            bx = x + rnd.uniform(1.5, 3.5) * (1 if k else -1)
            solid("ico", (bx, 46, r * 0.55), (r * 2.2, r * 2, r * 1.5), fog("stone1", 0.36),
                  rot=(rnd.uniform(0, 30), rnd.uniform(0, 30), rnd.uniform(0, 90)), subdiv=2)
            solid("ico", (bx, 45.4, r * 1.05), (r * 2.0, r * 1.8, r * 0.7), fog("moss2", 0.25), subdiv=2)
    soft("band", (0, 32, 1.0), (TILE_W, 2.4), haze, 0.45)
    # near: moss mounds, boulders and fern clumps along the ground
    solid("cube", (0, 25, -0.2), (TILE_W, 30, 0.8), fog("moss0", 0.3))
    for i in range(9):
        x = -20 + i * 40 / 9 + rnd.uniform(-1, 1)
        solid("sphere", (x, 22, 0.0), (rnd.uniform(4, 6), 2, rnd.uniform(1.0, 1.8)), fog("moss1", 0.26),
              segments=12, flat=False)
    for i in range(4):
        x = -20 + i * 10 + rnd.uniform(-2, 2)
        r = rnd.uniform(0.9, 1.4)
        solid("ico", (x, 18, r * 0.5), (r * 2.4, r * 2, r * 1.6), fog("stone1", 0.22),
              rot=(rnd.uniform(0, 30), rnd.uniform(0, 30), rnd.uniform(0, 90)), subdiv=2)
        solid("ico", (x + 0.2, 17.6, r * 0.95), (r * 2.1, r * 1.8, r * 0.7), fog("moss2", 0.2), subdiv=2)
    for i in range(14):
        x = rnd.uniform(-20, 20)
        for k in range(7):   # a fan of fronds
            a = -70 + k * 140 / 6 + rnd.uniform(-8, 8)
            ln = rnd.uniform(1.0, 1.8)
            solid("cone", (x + math.sin(math.radians(a)) * ln / 2, 15, math.cos(math.radians(a)) * ln / 2),
                  (0.38, 0.12, ln), fog("moss2" if k % 2 else "moss1", 0.3), rot=(0, a, 0), segments=4)
    soft("band", (0, 10, 0.3), (TILE_W, 1.4), haze, 0.3)
    return finish("bg_moss", haze, keep=0.78, cap=170, gain=0.66)


def bg_mine():
    """Lantern Mines: a deep gallery of timber sets, with lantern glows far off."""
    haze = (46, 40, 58)
    setup(BG_W, BG_H, haze, [(0.0, (34, 28, 42)), (0.5, (46, 40, 58)), (1.0, (26, 22, 36))], (120, 110, 130), 0.9)
    rnd = random.Random("mine")
    sun((40, 0, -30), (200, 180, 200), 0.5)
    # rock wall and roof
    for i in range(46):
        x = rnd.uniform(-20, 20)
        z = rnd.choice([rnd.uniform(0, 12.5), rnd.uniform(9.5, 12.8)])
        r = rnd.uniform(1.2, 2.6)
        c = rnd.choice(["stone0", "stone1", "wood0"])
        solid("ico", (x, 62 + rnd.uniform(-4, 4), z), (r * 2, r, r * 1.6), fog(c, 0.35),
              rot=(rnd.uniform(0, 60), rnd.uniform(0, 60), rnd.uniform(0, 60)), subdiv=1)
    # far timber sets, far lanterns (glows only)
    for i in range(4):
        x = -15 + i * 10
        for sx in (-1.4, 1.4):
            solid("cube", (x + sx, 50, 3.5), (0.3, 0.3, 7), fog("wood1", 0.62))
        solid("cube", (x, 50, 7.1), (3.4, 0.35, 0.35), fog("wood1", 0.62))
        solid("cube", (x, 49.8, 5.2), (0.25, 0.25, 0.35), fog("fire4", 0.35), emit=3.0)
        soft("halo", (x, 49.5, 5.2), (2.6, 2.6), (220, 150, 70), 0.3, emit=0.9)
        point_light((x, 48.5, 5.0), "fire4", 25, 0.5)
    # near timber sets with lanterns
    for i in range(3):
        x = -20 + 40 / 3 * i + 4
        for sx in (-2.2, 2.2):
            solid("cube", (x + sx, 30, 4.5), (0.5, 0.5, 9.4), fog("wood1", 0.35))
            solid("cube", (x + sx * 0.72, 29.8, 8.3), (0.24, 0.24, 2.0), fog("wood1", 0.35),
                  rot=(0, 45 if sx > 0 else -45, 0))
        solid("cube", (x, 30, 9.3), (5.6, 0.55, 0.55), fog("wood1", 0.35))
        for k in range(5):   # lagging planks over the cap
            solid("cube", (x - 2 + k, 30.4, 9.75), (0.8, 0.9, 0.15), fog("wood0", 0.3))
        solid("cube", (x + 1.4, 29.2, 7.9), (0.05, 0.05, 1.0), fog("stone1", 0.3))
        solid("cube", (x + 1.4, 29.2, 7.2), (0.35, 0.35, 0.45), fog("fire4", 0.2), emit=4.0)
        soft("halo", (x + 1.4, 28.8, 7.2), (3.4, 3.4), (230, 160, 70), 0.3, emit=0.9)
        point_light((x + 1.4, 27.5, 7.0), "fire4", 60, 0.4)
    # floor, rails and sleepers
    solid("cube", (0, 30, -0.3), (TILE_W, 50, 1.0), fog("stone0", 0.3))
    for k in range(40):
        solid("cube", (-20 + k + 0.5, 22, 0.25), (0.25, 1.6, 0.14), fog("wood0", 0.3))
    for dy in (-0.55, 0.55):
        solid("cube", (0, 22 + dy, 0.4), (TILE_W, 0.1, 0.12), fog("stone2", 0.3))
    # an abandoned cart
    solid("cube", (-6, 22, 1.0), (2.2, 1.3, 1.1), fog("wood1", 0.3))
    solid("cube", (-6, 21.6, 1.55), (2.4, 0.2, 0.12), fog("stone1", 0.3))
    for sx in (-0.7, 0.7):
        solid("cyl", (-6 + sx, 21.3, 0.45), (0.55, 0.55, 0.1), fog("stone1", 0.3), rot=(90, 0, 0))
    soft("band", (0, 40, 1.0), (TILE_W, 3.0), (60, 44, 50), 0.35)
    return finish("bg_mine", haze, keep=0.8, cap=170)


def bg_water():
    """Sunken Aqueduct: flooded arches with shafts of light slanting down through the water."""
    haze = (30, 52, 104)
    setup(BG_W, BG_H, haze, [(0.0, (20, 30, 70)), (0.55, (32, 56, 112)), (0.9, (52, 96, 156)),
                             (1.0, (74, 128, 180))], (60, 100, 160), 0.8)
    rnd = random.Random("water")
    sun((25, 0, 15), (200, 230, 255), 2.0)

    def arcade(y, d, bays, radius, pier_h, deck_h, broken=()):
        """A wall TILE_W long with `bays` round-headed openings cut out of it (boolean
        modifier, applied), voussoirs around each opening and a deck on top."""
        span = TILE_W / bays
        wall = solid("cube", (0, y, deck_h / 2), (TILE_W, 1.4, deck_h), fog("stone1", d))
        cutters = []
        for i in range(bays):
            cx = -TILE_W / 2 + span * (i + 0.5)
            cutters.append(solid("cyl", (cx, y, pier_h), (radius * 2, radius * 2, 3), (0, 0, 0), rot=(90, 0, 0),
                                 segments=32))
            cutters.append(solid("cube", (cx, y, pier_h / 2 - 0.5), (radius * 2, 3, pier_h + 1), (0, 0, 0)))
            if i in broken:
                cutters.append(solid("ico", (cx + 0.8, y, deck_h), (radius * 1.8, 3, radius * 1.6), (0, 0, 0),
                                     rot=(0, 20, 0)))
            for k in range(11):   # voussoirs
                ang = math.radians(180 - k * 18)
                if i in broken and 3 <= k <= 8:
                    continue
                solid("cube", (cx + math.cos(ang) * (radius + 0.35), y - 0.75, pier_h + math.sin(ang) * (radius + 0.35)),
                      (0.75, 0.2, 0.62), fog("stone2", d), rot=(0, 90 - math.degrees(ang), 0))
            for sx in (-1, 1):   # imposts
                solid("cube", (cx + sx * (radius + 0.2), y - 0.8, pier_h), (0.9, 0.2, 0.3), fog("stone2", d))
        for c in cutters:
            mod = wall.modifiers.new("cut", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.object = c
            c.hide_render = True
        dg = bpy.context.evaluated_depsgraph_get()
        mesh = bpy.data.meshes.new_from_object(wall.evaluated_get(dg))
        wall.modifiers.clear()
        wall.data = mesh
        for c in cutters:
            bpy.data.objects.remove(c)
        if not broken:
            solid("cube", (0, y - 0.8, deck_h - 0.2), (TILE_W, 0.2, 0.35), fog("stone2", d))
        return wall

    arcade(80, 0.55, 5, 2.5, 3.8, 7.6)
    soft("band", (0, 60, 5.0), (TILE_W, 6.0), haze, 0.4)
    arcade(35, 0.3, 3, 4.6, 3.4, 10.6, broken=(1,))
    # rubble and weed on the floor
    solid("cube", (0, 30, -0.4), (TILE_W, 40, 1.0), fog("stone0", 0.4))
    for i in range(14):
        x = rnd.uniform(-20, 20)
        r = rnd.uniform(0.4, 1.0)
        solid("ico", (x, 25, 0.2), (r * 2, r, r * 1.3), fog("stone1", 0.4), rot=(rnd.uniform(0, 90), 0, rnd.uniform(0, 90)))
    for i in range(18):
        x = rnd.uniform(-20, 20)
        h = rnd.uniform(1.0, 2.6)
        solid("cone", (x, 22, h / 2), (0.3, 0.2, h), fog("moss1", 0.45), rot=(0, rnd.uniform(-12, 12), 0), segments=4)
    # light shafts from the surface, the shimmering surface, bubbles
    for i in range(5):
        x = -18 + i * 8 + rnd.uniform(-1.5, 1.5)
        soft("shaft", (x, 12, 7.2), (rnd.uniform(1.6, 2.8), 12), "water4", rnd.uniform(0.22, 0.32), emit=1.0,
             rot=(0, 16, 0))
    soft("band", (0, 11, 12.0), (TILE_W, 1.0), "water4", 0.35)
    for i in range(22):
        x, z = rnd.uniform(-20, 20), rnd.uniform(1, 11)
        r = rnd.choice([0.09, 0.09, 0.14])
        solid("sphere", (x, 10, z), (r, r, r), fog("water4", 0.3), emit=0.6, segments=6)
    return finish("bg_water", haze, keep=0.8, cap=170, gain=0.92)


def bg_wood():
    """Thornwood Canopy: giant trunks in a green canopy haze."""
    haze = (44, 88, 64)
    setup(BG_W, BG_H, haze, [(0.0, (30, 60, 50)), (0.45, (48, 96, 66)), (0.75, (70, 120, 70)),
                             (1.0, (34, 74, 50))], (80, 130, 90), 0.8)
    rnd = random.Random("wood")
    sun((50, 0, 25), (240, 250, 200), 2.0)

    def trunk(x, y, r, d, lean=0.0):
        solid("cyl", (x, y, TILE_H / 2 + 1), (r * 2, r * 2, TILE_H + 2), fog("wood1", d), rot=(0, lean, 0),
              segments=10)
        for k in range(3):   # bark ridges
            solid("cube", (x + (k - 1) * r * 0.55, y - r * 0.8, TILE_H / 2 + 1), (r * 0.18, 0.2, TILE_H + 2),
                  fog("wood0", d), rot=(0, lean, 0))
        for sx in (-1, 1):   # root flares
            solid("cone", (x + sx * r * 0.9, y, 0.9), (r * 1.3, r * 1.3, 2.2), fog("wood1", d + 0.03),
                  rot=(0, -sx * 35, 0), segments=8)

    for i in range(6):
        trunk(-20 + i * 40 / 6 + rnd.uniform(-1, 1), 80, rnd.uniform(0.8, 1.2), 0.72)
    soft("band", (0, 60, 4.0), (TILE_W, 6.0), haze, 0.5)
    for i in range(3):
        trunk(-20 + i * 40 / 3 + rnd.uniform(0, 4), 40, rnd.uniform(1.7, 2.2), 0.45, lean=rnd.uniform(-4, 4))
    # a branch crossing between the middle trunks
    solid("cyl", (0, 41, 9.2), (0.9, 0.9, 16), fog("wood1", 0.47), rot=(0, 78, 0), segments=8)
    # canopy clusters across the top
    for i in range(16):
        x = rnd.uniform(-20, 20)
        r = rnd.uniform(2.0, 3.4)
        d = rnd.choice([0.4, 0.55, 0.7])
        solid("ico", (x, 30 + d * 50, rnd.uniform(11.2, 13.0)), (r * 2, r, r * 1.1),
              fog(rnd.choice(["moss1", "moss2"]), d), rot=(0, rnd.uniform(0, 60), rnd.uniform(0, 90)), subdiv=2)
    # hanging vines
    for i in range(12):
        x = rnd.uniform(-20, 20)
        ln = rnd.uniform(2.5, 6.0)
        solid("cube", (x, 25, TILE_H - ln / 2), (0.12, 0.12, ln), fog("moss2", 0.4))
        for k in range(int(ln)):
            solid("ico", (x + rnd.uniform(-0.2, 0.2), 24.8, TILE_H - 0.6 - k), (0.5, 0.3, 0.35),
                  fog("moss3", 0.42), subdiv=1)
    # undergrowth
    solid("cube", (0, 30, -0.3), (TILE_W, 40, 1.0), fog("moss0", 0.4))
    for i in range(12):
        x = rnd.uniform(-20, 20)
        r = rnd.uniform(0.8, 1.6)
        solid("ico", (x, 18, r * 0.35), (r * 2.4, r, r * 1.2), fog("moss1", 0.38), subdiv=2)
    for i in range(4):
        x = -16 + i * 10 + rnd.uniform(-1, 1)
        soft("shaft", (x, 12, 7.0), (rnd.uniform(1.5, 2.6), 12.5), "moss4", 0.16, emit=1.0, rot=(0, -14, 0))
    soft("band", (0, 12, 0.8), (TILE_W, 2.0), haze, 0.4)
    return finish("bg_wood", haze, keep=0.75, cap=150, gain=0.8)


def bg_ember():
    """Ember Foundry: a smelting hall with molten glow from below and hanging chains."""
    haze = (64, 26, 34)
    setup(BG_W, BG_H, haze, [(0.0, (150, 56, 40)), (0.25, (96, 34, 36)), (0.6, (48, 20, 32)),
                             (1.0, (24, 14, 26))], (90, 40, 50), 0.4)
    rnd = random.Random("ember")
    sun((60, 0, 20), (255, 200, 170), 0.6)
    # back wall: brick piers with tall glowing arched windows between them
    for i in range(4):
        x = -20 + i * 10
        solid("cube", (x, 70, TILE_H / 2), (2.4, 1, TILE_H + 1), fog("stone0", 0.4))
        wx = x + 5
        solid("cube", (wx, 71, 5.5), (2.2, 0.4, 6.0), fog("fire1", 0.45), emit=0.6)
        solid("cyl", (wx, 71, 8.5), (2.2, 2.2, 0.4), fog("fire1", 0.45), emit=0.6, rot=(90, 0, 0), segments=16)
        for k in range(3):
            solid("cube", (wx, 70.6, 3.6 + k * 1.8), (2.3, 0.2, 0.18), fog("stone0", 0.4))
        solid("cube", (wx, 70.6, 5.5), (0.18, 0.2, 7.0), fog("stone0", 0.4))
    solid("cube", (0, 73, TILE_H / 2), (TILE_W, 0.5, TILE_H + 1), fog("fire0", 0.55))
    # girder gantry
    solid("cube", (0, 45, 8.6), (TILE_W, 0.6, 0.7), fog("stone1", 0.45))
    solid("cube", (0, 45, 7.6), (TILE_W, 0.5, 0.25), fog("stone1", 0.45))
    for k in range(20):
        x = -20 + k * 2 + 1
        solid("cube", (x, 45, 8.1), (0.18, 0.3, 1.2), fog("stone1", 0.45), rot=(0, 40 if k % 2 else -40, 0))
    for i in range(4):
        solid("cube", (-15 + i * 10, 45, 4), (0.8, 0.8, 8.2), fog("stone1", 0.45))
    # chains with hooks, some carrying buckets
    for i in range(7):
        x = -19 + i * 40 / 7 + rnd.uniform(-1, 1)
        ln = rnd.uniform(3.0, 8.0)
        d = rnd.choice([0.3, 0.45])
        y = 30 if d < 0.4 else 44
        n = int(ln / 0.5)
        for k in range(n):
            solid("torus", (x, y, TILE_H + 0.2 - k * 0.5), (0.55, 0.55, 0.8), fog("stone3", d), rot=(90, 0, 90 * (k % 2)),
                  segments=10)
        zb = TILE_H + 0.2 - n * 0.5
        if i % 3 == 0:
            solid("cyl", (x, y, zb - 0.6), (1.4, 1.4, 1.0), fog("stone1", d), segments=10)
            solid("cyl", (x, y, zb - 0.1), (1.2, 1.2, 0.08), fog("fire4", d), emit=2.0, segments=10)
        else:
            solid("torus", (x + 0.15, y, zb - 0.25), (0.6, 0.6, 0.6), fog("stone2", d), rot=(90, 0, 0), segments=10)
    # vats of molten metal on the floor
    solid("cube", (0, 30, -0.3), (TILE_W, 40, 1.0), fog("stone0", 0.35))
    for i in range(3):
        x = -14 + i * 40 / 3 + rnd.uniform(-1, 1)
        solid("cyl", (x, 25, 0.8), (3.4, 2.4, 1.8), fog("stone1", 0.35), segments=12)
        solid("cyl", (x, 25, 1.72), (3.0, 2.0, 0.08), fog("fire4", 0.15), emit=3.0, segments=12)
        soft("halo", (x, 23, 2.2), (6.0, 4.0), "fire3", 0.35, emit=1.0)
        point_light((x, 22, 2.6), "fire3", 120, 1.0)
    soft("band", (0, 20, 0.2), (TILE_W, 1.8), "fire3", 0.35, emit=1.0)
    for i in range(24):   # sparks
        x, z = rnd.uniform(-20, 20), rnd.uniform(1.5, 8)
        solid("cube", (x, 15, z), (0.09, 0.09, 0.09), fog("fire5", 0.2), emit=2.0)
    soft("band", (0, 35, 3.0), (TILE_W, 5.0), haze, 0.3)
    return finish("bg_ember", haze, keep=0.8, cap=190)


def bg_spire():
    """The Glass Spire: violet crystal spires under a starry night sky."""
    haze = (48, 34, 88)
    setup(BG_W, BG_H, haze, [(0.0, (74, 50, 112)), (0.3, (56, 38, 96)), (0.65, (34, 26, 70)),
                             (1.0, (18, 16, 42))], (90, 80, 150), 0.6)
    rnd = random.Random("spire")
    sun((42, 0, 30), (190, 200, 255), 1.6)
    for i in range(40):   # stars
        x, z = rnd.uniform(-20, 20), rnd.uniform(5.5, 12.2)
        s = rnd.choice([0.085, 0.085, 0.085, 0.16])
        solid("cube", (x, 120, z), (s, s, s), rnd.choice(["dawn0", "stone4", "shard3"]), emit=1.0)
    solid("sphere", (9, 125, 10.2), (1.6, 1.6, 1.6), (150, 140, 170), emit=1.0, segments=16, flat=False)
    soft("halo", (9, 124, 10.2), (5, 5), (120, 110, 160), 0.3)

    def spire(x, y, r, h, d, tilt=0.0, c="violet1"):
        g = kit.empty("spire", (x, y, 0), rot=(0, tilt, 0))
        solid("cyl", (0, 0, h / 2), (r * 2, r * 2, h), fog(c, d), parent=g, segments=6)
        solid("cone", (0, 0, h + r * 1.2), (r * 2, r * 2, r * 2.4), fog("violet2", d - 0.05), parent=g, segments=6)
        return g

    for i in range(9):
        x = -20 + i * 40 / 9 + rnd.uniform(-1, 1)
        spire(x, 85, rnd.uniform(0.4, 0.8), rnd.uniform(3.0, 8.0), 0.62, rnd.uniform(-6, 6))
    soft("band", (0, 70, 1.8), (TILE_W, 3.6), haze, 0.5)
    for i in range(5):   # middle clusters
        x = -20 + i * 8 + rnd.uniform(-1.5, 1.5)
        spire(x, 45, rnd.uniform(0.8, 1.2), rnd.uniform(5.0, 9.0), 0.4, rnd.uniform(-5, 5))
        spire(x + 1.3, 44, rnd.uniform(0.4, 0.7), rnd.uniform(2.0, 4.5), 0.38, rnd.uniform(10, 25), "violet2")
        spire(x - 1.2, 44, rnd.uniform(0.4, 0.6), rnd.uniform(1.5, 3.5), 0.38, rnd.uniform(-25, -10), "violet2")
        soft("halo", (x, 43, 0.8), (5, 3), "violet3", 0.25, emit=1.0)
    solid("cube", (0, 30, -0.3), (TILE_W, 40, 1.0), fog("violet0", 0.35))
    for i in range(14):
        x = rnd.uniform(-20, 20)
        spire(x, 20, rnd.uniform(0.15, 0.3), rnd.uniform(0.5, 1.6), 0.3, rnd.uniform(-30, 30), "violet2")
    return finish("bg_spire", haze, keep=0.8, cap=180)


def title():
    """The title: the Vale at dusk, the glass spire on the horizon. The top 70 px stay calm
    sky for the logo."""
    W, H, PPM = 320, 180, 12
    haze = (104, 72, 120)
    ww, hh = setup(W, H, haze, [(0.0, (180, 110, 110)), (0.36, (236, 150, 96)), (0.46, (200, 110, 110)),
                                (0.6, (120, 70, 120)), (0.8, (70, 44, 104)), (1.0, (40, 30, 80))],
                   (150, 120, 160), 1.0, ppm=PPM)
    rnd = random.Random("title")
    sun((78, 0, 70), (255, 170, 130), 2.4)
    horizon = hh * 0.40   # about row 108
    for i in range(4):   # a few early stars, clear of the logo's middle
        x = rnd.choice([-11.5, -9.5, 9.8, 12]) + rnd.uniform(-0.5, 0.5)
        solid("cube", (x, 130, hh - rnd.uniform(1.0, 2.6)), (0.085, 0.085, 0.085), "dawn0", emit=1.0)
    # the glass spire, far away on the horizon
    g = kit.empty("glassspire", (5.5, 100, horizon - 1.2))
    solid("cyl", (0, 0, 2.2), (0.9, 0.9, 4.4), fog("shard2", 0.2), parent=g, segments=6, emit=0.3)
    solid("cone", (0, 0, 5.0), (0.9, 0.9, 1.3), fog("shard3", 0.1), parent=g, segments=6, emit=0.6)
    for sx, h in ((-0.55, 2.2), (0.6, 2.8), (-0.9, 1.2), (1.0, 1.4)):
        solid("cyl", (sx, 0.3, h / 2), (0.45, 0.45, h), fog("violet2", 0.25), parent=g, segments=6)
        solid("cone", (sx, 0.3, h + 0.3), (0.45, 0.45, 0.6), fog("violet3", 0.2), parent=g, segments=6)
    # far ridge (blue-violet), middle hills (dusky green), near hill with trees and a village
    for i in range(6):
        x = -14 + i * 5.6 + rnd.uniform(-1, 1)
        solid("sphere", (x, 80, horizon - 2.6), (rnd.uniform(7, 10), 3, rnd.uniform(4.6, 6.4)),
              fog("violet1", 0.4), segments=16, flat=False)
    soft("band", (0, 70, horizon - 0.2), (ww + 2, 1.6), (220, 150, 130), 0.45)
    for i in range(5):
        x = -14 + i * 7 + rnd.uniform(-1.5, 1.5)
        solid("sphere", (x, 55, horizon - 4.2), (rnd.uniform(9, 13), 3, rnd.uniform(4.5, 6)), fog("moss1", 0.25),
              segments=16, flat=False)
    # a river winding out of the hills, catching the sky
    for k in range(48):
        t = k / 47
        solid("cube", (-2 + math.sin(t * 5) * 2.5 + t * 3, 45 - t * 10, 0.9 + (1 - t) * 3.2),
              (0.5 + t * 1.8, 0.2, 0.16 + t * 0.12), (214, 150, 140), emit=0.45)
    for i in range(4):
        x = -13 + i * 8.5 + rnd.uniform(-1, 1)
        solid("sphere", (x, 30, 0.2), (rnd.uniform(9, 12), 3, rnd.uniform(3.8, 5.2)), fog("moss1", 0.12),
              segments=16, flat=False)
    for i in range(22):   # trees
        x = rnd.uniform(-13.5, 13.5)
        if -4 < x < 0:
            continue
        z = 1.6 + rnd.uniform(-0.4, 0.6)
        solid("cyl", (x, 25, z + 0.3), (0.18, 0.18, 0.8), fog("wood0", 0.3))
        solid("ico", (x, 25, z + 1.0), (1.0, 0.8, 1.3), fog(rnd.choice(["moss0", "moss1"]), 0.1), subdiv=1)
    # the village: cottages with lit windows and a line of street lamps
    for (x, s) in ((-3.4, 1.0), (-2.0, 0.8), (-0.7, 0.9)):
        solid("cube", (x, 24, 1.3 + s * 0.35), (s, 0.8, s * 0.7), fog("wood2", 0.35))
        solid("cone", (x, 24, 1.3 + s * 0.95), (s * 1.3, 1.0, s * 0.6), fog("fire1", 0.4), rot=(0, 0, 45), segments=4)
        solid("cube", (x + 0.1, 23.5, 1.35 + s * 0.35), (0.16, 0.1, 0.16), "gold2", emit=2.0)
    for k in range(5):
        x = -6 + k * 1.3
        solid("cube", (x, 20, 1.0), (0.06, 0.06, 0.8), fog("stone0", 0.2))
        solid("cube", (x, 19.9, 1.45), (0.14, 0.1, 0.14), "fire5", emit=2.0)
        soft("halo", (x, 19.5, 1.45), (0.9, 0.9), "fire4", 0.45, emit=1.0)
    solid("sphere", (0, 12, -1.6), (ww * 1.3, 3, 4.2), "moss0", segments=24, flat=False)
    p = finish("title", haze, keep=0.92, cap=240, tile=False)
    return p


BACKDROPS = {
    "bg_moss": bg_moss,
    "bg_mine": bg_mine,
    "bg_water": bg_water,
    "bg_wood": bg_wood,
    "bg_ember": bg_ember,
    "bg_spire": bg_spire,
    "title": title,
}


def main():
    names = kit.args() or list(BACKDROPS)
    for n in names:
        t = time.time()
        BACKDROPS[n]()
        print(f"{n}: {time.time() - t:.1f} s")


if __name__ == "__main__":
    main()
