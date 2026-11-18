"""Pickups, props and traps for Vale of Shards, drawn in code.

    python3 pipeline/aseprite/art_items.py        # writes art/aseprite/<name>.aseprite

Frame sizes, counts and tag order come from pipeline/manifest.py (save_sprite asserts
them). Items and props carry a 1 px ink outline so they read on every backdrop; light
comes from the upper left.
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sheet import save_sprite  # noqa: E402
from canvas import Canvas  # noqa: E402
from palette import N  # noqa: E402
from art_tiles import ink, put, shade_disc, stamp  # noqa: E402

O = "ink"


def new(w, h):
    return Canvas(w, h)


def art(w, h, rows, cmap, ox=None, oy=None, outline=None, flip=False):
    """A w x h canvas with ASCII art centred (or at ox, oy) and an optional outline."""
    c = Canvas(w, h)
    aw = max(len(r) for r in rows)
    rows = [r.ljust(aw) for r in rows]
    if ox is None:
        ox = (w - aw) // 2
    if oy is None:
        oy = (h - len(rows)) // 2
    stamp(c, rows, cmap, ox, oy, flip)
    if outline:
        ink(c, outline)
    return c


def vflip(c: Canvas) -> Canvas:
    k = Canvas(c.w, c.h)
    for y in range(c.h):
        k.px[y * c.w:(y + 1) * c.w] = c.px[(c.h - 1 - y) * c.w:(c.h - y) * c.w]
    return k


def shift(c: Canvas, dx: int, dy: int) -> Canvas:
    k = Canvas(c.w, c.h)
    k.blit(c, dx, dy)
    return k


def recolor(c: Canvas, mapping: dict) -> Canvas:
    k = c.copy()
    m = {N[a]: N[b] for a, b in mapping.items()}
    k.px = [m.get(p, p) if p is not None else None for p in k.px]
    return k


METAL = {"o": O, "W": "white", "H": "stone4", "h": "stone3", "m": "stone2", "l": "stone1", "d": "stone0"}
WOOD = {"o": O, "W": "wood4", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1", "d": "wood0"}
KEYCOL = {
    "amber": ("gold2", "gold1", "gold0", "fire4"),
    "moss": ("moss4", "moss3", "moss1", "moss2"),
    "rose": ("berry2", "berry1", "berry0", "dawn1"),
    "sky": ("water4", "water3", "water1", "water2"),
}

# ----------------------------------------------------------------------------- traps


def masher():
    head = [
        "oooooooooooooooooooooooo",
        "oHHHHHHHHHHHHHHHHHHHHHho",
        "oHhWhhhhhhhhhhhhhhhhWhlo",
        "ohhhhhhhhhhhhhhhhhhhhhlo",
        "ommmmmmmmmmmmmmmmmmmmmlo",
        "oooooooooooooooooooooooo",
        "oHlooHlooHlooHlooHlooHlo",
        " oo  oo  oo  oo  oo  oo ",
    ]
    frames = []
    for L in (4, 12, 20):
        c = new(24, 20)
        top = L - len(head)
        for y in range(0, max(0, top)):
            stamp(c, ["oHhhhhlo"], METAL, 8, y)
            if y % 4 == 1:
                stamp(c, ["olllllll"], {"o": O, "l": "stone1"}, 8, y)
        stamp(c, head, METAL, 0, top)
        frames.append(c)
    return frames


def spear():
    headrows = [
        "   oo   ",
        "  oWlo  ",
        "  oWlo  ",
        " oWHmlo ",
        " oWHmlo ",
        "  oooo  ",
    ]
    ups = []
    for L in (7, 13, 20):
        c = new(8, 20)
        top = 20 - L
        stamp(c, headrows, METAL, 0, top)
        for y in range(top + 6, 20):
            stamp(c, ["  oHlo  "], {"o": O, "H": "wood3", "l": "wood1"}, 0, y)
        ups.append(c)
    return ups + [vflip(c) for c in ups]


def spikes_trap():
    """Six steel spikes that rise out of a base plate: frame = extension 0..3."""
    full = new(24, 12)
    for i in range(4):
        cx = 6 * i + 3
        for k in range(11):
            y = 11 - k
            hw = 2.6 * (1 - k / 11.0)
            for x in range(cx - 3, cx + 3):
                if abs(x + 0.5 - cx) <= hw:
                    put(full, x, y, "stone4" if x < cx - 1 else ("stone3" if x == cx - 1 else "stone1"))
        put(full, cx - 1, 1, "white")
        put(full, cx - 1, 2, "white")
    ups = []
    for ext in range(4):
        c = new(24, 16)
        show = [2, 5, 8, 11][ext]
        part = new(24, 12)
        part.blit(full, 0, 0)
        c.blit(part, 0, 13 - 12 + (11 - show))
        # hide what is still inside the plate
        for y in range(13, 16):
            for x in range(24):
                put(c, x, y, None)
        c.outline(N[O])
        stamp(c, ["oooooooooooooooooooooooo", "oHHhhhhhhhhhhhhhhhhhhhlo", "oooooooooooooooooooooooo"],
              METAL, 0, 13)
        for x in (4, 12, 20):
            put(c, x, 14, "white")
        ups.append(c)
    return ups + [vflip(c) for c in ups]


def poker():
    base = ["oooooooooooo", "oHhhhhhhhhlo", "ollllllllllo", "oooooooooooo"]
    rest = new(16, 16)
    stamp(rest, ["  oo  oo  ", "  oW  oW  "], {"o": O, "W": "white"}, 3, 10)
    stamp(rest, base, METAL, 2, 12)
    stab = new(16, 16)
    prong = ["o", "W", "W", "H", "H", "H", "h", "h", "h", "h", "h", "h"]
    for i, (x, top) in enumerate(((4, 3), (7, 0), (10, 3))):
        for k, ch in enumerate(prong[: 12 - top]):
            put(stab, x, top + k, {"o": O, "W": "white", "H": "stone4", "h": "stone3"}[ch])
            put(stab, x + 1, top + k + 1, "stone1")
    ink(stab, O)
    stamp(stab, base, METAL, 2, 12)
    return [rest, stab]


def dart():
    right = new(12, 4)
    stamp(right, [
        "rr      o   ",
        "RrWHHHHHHWo ",
        "Rrllllllllmo",
        "rr      o   ",
    ], {"r": "berry1", "R": "berry2", "W": "wood4", "H": "wood3", "l": "wood1", "o": O, "m": "stone3"}, 0, 0)
    stamp(right, ["WW", "mm"], {"W": "white", "m": "stone2"}, 9, 1)
    return [right.flip_h(), right]


def _flame(w, h, frame, tongues, base_y, scale=1.0):
    c = Canvas(w, h)
    for y in range(h):
        for x in range(w):
            heat = 0.0
            for (cx, hh, ph, hw0) in tongues:
                up = base_y - y
                H = hh * scale * (0.85 + 0.15 * math.sin(frame * 2.1 + ph))
                if up < 0 or up > H:
                    continue
                sway = 1.4 * math.sin(up * 0.45 - frame * 1.6 + ph) * (up / H)
                hw = hw0 * (1 - (up / H) ** 1.3) + 0.4
                d = abs(x + 0.5 - (cx + sway))
                if d < hw:
                    v = (1 - d / hw) * (1 - 0.7 * up / H)
                    heat = max(heat, v)
            if heat > 0.62:
                col = "fire5"
            elif heat > 0.42:
                col = "fire4"
            elif heat > 0.22:
                col = "fire3"
            elif heat > 0.04:
                col = "fire2"
            else:
                continue
            put(c, x, y, col)
    return c


def fire():
    burn = []
    for f in range(6):
        c = _flame(16, 32, f, [(8, 26, 0.0, 6.0), (5, 17, 1.7, 3.5), (11, 20, 3.1, 3.5)], 31)
        # embers drifting up
        for (ex, ey) in ((4 + f % 3, 6 - f), (11 - f % 2, 12 - 2 * f % 9)):
            if 0 <= ey < 32:
                put(c, ex, ey % 32, "fire4")
        for x in range(2, 14):
            if c.get(x, 31) is None:
                put(c, x, 31, "fire2")
        burn.append(c)
    drip = []
    shapes = [
        (0, [" oo ", "oYYo", " oo "]),
        (0, [" oYo ", "oYWYo", "oYYYo", " ooo "]),
        (0, ["  oYo  ", " oYWYo ", " oYYYo ", " oYYYo ", "  oYo  ", "   o   "]),
        (4, ["  o  ", " oYo ", " oYo ", "oYWYo", "oYYYo", "oyYyo", " ooo "]),
        (10, ["  y  ", "  y  ", "  o  ", " oYo ", "oYWYo", "oYYYo", "oyYyo", " ooo "]),
        (24, ["y  o  y", " o oYo ", "oYoYYo ", "yyoYYoy", " ooooo "]),
    ]
    for (top, rows) in shapes:
        c = new(16, 32)
        stamp(c, rows, {"o": "fire2", "Y": "fire4", "W": "fire5", "y": "fire3"},
              (16 - max(len(r) for r in rows)) // 2, top)
        drip.append(c)
    return burn + drip


def stalactite():
    rows = [
        "oooooooooooooo",
        "oHHhhhhhhhmmlo",
        " oHhhhhhhmmlo ",
        "  oHhhhhmmlo  ",
        "  oHhhhhmlo   ",
        "   oHhhmmlo   ",
        "   oHhhmlo    ",
        "    oHhmlo    ",
        "    oHhlo     ",
        "     oHlo     ",
        "     oHo      ",
        "      oo      ",
        "      o       ",
    ]
    return [art(16, 16, rows, METAL, oy=0)]


def spring():
    frames = []
    for coil_h in (8, 5, 2):
        c = new(32, 16)
        base_y = 13
        top_y = base_y - coil_h - 3
        stamp(c, ["oooooooooooooooooooooooo", "oHhhhhhhhhhhhhhhhhhhhhlo", "oooooooooooooooooooooooo"],
              METAL, 4, base_y)
        for k in range(coil_h):
            y = base_y - 1 - k
            ph = k % 2
            row = "oHhhhhhhhhhhhhlo" if ph == 0 else " olllllllllllll "
            stamp(c, [row], METAL, 8, y)
        stamp(c, [" oooooooooooooooooooooo ", "oRRRRRRRRRRRRRRRRRRRRRRo", "orrrrrrrrrrrrrrrrrrrrrdo",
                  " oooooooooooooooooooooo "],
              {"o": O, "R": "fire4", "r": "fire3", "d": "fire2"}, 4, top_y)
        put(c, 6, top_y + 1, "fire5")
        frames.append(c)
    return frames


def platform():
    frames = []
    for f in range(4):
        c = new(32, 8)
        stamp(c, [
            " oooooooooooooooooooooooooooo ",
            "oGGGGGGGGGGGGGGGGGGGGGGGGGGgo",
            "oHhhhhhhWhhhhhhhhhhhhWhhhhhhlo",
            "ommmmmmmmmmmmmmmmmmmmmmmmmmmlo",
            " oooooooooooooooooooooooooooo ",
            "     oSso          oSso     ",
            "      oo            oo      ",
        ], {"o": O, "G": "gold2", "g": "gold1", "H": "stone4", "h": "stone3", "m": "stone2", "l": "stone1",
            "W": "white", "S": "shard3", "s": "shard1"}, 1, 0)
        gx = 5 + f * 7
        for i in range(2):
            put(c, gx + i, 2, "white")
            put(c, gx + i + 1, 1, "white")
        frames.append(c)
    return frames


def lift():
    c = new(32, 16)
    stamp(c, [
        "oooooooooooooooooooooooooooooooo",
        "oHHHHHHHHHHHHHooHHHHHHHHHHHHHHlo",
        "oooooooooooooWWooooooooooooooooo",
        "oHo          oo             oHlo",
        "oHo                         oHlo",
        "oHo  o  o  o  o  o  o  o  o oHlo",
        "oHo  o  o  o  o  o  o  o  o oHlo",
        "oHo  o  o  o  o  o  o  o  o oHlo",
        "oHo  o  o  o  o  o  o  o  o oHlo",
        "oHo                         oHlo",
        "oooooooooooooooooooooooooooooooo",
        "oGGGGGGGGGGGGGGGGGGGGGGGGGGGGGgo",
        "ommmmmmmmmmmmmmmmmmmmmmmmmmmmmlo",
        "omWmmmmmmmmmmmmmmmmmmmmmmmmmWmlo",
        "ollllllllllllllllllllllllllllllo",
        "oooooooooooooooooooooooooooooooo",
    ], {"o": O, "H": "stone4", "h": "stone3", "m": "stone2", "l": "stone1", "W": "white", "G": "gold2",
        "g": "gold1"}, 0, 0)
    # the mesh bars are thin grey rods
    for y in range(5, 9):
        for x in range(5, 27, 3):
            put(c, x, y, "stone2")
    return [c]


def door():
    frames = []
    for key in ("amber", "moss", "rose", "sky"):
        hi, mid, lo, acc = KEYCOL[key]
        c = new(16, 48)
        # arched frame
        for y in range(48):
            for x in range(16):
                dx = x + 0.5 - 8
                top = 8 - math.sqrt(max(0.0, 64 - dx * dx)) if y < 8 else 0
                if y >= top:
                    plank = x // 4
                    col = ["wood3", "wood2", "wood3", "wood2"][plank]
                    if x % 4 == 0:
                        col = "wood1"
                    if x % 4 == 1 and y % 9 == 3:
                        col = "wood1"
                    put(c, x, y, col)
        for y in range(8, 48):
            put(c, 1, y, "wood4") if c.get(1, y) is not None else None
        for band in (10, 36):
            for x in range(16):
                if c.get(x, band) is not None:
                    put(c, x, band, "stone3")
                    put(c, x, band + 1, "stone1")
            for x in (2, 13):
                put(c, x, band, "white")
        # lock plate
        stamp(c, [
            "oooooooo",
            "oHHHHHmo",
            "oHmoomlo",
            "oHmoomlo",
            "oHmmomlo",
            "oHmmomlo",
            "oHmmmmlo",
            "oollllloo",
            " oooooo ",
        ], {"o": O, "H": hi, "m": mid, "l": lo}, 4, 20)
        put(c, 5, 21, "white")
        # ring handle
        stamp(c, [" oo ", "o  o", " oo "], {"o": "stone3"}, 10, 30)
        ink(c, O)
        # keep the outline inside the 16 px width: redraw the side edges
        for y in range(48):
            if c.get(0, y) is not None:
                put(c, 0, y, O)
            if c.get(15, y) is not None:
                put(c, 15, y, O)
        for x in range(16):
            if c.get(x, 47) is not None:
                put(c, x, 47, O)
        frames.append(c)
    return frames


def switch():
    up = new(16, 16)
    down = new(16, 16)
    for c, lean in ((up, -1), (down, 1)):
        for k in range(8):
            x = 7 + lean * (k // 2)
            y = 11 - k
            put(c, x, y, "stone3")
            put(c, x + 1, y, "stone1")
        kx = 7 + lean * 4
        shade_disc(c, kx + 0.5, 3.5, 2.2, "berry2", "berry1", "berry0")
        put(c, kx - 1 + (0 if lean < 0 else 0), 2, "white")
        ink(c, O)
        stamp(c, ["  oooooooo  ", " oHhhhhhhhlo", "oHhhWhhhhhllo", "oooooooooooo"],
              METAL, 2, 12)
    return [up, down]


def button():
    frames = []
    for pressed in (False, True):
        c = new(16, 8)
        top = 5 if pressed else 2
        stamp(c, [" oooooooooo ", "oRRRRRRRRrro", "orrrrrrrrrdo"][: (3 if not pressed else 2)],
              {"o": O, "R": "fire4", "r": "fire3", "d": "fire2"}, 2, top - (0 if not pressed else 1))
        stamp(c, ["oooooooooooooooo", "oHhhhhhhhhhhhhlo", "oooooooooooooooo"], METAL, 0, 5)
        if pressed:
            stamp(c, ["oRRRRRRRRrro"], {"o": O, "R": "fire3", "r": "fire2"}, 2, 4)
        frames.append(c)
    return frames


def pad():
    frames = []
    ramps = [("shard0", "shard1"), ("shard1", "shard2"), ("shard2", "shard3"), ("shard1", "shard2")]
    for f in range(4):
        dim, lit = ramps[f]
        c = new(16, 16)
        stamp(c, [
            " oooooooooooooo ",
            "oHhhhhhhhhhhhhlo",
            "ohhrrhhhhhhrrhlo",
            "ommmrrrrrrrrmmlo",
            "ollllllllllllllo",
            "oooooooooooooooo",
        ], {"o": O, "H": "stone4", "h": "stone3", "m": "stone2", "l": "stone1", "r": lit}, 0, 10)
        # light rising from the rune
        for (x, y0) in ((4, 8), (8, 6), (11, 7)):
            yy = y0 - (f % 2)
            if f in (1, 2):
                put(c, x, yy, lit)
                put(c, x, yy + 1, dim)
            else:
                put(c, x, yy + 1, dim)
        if f == 2:
            put(c, 8, 3, "white")
        frames.append(c)
    return frames


def crate():
    kinds = []
    base = [
        "oooooooooooooooo",
        "oHHHHHHHHHHHHHho",
        "oHmmmmmmmmmmmmlo",
        "oHmhhhhhhhhhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhmmmmmmmhmmlo",
        "oHmhhhhhhhhhmmlo",
        "oHmmmmmmmmmmmmlo",
        "oHllllllllllllko",
        "ollllllllllllllo",
        "oooooooooooooooo",
    ]
    wood = {"o": O, "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1", "k": "wood0"}
    # 0: plain crate with a diagonal brace
    c = art(16, 16, base, wood, 0, 0)
    for i in range(7):
        put(c, 4 + i, 10 - i, "wood3")
        put(c, 5 + i, 10 - i, "wood1")
    kinds.append(c)
    # 1: iron-cornered crate
    c = art(16, 16, base, wood, 0, 0)
    for (x, y) in ((1, 1), (11, 1), (1, 11), (11, 11)):
        stamp(c, ["HHhh", "Hhhl", "hhll", "hlll"][:4], {"H": "stone4", "h": "stone3", "l": "stone1"}, x + (1 if x > 1 else 0), y + (1 if y > 1 else 0))
    for (x, y) in ((3, 3), (12, 3), (3, 12), (12, 12)):
        put(c, x, y, "white")
    kinds.append(c)
    # 2: marked with a shard sign (holds a bonus)
    c = art(16, 16, base, wood, 0, 0)
    stamp(c, ["  a  ", " aWb ", "aabbc", " abc ", "  c  "], {"a": "shard3", "W": "white", "b": "shard2",
                                                           "c": "shard1"}, 5, 5)
    kinds.append(c)
    # 3: heavy iron-banded chest-crate
    c = art(16, 16, base, {"o": O, "H": "wood3", "h": "wood2", "m": "wood1", "l": "wood0", "k": "ink"}, 0, 0)
    for y in (4, 11):
        for x in range(1, 15):
            put(c, x, y, "stone3" if x < 14 else "stone1")
            put(c, x, y + 1, "stone1")
    for x in (3, 12):
        put(c, x, 4, "white")
        put(c, x, 11, "white")
    kinds.append(c)
    return kinds


def torch():
    frames = []
    for f in range(4):
        c = new(16, 24)
        fl = _flame(16, 14, f, [(8, 12, 0.0, 3.6), (7, 8, 2.0, 2.2)], 13)
        c.blit(fl, 0, 0)
        stamp(c, [
            " oooooooo ",
            " oHhhhhlo ",
            "  oHhhlo  ",
            "  oHhhlo  ",
            "   oHlo   ",
            "   oHlo   ",
            "   oHlo   ",
            "   oHlo   ",
            "  oooooo  ",
            " oHhhhhlo ",
            " oooooooo ",
        ], {"o": O, "H": "wood4", "h": "wood3", "l": "wood1"}, 3, 13)
        for x in range(4, 12):
            put(c, x, 14, "stone3" if x < 11 else "stone1")
        frames.append(c)
    return frames


def portal():
    frames = []
    for f in range(4):
        c = new(32, 48)
        # swirl inside the arch
        cx, cy = 16, 24
        for y in range(4, 47):
            for x in range(6, 26):
                dx, dy = x + 0.5 - cx, (y + 0.5 - cy) * 0.55
                inside = (y >= 14 and 6 <= x < 26) or math.hypot(x + 0.5 - 16, y + 0.5 - 14) < 10
                if not inside:
                    continue
                r = math.hypot(dx, dy)
                a = math.atan2(dy, dx)
                band = (a * 2 + r * 0.55 - f * math.pi / 2) % (2 * math.pi)
                if r < 1.5:
                    col = "white"
                elif band < 1.0:
                    col = "shard3" if r < 6 else "shard2"
                elif band < 2.4:
                    col = "shard1"
                elif band < 4.2:
                    col = "violet1"
                else:
                    col = "violet0" if r > 6 else "shard0"
                put(c, x, y, col)
        # stone arch
        for y in range(48):
            for x in range(32):
                dx = x + 0.5 - 16
                if y < 14:
                    r = math.hypot(dx, y + 0.5 - 14)
                    if 10 <= r < 15.5:
                        k = (dx + (y - 14)) / 15
                        put(c, x, y, "stone4" if k < -0.6 else ("stone3" if k < 0 else "stone2"))
                    if 15.5 <= r < 16.5 or 9 <= r < 10:
                        put(c, x, y, O)
                else:
                    if 1 <= x <= 5 or 26 <= x <= 30:
                        col = "stone3" if x in (2, 3, 27, 28) else ("stone4" if x in (1, 26) else "stone2")
                        if y % 8 == 5:
                            col = "stone1"
                        put(c, x, y, col)
                    if x in (0, 6, 25, 31):
                        put(c, x, y, O)
        # keystone crystal
        stamp(c, ["  o  ", " oWo ", "oWSso", " oso ", "  o  "], {"o": O, "W": "white", "S": "shard3",
                                                               "s": "shard1"}, 14, 0)
        for x in range(32):
            put(c, x, 47, O)
        frames.append(c)
    return frames


def signpost():
    return [art(16, 16, [
        "ooooooooooooo  ",
        "oHhhhhhhhhhhhoo",
        "ohhhWWWWWhhhhlo",
        "ohhhhhhhhhhhhoo",
        "ollllllllllloo ",
        "oooooooooooo   ",
        "     oHlo      ",
        "     oHlo      ",
        "     oHlo      ",
        "     oHlo      ",
        "    ooHloo     ",
        "   oggoogggo   ",
    ], {"o": O, "H": "wood4", "h": "wood3", "l": "wood1", "W": "wood1", "g": "moss3"}, 0, 3)]


# ----------------------------------------------------------------------------- pickups


def shard():
    rows = [
        "   o   ",
        "  oWo  ",
        " oWSso ",
        " oWSso ",
        "oWSSsso",
        "oSSSsdo",
        " oSsdo ",
        " oSsdo ",
        "  odo  ",
        "   o   ",
    ]
    cmap = {"o": "shard0", "W": "white", "S": "shard3", "s": "shard2", "d": "shard1"}
    frames = []
    for f in range(3):
        c = art(16, 12, rows, cmap, 4, 1)
        ink(c, O)
        if f == 1:
            stamp(c, [" w ", "wWw", " w "], {"w": "shard3", "W": "white"}, 10, 0)
        if f == 2:
            put(c, 11, 1, "white")
            stamp(c, ["w", "W", "w"], {"w": "shard2", "W": "white"}, 3, 8)
        frames.append(c)
    return frames


def heart():
    rows = [
        " oo  oo ",
        "oWRooRRo",
        "oWRRRRrd",
        "oRRRRRrd",
        " oRRRrd ",
        "  oRrd  ",
        "   od   ",
    ]
    big = [
        " ooo  ooo ",
        "oWWRooRRRo",
        "oWRRRRRRro",
        "oRRRRRRRro",
        "oRRRRRRrro",
        " oRRRRrro ",
        "  oRRrro  ",
        "   oRro   ",
        "    oo    ",
    ]
    cmap = {"o": O, "W": "berry2", "R": "fire2", "r": "fire1", "d": O}
    f0 = art(16, 16, big, cmap, 3, 3)
    put(f0, 5, 5, "white")
    f1 = art(16, 16, [
        " oooo  oooo ",
        "oWWRRooRRRRo",
        "oWRRRRRRRRro",
        "oRRRRRRRRRro",
        "oRRRRRRRRrro",
        " oRRRRRRrro ",
        "  oRRRRrro  ",
        "   oRRrro   ",
        "    oRro    ",
        "     oo     ",
    ], cmap, 2, 3)
    put(f1, 4, 5, "white")
    f2 = f0.copy()
    put(f2, 6, 4, "white")
    return [f0, f1, f2]


def berry():
    out = []
    # sunberry: a round golden berry with a leaf
    c = new(16, 16)
    shade_disc(c, 8, 9, 4.6, "gold2", "fire4", "fire3", "fire2")
    put(c, 6, 7, "white")
    stamp(c, ["  gG", " gGG", "l g "], {"g": "moss3", "G": "moss4", "l": "wood1"}, 7, 2)
    out.append(ink(c, O))
    # plum
    c = new(16, 16)
    shade_disc(c, 8, 9, 4.8, "violet3", "violet2", "violet1", "violet0")
    put(c, 6, 7, "water4")
    put(c, 8, 5, "violet0")
    stamp(c, [" l", "l ", "l "], {"l": "wood1"}, 8, 2)
    out.append(ink(c, O))
    # fig: a teardrop
    c = art(16, 16, [
        "   ll   ",
        "   oo   ",
        "  oBbo  ",
        " oBbbbo ",
        "oBWbbbdo",
        "oBbbbbdo",
        "oBbbbbdo",
        " oBbbdo ",
        "  oood  ",
    ], {"l": "moss2", "o": O, "B": "berry1", "b": "berry0", "d": "fire0", "W": "dawn1"}, 4, 3)
    put(c, 7, 11, "dawn1")
    out.append(c)
    # starfruit: a five-point star cross-section
    c = art(16, 16, [
        "     o     ",
        "    oYo    ",
        "    oYo    ",
        "ooooYWYoooo",
        "oYYYYYYYyyo",
        " oyYYyYYyo ",
        "  oYYYYyo  ",
        "  oYyoYyo  ",
        " oYyo oyyo ",
        " ooo   ooo ",
    ], {"o": O, "Y": "gold2", "y": "gold1", "W": "white"}, 2, 3)
    out.append(c)
    return out


def gem():
    out = []
    cuts = {
        "round": [
            "   oooo   ",
            "  oWHHho  ",
            " oWHhhhlo ",
            "oHHhhhhlmo",
            "ohhhhhhlmo",
            " ohhhllmo ",
            "  ollmmo  ",
            "   oooo   ",
        ],
        "square": [
            "oooooooo",
            "oWWHHHho",
            "oWHhhhlo",
            "oHhhhhlo",
            "oHhhhhlo",
            "oHhhhllo",
            "ohllllmo",
            "oooooooo",
        ],
        "tall": [
            "   oo   ",
            "  oWHo  ",
            " oWHhho ",
            "oWHhhhlo",
            "oHhhhhlo",
            "oHhhhllo",
            " ohhllo ",
            "  ollo  ",
            "   oo   ",
        ],
        "tri": [
            "oooooooooo",
            "oWWHHHhhlo",
            " oHhhhhlo ",
            "  ohhhlo  ",
            "   ohlo   ",
            "    oo    ",
        ],
    }
    sets = [("round", ("white", "fire3", "fire2", "fire1", "fire0")),
            ("square", ("white", "water3", "water2", "water1", "water0")),
            ("tall", ("white", "gold2", "gold1", "gold0", "fire0")),
            ("tri", ("white", "violet3", "violet2", "violet1", "violet0"))]
    for cut, (w, H, h, l, m) in sets:
        rows = cuts[cut]
        c = art(16, 16, rows, {"o": O, "W": w, "H": H, "h": h, "l": l, "m": m}, 2 + (12 - len(rows[0])) // 2,
                1 + (14 - len(rows)) // 2)
        out.append(c)
    return out


KEY_FACE = [
    "  oooo  ",
    " oHHhmo ",
    "oHhoohmo",
    "oHo  olo",
    "oHo  olo",
    "ohmoomlo",
    " omllmo ",
    "  oHlo  ",
    "  oHlo  ",
    "  oHlo  ",
    "  oHlo  ",
    "  oHlooo",
    "  oHHHho",
    "  oHlooo",
    "  oHlo  ",
    "  oHHho ",
    "  oHlooo",
    "  oooo  ",
]
KEY_SIDE = [
    " oooo ",
    "oHhhmo",
    "oHoomo",
    "oHoolo",
    "ohmmlo",
    " oHlo ",
    " oHlo ",
    " oHlo ",
    " oHlo ",
    " oHlo ",
    " oHloo",
    " oHHho",
    " oHloo",
    " oHlo ",
    " oHho ",
    " oHloo",
    " oooo ",
]
KEY_EDGE = [
    " oo ",
    "oHlo",
    "oHlo",
    "oHlo",
    "oHlo",
    " oo ",
    " oo ",
    " oo ",
    " oo ",
    " oo ",
    " oo ",
    "oHlo",
    " oo ",
    " oo ",
    "oHlo",
    " oo ",
    " oo ",
]


def _key_face(hi, mid, lo, width):
    """A vertical key: ring bow on top, shaft, two-tooth bit. width 3 face-on, 2 turned, 1 edge-on."""
    cmap = {"o": O, "H": hi, "h": mid, "m": mid, "l": lo}
    if width >= 3:
        c = art(16, 20, KEY_FACE, cmap, 4, 1)
        put(c, 6, 2, "white")
    elif width == 2:
        c = art(16, 20, KEY_SIDE, cmap, 5, 1)
        put(c, 6, 2, "white")
    else:
        c = art(16, 20, KEY_EDGE, {"o": O, "H": hi, "l": mid}, 6, 1)
        for y in range(7, 12):
            put(c, 7, y, hi)
            put(c, 8, y, lo)
        for y in (12, 13, 15, 16):
            put(c, 7, y, hi)
            put(c, 8, y, lo)
    return c


def key():
    frames = []
    for name in ("amber", "moss", "rose", "sky"):
        hi, mid, lo, _ = KEYCOL[name]
        face = _key_face(hi, mid, lo, 3)
        frames += [face, _key_face(hi, mid, lo, 2), _key_face(hi, mid, lo, 1), _key_face(hi, mid, lo, 2).flip_h()]
    return frames


def token():
    out = []
    # gatekey: a crystal-bitted key on a gold ring
    c = new(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 5, y + 0.5 - 5)
            if 2.2 < d <= 4.2:
                put(c, x, y, "gold2" if x + y < 9 else "gold1")
    for i in range(7):
        put(c, 7 + i, 7 + i, "gold2")
        put(c, 8 + i, 7 + i, "gold0")
    stamp(c, [" a", "aWb", " bc"], {"a": "shard3", "W": "white", "b": "shard2", "c": "shard1"}, 10, 12)
    stamp(c, ["a", "b"], {"a": "shard3", "b": "shard1"}, 12, 9)
    out.append(ink(c, O))
    # bolt: a lamp-bolt upgrade (lightning in a glass bead)
    c = new(16, 16)
    shade_disc(c, 8, 8, 6.2, "water4", "water3", "water2", "water1")
    stamp(c, ["   Y", "  Y ", " YYY", "  Y ", " Y  ", "Y   "], {"Y": "gold2"}, 6, 5)
    stamp(c, ["   W", "  W "], {"W": "white"}, 6, 5)
    put(c, 5, 4, "white")
    out.append(ink(c, O))
    # stones: a leather pouch of throwing stones
    c = art(16, 16, [
        "   oooooo   ",
        "  oHhhhhlo  ",
        "   oRRRRo   ",
        "  oHhhhhlo  ",
        " oHhhhhhhlo ",
        "oHhhhhhhhhlo",
        "oHhhhhhhhllo",
        " ollllllllo ",
        "  oooooooo  ",
    ], {"o": O, "H": "wood4", "h": "wood3", "l": "wood2", "R": "fire3"}, 2, 4)
    stamp(c, [" oo  ", "oHlo ", "oolooo", "  oHlo", "  oooo"], {"o": O, "H": "stone4", "l": "stone2"}, 9, 0)
    out.append(c)
    # boots: spring boots
    c = art(16, 16, [
        "  oooo    ",
        "  oHho    ",
        "  oHho    ",
        "  oHhoooo ",
        " oHhhhhhho",
        " oHhhhhhlo",
        " oooooooo ",
        "  oSSSSo  ",
        "   osso   ",
        "  oSSSSo  ",
        "  oooooo  ",
    ], {"o": O, "H": "fire4", "h": "fire3", "l": "fire2", "S": "stone4", "s": "stone2"}, 3, 2)
    put(c, 6, 4, "gold2")
    out.append(c)
    # ward: a round shield
    c = new(16, 16)
    shade_disc(c, 8, 8, 6.8, "water3", "water2", "water1", "water0")
    shade_disc(c, 8, 8, 3.2, "gold2", "gold1", "gold0")
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 8)
            if 5.6 < d <= 6.8:
                put(c, x, y, "stone4" if x + y < 15 else "stone2")
    put(c, 7, 7, "white")
    out.append(ink(c, O))
    # embers: fireball charges (a flame orb)
    c = new(16, 16)
    fl = _flame(16, 16, 1, [(8, 13, 0.0, 5.0)], 14)
    c.blit(fl, 0, 0)
    shade_disc(c, 8, 11, 3.0, "white", "fire5", "fire4")
    out.append(ink(c, "fire1"))
    # lamp: the return-to-human lantern
    c = art(16, 16, [
        "    oooo    ",
        "   o    o   ",
        "  oooooooo  ",
        "  oHHhhhlo  ",
        " oooooooooo ",
        " oGYYYYYYgo ",
        " oGYYWWYYgo ",
        " oGYWWWWYgo ",
        " oGYYWWYYgo ",
        " oGYYYYYYgo ",
        " oooooooooo ",
        "  oHhhhhlo  ",
        "  oooooooo  ",
    ], {"o": O, "H": "stone4", "h": "stone3", "l": "stone1", "G": "gold2", "g": "gold1", "Y": "fire5",
        "W": "white"}, 2, 2)
    out.append(c)
    # moth: the moth-form token
    c = art(16, 16, [
        "  o      o  ",
        "   o    o   ",
        "oo  oooo  oo",
        "oWWo oo oWWo",
        "oVWVobbo VWVo",
        "oVVVobbo VVVo",
        " oVvobbovVo ",
        "  oooobboooo",
        "     oo     ",
    ], {"o": O, "W": "dawn0", "V": "violet3", "v": "violet2", "b": "wood3"}, 2, 3)
    out.append(c)
    return out


def sigil():
    out = []
    knots = {
        # a leaf knot: two leaves crossed on a loop
        "root": ([
            "    aa    ",
            "   abbc   ",
            "  ab  bc  ",
            "aab    bcc",
            "abbb  bbbc",
            " cbb  bbc ",
            "  cb  bc  ",
            "   cbbc   ",
            "    cc    ",
        ], {"a": "moss4", "b": "moss3", "c": "moss1"}, ("moss2", "moss1", "moss0")),
        # a wave knot
        "tide": ([
            "  aab     ",
            " a   b    ",
            "a  aa b  a",
            "a a  bb aa",
            " ab  b aa ",
            "  bbb aa  ",
            "    bbb   ",
            "   aa bb  ",
            "  a    b  ",
        ], {"a": "water4", "b": "water3", "c": "water1"}, ("water2", "water1", "water0")),
        # a flame knot
        "ember": ([
            "    a     ",
            "   ab  a  ",
            "  abb  ab ",
            " ab bbab  ",
            " ab  bbb  ",
            "ab  bb bc ",
            "ab bb  bc ",
            " cbb  bc  ",
            "  cccccc  ",
        ], {"a": "fire5", "b": "fire4", "c": "fire2"}, ("fire2", "fire1", "fire0")),
    }
    for name in ("root", "tide", "ember"):
        rows, kmap, (m1, m2, m3) = knots[name]
        c = new(24, 24)
        for y in range(24):
            for x in range(24):
                d = math.hypot(x + 0.5 - 12, y + 0.5 - 12)
                if d <= 9.0:
                    k = ((x - 12) + (y - 12)) / 12
                    if d > 7.6:
                        col = "gold2" if k < -0.3 else ("gold1" if k < 0.4 else "gold0")
                    elif d > 7.0:
                        col = "gold0"
                    else:
                        col = m1 if k < -0.35 else (m2 if k < 0.35 else m3)
                    put(c, x, y, col)
        for a in range(8):
            ang = a * math.pi / 4
            put(c, int(12 + 8.3 * math.cos(ang)), int(12 + 8.3 * math.sin(ang)), "white" if a == 5 else "gold2")
        stamp(c, rows, kmap, 7, 8)
        ink(c, O)
        out.append(c)
    return out


RUNE_LETTERS = {
    "v": ["o   o", "o   o", "o   o", " o o ", " o o ", "  o  "],
    "a": ["  o  ", " o o ", "o   o", "ooooo", "o   o", "o   o"],
    "l": ["o    ", "o    ", "o    ", "o    ", "o    ", "ooooo"],
    "e": ["ooooo", "o    ", "oooo ", "o    ", "o    ", "ooooo"],
}


def rune():
    out = []
    for ch in ("v", "a", "l", "e"):
        c = art(16, 16, [
            "   oooooooo   ",
            "  oHHhhhhhmo  ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhmo ",
            " oHhhhhhhhhlo ",
            " ohhhhhhhhllo ",
            " olllllllllo  ",
            "  oooooooooo  ",
        ], {"o": O, "H": "stone4", "h": "stone3", "m": "stone2", "l": "stone1"}, 1, 2)
        letter = RUNE_LETTERS[ch]
        for y, row in enumerate(letter):
            for x, p in enumerate(row):
                if p == "o":
                    put(c, 5 + x, 5 + y, "shard3")
                    if c.get(6 + x, 6 + y) == N["stone3"]:
                        put(c, 6 + x, 6 + y, "shard0")
        out.append(c)
    return out


def note():
    return [art(16, 16, [
        " oooooooooooo ",
        "oHWWWWWWWWWWlo",
        "oHhhhhhhhhhhlo",
        " oWWWWWWWWWo  ",
        " oWmmmWmmmWo  ",
        " oWWWWWWWWWo  ",
        " oWmmWmmmmWo  ",
        " oWWWWWWWWWo  ",
        " oWmmmmWmmWo  ",
        " oWWWWWWWWRRo ",
        "oHhhhhhhhhRrRo",
        "oHWWWWWWWWWlo ",
        " oooooooooooo ",
    ], {"o": O, "W": "dawn0", "H": "wood4", "h": "wood3", "l": "wood2", "m": "wood2", "R": "fire2",
        "r": "fire1"}, 1, 2)]


# ----------------------------------------------------------------------------- build

SPRITES = {
    "masher": masher, "spear": spear, "spikes": spikes_trap, "poker": poker, "dart": dart,
    "fire": fire, "stalactite": stalactite, "spring": spring, "platform": platform, "lift": lift,
    "door": door, "switch": switch, "button": button, "pad": pad, "crate": crate, "torch": torch,
    "portal": portal, "signpost": signpost, "shard": shard, "heart": heart, "berry": berry,
    "gem": gem, "key": key, "token": token, "sigil": sigil, "rune": rune, "note": note,
}
DURATIONS = {"fire": 90, "torch": 110, "portal": 120, "shard": 160, "heart": 180, "pad": 150,
             "key": 120, "platform": 150}


def build() -> list[str]:
    paths = []
    for name, fn in SPRITES.items():
        frames = fn()
        ms = DURATIONS.get(name, 100)
        paths.append(save_sprite(name, frames, [ms] * len(frames)))
    return paths


if __name__ == "__main__":
    for p in build():
        print("wrote", os.path.relpath(p))
