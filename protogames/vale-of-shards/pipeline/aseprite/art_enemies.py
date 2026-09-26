"""Enemies drawn in code (all original designs; behaviours come from the source, looks don't).

    python3 pipeline/aseprite/art_enemies.py

Uses the Fig material kit from art_chars.py. Every facing pair is drawn once facing right
and mirrored before shading, so the light stays in the upper left.
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from art_chars import Fig, mat, recolor, shift  # noqa: E402
from canvas import Canvas, dither, rng  # noqa: E402
from palette import N  # noqa: E402
from sheet import save_sprite  # noqa: E402


def pair(figs: list[Fig]) -> tuple[list[Canvas], list[Canvas]]:
    """(right-facing renders, left-facing renders)."""
    return [f.render() for f in figs], [f.render(flip=True) for f in figs]


# ---------------------------------------------------------------------------------------
# Burrowhog: stocky tusked digging boar. 48x32, hitbox 38x25 at (5, 7), feet on row 31
# ---------------------------------------------------------------------------------------

mat("hide", "wood1", "wood2", "wood3", 2)
mat("hide_far", "wood0", "wood1", "wood2")
mat("hog_belly", "wood2", "wood3", "wood4")
mat("bristle", "stone0", "wood0", "wood1")
mat("plate", "stone2", "stone3", "stone4")
mat("hoof", "ink", "stone0", "stone1")


def _hog(phase: int, mode: str = "walk") -> Fig:
    f = Fig(48, 32)
    bob = 1 if (mode == "walk" and phase % 2) or (mode == "idle" and phase == 1) else 0
    # legs: (x, far?) with a stride offset per phase
    stride = [2, 0, -2, 0] if mode == "walk" else [0, 0, 0, 0]
    lift = [0, 1, 0, 1] if mode == "walk" else [0, 0, 0, 0]
    legs = [(14, True, 0), (31, True, 2), (17, False, 2), (34, False, 0)]
    for (x, far, ph) in legs:
        k = (phase + ph) % 4
        fx = x + stride[k]
        fy = 31 - (lift[k] if k == 1 else 0)
        f.lay().seg((x, 24 + bob), (fx, fy - 1), 4, "hide_far" if far else "hide")
        f.lay().rect(fx - 2, fy - 1, fx + 1, fy, "hoof")
        if not far:
            f.dot(fx, fy, "ink")
    # body
    f.lay().oval(21, 19 + bob, 14, 8.5, -4, "hide")
    f.oval(23, 24 + bob, 9, 3, 0, "hog_belly")
    # tail curl
    f.lay().seg((8, 15 + bob), (5, 13 + bob), 2, "hide")
    f.dot(5, 12 + bob, "wood1")
    # bristle ridge along the back
    f.lay()
    for i, x in enumerate(range(10, 32, 3)):
        y = 12 - (x - 10) * 0.12 + bob
        f.seg((x, y + 1), (x - 2, y - 2 - (i % 2)), 2, "bristle")
    # head
    head_dy = 1 if mode == "idle" and phase == 1 else 0
    hy = 20 + bob + head_dy
    f.lay().oval(34, hy, 7.5, 6, 18, "hide")
    f.lay().poly([(31, hy - 5), (33, hy - 10), (35, hy - 5)], "hide_far")
    # snout plate (the shovel it digs with)
    f.lay().poly([(39, hy - 1), (43, hy - 1), (44, hy + 3), (39, hy + 4)], "plate")
    f.dot(42, hy + 1, "ink")
    f.dot(43, hy + 2, "ink")
    # tusk
    f.lay().limb([(37, hy + 5), (40, hy + 4), (42, hy + 1)], 2, "bone")
    # eye
    if mode == "hit":
        f.dot(35, hy - 3, "ink")
        f.dot(37, hy - 3, "ink")
        f.dot(36, hy - 2, "ink")
    else:
        f.rect(36, hy - 3, 37, hy - 2, "ink")
        f.dot(37, hy - 3, "fire4")
    return f


def burrowhog_frames() -> list[Canvas]:
    wr, wl = pair([_hog(k) for k in range(4)])
    ir, il = pair([_hog(k, "idle") for k in range(2)])
    hit = _hog(0, "hit").render()
    hit_r = shift(hit, -1, -1)
    flash = recolor(hit, {"wood1": "fire2", "wood2": "fire3", "wood3": "fire4", "wood4": "fire5",
                          "stone2": "fire4", "stone3": "fire5", "stone4": "white", "wood0": "fire1"})
    return wr + wl + ir + il + [hit_r, flash]


# ---------------------------------------------------------------------------------------
# Cairn brute: a hulking brute of stacked stone, moss on its shoulders, crystal on its back.
# 40x56, hitbox 32x48 at (4, 8), feet on row 55
# ---------------------------------------------------------------------------------------

mat("rock", "stone1", "stone2", "stone3", 2)
mat("rock_far", "stone0", "stone1", "stone2")
mat("rock_dark", "stone0", "stone1", "stone2")
mat("mossy", "moss1", "moss2", "moss3")
mat("crystal", "shard1", "shard2", "shard3")


def _brute(k: int) -> Fig:
    f = Fig(40, 56)
    bob = [0, -1, 0, -1][k]
    sw = [3, 0, -3, 0][k]
    # far arm and far leg
    f.lay().limb([(17, 24 + bob), (13 - sw, 36 + bob), (12 - sw, 45 + bob)], 6, "rock_far")
    f.lay().disc(12 - sw, 46 + bob, 3.5, "rock_far")
    f.lay().limb([(18, 42 + bob), (17 - sw, 49), (17 - sw, 52)], 6, "rock_far")
    f.lay().rect(14 - sw, 52, 21 - sw, 55, "rock_far")
    # crystals growing from the back
    f.lay()
    f.poly([(10, 23 + bob), (7, 14 + bob), (13, 20 + bob)], "crystal")
    f.poly([(13, 21 + bob), (12, 10 + bob), (17, 19 + bob)], "crystal")
    # near leg
    f.lay().limb([(22, 42 + bob), (23 + sw, 49), (23 + sw, 52)], 7, "rock")
    f.lay().rect(19 + sw, 52, 28 + sw, 55, "rock_dark")
    # torso: a stack of boulders
    f.lay().oval(20, 36 + bob, 11, 9, 0, "rock")
    f.lay().oval(19, 25 + bob, 13, 10, -6, "rock")
    # cracks
    for (a, b) in (((14, 31 + bob), (17, 34 + bob)), ((22, 38 + bob), (25, 41 + bob)), ((24, 22 + bob), (27, 25 + bob))):
        f.seg(a, b, 1, "rock_dark")
    # moss on the shoulders
    f.lay().oval(15, 17 + bob, 7, 2.5, -8, "mossy")
    f.dot(11, 19 + bob, "moss2")
    f.dot(18, 19 + bob, "moss2")
    # head, sunk between the shoulders
    f.lay().oval(27, 18 + bob, 6, 5, 0, "rock")
    f.rect(26, 17 + bob, 32, 18 + bob, "rock_dark")
    f.dot(29, 17 + bob, "shard3")
    f.dot(30, 17 + bob, "white")
    f.dot(32, 17 + bob, "shard3")
    f.lay().rect(28, 20 + bob, 32, 21 + bob, "rock_dark")
    f.dot(29, 20 + bob, "stone4")
    f.dot(31, 20 + bob, "stone4")
    # near arm, knuckles swinging low
    f.lay(rim=True).limb([(24, 25 + bob), (27 + sw, 36 + bob), (28 + sw, 44 + bob)], 7, "rock")
    f.lay(rim=True).disc(28 + sw, 46 + bob, 4, "rock")
    f.dot(26 + sw, 48 + bob, "stone1")
    f.dot(29 + sw, 48 + bob, "stone1")
    return f


def cairnbrute_frames() -> list[Canvas]:
    r, l = pair([_brute(k) for k in range(4)])
    return r + l


# ---------------------------------------------------------------------------------------
# Loom spider: a long-legged weaver with a woven pattern on its abdomen.
# 48x32, hitbox 40x24 at (4, 8), feet on row 31
# ---------------------------------------------------------------------------------------

mat("chitin", "violet0", "violet1", "violet2", 2)
mat("leg", "ink", "stone1", "stone2")
mat("leg_far", "ink", "stone0", "stone1")
mat("weave", "dawn1", "dawn0", "white")


def _leg_line(cv: Canvas, pts, lit: str, dark: str, wd: int = 2):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        x0, y0, x1, y1 = map(round, (x0, y0, x1, y1))
        if wd == 2:
            ox, oy = (-1, 0) if abs(y1 - y0) > abs(x1 - x0) else (0, -1)
            cv.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, N[lit])
        cv.line(x0, y0, x1, y1, N[dark])


def _spider(k: int, flip: bool) -> Canvas:
    bob = [0, -1, 0, -1][k]
    cv = Canvas(48, 32)
    # far legs: thin and dark; near legs: two-tone; knees stand high above the body
    far = [(10, 8, 7), (19, 5, 18), (31, 5, 30), (38, 9, 40)]
    near = [(7, 5, 4), (16, 2, 13), (34, 2, 35), (42, 6, 44)]
    for side, legs in ((0, far), (1, near)):
        for i, (kx, ky, fx) in enumerate(legs):
            ph = (k + i + side * 2) % 4
            step = [-2, 0, 2, 0][ph]
            up = 2 if ph == 1 else 0
            pts = [(25, 19 + bob), (kx + step // 2, ky + bob - up // 2), (fx + step, 31 - up)]
            if side == 0:
                _leg_line(cv, pts, "stone1", "stone0", 1)
            else:
                _leg_line(cv, pts, "stone3", "stone1", 2)
            cv.set(round(pts[1][0]), round(pts[1][1]), N["ink"] if side else N["stone0"])
    f = Fig(48, 32)
    f.lay().oval(15, 16 + bob, 8.5, 6.5, -12, "chitin")
    for j, x in enumerate(range(9, 22, 3)):
        f.dot(x, 14 + bob + (j % 2), "dawn0")
        f.dot(x + 1, 15 + bob - (j % 2), "dawn0")
    for x in range(10, 21, 2):
        f.dot(x, 18 + bob, "dawn1")
    f.lay().disc(26, 19 + bob, 3.8, "chitin")
    for (x, y, c) in ((28, 17, "gold2"), (29, 18, "gold2"), (27, 18, "gold1"), (29, 16, "gold1")):
        f.dot(x, y + bob, c)
    f.lay().seg((29, 21 + bob), (30, 24 + bob), 2, "bone")
    body = f.render()
    cv.blit(body, 0, 0)
    return cv.flip_h() if flip else cv


def loomspider_frames() -> list[Canvas]:
    return [_spider(k, False) for k in range(4)] + [_spider(k, True) for k in range(4)]


# ---------------------------------------------------------------------------------------
# Hollow shade: a hooded ghost. 32x32, hitbox 30x30 at (1, 1).
# fade frames 0..4 go from a few dithered outline pixels to fully visible.
# ---------------------------------------------------------------------------------------

mat("cloak", "violet0", "violet1", "violet2", 2)
mat("hood_in", "ink", "ink", "ink")
mat("claw", "stone2", "stone3", "stone4")


def _shade() -> Fig:
    f = Fig(32, 32)
    # tattered cloak body with a wispy hem
    pts = [(15, 3), (21, 5), (25, 11), (26, 19), (28, 24), (26, 27), (24, 25), (22, 29), (19, 26), (16, 30),
           (13, 26), (9, 29), (8, 24), (5, 26), (6, 19), (8, 11), (11, 5)]
    f.lay().poly(pts, "cloak")
    # hood opening
    f.lay().oval(18, 11, 4.5, 4, 10, "hood_in")
    f.dot(17, 11, "shard3")
    f.dot(20, 11, "shard3")
    f.dot(17, 10, "white")
    f.dot(20, 10, "white")
    # a reaching claw
    f.lay(rim=True).limb([(21, 17), (26, 16), (29, 14)], 3, "cloak")
    f.lay()
    for dy in (-1, 1):
        f.seg((29, 14), (30, 14 + dy * 2), 1, "claw")
    f.dot(30, 13, "stone4")
    return f


def shade_frames() -> list[Canvas]:
    fig = _shade()
    out = []
    for flip in (False, True):
        full = fig.render(flip=flip)
        ol = [(x, y) for y in range(32) for x in range(32) if full.px[y * 32 + x] == N["ink"]]
        eyes = [(x, y) for y in range(32) for x in range(32)
                if full.px[y * 32 + x] in (N["shard3"], N["white"])]
        for stage in range(5):
            cv = Canvas(32, 32)
            if stage == 4:
                cv = full.copy()
            else:
                t_ol = [0.3, 0.6, 1.0, 1.0][stage]
                t_fill = [0.0, 0.0, 0.35, 0.7][stage]
                for y in range(32):
                    for x in range(32):
                        c = full.px[y * 32 + x]
                        if c is None:
                            continue
                        if (x, y) in eyes:
                            continue
                        if c == N["ink"] and (x, y) in ol:
                            if dither(x, y, t_ol):
                                cv.set(x, y, N["violet2"] if stage < 2 else N["ink"])
                        elif dither(x + 1, y + 2, t_fill):
                            cv.set(x, y, c)
            for (x, y) in eyes:
                cv.set(x, y, full.px[y * 32 + x])
            out.append(cv)
    return out


# ---------------------------------------------------------------------------------------
# Pip-toad: 24x24, hitbox 16x14 at (4, 10), feet on row 23
# ---------------------------------------------------------------------------------------

mat("toad", "moss1", "moss2", "moss3", 2)
mat("toad_far", "moss0", "moss1", "moss2")
mat("toad_belly", "moss3", "moss4", "dawn0")
mat("eye_gold", "gold1", "gold2", "gold2")


def _toad_eye(f, x, y, wide=False):
    f.lay().disc(x, y, 2, "toad")
    f.dot(x, y - 1, "gold2")
    f.dot(x + 1, y - 1, "gold2")
    f.dot(x + 1, y, "ink")
    if wide:
        f.dot(x, y, "gold2")


def _toad(pose: str) -> Fig:
    f = Fig(24, 24)
    if pose == "sit":
        f.lay().disc(17, 14, 1.5, "toad_far")
        f.lay().oval(11, 19, 7, 4.5, 0, "toad")
        f.oval(13, 21, 5, 2, 0, "toad_belly")
        f.lay().oval(15, 17, 4.5, 3.5, 0, "toad")
        f.lay().oval(8, 20, 4, 3, 0, "toad")
        f.lay().rect(5, 23, 12, 23, "toad_far")
        f.lay().seg((16, 20), (17, 23), 2, "toad")
        _toad_eye(f, 14, 14)
        f.seg((16, 19), (19, 18), 1, "ink")
        spots = [(8, 16), (11, 15), (6, 19)]
    elif pose == "up":
        f.lay().limb([(9, 17), (6, 20), (3, 23)], 3, "toad_far")
        f.lay().oval(12, 15, 7, 4, -30, "toad")
        f.oval(14, 17, 4.5, 1.8, -30, "toad_belly")
        f.lay().limb([(8, 17), (5, 21), (2, 22)], 3, "toad")
        f.lay().limb([(16, 15), (19, 17), (20, 19)], 2, "toad")
        _toad_eye(f, 16, 10)
        f.seg((18, 14), (20, 12), 1, "ink")
        spots = [(9, 13), (12, 12)]
    else:  # down: arms reaching for the ground, legs trailing
        f.lay().oval(12, 18, 7.5, 3.5, 10, "toad")
        f.oval(13, 20, 5, 1.5, 10, "toad_belly")
        f.lay().limb([(7, 17), (4, 15), (2, 16)], 3, "toad")
        f.lay().limb([(16, 20), (19, 22), (21, 23)], 2, "toad")
        _toad_eye(f, 15, 15, wide=True)
        f.seg((17, 19), (19, 19), 1, "ink")
        spots = [(9, 16), (12, 16)]
    for x, y in spots:
        f.dot(x, y, "moss1")
    return f


def piptoad_frames() -> list[Canvas]:
    figs = [_toad("sit"), _toad("up"), _toad("down")]
    r, l = pair(figs)
    return r + l


# ---------------------------------------------------------------------------------------
# Duskwing: a dusk moth-bat. 24x16, hitbox 16x13 at (4, 2); 4 flap frames
# ---------------------------------------------------------------------------------------

mat("dfur", "violet0", "violet1", "violet2")
mat("dwing", "violet0", "dawn2", "dawn1")


def _duskwing(k: int) -> Fig:
    f = Fig(24, 16)
    tips = [(2, 1), (1, 6), (3, 13), (1, 6)][k]
    f.lay()
    for sx in (-1, 1):
        s_ = (12 + sx * 2, 6)
        t = (12 + sx * (12 - tips[0]), tips[1])
        h = (12 + sx * 2, 10)

        def lerp(a, b, u):
            return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
        m1, m2, m3 = lerp(t, h, 0.3), lerp(t, h, 0.55), lerp(t, h, 0.8)
        f.poly([s_, t, (m1[0], m1[1] + 2), m2, (m3[0], m3[1] + 2), h], "dwing")
        sp = lerp(s_, t, 0.55)
        f.dot(round(sp[0]), round(sp[1]) + 1, "dawn0")
    f.lay().oval(12, 8, 3, 4, 0, "dfur")
    f.lay().poly([(10, 5), (9, 1), (12, 4)], "dfur")
    f.poly([(14, 5), (15, 1), (12, 4)], "dfur")
    f.dot(11, 7, "gold2")
    f.dot(13, 7, "gold2")
    f.dot(12, 10, "white")
    return f


def duskwing_frames() -> list[Canvas]:
    return [_duskwing(k).render() for k in range(4)]


# ---------------------------------------------------------------------------------------
# Spitter newt: 24x16, hitbox 16x16 at (4, 0); low to the ground, walk cycle of 4
# ---------------------------------------------------------------------------------------

mat("newt", "moss0", "moss1", "moss2", 1)
mat("newt_far", "moss0", "moss0", "moss1")
mat("newt_belly", "fire3", "fire4", "fire5")


def _newt(k: int) -> Fig:
    f = Fig(24, 16)
    st = [2, 0, -2, 0]
    for (x, far, ph) in ((9, True, 2), (16, True, 0)):
        d = st[(k + ph) % 4]
        f.lay().seg((x, 12), (x + d, 15), 2, "newt_far")
    sway = [0, 1, 0, -1][k]
    f.lay().limb([(8, 11), (5, 11 + sway), (2, 9 + sway), (1, 7 + sway)], 3, "newt")
    f.lay().oval(12, 11, 6, 2.5, 0, "newt")
    f.oval(13, 13, 5, 1, 0, "newt_belly")
    f.lay().oval(19, 10, 3.5, 2.5, -8, "newt")
    f.dot(20, 9, "gold2")
    f.dot(21, 9, "ink")
    f.seg((19, 12), (22, 11), 1, "ink")
    for x, y in ((9, 9), (13, 9), (16, 9)):
        f.dot(x, y, "gold2")
    f.lay()
    for x in range(7, 17, 2):
        f.dot(x, 8, "fire3")
    for (x, ph) in ((10, 0), (17, 2)):
        d = st[(k + ph) % 4]
        f.lay().seg((x, 12), (x + d, 15), 2, "newt")
    return f


def newt_frames() -> list[Canvas]:
    r, l = pair([_newt(k) for k in range(4)])
    return r + l


# ---------------------------------------------------------------------------------------
# Stingmote: a glowing wasp-like mote. 32x32, hitbox 24x24 at (4, 4)
# ---------------------------------------------------------------------------------------

mat("mote", "fire4", "gold2", "fire5", 1)
mat("mote_band", "violet0", "violet0", "violet1")
mat("glass", "shard2", "shard3", "white")


def _mote_side(k: int) -> Fig:
    f = Fig(32, 32)
    f.lay().oval(19, 8, 5, 2, [-70, -20][k], "glass")
    f.lay().oval(10, 19, 6.5, 4.5, 30, "mote")
    for (x, y) in ((8, 16), (6, 19), (11, 18), (9, 21), (13, 20)):
        pass
    f.lay()
    for c in (0.35, 0.65):
        cx, cy = 10 + (c - 0.5) * 11 * math.cos(math.radians(30)), 19 + (c - 0.5) * 11 * math.sin(math.radians(30))
        f.oval(cx, cy, 1.1, 4.8, 30, "mote_band")
    f.lay().seg((5, 23), (2, 27), 2, "bone")
    f.lay().disc(16, 15, 4.5, "mote")
    f.dot(15, 13, "white")
    f.lay().disc(21, 13, 3.5, "mote")
    f.rect(22, 11, 23, 13, "ink")
    f.dot(22, 11, "white")
    f.lay().seg((21, 10), (24, 6), 1, "ink")
    f.lay().oval(13, 8, 6, 2.5, [-115, -165][k], "glass")
    return f


def _mote_front(k: int) -> Fig:
    f = Fig(32, 32)
    f.lay()
    for sx in (-1, 1):
        f.oval(16 + sx * 7, 9 + k * 3, 6, 2.5, -90 - sx * (50 + k * 30), "glass")
    f.lay().oval(16, 22, 4, 6, 0, "mote")
    f.lay()
    for y in (21, 24):
        f.rect(12, y, 20, y, "mote_band")
    f.lay().seg((16, 28), (16, 30), 2, "bone")
    f.lay().disc(16, 15, 4.5, "mote")
    f.dot(15, 13, "white")
    f.lay().disc(16, 9, 3.5, "mote")
    f.rect(13, 8, 14, 9, "ink")
    f.rect(18, 8, 19, 9, "ink")
    f.dot(13, 8, "white")
    f.dot(18, 8, "white")
    return f


def stingmote_frames() -> list[Canvas]:
    side = [_mote_side(k) for k in range(2)]
    return [f.render(flip=True) for f in side] + [f.render() for f in side] + \
        [_mote_front(k).render() for k in range(2)]


# ---------------------------------------------------------------------------------------
# Segmenter: a crystal-backed centipede drawn as 16x16 parts
# ---------------------------------------------------------------------------------------

mat("carap", "wood0", "wood1", "wood2", 1)
mat("seg_leg", "ink", "gold0", "gold1")


def _seg_legs(cv: Canvas, xs, phase, top=12):
    off = [-2, -1, 0, 1, 2, 1]
    for i, x in enumerate(xs):
        d = off[(phase + i * 3) % 6]
        lift = 1 if d in (-1, 0) and (phase + i * 3) % 6 in (1, 2) else 0
        cv.line(x, top, x + d, 15 - lift, N["gold0"])
        cv.set(x + d, 15 - lift, N["ink"])
        cv.set(x, top, N["gold1"])


def _seg_body(phase: int) -> Canvas:
    f = Fig(16, 16)
    f.lay().oval(8, 9, 7, 3.5, 0, "carap")
    f.dot(4, 11, "wood0")
    f.dot(12, 11, "wood0")
    f.lay().poly([(6, 6), (8, 0), (10, 6)], "crystal")
    f.dot(8, 2, "white")
    cv = f.render()
    _seg_legs(cv, (4, 11), phase, 13)
    return cv


def _seg_head(open_: bool, flip: bool) -> Canvas:
    f = Fig(16, 16)
    f.lay().oval(7, 9, 6, 4, 0, "carap")
    f.rect(9, 7, 10, 8, "ink")
    f.dot(10, 7, "shard3")
    f.lay().seg((5, 6), (8, 2), 1, "ant")
    f.seg((8, 2), (11, 1), 1, "ant")
    f.lay()
    if open_:
        f.limb([(12, 8), (14, 6), (15, 7)], 1, "bone")
        f.limb([(12, 11), (14, 13), (15, 12)], 1, "bone")
    else:
        f.limb([(12, 8), (14, 9), (15, 10)], 1, "bone")
        f.limb([(12, 12), (14, 11), (15, 10)], 1, "bone")
    cv = f.render(flip=flip)
    _seg_legs(cv, (5,) if not flip else (10,), 0, 13)
    return cv


def _seg_tail(flip: bool) -> Canvas:
    f = Fig(16, 16)
    f.lay().oval(10, 10, 5.5, 3, 0, "carap")
    f.lay().limb([(5, 9), (2, 7), (1, 5)], 1, "bone")
    f.limb([(5, 11), (2, 12), (1, 10)], 1, "bone")
    f.lay().poly([(9, 7), (10, 3), (12, 7)], "crystal")
    cv = f.render(flip=flip)
    _seg_legs(cv, (11,) if not flip else (4,), 2, 13)
    return cv


def segmenter_frames() -> list[Canvas]:
    # tail_r belongs to a right-moving centipede: its tip points back (left); tail_l mirrors it
    return [_seg_head(True, True), _seg_head(False, True), _seg_head(True, False), _seg_head(False, False)] + \
        [_seg_body(k) for k in range(6)] + [_seg_tail(True), _seg_tail(False)]


# ---------------------------------------------------------------------------------------
# Mire slick: a low oily slime (32x16, hitbox 30x13 at (1, 3)) and its leap (56x32)
# ---------------------------------------------------------------------------------------

mat("oil", "violet0", "violet1", "violet2", 1)


def _oil_sheen(f, pts):
    cols = ["shard2", "water3", "berry2"]
    for i, (x, y) in enumerate(pts):
        f.dot(x, y, cols[i % 3])


def _slick(k: int) -> Fig:
    f = Fig(32, 16)
    bx = [9, 14, 19, 24][k]
    f.lay()
    tops = {}
    for x in range(2, 30):
        u = (x - 1.5) / 28.5
        h = 2 + 6 * math.sin(math.pi * u) ** 0.6 + 2.5 * math.exp(-((x - bx) / 3.5) ** 2)
        top = int(round(15 - h))
        tops[x] = top
        f.rect(x, top, x, 15, "oil")
    sheen = [(x, tops[x] + 1) for x in range(5, 12, 2)]
    _oil_sheen(f, sheen)
    for ex in (14, 18):
        y = tops[ex] + 2
        f.dot(ex, y, "white")
        f.dot(ex + 1, y, "white")
        f.dot(ex + 1, y + 1, "ink")
    return f


def _arc(f, pts, th):
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        f.disc(x, y, th(i / (n - 1)), "oil")


def _slick_leap(k: int) -> Fig:
    f = Fig(56, 32)
    f.lay()

    def para(a, peak, b, n=40):
        out = []
        for i in range(n + 1):
            t = i / n
            x = a[0] + (b[0] - a[0]) * t
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * peak + t * t * b[1]
            out.append((x, y))
        return out
    if k == 0:
        pts = para((8, 27), 4, (30, 9))
        th = lambda t: 2 + 3.5 * t  # noqa: E731
    elif k == 1:
        pts = para((6, 27), -8, (50, 27))
        th = lambda t: 2.5 + 2.5 * math.sin(math.pi * t) + 1.5 * t  # noqa: E731
    elif k == 2:
        pts = para((24, 9), 2, (50, 27))
        th = lambda t: 2 + 3.5 * t  # noqa: E731
    else:
        pts = para((30, 27), 24, (46, 27))
        th = lambda t: 2 + 4 * math.sin(math.pi * t)  # noqa: E731
    _arc(f, pts, th)
    hx, hy = pts[-1] if k < 3 else pts[len(pts) // 2]
    hx, hy = int(hx), int(hy)
    top = min(y for x in range(56) for y in range(32) if f.has(x, y) and abs(x - hx) <= 1)
    f.dot(hx - 2, top + 2, "white")
    f.dot(hx - 1, top + 2, "white")
    f.dot(hx - 1, top + 3, "ink")
    f.dot(hx + 1, top + 2, "white")
    f.dot(hx + 2, top + 2, "white")
    f.dot(hx + 2, top + 3, "ink")
    mid = pts[len(pts) // 3]
    _oil_sheen(f, [(int(mid[0]) + d, int(mid[1]) - 2) for d in (-2, 0, 2)])
    return f


# ---------------------------------------------------------------------------------------
# Vine creeper: a thorny climbing critter. 24x32, hitbox 16x29 at (4, 3); 8-frame climb
# ---------------------------------------------------------------------------------------

mat("creep", "moss1", "moss2", "moss3", 1)
mat("thorn", "wood2", "wood3", "wood4")


def _creeper(k: int) -> Fig:
    f = Fig(24, 32)
    a = 2 * math.pi * k / 8
    bob = round(math.sin(2 * a))
    lh, rh = 8 + 3 * math.cos(a), 8 - 3 * math.cos(a)
    lf, rf = 26 - 2 * math.cos(a), 26 + 2 * math.cos(a)
    f.lay().limb([(12, 25 + bob), (13, 29), (11, 31)], 2, "creep")
    for (sx, hy, fy) in ((-1, lh, lf), (1, rh, rf)):
        f.lay().limb([(12 + sx * 3, 13 + bob), (12 + sx * 6, 11 + bob), (12 + sx * 6, hy)], 2, "creep")
        f.lay().limb([(12 + sx * 3, 22 + bob), (12 + sx * 7, 22 + bob), (12 + sx * 6, fy)], 2, "creep")
    f.lay().oval(12, 17 + bob, 4.5, 8, 0, "creep")
    f.lay()
    for i, y in enumerate(range(12, 25, 4)):
        f.poly([(8, y + bob), (6, y - 2 + bob), (8, y - 1 + bob)], "thorn")
        f.poly([(16, y + bob), (18, y - 2 + bob), (16, y - 1 + bob)], "thorn")
        f.dot(12, y + 1 + bob, "wood3")
    f.lay().disc(12, 7 + bob, 3.5, "creep")
    f.poly([(10, 5 + bob), (9, 2 + bob), (11, 4 + bob)], "thorn")
    f.poly([(14, 5 + bob), (15, 2 + bob), (13, 4 + bob)], "thorn")
    f.dot(10, 7 + bob, "gold2")
    f.dot(14, 7 + bob, "gold2")
    return f


# ---------------------------------------------------------------------------------------
# Snapjaw: a wall-mounted plant jaw. 24x16; _r grows from the left edge, _l from the right
# ---------------------------------------------------------------------------------------

mat("stem", "moss1", "moss2", "moss3")
mat("pod", "berry0", "berry1", "berry2", 1)
mat("maw", "fire1", "fire2", "fire2")


def _snapjaw(pose: str) -> Fig:
    f = Fig(24, 16)
    reach = {"rest": 3, "open": 8, "snap": 13}[pose]
    f.lay().seg((0, 8), (reach, 8), 3, "stem")
    f.lay().poly([(0, 3), (3, 6), (0, 9)], "stem")
    f.poly([(0, 13), (3, 10), (0, 7)], "stem")
    x = reach
    if pose == "open":
        f.lay().poly([(x, 7), (x + 3, 7), (x + 10, 11), (x + 3, 12), (x, 9)], "maw")
        f.lay().poly([(x, 7), (x + 4, 1), (x + 11, 1), (x + 12, 4), (x + 5, 6)], "pod")
        f.lay().poly([(x, 9), (x + 4, 15), (x + 11, 15), (x + 12, 12), (x + 5, 10)], "pod")
        for i in range(3):
            f.dot(x + 5 + i * 2, 6 - (i == 2), "white")
            f.dot(x + 5 + i * 2, 11 + (i == 2), "white")
    else:
        rx = 5 if pose == "rest" else 5.5
        f.lay().oval(x + rx + 1, 8, rx + 0.5, 4.5, 0, "pod")
        for i in range(int(rx * 2) - 1):
            f.dot(x + 2 + i, 8 + (i % 2) * (1 if pose == "snap" else 0), "white" if pose == "snap" else "berry0")
        if pose == "rest":
            f.dot(x + 3, 8, "ink")
            f.dot(x + 9, 8, "ink")
    f.dot(x + 4, 4 if pose != "open" else 3, "moss3")
    return f


# ---------------------------------------------------------------------------------------
# Fish: gar (armoured), ember minnow, ribbon eel; urchin mine
# ---------------------------------------------------------------------------------------

mat("gar", "water0", "water1", "water2", 1)
mat("gar_plate", "stone1", "stone2", "stone3")
mat("gar_belly", "stone3", "stone4", "white")
mat("fin", "water0", "water1", "water3")


def _gar(k: int, dead=False) -> Fig:
    f = Fig(32, 16)
    tail = [-3, 0, 3, 0][k]
    f.lay().poly([(6, 8), (1, 4 + tail), (3, 8 + tail // 2), (1, 12 + tail)], "fin")
    f.lay().poly([(13, 5), (16, 1), (19, 5)], "fin")
    f.poly([(12, 11), (14, 14), (17, 11)], "fin")
    f.lay().oval(15, 8, 10, 4, 0, "gar")
    f.oval(15, 10, 8, 1.5, 0, "gar_belly")
    for x in range(9, 22, 3):
        f.dot(x, 6, "stone3")
        f.dot(x + 1, 7, "stone2")
        f.dot(x + 1, 5, "stone2")
    f.lay().seg((23, 8), (30, 8), 3, "gar")
    for x in (25, 27, 29):
        f.dot(x, 9, "white")
    if dead:
        f.dot(21, 6, "ink")
        f.dot(23, 6, "ink")
        f.dot(22, 7, "ink")
        f.dot(21, 8, "ink")
        f.dot(23, 8, "ink")
    else:
        f.dot(22, 6, "gold2")
        f.dot(23, 6, "ink")
    return f


def _vflip(cv: Canvas) -> Canvas:
    k = Canvas(cv.w, cv.h)
    for y in range(cv.h):
        k.px[y * cv.w:(y + 1) * cv.w] = cv.px[(cv.h - 1 - y) * cv.w:(cv.h - y) * cv.w]
    return k


def gar_frames() -> list[Canvas]:
    swim = [_gar(k) for k in range(4)]
    dead = _gar(0, dead=True)
    pale = {"water0": "stone0", "water1": "stone1", "water2": "stone2", "water3": "stone3", "gold2": "stone3"}
    dl = recolor(_vflip(dead.render(flip=True)), pale)
    dr = recolor(_vflip(dead.render()), pale)
    return [f.render(flip=True) for f in swim] + [f.render() for f in swim] + [dl, dr]


mat("ember_fish", "fire2", "fire3", "fire4", 1)
mat("ember_fin", "fire1", "fire2", "fire3")


def _minnow(k: int) -> Fig:
    f = Fig(16, 8)
    t = [-1, 0, 1, 0][k]
    f.lay().poly([(4, 4), (1, 1 + t), (1, 6 + t)], "ember_fin")
    f.lay().oval(8, 4, 5, 2.2, 0, "ember_fish")
    f.dot(11, 3, "ink")
    f.dot(9, 5, "fire5")
    f.dot(7, 5, "fire5")
    f.lay().poly([(7, 2), (9, 1), (9, 2)], "ember_fin")
    return f


def minnow_frames() -> list[Canvas]:
    m = [_minnow(k) for k in range(4)]
    return [f.render(flip=True) for f in m] + [f.render() for f in m]


mat("eel", "water1", "water2", "water3", 1)
mat("eel_fin", "gold0", "gold1", "gold2")


def _eel(k: int) -> Fig:
    f = Fig(40, 24)
    ph = 2 * math.pi * k / 5
    pts = []
    for x in range(3, 31):
        u = (x - 3) / 28.0                      # 0 at the tail, 1 at the head
        amp = 1 + 4.5 * (1 - u) ** 1.2
        y = 12 + amp * math.sin(x / 4.2 - ph)
        pts.append((x, y, 1.0 + 1.8 * u))
    f.lay()
    for (x, y, r) in pts:
        f.put(x, y - r - 1, "eel_fin")
        f.put(x, y - r - 2, "eel_fin")
    f.lay()
    for (x, y, r) in pts:
        f.disc(x, y, r, "eel")
    hx, hy = 31, pts[-1][1]
    f.lay().oval(hx + 1, hy, 4.5, 3, 0, "eel")
    f.dot(hx + 2, round(hy) - 1, "gold2")
    f.dot(hx + 3, round(hy) - 1, "ink")
    f.seg((hx + 2, round(hy) + 1), (hx + 5, round(hy) + 1), 1, "ink")
    for (x, y, r) in pts[4::5]:
        f.dot(x, round(y + r * 0.5), "stone4")
    return f


def eel_frames() -> list[Canvas]:
    e = [_eel(k) for k in range(5)]
    return [f.render(flip=True) for f in e] + [f.render() for f in e]


mat("urchin", "violet0", "berry0", "berry1", 1)


def urchin_frames() -> list[Canvas]:
    out = []
    for k in range(2):
        cv = Canvas(24, 16)
        ln = [2.5, 4.0][k]
        for a in range(0, 360, 30):
            c, s_ = math.cos(math.radians(a)), math.sin(math.radians(a))
            x0, y0 = 12 + c * 5.5, 8 + s_ * 4.5
            x1, y1 = 12 + c * (5.5 + ln) , 8 + s_ * (4.5 + ln * 0.8)
            cv.line(round(x0), round(y0), round(x1), round(y1), N["stone1"])
            cv.set(round(x1), round(y1), N["stone3"] if k else N["stone2"])
        f = Fig(24, 16)
        f.lay().oval(12, 8, 6, 5, 0, "urchin")
        glow = "fire5" if k else "fire3"
        for (x, y) in ((10, 6), (14, 7), (12, 10), (9, 9), (15, 10)):
            f.dot(x, y, glow)
        f.dot(11, 5, "berry2")
        body = f.render()
        cv.blit(body, 0, 0)
        out.append(cv)
    return out


def build() -> None:
    save_sprite("burrowhog", burrowhog_frames())
    save_sprite("cairnbrute", cairnbrute_frames())
    save_sprite("loomspider", loomspider_frames())
    save_sprite("shade", shade_frames())
    r, l = pair([_toad("sit"), _toad("up"), _toad("down")])
    save_sprite("piptoad", r + l)
    save_sprite("duskwing", duskwing_frames())
    save_sprite("newt", newt_frames())
    save_sprite("stingmote", stingmote_frames())
    save_sprite("segmenter", segmenter_frames())
    save_sprite("slick", [_slick(k).render() for k in range(4)])
    save_sprite("slick_leap", [_slick_leap(k).render() for k in range(4)])
    save_sprite("creeper", [_creeper(k).render() for k in range(8)])
    r, l = pair([_snapjaw(p) for p in ("rest", "open", "snap")])
    save_sprite("snapjaw", r + l)
    save_sprite("gar", gar_frames())
    save_sprite("minnow", minnow_frames())
    save_sprite("eel", eel_frames())
    save_sprite("urchin", urchin_frames())


if __name__ == "__main__":
    build()
