"""Monster and NPC sprites for Gates Below, modelled from primitives and rendered
orthographically. One pixel density for the whole cast: 25 px per metre (normal
canvas 56 px = 2.24 m, big canvas 80 px = 3.2 m).

    python3 pipeline/blender/sprites.py [name ...]       # bpy as a module
    blender -b --factory-startup --python pipeline/blender/sprites.py -- [name ...]

Writes build/renders/<name>/<frame>.png and art/blender/sprites_<name>.blend (the posed
model, editable). pipeline/aseprite/import_renders.py then locks the frames to the
palette, outlines them and writes art/aseprite/mob_<name>.aseprite.

Frames (all monsters): idle_0 idle_1 attack_0 attack_1 hurt side_0 side_1 back_0 back_1.
NPCs render idle_0 idle_1 only.
"""
from __future__ import annotations

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import ball, box, cone, cyl, empty, limb, ring  # noqa: E402

PX_PER_M = 25
FRAMES = ["idle_0", "idle_1", "attack_0", "attack_1", "hurt", "side_0", "side_1", "back_0", "back_1"]
NPC_FRAMES = ["idle_0", "idle_1"]


# ------------------------------------------------------------------ humanoid

def humanoid(p: dict) -> dict:
    """A jointed figure facing -Y. p: colours and proportions; returns parts by name."""
    s = p.get("scale", 1.0)
    root = empty("root")
    hips = empty("hips", (0, 0, 0.95 * s), root)
    parts = {"root": root, "hips": hips}
    thin = p.get("thin", 0.065) * s
    # legs
    for side, sx in (("l", 0.11), ("r", -0.11)):
        up = limb("leg_" + side, hips, (sx * s, 0, 0), 0.45 * s, thin * 1.15, p["legs"])
        lo = limb("shin_" + side, up, (0, 0, -0.45 * s), 0.43 * s, thin, p["legs"])
        box("foot_" + side, (0, -0.06 * s, -0.45 * s), (0.12 * s, 0.24 * s, 0.07 * s), p.get("feet", p["legs"]), lo)
        parts["leg_" + side] = up
        parts["shin_" + side] = lo
    # torso
    torso = empty("torso", (0, 0, 0), hips)
    parts["torso"] = torso
    if p.get("ribs"):
        cyl("spine", (0, 0.04 * s, 0.25 * s), (0.06 * s, 0.06 * s, 0.5 * s), p["body"], torso)
        for i, z in enumerate((0.22, 0.32, 0.42)):
            ring("rib%d" % i, (0, 0, z * s), (0.62 * s, 0.46 * s, 0.9 * s), p["body"], torso)
        box("pelvis", (0, 0, 0.02 * s), (0.3 * s, 0.14 * s, 0.1 * s), p["body"], torso)
    else:
        box("belly", (0, 0, 0.14 * s), (0.34 * s, 0.22 * s, 0.3 * s), p["body"], torso)
        box("chest", (0, 0, 0.38 * s), (0.42 * s, 0.26 * s, 0.26 * s), p.get("chest", p["body"]), torso)
    if p.get("robe"):
        cone("robe", (0, 0, -0.35 * s), (0.9 * s, 0.7 * s, 1.3 * s), p["robe"], torso)
    # head
    neck = empty("neck", (0, 0, 0.52 * s), torso)
    parts["neck"] = neck
    head = ball("head", (0, 0, 0.14 * s), (0.25 * s, 0.26 * s, 0.28 * s), p["skin"], neck)
    parts["head"] = head
    ec = p.get("eyes", 0)
    for sx in (0.055, -0.055):
        ball("eye", (sx * s, -0.115 * s, 0.16 * s), (0.05 * s, 0.03 * s, 0.05 * s), ec, neck, emit=p.get("eye_glow", False), segments=8)
    if p.get("jaw"):
        box("jaw", (0, -0.03 * s, 0.02 * s), (0.16 * s, 0.14 * s, 0.07 * s), p["skin"], neck)
    if p.get("hair") is not None:
        ball("hair", (0, 0.03 * s, 0.2 * s), (0.27 * s, 0.26 * s, 0.22 * s), p["hair"], neck)
        if p.get("long_hair"):
            box("hair_back", (0, 0.1 * s, 0.02 * s), (0.26 * s, 0.1 * s, 0.34 * s), p["hair"], neck)
    if p.get("hood") is not None:
        cone("hood", (0, 0.02 * s, 0.2 * s), (0.36 * s, 0.36 * s, 0.5 * s), p["hood"], neck)
    if p.get("helm") is not None:
        ball("helm", (0, 0.01 * s, 0.2 * s), (0.3 * s, 0.3 * s, 0.24 * s), p["helm"], neck)
        if p.get("horns"):
            for sx in (1, -1):
                cone("horn", (0.16 * sx * s, 0, 0.3 * s), (0.08 * s, 0.08 * s, 0.3 * s), p["horns"], neck, rot=(0, -35 * sx, 0))
    # arms
    for side, sx in (("l", 0.25), ("r", -0.25)):
        sh = limb("arm_" + side, torso, (sx * s, 0, 0.47 * s), 0.3 * s * p.get("arm_len", 1.0), thin, p.get("sleeves", p["body"]), rot=(0, 8 if sx > 0 else -8, 0))
        fo = limb("fore_" + side, sh, (0, 0, -0.3 * s * p.get("arm_len", 1.0)), 0.28 * s * p.get("arm_len", 1.0), thin * 0.9, p["skin"] if p.get("bare_arms") else p.get("sleeves", p["body"]),
                  end_ball=0.1 * s, end_color=p["skin"])
        parts["arm_" + side] = sh
        parts["fore_" + side] = fo
        if p.get("claws"):
            for k in (-1, 0, 1):
                cone("claw", (k * 0.03 * s, -0.02 * s, -0.36 * s * p.get("arm_len", 1.0)), (0.03 * s, 0.03 * s, 0.12 * s), p["claws"], fo, rot=(180, 0, 0))
        if p.get("pauldrons") is not None:
            ball("pauldron", (sx * s, 0, 0.5 * s), (0.2 * s, 0.22 * s, 0.14 * s), p["pauldrons"], torso)
    return parts


