"""The six stage tile sets (8 x 3 cells of 16 px; the cell names are in manifest.py).
Drawn in code with a seeded noise so each set is the same on every build.

    python3 pipeline/aseprite/art_tiles.py
"""
from __future__ import annotations

import random

from canvas import Canvas, dither
from manifest import THEMES, TILE_CELLS
from palette import N
from puppet import disc, thick
from sheet import save_tiles

# per theme: ground ramp (dark..light), surface colours, ledge, climb, extras
STYLE = {
    "reach": {"ground": ["leaf0", "wood0", "wood1"], "surface": ["leaf2", "leaf3", "leaf4"], "ledge": "wood",
              "climb": "vine", "water": ["sea0", "sea1", "leaf1"], "spikes": "silt", "crate": "wood"},
    "harbor": {"ground": ["stone0", "stone1", "stone2"], "surface": ["wood2", "wood3", "wood4"], "ledge": "wood",
               "climb": "rope", "water": ["sea0", "sea1", "sea2"], "spikes": "iron", "crate": "wood"},
    "village": {"ground": ["wood0", "wood1", "wood2"], "surface": ["silt1", "silt2", "wood4"], "ledge": "reed",
                "climb": "rope", "water": ["sea0", "sea1", "silt0"], "spikes": "silt", "crate": "wood"},
    "cliffs": {"ground": ["stone0", "stone1", "stone2"], "surface": ["leaf2", "leaf3", "stone3"], "ledge": "stone",
               "climb": "vine", "water": ["sea0", "sea1", "sea2"], "spikes": "iron", "crate": "stone"},
    "abbey": {"ground": ["night0", "night1", "night2"], "surface": ["night2", "night3", "stone3"], "ledge": "stone",
              "climb": "chain", "water": ["ink", "night0", "sea1"], "spikes": "salt", "crate": "stone"},
    "brinecrow": {"ground": ["wood0", "wood1", "wood2"], "surface": ["wood3", "wood4", "wood2"], "ledge": "wood",
                  "climb": "mast", "water": ["sea0", "sea1", "sea2"], "spikes": "iron", "crate": "wood"},
}


