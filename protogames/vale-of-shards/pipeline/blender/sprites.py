"""Blender-rendered sprites for Vale of Shards, modelled from primitives and rendered
orthographically from the side at one pixel density (kit.PX_PER_M = 24 px per metre),
anti-aliasing off, at the exact manifest frame size. Each frame is a two-pass Workbench
toon render (kit.toon_render: flat palette-colour ID pass + one hard key light from the
upper left, stepped along each colour's palette ramp).

    python3 pipeline/blender/sprites.py [name ...]        # bpy as a Python module
    blender -b --factory-startup --python pipeline/blender/sprites.py -- [name ...]

Writes build/renders/<name>/<frame>.png (frames in manifest tag order, named
<tag>_<i>.png) and art/blender/<name>.blend (the model in its last pose).
pipeline/aseprite/import_renders.py then palette-locks and outlines the frames and writes
art/aseprite/<name>.aseprite.

Each model keeps a 1 px margin inside its hitbox area so the ink outline added by the
import lands on the canvas: bell 30x30 in 32x32, sentry 28x28, drone 16x20 and so on
(sizes and hitboxes from pipeline/manifest.py).
"""
from __future__ import annotations

import math
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import P, px, ball, box, cone, cyl, empty, gem, prism, ring, spike, set_rot  # noqa: E402

sys.path.insert(0, os.path.join(kit.ROOT, "pipeline"))
from manifest import SPRITES  # noqa: E402


def frame_names(name: str) -> list[str]:
    out = []
    for tag, n in SPRITES[name][4]:
        out += [f"{tag}_{i}" for i in range(n)]
    return out


def canvas(name: str, center=(0.0, 0.0), tilt: float = 0.0):
    w, h = SPRITES[name][0], SPRITES[name][1]
    kit.workbench("STUDIO")
    return kit.ortho_camera(w, h, center, tilt=tilt)


def shoot(name: str, frame: str, **kw):
    kit.toon_render(os.path.join(kit.RENDERS, name, frame + ".png"), **kw)


# ================================================================== the Bell
# A brass diving bell, 30x30 px: domed top with a lifting ring, a riveted band, a round
# porthole with Orrin's face behind the glass, ballast feet, and a small stern propeller.

def build_bell(dim: bool = False):
    b0, b1, b2 = ("gold0", "gold0", "gold1") if dim else ("gold0", "gold1", "gold2")
    iron = "stone1" if dim else "stone2"
    root = empty("bell")
    body = empty("body", (0, 0, 0), root)
    # hull: a cylinder skirt (z -12..0) under a dome (0..11), 24 px across
    cyl("skirt", P(0, 0, -6), P(24, 24, 12), b1, body, segments=24)
    ball("dome", P(0, 0, 0), P(24, 24, 22), b1, body, segments=24)
    cyl("band", P(0, 0, 0), P(25.4, 25.4, 1.6), b0, body, segments=24)
    cyl("hem", P(0, 0, -11.6), P(25.4, 25.4, 1.6), b0, body, segments=24)
    cyl("cap", P(0, 0, 11), P(7, 7, 2), b2, body)
    ring("lift", P(0, 0, 13.2), P(5, 5, 5), iron, body, rot=(90, 0, 0), thick=0.25)
    for i in range(16):   # rivets along the band
        a = math.radians(i * 22.5 + 11.25)
        ball("rivet", P(12.8 * math.sin(a), -12.8 * math.cos(a), 1.6), P(1.4, 1.4, 1.4), b2, body, segments=6)
    # porthole facing -Y (the camera) in the body frame
    port = empty("port", P(0, -12.2, -5.5), body)
    ring("rim", (0, 0, 0), P(11.5, 11.5, 11.5), b2, port, rot=(90, 0, 0), thick=0.14)
    cyl("glass", P(0, 0.5, 0), P(10, 10, 1), "water1" if dim else "water3", port, rot=(90, 0, 0), segments=20)
    if not dim:
        # Orrin behind the glass: face, lamplighter's green cap with a brim
        ball("face", P(0, -0.3, -1.0), P(5.5, 2.5, 6), "skin1", port)
        ball("capp", P(0, -0.3, 1.6), P(6.2, 2.6, 3.8), "moss2", port)
        box("brim", P(0, -1.0, 0.6), P(7.4, 1, 1.0), "moss1", port)
        for sx in (-1.3, 1.3):
            box("eye", P(sx, -1.6, -1.0), P(1, 1, 1.2), "ink", port)
        box("glint", P(3.0, -1.4, 2.8), P(1.2, 0.5, 1.2), "white", port, rot=(0, 45, 0), emit=1.0)
    # ballast feet
    for sx in (-7, 7):
        box("foot", P(sx, 0, -13.5), P(6, 11, 3), iron, body)
    # stern shaft and propeller (+Y side, opposite the porthole)
    stern = empty("stern", P(0, 11.5, -5), body)
    cyl("shaft", P(0, 2.2, 0), P(2.6, 2.6, 5), iron, stern, rot=(90, 0, 0))
    prop = empty("prop", P(0, 5.6, 0), stern)
    for k in range(3):
        holder = empty("bl", (0, 0, 0), prop, rot=(0, k * 120, 0))
        box("blade", P(0, 0, 3.0), P(3.0, 0.8, 5.2), b2, holder, rot=(0, 0, 20))
    ball("hub", (0, 0, 0), P(2.6, 2.6, 2.6), b0, prop)
    return {"root": root, "body": body, "prop": prop}


