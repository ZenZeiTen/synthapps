"""The creatures and things of Tidebell, drawn in code from primitives. All designs are
Tidebell's own.

    python3 pipeline/aseprite/art_creatures.py
"""
from __future__ import annotations

import math

from canvas import Canvas
from palette import N
from puppet import disc, pt, thick
from sheet import save_sprite


def done(c: Canvas, outline=True) -> Canvas:
    if outline:
        c.outline("ink")
    return c


# ------------------------------------------------------------------ creatures
def mudskip(frame):
    c = Canvas(24, 16)
    hop = frame == 2
    y = 11 if not hop else 8
    tail = 1 if frame == 1 else 0
    for x in range(4, 19):
        t = (x - 4) / 14
        h = 3 + int(2.5 * math.sin(t * math.pi))
        for yy in range(y - h, y + 2):
            c.set(x, yy, "silt1" if yy < y else "silt2")
    thick(c, 4, y, 1, y - 3 + tail * 2, 2.2, N["silt0"])       # tail fin
    thick(c, 12, y + 1, 10 + (2 if hop else 0), y + 4, 1.6, N["silt0"])   # front fins
    disc(c, 16.5, y - 4, 2.2, N["silt2"])
    c.set(17, y - 5, "white")
    c.set(18, y - 5, "ink")
    c.set(19, y - 1, "silt0")
    for x in range(7, 15, 3):
        c.set(x, y - 2, "silt0")
    return done(c)


def bat(frame):
    c = Canvas(24, 16)
    if frame == 0:
        # hanging, wings wrapped
        c.ellipse(12, 8, 4, 6, "violet1")
        thick(c, 12, 1, 12, 3, 1.2, N["stone1"])
        c.set(11, 11, "red3")
        c.set(13, 11, "red3")
        thick(c, 9, 4, 8, 12, 1.6, N["violet0"])
        thick(c, 15, 4, 16, 12, 1.6, N["violet0"])
        return done(c)
    up = frame == 1
    c.ellipse(12, 9, 3.5, 3, "violet1")
    for s in (-1, 1):
        tip = (12 + s * 11, 3 if up else 13)
        mid = (12 + s * 6, 5 if up else 11)
        thick(c, 12 + s * 2, 8, mid[0], mid[1], 2.4, N["violet0"])
        thick(c, mid[0], mid[1], tip[0], tip[1], 1.8, N["violet0"])
        for k in range(3):
            c.set(int(mid[0] + s * k * 2), int(mid[1] + (1 if up else -1) * (2 + k)), N["violet2"])
    c.set(11, 8, "red3")
    c.set(13, 8, "red3")
    c.set(10, 6, "violet2")
    c.set(14, 6, "violet2")
    return done(c)


def crab(frame):
    c = Canvas(32, 20)
    c.ellipse(16, 12, 10, 5, "red2")
    c.ellipse(16, 11, 8, 3, "red3")
    for x in range(8, 25, 4):
        c.set(x, 14, "red1")
    for i, s in enumerate((-1, 1)):
        for k in range(3):
            lift = (frame + k + i) % 2
            x0 = 16 + s * (5 + k * 3)
            thick(c, x0, 15, x0 + s * 3, 19 - lift, 1.4, N["red1"])
    # the armoured front claw (it faces right) and the small back claw
    thick(c, 24, 11, 28, 8, 2.4, N["red1"])
    disc(c, 29, 7, 2.6, N["stone3"])
    c.set(31, 6, "stone4")
    thick(c, 8, 11, 5, 9, 1.6, N["red1"])
    disc(c, 4, 8, 1.8, N["red2"])
    c.set(18, 6, "ink")
    c.set(21, 6, "ink")
    thick(c, 18, 7, 18, 9, 1, N["red1"])
    thick(c, 21, 7, 21, 9, 1, N["red1"])
    return done(c)


