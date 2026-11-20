"""Level-kit models for Gates Below, exported as .glb into godot/content/models/.

    python3 pipeline/blender/props.py

Grid: one square is 2 x 2 m, walls 2 m high; the pivot is the square's floor centre.
Each piece is modelled facing Blender +Y ("ahead" = the direction the party walks in),
which glTF turns into Godot -Z, the engine's forward. The view rotates a piece by the
direction the party enters its square.

Materials sample the game's own textures (godot/content/textures, drawn in Aseprite)
with Closest interpolation, so the GLB carries NEAREST samplers.
"""
from __future__ import annotations

import json
import os
import struct
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

TEX = os.path.join(kit.ROOT, "godot", "content", "textures")
OUT = os.path.join(kit.ROOT, "godot", "content", "models")
STEPS = 8


def tex_mat(name: str, tex: str, scale=(1.0, 1.0)) -> bpy.types.Material:
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    img = bpy.data.images.load(os.path.join(TEX, tex + ".png"))
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.interpolation = "Closest"
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    try:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    except Exception:
        pass
    m.use_backface_culling = True
    return m


def block(name, x0, y0, z0, x1, y1, z1, mat, coll):
    """Axis-aligned box from two corners, with box-projected UVs at 1 texture per 2 m."""
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    o = bpy.context.active_object
    o.name = name
    o.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    o.scale = (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # world-space box projection so texels stay the same size on every face
    me = o.data
    uv = me.uv_layers.active
    for poly in me.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co + o.location
            if abs(n.z) > 0.5:
                u, w = v.x, v.y
            elif abs(n.x) > 0.5:
                u, w = v.y, v.z
            else:
                u, w = v.x, v.z
            uv.data[li].uv = (u / 2.0, w / 2.0)
    o.data.materials.append(mat)
    for c in o.users_collection:
        c.objects.unlink(o)
    coll.objects.link(o)
    return o


def new_piece(name: str) -> bpy.types.Collection:
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def stairs_down(stone, wall):
    c = new_piece("stairs_down")
    h = 2.0 / STEPS
    for i in range(STEPS):
        y0 = -1.0 + i * (2.0 / STEPS)
        block("step%d" % i, -1.0, y0, -2.2, 1.0, 1.0, -h * (i + 1), stone, c)
    block("well_l", -1.2, -1.0, -2.2, -1.0, 1.0, 0.0, wall, c)
    block("well_r", 1.0, -1.0, -2.2, 1.2, 1.0, 0.0, wall, c)
    block("lip", -1.0, -1.08, -0.08, 1.0, -1.0, 0.0, stone, c)
    return c


def stairs_up(stone, wall):
    c = new_piece("stairs_up")
    h = 2.0 / STEPS
    for i in range(STEPS):
        y0 = -1.0 + i * (2.0 / STEPS)
        block("step%d" % i, -1.0, y0, 0.0, 1.0, 1.0, h * (i + 1) * 0.9, stone, c)
    block("shaft_l", -1.2, -1.0, 2.0, -1.0, 1.0, 3.6, wall, c)
    block("shaft_r", 1.0, -1.0, 2.0, 1.2, 1.0, 3.6, wall, c)
    return c


def arch(stone):
    """A door frame on the face ahead (at y = +1): two posts and a lintel."""
    c = new_piece("arch")
    block("post_l", -1.0, 0.86, 0.0, -0.72, 1.12, 2.0, stone, c)
    block("post_r", 0.72, 0.86, 0.0, 1.0, 1.12, 2.0, stone, c)
    block("lintel", -0.72, 0.86, 1.72, 0.72, 1.12, 2.0, stone, c)
    return c


def export(coll: bpy.types.Collection, path: str) -> dict:
    vl = bpy.context.view_layer
    vl.update()
    for o in vl.objects:
        o.select_set(o.name in coll.objects)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_animations=False, export_image_format="AUTO")
    blob = open(path, "rb").read()
    js = json.loads(blob[20:20 + struct.unpack("<I", blob[12:16])[0]])
    return {"nodes": len(js["nodes"]), "meshes": len(js.get("meshes", [])), "images": len(js.get("images", [])),
            "samplers": js.get("samplers", [])}


def main():
    kit.reset()
    os.makedirs(OUT, exist_ok=True)
    stone = tex_mat("stone", "floor_flag")
    wall = tex_mat("wall", "wall_stone")
    crypt = tex_mat("crypt", "wall_crypt")
    pieces = {"stairs_down": stairs_down(stone, wall), "stairs_up": stairs_up(stone, wall), "arch": arch(crypt)}
    for name, coll in pieces.items():
        info = export(coll, os.path.join(OUT, name + ".glb"))
        assert info["meshes"] == len(coll.objects), (name, info)
        print(name, info)
    os.makedirs(os.path.join(kit.ROOT, "art", "blender"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.ROOT, "art", "blender", "kit.blend"), compress=True)


if __name__ == "__main__":
    main()
