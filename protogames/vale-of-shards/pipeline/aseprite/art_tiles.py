"""Tile sheets for Vale of Shards, drawn in code.

    python3 pipeline/aseprite/art_tiles.py        # writes art/aseprite/tiles_<theme>.aseprite

Six side-view themes (moss, mine, water, wood, ember, spire) follow SIDE_LAYOUT and the
overworld sheet "map" follows MAP_LAYOUT (pipeline/manifest.py). Every sheet is 256x96:
16 columns x 6 rows of 16x16 cells, transparent wherever air shows.

Autotile rows: the column is the neighbour mask (1 = same family above, 2 = right,
4 = below, 8 = left). Solid tiles get a walkable lip on an open top, a lit left rim, dark
right and bottom rims and a 1 px outline on open sides; the further a pixel is from an
open side the darker it gets, so mask 15 (and the solid_var cells) is the dark fill.
Backwall is a separate, darker, low-contrast material with no lip or outline.

Light comes from the upper left. Textures repeat every 16 px so tiles join seamlessly.
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sheet import save_tiles  # noqa: E402  (also puts pipeline/ on sys.path)
from canvas import Canvas  # noqa: E402
from palette import N  # noqa: E402
from manifest import MAP_LAYOUT, MAP_THEME, SIDE_LAYOUT, SIDE_THEMES  # noqa: E402

# ----------------------------------------------------------------------------- helpers


def put(c: Canvas, x: int, y: int, col) -> None:
    """Set a pixel; col may be a palette name, an index, or None to clear it."""
    if not (0 <= x < c.w and 0 <= y < c.h):
        return
    if col is None:
        c.px[y * c.w + x] = None
    else:
        c.px[y * c.w + x] = N[col] if isinstance(col, str) else col


def stamp(c: Canvas, rows, cmap: dict, ox: int = 0, oy: int = 0, flip: bool = False) -> None:
    """Draw ASCII art. Characters missing from cmap are skipped; a value of None clears."""
    for y, row in enumerate(rows):
        w = len(row)
        for x, ch in enumerate(row):
            if ch not in cmap:
                continue
            put(c, ox + (w - 1 - x if flip else x), oy + y, cmap[ch])


def stamp_bottom(c: Canvas, rows, cmap, dx: int = 0, flip=False) -> None:
    """ASCII art centred horizontally and resting on the bottom row."""
    w = max(len(r) for r in rows)
    stamp(c, [r.ljust(w) for r in rows], cmap, (c.w - w) // 2 + dx, c.h - len(rows), flip)


def ink(c: Canvas, col) -> Canvas:
    c.outline(N[col] if isinstance(col, str) else col)
    return c


def hsh(*a) -> int:
    n = 2166136261
    for v in a:
        n = ((n ^ (int(v) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    n ^= n >> 15
    n = (n * 2246822519) & 0xFFFFFFFF
    n ^= n >> 13
    return n


def shade_disc(c: Canvas, cx, cy, r, hi, mid, lo, dark=None):
    """A disc lit from the upper left: highlight crescent up-left, shadow down-right."""
    for y in range(int(cy - r - 1), int(cy + r + 2)):
        for x in range(int(cx - r - 1), int(cx + r + 2)):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d2 = dx * dx + dy * dy
            if d2 > r * r:
                continue
            k = (dx + dy) / (r * 1.41)
            if dark is not None and k > 0.62:
                col = dark
            elif k > 0.2:
                col = lo
            elif k < -0.35:
                col = hi
            else:
                col = mid
            put(c, x, y, col)


def flip(c: Canvas) -> Canvas:
    return c.flip_h()


def mirror_v(c: Canvas) -> Canvas:
    k = Canvas(c.w, c.h)
    for y in range(c.h):
        for x in range(c.w):
            k.px[y * c.w + x] = c.px[(c.h - 1 - y) * c.w + x]
    return k


# ----------------------------------------------------------------------------- textures
# A texture is a 16x16 grid of codes ('.' base, 'h' lit, 'd' crack/mortar, 'a'/'b' alt
# tint base/lit, plus theme-specific letters) and an optional grid of cell ids used to
# tone whole stones/bricks at once.


def cells_voronoi(pts, metric="e"):
    ids = [[0] * 16 for _ in range(16)]
    for y in range(16):
        for x in range(16):
            best, bi = 1e9, 0
            for i, (px, py) in enumerate(pts):
                dx = abs(x + 0.5 - px)
                dx = min(dx, 16 - dx)
                dy = abs(y + 0.5 - py)
                dy = min(dy, 16 - dy)
                if metric == "e":
                    d = dx * dx + dy * dy
                elif metric == "c":
                    d = max(dx, dy) + 0.01 * (dx + dy)
                else:
                    d = dx + dy
                if d < best - 1e-9:
                    best, bi = d, i
            ids[y][x] = bi
    return ids


def cells_bricks(rows):
    """rows: (y0, height, x offset, width)."""
    ids = [[0] * 16 for _ in range(16)]
    for ri, (y0, h, off, w) in enumerate(rows):
        for y in range(y0, y0 + h):
            for x in range(16):
                ids[y % 16][x] = ri * 100 + ((x - off) % 16) // w
    return ids


def codes_from_cells(ids, alt=()):
    out = []
    for y in range(16):
        row = ""
        for x in range(16):
            c = ids[y][x]
            r, d = ids[y][(x + 1) % 16], ids[(y + 1) % 16][x]
            lft, u = ids[y][(x - 1) % 16], ids[(y - 1) % 16][x]
            if r != c or d != c:
                row += "d"
            elif lft != c or u != c:
                row += "b" if c in alt else "h"
            else:
                row += "a" if c in alt else "."
        out.append(row)
    return out


def overlay(codes, marks):
    rows = [list(r) for r in codes]
    for (x, y), ch in marks.items():
        rows[y % 16][x % 16] = ch
    return ["".join(r) for r in rows]


def overlay_ascii(codes, art):
    rows = [list(r) for r in codes]
    for y, r in enumerate(art):
        for x, ch in enumerate(r):
            if ch != " ":
                rows[y][x] = ch
    return ["".join(r) for r in rows]


# ----------------------------------------------------------------------------- themes

MOSS_TEX = [
    "................",
    "...........pp...",
    "..r.......pqqd..",
    "..r........dd...",
    "...r............",
    "...r.......gg...",
    "....r.....gg....",
    "................",
    "......pp........",
    ".....pqqqd....h.",
    "......ddd....hd.",
    "................",
    ".hh.........r...",
    ".hd........r....",
    "..........r.....",
    "................",
]

LIP_GRASS = [
    "BAxBAAxBAAAxAABx",
    "AAAAAAAAAAAAAAAA",
    "BAABBBAABAABBBAB",
    "CBBCCBBCCBCCBCCB",
    "DCCD CDDC DCDDC ",
    " D    D   D  D  ",
    " s    s   s     ",
]
LIP_TIMBER = [
    "AAAAAAAAAAAAAAAB",
    "BBBCBBBBBBBCBBBC",
    "BoBBBBBBBoBBBBBC",
    "CCCCCCDCCCCCCCCD",
    "DDDDDDDDDDDDDDDD",
    "ssssssssssssssss",
]
LIP_COPE = [
    "AAAAAAAAAAAAAAAA",
    "ABBBBBBBBBBBBBBC",
    "BBBBBBBBBBBBBBBC",
    "CCCCCCCCCCCCCCCD",
    "DDmDDDDDmmDDDDmD",
    " sms    nms   n ",
    "  n      n      ",
]
LIP_LEAF = [
    "xAAAxxxAAAAxxAAx",
    "AAGAAxAAGAAAAAGA",
    "BAAABBAAAABBBAAB",
    "BBBBCBBBBBCBBBBB",
    "CBBCCCBBBCCCBBCC",
    "DCCD DCCCD DCCD ",
    " DD   DDD   DD  ",
    " s     s     s  ",
]
LIP_IRON = [
    "AAAAAAAAAAAAAAAA",
    "BBBBBBBBBBBBBBBC",
    "BoBBBBBBoBBBBBBC",
    "CCCCCCCCCCCCCCCD",
    "DDDDDDDDDDDDDDDD",
    "EEEsEEEEsssEEEEs",
    "ssssssssssssssss",
]
LIP_GLASS = [
    "AAAAAAAAAAAAAAAA",
    "BBBBABBBBBBBBABB",
    "CCCCCCCCCCCCCCCC",
    "DDDDDDDDDDDDDDDD",
    "ssssssssssssssss",
]


def _tex_mine():
    ids = cells_voronoi([(3, 3), (9.5, 1.5), (14.5, 5), (7, 7.5), (12, 10), (1.5, 11.5), (6, 13.5), (13.5, 15)])
    codes = codes_from_cells(ids, alt={1, 5})
    codes = overlay(codes, {(8, 6): "g", (9, 6): "g", (9, 7): "g", (3, 13): "c", (4, 12): "c"})
    return codes, ids


def _tex_water():
    ids = cells_bricks([(0, 8, 0, 16), (8, 8, 8, 16)])
    # split the long blocks unevenly so the wall is not a regular grid
    for y in range(8):
        for x in range(16):
            if x >= 10:
                ids[y][x] += 1
    for y in range(8, 16):
        for x in range(16):
            if 2 <= x < 8:
                ids[y][x] += 1
    codes = codes_from_cells(ids, alt={1, 101})
    codes = overlay(codes, {(1, 1): "m", (2, 1): "m", (11, 9): "m", (12, 9): "m", (13, 9): "m",
                            (5, 3): "h", (6, 3): "h", (5, 4): "d", (14, 12): "h", (14, 13): "d"})
    return codes, ids


def _tex_wood():
    edges = [0, 5, 9, 13]
    breaks = [6, 12, 3, 9]
    wob = [0, 0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0, 0, 1, 1, 0]
    ids = [[0] * 16 for _ in range(16)]
    for y in range(16):
        for x in range(16):
            xx = (x - wob[y]) % 16
            col = 0
            for i, e in enumerate(edges):
                if xx >= e:
                    col = i
            ids[y][x] = col * 10 + (1 if (y - breaks[col]) % 16 < 8 else 0)
    codes = codes_from_cells(ids, alt={11, 30})
    codes = overlay(codes, {(2, 2): "d", (2, 3): "d", (7, 9): "d", (7, 10): "d", (11, 14): "d",
                            (11, 5): "h", (15, 11): "d", (3, 13): "g", (4, 13): "g", (4, 14): "g"})
    return codes, ids


def _tex_ember():
    ids = cells_bricks([(0, 4, 0, 8), (4, 4, 4, 8), (8, 4, 0, 8), (12, 4, 4, 8)])
    codes = codes_from_cells(ids, alt={1, 200, 301})
    glow = {(x, 7): "e" for x in range(1, 7)}
    glow.update({(3, 4): "e", (3, 5): "e", (3, 6): "e", (11, 15): "e", (12, 15): "e", (13, 15): "e"})
    codes = overlay(codes, glow)
    return codes, ids


def _tex_spire():
    """Crystal shards leaning up and to the right: 45-degree bands, each with a lit
    upper-left face, a mid face and a shaded lower-right face, cut by chevron tips."""
    bands = [(0, 9, 2, False), (9, 7, 10, True)]   # u start, width, cut v, alt
    out = []
    for y in range(16):
        row = ""
        for x in range(16):
            u = (x + y) % 16
            for (u0, w, cut, alt) in bands:
                if u0 <= u < u0 + w:
                    break
            p = u - u0
            v = (x - y) % 16
            tip = (cut + abs(p - (w - 1) / 2) * 1.0)
            dv = (v - tip) % 16
            if p == w - 1 or dv < 1:
                ch = "d"
            elif dv < 2 and p < w / 2:
                ch = "w"
            else:
                ch = "h" if p < 2 else ("s" if p == w - 2 else ".")
                if alt:
                    ch = {"h": "b", ".": "a", "s": "S"}[ch]
            row += ch
        out.append(row)
    return out, None


def _grid(rows):
    return [list(r) for r in rows]


BACK_ROOTS = [
    "................",
    "..o.......o.....",
    "...o.....o......",
    "...o....o.......",
    "....o..o........",
    ".....oo.........",
    ".....o..........",
    "......o.....h...",
    "......o....hh...",
    ".....o..........",
    "....o...........",
    "...o......o.....",
    "..o........o....",
    "..o.........o...",
    ".o...........o..",
    "................",
]
BACK_LEAVES = [
    "................",
    "..hh.......o....",
    ".hhoo.....ooo...",
    "..ooo......o....",
    "...o............",
    "........hh......",
    ".......hhoo.....",
    "........oo......",
    "..........o.....",
    "..o.............",
    ".ooo........hh..",
    "..o........hhoo.",
    "............oo..",
    "......hh........",
    ".....hhoo.......",
    "......oo........",
]


def T(**kw):
    return kw


THEMES = {
    "moss": T(
        trap=["stone3", "stone2", "stone1", "ink"],
        tex=(MOSS_TEX, None),
        col={".": ["wood3", "wood2", "wood1", "wood0"], "h": ["wood4", "wood3", "wood2", "wood1"],
             "d": ["wood1", "wood1", "wood0", "ink"], "p": ["stone4", "stone3", "stone2", "stone1"],
             "q": ["stone3", "stone2", "stone1", "stone0"], "r": ["wood4", "wood3", "wood2", "wood1"],
             "g": ["moss3", "moss2", "moss1", "moss0"]},
        ol="ink", lip=LIP_GRASS, lipc={"A": "moss4", "B": "moss3", "C": "moss2", "D": "moss1"},
        ragged="ooxooooxxooooxoo",
        back=(BACK_ROOTS, {".": "ink", "o": "moss0", "h": "stone0"}), back_rag=True,
        plank=["wood3", "wood2", "wood1", "wood0"], ledge="log", vine="vine",
        glow=["shard0", "shard1", "shard2", "shard3"], spike="metal", beam="post",
        feat={"o": "ink", "1": "wood2", "2": "wood1", "3": "shard1"},
    ),
    "mine": T(
        trap=["stone3", "stone2", "stone1", "ink"],
        tex=_tex_mine(),
        col={".": ["stone3", "stone2", "stone1", "stone1"], "h": ["stone4", "stone3", "stone2", "stone1"],
             "d": ["stone1", "stone1", "stone0", "stone0"], "a": ["wood3", "wood2", "stone1", "stone1"],
             "b": ["wood4", "wood3", "stone2", "stone1"], "g": ["gold2", "gold1", "gold0", "stone2"],
             "c": ["shard3", "shard2", "shard1", "stone2"]},
        ol="ink", lip=LIP_TIMBER, lipc={"A": "wood4", "B": "wood3", "C": "wood2", "D": "wood1", "o": "stone4"},
        ragged="oooxooooooxxoooo",
        back=None, back_rag=True,
        plank=["wood4", "wood3", "wood2", "wood0"], ledge="plank", vine="rope",
        glow=["gold0", "gold1", "gold2", "white"], spike="metal", beam="timber",
        feat={"o": "stone0", "1": "stone3", "2": "stone2", "3": "gold1"},
    ),
    "water": T(
        trap=["shard2", "shard1", "shard0", "ink"],
        tex=_tex_water(),
        col={".": ["shard2", "shard1", "shard0", "shard0"], "h": ["shard3", "shard2", "shard1", "shard1"],
             "d": ["shard0", "water0", "water0", "ink"], "a": ["water3", "water2", "shard1", "shard0"],
             "b": ["water4", "water3", "shard2", "shard1"], "m": ["moss4", "moss3", "moss2", "moss1"]},
        ol="ink", lip=LIP_COPE, lipc={"A": "stone4", "B": "water4", "C": "water3", "D": "water1",
                                      "m": "moss3", "n": "moss2"},
        ragged=None,
        back=None, back_rag=False,
        plank=["stone4", "water3", "water2", "water0"], ledge="slab", vine="algae",
        glow=["water1", "water2", "water3", "water4"], spike="metal", beam="column",
        feat={"o": "water0", "1": "shard1", "2": "shard0", "3": "moss2"},
    ),
    "wood": T(
        trap=["wood3", "wood2", "wood1", "ink"],
        tex=_tex_wood(),
        col={".": ["wood4", "wood3", "wood2", "wood1"], "h": ["skin2", "wood4", "wood3", "wood2"],
             "d": ["wood2", "wood1", "wood0", "wood0"], "a": ["wood3", "wood2", "wood1", "wood1"],
             "b": ["wood4", "wood3", "wood2", "wood2"], "g": ["moss4", "moss3", "moss2", "moss1"]},
        ol="ink", lip=LIP_LEAF, lipc={"A": "moss4", "B": "moss3", "C": "moss2", "D": "moss1", "G": "gold2"},
        ragged="oxooooxooooooxoo",
        back=(BACK_LEAVES, {".": "moss0", "o": "ink", "h": "moss1"}), back_rag=True,
        plank=["wood3", "wood2", "wood1", "wood0"], ledge="branch", vine="leafvine",
        glow=["moss1", "moss3", "moss4", "gold2"], spike="thorn", beam="trunk",
        feat={"o": "wood0", "1": "wood3", "2": "wood2", "3": "moss2"},
    ),
    "ember": T(
        trap=["stone3", "stone1", "stone0", "ink"],
        tex=_tex_ember(),
        col={".": ["fire2", "fire1", "fire0", "fire0"], "h": ["fire3", "fire2", "fire1", "fire1"],
             "d": ["stone1", "stone0", "ink", "ink"], "a": ["wood2", "wood1", "wood0", "stone0"],
             "b": ["wood3", "wood2", "wood1", "stone1"], "e": ["fire5", "fire4", "fire3", "fire1"]},
        ol="ink", lip=LIP_IRON, lipc={"A": "stone4", "B": "stone3", "C": "stone2", "D": "stone1",
                                      "o": "white", "E": "fire4"},
        ragged=None,
        back=None, back_rag=False,
        plank=["stone4", "stone3", "stone1", "ink"], ledge="grate", vine="chain",
        glow=["fire1", "fire3", "fire4", "fire5"], spike="hot", beam="ibeam",
        feat={"o": "ink", "1": "fire2", "2": "fire1", "3": "fire4"},
    ),
    "spire": T(
        trap=["violet3", "violet2", "violet1", "ink"],
        tex=_tex_spire(),
        col={".": ["violet3", "violet2", "violet1", "violet0"], "h": ["white", "violet3", "violet2", "violet1"],
             "s": ["violet2", "violet1", "violet0", "violet0"],
             "d": ["violet0", "violet0", "ink", "ink"], "a": ["violet3", "violet2", "violet1", "violet0"],
             "b": ["water4", "water3", "violet2", "violet1"], "S": ["violet2", "violet1", "violet0", "violet0"],
             "w": ["white", "white", "violet3", "violet2"]},
        ol="ink", lip=LIP_GLASS, lipc={"A": "white", "B": "water4", "C": "water3", "D": "violet1"},
        ragged=None,
        back=None, back_rag=False,
        plank=["white", "violet3", "violet2", "violet0"], ledge="glass", vine="crystal",
        glow=["violet1", "violet2", "violet3", "white"], spike="crystal", beam="pillar",
        feat={"o": "ink", "1": "violet2", "2": "violet1", "3": "water3"},
    ),
}


def _back_cells(ids, base, lit, dark, alt=None, altc=None):
    codes = codes_from_cells(ids, alt=alt or ())
    return codes, {".": base, "h": lit, "d": dark, "a": altc or base, "b": lit}


THEMES["mine"]["back"] = _back_cells(
    cells_voronoi([(4, 3), (12, 5), (7, 11), (14, 14), (1, 9)]), "stone0", "stone1", "ink")
THEMES["water"]["back"] = _back_cells(
    cells_bricks([(0, 8, 0, 16), (8, 8, 8, 16)]), "water0", "water1", "ink")
THEMES["ember"]["back"] = _back_cells(
    cells_bricks([(0, 8, 0, 8), (8, 8, 4, 8)]), "stone0", "stone1", "ink", alt={1, 100}, altc="fire0")
THEMES["spire"]["back"] = _back_cells(
    cells_voronoi([(4, 4), (12, 3), (8, 11), (1, 13), (14, 12)], metric="c"), "ink", "violet0", "ink")

# ----------------------------------------------------------------------------- solid


def _tone(x, y, exp, lipd):
    top, right, bot, left = exp
    t = 4.0
    if top:
        t = min(t, 1.7 + max(0, y - lipd) * 0.3)
    if left:
        t = min(t, 1.0 + max(0, x - 1) * 0.3)
    if right:
        t = min(t, 2.1 + max(0, 14 - x) * 0.3)
    if bot:
        t = min(t, 2.3 + max(0, 14 - y) * 0.3)
    return t


def _components(ids):
    comp = [[-1] * 16 for _ in range(16)]
    n = 0
    for y in range(16):
        for x in range(16):
            if comp[y][x] >= 0:
                continue
            stack = [(x, y)]
            comp[y][x] = n
            while stack:
                a, b = stack.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    X, Y = a + dx, b + dy
                    if 0 <= X < 16 and 0 <= Y < 16 and comp[Y][X] < 0 and ids[Y][X] == ids[b][a]:
                        comp[Y][X] = n
                        stack.append((X, Y))
            n += 1
    return comp, n


def solid_tile(th, mask: int, shift: float = 0.0) -> Canvas:
    t = Canvas(16, 16)
    exp = (not mask & 1, not mask & 2, not mask & 4, not mask & 8)
    top, right, bot, left = exp
    codes, ids = th["tex"]
    lip = th["lip"]
    lipd = sum(1 for r in lip if r.strip(" s")) if top else 0
    tone = [[_tone(x, y, exp, lipd) + shift for x in range(16)] for y in range(16)]
    lvl = [[0] * 16 for _ in range(16)]
    if ids is not None:
        comp, n = _components(ids)
        acc = [[0.0, 0] for _ in range(n)]
        for y in range(16):
            for x in range(16):
                a = acc[comp[y][x]]
                a[0] += tone[y][x]
                a[1] += 1
        for y in range(16):
            for x in range(16):
                a = acc[comp[y][x]]
                v = a[0] / a[1]
                # the exposed rim itself stays per-pixel so edges read crisply
                v = min(v, tone[y][x] + 0.9)
                lvl[y][x] = max(1, min(4, int(v + 0.5)))
    else:
        for y in range(16):
            for x in range(16):
                wob = 0.3 * math.sin((x * 2 + y) * 0.9)
                lvl[y][x] = max(1, min(4, int(tone[y][x] + 0.5 + wob)))
    col = th["col"]
    for y in range(16):
        for x in range(16):
            ch = codes[y][x]
            ramp = col.get(ch, col["."])
            put(t, x, y, ramp[lvl[y][x] - 1])
    ol = th["ol"]
    lipc = th["lipc"]
    # lip on an open top
    if top:
        for y, row in enumerate(lip):
            for x, ch in enumerate(row):
                if ch == " ":
                    continue
                if ch == "x":
                    put(t, x, y, None)
                elif ch == "s":
                    ramp = col.get(codes[y][x], col["."])
                    put(t, x, y, ramp[min(3, lvl[y][x])])
                else:
                    put(t, x, y, lipc[ch])
    # rims and outline on open sides
    lipdark = lipc["D"]
    for y in range(16):
        in_lip = top and y < lipd
        if left:
            put(t, 0, y, lipdark if in_lip else ol)
        if right:
            put(t, 15, y, lipdark if in_lip else ol)
    if bot:
        rag = th["ragged"]
        for x in range(16):
            if rag:
                if rag[x] == "o":
                    put(t, x, 15, ol)
                else:
                    put(t, x, 15, None)
                    put(t, x, 14, ol)
            else:
                put(t, x, 15, ol)
        if left:
            put(t, 0, 15, None)
        if right:
            put(t, 15, 15, None)
    if top and left:
        put(t, 0, 0, None)
    if top and right:
        put(t, 15, 0, None)
    return t


def backwall_tile(th, mask: int) -> Canvas:
    t = Canvas(16, 16)
    codes, cmap = th["back"]
    for y in range(16):
        for x in range(16):
            put(t, x, y, cmap.get(codes[y][x], cmap["."]))
    exp = (not mask & 1, not mask & 2, not mask & 4, not mask & 8)
    top, right, bot, left = exp
    rag = th["back_rag"]
    edge = cmap.get("d", "ink") if not rag else "ink"
    for i in range(16):
        # organic walls fray at open edges, built ones end in a dark line
        cut = (hsh(i, 7) % 3 == 0) if rag else False
        if top:
            put(t, i, 0, None if cut else edge)
        if bot:
            put(t, i, 15, None if (rag and hsh(i, 9) % 3 == 0) else edge)
        if left:
            put(t, 0, i, None if (rag and hsh(i, 11) % 3 == 0) else edge)
        if right:
            put(t, 15, i, None if (rag and hsh(i, 13) % 3 == 0) else edge)
    for (cx, cy, a, b) in ((0, 0, top, left), (15, 0, top, right), (0, 15, bot, left), (15, 15, bot, right)):
        if a and b:
            put(t, cx, cy, None)
    return t


FEATURES = [
    (["  1122  ", " 122222 ", " 222223 ", "  3333  "], (4, 5)),
    (["o     ", " o    ", " oo   ", "   o  ", "   oo ", "     o"], (5, 5)),
    (["    33", "  332 ", " 32   ", "3     "], (6, 6)),
    ([" 111 ", "1 2 1", "1 21 ", " 1   "], (5, 6)),
    (["2   2", " 2 2 ", "  2  ", "  2  ", " 2   "], (6, 4)),
    (["33   ", "3  3 ", "   3 ", " 3   "], (5, 7)),
    (["1    1", " 1111 ", "1    1"], (5, 7)),
    ([" oo ", "oooo", "oooo", " oo "], (6, 6)),
]


def solid_var(th, i: int) -> Canvas:
    t = solid_tile(th, 15)
    art, (ox, oy) = FEATURES[i]
    stamp(t, art, th["feat"], ox, oy)
    return t


# ----------------------------------------------------------------------------- row 2+


def ledge(th, kind: str) -> Canvas:
    """One-way platform: a 5-6 px surface on top, transparent below (bar brackets)."""
    t = Canvas(16, 16)
    hi, mid, lo, dk = th["plank"]
    style = th["ledge"]
    lend = kind in ("l", "one")
    rend = kind in ("r", "one")
    x0 = 1 if lend else 0
    x1 = 14 if rend else 15
    if style in ("plank", "log", "slab"):
        for x in range(x0, x1 + 1):
            put(t, x, 0, hi)
            for y in (1, 2, 3):
                put(t, x, y, mid)
            put(t, x, 4, lo)
            put(t, x, 5, dk)
        # grain / joints
        for x in range(x0, x1 + 1):
            if (x * 5 + 3) % 11 < 3:
                put(t, x, 2, lo)
        if style == "plank":
            for x in (3, 12):
                if x0 <= x <= x1:
                    put(t, x, 2, "stone4")
            if kind == "m":
                for y in range(1, 5):
                    put(t, 15, y, lo)
        if style == "log":
            for x in range(x0, x1 + 1):
                if hsh(x, 3) % 4:
                    put(t, x, 0, "moss3" if hsh(x, 5) % 3 else "moss4")
                if hsh(x, 4) % 3 == 0:
                    put(t, x, 1, "moss2")
        if style == "slab":
            for x in range(x0, x1 + 1):
                if hsh(x, 6) % 5 == 0:
                    put(t, x, 6, "moss2")
                    if hsh(x, 8) % 2:
                        put(t, x, 7, "moss1")
        if lend:
            for y in range(0, 6):
                put(t, 0, y, dk)
            put(t, 0, 0, None)
            put(t, 1, 0, mid)
            put(t, 0, 5, None)
            if style == "log":
                for (x, y, c) in ((1, 1, lo), (1, 2, "wood4"), (2, 2, lo), (1, 3, lo)):
                    put(t, x, y, c)
        if rend:
            for y in range(0, 6):
                put(t, 15, y, dk)
            put(t, 15, 0, None)
            put(t, 15, 5, None)
            put(t, 14, 0, mid)
        # brackets under the ends
        if style != "log":
            if lend:
                for i in range(4):
                    put(t, 2, 6 + i, dk)
                    put(t, 3 + i, 6 + i, None)
                for i in range(3):
                    put(t, 3 + i, 6 + i, lo)
                    put(t, 3 + i, 7 + i, dk)
            if rend:
                for i in range(4):
                    put(t, 13, 6 + i, dk)
                for i in range(3):
                    put(t, 12 - i, 6 + i, lo)
                    put(t, 12 - i, 7 + i, dk)
    elif style == "branch":
        for x in range(x0, x1 + 1):
            put(t, x, 0, "wood4")
            put(t, x, 1, hi)
            put(t, x, 2, mid)
            put(t, x, 3, mid if (x + 1) % 7 else lo)
            put(t, x, 4, lo)
            put(t, x, 5, dk)
        for x in (4, 11):
            if x0 <= x <= x1:
                put(t, x, 2, lo)
                put(t, x + 1, 2, dk)
        if lend:
            stamp(t, ["  ", "d ", "dd", "d ", " d"], {"d": dk}, 0, 0)
            put(t, 0, 0, None)
            stamp(t, [" g ", "gGg", " g "], {"g": "moss3", "G": "moss4"}, 1, 5)
        if rend:
            stamp(t, [" d", "dd", "d ", "d "], {"d": dk}, 14, 1)
            put(t, 15, 0, None)
            put(t, 15, 5, None)
        if kind == "m":
            stamp(t, [" g", "gG", "g "], {"g": "moss2", "G": "moss3"}, 7, 6)
    elif style == "grate":
        for x in range(x0, x1 + 1):
            put(t, x, 0, hi)
            put(t, x, 1, mid)
            put(t, x, 4, mid)
            put(t, x, 5, dk)
            for y in (2, 3):
                put(t, x, y, dk if x % 3 else lo)
        for x in range(x0, x1 + 1):
            if x % 3 == 0:
                put(t, x, 2, mid)
                put(t, x, 3, lo)
        if kind != "m":
            pass
        if lend:
            for y in range(6):
                put(t, 0, y, dk)
            put(t, 0, 0, None)
            put(t, 1, 2, "stone4")
            stamp(t, ["d", "dd", "dld", "dlld"], {"d": dk, "l": lo}, 1, 6)
        if rend:
            for y in range(6):
                put(t, 15, y, dk)
            put(t, 15, 0, None)
            stamp(t, ["   d", "  dd", " dld", "dlld"], {"d": dk, "l": lo}, 11, 6)
    elif style == "glass":
        for x in range(x0, x1 + 1):
            put(t, x, 0, hi)
            put(t, x, 1, "water4")
            put(t, x, 2, mid)
            put(t, x, 3, lo)
            put(t, x, 4, dk)
        for x in range(x0, x1 + 1):
            if x % 8 == 5:
                put(t, x, 1, "white")
                put(t, x + 1, 2, "water4")
        if lend:
            stamp(t, [" ", "d", "d", "d"], {"d": dk}, 0, 0)
            put(t, 1, 4, None)
            put(t, 1, 0, "water4")
            stamp(t, ["  d", " d", "d"], {"d": "violet2"}, 2, 5)
        if rend:
            stamp(t, [" ", "d", "d", "d"], {"d": dk}, 15, 0)
            put(t, 14, 4, None)
            stamp(t, ["d", " d", "  d"], {"d": "violet2"}, 11, 5)
    return t


def vine(th, top: bool) -> Canvas:
    t = Canvas(16, 16)
    style = th["vine"]
    if style in ("vine", "leafvine", "algae"):
        if style == "algae":
            stem, sthi, leaf, lhi, ldk = "shard1", "shard2", "moss2", "moss3", "shard0"
        elif style == "leafvine":
            stem, sthi, leaf, lhi, ldk = "wood1", "wood2", "moss3", "moss4", "moss1"
        else:
            stem, sthi, leaf, lhi, ldk = "moss1", "moss2", "moss3", "moss4", "moss1"
        wob = [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0]
        y0 = 3 if top else 0
        for y in range(y0, 16):
            x = 7 + wob[y]
            put(t, x, y, stem)
            put(t, x + 1, y, sthi if style != "leafvine" else stem)
            if style == "leafvine":
                put(t, x - 1, y, "wood0")
                put(t, x + 2, y, "wood0")
                put(t, x + 1, y, "wood2" if y % 5 else "wood3")
        leaves = [(2, -1), (6, 1), (10, -1), (14, 1)]
        for (ly, side) in leaves:
            if ly < y0 + 1:
                continue
            x = 7 + wob[ly] + (3 if side > 0 else -3)
            if style == "algae":
                stamp(t, ["ll", "lL", " l"], {"l": leaf, "L": lhi}, x - (0 if side > 0 else 0), ly - 1)
            else:
                art = ["  Ll", " LLl", "lll "] if side > 0 else ["lL  ", "lLL ", " lll"]
                stamp(t, art, {"L": lhi, "l": leaf}, x - (1 if side > 0 else 2), ly - 1)
                put(t, x + (-1 if side > 0 else 1), ly + 1, ldk)
        if top:
            stamp(t, [" dLLLd  ", "dLLlLLld", "dlLllldd", " dllld  "],
                  {"L": lhi, "l": leaf, "d": ldk}, 4, 0)
        if style == "algae":
            for (bx, by) in ((11, 5), (12, 11), (4, 13)):
                put(t, bx, by, "water4")
    elif style == "rope":
        y0 = 4 if top else 0
        for y in range(y0, 16):
            ph = y % 4
            put(t, 6, y, "wood0")
            put(t, 10, y, "wood0")
            for x in (7, 8, 9):
                k = (x - 7 + ph) % 4
                put(t, x, y, "wood4" if k == 0 else ("wood3" if k < 3 else "wood2"))
        if top:
            stamp(t, ["  oooo  ", " o    o ", " o    o ", "  oooo  "],
                  {"o": "stone3"}, 4, 0)
            stamp(t, ["dddddd", "dwwwwd"], {"d": "wood0", "w": "wood2"}, 5, 3)
    elif style == "chain":
        y0 = 3 if top else 0
        for y in range(y0, 16):
            if (y // 4) % 2 == 0:
                # link seen face on
                ph = y % 4
                row = [" o o ", "o   o", "o   o", " o o "][ph]
                stamp(t, [row], {"o": "stone3"}, 5, y)
                put(t, 5 if ph in (1, 2) else 6, y, "stone4")
            else:
                put(t, 7, y, "stone3")
                put(t, 8, y, "stone1")
        # clean ink shadow
        for y in range(y0, 16):
            for x in range(4, 12):
                if t.get(x, y) is None and (t.get(x - 1, y) is not None) and x - 1 >= 5:
                    pass
        if top:
            stamp(t, ["dddddddd", "dlllllld", " dd  dd "], {"d": "ink", "l": "stone2"}, 4, 0)
    elif style == "crystal":
        y0 = 2 if top else 0
        for y in range(y0, 16):
            put(t, 7, y, "violet1")
        for by in (1, 7, 13):
            if by < y0:
                continue
            stamp(t, ["  a  ", " aWb ", "aWbbc", " bbc ", "  c  "],
                  {"a": "violet3", "W": "white", "b": "violet2", "c": "violet0"}, 5, by - 2)
        if top:
            stamp(t, ["dddddd", " dlld "], {"d": "violet0", "l": "violet2"}, 5, 0)
    return t


def _block(th, shift=0.0) -> Canvas:
    return solid_tile(th, 0, shift)


def crumble(th, stage: int) -> Canvas:
    t = solid_tile(th, 2 | 8)
    ids = cells_voronoi([(2, 3), (7, 2), (12, 3), (4, 8), (10, 8), (14, 10), (2, 13), (8, 13), (13, 14)])
    # break order: lower cells go first, the top-middle cell lasts longest
    order = sorted(range(9), key=lambda i: (-[3, 2, 3, 8, 8, 10, 13, 13, 14][i], hsh(i, 1) % 3))
    gone = set(order[:[0, 2, 5, 8][stage]])
    ol = th["ol"]
    for y in range(16):
        for x in range(16):
            c = ids[y][x]
            if c in gone:
                put(t, x, y, None)
                continue
            if stage >= 1 and t.get(x, y) is not None:
                r = ids[y][x + 1] if x < 15 else c
                d = ids[y + 1][x] if y < 15 else c
                if (r != c or d != c) and (stage >= 2 or hsh(x, y) % 2):
                    put(t, x, y, ol)
    if stage == 0:
        stamp(t, ["o  ", " o ", " o", "  o"], {"o": ol}, 9, 7)
    # outline the remaining fragments
    frag = Canvas(16, 16)
    frag.px = list(t.px)
    frag.outline(N[ol])
    for i in range(256):
        if t.px[i] is None and frag.px[i] is not None:
            y = i // 16
            if y > 5 and stage > 0:
                t.px[i] = frag.px[i]
    return t


def breakable(th) -> Canvas:
    t = solid_tile(th, 0, shift=-0.6)
    ol = th["ol"]
    hi = th["col"]["h"][0]
    crack = [
        "        o       ",
        "        o       ",
        "       o        ",
        "  o    o     o  ",
        "   o  oo    o   ",
        "    oo  o  o    ",
        "     o   oo     ",
        "  ooo o  o      ",
        "       ooo ooo  ",
        "      o   o     ",
        "     o     o    ",
        "    o       o   ",
        "   o        o   ",
        "            o   ",
    ]
    for y, row in enumerate(crack):
        for x, ch in enumerate(row):
            if ch == "o":
                put(t, x, y + 1, ol)
                if x + 1 < 16 and row[x + 1:x + 2] != "o" and t.get(x + 1, y + 1) is not None:
                    put(t, x + 1, y + 1, hi)
    return t


def blink(th, phase: int) -> Canvas:
    t = Canvas(16, 16)
    dk, mid, br, wh = th["glow"]
    if phase == 0:
        t.rect(0, 0, 15, 15, mid)
        t.frame(0, 0, 15, 15, dk)
        t.rect(1, 1, 14, 1, br)
        t.rect(1, 1, 1, 14, br)
        stamp(t, ["   w   ", "  wbb  ", " wbbbm ", "wbbbbmm", " bbbmm ", "  bmm  ", "   m   "],
              {"w": wh, "b": br, "m": mid}, 4, 4)
        for (x, y) in ((0, 0), (15, 0), (0, 15), (15, 15)):
            put(t, x, y, None)
        put(t, 2, 2, wh)
    elif phase == 1:
        t.rect(0, 0, 15, 15, dk)
        t.frame(0, 0, 15, 15, mid)
        t.rect(1, 1, 14, 1, mid)
        stamp(t, ["   b   ", "  bmm  ", " bmmmd ", "bmmmmdd", " mmmdd ", "  mdd  ", "   d   "],
              {"b": br, "m": mid, "d": dk}, 4, 4)
        for (x, y) in ((0, 0), (15, 0), (0, 15), (15, 15)):
            put(t, x, y, None)
    elif phase == 2:
        t.frame(0, 0, 15, 15, mid)
        for y in range(1, 15):
            for x in range(1, 15):
                if (x + y) % 2 == 0 and (x // 2 + y // 2) % 2 == 0:
                    put(t, x, y, dk)
        stamp(t, ["   m   ", "  m m  ", " m   m ", "m     m", " m   m ", "  m m  ", "   m   "],
              {"m": mid}, 4, 4)
        for (x, y) in ((0, 0), (15, 0), (0, 15), (15, 15)):
            put(t, x, y, None)
    else:
        for i in range(1, 15):
            if i % 3 != 2:
                put(t, i, 0, dk)
                put(t, i, 15, dk)
                put(t, 0, i, dk)
                put(t, 15, i, dk)
        stamp(t, ["   d   ", "       ", "       ", "d     d", "       ", "       ", "   d   "],
              {"d": dk}, 4, 4)
    return t


def bridge(th) -> Canvas:
    t = Canvas(16, 16)
    pal = ["wood4", "wood3", "wood2", "wood0"]
    if th["ledge"] == "grate":
        pal = ["stone4", "stone3", "stone1", "ink"]
    elif th["ledge"] == "glass":
        pal = ["white", "violet3", "violet2", "violet0"]
    hi, mid, lo, dk = pal
    for x in range(16):
        edge = x % 4 == 3
        put(t, x, 0, dk if edge else hi)
        for y in (1, 2, 3):
            put(t, x, y, dk if edge else (mid if (x + y) % 5 else lo))
        put(t, x, 4, dk if edge else lo)
        put(t, x, 5, dk)
    rope = "wood1" if th["ledge"] != "glass" else "violet1"
    for x in range(16):
        y = 7 + int(round(1.5 * math.sin(math.pi * x / 16)))
        put(t, x, y, rope)
    for x in (1, 9):
        for y in range(6, 8 + (1 if x == 9 else 0)):
            put(t, x, y, rope)
    return t


def water_top(frame: int, pal=("water4", "water3", "water2", "water1", "white")) -> Canvas:
    hi, a, b, base, foam = pal
    t = Canvas(16, 16)
    for x in range(16):
        w = math.sin(2 * math.pi * (x / 16 + frame / 4))
        y0 = 4 + (1 if w > 0.5 else (-1 if w < -0.5 else 0))
        for y in range(y0, 16):
            if y == y0:
                c = hi
            elif y == y0 + 1:
                c = a
            elif y <= y0 + 3:
                c = b
            else:
                c = base
            put(t, x, y, c)
        if abs(w) < 0.35 and w < 0 or (x + frame * 4) % 16 in (2, 3):
            put(t, x, y0, foam)
    _shimmer(t, frame, pal, 9)
    return t


def _shimmer(t, frame, pal, ystart):
    hi, a, b, base, foam = pal
    dashes = [(1, 9), (9, 11), (4, 13), (12, 15), (6, 7)]
    for (x, y) in dashes:
        if y < ystart:
            continue
        xx = x + (2 if frame % 2 else 0)
        for i in range(3):
            put(t, (xx + i) % 16, y, b)


def water_body(frame: int, pal=("water4", "water3", "water2", "water1", "white")) -> Canvas:
    t = Canvas(16, 16, N[pal[3]])
    _shimmer(t, frame, pal, 0)
    for (x, y) in ((3, 3), (11, 5)):
        xx = x + (2 if frame % 2 else 0)
        put(t, xx % 16, y, pal[2])
        put(t, (xx + 1) % 16, y, pal[2])
    return t


def lava_top(frame: int) -> Canvas:
    t = Canvas(16, 16)
    for x in range(16):
        w = math.sin(2 * math.pi * (x / 16 * 2 + frame / 4))
        y0 = 4 + (1 if w > 0.5 else (-1 if w < -0.6 else 0))
        for y in range(y0, 16):
            if y == y0:
                c = "fire5"
            elif y == y0 + 1:
                c = "fire4"
            elif y <= y0 + 3:
                c = "fire3"
            else:
                c = "fire2"
            put(t, x, y, c)
    # a bubble that swells and pops
    bx = [3, 3, 11, 11][frame]
    if frame % 2 == 0:
        stamp(t, [" y ", "yWy"], {"y": "fire5", "W": "white"}, bx, 1)
    else:
        put(t, bx + 1, 2, "fire5")
    _lava_crust(t, frame, 8)
    return t


def _lava_crust(t, frame, ystart):
    crust = [(2, 9, 4), (10, 12, 3), (6, 14, 4), (13, 6, 2), (0, 3, 3)]
    for (x, y, n) in crust:
        if y < ystart:
            continue
        xx = x + (1 if frame % 2 else 0)
        for i in range(n):
            put(t, (xx + i) % 16, y, "fire1")
        put(t, (xx + 1) % 16, y - 1, "fire3")
    for (x, y) in ((5, 11), (13, 15), (1, 7)):
        if y < ystart:
            continue
        xx = x - (1 if frame % 2 else 0)
        put(t, xx % 16, y, "fire4")
        put(t, (xx + 1) % 16, y, "fire4")


def lava_body(frame: int) -> Canvas:
    t = Canvas(16, 16, N["fire2"])
    _lava_crust(t, frame, 0)
    return t


def spikes(th) -> Canvas:
    t = Canvas(16, 16)
    kind = th["spike"]
    if kind == "crystal":
        hi, mid, lo, dk, tip = "white", "violet3", "violet2", "violet0", "white"
    elif kind == "thorn":
        hi, mid, lo, dk, tip = "wood4", "wood3", "wood1", "wood0", "dawn0"
    elif kind == "hot":
        hi, mid, lo, dk, tip = "stone4", "stone3", "stone1", "ink", "fire4"
    else:
        hi, mid, lo, dk, tip = "white", "stone4", "stone2", "ink", "white"
    shape = Canvas(16, 16)
    for i in range(4):
        cx = 4 * i + 2
        for y in range(3, 13):
            hw = (y - 3) / 9 * 2.0
            for x in range(cx - 2, cx + 2):
                if abs(x + 0.5 - cx) <= hw + 0.25:
                    col = hi if x < cx - 0.5 - 0.0 and x + 0.5 < cx else (lo if x >= cx else mid)
                    if x == cx - 1:
                        col = mid
                    if x < cx - 1:
                        col = hi
                    put(shape, x, y, col)
        put(shape, cx - 1, 3, tip)
        put(shape, cx - 1, 4, tip)
    for x in range(16):
        put(shape, x, 13, mid)
        put(shape, x, 14, lo)
        put(shape, x, 15, dk)
    for x in (3, 11):
        put(shape, x, 14, hi)
    shape.outline(N[dk])
    t.blit(shape, 0, 0)
    return t


def thorns(th) -> Canvas:
    t = Canvas(16, 16)
    if th["spike"] == "crystal":
        stem, sthi, thorn = "violet1", "violet2", "white"
    elif th["spike"] == "hot":
        stem, sthi, thorn = "stone1", "stone2", "fire4"
    else:
        stem, sthi, thorn = "wood1", "moss1", "dawn0"
    curves = [(3.0, 0.9, 0.0), (8.0, 0.7, 1.7), (12.5, 1.1, 3.1)]
    for (base, amp, ph) in curves:
        for x in range(16):
            y = int(round(base + 2.2 * math.sin(2 * math.pi * x / 16 * amp + ph)))
            put(t, x, y, stem)
            put(t, x, y + 1, sthi)
            if (x * 7 + int(base)) % 5 == 0:
                put(t, x, y - 1, thorn)
                put(t, x, y - 2, thorn)
            elif (x * 7 + int(base)) % 5 == 2:
                put(t, x, y + 2, thorn)
    for (x, y) in ((4, 6), (11, 2), (7, 11)):
        stamp(t, ["rr", "rR"], {"r": "berry0", "R": "berry1"}, x, y)
    return t


def beam(th) -> Canvas:
    t = Canvas(16, 16)
    style = th["beam"]
    if style == "ibeam":
        for y in range(16):
            stamp(t, ["oHhlooooooHhlo"[0:14]], {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone1"}, 1, y)
            for x in range(5, 11):
                put(t, x, y, "stone1" if x < 10 else "stone0")
            put(t, 5, y, "stone2")
        for y in (3, 11):
            put(t, 3, y, "white")
            put(t, 12, y, "white")
            put(t, 7, y, "stone3")
            put(t, 8, y, "stone0")
    elif style == "pillar":
        for y in range(16):
            stamp(t, ["oWBCCCCDo"], {"o": "violet0", "W": "white", "B": "water4", "C": "violet2",
                                     "D": "violet1"}, 4, y)
        for y in range(16):
            if y % 8 == 3:
                put(t, 7, y, "violet3")
                put(t, 8, y + 1, "violet3")
    elif style == "column":
        for y in range(16):
            stamp(t, ["oHhhhmmlo"], {"o": "ink", "H": "water4", "h": "water3", "m": "shard1", "l": "shard0"}, 4, y)
        for y in (0, 8):
            stamp(t, ["oooooooooo"], {"o": "water0"}, 3, y + 7)
        put(t, 6, 3, "moss3")
        put(t, 7, 4, "moss2")
    elif style == "trunk":
        for y in range(16):
            stamp(t, ["oHhhmmlo"], {"o": "wood0", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1"}, 4, y)
            if y % 5 == 1:
                put(t, 6 + (y % 3), y, "wood1")
    else:  # post / timber
        for y in range(16):
            stamp(t, ["oHhhmmlo"], {"o": "wood0", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1"}, 4, y)
        for y in range(16):
            if y % 6 == 2:
                put(t, 7, y, "wood1")
                put(t, 7, y + 1, "wood1")
        if style == "timber":
            for y in (4, 12):
                put(t, 6, y, "stone4")
                put(t, 9, y, "stone2")
        else:
            put(t, 5, 9, "moss3")
            put(t, 5, 10, "moss2")
            put(t, 6, 10, "moss3")
    return t


def node(th, broken: bool) -> Canvas:
    t = Canvas(16, 16)
    hi, mid, lo, dk = th["plank"]
    shade_disc(t, 7.5, 7.5, 7.5, hi, mid, lo, dk)
    if not broken:
        shade_disc(t, 7.5, 7.5, 5.0, "shard3", "shard2", "shard1", "shard0")
        t.disc(7.5, 7.5, 5.2, N["ink"]) if False else None
        stamp(t, [" o ", "ooo", "ooo", "ooo", " o "], {"o": "ink"}, 7, 5)
        put(t, 5, 5, "white")
        put(t, 6, 5, "white")
        put(t, 5, 6, "white")
        # socket shadow ring
        for y in range(16):
            for x in range(16):
                dx, dy = x + 0.5 - 7.5, y + 0.5 - 7.5
                if 5.0 < math.hypot(dx, dy) <= 5.9:
                    put(t, x, y, dk)
    else:
        shade_disc(t, 7.5, 7.5, 5.0, "shard0", "shard0", "ink", "ink")
        stamp(t, ["o   o", " o o ", "  o  ", " o o ", "o   o"], {"o": lo}, 5, 5)
        for (x, y) in ((4, 4), (10, 9), (6, 10)):
            put(t, x, y, "shard1")
        for y in range(16):
            for x in range(16):
                dx, dy = x + 0.5 - 7.5, y + 0.5 - 7.5
                if 5.0 < math.hypot(dx, dy) <= 5.9:
                    put(t, x, y, dk)
        put(t, 12, 1, None)
        put(t, 13, 2, None)
        put(t, 12, 2, dk)
    t.outline(N["ink"])
    return t


def shaft(side: str) -> Canvas:
    t = Canvas(16, 16)
    for y in range(16):
        stamp(t, ["oHml"], {"o": "ink", "H": "stone4", "m": "stone3", "l": "stone1"}, 0, y)
        put(t, 4, y, "ink")
    for y in (3, 11):
        put(t, 2, y, "white")
        put(t, 2, y + 1, "stone1")
        stamp(t, ["ll"], {"l": "stone2"}, 5, y)
        put(t, 5, y + 1, "ink")
        put(t, 6, y + 1, "ink")
    return t if side == "l" else t.flip_h()


def dart_trap(th, side: str) -> Canvas:
    """A solid carved block with a slit mouth on the right and a dart tip showing."""
    t = Canvas(16, 16)
    hi, mid, lo, dk = th["trap"]
    art = [
        "oooooooooooooooo",
        "oHHHHHHHHHHHHHHo",
        "oHmmmmmmmmmmmmlo",
        "oHmoooommmmmmmlo",
        "oHmorromooooomlo",
        "oHmoooommmmmmmlo",
        "oHmmmmmmmmmmmmlo",
        "oHmmmmmmmmmoooooo",
        "oHmmmmmmmmmsssWwo",
        "oHmmmmmmmmmoooooo",
        "oHmmmmmmmmmmmmlo",
        "oHmmoooooommmmlo",
        "oHmmmmmmmmmmmmlo",
        "oHllllllllllllllo",
        "ollllllllllllllo",
        "oooooooooooooooo",
    ]
    stamp(t, art, {"o": dk, "H": hi, "m": mid, "l": lo, "r": th["glow"][2], "s": "ink",
                   "W": "white", "w": "stone3"}, 0, 0)
    for (x, y) in ((3, 2), (12, 12)):
        put(t, x, y, hi)
    return t if side == "r" else t.flip_h()


# ----------------------------------------------------------------------------- decorations
# Every decoration is a 16x16 passable tile on a transparent background.


def _new():
    return Canvas(16, 16)


def d_art(rows, cmap, where="bottom", dx=0, outline=None, flipx=False):
    c = _new()
    w = max(len(r) for r in rows)
    rows = [r.ljust(w) for r in rows]
    ox = (16 - w) // 2 + dx
    if where == "bottom":
        oy = 16 - len(rows)
    elif where == "top":
        oy = 0
    else:
        oy = (16 - len(rows)) // 2
    stamp(c, rows, cmap, ox, oy, flipx)
    if outline:
        ink(c, outline)
    return c


def d_tuft(hi, mid, lo, tall=False):
    rows = ([
        "    A      ",
        "    A   A  ",
        " A  BA  A  ",
        " BA BA AB A",
        "  BABBABBAB",
        "  CBBCBBCB ",
        "   CCCCCC  ",
    ] if tall else [
        "  A    A ",
        "A BA  AB ",
        "BABBAABBA",
        " CBBCBBC ",
        "  CCCCC  ",
    ])
    return d_art(rows, {"A": hi, "B": mid, "C": lo})


def d_fern(hi, mid, lo):
    rows = [
        "      A       ",
        "   A  A   A   ",
        "  AB  AB  BA  ",
        "   AB AB BA   ",
        " AA BABBAB AA ",
        "  BBBBBBBBBB  ",
        " BB  CBBC  BB ",
        "C   CCBBCC   C",
        "   C  CC  C   ",
    ]
    return d_art(rows, {"A": hi, "B": mid, "C": lo})


def d_flowers(stem, petal, center, petal2=None):
    rows = [
        "  p        ",
        " pcp    q  ",
        "  p    qcq ",
        "  s  p  q  ",
        "  s pcp s  ",
        "  ss p ss  ",
        "   s s s   ",
        "  SsSsSsS  ",
    ]
    return d_art(rows, {"p": petal, "q": petal2 or petal, "c": center, "s": stem, "S": "moss1"})


def d_mushrooms(capA, capB, capC, spot=None, glow=False):
    rows = [
        "   aaa       ",
        "  abbbc      ",
        " abwbbbc  ab ",
        " ccccccc abbc",
        "   ss    cccc",
        "   ss     s  ",
        "  sSS    sS  ",
    ]
    c = d_art(rows, {"a": capA, "b": capB, "c": capC, "w": spot or capA,
                     "s": "dawn0" if not glow else "shard3", "S": "wood3" if not glow else "shard2"})
    if glow:
        for (x, y) in ((3, 6), (13, 8)):
            put(c, x, y, "white")
    return ink(c, "ink")


def d_rock(hi, mid, lo, dk, moss=None):
    rows = [
        "    hhhm    ",
        "  hhhmmmml  ",
        " hhmmmmmmll ",
        " hmmmmmmmlll",
        "hmmmmmmmllll",
        "mmmmmmmlllll",
    ]
    c = d_art(rows, {"h": hi, "m": mid, "l": lo})
    if moss:
        stamp(c, ["    gg", "  gGGgg", " g   g"], {"g": moss[1], "G": moss[0]}, 3, 10)
    return ink(c, dk)


def d_pebbles(hi, mid, lo, dk):
    rows = [
        "      hm       ",
        " hm  hmml   hm ",
        "hmml  ll   hmml",
    ]
    return ink(d_art(rows, {"h": hi, "m": mid, "l": lo}), dk)


def d_hang(cols, xs=(2, 5, 8, 11, 13), lens=(9, 13, 7, 11, 5), leafy=False):
    hi, mid, lo = cols
    c = _new()
    for x in range(16):
        put(c, x, 0, lo)
        if x % 3 != 1:
            put(c, x, 1, mid)
    for x, L in zip(xs, lens):
        for y in range(1, L):
            xx = x + (1 if (y // 3) % 2 and x % 2 else 0)
            put(c, xx, y, mid if y % 4 else hi)
            if leafy and y % 4 == 2:
                put(c, xx + 1, y, hi)
                put(c, xx - 1, y + 1, lo)
        put(c, x, L, lo)
    return c


def d_web(col="stone3", dim="stone2"):
    rows = [
        "wwwwwwwwwwwwww",
        "w  d   w   d  ",
        "w   d  w  d   ",
        "wdd  d w d    ",
        "w  dd wwwd    ",
        "w    w d  w   ",
        "wwwwwd   d    ",
        "w  w   d      ",
        "w w d   d     ",
        "ww    d       ",
        "w d           ",
        "w   d         ",
        "w             ",
    ]
    c = _new()
    stamp(c, rows, {"w": col, "d": dim}, 0, 0)
    return c


def d_chain(hi, lo, length=13):
    c = _new()
    for y in range(length):
        if (y // 3) % 2 == 0:
            row = ["ooo", "o o", "ooo"][y % 3]
            stamp(c, [row], {"o": hi}, 6, y)
            put(c, 8, y, lo)
        else:
            put(c, 7, y, hi)
            put(c, 8, y, lo)
    put(c, 7, length, lo)
    return c


def d_crystals(hi, mid, lo, dk, wh="white"):
    rows = [
        "      a        ",
        "     aWb       ",
        "     abb   a   ",
        " a   abb  aWb  ",
        "aWb  abbc abbc ",
        "abbc abbc abbc ",
        "abbc abbcaabbc ",
        " cccccccccccc  ",
    ]
    c = d_art(rows, {"a": hi, "W": wh, "b": mid, "c": lo})
    return ink(c, dk)


def d_bush(hi, mid, lo, dk, berry=None, half=None):
    rows = [
        "     hhh  hh     ",
        "   hhhmmhhmmhh   ",
        "  hhmmmmmmmmmml  ",
        " hmmmmmmmmmmmmll ",
        " mmmmmmmmmmmmmll ",
        "mmmmmmmmmmmmmmlll",
        " lmmmmllmmmmllll ",
        "  lllllllllllll  ",
    ]
    c = d_art(rows, {"h": hi, "m": mid, "l": lo})
    if berry:
        for (x, y) in ((5, 10), (9, 12), (12, 11), (7, 14)):
            put(c, x, y, berry[0])
            put(c, x + 1, y, berry[1])
    return ink(c, dk)


def d_lantern(hang=True, glass="gold2", flame="fire5", frame_c="stone1", body_lit="gold1"):
    c = _new()
    top = 0
    if hang:
        for y in range(0, 5):
            put(c, 7, y, "stone2")
            put(c, 8, y, "stone1")
        top = 5
    rows = [
        "  oooo  ",
        " oHHHHo ",
        " oGYGgo ",
        " ogYWgo ",
        " ogYYgo ",
        " oggggo ",
        "  oooo  ",
    ]
    stamp(c, rows, {"o": frame_c, "H": "stone3", "G": glass, "g": body_lit, "Y": flame, "W": "white"}, 4, top)
    if not hang:
        for y in range(top + 7, 16):
            put(c, 7, y, "wood2")
            put(c, 8, y, "wood1")
        stamp(c, ["oooooo"], {"o": "wood1"}, 5, 15)
    return ink(c, "ink")


# ---- theme decoration sets -----------------------------------------------------------


def deco_moss():
    return [
        d_fern("moss4", "moss3", "moss1"),
        d_tuft("moss4", "moss3", "moss1"),
        d_tuft("moss4", "moss2", "moss1", tall=True),
        d_flowers("moss2", "white", "gold2", "stone4"),
        d_flowers("moss2", "gold2", "fire4", "gold1"),
        d_mushrooms("fire3", "fire2", "fire1", spot="dawn0"),
        d_mushrooms("shard3", "shard2", "shard1", spot="white", glow=True),
        d_rock("stone3", "stone2", "stone1", "ink", moss=("moss4", "moss3")),
        d_pebbles("stone3", "stone2", "stone1", "ink"),
        d_hang(("wood3", "wood2", "wood1")),
        d_hang(("moss3", "moss2", "moss1"), xs=(1, 4, 6, 9, 12, 14), lens=(6, 10, 4, 12, 7, 9), leafy=True),
        _d_short_vine(),
        d_web(),
        _d_stump(),
        _d_log(True),
        _d_log(False),
        d_crystals("shard3", "shard2", "shard1", "shard0"),
        d_bush("moss3", "moss2", "moss1", "ink", berry=("gold2", "fire4")),
    ]


def _d_short_vine():
    c = _new()
    for y in range(0, 11):
        put(c, 7 + (1 if y % 6 > 2 else 0), y, "moss1")
    for (x, y, s) in ((8, 2, 1), (6, 5, -1), (9, 8, 1), (6, 10, -1)):
        stamp(c, ["Ll", "l "] if s > 0 else ["lL", " l"], {"L": "moss4", "l": "moss3"}, x, y)
    return c


def _d_stump():
    rows = [
        "  oooooooo  ",
        " oHhhhhhhlo ",
        " oRrRRrrRlo ",
        " ohmmmmmmlo ",
        " ohmdmmmmlo ",
        " ohmdmmmmlo ",
        "gohmmmmdmlog",
        "gGhmmmmdmlGg",
    ]
    return d_art(rows, {"o": "wood0", "H": "wood4", "h": "wood3", "R": "dawn0", "r": "wood4",
                        "m": "wood2", "l": "wood1", "d": "wood1", "g": "moss2", "G": "moss3"})


def _d_log(left: bool):
    rows = [
        "  ooooooooooooooo",
        " oRrRohhhhhhhhhhh",
        "oRrdrRohmmmmmmmmm",
        "oRdrdRohmmmdmmmmm",
        "oRrdrRommmmmmmmdm",
        " oRrRolllllllllll",
        "  ooooooooooooooo",
    ]
    c = _new()
    stamp(c, rows, {"o": "wood0", "R": "dawn0", "r": "wood4", "d": "wood2", "h": "wood3",
                    "m": "wood2", "l": "wood1"}, 0, 9)
    stamp(c, ["gGgg  g", " gg"], {"g": "moss2", "G": "moss4"}, 8, 8)
    if not left:
        c = Canvas(16, 16)
        body = [
            "oooooooooooooo  ",
            "hhhhhhhhhhhhhho ",
            "mmmmmmmmdmmmmmmo",
            "mmmdmmmmmmmmmmmo",
            "mmmmmmmmmmmdmmmo",
            "lllllllllllllllo",
            "oooooooooooooo  ",
        ]
        stamp(c, body, {"o": "wood0", "h": "wood3", "m": "wood2", "d": "wood1", "l": "wood1"}, 0, 9)
        stamp(c, ["g gGg", " gg "], {"g": "moss2", "G": "moss4"}, 3, 8)
        stamp(c, ["G", "g", "g"], {"g": "moss3", "G": "moss4"}, 11, 6)
    return c


def deco_mine():
    return [
        d_lantern(True),
        d_lantern(False),
        _d_rail(False),
        _d_rail(True),
        _d_cart(True),
        _d_cart(False),
        _d_pick(),
        _d_barrel(),
        _d_orepile(),
        _d_brace(),
        d_chain("stone3", "stone1"),
        d_web(),
        _d_stalagmite(("stone3", "stone2", "stone1", "ink")),
        _d_bucket(),
        _d_sign(),
        d_pebbles("stone3", "stone2", "stone1", "ink"),
        _d_wallvein(),
        mirror_v(_d_stalagmite(("stone3", "stone2", "stone1", "ink"))),
    ]


def _d_rail(end: bool):
    c = _new()
    for x in range(16):
        put(c, x, 12, "stone4")
        put(c, x, 13, "stone2")
    for x in (1, 6, 11):
        stamp(c, ["ssss", "SSSS"], {"s": "wood2", "S": "wood0"}, x, 14)
    if end:
        stamp(c, ["  oooo", " oRRRo", " oRWRo", " oRRRo", " ooooo", "  o  o", "  o  o"],
              {"o": "ink", "R": "fire3", "W": "gold2"}, 8, 7)
    return c


def _d_cart(left: bool):
    rows = [
        " oooooooooooooooo",
        " oHHHHHHHHHHHHHHH",
        " ohhhhhhhhhhhhhhh",
        " ohhbhhhhhhhhhhhh",
        " ohhhhhhhhhhhhhbh",
        " olllllllllllllll",
        "  ooooooooooooooo",
        "   oWWo          ",
        "   oWWo          ",
        "    oo           ",
    ]
    c = _new()
    stamp(c, rows, {"o": "ink", "H": "stone3", "h": "stone2", "l": "stone1", "b": "stone4",
                    "W": "stone3"}, 0, 5)
    stamp(c, ["  gg  g", " gGGgGGg"], {"g": "gold1", "G": "gold2"}, 5, 3)
    ink(c, "ink")
    return c if left else c.flip_h()


def _d_pick():
    rows = [
        "   oooo     ",
        "  oHHhho    ",
        " oHo  ohho  ",
        " oo  owo oo ",
        "     owo    ",
        "    owo     ",
        "    owo     ",
        "   owo      ",
        "   owo      ",
        "  owo       ",
        "  owo       ",
        " ooo        ",
    ]
    return d_art(rows, {"o": "ink", "H": "stone4", "h": "stone3", "w": "wood3"})


def _d_barrel():
    rows = [
        "  oooooooo  ",
        " oHhhhhhhlo ",
        " osssssssso ",
        "oHhhmmmmmllo",
        "oHhhmmmmmllo",
        "osssssssssso",
        "oHhhmmmmmllo",
        "oHhhmmmmmllo",
        " osssssssso ",
        " oHhhmmmmlo ",
        "  oooooooo  ",
    ]
    return d_art(rows, {"o": "ink", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1", "s": "stone2"})


def _d_orepile():
    rows = [
        "      hm       ",
        "    hmGgl  hm  ",
        "  hmmgmmll hml ",
        " hmmmmmGlllmml ",
        "hmmGgmmmllllll ",
    ]
    return ink(d_art(rows, {"h": "stone3", "m": "stone2", "l": "stone1", "G": "gold2", "g": "gold1"}), "ink")


def _d_brace():
    c = _new()
    for i in range(14):
        put(c, i, i, "wood3")
        put(c, i + 1, i, "wood2")
        put(c, i + 2, i, "wood1")
    for i in range(16):
        put(c, 0, i, "wood0")
    for x in range(16):
        put(c, x, 0, "wood0")
    put(c, 3, 3, "stone4")
    return ink(c, "wood0")


def _d_stalagmite(p):
    hi, mid, lo, dk = p
    rows = [
        "     a      ",
        "     ab     ",
        "    abb     ",
        "    abbc  a ",
        "   aabbc  ab",
        "   abbbcc abc",
        "  aabbbbc abc",
        "  abbbbbccbbc",
    ]
    return ink(d_art(rows, {"a": hi, "b": mid, "c": lo}), dk)


def _d_bucket():
    rows = [
        "   ooooo   ",
        "  o     o  ",
        " o       o ",
        "ooooooooooo",
        "oHhGgGhhhlo",
        " oHhhhhhlo ",
        " oHhhhhhlo ",
        " osssssslo ",
        "  oooooooo ",
    ]
    return d_art(rows, {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1", "s": "stone2",
                        "G": "gold2", "g": "gold1"})


def _d_sign():
    rows = [
        "ooooooooooooo",
        "oHhhhhhhhhhlo",
        "ohhhhRhhhhhlo",
        "ohhhRhRhhhhlo",
        "ohhhhhhRhhhlo",
        "ohhhhhhhRhhlo",
        "olllllllllllo",
        "ooooooooooooo",
        "     owo     ",
        "     owo     ",
        "     owo     ",
        "    ooooo    ",
    ]
    return d_art(rows, {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood2", "R": "fire2", "w": "wood2"})


def _d_wallvein():
    c = _new()
    stamp(c, ["  a   ", " aWb  ", " abbc a", "aabbccWb", " cccc bc"], {"a": "shard3", "W": "white", "b": "shard2",
                                                                    "c": "shard1"}, 4, 5)
    return ink(c, "shard0")


def deco_water():
    return [
        _d_arch("l"), _d_arch("m"), _d_arch("r"),
        d_hang(("moss3", "shard2", "shard1"), leafy=True),
        _d_kelp(True), _d_kelp(False),
        _d_coral(),
        _d_shell(),
        _d_bubbles(),
        _d_drip("water4", "water3"),
        _d_spout(),
        _d_grate(),
        _d_brokencol(),
        _d_star(),
        _d_urn(),
        d_chain("water3", "water1"),
        d_tuft("moss3", "shard2", "shard0", tall=True),
        _d_plaque(),
    ]


def _d_arch(part):
    c = _new()
    col = {"o": "water0", "H": "shard2", "h": "shard1", "l": "shard0", "k": "water3", "K": "water4"}
    if part == "m":
        rows = [
            "hhhhhhhhhhhhhhhh",
            "hhhhhlKKKkhhhhhh",
            "llllloKkkkolllll",
            "ooooooKkkkoooooo",
            "      ooooo     ",
        ]
        stamp(c, rows, col, 0, 0)
        for x in (4, 11):
            put(c, x, 1, "water0")
    elif part == "l":
        rows = [
            "Hhhhhhhhhhhhhhhh",
            "Hhhhhhhhhhhhhhhh",
            "Hhhhhhhhhhllllll",
            "Hhhhhhhlllooooooo",
            "Hhhhhlloo       ",
            "Hhhhloo         ",
            "Hhhlo           ",
            "Hhhlo           ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
            "Hhlo            ",
        ]
        stamp(c, rows, col, 0, 0)
        for y in (6, 12):
            put(c, 1, y, "water0")
            put(c, 2, y, "water0")
    else:
        c = _d_arch("l").flip_h()
        for y in range(16):
            for x in range(16):
                if c.get(x, y) == N["shard2"]:
                    put(c, x, y, "shard1")
    return c


def _d_kelp(tall):
    c = _new()
    h = 15 if tall else 9
    for y in range(16 - h, 16):
        x = 7 + (1 if (y // 3) % 2 else 0)
        put(c, x, y, "moss2")
        put(c, x + 1, y, "moss1")
        if y % 3 == 0 and y < 14:
            side = -1 if (y // 3) % 2 else 1
            stamp(c, ["ab"] if side > 0 else ["ba"], {"a": "moss3", "b": "moss4"}, x + (2 if side > 0 else -2), y)
    if tall:
        put(c, 5, 3, "water4")
        put(c, 11, 7, "water4")
    return c


def _d_coral():
    rows = [
        " a   a  a ",
        " ab ab  ab",
        "  bab  bb ",
        " a bb  b a",
        " abbb bbab",
        "  bbbbbbb ",
        "   cbbbc  ",
        "    ccc   ",
    ]
    return ink(d_art(rows, {"a": "berry2", "b": "berry1", "c": "berry0"}), "ink")


def _d_shell():
    rows = [
        "   aaa   ",
        "  aBaBa  ",
        " aBaBaBa ",
        " BaBaBaB ",
        "  cBcBc  ",
        "   ccc   ",
    ]
    return ink(d_art(rows, {"a": "dawn0", "B": "dawn1", "c": "dawn2"}), "ink")


def _d_bubbles():
    c = _new()
    for (x, y, r) in ((5, 11, 2), (10, 6, 1.5), (7, 3, 1)):
        for yy in range(16):
            for xx in range(16):
                d = math.hypot(xx + 0.5 - x, yy + 0.5 - y)
                if r - 0.8 < d <= r + 0.2:
                    put(c, xx, yy, "water4")
        put(c, int(x - r / 2), int(y - r / 2), "white")
    return c


def _d_drip(hi, mid):
    c = _new()
    stamp(c, [" mmmm ", "  mm  ", "  mm  ", "      ", "  h   ", "      ", "  h   ", " hmh  ",
              " mmm  ", "  m   "], {"h": hi, "m": mid}, 5, 0)
    return c


def _d_spout():
    rows = [
        "oooooooo",
        "Hhhhhhlo",
        "Hhhhhhlo",
        "oooooooo",
    ]
    c = _new()
    stamp(c, rows, {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone1"}, 0, 3)
    for y in range(7, 16):
        put(c, 5, y, "water4" if y % 3 else "white")
        put(c, 6, y, "water3")
    return c


def _d_grate():
    c = _new()
    c.rect(2, 3, 13, 12, "ink")
    c.frame(2, 3, 13, 12, "stone2")
    for x in range(4, 13, 3):
        for y in range(4, 12):
            put(c, x, y, "stone3")
    put(c, 2, 3, "stone4")
    return c


def _d_brokencol():
    rows = [
        "  o  oo   ",
        " oHo oho  ",
        " oHhhhhlo ",
        " oHhhhhlo ",
        " oHhhhhlo ",
        " oHhhmhlo ",
        " oHhhhhlo ",
        "ooooooooooo",
        "oHhhhhhhhlo",
    ]
    return d_art(rows, {"o": "ink", "H": "water4", "h": "shard1", "l": "shard0", "m": "moss3"})


def _d_star():
    rows = [
        "    a    ",
        "    a    ",
        "   aba   ",
        "aaabbbaaa",
        " aabbbaa ",
        "  abbba  ",
        " aa   aa ",
    ]
    return ink(d_art(rows, {"a": "fire4", "b": "fire5"}), "fire1")


def _d_urn():
    rows = [
        "  oooooo  ",
        "   oHlo   ",
        "  oHhhlo  ",
        " oHhhhhlo ",
        "oHhWwhhhlo",
        "oHhwwhhhlo",
        "oHhhhhhhlo",
        " oHhhhhlo ",
        "  oollo  ",
        "  oooooo  ",
    ]
    return d_art(rows, {"o": "ink", "H": "dawn0", "h": "dawn1", "l": "dawn2", "W": "shard2", "w": "shard1"})


def _d_plaque():
    c = _new()
    c.rect(3, 3, 12, 11, "shard1")
    c.frame(3, 3, 12, 11, "ink")
    stamp(c, ["w   w", " w w ", "  w  "], {"w": "shard3"}, 5, 5)
    stamp(c, ["wwwww"], {"w": "shard2"}, 5, 9)
    put(c, 4, 4, "shard2")
    return c


def deco_wood():
    return [
        d_bush("moss4", "moss3", "moss2", "moss0"),
        d_hang(("moss4", "moss3", "moss1"), xs=(1, 3, 6, 9, 12, 14), lens=(7, 11, 5, 13, 8, 6), leafy=True),
        _d_branchstub(),
        _d_fungus(),
        d_flowers("moss2", "berry2", "gold2", "berry1"),
        d_bush("moss3", "moss2", "moss1", "ink", berry=("violet2", "violet1")),
        _d_nest(),
        _d_short_vine(),
        _d_thornsprig(),
        _d_cocoon(),
        d_web("stone4", "stone3"),
        _d_knot(),
        _d_mosspatch(),
        d_fern("moss4", "moss3", "moss1"),
        _d_leafpile(),
        _d_twig(),
        _d_firefly(),
        _d_pods(),
    ]


def _d_branchstub():
    rows = [
        "oooooo         ",
        "Hhhhhhoo    gg ",
        "hmmmmmhhoo gGgg",
        "mmmmmmmmmhoggg ",
        "llllllmmmmmo   ",
        "oooooollllo    ",
        "      oooo     ",
    ]
    c = _new()
    stamp(c, rows, {"o": "wood0", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1",
                    "g": "moss3", "G": "moss4"}, 0, 5)
    return c


def _d_fungus():
    rows = [
        "ooooooo  ",
        "aabbbbco ",
        "occcccco ",
        "  ooooo  ",
        "ooooooooo",
        "aaabbbbcco",
        "occccccco ",
        " ooooooo  ",
    ]
    c = _new()
    stamp(c, rows, {"o": "wood0", "a": "dawn0", "b": "wood4", "c": "wood3"}, 0, 4)
    return c


def _d_nest():
    rows = [
        "   ww  ww   ",
        "  wEEwwEEw  ",
        " oEWEooEeEo ",
        "oHhhhhhhhhlo",
        "ohmhmhmhmhlo",
        " ollllllllo ",
        "  oooooooo  ",
    ]
    return d_art(rows, {"o": "wood0", "H": "wood4", "h": "wood3", "m": "wood2", "l": "wood1",
                        "E": "water4", "e": "water3", "W": "white", "w": "wood3"})


def _d_thornsprig():
    c = _new()
    for y in range(4, 16):
        put(c, 7 + (1 if y % 5 < 2 else 0), y, "wood1")
    for (x, y, s) in ((8, 5, 1), (6, 8, -1), (9, 11, 1), (6, 13, -1)):
        put(c, x + s, y, "dawn0")
        put(c, x + 2 * s, y - 1, "dawn0")
    stamp(c, ["rr", "rR"], {"r": "berry0", "R": "berry2"}, 8, 2)
    return c


def _d_cocoon():
    c = _new()
    for y in range(0, 5):
        put(c, 7, y, "stone4")
    rows = [" ooo ", "oHhlo", "oHhlo", "ohhlo", "oHhlo", "ohllo", " olo ", "  o  "]
    stamp(c, rows, {"o": "wood1", "H": "dawn0", "h": "wood4", "l": "wood3"}, 5, 5)
    return c


def _d_knot():
    c = _new()
    rows = [
        "   dddd   ",
        "  dllllL  ",
        " dlooooLL ",
        " dlooooolL",
        " dlooooolL",
        "  dlooolL ",
        "   dlllL  ",
        "    LLL   ",
    ]
    stamp(c, rows, {"d": "wood1", "l": "wood2", "o": "wood0", "L": "wood4"}, 3, 4)
    put(c, 7, 7, "gold2")
    put(c, 9, 7, "gold2")
    return c


def _d_mosspatch():
    rows = [
        "   A  A    A  ",
        " ABAABAAB ABA ",
        "BBBBBBBBBBBBBB",
        " CCCBCCCCBCCC ",
    ]
    return d_art(rows, {"A": "moss4", "B": "moss3", "C": "moss1"})


def _d_leafpile():
    rows = [
        "      gG        ",
        "   ag gGo  aA   ",
        " aAaagGgoaAaAa  ",
        "oaAaoGggoaaaAaGo",
        "ooooooooooooooo ",
    ]
    return d_art(rows, {"a": "fire3", "A": "gold2", "g": "moss3", "G": "moss4", "o": "wood1"})


def _d_twig():
    c = _new()
    for i in range(12):
        put(c, 2 + i, 14 - i // 3, "wood2")
        put(c, 2 + i, 15 - i // 3, "wood0")
    stamp(c, ["gG", "g "], {"g": "moss3", "G": "moss4"}, 12, 8)
    stamp(c, ["G", "g"], {"g": "moss3", "G": "moss4"}, 6, 11)
    return c


def _d_firefly():
    c = d_lantern(True, glass="moss4", flame="gold2", frame_c="wood1", body_lit="moss3")
    return c


def _d_pods():
    c = _new()
    for x in range(16):
        put(c, x, 0, "wood1")
    for (x, L) in ((3, 6), (8, 9), (12, 5)):
        for y in range(1, L):
            put(c, x, y, "moss1")
        stamp(c, [" oo ", "oHlo", "oHlo", " oo "], {"o": "wood0", "H": "gold2", "l": "wood3"}, x - 1, L)
    return c


def deco_ember():
    return [
        d_chain("stone3", "stone1"),
        _d_gear(True),
        _d_pipe("h"), _d_pipe("v"), _d_pipe("e"),
        _d_valve(),
        _d_gauge(),
        _d_anvil(),
        _d_coals(),
        _d_crucible(),
        _d_vent(),
        d_lantern(False, glass="fire4", flame="fire5", frame_c="ink", body_lit="fire3"),
        _d_boltpile(),
        _d_ingots(),
        _d_warn(),
        _d_gear(False),
        _d_chimney(),
        _d_tools(),
    ]


def _d_gear(big):
    c = _new()
    r = 7.0 if big else 4.5
    cx, cy = 8, 8 if big else 11
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            tooth = math.cos(a * (8 if big else 6)) > 0.3
            rr = r if tooth else r - 1.5
            if d <= rr:
                k = (dx + dy) / (r * 1.4)
                put(c, x, y, "stone3" if k < -0.3 else ("stone1" if k > 0.3 else "stone2"))
            if d <= r * 0.35:
                put(c, x, y, "ink")
    return ink(c, "ink")


def _d_pipe(kind):
    c = _new()
    if kind == "h":
        for x in range(16):
            stamp(c, ["o", "H", "h", "h", "l", "o"], {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1"}, x, 6)
        stamp(c, ["oo", "HH", "hh", "hh", "ll", "oo"], {"o": "ink", "H": "gold2", "h": "gold1", "l": "gold0"}, 6, 5)
        put(c, 6, 11, "ink")
        put(c, 7, 11, "ink")
    elif kind == "v":
        for y in range(16):
            stamp(c, ["oHhhlo"], {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1"}, 5, y)
        stamp(c, ["oHHhhlo"] * 2, {"o": "ink", "H": "gold2", "h": "gold1", "l": "gold0"}, 5, 7)
    else:
        for x in range(6, 16):
            stamp(c, ["o", "H", "h", "h", "l", "o"], {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1"}, x, 6)
        for y in range(6, 16):
            stamp(c, ["oHhhlo"], {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1"}, 5, y)
        stamp(c, ["ooooo", "oHHhh", "oHhhh", "oHhhl"], {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood1"}, 5, 6)
    return c


def _d_valve():
    c = _new()
    for y in range(9, 16):
        stamp(c, ["oHhlo"], {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone1"}, 6, y)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - 8, y + 0.5 - 6)
            if 3.6 < d <= 5.0:
                put(c, x, y, "fire3" if (x + y) % 5 else "fire2")
    stamp(c, ["f", "f", "fFf", "f", "f"], {"f": "fire2", "F": "fire4"}, 7, 4)
    for i in range(3, 11):
        put(c, i, 6, "fire2")
    for i in range(1, 11):
        put(c, 8, i, "fire2")
    put(c, 8, 6, "fire5")
    return ink(c, "ink")


def _d_gauge():
    c = _new()
    shade_disc(c, 8, 7, 5.5, "stone3", "stone2", "stone1")
    shade_disc(c, 8, 7, 4.0, "white", "white", "stone4")
    for i in range(3):
        put(c, 8 + i, 7 - i, "fire2")
    put(c, 8, 7, "ink")
    for y in range(12, 16):
        put(c, 7, y, "stone3")
        put(c, 8, y, "stone1")
    return ink(c, "ink")


def _d_anvil():
    rows = [
        "ooooooooooooooo",
        "oHHHHHHHHHHHHhlo",
        " ooHhhhhhhhhllo ",
        "    oHhhhhhlo   ",
        "    oHhhhhhlo   ",
        "   oHhhhhhhhlo  ",
        "  oHhhhhhhhhhlo ",
        "  ooooooooooooo ",
    ]
    return d_art(rows, {"o": "ink", "H": "stone3", "h": "stone2", "l": "stone1"})


def _d_coals():
    rows = [
        "    fYf  ",
        "  fYFfYf ",
        " oooooooo",
        " oHhhhhlo",
        " oHhhhhlo",
        "  oHhhlo ",
        "  oooooo ",
    ]
    return d_art(rows, {"o": "ink", "H": "stone3", "h": "stone2", "l": "stone1", "f": "fire2",
                        "F": "fire3", "Y": "fire5"})


def _d_crucible():
    rows = [
        "  YYYYYYY  ",
        " oFFYYYFFo ",
        "oHhhhhhhhlo",
        "oHhhhhhhhlo",
        " oHhhhhhlo ",
        " oHhhhhhlo ",
        "  oollloo  ",
        "   o   o   ",
    ]
    return d_art(rows, {"o": "ink", "H": "stone3", "h": "stone2", "l": "stone1", "F": "fire4", "Y": "fire5"})


def _d_vent():
    c = _new()
    c.rect(2, 5, 13, 12, "fire3")
    c.frame(2, 5, 13, 12, "ink")
    for x in range(4, 13, 2):
        for y in range(6, 12):
            put(c, x, y, "stone1")
    for x in range(3, 13):
        put(c, x, 6, "fire4" if x % 2 else "stone2")
    put(c, 2, 5, "stone3")
    return c


def _d_boltpile():
    rows = [
        "     oo      ",
        "    oHlo  oo ",
        " oo ollo oHlo",
        "oHlooHloooHlo",
        "ollooHhlooHlo",
    ]
    return d_art(rows, {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone2"})


def _d_ingots():
    rows = [
        "    oooooo   ",
        "   oHhhhhlo  ",
        "  ooooooooooo",
        " oHhhhlooHhhlo",
        "oHhhhhlooHhhhlo",
        "ooooooooooooooo",
    ]
    return d_art(rows, {"o": "ink", "H": "gold2", "h": "gold1", "l": "gold0"})


def _d_warn():
    rows = [
        "      oo      ",
        "     oYYo     ",
        "    oYYYYo    ",
        "    oYffYo    ",
        "   oYYffYYo   ",
        "   oYffffYo   ",
        "  oYYfFFfYYo  ",
        "  oYYYYYYYYo  ",
        " oooooooooooo ",
    ]
    return d_art(rows, {"o": "ink", "Y": "gold2", "f": "fire2", "F": "fire4"}, where="mid")


def _d_chimney():
    c = _new()
    stamp(c, [" oooooo ", " oHhhlo ", "ooooooooo", "oHhhhhhlo", "oHhhhhhlo", "oHhhhhhlo", "oHhhhhhlo"],
          {"o": "ink", "H": "stone3", "h": "stone2", "l": "stone1"}, 3, 9)
    stamp(c, ["  aa  ", " abba ", "abbbba", " abba ", "  a   ", "   aa ", "  abba", "   aa "],
          {"a": "stone2", "b": "stone3"}, 4, 0)
    return c


def _d_tools():
    c = _new()
    for x in range(1, 15):
        put(c, x, 2, "wood2")
        put(c, x, 3, "wood0")
    for y in range(4, 13):
        put(c, 4, y, "wood3")
        put(c, 11, y, "stone3")
        put(c, 12 if y < 9 else 11, y, "stone2")
    stamp(c, ["ooooo", "oHHlo", "ooooo"], {"o": "ink", "H": "stone3", "l": "stone1"}, 2, 11)
    return c


def deco_spire():
    return [
        d_crystals("violet3", "violet2", "violet1", "violet0"),
        _d_tallcrystal(),
        _d_floatshard(),
        _d_pane(),
        _d_banner(),
        _d_mirror(),
        _d_pedestal(),
        _d_orb(),
        _d_prism(),
        _d_glassflowers(),
        _d_runeglyph(),
        d_chain("violet3", "violet1"),
        _d_brazier(),
        _d_debris(),
        _d_twinkle(),
        _d_candles(),
        _d_maskfrag(),
        _d_lattice(),
    ]


def _d_tallcrystal():
    rows = [
        "   a   ",
        "  aWb  ",
        "  aWb  ",
        " aWbbc ",
        " aWbbc ",
        " abbbc ",
        " abbbc ",
        "aabbbcc",
        "abbbbbc",
        "abbbbbc",
        "abbbbbc",
        "abbbbbc",
        "abbbbcc",
        " cccccc",
    ]
    return ink(d_art(rows, {"a": "violet3", "W": "white", "b": "violet2", "c": "violet1"}), "violet0")


def _d_floatshard():
    rows = ["  a  ", " aWb ", " abb ", "aWbbc", " abc ", " abc ", "  c  "]
    c = d_art(rows, {"a": "water4", "W": "white", "b": "water3", "c": "violet2"}, where="mid")
    ink(c, "violet0")
    put(c, 3, 3, "white")
    put(c, 12, 11, "violet3")
    return c


def _d_pane():
    c = _new()
    c.rect(2, 1, 13, 14, "violet1")
    c.frame(2, 1, 13, 14, "ink")
    for y in range(2, 14):
        for x in range(3, 13):
            if (x - y) % 7 in (0, 1) and x < 12:
                put(c, x, y, "violet2")
    put(c, 7, 2, "ink")
    for y in range(2, 14):
        put(c, 7, y, "violet0")
    for x in range(3, 13):
        put(c, x, 7, "violet0")
    put(c, 4, 3, "water4")
    put(c, 9, 9, "water4")
    return c


def _d_banner():
    c = _new()
    for x in range(2, 14):
        put(c, x, 0, "gold1")
    put(c, 2, 0, "gold2")
    rows = [
        "HhhhhhhhhL",
        "HhhhhhhhhL",
        "HhhhWhhhhL",
        "HhhWWWhhhL",
        "HhhhWhhhhL",
        "HhhhhhhhhL",
        "HhhhhhhhhL",
        "HhhhhhhhhL",
        "HhhhhhhhhL",
        "Hhhh  hhhL",
        "Hhh    hhL",
        "Hh      hL",
    ]
    stamp(c, rows, {"H": "violet3", "h": "violet2", "L": "violet1", "W": "gold2"}, 3, 1)
    return ink(c, "violet0")


def _d_mirror():
    c = _new()
    for y in range(16):
        for x in range(16):
            d = ((x + 0.5 - 8) / 5.0) ** 2 + ((y + 0.5 - 7.5) / 7.0) ** 2
            if d <= 1.0:
                put(c, x, y, "gold1" if d > 0.62 else ("water3" if x + y < 15 else "water2"))
    for i in range(3):
        put(c, 6 + i, 4 + i, "white")
    put(c, 7, 4, "white")
    return ink(c, "ink")


def _d_pedestal():
    rows = [
        " oooooooo ",
        "oHHhhhhhlo",
        " oooooooo ",
        "  oHhhlo  ",
        "  oHhhlo  ",
        "  oHhhlo  ",
        " oooooooo ",
        "oHhhhhhhlo",
        "oooooooooo",
    ]
    return d_art(rows, {"o": "violet0", "H": "white", "h": "violet3", "l": "violet2"})


def _d_orb():
    c = _pedestal_small()
    shade_disc(c, 8, 5, 4.2, "white", "violet3", "violet2", "violet1")
    put(c, 6, 3, "white")
    return ink(c, "ink")


def _pedestal_small():
    c = _new()
    stamp(c, [" oooo ", "oHhhlo", " oHlo ", " oHlo ", "oHhhlo", "oooooo"],
          {"o": "violet0", "H": "white", "h": "violet3", "l": "violet2"}, 5, 10)
    return c


def _d_prism():
    c = _new()
    for y in range(0, 6):
        put(c, 8, y, "violet2")
    rows = ["   a   ", "  aWb  ", " aWbbc ", "aabbbcc", " abbc  ", "  bc   ", "   c   "]
    stamp(c, rows, {"a": "water4", "W": "white", "b": "violet3", "c": "violet2"}, 5, 6)
    ink(c, "violet0")
    put(c, 3, 14, "fire4")
    put(c, 4, 15, "gold2")
    put(c, 12, 14, "shard2")
    return c


def _d_glassflowers():
    return d_flowers("violet1", "water4", "white", "violet3")


def _d_runeglyph():
    c = _new()
    rows = [
        "    aa    ",
        "   a  a   ",
        "  a aa a  ",
        "  a a  a  ",
        " a  aa  a ",
        " a      a ",
        "aaaaaaaaaa",
    ]
    stamp(c, rows, {"a": "violet3"}, 3, 4)
    for y in range(16):
        for x in range(16):
            if c.get(x, y) is None and ((x > 0 and c.get(x - 1, y) == N["violet3"]) or
                                        (y > 0 and c.get(x, y - 1) == N["violet3"])):
                put(c, x, y, "violet1")
    return c


def _d_brazier():
    rows = [
        "    aW    ",
        "   abWa   ",
        "  abbWba  ",
        "   bbbb   ",
        "oooooooooo",
        " oHhhhhlo ",
        "  oHhhlo  ",
        "   oHlo   ",
        "   oHlo   ",
        "  oooooo  ",
    ]
    return d_art(rows, {"a": "violet2", "b": "violet3", "W": "white", "o": "ink", "H": "stone3",
                        "h": "stone2", "l": "stone1"})


def _d_debris():
    rows = [
        "   a      a    ",
        "  aWb    aWc   ",
        " abbc  a abbc  ",
        "abbcc aWc  cc a",
    ]
    return ink(d_art(rows, {"a": "violet3", "W": "white", "b": "violet2", "c": "violet1"}), "violet0")


def _d_twinkle():
    c = _new()
    stamp(c, ["  w  ", "  w  ", "wwWww", "  w  ", "  w  "], {"w": "violet3", "W": "white"}, 3, 3)
    stamp(c, [" w ", "wWw", " w "], {"w": "violet2", "W": "white"}, 10, 10)
    return c


def _d_candles():
    rows = [
        "  y     y   ",
        "  Y  y  Y   ",
        " oWo Y oWo  ",
        " oWl oWlWl  ",
        " oWl oWlWl  ",
        " oWl oWlWl  ",
        "oooooooooooo",
    ]
    return d_art(rows, {"y": "violet3", "Y": "white", "o": "violet0", "W": "dawn0", "l": "dawn1"})


def _d_maskfrag():
    rows = [
        "   aaaaaa  ",
        "  aWbbbbbc ",
        " aWboobooc ",
        " abbbbbbbc ",
        " abbbbbbc  ",
        "  abbbcc   ",
        "   ccc  ac ",
    ]
    return ink(d_art(rows, {"a": "violet3", "W": "white", "b": "violet2", "c": "violet1", "o": "ink"}), "violet0")


def _d_lattice():
    c = _new()
    for i in range(16):
        for k in (0, 8):
            put(c, (i + k) % 16, i, "violet2")
            put(c, (k - i) % 16, i, "violet1")
    for (x, y) in ((0, 0), (8, 0), (4, 4), (12, 4), (0, 8), (8, 8), (4, 12), (12, 12)):
        put(c, x, y, "white")
    return c


DECO = {"moss": deco_moss, "mine": deco_mine, "water": deco_water, "wood": deco_wood,
        "ember": deco_ember, "spire": deco_spire}


# ----------------------------------------------------------------------------- side sheet


def side_sheet(name: str) -> Canvas:
    th = THEMES[name]
    sheet = Canvas(256, 96)

    def at(slot, tile, off=0):
        r, c = SIDE_LAYOUT[slot]
        sheet.blit(tile, (c + off) * 16, r * 16)

    for m in range(16):
        at("solid", solid_tile(th, m), m)
        at("backwall", backwall_tile(th, m), m)
    at("ledge_l", ledge(th, "l"))
    at("ledge_m", ledge(th, "m"))
    at("ledge_r", ledge(th, "r"))
    at("ledge_one", ledge(th, "one"))
    at("vine", vine(th, False))
    at("vine_top", vine(th, True))
    for s in range(4):
        at("crumble", crumble(th, s), s)
        at("blink", blink(th, s), s)
        at("water_top", water_top(s), s)
        at("lava_top", lava_top(s), s)
    at("breakable", breakable(th))
    at("bridge", bridge(th))
    for f in range(2):
        at("water", water_body(f), f)
        at("lava", lava_body(f), f)
    at("spikes", spikes(th))
    at("thorns", thorns(th))
    at("beam", beam(th))
    at("node", node(th, False))
    at("node_broken", node(th, True))
    at("shaft_l", shaft("l"))
    at("shaft_r", shaft("r"))
    at("dart_r", dart_trap(th, "r"))
    at("dart_l", dart_trap(th, "l"))
    deco = DECO[name]()
    assert len(deco) == 18, (name, len(deco))
    for i in range(10):
        at("deco_a", deco[i], i)
    for i in range(8):
        at("solid_var", solid_var(th, i), i)
        at("deco_b", deco[10 + i], i)
    return sheet


# ----------------------------------------------------------------------------- map sheet
# Top-down overworld at the same 16 px grid. The map has no backdrop, so every cell is opaque.

GRASS_BLADES = [
    [(2, 3), (9, 1), (12, 9), (5, 11), (1, 13)],
    [(4, 2), (11, 5), (7, 9), (13, 13), (2, 8)],
    [(6, 4), (1, 7), (10, 11), (13, 2), (5, 14)],
    [(3, 6), (9, 8), (12, 13), (7, 1), (1, 11)],
]


def m_grass(v: int, base="moss2") -> Canvas:
    t = Canvas(16, 16, N[base])
    for (x, y) in GRASS_BLADES[v % 4]:
        put(t, x, y, "moss3")
        put(t, x + 1, y - 1, "moss3")
        put(t, x + 2, y, "moss3")
        put(t, x + 1, y, "moss1")
    if v == 1:
        stamp(t, ["hh", "hl"], {"h": "moss3", "l": "moss1"}, 6, 13)
    if v == 3:
        put(t, 11, 4, "moss4")
        put(t, 12, 4, "moss4")
    return t


def m_flowers(v: int) -> Canvas:
    t = m_grass(v)
    cols = [("white", "gold2"), ("gold2", "fire4"), ("berry2", "gold2"), ("water4", "white")][v]
    pos = [[(4, 4), (11, 9), (6, 12)], [(3, 10), (10, 3), (12, 12)],
           [(5, 5), (12, 6), (3, 12)], [(8, 3), (3, 8), (11, 12)]][v]
    for (x, y) in pos:
        stamp(t, [" p ", "pcp", " p "], {"p": cols[0], "c": cols[1]}, x - 1, y - 1)
        put(t, x, y + 2, "moss1")
    return t


def m_sand(v: int) -> Canvas:
    t = Canvas(16, 16, N["dawn0"])
    spots = [[(3, 3), (10, 7), (6, 12)], [(12, 2), (4, 9), (11, 13)],
             [(7, 5), (2, 13), (13, 10)], [(5, 2), (9, 10), (1, 7)]][v]
    for (x, y) in spots:
        put(t, x, y, "wood4")
        put(t, x + 1, y, "wood4")
        put(t, x + 1, y - 1, "skin2")
    if v == 2:
        stamp(t, [" ww ", "wWWw"], {"w": "dawn1", "W": "white"}, 8, 2)
    if v == 3:
        for x in range(3, 12):
            put(t, x, 13 + (x % 4 == 0), "wood4")
    return t


def m_reeds(v: int) -> Canvas:
    t = m_grass(v, base="moss1")
    xs = [(3, 9, 12), (2, 6, 11), (4, 8, 13), (5, 10, 12)][v]
    for i, x in enumerate(xs):
        top = 3 + (i * 3 + v) % 4
        for y in range(top, 15):
            put(t, x, y, "moss3" if y > top + 2 else "moss2")
        if (i + v) % 2 == 0:
            put(t, x, top, "wood1")
            put(t, x, top + 1, "wood1")
            put(t, x, top - 1, "wood2")
        else:
            put(t, x + 1, top + 1, "moss3")
    put(t, 7, 14, "water2")
    put(t, 8, 14, "water2")
    return t


def _edge_d(x, y, mask, R=8.0):
    """Distance from the pixel centre to the nearest open side, rounded at open corners."""
    top, right, bot, left = (not mask & 1, not mask & 2, not mask & 4, not mask & 8)
    inf = 99.0
    ex = min(x + 0.5 if left else inf, 15.5 - x if right else inf)
    ey = min(y + 0.5 if top else inf, 15.5 - y if bot else inf)
    if ex < R and ey < R:
        return R - math.hypot(R - ex, R - ey)
    return min(ex, ey)


def m_path(mask: int, v=0) -> Canvas:
    t = m_grass(v)
    top, right, bot, left = (mask & 1, mask & 2, mask & 4, mask & 8)
    lo, hi = 4, 11

    def inside(x, y):
        if x < 0 or x > 15 or y < 0 or y > 15:
            return (top and y < 0 and lo <= x <= hi) or (bot and y > 15 and lo <= x <= hi) or \
                   (left and x < 0 and lo <= y <= hi) or (right and x > 15 and lo <= y <= hi)
        if lo <= x <= hi and lo <= y <= hi:
            # round the corners of the centre patch on sides without a path
            cx = x < lo + 1 and not left or x > hi - 1 and not right
            cy = y < lo + 1 and not top or y > hi - 1 and not bot
            return not (cx and cy)
        if top and y < lo and lo <= x <= hi:
            return True
        if bot and y > hi and lo <= x <= hi:
            return True
        if left and x < lo and lo <= y <= hi:
            return True
        if right and x > hi and lo <= y <= hi:
            return True
        return False

    for y in range(16):
        for x in range(16):
            if inside(x, y):
                col = "wood4"
                if not inside(x - 1, y) or not inside(x, y - 1):
                    col = "wood3"
                elif not inside(x + 1, y) or not inside(x, y + 1):
                    col = "dawn0"
                elif (x * 3 + y * 5) % 11 == 0:
                    col = "wood3"
                put(t, x, y, col)
            else:
                # shadow on grass just below/right of the path edge
                if inside(x - 1, y) or inside(x, y - 1):
                    put(t, x, y, "moss1")
    return t


def m_water(mask: int) -> Canvas:
    t = Canvas(16, 16)
    for y in range(16):
        for x in range(16):
            d = _edge_d(x, y, mask)
            if d < 2.2:
                col = "moss2" if (x * 7 + y * 3) % 9 else "moss3"
            elif d < 3.2:
                col = "moss1"
            elif d < 4.2:
                col = "dawn0"
            elif d < 5.2:
                col = "water4"
            elif d < 7.0:
                col = "water3"
            else:
                col = "water2"
            put(t, x, y, col)
    for (x, y) in ((3, 5), (10, 11), (9, 3)):
        if _edge_d(x, y, mask) > 7.5 and _edge_d(x + 2, y, mask) > 7.5:
            for i in range(3):
                put(t, x + i, y, "water3")
            put(t, x + 1, y - 1, "water4")
    return t


def m_forest(mask: int) -> Canvas:
    """Tree crowns: overlapping round clumps, the lower ones in front, lit from the upper left."""
    t = m_grass(mask % 4)
    crowns = []
    for cy in (-4, 4, 12, 20):
        for cx in ((0, 8, 16) if cy % 16 == 12 else (4, 12)):
            crowns.append((cx, cy))
    crowns.sort(key=lambda c: c[1])
    for y in range(16):
        for x in range(16):
            d = _edge_d(x, y, mask)
            wob = 0.7 * math.sin(x * 1.9 + y * 0.6) + 0.5 * math.cos(y * 1.7 - x * 0.9)
            if d < 1.6 + wob:
                # the canopy's shadow on the grass along its lower/right side
                continue
            front = None
            for (cx, cy) in crowns:
                if math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 5.2:
                    front = (cx, cy)
            if front is None:
                col = "moss0"
            else:
                dx, dy = x + 0.5 - front[0], y + 0.5 - front[1]
                r = math.hypot(dx, dy)
                k = dx * 0.6 + dy
                if r > 4.4 and dy > 0:
                    col = "moss0"
                elif k < -3.4:
                    col = "moss4" if k < -4.2 and r < 4.3 else "moss3"
                elif k < -1.2:
                    col = "moss2"
                elif k > 2.4:
                    col = "moss0"
                else:
                    col = "moss1"
            if d < 2.6 + wob:
                col = "moss0"
            put(t, x, y, col)
    return t


def m_rock(mask: int) -> Canvas:
    t = m_grass((mask + 1) % 4)
    for y in range(16):
        for x in range(16):
            d = _edge_d(x, y, mask)
            if d < 1.5:
                continue
            bot_open = not mask & 4
            face = bot_open and (15.5 - y) < 5.5 and d == (15.5 - y) or (bot_open and 15.5 - y < 5.5
                                                                         and d < 5.5 and d >= 15.5 - y - 0.01)
            if d < 2.5:
                col = "ink"
            elif face:
                col = "stone1" if (x % 4) else "stone0"
            else:
                u = (x * 2 + y * 3 + (x // 4) * 5) % 13
                ridge = (x - y) % 8 == 0 or (x + y) % 11 == 0
                col = "stone4" if ridge and u % 2 else ("stone3" if u < 7 else "stone2")
                if (x + 2 * y) % 17 == 0:
                    col = "stone1"
            put(t, x, y, col)
    # a little grass on top of big masses
    if mask == 15:
        stamp(t, ["gG", " g"], {"g": "moss2", "G": "moss3"}, 5, 6)
    return t


def m_gate(frame: int) -> Canvas:
    t = m_path(15)
    stamp(t, ["oooooooooooooooo", "oHhhhhhhhhhhhhlo", "oooooooooooooooo"],
          {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone1"}, 0, 12)
    for i, x in enumerate((2, 6, 10)):
        h = 9 - (i % 2) * 2
        for y in range(12 - h, 12):
            put(t, x, y, "shard3")
            put(t, x + 1, y, "shard2")
            put(t, x + 2, y, "shard1")
        put(t, x + 1, 12 - h - 1, "shard2")
        put(t, x - 1, 11, "shard0")
        put(t, x + 3, 11, "shard0")
    # a glint that climbs the crystals
    gy = [10, 7, 5, 8][frame]
    for x in (2, 6, 10):
        put(t, x, gy + (x == 6) * 1, "white")
    if frame in (1, 2):
        put(t, 7 + frame * 2, 2, "shard3")
    return ink_edges(t)


def ink_edges(t):
    return t


def m_bridge(vertical: bool) -> Canvas:
    t = m_water(1 | 4) if not vertical else m_water(2 | 8)
    t = Canvas(16, 16, N["water2"])
    for (x, y) in ((2, 1), (10, 14)):
        put(t, x, y, "water3")
    for x in range(16):
        for y in range(3, 13):
            edge = x % 4 == 3
            put(t, x, y, "wood0" if edge else ("wood3" if y > 3 else "wood4"))
            if y == 12:
                put(t, x, y, "wood1")
        put(t, x, 2, "wood0")
        put(t, x, 13, "ink")
    for x in (1, 13):
        put(t, x, 2, "wood2")
        put(t, x, 13, "wood2")
    return t if not vertical else _rot(t)


def _rot(c: Canvas) -> Canvas:
    k = Canvas(16, 16)
    for y in range(16):
        for x in range(16):
            k.px[x * 16 + (15 - y)] = c.px[y * 16 + x]
    return k


def m_house() -> Canvas:
    t = m_grass(0)
    rows = [
        "      oo       ",
        "     oRRo      ",
        "    oRRRro     ",
        "   oRRRRrro    ",
        "  oRRRRRrrro   ",
        " oRRRRRRrrrro  ",
        "oooooooooooooo ",
        " oWWWWWWwwwwo  ",
        " oWwoooWwGGwo  ",
        " oWwoDoWwGGwo  ",
        " oWwoDoWwwwwo  ",
        " oooooooooooo  ",
    ]
    stamp(t, rows, {"o": "ink", "R": "berry1", "r": "berry0", "W": "dawn0", "w": "dawn1",
                    "D": "wood2", "G": "gold2"}, 1, 2)
    stamp(t, ["ssssssssssss"], {"s": "moss1"}, 3, 14)
    return t


def m_tower() -> Canvas:
    t = m_grass(2)
    rows = [
        "    oo    ",
        "   oVVo   ",
        "  oVVvvo  ",
        " oVVVvvvo ",
        "oooooooooo",
        " oHhhhhlo ",
        " oHhGghlo ",
        " oHhhhhlo ",
        " oHhhhhlo ",
        " oHhoohlo ",
        " oHhoohlo ",
        " oooooooo ",
    ]
    stamp(t, rows, {"o": "ink", "V": "violet2", "v": "violet1", "H": "stone4", "h": "stone3",
                    "l": "stone2", "G": "gold2", "g": "gold1"}, 3, 2)
    stamp(t, ["ssssssss"], {"s": "moss1"}, 5, 14)
    return t


def m_well() -> Canvas:
    t = m_grass(1)
    rows = [
        "  oooooooooo  ",
        " oRRRRRRrrrro ",
        "oooooooooooooo",
        "  w        w  ",
        "  w  oooo  w  ",
        " oooHhhhhlooo ",
        " oHhwwwwwwhlo ",
        " oHwWWWWWWwlo ",
        " oHhwwwwwwhlo ",
        "  oHhhhhhhlo  ",
        "   oooooooo   ",
    ]
    stamp(t, rows, {"o": "ink", "R": "wood3", "r": "wood2", "w": "wood2", "H": "stone4", "h": "stone3",
                    "l": "stone2", "W": "water2"}, 1, 3)
    return t


def m_stump() -> Canvas:
    t = m_grass(3)
    rows = [
        "   oooooo   ",
        "  oHhhhhlo  ",
        " oHrRRRrhlo ",
        " oHRrrrRhlo ",
        " oHrRRRrhlo ",
        " oollllllooo",
        "o oooooooo o",
    ]
    stamp(t, rows, {"o": "wood0", "H": "wood4", "h": "wood3", "l": "wood1", "r": "wood3", "R": "dawn0"}, 2, 5)
    return t


def m_deco(i: int) -> Canvas:
    t = m_grass(i)
    if i == 0:  # signpost
        stamp(t, ["ooooooooo", "oHhhhhhlo", "oooooooo ", "    ow   ", "    ow   ", "   ooo   "],
              {"o": "ink", "H": "wood4", "h": "wood3", "l": "wood2", "w": "wood2"}, 3, 4)
    elif i == 1:  # boulders
        stamp(t, ["  ooo    ", " oHhlo   ", "oHhhllooo", "ohhllloHlo", " oooooohlo", "      ooo"],
              {"o": "ink", "H": "stone4", "h": "stone3", "l": "stone2"}, 3, 5)
    elif i == 2:  # round bush
        c = Canvas(16, 16)
        shade_disc(c, 8, 8, 5.5, "moss4", "moss3", "moss1", "moss0")
        put(c, 6, 8, "berry2")
        put(c, 10, 6, "berry2")
        ink(c, "ink")
        t.blit(c, 0, 0)
    else:  # standing stones in a ring
        for (x, y) in ((3, 4), (10, 3), (12, 10), (4, 11)):
            stamp(t, ["oo", "Hl", "Hl", "oo"], {"o": "ink", "H": "stone4", "l": "stone2"}, x, y)
        put(t, 8, 8, "shard3")
    return t


def map_sheet() -> Canvas:
    sheet = Canvas(256, 96)

    def at(slot, tile, off=0):
        r, c = MAP_LAYOUT[slot]
        sheet.blit(tile, (c + off) * 16, r * 16)

    for v in range(4):
        at("grass", m_grass(v), v)
        at("flowers", m_flowers(v), v)
        at("sand", m_sand(v), v)
        at("reeds", m_reeds(v), v)
        at("gate", m_gate(v), v)
        at("deco", m_deco(v), v)
    for m in range(16):
        at("path", m_path(m, m % 4), m)
        at("water", m_water(m), m)
        at("forest", m_forest(m), m)
        at("rock", m_rock(m), m)
    at("bridge_h", m_bridge(False))
    at("bridge_v", m_bridge(True))
    at("house", m_house())
    at("tower", m_tower())
    at("well", m_well())
    at("stump", m_stump())
    return sheet


def sheets() -> dict:
    out = {name: side_sheet(name) for name in SIDE_THEMES}
    out[MAP_THEME] = map_sheet()
    return out


def build() -> list[str]:
    paths = []
    for name, sh in sheets().items():
        paths.append(save_tiles(name, sh))
    return paths


if __name__ == "__main__":
    for p in build():
        print("wrote", os.path.relpath(p))