def hand(parts: dict, side: str) -> bpy.types.Object:
    fo = parts["fore_" + side]
    return empty("hand_" + side, (0, 0, fo.children[0].scale.z * -1.0), fo)


# ------------------------------------------------------------------ creatures

def build_rat():
    root = empty("root")
    root.scale = (1.5, 1.5, 1.5)   # giant cellar rats, readable at 25 px/m
    body = empty("body", (0, 0, 0), root)
    ball("torso", (0, 0.05, 0.34), (0.5, 0.95, 0.45), 14, body)
    ball("belly", (0, -0.12, 0.26), (0.36, 0.5, 0.26), 15, body)
    head = empty("headj", (0, -0.45, 0.36), body)
    ball("head", (0, -0.08, 0.02), (0.32, 0.4, 0.3), 14, head)
    cone("snout", (0, -0.32, -0.02), (0.16, 0.16, 0.26), 15, head, rot=(90, 0, 0))
    ball("nose", (0, -0.45, -0.02), (0.06, 0.06, 0.06), 27, head, segments=8)
    for sx in (0.1, -0.1):
        ball("eye", (sx, -0.22, 0.08), (0.06, 0.04, 0.06), 28, head, emit=True, segments=8)
        ball("ear", (sx * 1.5, -0.02, 0.16), (0.14, 0.05, 0.16), 16, head)
    tail = empty("tail", (0, 0.5, 0.3), body)
    for i in range(5):
        cyl("tail%d" % i, (0, 0.12 * i, 0.05 * i - 0.02 * i * i), (0.06 - i * 0.008, 0.06 - i * 0.008, 0.16), 16, tail, rot=(70 - i * 12, 0, 0))
    legs = {}
    for name, (x, y) in {"fl": (0.18, -0.28), "fr": (-0.18, -0.28), "bl": (0.2, 0.32), "br": (-0.2, 0.32)}.items():
        legs[name] = limb("leg_" + name, body, (x, y, 0.22), 0.2, 0.05, 15, end_ball=0.07, end_color=16)
    parts = {"root": root, "body": body, "head": head, "tail": tail}
    parts.update(legs)
    poses = {
        "idle_0": {}, "idle_1": {"body": ("loc", (0, 0, -0.02)), "headj": (8, 0, 0)},
        "attack_0": {"body": ("loc", (0, 0.1, 0.05)), "headj": (-20, 0, 0)},
        "attack_1": {"body": ("loc", (0, -0.3, 0.08)), "headj": (15, 0, 0), "leg_fl": (-40, 0, 0), "leg_fr": (-40, 0, 0)},
        "hurt": {"body": ("loc", (0, 0.15, 0)), "headj": (-30, 0, 0)},
        "side_0": {"leg_fl": (-30, 0, 0), "leg_br": (-30, 0, 0), "leg_fr": (25, 0, 0), "leg_bl": (25, 0, 0)},
        "side_1": {"leg_fl": (25, 0, 0), "leg_br": (25, 0, 0), "leg_fr": (-30, 0, 0), "leg_bl": (-30, 0, 0)},
        "back_0": {"tail": (10, 0, 12)}, "back_1": {"tail": (10, 0, -12)},
    }
    parts["headj"] = head
    return parts, poses, False