def gull(frame):
    c = Canvas(32, 20)
    up = frame == 0
    c.ellipse(16, 12, 7, 3, "white")
    c.ellipse(15, 13, 5, 2, "stone4")
    disc(c, 23, 10, 2.6, "white" if False else N["white"])
    thick(c, 25, 10, 29, 11, 1.6, N["orange1"])
    c.set(24, 9, "ink")
    thick(c, 9, 12, 5, 11, 2, N["stone3"])
    for s in (0,):
        tip = (8, 2) if up else (7, 19)
        thick(c, 17, 11, 12, 6 if up else 16, 2.8, N["stone3"])
        thick(c, 12, 6 if up else 16, tip[0], tip[1], 2.0, N["stone2"])
        c.set(tip[0], tip[1], N["ink"])
    return done(c)


def wisp(frame):
    c = Canvas(16, 16)
    r = 4.5 if frame == 0 else 5.2
    disc(c, 8, 8, r + 1.5, N["sea1"])
    disc(c, 8, 8, r, N["sea2"])
    disc(c, 8, 7, r - 2, N["sea3"])
    disc(c, 8, 7, 1.5, N["white"])
    thick(c, 8, 12, 6 + frame * 3, 15, 1.6, N["sea1"])
    return done(c, False)


def golem(frame):
    c = Canvas(40, 44)
    slam = frame == 3
    wind = frame == 2
    step = frame == 1
    base = 43
    # legs
    for s, off in ((-1, step), (1, not step and frame == 0)):
        x = 20 + s * 6
        c.rect(x - 3, base - 12 + (2 if off else 0), x + 3, base, "silt0")
    # body block
    top = base - 34 + (4 if slam else 0) - (3 if wind else 0)
    c.rect(9, top + 8, 31, base - 11, "silt1")
    c.rect(11, top + 9, 29, top + 13, "silt2")
    for (x, y) in ((13, top + 17), (24, top + 21), (18, top + 25), (27, top + 14)):
        c.set(x, y, "silt0")
        c.set(x + 1, y, "silt0")
    # head
    c.rect(15, top, 25, top + 8, "silt1")
    c.rect(17, top + 3, 19, top + 4, "orange1")
    c.rect(22, top + 3, 24, top + 4, "orange1")
    # arms
    ay = top + 10
    if wind:
        for s in (-1, 1):
            thick(c, 20 + s * 11, ay, 20 + s * 8, top - 4, 5, N["silt0"])
    elif slam:
        for s in (-1, 1):
            thick(c, 20 + s * 11, ay, 20 + s * 15, base - 2, 5, N["silt0"])
    else:
        for s in (-1, 1):
            thick(c, 20 + s * 11, ay, 20 + s * 12, ay + 14, 5, N["silt0"])
    return done(c)


