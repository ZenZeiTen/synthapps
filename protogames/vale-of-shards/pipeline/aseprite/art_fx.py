"""Projectiles and effects drawn in code.

    python3 pipeline/aseprite/art_fx.py
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from art_chars import Fig, mat, paint, sparkle  # noqa: E402
from canvas import Canvas, rng  # noqa: E402
from palette import N  # noqa: E402
from sheet import save_sprite  # noqa: E402


def C(name: str) -> int:
    return N[name]


def mirror(cv: Canvas) -> Canvas:
    return cv.flip_h()


# --- bolt: 16x4, hitbox 14x4 at (1, 0); a lozenge of lamp light --------------------------------

def bolt_frames() -> list[Canvas]:
    out = []
    for outer, mid, core in (("gold0", "gold1", "gold2"), ("fire3", "fire5", "white")):
        cv = Canvas(16, 4)
        cv.rect(4, 0, 11, 0, C(outer))
        cv.rect(4, 3, 11, 3, C(outer))
        cv.rect(1, 1, 14, 2, C(mid))
        cv.rect(3, 1, 12, 2, C(core))
        cv.rect(6, 1, 11, 1, C("white"))
        cv.set(1, 1, C(outer))
        cv.set(1, 2, C(outer))
        cv.set(14, 1, C(outer))
        cv.set(14, 2, C(outer))
        out.append(cv)
    return out


# --- stone: a thrown pebble spinning, about 8x8 centred in 16x16 -------------------------------

mat("pebble", "stone1", "stone2", "stone3", 1)


def stone_frames() -> list[Canvas]:
    base = [(0, -3.6), (2.6, -2.6), (3.6, 0), (2.8, 2.8), (0, 3.4), (-2.8, 2.6), (-3.6, -0.4), (-2.2, -2.8)]
    out = []
    for k in range(4):
        a = math.radians(k * 90 + 20)
        pts = [(7.5 + x * math.cos(a) - y * math.sin(a), 7.5 + x * math.sin(a) + y * math.cos(a)) for x, y in base]
        f = Fig(16, 16)
        f.lay().poly(pts, "pebble")
        # a chip that turns with the stone
        cx = 7.5 + 1.6 * math.cos(a + 2.4)
        cy = 7.5 + 1.6 * math.sin(a + 2.4)
        f.dot(round(cx), round(cy), "stone1")
        f.dot(6, 6, "stone4")
        out.append(f.render())
    return out


# --- ember: fireball 24x24, hitbox 24x22 at (0, 1); left x2, right x2 --------------------------

def _fireball(k: int) -> Canvas:
    """Facing right: a round head on the right, flame tongues streaming left."""
    cv = Canvas(24, 24)
    r = rng(f"ember{k}")
    rings = [(9.5, "fire1"), (8.5, "fire2"), (7.0, "fire3"), (5.0, "fire4"), (3.2, "fire5"), (1.6, "white")]
    hx, hy = 15.5, 11.5
    for rad, col in rings:
        for y in range(24):
            for x in range(24):
                dx, dy = x - hx, y - hy
                # stretch the back of each ring into a tail with flickering tongues
                if dx < 0:
                    wob = math.sin((y + k * 3) * 1.3) * 1.6 + (1.2 if (y + k) % 4 == 0 else 0)
                    dx = dx / (1.9 + 0.12 * wob)
                if dx * dx + dy * dy <= (rad * (0.62 if dx < 0 else 0.72)) ** 2 * 1.4:
                    cv.set(x, y, C(col))
    # loose sparks behind
    for _ in range(3):
        x, y = r.randint(1, 6), r.randint(6, 17)
        cv.set(x, y, C("fire4"))
    return cv


def ember_frames() -> list[Canvas]:
    right = [_fireball(k) for k in range(2)]
    return [mirror(c) for c in right] + right


# --- torpedo: 12x8, hitbox 10x5 at (1, 1) ---------------------------------------------------

def torpedo_frames() -> list[Canvas]:
    f = Fig(12, 8)
    f.lay().rect(3, 2, 8, 4, "brass")
    f.lay().oval(8.5, 3, 1.6, 1.2, 0, "brass")
    f.lay().rect(2, 1, 2, 5, "ink")
    f.dot(1, 3, "stone2")
    f.dot(5, 3, "gold2")
    f.dot(6, 3, "gold2")
    right = f.render()
    right.set(0, 2, C("stone3"))
    right.set(0, 4, C("stone3"))
    return [mirror(right), right]


# --- pellet: 8x4; a slug and a two-frame orb ------------------------------------------------

def pellet_frames() -> list[Canvas]:
    slug = Canvas(8, 4)
    slug.rect(1, 1, 6, 2, C("ink"))
    slug.rect(1, 0, 5, 3, C("ink"))
    slug.rect(2, 1, 5, 2, C("fire3"))
    slug.rect(4, 1, 5, 1, C("fire5"))
    orbs = []
    for k in range(2):
        o = Canvas(8, 4)
        o.rect(2, 0, 5, 3, C("ink"))
        o.rect(1, 1, 6, 2, C("ink"))
        o.rect(2, 1, 5, 2, C("berry1") if k == 0 else C("berry2"))
        o.set(3 if k == 0 else 4, 1, C("white"))
        o.set(4 if k == 0 else 3, 2, C("berry2") if k == 0 else C("dawn0"))
        orbs.append(o)
    return [slug] + orbs


# --- glassbolt: the Regent's spinning glass shard. 24x16, hitbox 18x13 at (3, 1) ---------------

mat("glassy", "shard1", "shard2", "shard3", 1)


def glassbolt_frames() -> list[Canvas]:
    out = []
    for k in range(2):
        f = Fig(24, 16)
        if k == 0:
            pts = [(3, 8), (9, 2), (20, 6), (20, 9), (10, 14)]
        else:
            pts = [(4, 7), (14, 1), (19, 8), (14, 14), (5, 10)]
        f.lay().poly(pts, "glassy")
        f.lay().seg(pts[1], (pts[2][0] - 2, pts[2][1] + 1), 1, "white")
        f.dot(11, 7, "white")
        f.dot(12, 8, "shard3")
        out.append(f.render())
    return out


# --- spark: wall-hit pop, 16x16 -------------------------------------------------------------

def spark_frames() -> list[Canvas]:
    out = []
    c = 7
    # 0: hot core
    cv = Canvas(16, 16)
    cv.rect(c - 1, c - 1, c + 1, c + 1, C("fire5"))
    cv.set(c, c, C("white"))
    for d in ((2, 0), (-2, 0), (0, 2), (0, -2)):
        cv.set(c + d[0], c + d[1], C("fire4"))
    out.append(cv)
    # 1: cross rays
    cv = Canvas(16, 16)
    for i in range(1, 5):
        col = C("white") if i < 2 else C("fire5") if i < 4 else C("fire4")
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv.set(c + dx * i, c + dy * i, col)
    cv.set(c, c, C("white"))
    out.append(cv)
    # 2: diagonal sparks flying out
    cv = Canvas(16, 16)
    for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        cv.set(c + dx * 3, c + dy * 3, C("fire5"))
        cv.set(c + dx * 4, c + dy * 4, C("fire4"))
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cv.set(c + dx * 5, c + dy * 5, C("fire4"))
    cv.set(c, c, C("fire4"))
    out.append(cv)
    # 3: embers fading
    cv = Canvas(16, 16)
    for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        cv.set(c + dx * 5, c + dy * 5, C("fire3"))
    for dx, dy in ((1, 0), (-1, 0), (0, 1)):
        cv.set(c + dx * 6, c + dy * 6, C("fire2"))
    out.append(cv)
    return out


# --- flash: pickup twinkle; a 4-point star and an expanding ring ----------------------------

def flash_frames() -> list[Canvas]:
    out = []
    for size in (1, 3, 5, 2):
        cv = Canvas(16, 16)
        sparkle(cv, 7, 7, size, core="white", arm="gold2")
        if size >= 3:
            for d in (1,):
                for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                    cv.set(7 + dx * d, 7 + dy * d, C("gold2"))
        out.append(cv)
    for k, rad in enumerate((2.6, 3.8, 5.0, 6.5)):
        cv = Canvas(16, 16)
        col = [C("white"), C("gold2"), C("gold1"), C("gold0")][k]
        for a in range(0, 360, 6):
            x = round(7.5 + rad * math.cos(math.radians(a)))
            y = round(7.5 + rad * math.sin(math.radians(a)))
            if k < 3 or (a // 30) % 2 == 0:
                cv.set(x, y, col)
        out.append(cv)
    return out


# --- burst: 32x32 explosion, 5 frames --------------------------------------------------------

def _blob(cv: Canvas, cx, cy, rad, col, seed, rough=1.2):
    r = rng(seed)
    bumps = [r.uniform(-rough, rough) for _ in range(12)]
    for y in range(32):
        for x in range(32):
            dx, dy = x - cx, y - cy
            a = math.atan2(dy, dx)
            i = int((a + math.pi) / (2 * math.pi) * 12) % 12
            if dx * dx + dy * dy <= (rad + bumps[i]) ** 2:
                cv.set(x, y, C(col))


def burst_frames() -> list[Canvas]:
    out = []
    cv = Canvas(32, 32)
    _blob(cv, 15.5, 15.5, 5, "fire4", "b0", 0.6)
    _blob(cv, 15.5, 15.5, 3, "fire5", "b0")
    _blob(cv, 15.5, 15.5, 1.5, "white", "b0", 0.3)
    out.append(cv)
    cv = Canvas(32, 32)
    _blob(cv, 15.5, 15.5, 11, "fire2", "b1")
    _blob(cv, 15.5, 15.5, 9, "fire3", "b1")
    _blob(cv, 15.5, 15, 7, "fire4", "b1b")
    _blob(cv, 15.5, 14.5, 4.5, "fire5", "b1c")
    _blob(cv, 15, 14, 2.5, "white", "b1d", 0.5)
    out.append(cv)
    cv = Canvas(32, 32)
    _blob(cv, 15.5, 15.5, 14, "fire1", "b2", 2.0)
    _blob(cv, 15.5, 15.5, 12, "fire2", "b2")
    _blob(cv, 15.5, 14.5, 9, "fire3", "b2b")
    _blob(cv, 15, 13.5, 5.5, "fire4", "b2c")
    _blob(cv, 15, 13, 2.5, "fire5", "b2d", 0.5)
    out.append(cv)
    # smoke with embers
    cv = Canvas(32, 32)
    for (x, y, rad) in ((10, 12, 6), (21, 11, 6), (15, 19, 7), (8, 20, 4.5), (23, 20, 5)):
        _blob(cv, x, y, rad, "stone1", f"s{x}", 1.0)
    for (x, y, rad) in ((10, 11, 4), (21, 10, 4), (15, 18, 5)):
        _blob(cv, x - 1, y - 1, rad, "stone2", f"t{x}", 0.8)
    for (x, y) in ((15, 15), (12, 20), (19, 17), (9, 12), (22, 12)):
        cv.set(x, y, C("fire4"))
        cv.set(x + 1, y, C("fire3"))
    out.append(cv)
    cv = Canvas(32, 32)
    for (x, y, rad) in ((9, 9, 3.5), (22, 8, 4), (15, 17, 4), (6, 19, 2.5), (25, 19, 3)):
        _blob(cv, x, y, rad, "stone1", f"u{x}", 0.8)
        _blob(cv, x - 1, y - 1, rad - 1.5, "stone2", f"v{x}", 0.5)
    cv.set(15, 17, C("fire3"))
    out.append(cv)
    return out


# --- frag: debris bits (8x8) and a pebble ---------------------------------------------------

def frag_frames() -> list[Canvas]:
    shapes = [
        (["SS.", "SSS", ".S."], "stone3", "stone4"),
        (["SSS", "SS."], "stone2", "stone4"),
        (["S..", "SS.", "SSS"], "stone3", "stone4"),
        (["WWW", ".WW"], "wood2", "wood3"),
        ([".S", "SS", "S."], "stone2", "stone4"),
    ]
    out = []
    for rows, base, lit in shapes:
        cv = Canvas(8, 8)
        paint(cv, 2, 2, rows, {"S": base, "W": base})
        cv.set(2 + rows[0].index(rows[0].strip(".")[0]), 2, C(lit))
        cv.outline("ink")
        out.append(cv)
    f = Fig(8, 8)
    f.lay().disc(3.5, 3.5, 2.2, "pebble")
    out.append(f.render())
    return out


# --- impact: a hit-star over the hero, 24x40, 5 frames ----------------------------------------

def _star(cv: Canvas, cx, cy, rays, r_in, r_out, col, rot=0.0):
    pts = []
    for i in range(rays * 2):
        a = rot + math.pi * i / rays
        rad = r_out if i % 2 == 0 else r_in
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a) * 1.25))
    f = Fig(cv.w, cv.h)
    f.poly(pts, "ink")
    for y in range(cv.h):
        for x in range(cv.w):
            if f.has(x, y):
                cv.set(x, y, C(col))


def impact_frames() -> list[Canvas]:
    out = []
    cx, cy = 11.5, 18
    spec = [
        [(4, 2, 5, "fire5"), (4, 1, 2.5, "white")],
        [(5, 3.5, 10, "fire4"), (5, 2.5, 7, "fire5"), (5, 1.5, 4, "white")],
        [(6, 4.5, 11.5, "fire3"), (6, 3.5, 9, "fire5"), (6, 2, 5, "white")],
        [(6, 5, 11.5, "fire2"), (6, 4, 8.5, "fire4")],
        [(6, 4.5, 10, "fire2")],
    ]
    for k, layers in enumerate(spec):
        cv = Canvas(24, 40)
        for rays, ri, ro, col in layers:
            _star(cv, cx, cy, rays, ri, ro, col, rot=k * 0.18)
        if k == 4:
            # hollow out the last frame: only the tips remain
            for y in range(40):
                for x in range(24):
                    if (x - cx) ** 2 + ((y - cy) / 1.25) ** 2 < 36:
                        cv.set(x, y, None)
        out.append(cv)
    return out


# --- bubble: three sizes in 8x8 -------------------------------------------------------------

def bubble_frames() -> list[Canvas]:
    out = []
    for rad in (1.2, 2.2, 3.3):
        cv = Canvas(8, 8)
        c = 3.5
        for y in range(8):
            for x in range(8):
                d = math.hypot(x - c, y - c)
                if rad - 1.0 < d <= rad + 0.35:
                    cv.set(x, y, C("water4"))
        hx = round(c - rad * 0.55)
        cv.set(hx, hx, C("white"))
        if rad < 2:
            cv.rect(3, 3, 4, 4, C("water4"))
            cv.set(3, 3, C("white"))
        out.append(cv)
    return out


# --- dust: landing puff 16x8 ----------------------------------------------------------------

def dust_frames() -> list[Canvas]:
    out = []
    for k in range(3):
        cv = Canvas(16, 8)
        spread = [2, 4, 6][k]
        rad = [2.2, 2.6, 2.0][k]
        for sx in (-1, 1):
            cx = 7.5 + sx * spread
            cy = 5.5 - k * 0.5
            for y in range(8):
                for x in range(16):
                    if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
                        cv.set(x, y, C("stone3") if y > cy - 0.5 or k == 2 else C("stone4"))
        if k == 0:
            cv.rect(6, 6, 9, 7, C("stone3"))
        out.append(cv)
    return out


# --- digits: 0-9, 4x6 cells, bright gold on ink ---------------------------------------------

DIGITS = [
    ["###", "#.#", "#.#", "#.#", "###"],
    [".#.", "##.", ".#.", ".#.", "###"],
    ["###", "..#", "###", "#..", "###"],
    ["###", "..#", ".##", "..#", "###"],
    ["#.#", "#.#", "###", "..#", "..#"],
    ["###", "#..", "###", "..#", "###"],
    ["###", "#..", "###", "#.#", "###"],
    ["###", "..#", ".#.", ".#.", ".#."],
    ["###", "#.#", "###", "#.#", "###"],
    ["###", "#.#", "###", "..#", "###"],
]


def digit_frames() -> list[Canvas]:
    out = []
    for rows in DIGITS:
        cv = Canvas(4, 6, fill=C("ink"))
        paint(cv, 0, 0, rows, {"#": "gold2"})
        out.append(cv)
    return out


def build() -> None:
    save_sprite("bolt", bolt_frames())
    save_sprite("stone", stone_frames())
    save_sprite("ember", ember_frames())
    save_sprite("torpedo", torpedo_frames())
    save_sprite("pellet", pellet_frames())
    save_sprite("glassbolt", glassbolt_frames())
    save_sprite("spark", spark_frames())
    save_sprite("flash", flash_frames())
    save_sprite("burst", burst_frames())
    save_sprite("frag", frag_frames())
    save_sprite("impact", impact_frames())
    save_sprite("bubble", bubble_frames())
    save_sprite("dust", dust_frames())
    save_sprite("digits", digit_frames())


if __name__ == "__main__":
    build()