def build_ooze():
    root = empty("root")
    blob = empty("blob", (0, 0, 0), root)
    ball("mass", (0, 0, 0.45), (1.35, 1.1, 0.9), 20, blob, segments=24)
    ball("skirt", (0, 0, 0.12), (1.55, 1.3, 0.3), 19, blob, segments=24)
    ball("sheen", (-0.25, -0.4, 0.66), (0.4, 0.2, 0.26), 21, blob)
    for (x, z, r) in [(0.35, 0.35, 0.12), (0.15, 0.7, 0.08), (-0.4, 0.3, 0.1), (0.45, 0.62, 0.07)]:
        ball("bubble", (x, -0.5, z), (r, r * 0.6, r), 21, blob, segments=8)
    for sx in (0.18, -0.18):
        ball("eyeball", (sx, -0.5, 0.62), (0.16, 0.08, 0.16), 8, blob, segments=12)
        ball("pupil", (sx * 1.05, -0.56, 0.6), (0.07, 0.04, 0.07), 0, blob, segments=8)
    parts = {"root": root, "blob": blob}
    poses = {
        "idle_0": {}, "idle_1": {"blob": ("scale", (1.06, 1.0, 0.94))},
        "attack_0": {"blob": ("scale", (0.85, 0.9, 1.3))},
        "attack_1": {"blob": ("scale", (1.25, 1.1, 0.75))},
        "hurt": {"blob": ("scale", (1.2, 1.0, 0.7))},
        "side_0": {"blob": ("scale", (1.0, 1.1, 0.95))}, "side_1": {"blob": ("scale", (1.0, 0.95, 1.05))},
        "back_0": {"blob": ("scale", (1.05, 1.0, 0.95))}, "back_1": {"blob": ("scale", (0.97, 1.0, 1.03))},
    }
    return parts, poses, False


def _walk(parts, a=25):
    return ({"leg_l": (-a, 0, 0), "leg_r": (a, 0, 0), "arm_l": (a, 0, 8), "arm_r": (-a, 0, -8), "shin_l": (10, 0, 0), "shin_r": (10, 0, 0)},
            {"leg_l": (a, 0, 0), "leg_r": (-a, 0, 0), "arm_l": (-a, 0, 8), "arm_r": (a, 0, -8), "shin_l": (10, 0, 0), "shin_r": (10, 0, 0)})


def _fighter_poses(parts, extra=None):
    w0, w1 = _walk(parts)
    poses = {
        "idle_0": {}, "idle_1": {"hips": ("loc", (0, 0, parts["hips"].location.z - 0.02)), "neck": (4, 0, 0)},
        "attack_0": {"arm_r": (150, 0, -10), "fore_r": (-30, 0, 0), "torso": (0, 0, -15)},
        "attack_1": {"arm_r": (-75, 0, -5), "fore_r": (-10, 0, 0), "torso": (-12, 0, 15), "hips": ("loc", (0, -0.06, parts["hips"].location.z))},
        "hurt": {"torso": (15, 0, 0), "neck": (20, 0, 0), "arm_l": (30, 0, 25), "arm_r": (30, 0, -25)},
        "side_0": w0, "side_1": w1, "back_0": w0, "back_1": w1,
    }
    if extra:
        for k, v in extra.items():
            poses[k].update(v)
    return poses


def build_bones():
    parts = humanoid({"skin": 7, "body": 7, "legs": 7, "feet": 6, "eyes": 28, "eye_glow": True, "jaw": True, "ribs": True, "thin": 0.04})
    sword = empty("sword", (0, 0, -0.3), parts["fore_r"])
    box("blade", (0, -0.35, 0), (0.05, 0.7, 0.02), 5, sword)
    box("guard", (0, 0, 0), (0.2, 0.04, 0.04), 12, sword)
    cyl("grip", (0, 0.08, 0), (0.04, 0.04, 0.14), 10, sword, rot=(90, 0, 0))
    shield = empty("shield", (0, -0.1, -0.2), parts["fore_l"])
    cyl("board", (0, 0, 0), (0.46, 0.46, 0.05), 27, shield, rot=(90, 0, 0), segments=16)
    cyl("boss", (0, -0.03, 0), (0.12, 0.12, 0.05), 5, shield, rot=(90, 0, 0), segments=8)
    pose(parts, {"arm_l": (-40, 0, 20), "fore_l": (-50, 0, 0), "arm_r": (-10, 0, -10), "fore_r": (-60, 0, 0)})
    poses = _fighter_poses(parts, {"idle_0": {"arm_l": (-40, 0, 20), "fore_l": (-50, 0, 0), "arm_r": (-10, 0, -10), "fore_r": (-60, 0, 0)},
                                   "idle_1": {"arm_l": (-40, 0, 20), "fore_l": (-50, 0, 0), "arm_r": (-10, 0, -10), "fore_r": (-60, 0, 0)}})
    return parts, poses, False


