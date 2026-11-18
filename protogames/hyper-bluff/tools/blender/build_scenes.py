"""Hyper Bluff!! Starlight Showdown - procedural Blender art.

Run inside Blender 4.2 (headless):

    blender -b --python tools/blender/build_scenes.py -- [--only floors,title,props]
                                                         [--samples N] [--no-render]

Builds every scene from code (no imported models or textures), saves
art/blender/table.blend (scenes Floor1..Floor5, Title) and art/blender/props.blend
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

    def proj(self, world):
        """World point -> (pixel x, pixel y, depth along the view axis)."""
        d = Vector(world) - self.pos
        depth = d.dot(self.fwd)
        return W / 2 + d.dot(self.right) * self.f / depth, H / 2 - d.dot(self.up) * self.f / depth, depth

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


WY = 4.6            # y of the back wall; the camera sees z 0.25..1.9 of it, x -4.5..4.5


def cyl(mb, x, y, z0, z1, r, mat, segs=14, r1=None):
    r1 = r if r1 is None else r1
    mb.revolve([(0, z0), (r, z0), (r1, z1), (0, z1)], mat, segs, xf=T(x, y, 0))


def face_xz(mb, x0, x1, z0, z1, y, mat):
    mb.add([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], [[0, 1, 2, 3]], mat)


def bb_rect(mb, view, x0, y0, x1, y1, depth, mat):
    bb_poly(mb, view, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], depth, mat)


def bb_line(mb, view, x0, y0, x1, y1, w, depth, mat):
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    bb_poly(mb, view, [(x0 - nx, y0 - ny), (x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny)], depth, mat)


def chair_outline(wb, wt, z0, zs, ztop, n=14):
    pts = [(-wb / 2, z0), (wb / 2, z0), (wt / 2, zs)]
    for i in range(1, n):
        ang = PI * i / n
        pts.append((wt / 2 * math.cos(ang), zs + (ztop - zs) * math.sin(ang)))
    pts.append((-wt / 2, zs))
    return pts


CHAIR_Y = 1.62


def chair_part(mb, outline, depth, mat, dy=0.0):
    """Outline in world XZ, extruded towards the camera from y = CHAIR_Y - dy."""
    mb.prism(outline, depth, mat, xf=T(0, CHAIR_Y - dy, 0) @ R("X", 90))


def shell(mb, floor, wall, ceiling=True, back=None):
    mb.box((-8, -3, -0.05), (8, WY + 0.6, 0.0), floor)
    mb.box((-8.3, -3, 0), (-8, WY + 0.3, 3.6), wall)
    mb.box((8, -3, 0), (8.3, WY + 0.3, 3.6), wall)
    if ceiling:
        mb.box((-8.3, -3, 3.6), (8.3, WY + 0.6, 3.7), wall)
    if back:
        mb.box((-8, WY, 0), (8, WY + 0.3, 3.6), back)


class Kit:
    """Per-floor material shortcuts with unique names."""

    def __init__(self, p):
        self.p = p

    def P(self, name, color, rough=0.6, metal=0.0, emit=None, es=0.0, spec=0.5):
        return mat_pbr(f"{self.p}_{name}", color, rough, metal, emit, es, spec)

    def E(self, name, color, strength=1.0):
        return mat_emit(f"{self.p}_{name}", color, strength)

    def G(self, name, color, strength=0.2):
        return mat_glow(f"{self.p}_{name}", color, strength)


# ---- floor 1: Lobby Pit ---------------------------------------------------
def room1(sc, p, th, view, rng, k):
    mb = MB()
    wall = k.P("wall", (0.16, 0.03, 0.04), 0.7)
    wood = k.P("wood", (0.02, 0.008, 0.006), 0.6)
    gold = k.P("gold", (0.9, 0.55, 0.12), 0.35, 0.5, emit=(0.9, 0.5, 0.1), es=0.12)
    shell(mb, k.P("carpet", (0.10, 0.015, 0.03), 0.9), wall)
    for x0, x1 in ((-8, -3.25), (3.25, 8)):
        mb.box((x0, WY, 0), (x1, WY + 0.3, 3.6), wall)
    mb.box((-1.3, WY - 0.06, 0), (1.3, WY + 0.3, 3.6), wood)
    for sx in (-1, 1):
        xa, xb = sorted((sx * 1.3, sx * 3.25))
        mb.box((xa, WY, 0), (xb, WY + 0.3, 0.62), wall)
        mb.box((xa, WY, 2.5), (xb, WY + 0.3, 3.6), wall)
        mb.box((xa, WY - 0.05, 0.60), (xb, WY, 0.66), gold)
        mb.box(((xa + xb) / 2 - 0.03, WY - 0.03, 0.62), ((xa + xb) / 2 + 0.03, WY, 2.5), gold)
        mb.box((xa, WY - 0.03, 1.50), (xb, WY, 1.55), gold)
        mb.box((sx * 1.3 - 0.04, WY - 0.08, 0), (sx * 1.3 + 0.04, WY - 0.04, 3.6), gold)
        mb.box((sx * 3.25 - 0.04, WY - 0.05, 0), (sx * 3.25 + 0.04, WY, 3.6), gold)
    mb.build(p + "_Room", sc)

    # hanging lamps
    mb = MB()
    shade = k.P("shade", (0.55, 0.22, 0.03), 0.4, 0.3, emit=(1.0, 0.55, 0.1), es=0.9)
    bulb = k.E("bulb", (1.0, 0.85, 0.45), 2.5)
    cord = k.P("cord", (0.02, 0.01, 0.01))
    for x, y, z in ((-2.25, 3.2, 1.47), (2.25, 3.2, 1.47), (-3.75, 3.9, 1.60), (3.75, 3.9, 1.60),
                    (-1.3, 4.05, 1.66), (1.3, 4.05, 1.66)):
        mb.box((x - 0.012, y - 0.012, z + 0.2), (x + 0.012, y + 0.012, 3.6), cord)
        mb.revolve([(0.04, z + 0.24), (0.07, z + 0.2), (0.22, z)], shade, 20, xf=T(x, y, 0))
        mb.revolve([(0, z - 0.07), (0.08, z - 0.03), (0.08, z + 0.03), (0, z + 0.06)], bulb, 12, xf=T(x, y, 0))
    mb.build(p + "_Lamps", sc)

    # rope barriers, slot machines, plant
    mb = MB()
    rope = k.P("rope", (0.5, 0.02, 0.05), 0.6)
    for xa, xb in ((-3.35, -1.95), (1.95, 3.35)):
        for x in (xa, xb):
            cyl(mb, x, 3.45, 0, 1.02, 0.035, gold, 10)
            cyl(mb, x, 3.45, 0, 0.04, 0.16, gold, 14)
            mb.revolve([(0, 1.02), (0.065, 1.06), (0.065, 1.11), (0, 1.15)], gold, 12, xf=T(x, 3.45, 0))
        path = [(xa + (xb - xa) * i / 14, 3.45, 0.98 - 0.22 * math.sin(PI * i / 14)) for i in range(15)]
        mb.tube(path, 0.028, 0.028, rope, closed=False, up=(0, 1, 0), segs=8)
    body = k.P("slot", (0.20, 0.02, 0.10), 0.4)
    scr = k.E("slot_screen", (1.0, 0.75, 0.25), 1.0)
    reel = k.E("slot_reel", (1.0, 0.97, 0.85), 1.2)
    top = k.E("slot_top", (1.0, 0.15, 0.3), 1.6)
    for x0 in (-4.42, -3.86):
        mb.box((x0, 4.05, 0), (x0 + 0.5, 4.5, 1.62), body)
        face_xz(mb, x0 + 0.05, x0 + 0.45, 1.06, 1.42, 4.04, scr)
        for i in range(3):
            face_xz(mb, x0 + 0.08 + i * 0.125, x0 + 0.17 + i * 0.125, 1.14, 1.34, 4.03, reel)
        face_xz(mb, x0 + 0.05, x0 + 0.45, 0.80, 0.92, 4.04, top)
        mb.revolve([(0.12, 1.62), (0.1, 1.72), (0, 1.76)], top, 12, xf=T(x0 + 0.25, 4.27, 0))
    pot = k.P("pot", (0.45, 0.16, 0.06), 0.6)
    leaf = k.P("leaf", (0.012, 0.10, 0.035), 0.6, emit=(0.0, 0.06, 0.02), es=1.0)
    for px_, py_ in ((4.05, 4.2), (-1.62, 4.25)):
        cyl(mb, px_, py_, 0, 0.72, 0.17, pot, 14, r1=0.25)
        for i in range(11):
            a = math.radians(rng.uniform(-62, 62))
            L = rng.uniform(0.55, 1.0)
            tip = (px_ + math.sin(a) * L, py_ - 0.05 + rng.uniform(-0.1, 0.1), 0.72 + math.cos(a) * L)
            w = 0.085
            mid = (px_ + math.sin(a) * L * 0.5, py_ - 0.05, 0.72 + math.cos(a) * L * 0.55)
            mb.poly([(px_, py_ - 0.05, 0.72), (mid[0] - w * math.cos(a), mid[1], mid[2] + w * math.sin(a)), tip,
                     (mid[0] + w * math.cos(a), mid[1], mid[2] - w * math.sin(a))], leaf)
    mb.build(p + "_Props", sc)

    # dealer's stool: small padded back on a post
    lea = k.P("chair", (0.05, 0.02, 0.015), 0.45)
    mb2 = MB()
    mb2.prism(rrect(0.50, 0.36, 0.10), 0.10, lea, xf=T(0, CHAIR_Y, 1.16) @ R("X", 90))
    mb2.prism(rrect(0.38, 0.24, 0.07), 0.02, k.P("chair_in", (0.10, 0.03, 0.02), 0.6), xf=T(0, CHAIR_Y - 0.10, 1.16) @ R("X", 90))
    mb2.box((-0.035, CHAIR_Y - 0.04, 0.3), (0.035, CHAIR_Y + 0.02, 1.0), k.P("chair_post", (0.25, 0.14, 0.04), 0.3, 0.6))
    mb2.build(p + "_Chair", sc)

    # dusk city close by (low floor) and a setting sun
    city = dict(THEMES["table"], win=[(1.0, 0.7, 0.25), (1.0, 0.9, 0.6), (1.0, 0.45, 0.2)], lit=0.45,
                body_near=(0.035, 0.012, 0.05), body_far=(0.42, 0.13, 0.20), roof_tint=(0.6, 0.2, 0.2),
                signs=[(1.0, 0.3, 0.2), (1.0, 0.8, 0.3)])
    cz = view.pos.z
    rows = [dict(y=28, x0=-60, x1=60, w=(7, 12), gap=(2, 9), top=(cz + 1, cz + 7), tower=0.2, tower_add=(1, 4), depth=0.0),
            dict(y=60, x0=-110, x1=110, w=(9, 16), gap=(3, 12), top=(cz + 3, cz + 12), tower=0.2, tower_add=(2, 6), depth=0.45),
            dict(y=130, x0=-230, x1=230, w=(12, 22), gap=(5, 20), top=(cz + 4, cz + 20), tower=0.2, tower_add=(3, 10), depth=1.0)]
    mb = MB()
    add_city(mb, rng, rows, -9.0, city, p)
    mb.build(p + "_City", sc)
    mb = MB()
    bb_disc(mb, view, 468, 58, 6000, 40, k.G("sun_halo", (1.0, 0.45, 0.1), 0.35))
    bb_disc(mb, view, 468, 58, 5900, 20, k.E("sun", (1.0, 0.80, 0.35), 1.0))
    mb.build(p + "_Sky", sc)


# ---- floor 2: Garage Deck -------------------------------------------------
def room2(sc, p, th, view, rng, k):
    mb = MB()
    conc = k.P("concrete", (0.11, 0.10, 0.09), 0.9)
    conc_d = k.P("concrete_dark", (0.010, 0.009, 0.009), 0.95, spec=0.1)
    steel = k.P("steel", (0.25, 0.25, 0.27), 0.35, 0.8)
    shell(mb, k.P("deck", (0.07, 0.065, 0.06), 0.8), conc, ceiling=False)
    mb.box((-8.3, -3, 3.6), (8.3, WY + 0.9, 3.8), conc)
    mb.box((-8, WY - 0.1, 1.74), (8, WY + 0.5, 3.6), conc)
    mb.box((-8, WY, 0), (8, WY + 0.2, 0.86), conc)
    mb.tube([(-8, WY + 0.1, 1.02), (8, WY + 0.1, 1.02)], 0.03, 0.03, steel, closed=False, up=(0, 1, 0), segs=8)
    mb.box((-1.12, WY - 0.3, 0), (1.12, WY + 0.5, 2.0), conc_d)
    for x in (-4.1, 4.1):
        mb.box((x - 0.33, WY - 0.3, 0), (x + 0.33, WY + 0.5, 2.0), conc)
        face_xz(mb, x - 0.33, x + 0.33, 0.55, 0.72, WY - 0.31, k.P("hazard", (0.8, 0.5, 0.03), 0.7))
    lamp = k.E("sodium", (1.0, 0.55, 0.12), 3.0)
    for x in (-2.6, 2.6):
        mb.box((x - 0.5, 3.7, 1.69), (x + 0.5, 3.8, 1.73), lamp)
    mb.build(p + "_Room", sc)

    # parked motorcycle on a kerb (left)
    mb = MB()
    met = k.P("bike", (0.03, 0.03, 0.035), 0.3, 0.6)
    tank = k.P("bike_tank", (0.35, 0.03, 0.012), 0.3)
    chrome = k.P("chrome", (0.6, 0.6, 0.62), 0.2, 0.9)
    bx, by, bz = -2.45, 3.55, 0.28
    mb.box((-3.75, 3.1, 0), (-1.25, 4.0, bz), conc)
    xf = T(bx, by + 0.11, bz) @ R("X", 90)
    prof = [(-0.98, 0.50), (-0.62, 0.90), (-0.12, 0.80), (0.10, 0.98), (0.48, 0.98), (0.62, 0.80), (0.80, 1.16),
            (0.90, 1.14), (0.78, 0.74), (0.97, 0.38), (0.87, 0.34), (0.60, 0.62), (0.32, 0.40), (-0.30, 0.38),
            (-0.60, 0.48)]
    mb.prism(prof, 0.22, met, xf=xf)
    mb.prism([(0.02, 0.84), (0.14, 1.03), (0.50, 1.03), (0.64, 0.82), (0.40, 0.72), (0.10, 0.72)], 0.30, tank,
             xf=T(bx, by + 0.15, bz) @ R("X", 90))
    tyre = k.P("tyre", (0.012, 0.012, 0.014), 0.8)
    for wx in (-0.76, 0.84):
        wxf = T(bx + wx, by, bz + 0.34) @ R("X", 90)
        mb.revolve([(0, -0.07), (0.34, -0.07), (0.34, 0.07), (0, 0.07)], tyre, 24, xf=wxf)
        mb.revolve([(0, -0.08), (0.13, -0.08), (0.13, 0.08), (0, 0.08)], chrome, 16, xf=wxf)
    mb.tube([(bx + 0.25, by - 0.14, bz + 0.40), (bx - 0.5, by - 0.14, bz + 0.40), (bx - 1.05, by - 0.14, bz + 0.52)],
            0.045, 0.045, chrome, closed=False, up=(0, 1, 0), segs=8)
    mb.tube([(bx + 0.84, by - 0.3, bz + 1.16), (bx + 0.84, by + 0.3, bz + 1.16)], 0.02, 0.02, chrome, closed=False,
            up=(0, 0, 1), segs=6)
    mb.box((bx + 0.82, by - 0.3, bz + 1.16), (bx + 0.84, by - 0.28, bz + 1.34), chrome)
    cyl(mb, bx + 0.83, by - 0.29, bz + 1.34, bz + 1.36, 0.07, chrome, 10)
    mb.revolve([(0, 0), (0.09, 0), (0.09, 0.1), (0, 0.1)], k.E("headlight", (1.0, 0.9, 0.6), 2.0), 12,
               xf=T(bx + 0.93, by, bz + 1.0) @ R("Y", 90))
    mb.build(p + "_Motorcycle", sc)

    # oil drums and a cone (right)
    mb = MB()
    cyl(mb, 2.3, 3.6, 0, 0.9, 0.29, k.P("drum_a", (0.02, 0.05, 0.10), 0.6), 20)
    cyl(mb, 2.98, 3.8, 0, 0.9, 0.29, k.P("drum_b", (0.30, 0.09, 0.03), 0.7), 20)
    cyl(mb, 2.98, 3.8, 0.9, 1.8, 0.29, k.P("drum_a", (0.02, 0.05, 0.10), 0.6), 20)
    cone = k.P("cone", (1.0, 0.28, 0.02), 0.5, emit=(1.0, 0.25, 0.02), es=0.25)
    mb.revolve([(0.2, 0.9), (0.2, 0.93), (0.13, 0.93), (0.085, 1.2), (0.02, 1.58), (0, 1.58)], cone, 14, xf=T(2.3, 3.6, 0))
    mb.revolve([(0.090, 1.18), (0.062, 1.36)], k.E("cone_band", (1.0, 0.95, 0.85), 0.8), 14, xf=T(2.3, 3.6, 0))
    mb.build(p + "_Props", sc)

    # biker's seat: chrome sissy bar with a pad
    mb = MB()
    path = [(-0.27, CHAIR_Y, 0.3), (-0.27, CHAIR_Y, 1.1)]
    for i in range(13):
        a = PI - PI * i / 12
        path.append((0.27 * math.cos(a), CHAIR_Y, 1.1 + 0.27 * math.sin(a)))
    path += [(0.27, CHAIR_Y, 1.1), (0.27, CHAIR_Y, 0.3)]
    mb.tube(path, 0.03, 0.03, k.P("chair_bar", (0.10, 0.10, 0.11), 0.35, 0.8), closed=False, up=(0, 1, 0), segs=8)
    mb.prism(rrect(0.40, 0.44, 0.12), 0.09, k.P("chair", (0.012, 0.008, 0.008), 0.6, spec=0.2), xf=T(0, CHAIR_Y - 0.02, 1.02) @ R("X", 90))
    mb.build(p + "_Chair", sc)

    # outside: far city, an elevated highway and blank neon signs
    city = dict(THEMES["table"], win=[(1.0, 0.55, 0.12), (1.0, 0.8, 0.4), (1.0, 0.25, 0.1)], lit=0.2,
                body_near=(0.012, 0.010, 0.014), body_far=(0.07, 0.03, 0.03), roof_tint=(0.1, 0.04, 0.03),
                signs=[(1.0, 0.3, 0.1)])
    cz = view.pos.z
    rows = [dict(y=170, x0=-260, x1=260, w=(12, 22), gap=(4, 26), top=(cz - 40, cz - 8), tower=0.15, tower_add=(1, 5), depth=0.5),
            dict(y=330, x0=-480, x1=480, w=(20, 40), gap=(8, 40), top=(cz - 20, cz + 6), tower=0.2, tower_add=(3, 12), depth=1.0)]
    mb = MB()
    add_city(mb, rng, rows, -160.0, city, p)
    mb.build(p + "_City", sc)
    mb = MB()
    slab = k.E("road", (0.05, 0.035, 0.04), 1.0)
    edge = k.E("road_edge", (0.16, 0.12, 0.10), 1.0)

    def ry(x):
        return 74 + (x / 640.0) * 16

    bb_poly(mb, view, [(-10, ry(-10)), (650, ry(650)), (650, ry(650) + 11), (-10, ry(-10) + 11)], 90, slab)
    bb_poly(mb, view, [(-10, ry(-10)), (650, ry(650)), (650, ry(650) + 1.5), (-10, ry(-10) + 1.5)], 89, edge)
    dot = k.E("road_lamp", (1.0, 0.62, 0.15), 2.0)
    halo = k.G("road_halo", (1.0, 0.45, 0.08), 0.22)
    for x in range(20, 640, 110):
        bb_rect(mb, view, x - 5, ry(x) + 6, x + 5, 170, 90, slab)
    for x in range(-5, 650, 48):
        bb_rect(mb, view, x - 0.6, ry(x) - 15, x + 0.6, ry(x), 89, slab)
        bb_rect(mb, view, x - 0.6, ry(x) - 15.6, x + 5, ry(x) - 14.4, 89, slab)
        bb_rect(mb, view, x + 2.5, ry(x) - 14.4, x + 6, ry(x) - 12.6, 88, dot)
        bb_disc(mb, view, x + 4, ry(x) - 13, 87, 7, halo, 14)
    car_w, car_r = k.E("car_w", (1.0, 0.95, 0.75), 1.5), k.E("car_r", (1.0, 0.1, 0.05), 1.5)
    for i in range(16):
        x = rng.uniform(0, 640)
        bb_rect(mb, view, x, ry(x) - 3, x + rng.uniform(3, 7), ry(x) - 1.5, 88, car_w if i % 2 else car_r)
    pole = k.E("pole", (0.02, 0.018, 0.022), 1.0)
    mag, cy_, yel = k.E("sign_m", (1.0, 0.1, 0.55), 1.4), k.E("sign_c", (0.1, 0.9, 1.0), 1.4), k.E("sign_y", (1.0, 0.85, 0.15), 1.4)
    inner = k.E("sign_in", (0.03, 0.02, 0.05), 1.0)
    # arrow sign (left)
    bb_rect(mb, view, 196, 40, 200, 160, 46, pole)
    bb_disc(mb, view, 198, 30, 47, 30, k.G("glow_m", (1.0, 0.1, 0.5), 0.18), 20)
    bb_poly(mb, view, [(188, 8), (208, 8), (208, 30), (218, 30), (198, 52), (178, 30), (188, 30)], 45, mag)
    # ring + frame sign (right)
    bb_rect(mb, view, 462, 50, 466, 160, 46, pole)
    bb_disc(mb, view, 464, 26, 47, 30, k.G("glow_c", (0.1, 0.8, 1.0), 0.16), 20)
    bb_disc(mb, view, 464, 24, 45, 17, cy_, 28)
    bb_disc(mb, view, 464, 24, 44.5, 11, inner, 24)
    bb_rect(mb, view, 440, 46, 488, 62, 45, yel)
    bb_rect(mb, view, 443, 49, 485, 59, 44.5, inner)
    # stacked squares sign (far right)
    bb_rect(mb, view, 570, 20, 574, 160, 46, pole)
    for i in range(4):
        bb_rect(mb, view, 564, 6 + i * 13, 580, 16 + i * 13, 45, car_r if i % 2 == 0 else yel)
    add_stars(mb, view, rng, 30, (0, 0, W, 45), 7000, [k.E("star", (0.9, 0.8, 0.7), 0.8)])
    mb.build(p + "_Outside", sc)


# ---- floor 3: Snow Garden -------------------------------------------------
def snow_tree(mb, view, rng, x, y, ang, length, width, depth, bark, snow, level):
    x2, y2 = x + math.cos(ang) * length, y - math.sin(ang) * length
    nx, ny = math.sin(ang), math.cos(ang)
    w2 = width * 0.68
    bb_poly(mb, view, [(x - nx * width / 2, y - ny * width / 2), (x + nx * width / 2, y + ny * width / 2),
                       (x2 + nx * w2 / 2, y2 + ny * w2 / 2), (x2 - nx * w2 / 2, y2 - ny * w2 / 2)], depth, bark)
    if abs(math.cos(ang)) > 0.45 and width > 1.2:      # snow lies on the flatter boughs
        bb_poly(mb, view, [(x, y - width / 2 - 1.2), (x2, y2 - w2 / 2 - 1.2), (x2, y2 - w2 / 2 + 0.3),
                           (x, y - width / 2 + 0.3)], depth - 0.05, snow)
    if level > 0:
        for i in range(2 if level < 4 else 3):
            snow_tree(mb, view, rng, x2, y2, ang + rng.uniform(-0.85, 0.85), length * rng.uniform(0.6, 0.78), w2,
                      depth, bark, snow, level - 1)


def room3(sc, p, th, view, rng, k):
    mb = MB()
    wood = k.P("wood", (0.02, 0.012, 0.012), 0.5)
    lac = k.P("lacquer", (0.022, 0.012, 0.03), 0.25, spec=0.8)
    shell(mb, k.P("tatami", (0.10, 0.10, 0.06), 0.9), k.P("wall", (0.05, 0.045, 0.07), 0.8))
    mb.box((-8, WY, 0), (8, WY + 0.12, 0.30), wood)
    mb.box((-8, WY, 1.83), (8, WY + 0.12, 3.6), wood)
    mb.box((-1.12, WY - 0.05, 0), (1.12, WY + 0.12, 3.6), lac)
    mb.box((-0.9, WY - 0.07, 0.5), (0.9, WY - 0.05, 1.7), k.P("lacquer_in", (0.03, 0.016, 0.045), 0.3))
    for x in (-4.5, -3.3, 3.3, 4.5):
        mb.box((x - 0.05, WY - 0.02, 0), (x + 0.05, WY + 0.1, 3.6), wood)
    x = -4.5
    while x < 4.51:
        if abs(x) > 1.2:
            mb.box((x - 0.014, WY, 0.3), (x + 0.014, WY + 0.04, 1.83), wood)
        x += 0.44
    for z in (0.66, 1.05, 1.44):
        mb.box((-4.5, WY, z - 0.012), (-1.12, WY + 0.04, z + 0.012), wood)
        mb.box((1.12, WY, z - 0.012), (4.5, WY + 0.04, z + 0.012), wood)
    paper = k.E("paper", (0.36, 0.38, 0.52), 1.0)
    for xa, xb in ((-8, -3.35), (3.35, 8)):
        face_xz(mb, xa, xb, 0.3, 1.83, WY + 0.05, paper)
    mb.build(p + "_Room", sc)

    # paper floor lantern (right) and a vase on a stand (left)
    mb = MB()
    glow = k.E("andon", (1.0, 0.86, 0.6), 1.3)
    mb.box((2.72, 3.72, 0.35), (3.08, 4.08, 1.28), glow)
    for x_, y_ in ((2.70, 3.70), (3.06, 3.70), (2.70, 4.06), (3.06, 4.06)):
        mb.box((x_, y_, 0), (x_ + 0.04, y_ + 0.04, 1.36), wood)
    for z in (0.33, 0.80, 1.28):
        mb.box((2.70, 3.70, z), (3.10, 4.10, z + 0.035), wood)
    mb.box((-3.2, 3.6, 0), (-2.6, 4.1, 0.78), lac)
    vase = k.P("vase", (0.55, 0.6, 0.75), 0.25, emit=(0.1, 0.12, 0.2), es=0.5)
    mb.revolve([(0, 0.78), (0.09, 0.78), (0.15, 0.92), (0.13, 1.08), (0.05, 1.18), (0.07, 1.24), (0, 1.24)], vase, 16,
               xf=T(-2.9, 3.85, 0))
    twig = k.P("twig", (0.03, 0.015, 0.02), 0.6)
    for (a, L) in ((-22, 0.48), (14, 0.36), (40, 0.30)):
        r_ = math.radians(a)
        mb.tube([(-2.9, 3.85, 1.22), (-2.9 + math.sin(r_) * L, 3.85, 1.22 + math.cos(r_) * L)], 0.012, 0.012, twig,
                closed=False, up=(0, 1, 0), segs=5)
        mb.revolve([(0, -0.03), (0.035, 0), (0, 0.03)], k.E("blossom", (1.0, 0.75, 0.85), 1.0), 8,
                   xf=T(-2.9 + math.sin(r_) * L, 3.85, 1.22 + math.cos(r_) * L))
    mb.build(p + "_Props", sc)

    # low lacquer chair with an up-turned top rail
    mb = MB()
    cl = k.P("chair", (0.07, 0.008, 0.012), 0.22, spec=0.9)
    mb.prism([(-0.31, 0.3), (0.31, 0.3), (0.31, 1.02), (-0.31, 1.02)], 0.06, k.P("chair_dark", (0.02, 0.008, 0.012), 0.3),
             xf=T(0, CHAIR_Y, 0) @ R("X", 90))
    mb.prism([(-0.43, 1.02), (0.43, 1.02), (0.50, 1.16), (0.40, 1.11), (-0.40, 1.11), (-0.50, 1.16)], 0.09, cl,
             xf=T(0, CHAIR_Y + 0.01, 0) @ R("X", 90))
    for x in (-0.2, 0.0, 0.2):
        mb.box((x - 0.02, CHAIR_Y - 0.075, 0.4), (x + 0.02, CHAIR_Y - 0.06, 1.02), cl)
    mb.build(p + "_Chair", sc)

    # the garden, drawn in screen space behind the lattice
    mb = MB()
    d = 60
    bb_poly(mb, view, [(-10, 64), (650, 64), (650, 170), (-10, 170)], d, k.E("snow_far", (0.33, 0.40, 0.72), 1.0))
    pines = [(-10, 64)]
    x = -10
    while x < 650:
        h = rng.uniform(5, 15)
        pines += [(x + 4, 64 - h), (x + 8, 64 - h * 0.4)]
        x += 8
    pines.append((650, 64))
    bb_poly(mb, view, pines, d - 1, k.E("pines", (0.04, 0.05, 0.16), 1.0))
    for (x0, x1, top, base, col, dd) in ((-20, 300, 82, 175, (0.52, 0.60, 0.88), 30), (330, 680, 78, 175, (0.52, 0.60, 0.88), 30),
                                         (120, 560, 100, 175, (0.74, 0.80, 0.97), 22)):
        pts = [(x0, base)]
        for i in range(25):
            t = i / 24
            pts.append((x0 + (x1 - x0) * t, base - (base - top) * math.sin(PI * t) ** 0.7))
        pts.append((x1, base))
        bb_poly(mb, view, pts, dd, k.E(f"snow_{x0}_{top}", col, 1.0))
    bb_disc(mb, view, 492, 30, 6000, 46, k.G("moon_halo", (0.45, 0.5, 1.0), 0.25))
    bb_disc(mb, view, 492, 30, 5900, 25, k.E("moon", (0.90, 0.94, 1.0), 1.0))
    ms = k.E("moon_spot", (0.72, 0.78, 0.95), 1.0)
    for dx, dy, r in ((-0.35, -0.25, 0.22), (0.3, 0.1, 0.16), (-0.1, 0.45, 0.13)):
        bb_disc(mb, view, 492 + dx * 25, 30 + dy * 25, 5800, r * 25, ms, 16)
    add_stars(mb, view, rng, 40, (0, 0, W, 50), 7000, [k.E("star", (0.8, 0.85, 1.0), 1.0)])
    bark, snow = k.E("bark", (0.012, 0.012, 0.035), 1.0), k.E("snow_cap", (0.92, 0.95, 1.0), 1.0)
    snow_tree(mb, view, rng, 132, 150, math.radians(84), 46, 7.0, 12, bark, snow, 5)
    # stone lantern
    st, st_l = k.E("stone", (0.045, 0.05, 0.10), 1.0), k.E("stone_lit", (0.14, 0.16, 0.30), 1.0)
    lx = 562
    bb_poly(mb, view, [(lx - 14, 140), (lx + 14, 140), (lx + 10, 130), (lx - 10, 130)], 10, st)
    bb_rect(mb, view, lx - 5, 96, lx + 5, 130, 10, st)
    bb_rect(mb, view, lx - 2, 96, lx + 5, 130, 9.95, st_l)
    bb_rect(mb, view, lx - 13, 90, lx + 13, 96, 10, st)
    bb_rect(mb, view, lx - 10, 72, lx + 10, 90, 10, st)
    bb_rect(mb, view, lx - 5, 76, lx + 5, 87, 9.9, k.E("lantern_fire", (1.0, 0.72, 0.3), 1.3))
    bb_disc(mb, view, lx, 81, 9.8, 15, k.G("lantern_glow", (1.0, 0.6, 0.2), 0.2), 16)
    bb_poly(mb, view, [(lx - 22, 72), (lx + 22, 72), (lx + 8, 60), (lx - 8, 60)], 10, st)
    bb_poly(mb, view, [(lx - 22, 71), (lx - 8, 59), (lx + 8, 59), (lx + 22, 71), (lx + 18, 68), (lx + 7, 62), (lx - 7, 62),
                       (lx - 18, 68)], 9.9, snow)
    bb_poly(mb, view, [(lx - 3, 60), (lx + 3, 60), (lx, 51)], 10, st)
    flake = k.E("flake", (0.95, 0.97, 1.0), 1.0)
    for i in range(170):
        x, y = rng.uniform(0, W), rng.uniform(0, 150)
        s = 0.5 if rng.random() < 0.7 else 1.0
        bb_rect(mb, view, x - s, y - s, x + s, y + s, rng.uniform(6.5, 9), flake)
    mb.build(p + "_Garden", sc)


# ---- floor 4: Odds Laboratory ---------------------------------------------
def room4(sc, p, th, view, rng, k):
    mb = MB()
    wall = k.P("wall", (0.022, 0.045, 0.05), 0.55, 0.3)
    dark = k.P("cabinet", (0.010, 0.018, 0.02), 0.5, 0.3)
    shell(mb, k.P("floor", (0.03, 0.05, 0.05), 0.3), wall, back=wall)
    yb = WY - 0.01
    for x in (-3.3, 1.25):                                  # wall panel seams
        mb.box((x - 0.02, WY - 0.02, 0), (x + 0.02, WY, 3.6), dark)
    mb.box((-1.12, WY - 0.3, 0), (1.12, WY, 2.4), dark)
    slat = k.P("slat", (0.02, 0.035, 0.04), 0.5, 0.3)
    for i in range(7):
        mb.box((-0.8, WY - 0.31, 0.45 + i * 0.07), (0.8, WY - 0.30, 0.48 + i * 0.07), slat)
    copper = k.P("copper", (0.45, 0.16, 0.05), 0.35, 0.8)
    for z, r in ((1.84, 0.05), (1.73, 0.035)):
        mb.tube([(-8, WY - 0.12, z), (8, WY - 0.12, z)], r, r, copper, closed=False, up=(0, 1, 0), segs=8)
    for x in (-3.42, -1.28, 1.36, 3.52):
        mb.tube([(x, WY - 0.12, 1.73), (x, WY - 0.12, 0)], 0.035, 0.035, copper, closed=False, up=(0, 1, 0), segs=8)
        mb.box((x - 0.06, WY - 0.19, 1.2), (x + 0.06, WY - 0.05, 1.26), dark)
    mb.build(p + "_Room", sc)

    # porthole with stars and a ringed planet (left)
    mb = MB()
    cx, cz_, r = -2.35, 1.16, 0.60
    ring = [(cx + r * math.cos(2 * PI * i / 40), yb - 0.03, cz_ + r * math.sin(2 * PI * i / 40)) for i in range(40)]
    mb.poly([(x, yb - 0.005, z) for x, _, z in ring], k.E("space", (0.008, 0.012, 0.07), 1.0))
    mb.tube(ring, 0.07, 0.07, k.P("porthole", (0.20, 0.30, 0.30), 0.3, 0.8), closed=True, up=(0, 1, 0), segs=8)
    bolt = k.P("bolt", (0.5, 0.6, 0.55), 0.3, 0.8)
    for i in range(10):
        a = 2 * PI * i / 10
        bx_, bz_ = cx + (r + 0.07) * math.cos(a), cz_ + (r + 0.07) * math.sin(a)
        mb.box((bx_ - 0.025, yb - 0.12, bz_ - 0.025), (bx_ + 0.025, yb - 0.09, bz_ + 0.025), bolt)
    star = k.E("pstar", (0.9, 1.0, 0.95), 1.0)
    for i in range(46):
        a, rr = rng.uniform(0, 2 * PI), r * 0.92 * math.sqrt(rng.random())
        s = 0.008 if rng.random() < 0.8 else 0.016
        face_xz(mb, cx + rr * math.cos(a) - s, cx + rr * math.cos(a) + s, cz_ + rr * math.sin(a) - s,
                cz_ + rr * math.sin(a) + s, yb - 0.008, star)
    px_, pz_ = cx + 0.14, cz_ + 0.05
    mb.poly([(px_ + 0.17 * math.cos(2 * PI * i / 24), yb - 0.012, pz_ + 0.17 * math.sin(2 * PI * i / 24)) for i in range(24)],
            k.E("planet", (0.25, 0.9, 0.55), 1.0))
    mb.poly([(px_ + 0.17 * math.cos(2 * PI * i / 24) * 0.9 + 0.03, yb - 0.013, pz_ + 0.17 * math.sin(2 * PI * i / 24) * 0.9 - 0.03)
             for i in range(24)], k.E("planet_dark", (0.05, 0.35, 0.3), 1.0))
    ringp = [(px_ + 0.33 * math.cos(2 * PI * i / 32) * math.cos(0.35) - 0.07 * math.sin(2 * PI * i / 32) * math.sin(0.35),
              yb - 0.016,
              pz_ + 0.33 * math.cos(2 * PI * i / 32) * math.sin(0.35) + 0.07 * math.sin(2 * PI * i / 32) * math.cos(0.35))
             for i in range(32)]
    mb.tube(ringp, 0.012, 0.012, k.E("planet_ring", (1.0, 0.95, 0.5), 1.0), closed=True, up=(0, 1, 0), segs=4)
    mb.build(p + "_Porthole", sc)

    # rack of glowing tubes (far left)
    mb = MB()
    tubes = [k.E("tube_lime", (0.55, 1.0, 0.12), 1.6), k.E("tube_cyan", (0.1, 1.0, 0.75), 1.4), k.E("tube_yel", (0.95, 1.0, 0.2), 1.4)]
    for z in (0.62, 1.24):
        mb.box((-4.6, WY - 0.3, z - 0.05), (-3.5, WY, z), dark)
        for i in range(5):
            x = -4.45 + i * 0.21
            h = 0.30 + 0.14 * ((i * 7 + int(z * 10)) % 3)
            cyl(mb, x, WY - 0.16, z, z + h, 0.065, tubes[(i + int(z * 10)) % 3], 10)
            cyl(mb, x, WY - 0.16, z + h, z + h + 0.05, 0.075, dark, 10)
    mb.build(p + "_Tubes", sc)

    # monitor wall with abstract graphs (right)
    mb = MB()
    scr = k.E("screen", (0.006, 0.05, 0.035), 1.0)
    g1, g2, g3 = k.E("graph_lime", (0.6, 1.0, 0.15), 1.3), k.E("graph_cyan", (0.15, 1.0, 0.8), 1.2), k.E("graph_amber", (1.0, 0.75, 0.15), 1.2)
    mb.box((1.42, WY - 0.12, 0.45), (3.4, WY, 1.70), dark)
    ys = WY - 0.125
    for col in range(3):
        for row in range(2):
            x0, z0 = 1.50 + col * 0.64, 0.60 + row * 0.56
            x1, z1 = x0 + 0.56, z0 + 0.44
            face_xz(mb, x0, x1, z0, z1, ys, scr)
            kind = (col + row * 3) % 6
            yg = ys - 0.004
            if kind == 0:                                   # zig-zag line
                pts = [(x0 + 0.04 + i * 0.06, z0 + 0.08 + rng.uniform(0, 0.28)) for i in range(9)]
                for a, b_ in zip(pts, pts[1:]):
                    mb.tube([(a[0], yg, a[1]), (b_[0], yg, b_[1])], 0.012, 0.012, g1, closed=False, up=(0, 1, 0), segs=4)
            elif kind == 1:                                 # bars
                for i in range(6):
                    h = rng.uniform(0.06, 0.34)
                    face_xz(mb, x0 + 0.05 + i * 0.08, x0 + 0.10 + i * 0.08, z0 + 0.05, z0 + 0.05 + h, yg, g2 if i % 2 else g1)
            elif kind == 2:                                 # sine wave
                pts = [(x0 + 0.03 + i * 0.025, z0 + 0.22 + 0.14 * math.sin(i * 0.55)) for i in range(21)]
                mb.tube([(a, yg, b_) for a, b_ in pts], 0.011, 0.011, g2, closed=False, up=(0, 1, 0), segs=4)
            elif kind == 3:                                 # radar rings
                for rr, m in ((0.17, g1), (0.11, g2), (0.05, g3)):
                    mb.tube([((x0 + x1) / 2 + rr * math.cos(2 * PI * i / 24), yg, (z0 + z1) / 2 + rr * math.sin(2 * PI * i / 24))
                             for i in range(24)], 0.009, 0.009, m, closed=True, up=(0, 1, 0), segs=4)
            elif kind == 4:                                 # scatter
                for i in range(16):
                    sx_, sz_ = x0 + rng.uniform(0.05, 0.5), z0 + rng.uniform(0.05, 0.38)
                    face_xz(mb, sx_ - 0.014, sx_ + 0.014, sz_ - 0.014, sz_ + 0.014, yg, g3 if i % 3 == 0 else g1)
            else:                                           # level meters
                for i in range(5):
                    face_xz(mb, x0 + 0.05, x0 + 0.05 + rng.uniform(0.1, 0.44), z0 + 0.05 + i * 0.075, z0 + 0.095 + i * 0.075, yg,
                            g3 if i == 4 else g2)
    mb.build(p + "_Monitors", sc)

    # tesla coil (far right, in front of the wall)
    mb = MB()
    tx, ty = 3.95, 3.75
    mb.box((tx - 0.3, ty - 0.3, 0), (tx + 0.3, ty + 0.3, 0.55), dark)
    for i in range(4):
        z = 0.60 + i * 0.07
        mb.tube([(tx + 0.27 * math.cos(2 * PI * j / 24), ty + 0.27 * math.sin(2 * PI * j / 24), z) for j in range(24)],
                0.028, 0.028, copper, closed=True, segs=6)
    cyl(mb, tx, ty, 0.55, 1.32, 0.085, k.P("coil", (0.5, 0.22, 0.08), 0.4, 0.6), 14)
    chrome = k.P("chrome", (0.5, 0.6, 0.58), 0.2, 0.9, emit=(0.3, 0.6, 0.2), es=0.3)
    mb.tube([(tx + 0.19 * math.cos(2 * PI * j / 24), ty + 0.19 * math.sin(2 * PI * j / 24), 1.40) for j in range(24)],
            0.085, 0.07, chrome, closed=True, segs=10)
    mb.build(p + "_TeslaCoil", sc)
    mb = MB()
    cxp, cyp, dep = view.proj((tx, ty, 1.42))
    arc, arc_g = k.E("arc", (0.85, 1.0, 0.6), 1.6), k.G("arc_glow", (0.4, 1.0, 0.15), 0.22)
    bb_disc(mb, view, cxp, cyp, dep - 0.3, 34, arc_g, 20)
    for a0 in (150, 115, 200, 80, 245):
        x, y = cxp + math.cos(math.radians(a0)) * 14, cyp - math.sin(math.radians(a0)) * 9
        a = math.radians(a0)
        for s in range(5):
            a += rng.uniform(-0.8, 0.8)
            L = rng.uniform(6, 11)
            x2, y2 = x + math.cos(a) * L, y - math.sin(a) * L
            bb_line(mb, view, x, y, x2, y2, 1.3, dep - 0.35, arc)
            x, y = x2, y2
    mb.build(p + "_Arcs", sc)

    # lab chair: narrow back, head-rest, on a spine
    mb = MB()
    cm = k.P("chair", (0.03, 0.045, 0.05), 0.4)
    mb.prism(rrect(0.42, 0.44, 0.09), 0.08, cm, xf=T(0, CHAIR_Y, 1.02) @ R("X", 90))
    mb.prism(rrect(0.30, 0.15, 0.06), 0.08, cm, xf=T(0, CHAIR_Y, 1.375) @ R("X", 90))
    mb.box((-0.03, CHAIR_Y, 0.3), (0.03, CHAIR_Y + 0.04, 1.40), k.P("chair_spine", (0.15, 0.2, 0.2), 0.3, 0.8))
    mb.build(p + "_Chair", sc)


# ---- floor 5: Starlight Table (final boss) ----------------------------------
def room5(sc, p, th, view, rng, k):
    mb = MB()
    dark = k.P("frame", (0.012, 0.002, 0.003), 0.5)
    gold = k.P("gold", (1.0, 0.6, 0.1), 0.3, 0.7, emit=(1.0, 0.5, 0.05), es=0.2)
    wall = k.P("wall", (0.05, 0.008, 0.012), 0.7)
    shell(mb, k.P("floor", (0.03, 0.006, 0.008), 0.2, spec=0.7), wall)
    for x0, x1 in ((-8.3, -4.6), (4.6, 8.3)):
        mb.box((x0, WY, 0), (x1, WY + 0.3, 3.6), wall)
    for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
        mb.box((x - 0.05, WY, 0), (x + 0.05, WY + 0.08, 3.6), dark)
        mb.box((x - 0.02, WY - 0.02, 0), (x + 0.02, WY, 3.6), gold)
    # pointed arches closing each window bay near the top of the view
    for i in range(6):
        xa = -4.5 + i * 1.5
        mb.prism([(xa, 1.95), (xa, 1.5), (xa + 0.22, 1.70), (xa + 0.75, 1.86), (xa + 1.28, 1.70), (xa + 1.5, 1.5), (xa + 1.5, 1.95)],
                 0.06, dark, xf=T(0, WY + 0.06, 0) @ R("X", 90))
    mb.box((-4.6, WY, 0.0), (4.6, WY + 0.08, 0.12), dark)
    mb.build(p + "_Room", sc)

    # banners, gold pillars with braziers
    mb = MB()
    cloth = k.P("banner", (0.30, 0.01, 0.02), 0.8, emit=(0.3, 0.0, 0.01), es=0.25)
    for sx in (-1, 1):
        x = sx * 3.75
        mb.poly([(x - 0.3, WY - 0.1, 3.6), (x + 0.3, WY - 0.1, 3.6), (x + 0.3, WY - 0.1, 0.75), (x, WY - 0.1, 0.5),
                 (x - 0.3, WY - 0.1, 0.75)], cloth)
        mb.poly([(x, WY - 0.11, 1.42), (x + 0.14, WY - 0.11, 1.2), (x, WY - 0.11, 0.98), (x - 0.14, WY - 0.11, 1.2)], gold)
        px_ = sx * 2.3
        cyl(mb, px_, 3.7, 0, 0.95, 0.09, gold, 12)
        cyl(mb, px_, 3.7, 0, 0.08, 0.2, gold, 12)
        mb.revolve([(0.09, 0.95), (0.26, 1.08), (0.24, 1.12), (0, 1.1)], gold, 16, xf=T(px_, 3.7, 0))
        fx, fy, dep = view.proj((px_, 3.7, 1.12))
        fl = MB()
        bb_disc(fl, view, fx, fy - 10, dep - 0.2, 26, k.G("fire_glow", (1.0, 0.3, 0.05), 0.25), 18)
        bb_poly(fl, view, [(fx - 9, fy), (fx + 9, fy), (fx + 11, fy - 9), (fx + 5, fy - 15), (fx + 6, fy - 26), (fx, fy - 20),
                           (fx - 3, fy - 31), (fx - 7, fy - 17), (fx - 11, fy - 10)], dep - 0.25, k.E("fire", (1.0, 0.35, 0.05), 1.4))
        bb_poly(fl, view, [(fx - 5, fy), (fx + 5, fy), (fx + 5, fy - 8), (fx + 1, fy - 17), (fx - 4, fy - 9)], dep - 0.3,
                k.E("fire_core", (1.0, 0.85, 0.35), 1.6))
        fl.build(f"{p}_Flame{sx}", sc)
    mb.build(p + "_Props", sc)

    # throne: tall, three-spiked crown, gold studs
    mb = MB()
    cm = k.P("chair", (0.03, 0.004, 0.006), 0.4)
    out = [(-0.38, 0.25), (0.38, 0.25), (0.43, 1.22), (0.43, 1.40), (0.33, 1.30), (0.20, 1.34), (0.0, 1.485), (-0.20, 1.34),
           (-0.33, 1.30), (-0.43, 1.40), (-0.43, 1.22)]
    mb.prism(out, 0.14, cm, xf=T(0, CHAIR_Y, 0) @ R("X", 90))
    mb.prism(chair_outline(0.5, 0.6, 0.6, 1.08, 1.26), 0.02, k.P("chair_in", (0.09, 0.006, 0.01), 0.6),
             xf=T(0, CHAIR_Y - 0.14, 0) @ R("X", 90))
    stud = k.P("stud", (0.8, 0.45, 0.06), 0.3, 0.7, emit=(0.8, 0.4, 0.05), es=0.35)
    for x, z in ((-0.43, 1.40), (0.43, 1.40), (0, 1.485)):
        mb.revolve([(0, -0.03), (0.03, 0), (0, 0.03)], stud, 8, xf=T(x, CHAIR_Y - 0.07, z - 0.01))
    mb.build(p + "_Chair", sc)

    # city far below, storm sky
    city = dict(THEMES["boss"], lit=0.30)
    cz = view.pos.z
    rows = [dict(y=230, x0=-330, x1=330, w=(12, 24), gap=(2, 12), top=(cz - 55, cz - 26), tower=0.15, tower_add=(0, 4), depth=0.3),
            dict(y=420, x0=-620, x1=620, w=(18, 36), gap=(3, 20), top=(cz - 75, cz - 38), tower=0.15, tower_add=(0, 6), depth=0.7),
            dict(y=800, x0=-1200, x1=1200, w=(30, 60), gap=(5, 35), top=(cz - 110, cz - 60), tower=0.12, tower_add=(0, 12), depth=1.0)]
    mb = MB()
    add_city(mb, rng, rows, -300.0, city, p)
    mb.build(p + "_City", sc)
    mb = MB()
    mx, my, mr = 150, 34, 33
    bb_disc(mb, view, mx, my, 6000, mr * 1.8, k.G("moon_halo", (0.9, 0.1, 0.02), 0.10))
    bb_disc(mb, view, mx, my, 5900, mr, k.E("moon", (0.95, 0.07, 0.04), 1.0))
    ms = k.E("moon_spot", (0.55, 0.02, 0.02), 1.0)
    for dx, dy, r in ((-0.35, -0.25, 0.22), (0.3, 0.1, 0.16), (-0.1, 0.45, 0.13), (0.4, -0.4, 0.1)):
        bb_disc(mb, view, mx + dx * mr, my + dy * mr, 5800, r * mr, ms, 16)
    bolt_m = k.E("bolt", (1.0, 0.93, 0.65), 1.4)
    base = [(150, -4), (160, -4), (146, 16), (156, 17), (138, 38), (147, 38), (133, 58), (139, 34), (131, 33), (146, 13), (137, 12)]
    for ox, sc_, flip in ((330, 1.25, 1), (290, 0.8, -1), (-70, 0.7, 1)):
        pts = [(ox + 146 + (x - 146) * sc_ * flip, y * sc_) for x, y in base]
        bb_poly(mb, view, pts if flip > 0 else pts[::-1], 900, bolt_m)
        bb_disc(mb, view, ox + 146, 24 * sc_, 950, 46 * sc_, k.G("bolt_glow", (1.0, 0.35, 0.1), 0.16))
    add_stars(mb, view, rng, 30, (0, 0, W, 40), 7000, [k.E("star", (1.0, 0.7, 0.5), 0.9)])
    mb.build(p + "_Sky", sc)


FLOORS = {
    1: dict(name="Lobby Pit", room=room1, felt=(0.006, 0.115, 0.04), rail=(0.20, 0.05, 0.02), rail_rough=0.38,
            trim=(1.0, 0.68, 0.18), body=(0.02, 0.01, 0.008),
            spot=(1.0, 0.86, 0.62), spot_e=320.0, rim_l=(1.0, 0.55, 0.15), rim_r=(1.0, 0.3, 0.45), rim_e=200.0,
            wash=(1.0, 0.6, 0.25), wash_e=45.0,
            sky=[(0.0, (1.0, 0.50, 0.12)), (0.35, (0.85, 0.22, 0.32)), (1.0, (0.22, 0.09, 0.42))], sky_light=0.12, clouds=None),
    2: dict(name="Garage Deck", room=room2, felt=(0.115, 0.022, 0.012), rail=(0.085, 0.04, 0.02), rail_rough=0.75,
            trim=(0.45, 0.45, 0.48), body=(0.02, 0.02, 0.02),
            spot=(1.0, 0.62, 0.25), spot_e=320.0, rim_l=(1.0, 0.45, 0.08), rim_r=(0.25, 0.45, 1.0), rim_e=200.0,
            wash=(1.0, 0.5, 0.1), wash_e=70.0,
            sky=[(0.0, (0.42, 0.15, 0.03)), (0.3, (0.10, 0.04, 0.05)), (1.0, (0.012, 0.012, 0.04))], sky_light=0.15, clouds=None),
    3: dict(name="Snow Garden", room=room3, felt=(0.010, 0.035, 0.24), rail=(0.012, 0.012, 0.02), rail_rough=0.2,
            trim=(0.8, 0.85, 0.95), body=(0.01, 0.01, 0.015),
            spot=(0.85, 0.9, 1.0), spot_e=320.0, rim_l=(0.35, 0.3, 1.0), rim_r=(0.9, 0.95, 1.0), rim_e=180.0,
            wash=(0.6, 0.65, 1.0), wash_e=35.0,
            sky=[(0.0, (0.16, 0.16, 0.50)), (0.4, (0.06, 0.06, 0.28)), (1.0, (0.015, 0.015, 0.10))], sky_light=0.15, clouds=None),
    4: dict(name="Odds Laboratory", room=room4, felt=(0.006, 0.105, 0.10), rail=(0.03, 0.04, 0.045), rail_rough=0.3,
            trim=(0.6, 1.0, 0.2), body=(0.01, 0.015, 0.015),
            spot=(0.85, 1.0, 0.75), spot_e=300.0, rim_l=(0.45, 1.0, 0.1), rim_r=(0.1, 1.0, 0.7), rim_e=200.0,
            wash=(0.4, 1.0, 0.3), wash_e=45.0,
            sky=[(0.0, (0.0, 0.02, 0.02)), (1.0, (0.0, 0.01, 0.01))], sky_light=0.0, clouds=None),
    5: dict(name="Starlight Table", room=room5, felt=(0.050, 0.004, 0.008), rail=(0.02, 0.006, 0.008), rail_rough=0.3,
            trim=(1.0, 0.66, 0.1), body=(0.012, 0.002, 0.003),
            spot=(1.0, 0.68, 0.28), spot_e=330.0, rim_l=(1.0, 0.04, 0.02), rim_r=(1.0, 0.5, 0.05), rim_e=230.0,
            wash=(1.0, 0.25, 0.05), wash_e=30.0,
            sky=[(0.0, (0.60, 0.07, 0.02)), (0.3, (0.16, 0.008, 0.02)), (1.0, (0.02, 0.0, 0.008))], sky_light=0.08,
            clouds=dict(scale=(1.0, 1.0, 9.0), noise=3.2, lo=0.50, hi=0.56, color=(0.012, 0.0, 0.006), loc=(3.1, 0.4, 0.0))),
}


def build_floor(n, samples):
    th = FLOORS[n]
    p = f"Floor{n}"
    sc = bpy.data.scenes.new(p)
    setup_render(sc, W * BG_SCALE, H * BG_SCALE, samples, False, True)
    view = View(**TABLE_VIEW)
    view.camera(sc, p + "_Camera")
    rng = random.Random(1990 + n)
    k = Kit(p)

    a, b = 1.70, 1.00
    mb = MB()
    mb.poly(ellipse(a + 0.02, b + 0.02, TABLE_Z), k.P("felt", th["felt"], 0.95, spec=0.1))
    mb.build(p + "_Felt", sc)
    mb = MB()
    mb.tube(ellipse(a, b, TABLE_Z + 0.03), 0.115, 0.075, k.P("rail", th["rail"], th["rail_rough"], spec=0.6), segs=14)
    mb.build(p + "_Rail", sc)
    mb = MB()
    mb.tube(ellipse(a - 0.125, b - 0.125, TABLE_Z + 0.008), 0.012, 0.01,
            k.P("trim", th["trim"], 0.3, 0.6, emit=th["trim"], es=0.25), segs=6)
    mb.build(p + "_RailTrim", sc)
    mb = MB()
    mb.prism([(x, y) for x, y, _ in ellipse(a + 0.05, b + 0.05, 0, 64)], TABLE_Z - 0.05, k.P("table_body", th["body"]))
    mb.build(p + "_TableBody", sc)

    th["room"](sc, p, th, view, rng, k)

    sc.world = make_world(p + "_World", th["sky"], -0.01, 0.15, th["sky_light"], th["clouds"])
    add_light(sc, p + "_Spot", "SPOT", (0, -0.15, 3.3), (0, -0.05, TABLE_Z), th["spot_e"], th["spot"],
              spot_size=math.radians(36), spot_blend=1.0, shadow_soft_size=0.35)
    add_light(sc, p + "_RimL", "AREA", (-3.0, 2.9, 2.3), (-0.2, 1.1, 0.9), th["rim_e"], th["rim_l"], size=1.6)
    add_light(sc, p + "_RimR", "AREA", (3.0, 2.9, 2.3), (0.2, 1.1, 0.9), th["rim_e"], th["rim_r"], size=1.6)
    for sx in (-1, 1):
        add_light(sc, f"{p}_Wash{sx}", "POINT", (sx * 2.7, 3.3, 1.95), (sx * 2.7, 4.6, 1.0), th["wash_e"], th["wash"],
                  shadow_soft_size=0.3)
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
    ap.add_argument("--only", default="floors,title,props")
    ap.add_argument("--samples", type=int, default=64, help="background samples (denoised)")
    ap.add_argument("--sprite-samples", type=int, default=32)
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(argv)
    only = set(a.only.split(","))
    os.makedirs(OUT, exist_ok=True)

    if "floors" in only:
        only |= {f"floor{n}" for n in FLOORS}
    bgs = [f"floor{n}" for n in FLOORS] + ["title"]
    if only & set(bgs):
        fresh_file()
        scs = {f"floor{n}": build_floor(n, a.samples) for n in FLOORS}
        scs["title"] = build_title(a.samples)
        save_blend("table.blend")
        if not a.no_render:
            for k in bgs:
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