def hullbreaker(frame):
    c = Canvas(64, 40)
    rest = frame == 4
    charge = frame in (2, 3)
    lift = frame % 2
    by = 24 if not rest else 29
    for s in (-1, 1):
        for k in range(3):
            x0 = 32 + s * (10 + k * 7)
            up = (k + lift) % 2 and not rest
            thick(c, x0, by + 4, x0 + s * 5, 39 - (2 if up else 0), 2.6, N["stone1"])
    if rest:
        # flipped open: the soft belly shows
        c.ellipse(32, by, 20, 9, "stone2")
        c.ellipse(32, by + 1, 14, 6, "pink")
        for x in range(22, 43, 4):
            c.set(x, by + 1, "red3")
    else:
        c.ellipse(32, by, 21, 11, "stone2")
        c.ellipse(32, by - 3, 17, 6, "stone3")
        for x in range(16, 49, 6):
            thick(c, x, by - 8, x + 2, by + 6, 1.2, N["stone1"])
        # iron plating and rivets
        c.rect(20, by - 11, 44, by - 10, "stone1")
        for x in range(22, 44, 5):
            c.set(x, by - 10, "stone4")
    # claws: big hammers in front
    cl = 8 if charge else 0
    thick(c, 50, by - 2, 56 + cl // 2, by - 8, 4, N["stone1"])
    disc(c, 58 + cl // 2, by - 10, 5, N["stone3"])
    c.set(60 + cl // 2, by - 13, "white")
    if not rest:
        c.set(38, by - 12, "orange1")
        c.set(42, by - 12, "orange1")
    return done(c)


def oldgrey(frame):
    c = Canvas(64, 40)
    dive = frame == 3
    wing = [0, 1, 2, 1][frame]
    if dive:
        c.ellipse(32, 20, 10, 5, "stone3")
        thick(c, 26, 18, 10, 6, 4, N["stone2"])
        thick(c, 26, 22, 12, 34, 4, N["stone2"])
        disc(c, 42, 21, 5, N["stone4"])
        thick(c, 46, 22, 56, 26, 2.4, N["orange0"])
        c.set(44, 19, "red2")
        return done(c)
    c.ellipse(32, 24, 12, 6, "stone4")
    c.ellipse(31, 26, 9, 3, "white")
    wy = [8, 20, 34][wing]
    for s in (-1, 1):
        mid = (32 + s * 14, (24 + wy) // 2)
        tip = (32 + s * 30, wy)
        thick(c, 32 + s * 4, 22, mid[0], mid[1], 5, N["stone3"])
        thick(c, mid[0], mid[1], tip[0], tip[1], 3.2, N["stone2"])
        for k in range(4):
            q = pt(mid[0], mid[1], (s * 90) + (180 if wy < 24 else 0), 2 + k)
            c.set(int(q[0] + s * k * 3), int(q[1] + 2), N["stone1"])
    disc(c, 45, 21, 5, N["white"])
    thick(c, 49, 22, 57, 25, 2.6, N["orange0"])
    c.set(58, 26, "red1")
    c.set(47, 19, "ink")
    thick(c, 20, 25, 13, 27, 3, N["stone2"])
    return done(c)


def warden(frame):
    c = Canvas(40, 48)
    cast = frame == 2
    sway = frame
    # a hollow bell-shaped robe, drifting
    for y in range(12, 46):
        t = (y - 12) / 34
        half = 6 + t * 10
        for x in range(int(20 - half), int(20 + half) + 1):
            if y > 42 and (x + sway + y) % 5 == 0:
                continue
            c.set(x, y, "night2" if abs(x - 20) < half - 2 else "night1")
    c.rect(14, 18, 26, 19, "gold1")
    disc(c, 20, 9, 6, N["night1"])
    disc(c, 20, 10, 4, N["ink"])
    c.set(18, 10, "sea3")
    c.set(22, 10, "sea3")
    if cast:
        for s in (-1, 1):
            thick(c, 20 + s * 8, 22, 20 + s * 17, 12, 3, N["night2"])
            disc(c, 20 + s * 18, 11, 3, N["sea3"])
    else:
        for s in (-1, 1):
            thick(c, 20 + s * 8, 22, 20 + s * 11, 32 + sway, 3, N["night2"])
    # the clapper, like a bell's
    disc(c, 20, 44, 2.2, N["gold2"])
    return done(c)


# ------------------------------------------------------------------ things
def chest():
    c = Canvas(20, 16)
    c.rect(2, 6, 17, 15, "wood2")
    c.rect(2, 3, 17, 7, "wood3")
    c.rect(2, 7, 17, 7, "wood1")
    c.rect(2, 11, 17, 11, "wood1")
    c.rect(9, 6, 10, 9, "gold2")
    for x in (2, 17):
        c.rect(x, 3, x, 15, "gold0")
    return done(c)


def post(frame):
    c = Canvas(16, 40)
    c.rect(7, 8, 9, 39, "wood1")
    c.rect(6, 36, 10, 39, "wood0")
    c.rect(4, 6, 12, 7, "wood2")
    lit = frame > 0
    c.rect(5, 0, 11, 6, "stone1")
    c.rect(6, 1, 10, 5, "orange1" if lit else "night1")
    if lit:
        c.rect(7, 2, 9, 4, "gold2" if frame == 1 else "white")
    return done(c)


def item(name):
    c = Canvas(16, 16)
    if name == "coin":
        disc(c, 8, 8, 5, N["gold1"])
        disc(c, 8, 8, 3.4, N["gold2"])
        c.rect(7, 6, 8, 10, "gold0")
    elif name == "gem":
        for y in range(3, 14):
            w = 6 - abs(y - 7) if y <= 7 else 6 - (y - 7)
            for x in range(8 - w, 8 + w):
                c.set(x, y, "sea3" if x < 8 else "sea2")
        c.set(6, 5, "white")
    elif name == "key":
        disc(c, 5, 6, 3.4, N["gold1"])
        disc(c, 5, 6, 1.4, N["ink"])
        c.rect(8, 5, 14, 7, "gold1")
        c.rect(12, 8, 13, 10, "gold1")
        c.rect(10, 8, 10, 9, "gold1")
    elif name == "tonic":
        disc(c, 8, 10, 4.4, N["red2"])
        disc(c, 7, 9, 1.6, N["red3"])
        c.rect(7, 2, 9, 6, "leaf3")
        c.rect(6, 1, 10, 2, "wood2")
    elif name == "heartroot":
        disc(c, 6, 7, 3.2, N["pink"])
        disc(c, 10, 7, 3.2, N["pink"])
        for y in range(8, 14):
            for x in range(3 + (y - 8), 14 - (y - 8)):
                c.set(x, y, "red2")
        thick(c, 8, 13, 5, 15, 1.2, N["wood2"])
        thick(c, 8, 13, 11, 15, 1.2, N["wood2"])
    elif name == "knives":
        for k, x in enumerate((4, 8, 12)):
            thick(c, x, 13, x + 1, 3, 1.6, N["stone4"])
            c.rect(x - 1, 11, x + 1, 13, "wood1")
    elif name == "feather":
        thick(c, 4, 14, 12, 2, 1.2, N["stone2"])
        for k in range(8):
            q = (4 + k, 13 - k * 1.4)
            thick(c, q[0], q[1], q[0] - 2, q[1] - 2.5, 1.2, N["white"])
            thick(c, q[0], q[1], q[0] + 2.5, q[1] + 1.5, 1.2, N["stone4"])
    elif name == "squall":
        for r, col in ((6, "blue2"), (4, "blue3"), (2, "white")):
            for a in range(0, 360, 20):
                q = pt(8, 8, a + r * 30, r)
                c.set(int(q[0]), int(q[1]), N[col])
    elif name == "stoneskin":
        disc(c, 8, 9, 5, N["stone2"])
        disc(c, 7, 8, 3, N["stone3"])
        c.rect(6, 2, 10, 4, "stone1")
    elif name == "fury":
        for y in range(4, 14):
            w = (y - 3) // 2
            for x in range(8 - w, 9 + w):
                c.set(x, y, "orange1" if (x + y) % 3 else "red2")
        c.rect(7, 2, 9, 3, "gold2")
    elif name == "life":
        # the gull-bone charm
        thick(c, 3, 12, 13, 4, 2.2, N["white"])
        disc(c, 3, 13, 2, N["white"])
        disc(c, 13, 3, 2, N["white"])
        c.rect(6, 8, 10, 9, "red2")
    return done(c)


ITEMS = ["coin", "gem", "key", "tonic", "heartroot", "knives", "feather", "squall", "stoneskin", "fury", "life"]


def small(name, frame):
    if name == "knife":
        c = Canvas(12, 6)
        thick(c, 1, 3, 8, 3, 1.6, N["stone4"])
        c.rect(8, 2, 10, 4, "wood1")
        return done(c)
    if name == "bottle":
        c = Canvas(8, 8)
        if frame == 0:
            disc(c, 4, 4.5, 2.4, N["leaf3"])
            c.rect(3, 0, 4, 2, "wood2")
        else:
            thick(c, 1, 5, 6, 3, 3, N["leaf3"])
            c.set(7, 2, "wood2")
        return done(c)
    if name == "net":
        c = Canvas(16, 12)
        for x in range(1, 15):
            for y in range(1, 11):
                if (x + y) % 3 == 0 or (x - y) % 3 == 0:
                    c.set(x, y, "silt2")
        return done(c, False)
    if name == "bomb":
        c = Canvas(10, 10)
        disc(c, 5, 5.5, 3.6, N["gold1"])
        c.rect(4, 3 + frame, 6, 4 + frame, "gold2")
        c.set(6 + frame, 1, "orange1")
        return done(c)
    if name == "blast":
        c = Canvas(36, 30)
        r = [6, 11, 14][frame]
        disc(c, 18, 20, r, N["orange1"] if frame < 2 else N["silt1"])
        disc(c, 18, 20, r * 0.6, N["gold2"] if frame < 2 else N["silt2"])
        return done(c, False)
    if name == "feather":
        c = Canvas(8, 10)
        thick(c, 2, 9, 6, 1, 1.2, N["stone2"])
        thick(c, 3, 7, 1, 4, 1.2, N["white"])
        thick(c, 5, 4, 7, 6, 1.2, N["stone4"])
        return done(c)
    if name == "spark":
        c = Canvas(10, 10)
        disc(c, 5, 5, 3.5 + frame * 0.6, N["sea2"])
        disc(c, 5, 5, 2, N["white"])
        return done(c, False)
    if name == "shock":
        c = Canvas(14, 10)
        for x in range(1, 13):
            h = 3 + ((x + frame * 2) % 4)
            c.rect(x, 9 - h, x, 9, "silt2" if x % 2 else "silt1")
        return done(c)
    if name == "wave":
        c = Canvas(16, 26)
        for y in range(4, 26):
            w = 6 + (y - 4) // 3
            for x in range(8 - w // 2 + frame, 8 + w // 2 + frame):
                c.set(x, y, "silt1" if (x + y) % 4 else "silt0")
        for x in range(4, 14):
            c.set(x + frame, 4 + (x % 3), "silt2")
        return done(c)
    if name == "fx":
        c = Canvas(24, 24)
        r = [4, 7, 9, 10][frame]
        for a in range(0, 360, 45):
            q = pt(12, 12, a + frame * 20, r)
            disc(c, q[0], q[1], 3 - frame * 0.6, N["white"] if frame < 2 else N["stone3"])
        return done(c, False)
    if name == "gust":
        c = Canvas(48, 48)
        for k in range(3):
            for a in range(0, 360, 12):
                q = pt(24, 26, a + frame * 30 + k * 40, 10 + k * 6)
                if (a // 12 + k) % 3:
                    c.set(int(q[0]), int(q[1]), N["blue3"] if k else N["white"])
        return done(c, False)
    raise KeyError(name)


def build() -> list[str]:
    out = []
    out.append(save_sprite("mudskip", [mudskip(i) for i in range(3)]))
    out.append(save_sprite("bat", [bat(i) for i in range(3)]))
    out.append(save_sprite("crab", [crab(i) for i in range(2)]))
    out.append(save_sprite("gull", [gull(i) for i in range(2)]))
    out.append(save_sprite("wisp", [wisp(i) for i in range(2)]))
    out.append(save_sprite("golem", [golem(i) for i in range(4)]))
    out.append(save_sprite("hullbreaker", [hullbreaker(i) for i in range(5)]))
    out.append(save_sprite("oldgrey", [oldgrey(i) for i in range(4)]))
    out.append(save_sprite("warden", [warden(i) for i in range(3)]))
    out.append(save_sprite("chest", [chest()]))
    out.append(save_sprite("post", [post(i) for i in range(3)]))
    out.append(save_sprite("items", [item(n) for n in ITEMS]))
    for name, n in (("knife", 1), ("bottle", 2), ("net", 1), ("bomb", 2), ("blast", 3), ("feather", 1),
                    ("spark", 2), ("shock", 2), ("wave", 2), ("fx", 4), ("gust", 2)):
        out.append(save_sprite(name, [small(name, i) for i in range(n)]))
    return out


if __name__ == "__main__":
    for path in build():
        print(path)