def build_ghoul():
    parts = humanoid({"skin": 20, "body": 12, "legs": 11, "feet": 20, "eyes": 30, "eye_glow": True, "jaw": True, "bare_arms": True,
                      "sleeves": 19, "arm_len": 1.3, "claws": 7, "hair": 1, "thin": 0.055})
    hunch = {"torso": (-25, 0, 0), "neck": (20, 0, 0), "shin_l": (15, 0, 0), "shin_r": (15, 0, 0), "leg_l": (-10, 0, 0), "leg_r": (-10, 0, 0),
             "arm_l": (-35, 0, 15), "arm_r": (-35, 0, -15), "fore_l": (-20, 0, 0), "fore_r": (-20, 0, 0)}
    poses = _fighter_poses(parts)
    for k in ("idle_0", "idle_1"):
        poses[k] = dict(hunch, **poses[k]) if k == "idle_1" else dict(hunch)
    poses["attack_0"] = dict(hunch, **{"arm_l": (140, 0, 30), "arm_r": (140, 0, -30), "fore_l": (-40, 0, 0), "fore_r": (-40, 0, 0)})
    poses["attack_1"] = dict(hunch, **{"arm_l": (-80, 0, -10), "arm_r": (-80, 0, 10), "torso": (-40, 0, 0), "hips": ("loc", (0, -0.1, 0.95))})
    return parts, poses, False


def build_wisp():
    root = empty("root")
    core = empty("core", (0, 0, 1.25), root)
    ball("halo", (0, 0.2, 0), (0.7, 0.4, 0.7), 23, core, emit=True, segments=20)
    ball("glow", (0, 0.0, 0), (0.5, 0.3, 0.5), 24, core, emit=True, segments=20)
    ball("heart", (0, -0.2, 0.03), (0.28, 0.2, 0.28), 25, core, emit=True, segments=16)
    for sx in (0.07, -0.07):
        ball("eye", (sx, -0.33, 0.06), (0.05, 0.03, 0.07), 8, core, emit=True, segments=8)
    tail = empty("tail", (0, 0.1, -0.2), core)
    for i, (x, z, r) in enumerate([(0.0, -0.2, 0.3), (0.08, -0.45, 0.22), (-0.05, -0.68, 0.14), (0.05, -0.85, 0.08)]):
        cone("wisp%d" % i, (x, 0.1, z), (r, r, 0.35), 24 if i < 2 else 23, tail, rot=(180, 0, 0), emit=True)
    parts = {"root": root, "core": core, "tail": tail}
    poses = {
        "idle_0": {}, "idle_1": {"core": ("loc", (0, 0, 1.3)), "tail": (0, 10, 0)},
        "attack_0": {"core": ("scale", (1.2, 1.2, 1.2))}, "attack_1": {"core": ("scale", (1.35, 1.35, 1.35)), "tail": (-20, 0, 0)},
        "hurt": {"core": ("scale", (0.8, 0.8, 0.8))},
        "side_0": {"tail": (25, 0, 0)}, "side_1": {"tail": (35, 0, 0), "core": ("loc", (0, 0, 1.3))},
        "back_0": {"tail": (0, 10, 0)}, "back_1": {"tail": (0, -10, 0)},
    }
    return parts, poses, True


