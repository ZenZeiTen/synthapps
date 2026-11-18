"""The six stages' parallax backdrops, modelled and rendered in Blender (bpy 5.0).

    python3 pipeline/blender/backdrops.py [theme ...]        # bpy as a Python module
    blender -b --factory-startup --python pipeline/blender/backdrops.py -- reach

Each stage gets two 640x224 layers that repeat sideways: "far" (sky and distant shapes,
opaque) and "mid" (nearer silhouettes, transparent). Everything is placed within one
period and copied one period to each side, so the left and right edges meet. The renders
go to build/renders/, then pipeline/aseprite/import_renders.py reduces them to the palette
and writes art/aseprite/bg_<theme>_<layer>.aseprite. The .blend files are saved in
art/blender/ for editing. The mid scene is also exported as web/public/content/models/
<theme>_mid.glb: the three.js build draws it as a real 3D layer.
"""
from __future__ import annotations

import math
import os
import random
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "build", "renders")
BLEND = os.path.join(ROOT, "art", "blender")
MODELS = os.path.join(ROOT, "web", "public", "content", "models")
W, H = 640, 224
PERIOD = 20.0                      # scene units across one layer
UNIT_H = PERIOD * H / W            # scene units top to bottom


def hexcol(h: str, a: float = 1.0):
    h = h.lstrip("#")
    lin = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        lin.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*lin, a)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.cycles.device = "CPU"
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    sc.render.resolution_percentage = 100
    sc.render.filter_size = 0.6
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = PERIOD
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (PERIOD / 2, -30, UNIT_H / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    return sc


def world(top: str, bottom: str, strength=1.0):
    w = bpy.data.worlds.new("world")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = hexcol(bottom)
    ramp.color_ramp.elements[1].color = hexcol(top)
    geo = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Window"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def mat(name: str, color: str, emit: float = 0.0, rough=0.8):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = hexcol(color)
    b.inputs["Roughness"].default_value = rough
    if emit > 0:
        b.inputs["Emission Color"].default_value = hexcol(color)
        b.inputs["Emission Strength"].default_value = emit
    return m


def flat(name: str, color: str):
    """An unlit, flat colour (silhouettes and the sky shapes)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hexcol(color)
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def tiled(make, x: float):
    """Calls make(x) at x and one period to each side (so the layer repeats cleanly)."""
    for dx in (-PERIOD, 0.0, PERIOD):
        make(x + dx)


def box(x, z, w, h, m, y=0.0, rot=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + h / 2))
    o = bpy.context.object
    o.scale = (w, 0.2, h)
    o.rotation_euler[1] = rot
    o.data.materials.append(m)
    return o


def cone(x, z, r, h, m, y=0.0, verts=6):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=0, depth=h, location=(x, y, z + h / 2))
    o = bpy.context.object
    o.data.materials.append(m)
    return o


def blob(x, z, r, m, y=0.0, sz=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=r, location=(x, y, z))
    o = bpy.context.object
    o.scale = (1, 0.3, sz)
    o.data.materials.append(m)
    return o


def cyl(x, z, r, h, m, y=0.0, tilt=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=r, depth=h, location=(x, y, z + h / 2))
    o = bpy.context.object
    o.rotation_euler[1] = tilt
    o.data.materials.append(m)
    return o


def sun(elev=35, azim=40, strength=3.0, color="#ffffff"):
    d = bpy.data.lights.new("sun", "SUN")
    d.energy = strength
    d.color = hexcol(color)[:3]
    o = bpy.data.objects.new("sun", d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90 - elev), 0, math.radians(azim))


# ------------------------------------------------------------------ the stages
def far_reach(r):
    world("#3a1d6e", "#c07ac8")
    for i in range(9):
        x = i * PERIOD / 9 + r.uniform(-0.6, 0.6)
        tiled(lambda xx, s=r.uniform(1.6, 2.6), h=r.uniform(2.5, 4.2): (
            blob(xx, h, s, flat("canopy_far", "#3a2a6a"), sz=0.6),
            cyl(xx, 0, 0.18, h, flat("canopy_far", "#3a2a6a"))), x)
    tiled(lambda xx: box(xx, 0, PERIOD, 1.1, flat("marsh", "#2a1a50")), PERIOD / 2)


def mid_reach(r):
    for i in range(6):
        x = i * PERIOD / 6 + r.uniform(-0.5, 0.5)
        h = r.uniform(4.5, 6.5)
        def tree(xx, h=h, lean=r.uniform(-0.15, 0.15), k=i):
            cyl(xx, 0, 0.35, h, flat("trunk", "#20304a"), tilt=lean)
            blob(xx, h, r.uniform(1.8, 2.4), flat("leaves", "#1c4a3a"), sz=0.5)
            for j in range(3):
                cyl(xx + (j - 1) * 0.5, 0, 0.06, 1.4, flat("trunk", "#20304a"), tilt=(j - 1) * 0.5)
        tiled(tree, x)
    for i in range(10):
        x = r.uniform(0, PERIOD)
        tiled(lambda xx, h=r.uniform(1.0, 3.0): cyl(xx, UNIT_H - h, 0.05, h, flat("vine", "#1c4a3a")), x)


def far_harbor(r):
    world("#5a2a4a", "#f0a050")
    blob(PERIOD * 0.72, 2.2, 1.0, flat("sun", "#ffd070"))
    tiled(lambda xx: box(xx, 0, PERIOD, 1.4, flat("sea_far", "#3a4a7a")), PERIOD / 2)
    def lighthouse(xx):
        box(xx, 1.4, 0.5, 3.0, flat("house_far", "#4a2a4a"))
        box(xx, 4.4, 0.7, 0.5, flat("lamp", "#ffe080"))
    tiled(lighthouse, PERIOD * 0.2)
    for i in range(3):
        x = PERIOD * (0.4 + i * 0.18)
        def ship(xx, s=r.uniform(0.8, 1.1)):
            box(xx, 1.3, 2.0 * s, 0.4, flat("ship_far", "#4a2a4a"))
            for k in (-0.5, 0.3):
                cyl(xx + k * s, 1.6, 0.04, 2.0 * s, flat("ship_far", "#4a2a4a"))
                box(xx + k * s, 2.2, 0.8 * s, 0.9 * s, flat("sail_far", "#7a4a5a"))
        tiled(ship, x)


def mid_harbor(r):
    for i in range(5):
        x = i * PERIOD / 5 + 1.0
        def shed(xx, w=r.uniform(2.2, 3.2), h=r.uniform(2.2, 3.4)):
            box(xx, 0, w, h, flat("shed", "#2a2040"))
            cone(xx, h, w * 0.62, 1.0, flat("shed", "#2a2040"), verts=4)
            box(xx - w * 0.25, h * 0.5, 0.3, 0.4, flat("window", "#ffb050"))
        tiled(shed, x)
    def crane(xx):
        box(xx, 0, 0.25, 5.2, flat("crane", "#1a1830"))
        box(xx + 1.2, 5.0, 2.8, 0.2, flat("crane", "#1a1830"))
        cyl(xx + 2.4, 3.6, 0.02, 1.4, flat("crane", "#1a1830"))
    tiled(crane, PERIOD * 0.62)


def far_village(r):
    world("#78b4e0", "#f0e0b0")
    for i in range(5):
        x = i * PERIOD / 5
        tiled(lambda xx, s=r.uniform(2.5, 4.0): blob(xx, 0.2, s, flat("hill", "#8aa070"), sz=0.45), x)
    tiled(lambda xx: box(xx, 0, PERIOD, 0.8, flat("shallows", "#6a9ab0")), PERIOD / 2)


def mid_village(r):
    for i in range(5):
        x = i * PERIOD / 5 + r.uniform(-0.4, 0.4)
        def house(xx, w=r.uniform(1.8, 2.4), z=r.uniform(1.6, 2.4)):
            for k in (-0.4, 0.4):
                cyl(xx + k * w, 0, 0.07, z, flat("stilt", "#5a4028"))
            box(xx, z, w, 1.4, flat("hut", "#7a5a38"))
            cone(xx, z + 1.4, w * 0.75, 1.1, flat("thatch", "#b09050"), verts=4)
            box(xx + 0.2, z + 0.4, 0.35, 0.5, flat("door", "#3a2818"))
        tiled(house, x)


def far_cliffs(r):
    world("#3a78d0", "#b0e0f0")
    tiled(lambda xx: box(xx, 0, PERIOD, 2.0, flat("sea", "#2a5a9a")), PERIOD / 2)
    for i in range(4):
        x = i * PERIOD / 4 + 1
        tiled(lambda xx, h=r.uniform(3, 5): cone(xx, 1.5, r.uniform(1.4, 2.2), h, flat("cliff_far", "#6a86a8"), verts=5), x)
    for i in range(4):
        x = r.uniform(0, PERIOD)
        tiled(lambda xx, z=r.uniform(5, 6.4): blob(xx, z, r.uniform(0.8, 1.4), flat("cloud", "#f0f8ff"), sz=0.35), x)


def mid_cliffs(r):
    for i in range(5):
        x = i * PERIOD / 5 + r.uniform(-0.5, 0.5)
        def spire(xx, h=r.uniform(3.5, 6.0)):
            cone(xx, 0, r.uniform(0.9, 1.3), h, flat("rock", "#4a5a6a"), verts=5)
            cone(xx + 0.5, 0, 0.6, h * 0.6, flat("rock2", "#3a4858"), verts=5)
        tiled(spire, x)


def far_abbey(r):
    world("#101830", "#202a50")
    for i in range(6):
        x = i * PERIOD / 6
        def arch(xx):
            box(xx - 1.2, 0, 0.5, 5.0, flat("pillar_far", "#26305a"))
            box(xx + 1.2, 0, 0.5, 5.0, flat("pillar_far", "#26305a"))
            box(xx, 5.0, 3.0, 0.5, flat("pillar_far", "#26305a"))
            box(xx, 2.2, 0.7, 1.6, flat("window", "#5ab4d0"))
        tiled(arch, x)


def mid_abbey(r):
    for i in range(4):
        x = i * PERIOD / 4 + 1.2
        tiled(lambda xx: box(xx, 0, 0.9, UNIT_H, flat("pillar", "#161c3a")), x)
    for i in range(6):
        x = r.uniform(0, PERIOD)
        def chain(xx, h=r.uniform(1.5, 3.5)):
            cyl(xx, UNIT_H - h, 0.04, h, flat("chain", "#3a4468"))
            blob(xx, UNIT_H - h, 0.18, flat("lantern", "#e0a040"))
        tiled(chain, x)


def far_brinecrow(r):
    world("#101428", "#3a3060")
    blob(PERIOD * 0.3, 5.6, 0.7, flat("moon", "#e0e0c0"))
    tiled(lambda xx: box(xx, 0, PERIOD, 1.2, flat("sea_night", "#1a2448")), PERIOD / 2)
    for i in range(2):
        x = PERIOD * (0.55 + i * 0.3)
        def ship(xx):
            box(xx, 1.1, 3.0, 0.6, flat("ship_far", "#242040"))
            for k in (-0.8, 0.0, 0.8):
                cyl(xx + k, 1.6, 0.05, 2.6, flat("ship_far", "#242040"))
                box(xx + k, 2.4, 0.9, 1.1, flat("sail_night", "#3a3458"))
        tiled(ship, x)


def mid_brinecrow(r):
    for i in range(3):
        x = i * PERIOD / 3 + 1.5
        def mast(xx):
            cyl(xx, 0, 0.18, UNIT_H, flat("mast", "#20182a"))
            box(xx, UNIT_H * 0.7, 3.2, 0.12, flat("mast", "#20182a"))
            box(xx + 0.3, UNIT_H * 0.45, 2.6, 2.2, flat("sail", "#4a3a3a"))
            for k in range(4):
                cyl(xx - 1.6 + k * 0.4, 0, 0.02, UNIT_H * 0.72, flat("rope", "#20182a"), tilt=0.25 - k * 0.05)
        tiled(mast, x)


STAGES = {
    "reach": (far_reach, mid_reach),
    "harbor": (far_harbor, mid_harbor),
    "village": (far_village, mid_village),
    "cliffs": (far_cliffs, mid_cliffs),
    "abbey": (far_abbey, mid_abbey),
    "brinecrow": (far_brinecrow, mid_brinecrow),
}


def render(theme: str, layer: str) -> str:
    sc = reset()
    r = random.Random(f"{theme}:{layer}")
    far, mid = STAGES[theme]
    if layer == "far":
        far(r)
        sc.render.film_transparent = False
    else:
        world("#000000", "#000000", 0.0)
        mid(r)
        sc.render.film_transparent = True
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(BLEND, exist_ok=True)
    path = os.path.join(OUT, f"bg_{theme}_{layer}.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND, f"bg_{theme}_{layer}.blend"), compress=True)
    if layer == "mid":
        # the same nearer scene as a glTF model for the three.js build's 3D mid layer
        os.makedirs(MODELS, exist_ok=True)
        for o in list(bpy.data.objects):
            if o.type != "MESH":
                o.select_set(False)
            else:
                o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, f"{theme}_mid.glb"), export_format="GLB",
                                  use_selection=True, export_apply=True, export_materials="EXPORT",
                                  export_yup=True)
    return path


def main(argv):
    themes = [a for a in argv if a in STAGES] or list(STAGES)
    for t in themes:
        for layer in ("far", "mid"):
            print(render(t, layer))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(args)