def render_bell():
    kit.reset()
    parts = build_bell()
    canvas("bell")
    body, prop = parts["body"], parts["prop"]
    # (frame, body rotation (x tilt, y roll, z yaw), prop spin)
    poses = [
        ("down_0", (22, 0, 0), 0),     # pitched forward: we see the dome, diving
        ("up_0", (-18, 0, 0), 40),     # pitched back: we see the feet, rising
        ("left_0", (0, -6, -52), 20),  # porthole turned left, propeller on the right
        ("right_0", (0, 6, 52), 70),
        ("still_0", (0, 0, 0), 0),
    ]
    for fr, (rx, ry, rz), spin in poses:
        set_rot(body, rx, ry, rz)
        set_rot(prop, 0, spin, 0)
        shoot("bell", fr)
    # sink: dimmed bell, flooded glass, tilted and nosing down
    kit.reset()
    parts = build_bell(dim=True)
    canvas("bell")
    set_rot(parts["body"], 10, 28, -20)
    shoot("bell", "sink_0")
    kit.save_blend("bell")


# ================================================================== clockwork sentry
# 28x28 px in 32x32 (hitbox x 2..30, y 4..32: the feet stand on the bottom row).
# A brass boiler body on two piston legs, a domed iron head with one red lens, a cannon
# for a right arm, a clamp for a left arm and a winding key on its back.

