"""Write scaled preview PNGs of every sprite and tile sheet, read from art/aseprite.

    python3 tools/contact_sheet.py OUT_DIR [--scale 3] [--only name,name] [--no-mock]

For each sprite: OUT_DIR/<name>.png, its frames side by side (1 px gutters) on a
checkerboard so transparency shows, scaled by whole numbers with nearest-neighbour.
For each tile sheet: OUT_DIR/tiles_<theme>.png with a grid, and for side-view themes
OUT_DIR/mock_<theme>.png: a 320x148 play view built from the tiles by the autotile
rules (plus a light-backdrop copy) to check that tiles join and read at game size.
The map gets OUT_DIR/mock_map.png.
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
import asefile as A  # noqa: E402
from manifest import MAP_LAYOUT, MAP_THEME, SIDE_LAYOUT, SIDE_THEMES, SPRITES  # noqa: E402

ART = os.path.join(ROOT, "art", "aseprite")


def checker(w, h, a=(58, 58, 66), b=(74, 74, 84), n=4):
    im = Image.new("RGBA", (w, h), a)
    d = ImageDraw.Draw(im)
    for y in range(0, h, n):
        for x in range(0, w, n):
            if (x // n + y // n) % 2:
                d.rectangle([x, y, x + n - 1, y + n - 1], fill=b)
    return im


def frame_image(spr, i):
    im = Image.new("RGBA", (spr.width, spr.height))
    im.putdata(A.flatten(spr, i))
    return im


def sprite_sheet(name, scale):
    spr = A.read(os.path.join(ART, name + ".aseprite"))
    n = len(spr.frames)
    w, h = spr.width, spr.height
    per_row = max(1, min(n, 1024 // (w + 1)))
    rows = (n + per_row - 1) // per_row
    W, H = per_row * (w + 1) + 1, rows * (h + 1) + 1
    bg = Image.new("RGBA", (W, H), (30, 30, 36, 255))
    for i in range(n):
        x, y = 1 + (i % per_row) * (w + 1), 1 + (i // per_row) * (h + 1)
        cell = checker(w, h)
        fr = frame_image(spr, i)
        cell.alpha_composite(fr)
        bg.paste(cell, (x, y))
    return bg.resize((W * scale, H * scale), Image.NEAREST)


def tile_sheet(theme, scale):
    spr = A.read(os.path.join(ART, "tiles_" + theme + ".aseprite"))
    im = frame_image(spr, 0)
    W, H = 16 * 17 + 1, 6 * 17 + 1
    bg = Image.new("RGBA", (W, H), (30, 30, 36, 255))
    for r in range(6):
        for c in range(16):
            cell = checker(16, 16)
            cell.alpha_composite(im.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16)))
            bg.paste(cell, (1 + c * 17, 1 + r * 17))
    return bg.resize((W * scale, H * scale), Image.NEAREST), im


# ---------------------------------------------------------------- mock scenes

LEVEL = [
    "####################",
    "##BBBB|..h....BBBB##",
    "#BBBB.|..........BD#",
    "#BB...|..===...f.@@#",
    "#B..f.|.......######",
    "##.=.....f.f.CCCK..#",
    "###..IB.O#####.....#",
    "####___###%##~~~XX##",
    "#%##..f###%##~~~####",
    "##########%##LLL#T##",
]
LIGHT = {"moss": (74, 104, 92), "mine": (52, 46, 64), "water": (40, 70, 104), "wood": (84, 108, 74),
         "ember": (70, 38, 40), "spire": (62, 50, 96)}
FLOOR = {"moss": [0, 1, 3, 5, 6, 7, 16, 17, 2, 13], "mine": [1, 2, 7, 8, 13, 14, 12, 15],
         "water": [4, 6, 7, 13, 14, 16, 12], "wood": [0, 4, 5, 12, 13, 14, 6],
         "ember": [7, 8, 9, 12, 13, 14, 16], "spire": [0, 1, 7, 9, 12, 15, 6]}
HANG = {"moss": [9, 10, 11], "mine": [0, 10, 17], "water": [3, 9, 15], "wood": [1, 7, 9],
        "ember": [0, 11], "spire": [8, 11, 4]}


def slot(layout, name, off=0):
    r, c = layout[name]
    return (c + off, r)


def mock(theme, sheet, backdrop):
    W, H = 320, 148
    im = Image.new("RGBA", (W, 160), backdrop + (255,))
    d = ImageDraw.Draw(im)
    for y in range(160):  # gentle vertical gradient
        k = 1.0 - y / 400
        d.line([(0, y), (W, y)], fill=tuple(int(v * k) for v in backdrop) + (255,))
    rows, cols = len(LEVEL), len(LEVEL[0])

    def g(x, y):
        if 0 <= y < rows and 0 <= x < cols:
            return LEVEL[y][x]
        return "#"

    solid = set("#%DK")
    counters = {"f": 0, "h": 0}

    def tile(col, row):
        return sheet.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))

    for y in range(rows):
        for x in range(cols):
            ch = g(x, y)
            pos = None
            if ch == "#":
                m = sum(b for b, (dx, dy) in ((1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0)))
                        if g(x + dx, y + dy) in solid)
                pos = slot(SIDE_LAYOUT, "solid", m)
                if m == 15 and (x * 7 + y * 3) % 5 == 0:
                    pos = slot(SIDE_LAYOUT, "solid_var", (x + y) % 8)
            elif ch == "%":
                pos = slot(SIDE_LAYOUT, "solid_var", (x * 3 + y) % 8)
            elif ch == "B":
                m = sum(b for b, (dx, dy) in ((1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0)))
                        if g(x + dx, y + dy) in solid | {"B"})
                pos = slot(SIDE_LAYOUT, "backwall", m)
            elif ch == "=":
                l, r = g(x - 1, y) == "=", g(x + 1, y) == "="
                pos = slot(SIDE_LAYOUT, "ledge_m" if l and r else ("ledge_r" if l else ("ledge_l" if r else "ledge_one")))
            elif ch == "|":
                pos = slot(SIDE_LAYOUT, "vine" if g(x, y - 1) == "|" else "vine_top")
            elif ch == "~":
                pos = slot(SIDE_LAYOUT, "water" if g(x, y - 1) == "~" else "water_top")
            elif ch == "L":
                pos = slot(SIDE_LAYOUT, "lava" if g(x, y - 1) == "L" else "lava_top")
            elif ch == "X":
                pos = slot(SIDE_LAYOUT, "spikes")
            elif ch == "T":
                pos = slot(SIDE_LAYOUT, "thorns")
            elif ch == "C":
                pos = slot(SIDE_LAYOUT, "crumble", x % 4)
            elif ch == "K":
                pos = slot(SIDE_LAYOUT, "breakable")
            elif ch == "_":
                pos = slot(SIDE_LAYOUT, "bridge")
            elif ch == "I":
                pos = slot(SIDE_LAYOUT, "beam")
            elif ch == "O":
                pos = slot(SIDE_LAYOUT, "node")
            elif ch == "D":
                pos = slot(SIDE_LAYOUT, "dart_l")
            elif ch == "@":
                pos = slot(SIDE_LAYOUT, "blink", (x % 2))
            elif ch in "fh":
                lst = FLOOR[theme] if ch == "f" else HANG[theme]
                i = lst[counters[ch] % len(lst)]
                counters[ch] += 1
                pos = slot(SIDE_LAYOUT, "deco_a", i) if i < 10 else slot(SIDE_LAYOUT, "deco_b", i - 10)
            if pos:
                im.alpha_composite(tile(*pos), (x * 16, y * 16))
    return im.crop((0, 0, W, H))


MAPLEVEL = [
    "ffffffrrrrrrffffwwww",
    "ffgggfrrrrr.gg.fwwww",
    "fg.P==G===P.gs..=www",
    "fg.=..rr..=..s.g.www",
    "gg.=g.rr..=HT..g.bww",
    "wwwB..gg..=.......ww",
    "www=.fff..=====P..gw",
    "wwwP.ffff.E..u..rrrr",
    "wwwwg.ff......srrrrr",
]


def mock_map(sheet):
    rows, cols = len(MAPLEVEL), len(MAPLEVEL[0])
    im = Image.new("RGBA", (320, rows * 16), (0, 0, 0, 255))

    def g(x, y):
        if 0 <= y < rows and 0 <= x < cols:
            return MAPLEVEL[y][x]
        return MAPLEVEL[min(max(y, 0), rows - 1)][min(max(x, 0), cols - 1)]

    fam = {"path": set("P=GB"), "w": set("wB"), "f": set("f"), "r": set("r")}

    def mask(x, y, s):
        return sum(b for b, (dx, dy) in ((1, (0, -1)), (2, (1, 0)), (4, (0, 1)), (8, (-1, 0))) if g(x + dx, y + dy) in s)

    for y in range(rows):
        for x in range(cols):
            ch = g(x, y)
            if ch == "=":
                pos = slot(MAP_LAYOUT, "path", mask(x, y, fam["path"]))
            elif ch == "P":
                pos = slot(MAP_LAYOUT, "path", mask(x, y, fam["path"]))
            elif ch == "G":
                pos = slot(MAP_LAYOUT, "gate", 1)
            elif ch == "B":
                pos = slot(MAP_LAYOUT, "bridge_v")
            elif ch == "w":
                pos = slot(MAP_LAYOUT, "water", mask(x, y, fam["w"]))
            elif ch == "f":
                pos = slot(MAP_LAYOUT, "forest", mask(x, y, fam["f"]))
            elif ch == "r":
                pos = slot(MAP_LAYOUT, "rock", mask(x, y, fam["r"]))
            elif ch == "g":
                pos = slot(MAP_LAYOUT, "flowers", (x + y) % 4)
            elif ch == "s":
                pos = slot(MAP_LAYOUT, "sand", (x + y) % 4)
            elif ch == "H":
                pos = slot(MAP_LAYOUT, "house")
            elif ch == "T":
                pos = slot(MAP_LAYOUT, "tower")
            elif ch == "E":
                pos = slot(MAP_LAYOUT, "well")
            elif ch == "u":
                pos = slot(MAP_LAYOUT, "stump")
            else:
                pos = slot(MAP_LAYOUT, "grass", (x * 3 + y) % 4)
            c, r = pos
            im.alpha_composite(sheet.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16)), (x * 16, y * 16))
            if ch == "P":
                marker = os.path.join(ART, "marker.aseprite")
                if os.path.exists(marker):
                    im.alpha_composite(frame_image(A.read(marker), (x + y) % 4), (x * 16, y * 16))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=3)
    ap.add_argument("--only", default="")
    ap.add_argument("--no-mock", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = set(filter(None, a.only.split(",")))
    n = 0
    for name in SPRITES:
        if only and name not in only:
            continue
        if os.path.exists(os.path.join(ART, name + ".aseprite")):
            sprite_sheet(name, a.scale).save(os.path.join(a.out, name + ".png"))
            n += 1
    for theme in SIDE_THEMES + [MAP_THEME]:
        if only and theme not in only and "tiles_" + theme not in only:
            continue
        path = os.path.join(ART, "tiles_" + theme + ".aseprite")
        if not os.path.exists(path):
            continue
        big, raw = tile_sheet(theme, a.scale)
        big.save(os.path.join(a.out, "tiles_" + theme + ".png"))
        n += 1
        if a.no_mock:
            continue
        if theme == MAP_THEME:
            m = mock_map(raw)
        else:
            dark = mock(theme, raw, LIGHT[theme])
            light = mock(theme, raw, tuple(min(255, int(v * 2.1 + 30)) for v in LIGHT[theme]))
            m = Image.new("RGBA", (320, 148 * 2 + 2), (0, 0, 0, 255))
            m.paste(dark, (0, 0))
            m.paste(light, (0, 150))
        m.resize((m.width * a.scale, m.height * a.scale), Image.NEAREST).save(
            os.path.join(a.out, "mock_" + theme + ".png"))
    print(f"wrote {n} previews to {a.out}")


if __name__ == "__main__":
    main()
