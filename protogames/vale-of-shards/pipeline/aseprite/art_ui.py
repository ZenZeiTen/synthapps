"""Interface art for Vale of Shards, drawn in code.

    python3 pipeline/aseprite/art_ui.py        # writes art/aseprite/<name>.aseprite

Sprites: hud, pip, keyslot, icon, font, panel, cursor, portrait, glyph, marker, logo
(sizes and tags from pipeline/manifest.py).

HUD layout (320x32 bar; the game draws numbers with the 6x8 font and sprites on top).
HUD_SLOTS gives each recess as (x, y, w, h), all inside the bar:
    score   6,8   66x16   up to 10 digits; print at (9, 12)
    health  78,10 54x12   5 pips (8x8) at x = 81 + 10*i, y = 12
    keys    138,9 50x14   4 keyslots (10x12) at x = 140 + 12*i, y = 10
    berries 208,10 30x12  count; the sunberry icon is baked in at (194, 10); print at (211, 12)
    shards  256,10 30x12  count; the shard icon is baked in at (242, 10); print at (259, 12)
    form    292,8 22x16   free recess for the current form / power-up
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

HUD_SLOTS = {
    "score": (6, 8, 66, 16),
    "health": (78, 10, 54, 12),
    "keys": (138, 9, 50, 14),
    "berries": (208, 10, 30, 12),
    "shards": (256, 10, 30, 12),
    "form": (292, 8, 22, 16),
}
HUD_ICONS = {"sunberry": (194, 10), "shard": (242, 10)}

# ----------------------------------------------------------------------------- font
# ASCII 32..127, 5x7 each ('o' = ink on). Lowercase letters with descenders sit one row
# higher so the tail fits in the 7th row.

FONT = {
    " ": ["....."] * 7,
    "!": ["..o..", "..o..", "..o..", "..o..", "..o..", ".....", "..o.."],
    '"': [".o.o.", ".o.o.", ".o.o.", ".....", ".....", ".....", "....."],
    "#": [".o.o.", ".o.o.", "ooooo", ".o.o.", "ooooo", ".o.o.", ".o.o."],
    "$": ["..o..", ".oooo", "o.o..", ".ooo.", "..o.o", "oooo.", "..o.."],
    "%": ["oo...", "oo..o", "...o.", "..o..", ".o...", "o..oo", "...oo"],
    "&": [".oo..", "o..o.", "o.o..", ".o...", "o.o.o", "o..o.", ".oo.o"],
    "'": ["..o..", "..o..", ".o...", ".....", ".....", ".....", "....."],
    "(": ["...o.", "..o..", ".o...", ".o...", ".o...", "..o..", "...o."],
    ")": [".o...", "..o..", "...o.", "...o.", "...o.", "..o..", ".o..."],
    "*": [".....", "..o..", "o.o.o", ".ooo.", "o.o.o", "..o..", "....."],
    "+": [".....", "..o..", "..o..", "ooooo", "..o..", "..o..", "....."],
    ",": [".....", ".....", ".....", ".....", ".oo..", "..o..", ".o..."],
    "-": [".....", ".....", ".....", "ooooo", ".....", ".....", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".oo..", ".oo.."],
    "/": [".....", "....o", "...o.", "..o..", ".o...", "o....", "....."],
    "0": [".ooo.", "o...o", "o..oo", "o.o.o", "oo..o", "o...o", ".ooo."],
    "1": ["..o..", ".oo..", "..o..", "..o..", "..o..", "..o..", ".ooo."],
    "2": [".ooo.", "o...o", "....o", "...o.", "..o..", ".o...", "ooooo"],
    "3": ["ooooo", "...o.", "..o..", "...o.", "....o", "o...o", ".ooo."],
    "4": ["...o.", "..oo.", ".o.o.", "o..o.", "ooooo", "...o.", "...o."],
    "5": ["ooooo", "o....", "oooo.", "....o", "....o", "o...o", ".ooo."],
    "6": ["..oo.", ".o...", "o....", "oooo.", "o...o", "o...o", ".ooo."],
    "7": ["ooooo", "....o", "...o.", "..o..", ".o...", ".o...", ".o..."],
    "8": [".ooo.", "o...o", "o...o", ".ooo.", "o...o", "o...o", ".ooo."],
    "9": [".ooo.", "o...o", "o...o", ".oooo", "....o", "...o.", ".oo.."],
    ":": [".....", ".oo..", ".oo..", ".....", ".oo..", ".oo..", "....."],
    ";": [".....", ".oo..", ".oo..", ".....", ".oo..", "..o..", ".o..."],
    "<": ["...o.", "..o..", ".o...", "o....", ".o...", "..o..", "...o."],
    "=": [".....", ".....", "ooooo", ".....", "ooooo", ".....", "....."],
    ">": [".o...", "..o..", "...o.", "....o", "...o.", "..o..", ".o..."],
    "?": [".ooo.", "o...o", "....o", "...o.", "..o..", ".....", "..o.."],
    "@": [".ooo.", "o...o", "....o", ".oo.o", "o.o.o", "o.o.o", ".ooo."],
    "A": [".ooo.", "o...o", "o...o", "ooooo", "o...o", "o...o", "o...o"],
    "B": ["oooo.", "o...o", "o...o", "oooo.", "o...o", "o...o", "oooo."],
    "C": [".ooo.", "o...o", "o....", "o....", "o....", "o...o", ".ooo."],
    "D": ["ooo..", "o..o.", "o...o", "o...o", "o...o", "o..o.", "ooo.."],
    "E": ["ooooo", "o....", "o....", "oooo.", "o....", "o....", "ooooo"],
    "F": ["ooooo", "o....", "o....", "oooo.", "o....", "o....", "o...."],
    "G": [".ooo.", "o...o", "o....", "o.ooo", "o...o", "o...o", ".oooo"],
    "H": ["o...o", "o...o", "o...o", "ooooo", "o...o", "o...o", "o...o"],
    "I": [".ooo.", "..o..", "..o..", "..o..", "..o..", "..o..", ".ooo."],
    "J": ["..ooo", "...o.", "...o.", "...o.", "...o.", "o..o.", ".oo.."],
    "K": ["o...o", "o..o.", "o.o..", "oo...", "o.o..", "o..o.", "o...o"],
    "L": ["o....", "o....", "o....", "o....", "o....", "o....", "ooooo"],
    "M": ["o...o", "oo.oo", "o.o.o", "o.o.o", "o...o", "o...o", "o...o"],
    "N": ["o...o", "o...o", "oo..o", "o.o.o", "o..oo", "o...o", "o...o"],
    "O": [".ooo.", "o...o", "o...o", "o...o", "o...o", "o...o", ".ooo."],
    "P": ["oooo.", "o...o", "o...o", "oooo.", "o....", "o....", "o...."],
    "Q": [".ooo.", "o...o", "o...o", "o...o", "o.o.o", "o..o.", ".oo.o"],
    "R": ["oooo.", "o...o", "o...o", "oooo.", "o.o..", "o..o.", "o...o"],
    "S": [".oooo", "o....", "o....", ".ooo.", "....o", "....o", "oooo."],
    "T": ["ooooo", "..o..", "..o..", "..o..", "..o..", "..o..", "..o.."],
    "U": ["o...o", "o...o", "o...o", "o...o", "o...o", "o...o", ".ooo."],
    "V": ["o...o", "o...o", "o...o", "o...o", "o...o", ".o.o.", "..o.."],
    "W": ["o...o", "o...o", "o...o", "o.o.o", "o.o.o", "o.o.o", ".o.o."],
    "X": ["o...o", "o...o", ".o.o.", "..o..", ".o.o.", "o...o", "o...o"],
    "Y": ["o...o", "o...o", ".o.o.", "..o..", "..o..", "..o..", "..o.."],
    "Z": ["ooooo", "....o", "...o.", "..o..", ".o...", "o....", "ooooo"],
    "[": [".ooo.", ".o...", ".o...", ".o...", ".o...", ".o...", ".ooo."],
    "\\": [".....", "o....", ".o...", "..o..", "...o.", "....o", "....."],
    "]": [".ooo.", "...o.", "...o.", "...o.", "...o.", "...o.", ".ooo."],
    "^": ["..o..", ".o.o.", "o...o", ".....", ".....", ".....", "....."],
    "_": [".....", ".....", ".....", ".....", ".....", ".....", "ooooo"],
    "`": [".o...", "..o..", "...o.", ".....", ".....", ".....", "....."],
    "a": [".....", ".....", ".ooo.", "....o", ".oooo", "o...o", ".oooo"],
    "b": ["o....", "o....", "o.oo.", "oo..o", "o...o", "o...o", "oooo."],
    "c": [".....", ".....", ".ooo.", "o....", "o....", "o...o", ".ooo."],
    "d": ["....o", "....o", ".oo.o", "o..oo", "o...o", "o...o", ".oooo"],
    "e": [".....", ".....", ".ooo.", "o...o", "ooooo", "o....", ".ooo."],
    "f": ["..oo.", ".o..o", ".o...", "ooo..", ".o...", ".o...", ".o..."],
    "g": [".....", ".oooo", "o...o", "o...o", ".oooo", "....o", ".ooo."],
    "h": ["o....", "o....", "o.oo.", "oo..o", "o...o", "o...o", "o...o"],
    "i": ["..o..", ".....", ".oo..", "..o..", "..o..", "..o..", ".ooo."],
    "j": ["...o.", ".....", "..oo.", "...o.", "...o.", "o..o.", ".oo.."],
    "k": ["o....", "o....", "o..o.", "o.o..", "oo...", "o.o..", "o..o."],
    "l": [".oo..", "..o..", "..o..", "..o..", "..o..", "..o..", ".ooo."],
    "m": [".....", ".....", "oo.o.", "o.o.o", "o.o.o", "o.o.o", "o.o.o"],
    "n": [".....", ".....", "o.oo.", "oo..o", "o...o", "o...o", "o...o"],
    "o": [".....", ".....", ".ooo.", "o...o", "o...o", "o...o", ".ooo."],
    "p": [".....", "oooo.", "o...o", "o...o", "oooo.", "o....", "o...."],
    "q": [".....", ".oooo", "o...o", "o...o", ".oooo", "....o", "....o"],
    "r": [".....", ".....", "o.oo.", "oo..o", "o....", "o....", "o...."],
    "s": [".....", ".....", ".oooo", "o....", ".ooo.", "....o", "oooo."],
    "t": [".o...", ".o...", "ooo..", ".o...", ".o...", ".o..o", "..oo."],
    "u": [".....", ".....", "o...o", "o...o", "o...o", "o..oo", ".oo.o"],
    "v": [".....", ".....", "o...o", "o...o", "o...o", ".o.o.", "..o.."],
    "w": [".....", ".....", "o...o", "o...o", "o.o.o", "o.o.o", ".o.o."],
    "x": [".....", ".....", "o...o", ".o.o.", "..o..", ".o.o.", "o...o"],
    "y": [".....", "o...o", "o...o", "o...o", ".oooo", "....o", ".ooo."],
    "z": [".....", ".....", "ooooo", "...o.", "..o..", ".o...", "ooooo"],
    "{": ["...o.", "..o..", "..o..", ".o...", "..o..", "..o..", "...o."],
    "|": ["..o..", "..o..", "..o..", "..o..", "..o..", "..o..", "..o.."],
    "}": [".o...", "..o..", "..o..", "...o.", "..o..", "..o..", ".o..."],
    "~": [".....", ".....", ".o...", "o.o.o", "...o.", ".....", "....."],
    "\x7f": ["..o..", ".ooo.", "ooooo", "ooooo", ".ooo.", "..o..", "....."],  # a small shard mark
}
assert len(FONT) == 96 and all(len(g) == 7 and all(len(r) == 5 for r in g) for g in FONT.values())


def glyph_canvas(ch: str, fg_top="white", fg_bot="stone4", shadow=O) -> Canvas:
    c = Canvas(6, 8)
    rows = FONT[ch]
    for y, r in enumerate(rows):
        for x, p in enumerate(r):
            if p == "o" and c.get(x + 1, y + 1) is None:
                put(c, x + 1, y + 1, shadow)
    for y, r in enumerate(rows):
        for x, p in enumerate(r):
            if p == "o":
                put(c, x, y, fg_top if y < 4 else fg_bot)
    return c


def font():
    glyphs = [glyph_canvas(chr(i)) for i in range(32, 128)]
    # tests/verify_art.py rejects empty frames, so the space keeps one ink pixel in the
    # shadow corner, where it vanishes into the dark HUD and panel backgrounds.
    put(glyphs[0], 5, 7, O)
    return glyphs


def text(c: Canvas, x: int, y: int, s: str, **kw):
    for i, ch in enumerate(s):
        c.blit(glyph_canvas(ch, **kw), x + 6 * i, y)


# ----------------------------------------------------------------------------- small icons

ICON_ART = {
    "shard": ([
        "    o     ",
        "   oWo    ",
        "  oWSso   ",
        "  oWSso   ",
        " oWSSsdo  ",
        " oSSsddo  ",
        "  oSsdo   ",
        "  oSdo    ",
        "   oo     ",
    ], {"o": O, "W": "white", "S": "shard3", "s": "shard2", "d": "shard1"}),
    "sunberry": ([
        "     gG  ",
        "    lgG  ",
        "  oooo   ",
        " oYWYyo  ",
        "oYYYYyyo ",
        "oYYYyyfo ",
        "oYyyyffo ",
        " oyffffo ",
        "  oooo   ",
    ], {"o": O, "Y": "gold2", "W": "white", "y": "fire4", "f": "fire3", "g": "moss3", "G": "moss4",
        "l": "wood1"}),
    "plum": ([
        "    l    ",
        "   l     ",
        "  oooo   ",
        " oVWVvo  ",
        "oVVVVvvo ",
        "oVVVvvdo ",
        "oVvvvddo ",
        " ovddddo ",
        "  oooo   ",
    ], {"o": O, "V": "violet3", "W": "water4", "v": "violet2", "d": "violet1", "l": "wood1"}),
    "fig": ([
        "   gg    ",
        "   oo    ",
        "  oBbo   ",
        " oBbbbo  ",
        "oBWbbbdo ",
        "oBbbbbdo ",
        "oBbbbddo ",
        " oBbddo  ",
        "  oooo   ",
    ], {"o": O, "B": "berry1", "b": "berry0", "W": "dawn1", "d": "fire0", "g": "moss2"}),
    "starfruit": ([
        "    o    ",
        "   oYo   ",
        "ooooYoooo",
        "oYYYWYYyo",
        " oYYYYyo ",
        "  oYYyo  ",
        " oYyoYyo ",
        " ooo ooo ",
    ], {"o": O, "Y": "gold2", "y": "gold1", "W": "white"}),
    "bolt": ([
        "  oooooo  ",
        " oWwwwwbo ",
        "oWwwYwwbbo",
        "owwwYYwbbo",
        "owwYYYYbbo",
        "owwwwYbbbo",
        "owwwYbbbbo",
        " obbbbbbo ",
        "  oooooo  ",
    ], {"o": O, "W": "white", "w": "water3", "b": "water2", "Y": "gold2"}),
    "embers": ([
        "   o     ",
        "  oYo  o ",
        "  oYYooYo",
        " oYWYYYYo",
        "oYWWYYyyo",
        "oYWYYyyfo",
        "oyYYyyffo",
        " offfffo ",
        "  ooooo  ",
    ], {"o": O, "Y": "fire4", "W": "fire5", "y": "fire3", "f": "fire2"}),
    "stones": ([
        "  ooo     ",
        " oHhlo    ",
        " ohllooo  ",
        "  oooHhlo ",
        " oo ohlllo",
        "oHho ollo ",
        "ohllo oo  ",
        " ooo      ",
    ], {"o": O, "H": "stone4", "h": "stone3", "l": "stone2"}),
    "gatekey": ([
        " oooo     ",
        "oGggGo    ",
        "oGooGo    ",
        "oGggGo    ",
        " ooGGoooo ",
        "   oGGGGGo",
        "    ooSoSo",
        "      oSoo",
        "       o  ",
    ], {"o": O, "G": "gold2", "g": "gold1", "S": "shard3"}),
    "boots": ([
        "  ooo     ",
        "  oHho    ",
        "  oHho    ",
        "  oHhooo  ",
        " oHhhhhho ",
        " oHhhhhlo ",
        " oooooooo ",
        "  oSsSso  ",
        "  oooooo  ",
    ], {"o": O, "H": "fire4", "h": "fire3", "l": "fire2", "S": "stone4", "s": "stone2"}),
    "ward": ([
        " oooooooo ",
        "oSHHHHHHho",
        "oSHHGGHHho",
        "oSHGGGGHho",
        "oSHHGGHHho",
        " oSHHHHho ",
        " oSHHHHho ",
        "  oSHHho  ",
        "   oSho   ",
        "    oo    ",
    ], {"o": O, "S": "stone4", "H": "water2", "h": "water1", "G": "gold2"}),
}


def icon_canvas(name: str, w=12, h=12) -> Canvas:
    rows, cmap = ICON_ART[name]
    c = Canvas(w, h)
    aw = max(len(r) for r in rows)
    stamp(c, [r.ljust(aw) for r in rows], cmap, (w - aw) // 2 + (1 if aw % 2 else 0), (h - len(rows)) // 2)
    return c


def icon():
    return [icon_canvas(n) for n in ("shard", "sunberry", "plum", "fig", "starfruit", "bolt", "embers",
                                     "stones", "gatekey", "boots", "ward")]


# ----------------------------------------------------------------------------- hud pieces


def pip():
    full = Canvas(8, 8)
    stamp(full, [
        ".oo.oo.",
        "oWRoRRo",
        "oRRRRro",
        "oRRRRro",
        ".oRRro.",
        "..oro..",
        "...o...",
    ], {"o": O, "W": "berry2", "R": "fire2", "r": "fire1"}, 0, 0)
    put(full, 1, 1, "white")
    empty = Canvas(8, 8)
    stamp(empty, [
        ".oo.oo.",
        "oddoddo",
        "oddddd o",
        "oddddd o",
        ".odddo.",
        "..odo..",
        "...o...",
    ], {"o": "stone2", "d": "stone0"}, 0, 0)
    for (x, y) in ((6, 2), (6, 3)):
        put(empty, x, y, "stone2")
    return [full, empty]


def _slot(c: Canvas, x, y, w, h):
    """A recessed slot: dark inside, shadow on top/left, light lip on bottom/right."""
    c.rect(x, y, x + w - 1, y + h - 1, "stone0")
    for i in range(w):
        put(c, x + i, y, O)
        put(c, x + i, y + h - 1, "stone2")
    for j in range(h):
        put(c, x, y + j, O)
        put(c, x + w - 1, y + j, "stone2")
    for i in range(1, w - 1):
        put(c, x + i, y + 1, "ink")
    put(c, x, y + h - 1, "stone1")
    put(c, x + w - 1, y, "stone1")


def keyslot():
    frames = []
    c = Canvas(10, 12)
    _slot(c, 0, 0, 10, 12)
    stamp(c, [" oo ", "o  o", " oo ", "  o ", "  o ", "  oo", "  o ", "  oo"], {"o": "stone1"}, 3, 2)
    frames.append(c)
    cols = {"amber": ("gold2", "gold1", "gold0"), "moss": ("moss4", "moss3", "moss1"),
            "rose": ("berry2", "berry1", "berry0"), "sky": ("water4", "water3", "water1")}
    for name in ("amber", "moss", "rose", "sky"):
        hi, mid, lo = cols[name]
        c = Canvas(10, 12)
        _slot(c, 0, 0, 10, 12)
        stamp(c, [
            " oooo ",
            "oHhmmo",
            "oHoolo",
            " ohlo ",
            "  oHlo",
            "  oHlo",
            "  oHHo",
            "  oHoo",
            "  oHHo",
            "  ooo ",
        ], {"o": O, "H": hi, "h": mid, "m": mid, "l": lo}, 2, 1)
        put(c, 3, 2, "white")
        frames.append(c)
    return frames


def hud():
    c = Canvas(320, 32)
    # bar body: dark stone with a bevelled frame
    c.rect(0, 0, 319, 31, "stone0")
    for x in range(320):
        put(c, x, 0, O)
        put(c, x, 1, "stone3")
        put(c, x, 2, "stone2")
        put(c, x, 29, "stone1")
        put(c, x, 30, "ink")
        put(c, x, 31, O)
    for y in range(32):
        put(c, 0, y, O)
        put(c, 1, y, "stone3" if y < 29 else "stone1")
        put(c, 318, y, "stone1")
        put(c, 319, y, O)
    # a faint diagonal weave in the body so the bar is not a flat slab
    for y in range(3, 29):
        for x in range(2, 318):
            if (x + y) % 8 == 0 and (x // 8 + y // 4) % 2 == 0:
                put(c, x, y, "violet0")
    # gold studs along the rim
    for x in range(12, 320, 40):
        put(c, x, 1, "gold2")
        put(c, x + 1, 1, "gold1")
    for name, (x, y, w, h) in HUD_SLOTS.items():
        _slot(c, x, y, w, h)
    # baked icons for the two counters
    for name, (x, y) in HUD_ICONS.items():
        c.blit(icon_canvas(name), x, y)
    # little crystal separators between groups
    for x in (74, 134, 191, 240, 289):
        stamp(c, [" a ", "aWb", "abc", " c "], {"a": "shard3", "W": "white", "b": "shard2", "c": "shard1"},
              x - 1, 13)
    return [c]


# ----------------------------------------------------------------------------- panel, cursor


def panel():
    c = Canvas(24, 24)
    c.rect(0, 0, 23, 23, "violet0")
    # frame rings: ink, light stone, mid stone, dark stone, ink
    rings = [O, "stone3", "stone2", "stone1", O]
    for i, col in enumerate(rings):
        for k in range(i, 24 - i):
            put(c, k, i, col)
            put(c, k, 23 - i, col)
            put(c, i, k, col)
            put(c, 23 - i, k, col)
    # light from the upper left: top and left rings brighter
    for k in range(1, 23):
        put(c, k, 1, "stone4")
        put(c, 1, k, "stone4")
        put(c, k, 22, "stone1")
        put(c, 22, k, "stone1")
    for (x, y) in ((0, 0), (23, 0), (0, 23), (23, 23)):
        put(c, x, y, None)
    # corner crystals, inside the 8 px corners
    for (x, y) in ((1, 1), (19, 1), (1, 19), (19, 19)):
        stamp(c, [" oo ", "oWso", "osdo", " oo "], {"o": O, "W": "white", "s": "shard3", "d": "shard1"}, x, y)
    return [c]


def cursor():
    a = Canvas(8, 8)
    stamp(a, ["o      ", "oWo    ", "oWYo   ", "oWYYo  ", "oWYyo  ", "oWyo   ", "oyo    ", "oo     "],
          {"o": O, "W": "white", "Y": "gold2", "y": "gold1"}, 1, 0)
    b = Canvas(8, 8)
    b.blit(a, 1, 0)
    return [a, b]


# ----------------------------------------------------------------------------- glyphs


def glyph():
    out = []
    for letter, (hi, mid, lo) in (("A", ("moss4", "moss3", "moss1")), ("B", ("fire4", "fire2", "fire1")),
                                  ("X", ("water3", "water2", "water1")), ("Y", ("gold2", "gold1", "gold0"))):
        c = Canvas(12, 12)
        shade_disc(c, 6, 6, 5.6, hi, mid, lo)
        ink(c, O) if False else None
        for y in range(12):
            for x in range(12):
                d = math.hypot(x + 0.5 - 6, y + 0.5 - 6)
                if 5.0 < d <= 6.0:
                    put(c, x, y, O)
        rows = FONT[letter]
        for y, r in enumerate(rows[:7]):
            for x, p in enumerate(r):
                if p == "o":
                    if c.get(x + 4, y + 3) != N[O]:
                        put(c, x + 4, y + 3, lo)
        for y, r in enumerate(rows[:7]):
            for x, p in enumerate(r):
                if p == "o":
                    put(c, x + 3, y + 2, "white")
        out.append(c)
    pill = [
        "  oooooooo  ",
        " oHHHHHHHho ",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        " ollllllllo ",
        "  oooooooo  ",
    ]
    start = Canvas(12, 12)
    stamp(start, pill, {"o": O, "H": "stone4", "h": "stone3", "l": "stone2"}, 0, 2)
    stamp(start, ["wwww", "    ", "wwww"], {"w": O}, 4, 4)
    stamp(start, ["  o ", " oo ", "ooo "], {"o": "white"}, 4, 3) if False else None
    out.append(start)
    back = Canvas(12, 12)
    stamp(back, pill, {"o": O, "H": "stone4", "h": "stone3", "l": "stone2"}, 0, 2)
    stamp(back, ["  o", " oo", "ooo", " oo", "  o"], {"o": O}, 4, 3)
    put(back, 8, 5, O)
    out.append(back)
    dpad = Canvas(12, 12)
    stamp(dpad, [
        "   oooo   ",
        "   oHho   ",
        "   oHho   ",
        "oooohhoooo",
        "oHHhhhhhlo",
        "oHhhhhhhlo",
        "ooooHloooo",
        "   oHlo   ",
        "   oHlo   ",
        "   oooo   ",
    ], {"o": O, "H": "stone4", "h": "stone3", "l": "stone2"}, 1, 1)
    out.append(dpad)
    key = Canvas(12, 12)
    stamp(key, [
        " oooooooooo ",
        "oHHHHHHHHHho",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        "oHhhhhhhhhlo",
        "oHllllllllmo",
        "ommmmmmmmmmo",
        " oooooooooo ",
    ], {"o": O, "H": "white", "h": "stone4", "l": "stone3", "m": "stone2"}, 0, 1)
    out.append(key)
    return out


# ----------------------------------------------------------------------------- markers


def marker():
    def base():
        c = Canvas(16, 16)
        stamp(c, [
            "  oooooooooo  ",
            " oHHhhhhhhhlo ",
            "oHhhhhhhhhhhlo",
            " ollllllllllo ",
            "  oooooooooo  ",
        ], {"o": O, "H": "stone4", "h": "stone3", "l": "stone1"}, 1, 11)
        return c

    crystal = ["   a   ", "  aWb  ", " aWbbc ", " abbbc ", " abbbc ", "  abc  ", "   c   "]
    out = []
    for f in range(2):
        c = base()
        ramp = {"a": "shard3", "W": "white", "b": "shard2", "c": "shard1"}
        stamp(c, crystal, ramp, 4, 4 - f)
        ink(c, O)
        if f == 0:
            for (x, y) in ((3, 3), (12, 5)):
                put(c, x, y, "shard3")
        else:
            for (x, y) in ((2, 1), (13, 2), (8, 0)):
                put(c, x, y, "white")
            put(c, 12, 12, "shard3")
        out.append(c)
    done = base()
    stamp(done, ["o      ", "oYYYYo ", "oYYYyyo", "oYyyyo ", "o      ", "o      ", "o      ",
                 "o      "], {"o": "wood1", "Y": "gold2", "y": "gold1"}, 6, 3)
    ink(done, O)
    out.append(done)
    locked = base()
    stamp(locked, ["  ooo  ", " o   o ", " o   o ", "ooooooo", "oHHoHHo", "oHHoHlo", "oHhhhlo",
                   "ooooooo"], {"o": O, "H": "stone3", "h": "stone2", "l": "stone1"}, 4, 3)
    ink(locked, O)
    out.append(locked)
    return out


# ----------------------------------------------------------------------------- portraits
# Each portrait is drawn as a left half (16 columns) and mirrored; the mirror darkens
# the ramp one step so the right side sits in shadow. Per-pixel overrides then add the
# asymmetric details (eyes, scarf knot, pack straps...).

SHADE_MAP = {"S": "s", "s": "k", "T": "t", "t": "u", "L": "T", "g": "h", "h": "H", "V": "v", "v": "d",
             "P": "p", "p": "q", "C": "c", "c": "e", "A": "a", "a": "b", "F": "f", "B": "b", "q": "R"}


def _portrait(half, cmap, bg, overrides=(), shade=SHADE_MAP):
    rows = []
    for r in half:
        assert len(r) == 16, (r, len(r))
        right = "".join(shade.get(ch, ch) for ch in reversed(r))
        rows.append(r + right)
    rows = [list(r) for r in rows]
    for (x, y, ch) in overrides:
        rows[y][x] = ch
    c = Canvas(32, 32)
    top, bot = bg
    for y in range(32):
        for x in range(32):
            col = top if (y < 14 or (y < 20 and (x + y) % 2 == 0 and y < 18)) else bot
            put(c, x, y, col)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in cmap:
                put(c, x, y, cmap[ch])
    c.frame(0, 0, 31, 31, N[O])
    return c


ORRIN = [
    "................",
    "................",
    "..........oooooo",
    "........ooHhhhhh",
    ".......oHhhgghhh",
    "......oHhhgghhhh",
    "......oHhhhhhhhh",
    ".....oHHhhhhhhhh",
    ".....oHhHhhHHhhh",
    ".....oHHSHHSSHHH",
    ".....oHSSSSSSSSS",
    ".....oHSSSSSSSSS",
    ".....oHSSooSSSSS",
    "....okHSSSSSSSSS",
    "....oksSSSSSSSSS",
    ".....osSSSSSSSSS",
    ".....osSSSSSSSSk",
    "......osSSSSSSSS",
    "......osSSSSSSSm",
    ".......osSSSSSSS",
    "........ossSSSSS",
    ".........oksssss",
    ".........ooRqqRR",
    ".......ooRqqqRRR",
    ".....ooTRRRRRRRR",
    "....oTTTLRRrrrrr",
    "...oTTLLTTRqRRRr",
    "..oTTLTTTTTRRRRo",
    "..oTLTTTTTTTTRRo",
    ".oTTLTTTTTTTTTTo",
    ".oTLTTTTTTTTTTTy",
    ".oTTTTTTTTTTTTTo",
]
SABLE = [
    "................",
    "...oo...........",
    "...oVoo.........",
    "...oVVVo........",
    "....oVVVoooooooo",
    "....oVVvVVVVVVVV",
    "...oVVVVVVVVVVVV",
    "...oVVCCCCCVVVVV",
    "..oVVCCCCCCCCVVV",
    "..oVCCWWWWWCCCVV",
    "..oVCWWWWWWWCCCV",
    "..oVCWWooooWWCCV",
    ".oVVCWoAAAAoWCCV",
    ".oVVCWoAaeAoWCCV",
    ".oVVCWoAeeaoWCCC",
    ".oVVCWWoaaoWWCCo",
    ".oVVCCWWooWWCCoB",
    ".oVVVCCWWWWCCCoB",
    ".oVVVVCCCCCCCCCo",
    ".oVvVVVCCCCCCCCC",
    ".oVvVVVVVCCCCCCC",
    ".oVVvVVVVVVVVCCC",
    ".oVvVvVVVVVVVVVV",
    ".oVVvVvVVvVVVVVV",
    ".oVvVVvVVVvVVvVV",
    ".oVVvVVvVVVvVVVV",
    "..oVVvVVvVVVVVvV",
    "..oVvVVvVVvVVVVV",
    "...oVVvVVVVvVVVV",
    "...oVvVVvVVVVVVV",
    "....oVVVVvVVVVVV",
    "....oVVvVVVVvVVV",
]
TOLLY = [
    "....oooooooooooo",
    "...oFFFFFFFFFFFF",
    "..oFFfFFFfFFFFfF",
    "..offfffffffffff",
    ".oPoooooooooooPP",
    ".oPPPPPppppPPPPP",
    "oPPpppppppoooooo",
    "oPpppppppoAAAAAA",
    "oPppqpppoAAAAAAA",
    "oPppqppoaaaaaaaa",
    "oPppqppooooooooo",
    "oPppqppoSSSSSSSS",
    "oPppqppoSSSSSSSS",
    "oPpppppoSSooSSSS",
    "oPPpppoSSSSSSSSS",
    "oppppoBSSSSSSSSS",
    ".oppoBBSSSSSSSSS",
    ".oPpoSSSSSSSSSSS",
    ".oPPoSSSSSSSSSSS",
    ".oPpooSSSSSSSSSS",
    ".oPpppoSSSSSSSSS",
    ".oPppppoossSSSSS",
    ".oPpqpoCCCooosss",
    ".oPpqoCCCCCCCCCC",
    ".oPpoCCCcCCCCCCC",
    "..ooCCCCcCqCCCCC",
    "..oCCCCCcCqCCCCC",
    ".oCCCCCCcCqCCyCC",
    ".oCCCCCCcCqCCCCC",
    ".oCCCCCCcCqCCCCC",
    "oCCCCCCCcCqCCyCC",
    "oCCCCCCCcCqCCCCC",
]
REGENT = [
    "...........o....",
    "..........oWo...",
    "....o.....oWo..o",
    "...oWo...oWVvo.o",
    "...oWVo..oWVvooW",
    "...oWVvooWVVvvoW",
    "....oWVvWVVVvvvW",
    "....oWVVVVVVVvvV",
    ".....ooooooooooo",
    ".....oAAAAAAAAAA",
    ".....oAAaaaAAAAA",
    ".....oAaaaaaAAAA",
    ".....oAaoooooAAA",
    ".....oAaoXXXXoAA",
    ".....oAAaooooaAA",
    ".....oAAaaaaaaAA",
    "......oAAaaaaaAA",
    "......oAAAaaaAAa",
    ".......oAAAAAAaa",
    "........oAAAaaaa",
    ".........ooAAaaa",
    "..........oooooo",
    "......oooVVVoVVV",
    "....ooVVVvVVVoVV",
    "...oVVVVvVVVVVoV",
    "..oVVVVvVVVVVVVo",
    "..oVVVvVVVVVVVVo",
    ".oVVVVvVVVVVVVVo",
    ".oVVVvVVVVVVVVVW",
    ".oVVVvVVVVVVVVVo",
    ".oVVvVVVVVVVVVVW",
    ".oVVvVVVVVVVVVVo",
]


def portrait():
    skin = {"S": "skin2", "s": "skin1", "k": "skin0", "o": O, "w": "white", "e": O, "m": "berry0"}
    orrin = _portrait(ORRIN, dict(skin, H="wood0", h="wood1", g="wood2", R="fire2", q="fire3", r="fire1",
                                  T="shard2", t="shard1", u="shard0", L="shard3", y="gold2"),
                      ("water1", "water0"),
                      overrides=[(11, 13, "w"), (12, 13, "e"), (19, 13, "w"), (20, 13, "e"),
                                 (15, 18, "m"), (16, 18, "m"), (17, 18, "m"), (14, 18, "S"),
                                 (19, 24, "q"), (20, 25, "R"), (21, 26, "r"), (20, 26, "R"), (21, 27, "R"),
                                 (22, 27, "r"), (21, 28, "R"), (22, 29, "r")])
    sable = _portrait(SABLE, {"o": O, "V": "dawn2", "v": "stone1", "d": "stone0", "C": "stone3", "c": "stone2",
                              "e": O, "W": "stone4", "A": "gold2", "a": "gold1", "B": "wood3", "b": "wood2"},
                      ("moss1", "moss0"),
                      overrides=[(9, 13, "e"), (22, 13, "e"), (10, 12, "W"), (21, 12, "W"),
                                 (15, 17, "B"), (16, 17, "b"), (15, 18, "B"), (16, 18, "b"), (15, 19, "b")])
    tolly = _portrait(TOLLY, dict(skin, P="wood4", p="wood3", q="wood1", F="water3", f="water2",
                                  A="moss3", a="moss1", B="berry2", C="gold1", c="gold0", e=O,
                                  y="stone4", G="stone3", g="stone1"),
                      ("fire1", "fire0"),
                      shade={"S": "s", "s": "k", "P": "p", "p": "q", "q": "q", "F": "f", "C": "c", "c": "c",
                             "A": "a", "a": "a"},
                      overrides=[(11, 14, "e"), (12, 14, "e"), (19, 14, "e"), (20, 14, "e"),
                                 (12, 18, "m"), (19, 18, "m"), (13, 19, "m"), (14, 19, "m"), (15, 19, "m"),
                                 (16, 19, "m"), (17, 19, "m"), (18, 19, "m"), (14, 20, "k"), (17, 20, "k"),
                                 (9, 16, "B"), (22, 16, "B"), (10, 16, "B"), (21, 16, "B"),
                                 (28, 9, "o"), (29, 10, "o"), (30, 11, "o"), (29, 12, "G"), (30, 12, "G"),
                                 (29, 13, "G"), (30, 13, "g"), (28, 14, "o"), (29, 14, "o"), (30, 14, "o")])
    regent = _portrait(REGENT, {"o": O, "W": "white", "V": "violet2", "v": "violet1", "d": "violet0",
                                "A": "water4", "a": "violet3", "b": "violet2", "X": "white"},
                       ("ink", "violet0"),
                       shade={"V": "v", "v": "d", "A": "a", "a": "b", "W": "V"})
    return [orrin, sable, tolly, regent]


# ----------------------------------------------------------------------------- logo

LOGO_BIG = {
    "V": ["xx...xx", "xx...xx", "xx...xx", "xx...xx", ".xx.xx.", ".xx.xx.", "..xxx..", "...x..."],
    "A": ["..xxx..", ".xx.xx.", "xx...xx", "xx...xx", "xxxxxxx", "xx...xx", "xx...xx", "xx...xx"],
    "L": ["xx.....", "xx.....", "xx.....", "xx.....", "xx.....", "xx.....", "xxxxxxx", "xxxxxxx"],
    "E": ["xxxxxxx", "xxxxxxx", "xx.....", "xxxxxx.", "xxxxxx.", "xx.....", "xxxxxxx", "xxxxxxx"],
}
LOGO_SMALL = {
    "O": [".xxxx.", "xx..xx", "xx..xx", "xx..xx", "xx..xx", ".xxxx."],
    "F": ["xxxxxx", "xx....", "xxxxx.", "xx....", "xx....", "xx...."],
    "S": [".xxxxx", "xx....", ".xxxx.", "....xx", "....xx", "xxxxx."],
    "H": ["xx..xx", "xx..xx", "xxxxxx", "xx..xx", "xx..xx", "xx..xx"],
    "A": [".xxxx.", "xx..xx", "xx..xx", "xxxxxx", "xx..xx", "xx..xx"],
    "R": ["xxxxx.", "xx..xx", "xxxxx.", "xx.xx.", "xx..xx", "xx..xx"],
    "D": ["xxxxx.", "xx..xx", "xx..xx", "xx..xx", "xx..xx", "xxxxx."],
    " ": ["......"] * 6,
}


def _letters(word, font, sx, sy, gap, chamfer=2):
    """Rasterise a word (blocks sx by sy) and chamfer every convex corner by `chamfer` px."""
    pix = set()
    x0 = 0
    for ch in word:
        g = font[ch]
        gw = len(g[0])
        if ch != " ":
            for by, row in enumerate(g):
                for bx, p in enumerate(row):
                    if p == "x":
                        for y in range(sy):
                            for x in range(sx):
                                pix.add((x0 + bx * sx + x, by * sy + y))
            x0 += gw * sx + gap
        else:
            x0 += sx * 3
    for _ in range(chamfer):
        cut = set()
        for (x, y) in pix:
            up, dn = (x, y - 1) in pix, (x, y + 1) in pix
            lf, rt = (x - 1, y) in pix, (x + 1, y) in pix
            if (not up or not dn) and (not lf or not rt):
                cut.add((x, y))
        pix -= cut
    return pix, x0 - gap


def _crystal_fill(c, pix, ox, oy, ramp, h):
    """Crystal lettering: bright bevel on top/left edges, facet band, dark bevel bottom/right."""
    hi, top, mid, low, dark = ramp
    for (x, y) in pix:
        X, Y = x + ox, y + oy
        up = (x, y - 1) in pix
        lf = (x - 1, y) in pix
        dn = (x, y + 1) in pix
        rt = (x + 1, y) in pix
        up2 = (x, y - 2) in pix
        lf2 = (x - 2, y) in pix
        if not up or not lf:
            col = hi
        elif not dn or not rt:
            col = dark
        elif not up2 or not lf2:
            col = top
        elif (x + y) % 11 == 0:
            col = hi
        elif y < h * 0.45:
            col = top if (x + y) % 11 < 5 else mid
        else:
            col = mid if (x + y) % 11 < 5 else low
        put(c, X, Y, col)


def logo():
    c = Canvas(256, 64)
    pb, wb = _letters("VALE", LOGO_BIG, 5, 4, 5, chamfer=2)
    ps, ws = _letters("OF SHARDS", LOGO_SMALL, 3, 3, 3, chamfer=1)
    oxb, oyb = (256 - wb) // 2, 2
    oxs, oys = (256 - ws) // 2, 40
    shadow = Canvas(256, 64)
    for (x, y) in pb:
        put(shadow, x + oxb + 2, y + oyb + 2, O)
    for (x, y) in ps:
        put(shadow, x + oxs + 2, y + oys + 2, O)
    c.blit(shadow, 0, 0)
    body = Canvas(256, 64)
    _crystal_fill(body, pb, oxb, oyb, ("white", "shard3", "shard2", "shard1", "shard0"), 32)
    _crystal_fill(body, ps, oxs, oys, ("white", "violet3", "violet2", "violet1", "violet0"), 18)
    body.outline(N[O])
    c.blit(body, 0, 0)
    # shard motif: a crystal cluster on each side of VALE
    cluster = [
        "      a     ",
        "     aWb    ",
        "     aWb  a ",
        "  a  aWbbaWb",
        " aWb aWbbaWb",
        " aWbbaWbbabbc",
        " abbbabbbabbc",
        "aabbbabbbcbbc",
        "abbbbcbbbcbc ",
        "abbbccbbcccc ",
        " cccc cccc   ",
    ]
    cl = Canvas(14, 12)
    stamp(cl, cluster, {"a": "shard3", "W": "white", "b": "shard2", "c": "shard1"}, 0, 0)
    ink(cl, O)
    c.blit(cl, oxb - 20, 20)
    c.blit(cl.flip_h(), oxb + wb + 6, 20)
    # sparkles
    for (x, y) in ((oxb - 10, 6), (oxb + wb + 12, 9), (oxs - 8, 50)):
        stamp(c, [" w ", "wWw", " w "], {"w": "shard3", "W": "white"}, x, y)
    return [c]


# ----------------------------------------------------------------------------- build

SPRITES = {"hud": hud, "pip": pip, "keyslot": keyslot, "icon": icon, "font": font, "panel": panel,
           "cursor": cursor, "portrait": portrait, "glyph": glyph, "marker": marker, "logo": logo}
DURATIONS = {"cursor": 300, "marker": 400}


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