def build_sentry():
    root = empty("sentry", P(0, 0, 0))
    body = empty("body", P(0, 0, 0), root)
    # boiler: z -4..8
    cyl("boiler", P(0, 0, 2), P(14, 12, 12), "gold1", body, segments=16)
    for z in (-3.2, 7.2):
        cyl("hoop", P(0, 0, z), P(14.8, 12.8, 1.4), "gold0", body, segments=16)
    for k in range(3):
        box("slot", P(-2.2 + 2.2 * k, -6.3, 1.5), P(1.1, 0.6, 3.4), "fire3", body, emit=1.0)
    # head: iron dome with one big lens in a brass goggle
    head = empty("head", P(0, 0, 7.4), body)
    ball("dome", P(0, 0, 0.2), P(12, 11, 8), "stone2", head, segments=16)
    cyl("goggle", P(0, -5.6, 0.4), P(6.4, 6.4, 3.6), "gold2", head, rot=(90, 0, 0))
    ball("lens", P(0, -7.4, 0.4), P(5.0, 2.4, 5.0), "fire4", head, emit=1.0)
    box("pupil", P(0, -8.4, 0.4), P(1.6, 0.6, 1.6), "fire1", head, emit=1.0)
    cyl("stack", P(-1.5, 3.0, 3.4), P(2.2, 2.2, 2), "stone1", head)
    # winding key on the back
    key = empty("key", P(0, 6.5, 2), body)
    cyl("keyshaft", P(0, 1, 0), P(1.4, 1.4, 3), "gold0", key, rot=(90, 0, 0))
    for sx in (-1, 1):
        ball("keybow", P(1.8 * sx, 2.6, 0), P(3.4, 1.2, 2.8), "gold2", key)
    # cannon arm on the model's -X side: nearest the camera when it faces right
    arm = empty("arm", P(-8, -0.5, 3.5), body)
    ball("shoulder", (0, 0, 0), P(4.6, 4.6, 4.6), "stone2", arm)
    cyl("cannon", P(0, -6.0, -0.5), P(4.0, 4.0, 11), "stone2", arm, rot=(90, 0, 0))
    cyl("muzzle", P(0, -11.4, -0.5), P(5.2, 5.2, 2.0), "gold1", arm, rot=(90, 0, 0))
    ring("breech", P(0, -2.5, -0.5), P(5, 5, 5), "gold0", arm, rot=(90, 0, 0), thick=0.2)
    ball("stub", P(8, 0.5, 3.5), P(4, 4, 4), "stone1", body)
    # legs: hips at z -4, thigh 5, shin 5, foot 2 -> feet bottom at -16
    legs = {}
    for side, sx in (("l", -3.6), ("r", 3.6)):
        hip = empty("hip_" + side, P(sx, 0, -4), root)
        ball("hipball", (0, 0, 0), P(4, 4, 4), "stone2", hip)
        cyl("thigh", P(0, 0, -2.6), P(3.0, 3.0, 5), "stone1", hip)
        knee = empty("knee_" + side, P(0, 0, -5.4), hip)
        ball("kneeball", (0, 0, 0), P(3.6, 3.6, 3.6), "gold1", knee)
        cyl("shin", P(0, 0, -2.6), P(3.6, 3.6, 5), "stone2", knee)
        foot = empty("foot_" + side, P(0, 0, -5.4), knee)
        box("sole", P(0, -1.2, -0.9), P(4.4, 7.5, 2), "stone1", foot)
        box("toecap", P(0, -4.2, -0.6), P(4.4, 1.6, 2.4), "gold1", foot)
        legs[side] = (hip, knee, foot)
    return {"root": root, "body": body, "legs": legs, "key": key, "arm": arm}


def render_sentry():
    kit.reset()
    m = build_sentry()
    canvas("sentry")
    root, legs = m["root"], m["legs"]
    # 4-frame walk: contact, passing (body up), contact (other leg), passing
    cycle = [(26, -24, 0), (0, 6, 1), (-24, 26, 0), (6, 0, 1)]
    # walk_l renders the mirror image of the model (scale x -1), so the cannon arm stays on
    # the near side and the light still comes from the upper left.
    for tag, yaw, mirror in (("walk_r", 76, 1), ("walk_l", -76, -1)):
        root.scale = (mirror, 1, 1)
        for i, (a_l, a_r, up) in enumerate(cycle):
            set_rot(root, 0, 0, yaw)
            root.location = P(0, 0, up)
            for side, a in (("l", a_l), ("r", a_r)):
                hip, knee, foot = legs[side]
                bend = 22 if a < 0 else 4     # the trailing leg bends at the knee
                set_rot(hip, -a, 0, 0)
                set_rot(knee, bend, 0, 0)
                set_rot(foot, a - bend, 0, 0)
            set_rot(m["key"], 0, i * 45, 0)
            set_rot(m["arm"], (-6, 0, 6, 0)[i], 0, 0)
            shoot("sentry", f"{tag}_{i}")
    kit.save_blend("sentry")


# ================================================================== glass drone
# 16x20 px in 24x24 (hitbox x 4..20, y 2..22). A glass sphere in an iron cage with a
# brass lens snout, a small top rotor and a hanging stinger.

