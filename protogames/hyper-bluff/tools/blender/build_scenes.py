"""Hyper Bluff!! Starlight Showdown - procedural Blender art.

Run inside Blender 4.2 (headless):

    blender -b --python tools/blender/build_scenes.py -- [--only table,boss,title,props]
                                                         [--samples N] [--no-render]

Builds every scene from code (no imported models or textures), saves
art/blender/table.blend (scenes Table, Boss, Title) and art/blender/props.blend
(scenes ChipSpin, Chips, StarSpin, Trophy, CoinBurst) and renders raw frames
into art/blender/render/.  tools/blender/pixelize.py turns those into the
final pixel-art PNGs.

Everything is seeded, so a re-run gives the same pictures.
"""
import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art", "blender")
OUT = os.path.join(ART, "render")

W, H = 640, 360        # final background size
BG_SCALE = 2           # backgrounds are rendered at 2x and box-filtered down
SPR_SCALE = 8          # sprites are rendered at 8x
PI = math.pi


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def T(x, y, z):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def S(s):
    return Matrix.Scale(s, 4)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def link(nt, a, b):
    nt.links.new(a, b)


def mat_pbr(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0, spec=0.5):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Specular IOR Level"].default_value = spec
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def mat_emit(name, color, strength=1.0):
    """Flat self-lit colour: renders noise-free, the cel/anime part of the look."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    link(nt, e.outputs[0], out.inputs["Surface"])
    return m


def mat_glow(name, color, strength=1.0):
    """Additive glow (transparent + emission) for beams, halos and streaks."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1)
    e.inputs["Strength"].default_value = strength
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    link(nt, e.outputs[0], add.inputs[0])
    link(nt, tr.outputs[0], add.inputs[1])
    link(nt, add.outputs[0], out.inputs["Surface"])
    return m