def cell(theme: str, name: str, seed: int) -> Canvas:
    s = STYLE[theme]
    r = random.Random(f"{theme}:{name}:{seed}")
    c = Canvas(16, 16)
    g0, g1, g2 = s["ground"]
    t0, t1, t2 = s["surface"]

    def ground(alt=False):
        for y in range(16):
            for x in range(16):
                v = r.random()
                col = g1 if v > 0.25 else g0
                if v > 0.9:
                    col = g2
                c.set(x, y, col)
        if theme in ("harbor", "abbey", "cliffs"):
            # blocks of stone
            for y in (5, 11) if not alt else (3, 9, 15):
                c.rect(0, y, 15, y, g0)
            off = 4 if alt else 9
            for y0, y1 in ((0, 4), (6, 10), (12, 15)):
                x = (off + y0) % 16
                c.rect(x, y0, x, y1, g0)
        elif theme == "brinecrow":
            for y in (3, 7, 11, 15):
                c.rect(0, y, 15, y, g0)
            c.set(r.randrange(16), r.randrange(16), g2)
        else:
            for _ in range(3):
                x, y = r.randrange(16), r.randrange(16)
                c.set(x, y, g2)
                c.set(x + 1, y, g2)

    if name in ("inner", "inner_alt", "under", "side_l", "side_r"):
        ground(name == "inner_alt")
        if name == "under":
            c.rect(0, 13, 15, 15, g0)
            for x in range(0, 16, 3):
                c.set(x, 15 - (x % 2), "ink")
        if name == "side_l":
            c.rect(0, 0, 1, 15, g0)
        if name == "side_r":
            c.rect(14, 0, 15, 15, g0)
        return c
    if name in ("top", "top_alt", "top_l", "top_r"):
        ground(name == "top_alt")
        c.rect(0, 0, 15, 3, t1)
        c.rect(0, 0, 15, 0, t2)
        for x in range(16):
            if r.random() < 0.45:
                c.set(x, 4, t0)
            if name == "top_alt" and r.random() < 0.3:
                c.set(x, 1, t2)
        if theme in ("reach", "cliffs") and name == "top_alt":
            for x in (3, 9, 13):
                c.set(x, 0, None)
                c.set(x, 1, t2)
        if name == "top_l":
            c.rect(0, 0, 1, 15, g0)
            c.set(0, 0, None)
        if name == "top_r":
            c.rect(14, 0, 15, 15, g0)
            c.set(15, 0, None)
        return c
    if name in ("ledge", "ledge_l", "ledge_r"):
        kind = s["ledge"]
        if kind == "wood":
            c.rect(0, 0, 15, 4, "wood3")
            c.rect(0, 0, 15, 0, "wood4")
            c.rect(0, 4, 15, 4, "wood1")
            for x in (4, 12):
                c.set(x, 2, "wood1")
        elif kind == "reed":
            c.rect(0, 0, 15, 4, "silt1")
            for x in range(0, 16, 2):
                c.rect(x, 0, x, 4, "silt2")
            c.rect(0, 4, 15, 4, "wood1")
        else:
            c.rect(0, 0, 15, 5, s["ground"][2])
            c.rect(0, 0, 15, 0, s["surface"][2])
            c.rect(0, 5, 15, 5, s["ground"][0])
        if name == "ledge_l":
            c.rect(0, 0, 0, 5, "ink")
            thick(c, 2, 5, 5, 12, 1.4, N["wood1"] if kind != "stone" else N[s["ground"][0]])
        if name == "ledge_r":
            c.rect(15, 0, 15, 5, "ink")
            thick(c, 13, 5, 10, 12, 1.4, N["wood1"] if kind != "stone" else N[s["ground"][0]])
        return c
    if name in ("climb", "climb_top"):
        kind = s["climb"]
        if kind == "vine":
            for y in range(16):
                x = 7 + (1 if (y // 4) % 2 else -1)
                c.rect(x, y, x + 1, y, "leaf2")
                if y % 5 == 2:
                    c.rect(x - 3, y, x - 1, y + 1, "leaf3")
                    c.rect(x + 2, y + 2, x + 4, y + 3, "leaf4")
        elif kind == "rope":
            for y in range(16):
                c.rect(7, y, 8, y, "wood3" if (y // 2) % 2 else "wood2")
        elif kind == "chain":
            for y in range(0, 16, 4):
                c.frame(6, y, 9, y + 3, "stone3")
        elif kind == "mast":
            c.rect(5, 0, 10, 15, "wood2")
            c.rect(5, 0, 5, 15, "wood1")
            c.rect(10, 0, 10, 15, "wood3")
            for y in (3, 11):
                c.rect(4, y, 11, y, "wood0")
        if name == "climb_top":
            c.rect(3, 0, 12, 1, "wood3" if kind != "vine" else "leaf3")
        return c
    if name == "spikes":
        kind = s["spikes"]
        col = {"silt": ("silt0", "silt2"), "iron": ("stone1", "stone4"), "salt": ("white", "stone4")}[kind]
        for i in range(4):
            x0 = i * 4
            for y in range(6, 16):
                w = (y - 6) // 3
                for x in range(x0 + 2 - w, x0 + 2 + w + 1):
                    c.set(x, y, col[0] if x > x0 + 1 else col[1])
        return c
    if name == "gate":
        c.rect(1, 0, 14, 15, "stone1")
        for x in (3, 7, 11):
            c.rect(x, 0, x + 1, 15, "stone3")
        c.rect(1, 6, 14, 7, "gold0")
        disc(c, 8, 7, 2, N["gold2"])
        c.set(8, 7, "ink")
        return c
    if name == "crate":
        if s["crate"] == "wood":
            c.rect(0, 0, 15, 15, "wood2")
            c.frame(0, 0, 15, 15, "wood0")
            c.frame(1, 1, 14, 14, "wood3")
            thick(c, 2, 2, 13, 13, 1.6, N["wood1"])
        else:
            c.rect(0, 0, 15, 15, s["ground"][1])
            c.frame(0, 0, 15, 15, s["ground"][0])
            c.rect(1, 1, 14, 1, s["surface"][2])
        return c
    if name in ("water", "water_top"):
        w0, w1, w2 = s["water"]
        for y in range(16):
            for x in range(16):
                c.set(x, y, w1 if dither(x, y, 0.5 - y / 40) else w0)
        if name == "water_top":
            c.rect(0, 0, 15, 2, w2)
            for x in range(0, 16, 5):
                c.set(x, 0, "white")
        return c
    if name.startswith("deco"):
        k = int(name[4])
        if theme in ("reach", "cliffs", "village"):
            # tufts and flowers to sit on top of ground
            for i in range(3 + k):
                x = r.randrange(1, 15)
                thick(c, x, 15, x + r.choice([-2, 0, 2]), 10 - r.randrange(4), 1, N[t0 if theme != "village" else "silt2"])
            if k % 2:
                c.set(r.randrange(2, 14), r.randrange(8, 12), "pink" if theme != "cliffs" else "white")
        elif theme == "abbey":
            if k < 2:
                c.rect(6, 4, 9, 15, "night1")
                c.rect(6, 4, 9, 5, "night3")
                disc(c, 7.5, 3, 2, N["orange1"] if k == 0 else N["sea3"])
            else:
                for i in range(4):
                    c.set(r.randrange(16), r.randrange(10, 16), "night3")
        else:
            if k == 0:
                c.rect(3, 8, 12, 15, "wood2")
                c.frame(3, 8, 12, 15, "wood0")
            elif k == 1:
                disc(c, 8, 11, 4.5, N["wood2"])
                c.rect(3, 10, 13, 11, "wood0")
            elif k == 2:
                for i in range(4):
                    thick(c, 2 + i * 3, 15, 4 + i * 3, 9, 1.2, N["wood3"])
            else:
                thick(c, 2, 12, 14, 12, 2, N["wood3"])
                disc(c, 3, 12, 2, N["wood1"])
        return c
    return c   # blank


def build() -> list[str]:
    out = []
    for theme in THEMES:
        sheet = Canvas(128, 48)
        for i, name in enumerate(TILE_CELLS):
            t = cell(theme, name, i)
            sheet.blit(t, (i % 8) * 16, (i // 8) * 16)
        out.append(save_tiles(theme, sheet))
    return out


if __name__ == "__main__":
    for p in build():
        print(p)