def build_drone(armored: bool = False):
    root = empty("drone")
    body = empty("body", (0, 0, 0), root)
    glass, iron, trim = ("water2", "stone0", "stone2") if armored else ("water4", "stone1", "gold1")
    ball("globe", P(0, 0, 0), P(13, 13, 13), glass, body, segments=20)
    ball("core", P(0, -2.6, -1.0), P(4.6, 4.6, 4.6), "shard3" if not armored else "shard1", body, emit=1.0)
    box("shine", P(-3.0, -6.0, 3.0), P(1.6, 0.6, 1.6), "white", body, rot=(0, 30, 0), emit=1.0)
    if armored:
        # iron shells over the top and bottom of the globe, riveted, leaving a glass band
        ball("helm", P(0, 0, 2.2), P(14, 14, 10), "stone2", body, segments=16)
        ball("keel", P(0, 0, -2.6), P(13.6, 13.6, 8), "stone1", body, segments=16)
        for i in range(6):
            a = math.radians(i * 60 + 30)
            ball("rivet", P(6.9 * math.sin(a), -6.9 * math.cos(a), 3.2), P(1.2, 1.2, 1.2), "stone3", body, segments=6)
    ring("band", P(0, 0, -3.6), P(12.4, 12.4, 12.4), iron, body, thick=0.10)
    cyl("cap", P(0, 0, 6.4), P(6, 6, 2), iron, body)
    rotor = empty("rotor", P(0, 0, 7.8), body)
    cyl("mast", P(0, 0, 0), P(1.2, 1.2, 2), iron, rotor)
    for k in range(2):
        box("vane", P(0, 0, 0.9), P(10, 1.6, 0.8), trim, rotor, rot=(0, 0, k * 90))
    cone("stinger", P(0, 0, -7.4), P(3.6, 3.6, 3.8), iron, body, rot=(180, 0, 0))
    snout = empty("snout", P(0, -5.8, 1.0), body)
    cyl("tube", P(0, -0.8, 0), P(5.0, 5.0, 2.6), trim, snout, rot=(90, 0, 0))
    cyl("lens", P(0, -2.2, 0), P(3.4, 3.4, 0.6), "fire4" if not armored else "fire3", snout, rot=(90, 0, 0), emit=1.0)
    box("lensglint", P(-0.7, -2.6, 0.7), P(1, 0.4, 1), "fire5", snout, emit=1.0)
    return {"root": root, "body": body, "rotor": rotor, "snout": snout}


def render_drone():
    frames = []
    for armored in (False, True):
        kit.reset()
        m = build_drone(armored)
        canvas("drone")
        pre = "armored_" if armored else ""
        for tag, yaw, spin in (("left", -52, 0), ("hover", 0, 30), ("right", 52, 60)):
            set_rot(m["body"], 0, 0, yaw)
            set_rot(m["rotor"], 0, 0, spin)
            shoot("drone", f"{pre}{tag}_0")
            frames.append(pre + tag)
    # fall: the plain drone knocked sideways, lens dark, trailing smoke
    kit.reset()
    m = build_drone(False)
    canvas("drone")
    set_rot(m["body"], 15, 40, 35)
    m["body"].location = P(1, 0, -2)
    kit.recolor(m["snout"].children[1], "fire0")      # the lens goes dark
    for (x, z, r, c) in ((-3.5, 6.5, 5, "stone3"), (-0.5, 8.4, 3.6, "stone2")):
        ball("smoke", P(x, -4, z), P(r, r, r), c, None, segments=12)
    shoot("drone", "fall_0")
    kit.save_blend("drone")


# ================================================================== prism turret
# 22x15 px in 24x16 (hitbox x 1..23, y 1..16). An iron plate bolted to the ceiling, a
# brass swivel collar and a hanging crystal prism whose point is the barrel.
# aim frames 0..4 = direction -2..2 (down-left .. down-right); glow = the same, lit.

TURRET_ANGLES = [-62, -32, 0, 32, 62]


def build_turret(lit: bool = False):
    root = empty("turret", P(0, 0, 0))
    box("plate", P(0, 0, 6.2), P(20, 6, 2.4), "stone1", root)
    for sx in (-8, 8):
        ball("bolt", P(sx, -3, 6.2), P(1.6, 1.4, 1.6), "stone3", root, segments=6)
    box("bracket", P(0, 0, 4.2), P(8, 4, 2), "stone2", root)
    swivel = empty("swivel", P(0, 0, 2.2), root)
    ball("collar", (0, 0, 0), P(7, 7, 5), "gold1", swivel, segments=12)
    c_body = ("shard2" if lit else "shard1")
    prism = empty("prism", (0, 0, 0), swivel)
    kit.prism("crystal", P(0, 0, -4.2), px(3.4), px(6), c_body, sides=6, parent=prism, rot=(0, 0, 30))
    kit.cone("tip", P(0, 0, -9.4), P(6.8, 6.8, 4.6), "shard3" if lit else "shard2", prism, rot=(180, 0, 30),
             segments=6, flat=True)
    if lit:
        kit.box("core", P(0, -3.2, -5.0), P(1.6, 1, 6), "white", prism, emit=1.0)
        kit.box("tipglow", P(0, -1.8, -10.4), P(1.4, 1, 2), "white", prism, emit=1.0)
    return {"root": root, "swivel": swivel}


