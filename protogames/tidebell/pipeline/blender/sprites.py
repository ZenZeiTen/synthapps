"""Sprites modelled and rendered in Blender (bpy 5.0): the Silt King and the bronze bell.

    python3 pipeline/blender/sprites.py [siltking] [bell]
    blender -b --factory-startup --python pipeline/blender/sprites.py -- siltking

Each pose is rendered at the manifest's frame size on a transparent background, and the
frames are placed side by side in build/renders/<name>.png. import_renders.py then snaps
them to the palette and writes art/aseprite/<name>.aseprite. The .blend is saved in
art/blender/.

The Silt King is Captain Grane after the Grey Tide takes him: a hulking body of wet silt
with his hat half sunk into the crown and two ember eyes.
"""
from __future__ import annotations

import math
import os
import sys

import bpy
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from backdrops import BLEND, OUT, hexcol  # noqa: E402


def reset(size: int):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 32
    sc.cycles.use_denoising = False
    sc.cycles.device = "CPU"
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.render.filter_size = 0.5
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.color_mode = "RGBA"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = hexcol("#404860")
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    return sc


def camera(ortho: float, z: float):
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0, -20, z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.camera = cam


def light(energy=4.0, rot=(50, 0, 40), color="#ffffff"):
    d = bpy.data.lights.new("key", "SUN")
    d.energy = energy
    d.color = hexcol(color)[:3]
    o = bpy.data.objects.new("key", d)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = tuple(math.radians(a) for a in rot)


def material(name, color, rough=0.6, metal=0.0, emit=0.0, noise=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = hexcol(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = hexcol(color)
        b.inputs["Emission Strength"].default_value = emit
    if noise:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 6.0
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = noise
        nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def sphere(loc, r, m, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o


def limb(a, b, r, m):
    ax, ay, az = a
    bx, by, bz = b
    d = math.dist(a, b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=d,
                                        location=((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2))
    o = bpy.context.object
    dx, dz = bx - ax, bz - az
    o.rotation_euler = (0, math.atan2(dx, dz), 0)
    o.data.materials.append(m)
    sphere(b, r * 1.15, m)
    return o


def siltking_pose(pose: str):
    silt = material("silt", "#8a8a56", rough=0.9, noise=0.35)
    dark = material("silt_dark", "#565434", rough=0.95, noise=0.25)
    hat = material("hat", "#343a70", rough=0.7)
    ember = material("ember", "#ffae34", emit=6.0)
    gold = material("gold", "#ffd060", rough=0.3, metal=0.8)
    lift = {"stand0": 0.0, "stand1": 0.06, "slam0": 0.1, "slam1": -0.25, "wave": 0.0}[pose]
    # body: a slumped mound with a chest and a head
    sphere((0, 0, 0.9 + lift * 0.3), 1.2, dark, (1.1, 0.7, 0.8))
    sphere((0, 0, 1.9 + lift), 1.0, silt, (1.0, 0.75, 0.9))
    sphere((0.1, 0, 2.95 + lift), 0.62, silt)
    # the captain's hat, half sunk and tilted: a wide flat brim and a low crown
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.95, depth=0.08,
                                        location=(0.1, 0, 3.38 + lift))
    brim = bpy.context.object
    brim.scale = (1.0, 0.55, 1.0)
    brim.rotation_euler = (0, math.radians(-12), 0)
    brim.data.materials.append(hat)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.5, depth=0.34,
                                        location=(0.08, 0, 3.55 + lift))
    crown = bpy.context.object
    crown.rotation_euler = (0, math.radians(-12), 0)
    crown.data.materials.append(hat)
    sphere((0.06, -0.52, 3.46 + lift), 0.08, gold)
    for s in (-1, 1):
        sphere((0.12 + s * 0.24, -0.5, 3.0 + lift), 0.09, ember)
    # arms by pose
    sh = {s: (s * 0.95, 0, 2.4 + lift) for s in (-1, 1)}
    if pose.startswith("stand"):
        hands = {-1: (-1.5, -0.1, 0.9 + lift), 1: (1.6, -0.1, 0.9 + lift)}
    elif pose == "slam0":
        hands = {-1: (-1.2, -0.2, 4.1), 1: (1.3, -0.2, 4.1)}
    elif pose == "slam1":
        hands = {-1: (-1.9, -0.3, 0.15), 1: (1.9, -0.3, 0.15)}
    else:
        hands = {-1: (-1.5, -0.1, 1.0), 1: (2.3, -0.3, 2.2)}
    for s in (-1, 1):
        elbow = ((sh[s][0] + hands[s][0]) / 2 + s * 0.3, -0.1, (sh[s][2] + hands[s][2]) / 2)
        limb(sh[s], elbow, 0.3, silt)
        limb(elbow, hands[s], 0.34, dark)
    # drips of silt at the base
    for i in range(7):
        a = i / 7 * math.tau
        sphere((math.cos(a) * 1.3, math.sin(a) * 0.4 - 0.2, 0.15), 0.28, dark, (1, 1, 0.6))


def render_frames(name: str, size: int, poses, build, ortho: float, z: float) -> str:
    frames = []
    for i, pose in enumerate(poses):
        reset(size)
        camera(ortho, z)
        light(4.5, (55, 0, 35))
        light(1.2, (60, 0, -140), "#7090ff")
        build(pose)
        path = os.path.join(OUT, f"_{name}_{i}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append(path)
        if i == 0:
            os.makedirs(BLEND, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND, name + ".blend"), compress=True)
    strip = Image.new("RGBA", (size * len(frames), size))
    for i, p in enumerate(frames):
        strip.paste(Image.open(p), (i * size, 0))
        os.remove(p)
    out = os.path.join(OUT, name + ".png")
    strip.save(out)
    return out


def bell_pose(pose: str):
    bronze = material("bronze", "#c8962c", rough=0.25, metal=1.0)
    rim = material("rim", "#8a5a1a", rough=0.3, metal=1.0)
    # a bell: a lathe profile
    prof = [(0.0, 1.9), (0.35, 1.88), (0.55, 1.7), (0.62, 1.2), (0.7, 0.6), (0.9, 0.25), (1.05, 0.05), (1.0, 0.0)]
    verts, faces = [], []
    seg = 24
    for k in range(seg):
        a = k / seg * math.tau
        for (r, zz) in prof:
            verts.append((math.cos(a) * r, math.sin(a) * r, zz))
    n = len(prof)
    for k in range(seg):
        for j in range(n - 1):
            a0 = k * n + j
            b0 = ((k + 1) % seg) * n + j
            faces.append((a0, b0, b0 + 1, a0 + 1))
    me = bpy.data.meshes.new("bell")
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new("bell", me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(bronze)
    for poly in me.polygons:
        poly.use_smooth = True
    bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.07, location=(0, 0, 2.0))
    t = bpy.context.object
    t.rotation_euler = (math.radians(90), 0, 0)
    t.data.materials.append(rim)
    o.rotation_euler = (0, math.radians(8 if pose == "a" else -8), 0)


def main(argv):
    names = [a for a in argv if a in ("siltking", "bell")] or ["siltking", "bell"]
    os.makedirs(OUT, exist_ok=True)
    if "siltking" in names:
        print(render_frames("siltking", 96, ["stand0", "stand1", "slam0", "slam1", "wave"], siltking_pose, 5.4, 2.35))
    if "bell" in names:
        print(render_frames("bell", 20, ["a", "b"], bell_pose, 2.4, 1.0))


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(args)
