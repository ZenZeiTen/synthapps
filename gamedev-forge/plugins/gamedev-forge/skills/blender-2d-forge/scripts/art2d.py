"""
art2d.py — flat 2D artwork for Blender 4.4+/5.x

Builds vector-cartoon assets as flat mesh polygons with Emission shaders.
Colour-exact when the scene uses view_transform = "Standard".

Write this into the .blend as a text datablock so the user can edit and re-run it:

    t = bpy.data.texts.get("art2d.py") or bpy.data.texts.new("art2d.py")
    t.clear(); t.write(source)

Load it inside Blender with:

    ns = {}
    exec(bpy.data.texts["art2d.py"].as_string(), ns)
    Art, C, circle = ns["Art"], ns["C"], ns["circle"]
"""

import bpy
import math


# ---------------------------------------------------------------- colour ----

def _s2l(c):
    """sRGB component -> scene-linear."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def H(hx, a=1.0):
    """'#RRGGBB' -> linear RGBA tuple ready for a shader input."""
    hx = hx.lstrip("#")
    return tuple([_s2l(int(hx[i:i + 2], 16) / 255.0) for i in (0, 2, 4)] + [a])


# Replace wholesale for a different production. Keep every colour named — the
# verification pass compares rendered pixels against these values.
PAL = {
    "sky": "#9BDBF5", "sky2": "#C9EEFB", "sun": "#FFD93D", "cloud": "#FFFFFF",
    "grass": "#7ED957", "grass2": "#5FBF3E", "path": "#E8D5B0", "wall": "#FFF3E0",
    "tile": "#DCF0F7", "tile2": "#B7DFEF", "floor": "#EADFD0", "wood": "#C89B6A",
    "wood2": "#A87B4A", "white": "#FFFFFF", "ink": "#3D3B4F", "red": "#FF6B6B",
    "teal": "#4ECDC4", "purple": "#A78BFA", "yellow": "#FFD93D", "skin": "#F0C08A",
    "skin2": "#D9A06A", "hair": "#4A3B33", "soap": "#BFE9FA", "soap2": "#8FD6F2",
    "water": "#7FC7E8", "water2": "#5AB4DC", "trunk": "#8B5E3C", "leaf": "#5FBF3E",
    "leaf2": "#7ED957", "metal": "#CFD8DC", "metal2": "#9EB0B8", "pink": "#FFB3C6",
    "orange": "#FF9F43", "mint": "#B8F2E6", "brick": "#F2A65A", "glass": "#CDE9F5",
    "gold": "#FFC93C", "black": "#2B2A38",
}


def C(k, a=1.0):
    """Palette lookup by name -> linear RGBA."""
    return H(PAL[k], a)


def emat(name, rgba):
    """Emission material, cached by name. Ignores lighting entirely."""
    key = "E_" + name
    m = bpy.data.materials.get(key)
    if m is not None:
        return m
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (300, 0)
    em = nt.nodes.new("ShaderNodeEmission");        em.location = (0, 0)
    em.inputs["Color"].default_value = rgba
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    m.diffuse_color = rgba
    try:
        m.surface_render_method = "DITHERED"   # not present in every version
    except Exception:
        pass
    return m


# ------------------------------------------------------------------- Art ----

class Art:
    """Accumulate flat coloured polygons, then bake a single mesh object.

    One Art instance per logical object. Per-polygon material indices keep the
    object count low without giving up per-shape colour.
    """

    def __init__(self, name, coll="Props", z=0.0):
        self.name = name
        self.coll = coll
        self.z = z
        self.v = []      # vertices
        self.f = []      # faces
        self.fm = []     # per-face material index
        self.mats = []
        self.look = {}

    def _mi(self, cname, rgba):
        if cname in self.look:
            return self.look[cname]
        self.mats.append(emat(cname, rgba))
        self.look[cname] = len(self.mats) - 1
        return self.look[cname]

    def fill(self, pts, cname, rgba=None, z=0.0):
        """Solid polygon from a 2D point list."""
        if rgba is None:
            rgba = C(cname)
        mi = self._mi(cname, rgba)
        b = len(self.v)
        for (x, y) in pts:
            self.v.append((x, y, z))
        self.f.append(list(range(b, b + len(pts))))
        self.fm.append(mi)
        return self

    def line(self, pts, w, cname, rgba=None, z=0.0, closed=False):
        """Quad-strip polyline of width w, mitred by neighbour direction."""
        if rgba is None:
            rgba = C(cname)
        mi = self._mi(cname, rgba)
        h = w * 0.5
        P = list(pts)
        if closed and P[0] != P[-1]:
            P = P + [P[0]]
        n = len(P)
        if n < 2:
            return self
        nm = []
        for i in range(n):
            if i == 0:
                dx, dy = P[1][0] - P[0][0], P[1][1] - P[0][1]
            elif i == n - 1:
                dx, dy = P[-1][0] - P[-2][0], P[-1][1] - P[-2][1]
            else:
                dx, dy = P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1]
            L = math.hypot(dx, dy) or 1.0
            nm.append((-dy / L, dx / L))
        b = len(self.v)
        for i, (x, y) in enumerate(P):
            nx, ny = nm[i]
            self.v.append((x + nx * h, y + ny * h, z))
            self.v.append((x - nx * h, y - ny * h, z))
        for i in range(n - 1):
            a = b + i * 2
            self.f.append([a, a + 1, a + 3, a + 2])
            self.fm.append(mi)
        return self

    def outline(self, pts, w, z=0.0, cname="ink"):
        return self.line(pts, w, cname, C("ink"), z, closed=True)

    def build(self, parent=None):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        for m in self.mats:
            me.materials.append(m)
        for i, p in enumerate(me.polygons):
            p.material_index = self.fm[i]
        try:
            me.shade_flat()
        except Exception:
            pass
        ob = bpy.data.objects.new(self.name, me)
        bpy.data.collections[self.coll].objects.link(ob)
        ob.location = (0.0, 0.0, self.z)
        if parent is not None:
            ob.parent = parent
            ob.matrix_parent_inverse = parent.matrix_world.inverted()
        return ob


# ------------------------------------------------- shape generators (2D) ----

def circle(cx, cy, r, n=40):
    return [(cx + r * math.cos(2 * math.pi * i / n),
             cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def ellipse(cx, cy, rx, ry, n=44, rot=0.0):
    o = []
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = rx * math.cos(a), ry * math.sin(a)
        o.append((cx + x * math.cos(rot) - y * math.sin(rot),
                  cy + x * math.sin(rot) + y * math.cos(rot)))
    return o


def rect(cx, cy, w, h):
    hw, hh = w / 2.0, h / 2.0
    return [(cx - hw, cy - hh), (cx + hw, cy - hh),
            (cx + hw, cy + hh), (cx - hw, cy + hh)]


def rrect(cx, cy, w, h, r, seg=6):
    r = min(r, w / 2.0, h / 2.0)
    hw, hh = w / 2.0 - r, h / 2.0 - r
    o = []
    for ox, oy, a0 in ((cx + hw, cy + hh, 0), (cx - hw, cy + hh, 90),
                       (cx - hw, cy - hh, 180), (cx + hw, cy - hh, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            o.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return o


def arc(cx, cy, r, a0, a1, n=24):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
            for i in range(n + 1)]


def wedge(cx, cy, r, a0, a1, n=24):
    return [(cx, cy)] + arc(cx, cy, r, a0, a1, n)


def tri(p1, p2, p3):
    return [p1, p2, p3]


def star(cx, cy, r1, r2, pts=5, rot=90.0):
    o = []
    for i in range(pts * 2):
        a = math.radians(rot + 180.0 * i / pts)
        rr = r1 if i % 2 == 0 else r2
        o.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return o


def blob(cx, cy, r, bumps=7, amp=0.16, n=64, seed=0.0):
    """Wobbly circle. Reach for this when something should look hand-drawn."""
    o = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (1.0 + amp * math.sin(bumps * a + seed))
        o.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return o


def drop(cx, cy, r, n=34):
    o = [(cx, cy + r * 2.0)]
    o += [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
          for a in [140 - 260 * i / n for i in range(n + 1)]]
    return o


def bubble_ring(cx, cy, r, n=7, br=0.16, rot=0.0):
    return [(cx + r * math.cos(rot + 2 * math.pi * i / n),
             cy + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]