def render_turret():
    for lit, tag in ((False, "aim"), (True, "glow")):
        kit.reset()
        m = build_turret(lit)
        canvas("turret")
        for i, a in enumerate(TURRET_ANGLES):
            set_rot(m["swivel"], 0, -a, 0)   # +Y rotation swings the point to -X; aim right = positive
            shoot("turret", f"{tag}_{i}")
    kit.save_blend("turret")


# ================================================================== rolling geode
# 16x16 px: a faceted stone ball studded with crystal spikes. 4 roll frames; the spikes
# have 90-degree symmetry about the view axis, so 22.5-degree steps loop cleanly.

def build_geode():
    root = empty("geode")
    rock = empty("rock", (0, 0, 0), root)
    gem("stone", (0, 0, 0), P(10.5, 10, 10.5), "stone3", rock, subdiv=1)
    for k in range(4):
        a = k * 90
        spike("sp", (0, 0, 0), px(2.4), px(7.0), "shard2", rock, rot=(0, a, 0), sides=4)
        spike("sp2", (0, 0, 0), px(1.8), px(6.2), "violet3", rock, rot=(-25, a + 45, 0), sides=4)
    gem("cavity", P(0, -4.2, 0), P(4.4, 2, 4.4), "violet1", rock, subdiv=1)
    gem("vein", P(0, -4.9, 0), P(2.4, 1.2, 2.4), "shard3", rock, subdiv=1, emit=1.0)
    return {"root": root, "rock": rock}


def render_geode():
    kit.reset()
    m = build_geode()
    canvas("geode")
    for i in range(4):
        set_rot(m["rock"], 0, 22.5 * i, 0)
        shoot("geode", f"roll_{i}")
    kit.save_blend("geode")


# ================================================================== the Glass Regent
# 60x68 px in 64x72 (hitbox x 2..62, y 2..70). A tall floating sorcerer: faceted
# violet crystal robes ending in a fringe of shards, crystal pauldrons, pale hands and a
# glass mask under a crown of glass spikes.