def build_warden():
    parts = humanoid({"scale": 1.45, "skin": 1, "body": 4, "chest": 5, "legs": 3, "feet": 2, "robe": 22, "eyes": 25, "eye_glow": True,
                      "helm": 3, "horns": 7, "pauldrons": 5, "sleeves": 3, "thin": 0.07})
    staff = empty("staff", (0, 0, -0.42), parts["fore_r"])
    cyl("pole", (0, -0.1, 0.1), (0.07, 0.07, 2.2), 11, staff, rot=(10, 0, 0))
    ring("keyring", (0, -0.28, 1.15), (0.5, 0.5, 0.5), 30, staff, rot=(90, 0, 0))
    ball("keygem", (0, -0.28, 1.15), (0.14, 0.14, 0.14), 25, staff, emit=True)
    base = {"arm_r": (-20, 0, -5), "fore_r": (-60, 0, 0)}
    poses = _fighter_poses(parts, {"idle_0": dict(base), "idle_1": dict(base), "hurt": dict(base)})
    poses["attack_0"] = {"arm_r": (150, 0, -10), "fore_r": (-20, 0, 0), "arm_l": (150, 0, 10), "fore_l": (-20, 0, 0)}
    poses["attack_1"] = {"arm_r": (-60, 0, -5), "fore_r": (-10, 0, 0), "arm_l": (-60, 0, 5), "torso": (-15, 0, 0)}
    return parts, poses, False


def build_tamsin():
    parts = humanoid({"skin": 16, "body": 11, "chest": 12, "legs": 10, "feet": 9, "hood": 11, "eyes": 0, "sleeves": 11})
    box("pack", (0, 0.24, 0.3), (0.44, 0.26, 0.5), 10, parts["torso"])
    box("roll", (0, 0.24, 0.6), (0.5, 0.14, 0.14), 12, parts["torso"])
    lantern = empty("lantern", (0, 0, -0.3), parts["fore_l"])
    box("lframe", (0, 0, -0.1), (0.12, 0.12, 0.18), 3, lantern)
    ball("flame", (0, -0.05, -0.1), (0.1, 0.08, 0.13), 30, lantern, emit=True, segments=8)
    base = {"arm_l": (-50, 0, 10), "fore_l": (-40, 0, 0)}
    return parts, {"idle_0": dict(base), "idle_1": dict(base, neck=(6, 0, 8))}, False


def build_maren():
    parts = humanoid({"skin": 16, "body": 11, "chest": 10, "legs": 3, "feet": 9, "hair": 1, "long_hair": True, "eyes": 19, "sleeves": 10})
    base = {"arm_l": (-20, 0, 25), "arm_r": (-20, 0, -25), "fore_l": (-80, 0, 0), "fore_r": (-80, 0, 0)}
    return parts, {"idle_0": dict(base), "idle_1": dict(base, neck=(-6, 0, -10))}, False


CAST = {
    "rat": (build_rat, 56, False), "ooze": (build_ooze, 56, False), "bones": (build_bones, 56, False),
    "wisp": (build_wisp, 56, False), "ghoul": (build_ghoul, 56, False), "warden": (build_warden, 80, False),
    "tamsin": (build_tamsin, 56, True), "maren": (build_maren, 56, True),
}


# quadrupeds read badly head-on: their "front" frames are a three-quarter view
FRONT_YAW = {"rat": 35}


def render_one(name: str) -> list:
    kit.reset()
    kit.clear_mats()
    builder, px, npc = CAST[name]
    parts, poses, flat = builder()
    ortho = px / PX_PER_M
    kit.sprite_camera(ortho, ortho / 2 - 0.02, px, flat=flat)
    root = parts["root"]
    rest = {n: (tuple(o.location), tuple(o.rotation_euler), tuple(o.scale)) for n, o in bpy.data.objects.items()}
    out = []
    for fr in (NPC_FRAMES if npc else FRAMES):
        for n, (l, r, s) in rest.items():
            o = bpy.data.objects[n]
            o.location, o.rotation_euler, o.scale = l, r, s
        pose({**parts, **{n: bpy.data.objects[n] for n in rest}}, poses.get(fr, {}))
        yaw = 90 if fr.startswith("side") else (180 if fr.startswith("back") else FRONT_YAW.get(name, 0))
        root.rotation_euler = (0, 0, math.radians(yaw))
        path = os.path.join(kit.ROOT, "build", "renders", name, fr + ".png")
        kit.render_to(path)
        out.append(path)
    # keep the rest pose as the editable source
    for n, (l, r, s) in rest.items():
        o = bpy.data.objects[n]
        o.location, o.rotation_euler, o.scale = l, r, s
    root.rotation_euler = (0, 0, 0)
    os.makedirs(os.path.join(kit.ROOT, "art", "blender"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.ROOT, "art", "blender", "sprites_%s.blend" % name), compress=True)
    return out


def pose(parts, spec):
    kit.pose(parts, spec)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    names = [a for a in argv if a in CAST] or list(CAST)
    for n in names:
        paths = render_one(n)
        print(f"{n}: {len(paths)} frames")


if __name__ == "__main__":
    main()