def make_world(name, stops, zmin, zmax, light_strength=0.3, clouds=None):
    """Sky gradient by view elevation; dimmer as a light source than to the camera."""
    w = bpy.data.worlds.new(name)
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    link(nt, tc.outputs["Generated"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = zmin
    mr.inputs["From Max"].default_value = zmax
    link(nt, sep.outputs["Z"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*col, 1)
    link(nt, mr.outputs[0], ramp.inputs["Fac"])
    color_out = ramp.outputs["Color"]
    if clouds:
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = clouds["scale"]
        mp.inputs["Location"].default_value = clouds.get("loc", (0, 0, 0))
        link(nt, tc.outputs["Generated"], mp.inputs["Vector"])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = clouds["noise"]
        nz.inputs["Detail"].default_value = 3.0
        nz.inputs["Roughness"].default_value = 0.5
        link(nt, mp.outputs[0], nz.inputs["Vector"])
        cr = nt.nodes.new("ShaderNodeValToRGB")
        cr.color_ramp.elements[0].position = clouds["lo"]
        cr.color_ramp.elements[1].position = clouds["hi"]
        cr.color_ramp.interpolation = "CONSTANT" if clouds.get("hard") else "LINEAR"
        link(nt, nz.outputs["Fac"], cr.inputs["Fac"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        link(nt, cr.outputs["Color"], mix.inputs["Factor"])
        link(nt, color_out, mix.inputs["A"])
        mix.inputs["B"].default_value = (*clouds["color"], 1)
        color_out = mix.outputs["Result"]
    link(nt, color_out, bg.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    ma = nt.nodes.new("ShaderNodeMath")
    ma.operation = "MULTIPLY_ADD"
    link(nt, lp.outputs["Is Camera Ray"], ma.inputs[0])
    ma.inputs[1].default_value = 1.0 - light_strength
    ma.inputs[2].default_value = light_strength
    link(nt, ma.outputs[0], bg.inputs["Strength"])
    link(nt, bg.outputs[0], out.inputs["Surface"])
    return w


class MB:
    """Mesh builder: collect verts / faces / per-face materials, then make one object."""

    def __init__(self):
        self.v, self.f, self.mi, self.sm, self.mats = [], [], [], [], []

    def _m(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, verts, faces, mat, smooth=False, xf=None):
        off = len(self.v)
        for p in verts:
            p = Vector(p)
            if xf is not None:
                p = xf @ p
            self.v.append((p.x, p.y, p.z))
        mi = self._m(mat)
        for f in faces:
            self.f.append([i + off for i in f])
            self.mi.append(mi)
            self.sm.append(smooth)

    def poly(self, pts, mat, xf=None):
        self.add(pts, [list(range(len(pts)))], mat, xf=xf)

    def box(self, lo, hi, mat, xf=None, mats=None):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces = {"front": [0, 1, 5, 4], "right": [1, 2, 6, 5], "back": [2, 3, 7, 6],
                 "left": [3, 0, 4, 7], "top": [4, 5, 6, 7], "bottom": [3, 2, 1, 0]}
        for key, f in faces.items():
            m = (mats or {}).get(key, mat)
            if m is not None:
                self.add(v, [f], m, xf=xf)

    def prism(self, outline, depth, mat, xf=None, side_mat=None, cap_back=True):
        """Outline in local XY, extruded from z=0 to z=depth."""
        n = len(outline)
        bot = [(x, y, 0) for x, y in outline]
        top = [(x, y, depth) for x, y in outline]
        self.add(top, [list(range(n))], mat, xf=xf)
        if cap_back:
            self.add(bot, [list(range(n - 1, -1, -1))], mat, xf=xf)
        sides = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        self.add(bot + top, sides, side_mat or mat, xf=xf)

    def tube(self, path, rx, rz, mat, closed=True, up=(0, 0, 1), segs=10, xf=None):
        up = Vector(up)
        n = len(path)
        path = [Vector(p) for p in path]
        verts = []
        for i, p in enumerate(path):
            a = path[(i - 1) % n] if (closed or i > 0) else p
            b = path[(i + 1) % n] if (closed or i < n - 1) else p
            t = (b - a).normalized()
            nrm = up.cross(t).normalized()
            bn = t.cross(nrm).normalized()
            for k in range(segs):
                ang = 2 * PI * k / segs
                verts.append(p + nrm * math.cos(ang) * rx + bn * math.sin(ang) * rz)
        faces = []
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            for k in range(segs):
                k2 = (k + 1) % segs
                faces.append([i * segs + k, i * segs + k2, j * segs + k2, j * segs + k])
        self.add(verts, faces, mat, smooth=True, xf=xf)

    def revolve(self, profile, mat, segs=32, xf=None, smooth=True):
        verts = []
        for r, z in profile:
            for k in range(segs):
                a = 2 * PI * k / segs
                verts.append((r * math.cos(a), r * math.sin(a), z))
        faces = []
        for i in range(len(profile) - 1):
            for k in range(segs):
                k2 = (k + 1) % segs
                faces.append([i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k])
        self.add(verts, faces, mat, smooth=smooth, xf=xf)

    def chip(self, mats, radius=1.0, thick=0.26, segs=48, rc=0.5, ri=0.68, xf=None):
        """Poker chip, axis = local Z. mats = dict(body, insert, ring, center)."""
        h = thick / 2

        def ring_pts(r, z):
            return [(r * radius * math.cos(2 * PI * (k + 0.5) / segs),
                     r * radius * math.sin(2 * PI * (k + 0.5) / segs), z) for k in range(segs)]

        per = segs // 12
        for z in (h, -h):
            c = ring_pts(rc, z)
            self.add(c, [list(range(segs))], mats["center"], xf=xf)
            a, b, o = ring_pts(rc, z), ring_pts(ri, z), ring_pts(1.0, z)
            v = a + b
            self.add(v, [[k, (k + 1) % segs, segs + (k + 1) % segs, segs + k] for k in range(segs)],
                     mats["ring"], xf=xf)
            v = b + o
            for k in range(segs):
                m = mats["insert"] if (k // per) % 2 == 0 else mats["body"]
                self.add(v, [[k, (k + 1) % segs, segs + (k + 1) % segs, segs + k]], m, xf=xf)
        v = ring_pts(1.0, h) + ring_pts(1.0, -h)
        for k in range(segs):
            m = mats["insert"] if (k // per) % 2 == 0 else mats["body"]
            self.add(v, [[k, (k + 1) % segs, segs + (k + 1) % segs, segs + k]], m, smooth=True, xf=xf)

    def build(self, name, sc, matrix=None, recalc=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for m in self.mats:
            me.materials.append(m)
        me.polygons.foreach_set("material_index", self.mi)
        me.polygons.foreach_set("use_smooth", self.sm)
        me.update()
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(me)
            bm.free()
        ob = bpy.data.objects.new(name, me)
        if matrix is not None:
            ob.matrix_world = matrix
        sc.collection.objects.link(ob)
        return ob


def ellipse(a, b, z, n=128):
    return [(a * math.cos(2 * PI * i / n), b * math.sin(2 * PI * i / n), z) for i in range(n)]


def rrect(w, h, r, n=5):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def star_outline(ro=1.0, ri=0.5, points=5, rot=90):
    pts = []
    for i in range(points * 2):
        r = ro if i % 2 == 0 else ri
        a = math.radians(rot + 180 * i / points)
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def spade_outline(n=48):
    """Spade = upside-down heart curve (the stalk is a second polygon). Height ~1, centred."""
    pts = []
    for i in range(n):
        t = 2 * PI * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x / 34.0, -y / 34.0 + 0.1))
    return pts


class View:
    """Perspective camera looking along +Y with a pitch; maps final-image pixels to world."""

    def __init__(self, pos, pitch_deg, vfov_deg):
        p = math.radians(pitch_deg)
        self.pitch = p
        self.pos = Vector(pos)
        self.fwd = Vector((0, math.cos(p), math.sin(p)))
        self.up = Vector((0, -math.sin(p), math.cos(p)))
        self.right = Vector((1, 0, 0))
        self.f = (H / 2) / math.tan(math.radians(vfov_deg) / 2)

    def p(self, px, py, depth):
        return self.pos + (self.right * (px - W / 2) + self.up * (H / 2 - py) + self.fwd * self.f) * (depth / self.f)

    def frame(self, px, py, depth, euler_deg=(0, 0, 0), scale=1.0):
        """Matrix placing a local object at a pixel/depth. Local +Z faces the camera at euler 0."""
        base = Matrix((self.right, self.up, -self.fwd)).transposed().to_4x4()
        e = Euler([math.radians(a) for a in euler_deg]).to_matrix().to_4x4()
        return Matrix.Translation(self.p(px, py, depth)) @ base @ e @ S(scale)

    def camera(self, sc, name):
        cam = bpy.data.cameras.new(name)
        cam.sensor_width = 36
        cam.lens = self.f * 36 / W
        cam.clip_start = 0.05
        cam.clip_end = 20000
        ob = bpy.data.objects.new(name, cam)
        ob.location = self.pos
        ob.rotation_euler = (PI / 2 + self.pitch, 0, 0)
        sc.collection.objects.link(ob)
        sc.camera = ob
        return ob


def add_light(sc, name, kind, loc, target, energy, color, **kw):
    L = bpy.data.lights.new(name, kind)
    L.energy = energy
    L.color = color
    for k, v in kw.items():
        setattr(L, k, v)
    ob = bpy.data.objects.new(name, L)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(ob)
    return ob


def setup_render(sc, w, h, samples, transparent, denoise):
    sc.render.engine = "CYCLES"
    c = sc.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = False
    c.use_denoising = denoise
    if denoise:
        c.denoiser = "OPENIMAGEDENOISE"
    c.seed = 7
    c.max_bounces = 4
    c.diffuse_bounces = 2
    c.glossy_bounces = 2
    c.transmission_bounces = 2
    c.transparent_max_bounces = 12
    c.sample_clamp_indirect = 3.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.pixel_filter_type = "BLACKMAN_HARRIS"
    c.filter_width = 1.5
    r = sc.render
    r.resolution_x = w
    r.resolution_y = h
    r.resolution_percentage = 100
    r.film_transparent = transparent
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA" if transparent else "RGB"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 90
    r.use_file_extension = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.display_settings.display_device = "sRGB"


def render(sc, filename):
    sc.render.filepath = os.path.join(OUT, filename)
    bpy.ops.render.render(write_still=True, scene=sc.name)
    print("RENDERED", sc.render.filepath, flush=True)


def fresh_file():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0


def save_blend(name):
    for sc in list(bpy.data.scenes):
        if sc.name == "Scene" and len(bpy.data.scenes) > 1:
            bpy.data.scenes.remove(sc)
    os.makedirs(ART, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ART, name), compress=True)
    print("SAVED", name, flush=True)


# --------------------------------------------------------------------------
# city skyline (all self-lit, so it renders clean and flat like a painted cel)
# --------------------------------------------------------------------------
def add_windows(mb, rng, a0, a1, fixed, z_top, z_bot, lit, wins, cell, axis, max_rows=24):
    cw, ch = cell
    n = int((a1 - a0 - 0.6 * cw) / cw)
    if n < 1:
        return
    start = (a0 + a1) / 2 - n * cw / 2
    rows = min(max_rows, int((z_top - z_bot - 1.0) / ch))
    main = rng.choice(wins)
    for r in range(rows):
        zc = z_top - 0.9 * ch - r * ch
        full = rng.random() < 0.10
        dark = rng.random() < 0.12
        if dark:
            continue
        for c in range(n):
            if full or rng.random() < lit:
                m = main if rng.random() < 0.8 else rng.choice(wins)
                ac = start + c * cw + cw / 2
                hw, hh = cw * 0.31, ch * 0.29
                if axis == "x":
                    v = [(ac - hw, fixed, zc - hh), (ac + hw, fixed, zc - hh),
                         (ac + hw, fixed, zc + hh), (ac - hw, fixed, zc + hh)]
                else:
                    v = [(fixed, ac - hw, zc - hh), (fixed, ac + hw, zc - hh),
                         (fixed, ac + hw, zc + hh), (fixed, ac - hw, zc + hh)]
                mb.add(v, [[0, 1, 2, 3]], m)


def add_building(mb, rng, x0, x1, y0, y1, ground, top, bm, wins, lit, cell, extras):
    mb.box((x0, y0, ground), (x1, y1, top), bm["front"],
           mats={"left": bm["side"], "right": bm["side"], "top": bm["top"], "back": None, "bottom": None})
    add_windows(mb, rng, x0, x1, y0 - 0.08, top, ground, lit, wins, cell, "x")
    sx = x1 + 0.08 if (x0 + x1) / 2 < 0 else x0 - 0.08
    add_windows(mb, rng, y0, y1, sx, top, ground, lit * 0.6, wins, cell, "y")
    w = x1 - x0
    r = rng.random()
    if r < 0.40:                                   # setback crown
        inset = w * rng.uniform(0.15, 0.28)
        h2 = rng.uniform(0.25, 0.6) * w
        mb.box((x0 + inset, y0 + 1, top), (x1 - inset, y1 - 1, top + h2), bm["front"],
               mats={"left": bm["side"], "right": bm["side"], "top": bm["top"], "back": None, "bottom": None})
        add_windows(mb, rng, x0 + inset, x1 - inset, y0 + 0.92, top + h2, top, lit, wins, cell, "x")
        top += h2
    if r > 0.55 and extras:                        # antenna with a beacon
        cx = (x0 + x1) / 2 + rng.uniform(-0.2, 0.2) * w
        ah = rng.uniform(0.3, 0.7) * w
        t = w * 0.03
        mb.box((cx - t, y0 + 1, top), (cx + t, y0 + 1 + 2 * t, top + ah), bm["side"])
        b = w * 0.07
        mb.add([(cx - b, y0 + 0.9, top + ah - b), (cx + b, y0 + 0.9, top + ah - b),
                (cx + b, y0 + 0.9, top + ah + b), (cx - b, y0 + 0.9, top + ah + b)], [[0, 1, 2, 3]],
               extras["beacon"])
    elif r > 0.40 and extras and w > 9:            # blank neon sign frame on the roof edge
        sw, sh = w * 0.6, w * 0.16
        cx = (x0 + x1) / 2
        z = top - sh * 1.6
        m = rng.choice(extras["signs"])
        mb.add([(cx - sw / 2, y0 - 0.12, z), (cx + sw / 2, y0 - 0.12, z),
                (cx + sw / 2, y0 - 0.12, z + sh), (cx - sw / 2, y0 - 0.12, z + sh)], [[0, 1, 2, 3]], m)


def add_city(mb, rng, rows, ground, th, prefix):
    for ri, row in enumerate(rows):
        d = row["depth"]
        bm = {k: mat_emit(f"{prefix}_bld{ri}_{k}", lerp(lerp(th["body_near"], th["body_far"], d),
                                                         (0, 0, 0), {"front": 0.0, "side": 0.35, "top": -0.5}[k] * (1 - d) if k != "top" else 0),
                          1.0) for k in ("front", "side", "top")}
        bm["top"] = mat_emit(f"{prefix}_bld{ri}_roof", lerp(lerp(th["body_near"], th["body_far"], d), th["roof_tint"], 0.35), 1.0)
        dim = 1.0 - 0.45 * d
        wins = [mat_emit(f"{prefix}_win{ri}_{i}", lerp(c, th["body_far"], 0.35 * d), dim)
                for i, c in enumerate(th["win"])]
        extras = {"beacon": mat_emit(f"{prefix}_beacon", th["beacon"], 1.5),
                  "signs": [mat_emit(f"{prefix}_sign{i}", c, 1.2) for i, c in enumerate(th["signs"])]}
        cell = (2.9 * (1 + 0.9 * d), 3.5 * (1 + 0.9 * d))
        x = row["x0"]
        while x < row["x1"]:
            w = rng.uniform(*row["w"])
            dep = rng.uniform(10, 18)
            top = rng.uniform(*row["top"])
            if rng.random() < row.get("tower", 0.2):
                top = row["top"][1] + rng.uniform(*row["tower_add"])
            y0 = row["y"] + rng.uniform(-6, 6)
            add_building(mb, rng, x, x + w, y0, y0 + dep, ground, top, bm, wins,
                         th["lit"] * rng.uniform(0.6, 1.3), cell, extras)
            x += w + rng.uniform(*row["gap"])


def bb_disc(mb, view, px, py, depth, r, mat, segs=40):
    mb.poly([view.p(px + r * math.cos(2 * PI * i / segs), py + r * math.sin(2 * PI * i / segs), depth)
             for i in range(segs)], mat)


def bb_poly(mb, view, pts, depth, mat):
    mb.poly([view.p(x, y, depth) for x, y in pts], mat)


def add_stars(mb, view, rng, count, box, depth, mats, avoid=None):
    x0, y0, x1, y1 = box
    n = 0
    while n < count:
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if avoid and avoid(x, y):
            continue
        n += 1
        m = rng.choice(mats)
        s = 0.5
        if rng.random() < 0.12:                    # a few plus-shaped sparkles
            bb_poly(mb, view, [(x - 1.5, y - 0.5), (x + 1.5, y - 0.5), (x + 1.5, y + 0.5), (x - 1.5, y + 0.5)], depth, m)
            bb_poly(mb, view, [(x - 0.5, y - 1.5), (x + 0.5, y - 1.5), (x + 0.5, y + 1.5), (x - 0.5, y + 1.5)], depth, m)
        else:
            bb_poly(mb, view, [(x - s, y - s), (x + s, y - s), (x + s, y + s), (x - s, y + s)], depth, m)


# --------------------------------------------------------------------------
# table scene (and its boss relight)
# --------------------------------------------------------------------------
THEMES = {
    "table": dict(
        felt=(0.007, 0.105, 0.042), rail=(0.16, 0.025, 0.09), trim=(0.95, 0.62, 0.15),
        chair=(0.035, 0.012, 0.06), chair_in=(0.07, 0.018, 0.10),
        wall=(0.04, 0.015, 0.09), floor=(0.03, 0.015, 0.06), frame=(0.006, 0.004, 0.02),
        neon_l=(1.0, 0.05, 0.55), neon_r=(0.05, 0.8, 1.0), neon_e=5.0,
        spot=(1.0, 0.92, 0.78), spot_e=330.0,
        rim_l=(1.0, 0.08, 0.6), rim_r=(0.08, 0.75, 1.0), rim_e=230.0,
        sky=[(0.0, (0.75, 0.12, 0.55)), (0.4, (0.22, 0.05, 0.45)), (1.0, (0.03, 0.02, 0.16))],
        sky_light=0.10, clouds=None,
        win=[(1.0, 0.82, 0.30), (0.25, 0.95, 1.0), (1.0, 0.30, 0.75), (1.0, 0.95, 0.75)], lit=0.36,
        body_near=(0.010, 0.008, 0.035), body_far=(0.17, 0.045, 0.27), roof_tint=(0.25, 0.05, 0.4),
        beacon=(1.0, 0.1, 0.1), signs=[(1.0, 0.1, 0.6), (0.1, 0.9, 1.0), (1.0, 0.8, 0.2)],
        moon=(1.0, 0.96, 0.80), moon_spot=(0.88, 0.80, 0.70), moon_halo=(0.5, 0.25, 0.9), moon_r=19, moon_px=(486, 27),
        beam=(0.45, 0.85, 1.0), stars=[(1, 1, 1), (0.6, 0.9, 1.0), (1.0, 0.7, 0.9)], bolt=None,
    ),
    "boss": dict(
        felt=(0.075, 0.005, 0.012), rail=(0.03, 0.01, 0.012), trim=(1.0, 0.62, 0.1),
        chair=(0.03, 0.004, 0.006), chair_in=(0.08, 0.006, 0.01),
        wall=(0.05, 0.008, 0.012), floor=(0.03, 0.006, 0.008), frame=(0.012, 0.002, 0.003),
        neon_l=(1.0, 0.06, 0.02), neon_r=(1.0, 0.55, 0.05), neon_e=5.0,
        spot=(1.0, 0.72, 0.30), spot_e=300.0,
        rim_l=(1.0, 0.04, 0.02), rim_r=(1.0, 0.5, 0.05), rim_e=300.0,
        sky=[(0.0, (0.85, 0.16, 0.02)), (0.35, (0.28, 0.02, 0.03)), (1.0, (0.035, 0.0, 0.012))],
        sky_light=0.08,
        clouds=dict(scale=(1.0, 1.0, 9.0), noise=3.2, lo=0.50, hi=0.56, color=(0.012, 0.0, 0.006), loc=(3.1, 0.4, 0.0)),
        win=[(1.0, 0.25, 0.04), (1.0, 0.6, 0.1), (0.9, 0.06, 0.06)], lit=0.17,
        body_near=(0.012, 0.002, 0.004), body_far=(0.20, 0.02, 0.025), roof_tint=(0.4, 0.05, 0.02),
        beacon=(1.0, 0.8, 0.2), signs=[(1.0, 0.1, 0.05), (1.0, 0.6, 0.1)],
        moon=(1.0, 0.16, 0.06), moon_spot=(0.72, 0.06, 0.03), moon_halo=(0.9, 0.12, 0.02), moon_r=25, moon_px=(98, 30),
        beam=None, stars=[(1.0, 0.6, 0.4), (1.0, 0.85, 0.6)],
        bolt=(1.0, 0.92, 0.6),
    ),
}

TABLE_Z = 0.78
TABLE_VIEW = dict(pos=(0, -1.08, 1.14), pitch_deg=-17.3, vfov_deg=50.0)


def build_table(scene_name, theme, samples):
    th = THEMES[theme]
    p = scene_name
    sc = bpy.data.scenes.new(scene_name)
    setup_render(sc, W * BG_SCALE, H * BG_SCALE, samples, False, True)
    view = View(**TABLE_VIEW)
    view.camera(sc, p + "_Camera")
    rng = random.Random(1995)

    # --- table -----------------------------------------------------------
    a, b = 1.70, 1.00
    mb = MB()
    mb.poly(ellipse(a + 0.02, b + 0.02, TABLE_Z), mat_pbr(p + "_felt", th["felt"], rough=0.95, spec=0.1))
    mb.build(p + "_Felt", sc)
    mb = MB()
    mb.tube(ellipse(a, b, TABLE_Z + 0.03), 0.115, 0.075, mat_pbr(p + "_rail", th["rail"], rough=0.38, spec=0.6), segs=14)
    mb.build(p + "_Rail", sc)
    mb = MB()
    mb.tube(ellipse(a - 0.125, b - 0.125, TABLE_Z + 0.008), 0.012, 0.01,
            mat_pbr(p + "_trim", th["trim"], rough=0.3, metal=0.6, emit=th["trim"], emit_strength=0.25), segs=6)
    mb.build(p + "_RailTrim", sc)
    mb = MB()
    dark = mat_pbr(p + "_frame", th["frame"], rough=0.6)
    mb.prism([(x, y) for x, y, _ in ellipse(a + 0.05, b + 0.05, 0, 64)], TABLE_Z - 0.05, dark)
    mb.build(p + "_TableBody", sc)

    # --- the rival's empty high-backed chair ------------------------------
    mb = MB()
    cm = mat_pbr(p + "_chair", th["chair"], rough=0.45, spec=0.5)
    cin = mat_pbr(p + "_chair_inset", th["chair_in"], rough=0.6, spec=0.3)

    def chair_outline(wb, wt, z0, zs, ztop, n=14):
        pts = [(-wb / 2, z0), (wb / 2, z0), (wt / 2, zs)]
        for i in range(1, n):
            ang = PI * i / n
            pts.append((wt / 2 * math.cos(ang), zs + (ztop - zs) * math.sin(ang)))
        pts.append((-wt / 2, zs))
        return pts

    cxf = T(0, 1.62, 0) @ R("X", 90)                # local XY -> world XZ, depth towards the camera
    mb.prism(chair_outline(0.74, 0.86, 0.25, 1.28, 1.455), 0.14, cm, xf=cxf)
    mb.prism(chair_outline(0.56, 0.68, 0.60, 1.20, 1.36), 0.02, cin, xf=T(0, 1.62 - 0.14, 0) @ R("X", 90))
    mb.build(p + "_Chair", sc)

    # --- room: window wall, mullions, floor, neon ---------------------------
    wy = 4.6
    mb = MB()
    wall = mat_pbr(p + "_wall", th["wall"], rough=0.7)
    floor = mat_pbr(p + "_floor", th["floor"], rough=0.22, spec=0.6)
    mb.box((-8, -3, -0.05), (8, wy + 0.4, 0.0), floor)
    mb.box((-8, wy, 0), (-3.5, wy + 0.3, 3.6), wall)
    mb.box((3.5, wy, 0), (8, wy + 0.3, 3.6), wall)
    mb.box((-8.3, -3, 0), (-8, wy, 3.6), wall)
    mb.box((8, -3, 0), (8.3, wy, 3.6), wall)
    mb.box((-8, -3, 3.6), (8, wy + 0.4, 3.7), wall)
    for x in (-1.75, 0.0, 1.75):
        mb.box((x - 0.04, wy, 0), (x + 0.04, wy + 0.08, 3.6), dark)
    mb.box((-3.5, wy, 1.74), (3.5, wy + 0.08, 1.80), dark)
    mb.box((-3.5, wy, 0.0), (3.5, wy + 0.08, 0.10), dark)
    mb.build(p + "_Room", sc)
    mb = MB()
    mb.box((-3.62, wy - 0.06, 0), (-3.54, wy, 3.6), mat_emit(p + "_neon_l", th["neon_l"], th["neon_e"]))
    mb.box((3.54, wy - 0.06, 0), (3.62, wy, 3.6), mat_emit(p + "_neon_r", th["neon_r"], th["neon_e"]))
    mb.build(p + "_Neon", sc)

    # --- city + sky ----------------------------------------------------------
    cz = view.pos.z
    rows = [
        dict(y=75, x0=-125, x1=125, w=(9, 16), gap=(1.5, 7), top=(cz - 30, cz + 2), tower=0.22, tower_add=(1, 6), depth=0.0),
        dict(y=140, x0=-215, x1=215, w=(11, 20), gap=(2, 11), top=(cz - 16, cz + 4), tower=0.2, tower_add=(1, 7), depth=0.33),
        dict(y=240, x0=-350, x1=350, w=(15, 27), gap=(4, 18), top=(cz - 8, cz + 7), tower=0.2, tower_add=(2, 11), depth=0.66),
        dict(y=400, x0=-580, x1=580, w=(22, 42), gap=(6, 30), top=(cz - 2, cz + 10), tower=0.2, tower_add=(3, 14), depth=1.0),
    ]
    mb = MB()
    add_city(mb, rng, rows, -160.0, th, p)
    mb.build(p + "_City", sc)

    mb = MB()
    mx, my = th["moon_px"]
    mr = th["moon_r"]
    bb_disc(mb, view, mx, my, 6000, mr * 1.9, mat_glow(p + "_moon_halo", th["moon_halo"], 0.22))
    bb_disc(mb, view, mx, my, 5900, mr, mat_emit(p + "_moon", th["moon"], 1.0))
    ms = mat_emit(p + "_moon_spot", th["moon_spot"], 1.0)
    for dx, dy, r in ((-0.35, -0.25, 0.22), (0.3, 0.1, 0.16), (-0.1, 0.45, 0.13)):
        bb_disc(mb, view, mx + dx * mr, my + dy * mr, 5800, r * mr, ms, 16)
    add_stars(mb, view, rng, 90, (0, 0, W, 58), 7000, [mat_emit(f"{p}_star{i}", c, 1.0) for i, c in enumerate(th["stars"])])
    if th["beam"]:
        bm_ = mat_glow(p + "_beam", th["beam"], 0.16)
        for x0, x1 in ((118, 40), (118, 190), (428, 470)):
            bb_poly(mb, view, [(x0 - 1.5, 64), (x0 + 1.5, 64), (x1 + 13, -6), (x1 - 13, -6)], 520, bm_)
    if th["bolt"]:
        bolt = [(x + 345, y) for x, y in [(150, -4), (160, -4), (146, 16), (156, 17), (138, 38), (147, 38), (133, 58),
                                          (139, 34), (131, 33), (146, 13), (137, 12)]]
        bb_poly(mb, view, bolt, 900, mat_emit(p + "_bolt", th["bolt"], 1.3))
        bb_disc(mb, view, 491, 22, 950, 44, mat_glow(p + "_bolt_glow", (1.0, 0.35, 0.1), 0.16))
    mb.build(p + "_Sky", sc)

    sc.world = make_world(p + "_World", th["sky"], -0.01, 0.15, th["sky_light"], th["clouds"])

    # --- lights ----------------------------------------------------------------
    add_light(sc, p + "_Spot", "SPOT", (0, -0.15, 3.3), (0, -0.05, TABLE_Z), th["spot_e"], th["spot"],
              spot_size=math.radians(36), spot_blend=1.0, shadow_soft_size=0.35)
    add_light(sc, p + "_RimL", "AREA", (-3.0, 2.9, 2.3), (-0.2, 1.1, 0.9), th["rim_e"], th["rim_l"], size=1.6)
    add_light(sc, p + "_RimR", "AREA", (3.0, 2.9, 2.3), (0.2, 1.1, 0.9), th["rim_e"], th["rim_r"], size=1.6)
    return sc


# --------------------------------------------------------------------------
# title scene
# --------------------------------------------------------------------------
CHIP_COLORS = {
    "white": ((0.85, 0.85, 0.88), (0.10, 0.20, 0.65)),
    "red": ((0.80, 0.04, 0.06), (0.95, 0.92, 0.85)),
    "blue": ((0.05, 0.18, 0.80), (0.95, 0.92, 0.85)),
    "green": ((0.03, 0.50, 0.14), (0.98, 0.90, 0.55)),
    "black": ((0.045, 0.045, 0.07), (0.80, 0.82, 0.90)),
}
GOLD = (1.0, 0.66, 0.10)


def chip_mats(prefix, name, rough=0.45):
    if name == "gold":
        body, ins = (0.80, 0.04, 0.06), GOLD
        return dict(body=mat_pbr(prefix + "_chip_red", body, rough), insert=mat_pbr(prefix + "_chip_gold", ins, 0.3, 0.2),
                    ring=mat_pbr(prefix + "_chip_red", body, rough), center=mat_pbr(prefix + "_chip_gold", ins, 0.3, 0.2))
    body, ins = CHIP_COLORS[name]
    return dict(body=mat_pbr(f"{prefix}_chip_{name}", body, rough), insert=mat_pbr(f"{prefix}_chip_{name}_ins", ins, rough),
                ring=mat_pbr(f"{prefix}_chip_{name}_ins", ins, rough), center=mat_pbr(f"{prefix}_chip_{name}", body, rough))


def card_mesh(mb, prefix):
    w, h = 0.64, 0.89
    white = mat_pbr(prefix + "_card_face", (0.92, 0.92, 0.95), 0.5)
    red = mat_pbr(prefix + "_card_back", (0.75, 0.04, 0.22), 0.5)
    gold = mat_pbr(prefix + "_card_gold", (1.0, 0.75, 0.25), 0.4)
    mb.prism(rrect(w, h, 0.06), 0.012, white, xf=T(0, 0, -0.006))
    back = T(0, 0, -0.0075)
    mb.add([(x, y, 0) for x, y in rrect(w - 0.09, h - 0.09, 0.035)], [list(range(24))], red, xf=back)
    back2 = T(0, 0, -0.009)
    for i in range(3):
        for j in range(4):
            cx, cy = (i - 1) * 0.16, (j - 1.5) * 0.17
            dw, dh = 0.06, 0.068
            mb.add([(cx - dw, cy, 0), (cx, cy - dh, 0), (cx + dw, cy, 0), (cx, cy + dh, 0)], [[0, 1, 2, 3]],
                   gold if (i + j) % 2 == 0 else white, xf=back2)


def build_title(samples):
    p = "Title"
    sc = bpy.data.scenes.new(p)
    setup_render(sc, W * BG_SCALE, H * BG_SCALE, samples, False, True)
    view = View(pos=(0, 0, 0), pitch_deg=22.0, vfov_deg=50.0)
    view.camera(sc, p + "_Camera")
    rng = random.Random(777)
    th = dict(THEMES["table"])
    th["lit"] = 0.42

    rows = [
        dict(y=70, x0=-130, x1=130, w=(9, 16), gap=(1.5, 6), top=(1, 10), tower=0.2, tower_add=(2, 7), depth=0.0),
        dict(y=140, x0=-230, x1=230, w=(11, 20), gap=(2, 10), top=(5, 20), tower=0.25, tower_add=(3, 13), depth=0.33),
        dict(y=260, x0=-400, x1=400, w=(15, 27), gap=(4, 16), top=(10, 36), tower=0.25, tower_add=(6, 22), depth=0.66),
        dict(y=430, x0=-680, x1=680, w=(22, 42), gap=(6, 26), top=(18, 56), tower=0.25, tower_add=(10, 36), depth=1.0),
    ]
    mb = MB()
    add_city(mb, rng, rows, -14.0, th, p)
    mb.build(p + "_City", sc)

    logo = (120, 30, 520, 170)

    def in_logo(x, y, m=0):
        return logo[0] - m < x < logo[2] + m and logo[1] - m < y < logo[3] + m

    mb = MB()
    stars = [mat_emit(f"{p}_star{i}", c, 1.0) for i, c in enumerate(th["stars"])]
    add_stars(mb, view, rng, 150, (0, 0, W, 250), 7000, stars)
    bb_disc(mb, view, 588, 36, 6000, 40, mat_glow(p + "_moon_halo", th["moon_halo"], 0.22))
    bb_disc(mb, view, 588, 36, 5900, 21, mat_emit(p + "_moon", th["moon"], 1.0))
    ms = mat_emit(p + "_moon_spot", th["moon_spot"], 1.0)
    for dx, dy, r in ((-0.35, -0.25, 0.22), (0.3, 0.1, 0.16), (-0.1, 0.45, 0.13)):
        bb_disc(mb, view, 588 + dx * 21, 36 + dy * 21, 5800, r * 21, ms, 16)
    beam = mat_glow(p + "_beam", th["beam"], 0.12)
    for x0, x1 in ((150, 10), (500, 632)):
        bb_poly(mb, view, [(x0 - 2, 336), (x0 + 2, 336), (x1 + 16, -6), (x1 - 16, -6)], 520, beam)
    mb.build(p + "_Sky", sc)

    # tumbling chips and cards: (kind, colour, pixel x, y, depth, euler, scale)
    things = [
        ("chip", "gold", 84, 262, 6.2, (-28, 38, 20), 1.0),
        ("chip", "blue", 574, 150, 9.0, (30, -42, -15), 1.0),
        ("chip", "red", 60, 76, 13.5, (48, 24, 70), 1.0),
        ("chip", "green", 462, 276, 7.4, (-52, -20, 40), 1.0),
        ("chip", "white", 262, 232, 19.0, (36, 52, 10), 1.0),
        ("chip", "black", 610, 300, 12.0, (20, 30, 0), 1.0),
        ("card", "face", 196, 282, 8.6, (-22, 28, 18), 2.4),
        ("card", "back", 585, 232, 10.5, (25, 205, -24), 2.4),
        ("card", "face", 94, 168, 15.0, (30, -35, -30), 2.4),
        ("card", "back", 350, 296, 12.5, (-35, 160, 62), 2.4),
        ("card", "face", 556, 62, 17.0, (-18, 40, 48), 2.4),
    ]
    vp = (320.0, 352.0)
    glow_cols = [(1.0, 0.15, 0.7), (0.15, 0.85, 1.0), (1.0, 0.8, 0.25)]
    smb = MB()
    for i, (kind, col, px, py, depth, eul, scale) in enumerate(things):
        mb = MB()
        if kind == "chip":
            mb.chip(chip_mats(p, col), thick=0.24)
            rpx = view.f / depth
        else:
            card_mesh(mb, p)
            rpx = view.f / depth * 0.5 * scale * 0.7
        mb.build(f"{p}_{kind}_{i}", sc, matrix=view.frame(px, py, depth, eul, scale))
        # motion trail back towards the vanishing point
        dx, dy = vp[0] - px, vp[1] - py
        L = math.hypot(dx, dy)
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        hw = rpx * 0.55
        tl = min(L * 0.75, 150)
        gm = mat_glow(f"{p}_trail{i % 3}", glow_cols[i % 3], 0.22)
        bb_poly(smb, view, [(px + nx * hw, py + ny * hw), (px - nx * hw, py - ny * hw),
                            (px + ux * tl, py + uy * tl)], depth + 2.0, gm)
        bb_poly(smb, view, [(px + nx * hw * 0.45, py + ny * hw * 0.45), (px - nx * hw * 0.45, py - ny * hw * 0.45),
                            (px + ux * tl * 1.25, py + uy * tl * 1.25)], depth + 1.9, gm)
    # thin speed lines radiating from the vanishing point
    line_m = [mat_emit(f"{p}_line{i}", c, 1.0) for i, c in enumerate([(1, 1, 1), (0.5, 0.95, 1.0), (1.0, 0.55, 0.9)])]
    line_dim = [mat_glow(f"{p}_line_dim{i}", c, 0.10) for i, c in enumerate([(1, 1, 1), (0.5, 0.95, 1.0), (1.0, 0.55, 0.9)])]
    n = 0
    while n < 46:
        ang = math.radians(rng.uniform(8, 172))
        r0 = rng.uniform(110, 430)
        ln = rng.uniform(26, 90)
        x0, y0 = vp[0] + math.cos(ang) * r0, vp[1] - math.sin(ang) * r0
        x1, y1 = vp[0] + math.cos(ang) * (r0 + ln), vp[1] - math.sin(ang) * (r0 + ln)
        if not (-20 < x0 < W + 20 and -20 < y0 < H):
            continue
        n += 1
        inside = in_logo(x0, y0, 6) or in_logo(x1, y1, 6) or in_logo((x0 + x1) / 2, (y0 + y1) / 2, 6)
        k = rng.randrange(3)
        m = line_dim[k] if inside else line_m[k]
        nx, ny = math.sin(ang) * 0.6, math.cos(ang) * 0.6
        bb_poly(smb, view, [(x0 - nx, y0 - ny), (x0 + nx, y0 + ny), (x1, y1)], 40.0, m)
    smb.build(p + "_Streaks", sc)

    sky = [(0.0, (0.80, 0.14, 0.55)), (0.16, (0.30, 0.06, 0.50)), (0.5, (0.06, 0.03, 0.22)), (1.0, (0.015, 0.012, 0.09))]
    sc.world = make_world(p + "_World", sky, -0.02, 0.75, 0.35)
    add_light(sc, p + "_KeyMagenta", "SUN", (-6, -4, -2), (0, 8, 2), 3.2, (1.0, 0.25, 0.75), angle=0.05)
    add_light(sc, p + "_KeyCyan", "SUN", (7, -3, 4), (0, 8, 2), 3.0, (0.25, 0.85, 1.0), angle=0.05)
    add_light(sc, p + "_Fill", "SUN", (0, -8, 3), (0, 8, 3), 1.6, (1.0, 0.95, 0.9), angle=0.05)
    return sc


# --------------------------------------------------------------------------
# props (sprites)
# --------------------------------------------------------------------------
def prop_scene(name, w, h, ortho, samples, cam_z=0.0, elev_deg=0.0):
    sc = bpy.data.scenes.new(name)
    setup_render(sc, w * SPR_SCALE, h * SPR_SCALE, samples, True, False)
    cam = bpy.data.cameras.new(name + "_Camera")
    cam.type = "ORTHO"
    cam.ortho_scale = ortho
    cam.clip_start = 0.1
    cam.clip_end = 100
    ob = bpy.data.objects.new(name + "_Camera", cam)
    e = math.radians(elev_deg)
    ob.location = (0, -20 * math.cos(e), cam_z + 20 * math.sin(e))
    ob.rotation_euler = (PI / 2 - e, 0, 0)
    sc.collection.objects.link(ob)
    sc.camera = ob
    w_ = bpy.data.worlds.get("PropWorld")
    if not w_:
        w_ = bpy.data.worlds.new("PropWorld")
        w_.use_nodes = True
        bg = w_.node_tree.nodes["Background"]
        bg.inputs["Color"].default_value = (0.75, 0.62, 0.8, 1)
        bg.inputs["Strength"].default_value = 0.55
    sc.world = w_
    add_light(sc, name + "_Key", "SUN", (-6, -10, 9), (0, 0, 0), 3.4, (1.0, 0.97, 0.9), angle=0.2)
    add_light(sc, name + "_Rim", "SUN", (8, 6, 4), (0, 0, 0), 2.0, (1.0, 0.6, 0.35), angle=0.2)
    add_light(sc, name + "_Fill", "SUN", (2, -10, 1), (0, 0, 0), 1.1, (1.0, 0.95, 0.95), angle=0.2)
    return sc


POSES = {}   # scene name -> list of (object, frame index, location, rotation, scale)


def key_pose(sc, ob, f):
    """Keyframe the object's current transform at frame f+1 and remember it for rendering."""
    for dp in ("location", "rotation_euler", "scale"):
        ob.keyframe_insert(dp, frame=f + 1)
    POSES.setdefault(sc.name, []).append((ob, f, tuple(ob.location), tuple(ob.rotation_euler), tuple(ob.scale)))


def apply_pose(sc, f):
    """Blender does not evaluate a non-active scene's animation in background mode, so the
    renderer sets the recorded transforms directly (the keyframes stay in the saved .blend)."""
    for ob, fi, loc, rot, scale in POSES.get(sc.name, []):
        ob.animation_data_clear()
        if fi == f:
            ob.location, ob.rotation_euler, ob.scale = loc, rot, scale


def linear_keys(ob):
    if ob.animation_data and ob.animation_data.action:
        for fc in ob.animation_data.action.fcurves:
            for k in fc.keyframe_points:
                k.interpolation = "CONSTANT"


def gold_mats(prefix):
    return dict(gold=mat_pbr(prefix + "_gold", (1.0, 0.63, 0.08), 0.32, 0.35),
                gold_dark=mat_pbr(prefix + "_gold_dark", (0.75, 0.33, 0.03), 0.4, 0.3),
                gold_light=mat_pbr(prefix + "_gold_light", (1.0, 0.86, 0.35), 0.3, 0.2))


def build_props(samples):
    scenes = {}

    # chip_spin: 8 frames, half a turn (the chip is the same from behind)
    sc = prop_scene("ChipSpin", 24, 24, 2.30, samples)
    mb = MB()
    mb.chip(chip_mats("spin", "gold"), thick=0.30, rc=0.46, ri=0.62, xf=R("X", 90))
    ob = mb.build("ChipSpin_Chip", sc)
    sc.frame_start, sc.frame_end = 1, 8
    for i in range(8):
        ob.rotation_euler = (0, 0, math.radians(i * 22.5))
        key_pose(sc, ob, i)
    linear_keys(ob)
    scenes["chip_spin"] = (sc, 8)

    # chips: 5 colours side by side, 3/4 top view, one 100x20 render
    cell = 2.36
    sc = prop_scene("Chips", 100, 20, cell * 5, samples, cam_z=-0.05, elev_deg=48)
    for i, name in enumerate(["white", "red", "blue", "green", "black"]):
        mb = MB()
        mb.chip(chip_mats("flat", name), thick=0.34, rc=0.46, ri=0.64, xf=R("Z", 15))
        mb.build("Chips_" + name, sc, matrix=T((i - 2) * cell, 0, 0))
    scenes["chips"] = (sc, 1)

    # star_spin
    sc = prop_scene("StarSpin", 24, 24, 2.36, samples, cam_z=0.0)
    g = gold_mats("star")
    mb = MB()
    out = star_outline(1.0, 0.52)
    d, rim = 0.42, 0.10
    for sgn in (1, -1):
        for i in range(10):
            a, b_ = out[i], out[(i + 1) % 10]
            m = g["gold_light"] if i % 2 == 0 else g["gold"]
            mb.add([(0, -sgn * d, 0), (a[0], -sgn * rim, a[1]), (b_[0], -sgn * rim, b_[1])], [[0, 1, 2]], m)
    for i in range(10):
        a, b_ = out[i], out[(i + 1) % 10]
        mb.add([(a[0], -rim, a[1]), (b_[0], -rim, b_[1]), (b_[0], rim, b_[1]), (a[0], rim, a[1])], [[0, 1, 2, 3]],
               g["gold_dark"])
    ob = mb.build("StarSpin_Star", sc, matrix=T(0, 0, -0.095))
    sc.frame_start, sc.frame_end = 1, 8
    for i in range(8):
        ob.rotation_euler = (0, 0, math.radians(i * 22.5))
        key_pose(sc, ob, i)
    linear_keys(ob)
    scenes["star_spin"] = (sc, 8)

    # trophy
    sc = prop_scene("Trophy", 64, 64, 3.32, samples, cam_z=1.46, elev_deg=9)
    g = gold_mats("trophy")
    base = mat_pbr("trophy_base", (0.16, 0.03, 0.22), 0.4)
    plate = mat_pbr("trophy_plate", (1.0, 0.8, 0.3), 0.3, 0.3)
    emblem = mat_pbr("trophy_spade", (0.05, 0.015, 0.12), 0.5)
    mb = MB()
    mb.revolve([(0, 0), (0.86, 0), (0.86, 0.14), (0.74, 0.20), (0.74, 0.44), (0.66, 0.52), (0, 0.52)], base, 40)
    mb.revolve([(0.745, 0.25), (0.745, 0.39)], plate, 40)
    mb.revolve([(0, 0.52), (0.52, 0.52), (0.48, 0.62), (0.22, 0.72), (0.13, 0.86), (0.13, 1.02), (0.24, 1.10),
                (0.20, 1.16), (0.34, 1.24), (0.66, 1.42), (0.86, 1.72), (0.95, 2.10), (1.0, 2.50), (1.06, 2.70),
                (0.98, 2.72), (0.92, 2.55), (0.80, 2.0), (0.5, 1.6), (0, 1.5)], g["gold"], 40)
    mb.revolve([(1.07, 2.66), (1.07, 2.76), (0.97, 2.76)], g["gold_light"], 40)
    for sgn in (1, -1):
        path = []
        for i in range(17):
            a = math.radians(78 - 176 * i / 16)
            path.append((sgn * (0.93 + 0.50 * math.cos(a)), 0, 1.97 + 0.44 * math.sin(a)))
        mb.tube(path, 0.085, 0.085, g["gold"], closed=False, up=(0, 1, 0), segs=10)
    sx = T(0, -1.02, 2.02) @ R("X", 90) @ S(0.74)
    mb.prism(spade_outline(), 0.06, emblem, xf=sx)
    mb.prism([(-0.035, -0.16), (0.035, -0.16), (0.17, -0.44), (-0.17, -0.44)], 0.06, emblem, xf=sx)
    mb.build("Trophy_Cup", sc)
    scenes["trophy"] = (sc, 1)

    # coin burst: 6 frames
    sc = prop_scene("CoinBurst", 32, 32, 3.2, samples)
    g = gold_mats("burst")
    rng = random.Random(42)
    spark = mat_emit("burst_spark", (1.0, 0.95, 0.6), 1.0)
    white = mat_emit("burst_flash", (1.0, 1.0, 0.92), 1.0)
    frames = 6
    sc.frame_start, sc.frame_end = 1, frames
    cm = dict(body=g["gold"], insert=g["gold"], ring=g["gold_dark"], center=g["gold_light"])
    ncoin = 9
    for i in range(ncoin):
        mb = MB()
        mb.chip(cm, radius=0.23, thick=0.09, segs=24, rc=0.45, ri=0.7)
        ob = mb.build(f"CoinBurst_coin{i}", sc)
        ang = math.radians(i * 360 / ncoin + rng.uniform(-10, 10) + 12)
        spd = rng.uniform(0.72, 1.0)
        ph = rng.uniform(0, 360)
        tilt = rng.uniform(55, 100)
        for f in range(frames):
            t = (f + 1) / frames
            rad = 1.22 * spd * (1 - (1 - t) ** 2.2)
            ob.location = (math.cos(ang) * rad, 0.4 * i - 2, math.sin(ang) * rad - 0.22 * t * t + 0.05)
            ob.rotation_euler = (math.radians(tilt + f * 37), math.radians(ph), math.radians(ph + f * 48))
            s = (1.0, 1.0, 1.0, 0.95, 0.75, 0.5)[f]
            ob.scale = (s, s, s)
            key_pose(sc, ob, f)
        linear_keys(ob)
    nsp = 8
    for i in range(nsp):
        mb = MB()
        pts = star_outline(0.16, 0.05, 4, 90)
        mb.add([(x, 0, y) for x, y in pts], [list(range(8))], spark)
        ob = mb.build(f"CoinBurst_spark{i}", sc)
        ang = math.radians(i * 360 / nsp + 34 + rng.uniform(-8, 8))
        spd = rng.uniform(0.85, 1.05)
        for f in range(frames):
            t = (f + 1) / frames
            rad = 1.36 * spd * (1 - (1 - t) ** 1.8)
            ob.location = (math.cos(ang) * rad, -4, math.sin(ang) * rad)
            s = (0.0, 1.0, 1.25, 1.1, 0.85, 0.55)[f]
            ob.scale = (s, s, s)
            key_pose(sc, ob, f)
        linear_keys(ob)
    mb = MB()
    mb.add([(x, 0, y) for x, y in star_outline(1.0, 0.36, 8, 90)], [list(range(16))], spark)
    mb.add([(x, -0.1, y) for x, y in star_outline(0.62, 0.3, 8, 112.5)], [list(range(16))], white)
    ob = mb.build("CoinBurst_flash", sc, matrix=T(0, -6, 0))
    for f in range(frames):
        s = (0.95, 0.6, 0.0, 0.0, 0.0, 0.0)[f]
        ob.scale = (s, s, s)
        key_pose(sc, ob, f)
    linear_keys(ob)
    scenes["coin_burst"] = (sc, frames)
    return scenes


# --------------------------------------------------------------------------
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="table,boss,title,props")
    ap.add_argument("--samples", type=int, default=64, help="background samples (denoised)")
    ap.add_argument("--sprite-samples", type=int, default=32)
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(argv)
    only = set(a.only.split(","))
    os.makedirs(OUT, exist_ok=True)

    if only & {"table", "boss", "title"}:
        fresh_file()
        scs = {"table": build_table("Table", "table", a.samples),
               "boss": build_table("Boss", "boss", a.samples),
               "title": build_title(a.samples)}
        save_blend("table.blend")
        if not a.no_render:
            for k in ("table", "boss", "title"):
                if k in only:
                    render(scs[k], f"bg_{k}.png")

    if "props" in only or only & {"chip_spin", "chips", "star_spin", "trophy", "coin_burst"}:
        fresh_file()
        scenes = build_props(a.sprite_samples)
        save_blend("props.blend")
        if not a.no_render:
            for key, (sc, frames) in scenes.items():
                if "props" not in only and key not in only:
                    continue
                if frames == 1:
                    render(sc, f"{key}.png")
                else:
                    for f in range(frames):
                        sc.frame_current = f + 1
                        apply_pose(sc, f)
                        render(sc, f"{key}_{f}.png")


main()