def build_regent(cracked: bool = False):
    root = empty("regent")
    body = empty("body", (0, 0, 0), root)
    # robe: faceted cone from the shoulders (z 14) to the hem (z -24)
    cone("robe", P(0, 0, -5), P(40, 24, 40), "violet1", body, segments=8, flat=True)
    cone("robefront", P(0, -3.5, -7), P(18, 14, 34), "violet2", body, segments=6, flat=True)
    kit.prism("sash", P(0, -6.2, -4), px(1.6), px(24), "shard2", sides=4, parent=body, emit=0.0)
    for i in range(11):   # hem of hanging shards
        x = -17 + i * 3.4
        spike("hem", P(x, -4 + abs(x) * 0.2, -23), px(2.4), px(6 + (i % 2) * 3), "violet2" if i % 2 else "shard1",
              body, rot=(180, 0, x * 1.5), sides=4)
    # chest and shoulders
    ball("chest", P(0, -0.5, 11), P(18, 12, 12), "violet2", body, segments=8, flat=True)
    box("collar", P(0, -5.2, 13), P(8, 2, 5), "violet3", body, rot=(0, 45, 0))
    for sx in (-1, 1):
        sh = empty("pauldron", P(9 * sx, 0, 14), body)
        gem("shoulder", (0, 0, 0), P(9, 8, 7), "violet2", sh)
        spike("pspike", P(0, 0, 1), px(2), px(7), "shard2", sh, rot=(0, 30 * sx, 0), sides=4)
        spike("pspike2", P(1.5 * sx, 0, 0), px(1.6), px(5), "violet3", sh, rot=(0, 70 * sx, 0), sides=4)
    # head: glass mask and crown
    head = empty("head", P(0, 0, 20), body)
    gem("hood", P(0, 1.2, 1.5), P(13, 11, 14), "violet0", head)
    gem("mask", P(0, -2.2, 0.5), P(9.5, 7, 12), "shard3", head, subdiv=1)
    box("maskshine", P(-2.4, -5.5, 3.2), P(1.2, 0.6, 3.0), "white", head, emit=1.0)
    for sx in (-1, 1):
        box("eye", P(2.2 * sx, -5.6, 1.0), P(2.8, 1, 1.4), "violet0", head, rot=(0, -14 * sx, 0), emit=1.0)
        box("pupil", P(2.2 * sx, -6.0, 1.0), P(1.0, 1, 1.0), "berry2", head, emit=1.0)
    box("mouth", P(0, -5.6, -2.8), P(2.2, 1, 0.8), "shard1", head)
    for i, (x, h, c) in enumerate(((-4.5, 5, "shard2"), (-2.2, 7, "white"), (0, 10, "shard3"),
                                   (2.2, 7, "white"), (4.5, 5, "shard2"))):
        spike("crown", P(x, -1.0, 5.2), px(1.5), px(h), c, head, rot=(0, x * 5, 0), sides=4)
    ring("circlet", P(0, -0.5, 5.4), P(10, 9, 10), "gold2", head, thick=0.12)
    # arms: faceted sleeves from the shoulders, pale hands
    arms = {}
    for side, sx in (("l", 1), ("r", -1)):
        sh = empty("arm_" + side, P(11 * sx, 0, 13), body)
        cone("sleeve", P(0, 0, -7.5), P(11, 10, 17), "violet2", sh, segments=6, flat=True, rot=(180, 0, 0))
        cone("cuff", P(0, 0, -15.2), P(11.5, 10.5, 1.6), "shard2", sh, segments=6, flat=True, rot=(180, 0, 0))
        gem("hand", P(0, -0.5, -17.5), P(4.6, 4, 5), "dawn0", sh)
        arms[side] = sh
    orb = empty("orb", P(0, 0, -23), arms["r"])
    if cracked:
        for (x, z, r, l) in ((-3, 2, 25, 12), (4, -8, -30, 10), (-1, -15, 10, 9), (3, 12, -40, 6)):
            box("crack", P(x, -8.6, z), P(0.9, 0.6, l), "ink", body, rot=(0, r, 0))
            box("crackshine", P(x + 0.9, -8.5, z), P(0.6, 0.6, l * 0.8), "white", body, rot=(0, r, 0), emit=1.0)
        box("maskcrack", P(1, -5.6, 1), P(0.8, 0.6, 7), "ink", head, rot=(0, 25, 0))
    return {"root": root, "body": body, "head": head, "arms": arms, "orb": orb}


def render_regent():
    kit.reset()
    m = build_regent()
    canvas("regent")
    body, arms, head = m["body"], m["arms"], m["head"]
    for i, (dz, sw) in enumerate(((0, 4), (1.5, -4))):   # idle bob
        body.location = P(0, 0, dz)
        set_rot(arms["l"], sw, 0, 12)
        set_rot(arms["r"], -sw, 0, -12)
        shoot("regent", f"idle_{i}")
    # cast: right arm raised high, a glowing shard orb above the hand
    body.location = P(0, 0, 0.5)
    set_rot(arms["l"], 0, 0, 14)
    set_rot(arms["r"], 0, 132, 0)
    set_rot(head, -6, 8, 0)
    orb = m["orb"]
    kit.gem("orbcore", (0, 0, 0), P(8, 8, 8), "white", orb, emit=1.0)
    kit.gem("orbhalo", P(0, 1, 0), P(11, 4, 11), "shard3", orb, emit=1.0)
    for k in range(4):
        spike("ray", (0, 0, 0), px(1.2), px(8.5), "shard3", orb, rot=(0, 45 + 90 * k, 0), sides=4, emit=1.0)
    shoot("regent", "cast_0")
    # hurt: recoil (lean back, head tossed), cracks across the robe and mask
    kit.reset()
    m = build_regent(cracked=True)
    canvas("regent")
    m["body"].location = P(1, 0, -1)
    set_rot(m["body"], 0, -9, 0)
    set_rot(m["head"], 14, -10, 0)
    set_rot(m["arms"]["l"], 0, 0, 40)
    set_rot(m["arms"]["r"], 0, 0, -45)
    shoot("regent", "hurt_0")
    kit.save_blend("regent")


# ================================================================== heart crystal
# 64x64 px: the Spire's heart, a tall faceted crystal ringed by smaller ones on a
# stepped stone pedestal with brass trim. cracked: split, darkened, shards fallen.

def build_heart(cracked: bool = False):
    root = empty("heart")
    # pedestal: z -31..-14
    cyl("base", P(0, 0, -29), P(44, 20, 5), "stone1", root, segments=8, flat=True)
    cyl("step", P(0, 0, -25), P(36, 16, 4), "stone2", root, segments=8, flat=True)
    cyl("trim", P(0, 0, -22.6), P(37, 17, 1.4), "gold1", root, segments=8, flat=True)
    cyl("column", P(0, 0, -18.5), P(26, 12, 7), "stone2", root, segments=8, flat=True)
    cyl("lip", P(0, 0, -14.6), P(32, 14, 2.4), "stone3", root, segments=8, flat=True)
    for sx in (-8, 0, 8):
        box("rune", P(sx, -6.4, -18.5), P(2.4, 0.6, 3.4), "shard2" if not cracked else "shard0", root,
            emit=0.0 if cracked else 1.0)
    core = empty("core", P(0, 0, -13.5), root)
    c_hi, c_mid, c_lo = ("shard3", "shard2", "violet2") if not cracked else ("shard2", "shard1", "violet1")
    # main crystal: a long hexagonal bipyramid
    kit.prism("shaft", P(0, 0, 15), px(9), px(24), c_mid, sides=6, parent=core)
    cone("point", P(0, 0, 32.5), P(18, 18, 11), c_hi, core, segments=6, flat=True)
    cone("root", P(0, 0, 1.4), P(18, 18, 5), c_lo, core, segments=6, flat=True, rot=(180, 0, 0))
    if not cracked:
        kit.prism("glow", P(-2.5, -7.6, 18), px(0.9), px(18), "white", sides=4, parent=core, emit=1.0)
        kit.gem("heartlight", P(1, -7.8, 13), P(5, 1.5, 8), "shard3", core, emit=1.0)
        kit.gem("heartcore", P(1, -8.4, 13), P(2.6, 1, 4), "white", core, emit=1.0)
    for (x, h, a, c) in ((-9, 20, 24, c_lo), (9, 18, -22, c_mid), (-15, 12, 44, c_mid), (15, 13, -42, c_lo),
                         (-4, 11, 10, c_hi), (5, 12, -8, c_lo)):
        spike("side", P(x, -2 if abs(x) < 8 else 1, 1), px(4.2 if h > 15 else 3.2), px(h), c, core,
              rot=(0, a, 0), sides=5)
    if cracked:
        for (x, z, r, l) in ((-1, 13, 18, 18), (3, 24, -25, 12), (-3, 5, 50, 8), (1, 31, 10, 6), (5, 9, -60, 6)):
            box("crack", P(x, -8.6, z), P(1, 0.6, l), "ink", core, rot=(0, r, 0))
            box("crackedge", P(x - 1, -8.5, z), P(0.8, 0.6, l * 0.7), "shard3", core, rot=(0, r, 0))
        for (x, y, r) in ((-12, -8, 30), (13, -7, -60), (-4, -9, 100)):
            spike("fallen", P(x, y, -15.8), px(1.6), px(4), "shard1", root, rot=(0, 90 + r, 0), sides=4)
    return {"root": root, "core": core}


def render_heart():
    kit.reset()
    build_heart()
    canvas("heartcrystal", tilt=8)
    shoot("heartcrystal", "whole_0")
    kit.reset()
    m = build_heart(cracked=True)
    canvas("heartcrystal", tilt=8)
    set_rot(m["core"], 0, 4, 0)
    shoot("heartcrystal", "cracked_0")
    kit.save_blend("heartcrystal")


RENDER = {
    "bell": render_bell,
    "sentry": render_sentry,
    "drone": render_drone,
    "turret": render_turret,
    "geode": render_geode,
    "regent": render_regent,
    "heartcrystal": render_heart,
}


def main():
    names = kit.args() or list(RENDER)
    for n in names:
        t = time.time()
        RENDER[n]()
        print(f"{n}: {len(frame_names(n))} frames in {time.time() - t:.1f} s")


if __name__ == "__main__":
    main()
