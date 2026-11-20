"""Tilesets and parallax backgrounds for Thornlash (all original).

Tiles: 16x16, atlas 8 columns. Index map (see scripts/view/render.gd _tile_src):
  0,1 capped stone (open above)   2,3,4 stone fill      5,6,7 ledge left/mid/right
  8,9 brick wall (%)              10 cracked (breakable X)
  11 stair rising right (/)       12 stair rising left (\\)
  13,14 water (2 frames)          15 spikes
Backgrounds are low-contrast, desaturated and dithered with a 4x4 Bayer matrix, so the
hero and enemies own the brightest values. The far castle is the Blender blockout
(art/build/blender/castle_*.png) repainted as pixel art: flat masses, moon rim light,
lit windows.
"""
import json
import math
import random
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot" / "content" / "art"
BLEND = ROOT / "art" / "build" / "blender"
T = 16

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def rgba(h, a=255):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), a)


def lerp_hex(a, b, t):
    ca, cb = rgba(a), rgba(b)
    return "#%02x%02x%02x" % tuple(int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))


def dither_pick(ramp, v, x, y):
    """v in 0..1 over a ramp of hex colours, ordered-dithered between neighbours."""
    v = min(max(v, 0.0), 0.9999) * (len(ramp) - 1)
    i = int(v)
    frac = v - i
    th = (BAYER[y % 4][x % 4] + 0.5) / 16
    return ramp[min(i + (1 if frac > th else 0), len(ramp) - 1)]


# ======================================================================== tiles

AREA_STONE = {
    # dark .. light, plus mortar and moss/accent
    "courtyard": {"stone": ["#1e1a26", "#35303f", "#4d4858", "#6b6676", "#8e8898"], "mortar": "#15121b",
                  "cap": ["#243420", "#3e5a30", "#62843e"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "hall": {"stone": ["#241818", "#3f2a26", "#5a3e34", "#7a5646", "#9c7660"], "mortar": "#170f10",
             "cap": ["#3a2424", "#6a3a30", "#9a5a44"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "belfry": {"stone": ["#161a26", "#28304a", "#3c4866", "#586688", "#7c8aa8"], "mortar": "#0e1018",
               "cap": ["#28304a", "#3c4866", "#6c7a9a"], "wood": ["#26181a", "#4a2e28", "#704a3a"]},
    "catacomb": {"stone": ["#18161a", "#2e2a2a", "#48423c", "#6a6052", "#8e826c"], "mortar": "#0e0c0e",
                 "cap": ["#48423c", "#8e826c", "#c8bca0"], "wood": ["#26181a", "#4a2e28", "#704a3a"]},
    "rampart": {"stone": ["#1a1a24", "#302e3e", "#4a4658", "#686478", "#8e8a9c"], "mortar": "#100e16",
                "cap": ["#243420", "#3e5a30", "#62843e"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "tower": {"stone": ["#141820", "#262c3a", "#3a4256", "#56607a", "#7a849c"], "mortar": "#0c0e14",
              "cap": ["#3a4256", "#56607a", "#8a94ac"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "dungeon": {"stone": ["#161410", "#2a2620", "#423a2e", "#5e5240", "#7e6e54"], "mortar": "#0c0a08",
                "cap": ["#2a2620", "#423a2e", "#6a5e4a"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "clock": {"stone": ["#1a1614", "#302822", "#4a3c30", "#6a5440", "#8e7050"], "mortar": "#0e0a08",
              "cap": ["#6c4a1c", "#9a6a28", "#e0b050"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
    "throne": {"stone": ["#180e14", "#2e1a22", "#482834", "#663a48", "#8a5462"], "mortar": "#0c060a",
               "cap": ["#3a0a14", "#7a1a24", "#b83040"], "wood": ["#2a1a18", "#4e3224", "#76503a"]},
}


def stone_block(img, ox, oy, pal, rnd, rows=((0, 8, 0), (8, 8, 8)), crack=False):
    """Ashlar blocks: two courses of 8 px, joints offset per course, bevel light top-left."""
    st = pal["stone"]
    for (y0, h, off) in rows:
        joints = [(off + k * 16) % 16 for k in range(2)]
        for y in range(y0, y0 + h):
            for x in range(16):
                gx = (x - off) % 16
                if y == y0 + h - 1 or gx == 15:
                    c = pal["mortar"]
                else:
                    lx, ly = gx / 15, (y - y0) / (h - 1)
                    v = 0.62 - 0.28 * ly - 0.12 * lx + rnd.uniform(-0.09, 0.09)
                    if y == y0 or gx == 0:
                        v += 0.22
                    if y == y0 + h - 2 or gx == 14:
                        v -= 0.18
                    c = dither_pick(st[1:], v, ox + x, oy + y)
                img.putpixel((ox + x, oy + y), rgba(c))
    if crack:
        path = [(5, 1), (6, 3), (5, 5), (7, 7), (8, 9), (7, 11), (9, 13), (10, 15)]
        for (x, y) in path:
            img.putpixel((ox + x, oy + y), rgba(pal["mortar"]))
            if x + 1 < 16:
                img.putpixel((ox + x + 1, oy + y), rgba(st[1]))
        for (x, y) in ((11, 3), (12, 4), (3, 10), (2, 11)):
            img.putpixel((ox + x, oy + y), rgba(pal["mortar"]))


def cap_top(img, ox, oy, pal, rnd, area):
    c = pal["cap"]
    for x in range(16):
        depth = 2 + (1 if rnd.random() < 0.35 else 0) + (1 if area == "courtyard" and rnd.random() < 0.25 else 0)
        for y in range(depth):
            img.putpixel((ox + x, oy + y), rgba(c[2] if y == 0 else c[1] if y < depth - 1 else c[0]))
    if area == "courtyard":   # grass blades poking up
        for x in range(0, 16, 3):
            if rnd.random() < 0.6:
                img.putpixel((ox + x, oy), rgba(c[2]))


def ledge(img, ox, oy, pal, kind):
    w = pal["wood"]
    st = pal["stone"]
    for y in range(16):
        for x in range(16):
            if y < 6:
                c = st[3] if y == 0 else st[2] if y < 4 else st[1]
                if (x + (0 if kind != 7 else 3)) % 8 == 7 and y > 0:
                    c = pal["mortar"]
                img.putpixel((ox + x, oy + y), rgba(c))
            elif y < 8:
                img.putpixel((ox + x, oy + y), rgba(pal["mortar"]))
    # corbels under the ends and every 16 px
    for cx in ([2] if kind == 5 else []) + ([12] if kind == 7 else []) + ([6] if kind == 6 else []):
        for y in range(8, 14):
            wdt = max(1, 4 - (y - 8) // 2)
            for x in range(cx - wdt, cx + wdt):
                if 0 <= x < 16:
                    img.putpixel((ox + x, oy + y), rgba(st[2] if x < cx else st[1]))


def stair(img, ox, oy, pal, right=True):
    st = pal["stone"]
    for k in range(2):   # two 8 px steps per tile
        sx = k * 8 if right else 8 - k * 8
        sy = 8 - k * 8
        for y in range(sy, 16):
            for x in range(sx, sx + 8):
                top = y == sy
                c = st[4] if top else st[3] if y == sy + 1 else (pal["mortar"] if y == 15 else st[2] if (x - sx) < 6 else st[1])
                img.putpixel((ox + x, oy + y), rgba(c))


def water(img, ox, oy, fr):
    ramp = ["#0c1428", "#142448", "#1e3a6a", "#3a6a9a", "#7ab0d0"]
    for y in range(16):
        for x in range(16):
            wave = math.sin((x + fr * 4) * 0.8) * 0.5 + math.sin((x * 0.3 - fr * 2)) * 0.3
            v = 0.55 - y / 20 + (0.35 if y <= 1 + wave else 0)
            img.putpixel((ox + x, oy + y), rgba(dither_pick(ramp, v, x, y)))


def spikes(img, ox, oy, pal):
    st = ["#3c3450", "#7a8090", "#c8ccd6"]
    for k in range(4):
        cx = k * 4 + 2
        for y in range(4, 16):
            half = (y - 4) / 12 * 2
            for x in range(16):
                if abs(x + 0.5 - cx) <= half:
                    c = st[2] if x + 0.5 < cx else st[1] if x + 0.5 < cx + 1 else st[0]
                    img.putpixel((ox + x, oy + y), rgba(c))


def brick(img, ox, oy, pal, rnd, alt):
    st = pal["stone"]
    for y in range(16):
        course = y // 4
        off = 0 if course % 2 == 0 else 4
        for x in range(16):
            if y % 4 == 3 or (x + off) % 8 == 7:
                c = pal["mortar"]
            else:
                v = 0.45 + rnd.uniform(-0.12, 0.12) + (0.15 if y % 4 == 0 else 0) - (0.1 if alt else 0)
                c = dither_pick(st[:4], v, x, y)
            img.putpixel((ox + x, oy + y), rgba(c))


def tileset(area):
    pal = AREA_STONE[area]
    rnd = random.Random(hash(area) & 0xffff)
    img = Image.new("RGBA", (8 * T, 2 * T), (0, 0, 0, 0))

    def at(i):
        return (i % 8) * T, (i // 8) * T
    for i in (0, 1, 2, 3, 4):
        ox, oy = at(i)
        offs = ((0, 8, (3 * i) % 16), (8, 8, (3 * i + 8) % 16))
        stone_block(img, ox, oy, pal, rnd, rows=offs)
        if i < 2:
            cap_top(img, ox, oy, pal, rnd, area)
    for i in (5, 6, 7):
        ledge(img, *at(i), pal, i)
    brick(img, *at(8), pal, rnd, False)
    brick(img, *at(9), pal, rnd, True)
    stone_block(img, *at(10), pal, rnd, crack=True)
    stair(img, *at(11), pal, True)
    stair(img, *at(12), pal, False)
    water(img, *at(13), 0)
    water(img, *at(14), 1)
    spikes(img, *at(15), pal)
    img.save(OUT / f"tiles_{area}.png")


# ======================================================================== backgrounds

def sky(name, top, bottom, w=320, h=192, moon=None, stars=True, seed=1):
    rnd = random.Random(seed)
    ramp = [lerp_hex(top, bottom, k / 5) for k in range(6)]
    img = Image.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            img.putpixel((x, y), rgba(dither_pick(ramp, y / h, x, y)))
    if stars:
        for _ in range(60):
            x, y = rnd.randrange(w), rnd.randrange(int(h * 0.6))
            img.putpixel((x, y), rgba("#8a86a8" if rnd.random() < 0.7 else "#d8d4f0"))
    if moon:
        mx, my, r = moon
        for y in range(my - r - 8, my + r + 9):
            for x in range(mx - r - 8, mx + r + 9):
                if not (0 <= x < w and 0 <= y < h):
                    continue
                d = math.hypot(x + 0.5 - mx, y + 0.5 - my)
                if d <= r:
                    cr = math.hypot(x - mx + r * 0.3, y - my + r * 0.2)
                    shade = 0.85 - (d / r) * 0.25 - (0.18 if 3 < cr % 9 < 5 and d < r * 0.8 else 0)
                    c = dither_pick(["#8a8aa4", "#b4b4c8", "#dcdce8", "#f4f2f8"], shade, x, y)
                    img.putpixel((x, y), rgba(c))
                elif d <= r + 8:
                    glow = 1 - (d - r) / 8
                    base = img.getpixel((x, y))
                    th = (BAYER[y % 4][x % 4] + 0.5) / 16
                    if glow * 0.55 > th:
                        img.putpixel((x, y), rgba(lerp_hex("#%02x%02x%02x" % base[:3], "#6a6a90", 0.6)))
    img.save(OUT / f"{name}.png")


def clouds(name, w=640, h=192, seed=3, col=("#2a2440", "#3a3456", "#4c4468"), y0=20, alpha_rows=None):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for _ in range(9):
        cx, cy = rnd.randrange(w), y0 + rnd.randrange(60)
        for k in range(7):
            bx, by = cx + rnd.randint(-40, 40), cy + rnd.randint(-6, 6)
            rx, ry = rnd.randint(14, 34), rnd.randint(5, 10)
            for y in range(by - ry, by + ry + 1):
                for x in range(bx - rx, bx + rx + 1):
                    dx, dy = (x - bx) / rx, (y - by) / ry
                    d = dx * dx + dy * dy
                    if d <= 1 and 0 <= y < h:
                        v = 0.8 - dy * 0.4 - d * 0.3
                        img.putpixel((x % w, y), rgba(dither_pick(list(col), v, x, y)))
    img.save(OUT / f"{name}.png")


def castle_far(name):
    """Repaint the Blender blockout: silhouette mass, moon-side rim light, lit windows."""
    mask = Image.open(BLEND / "castle_mask.png").convert("RGBA")
    lit = Image.open(BLEND / "castle_lit.png").convert("RGBA")
    w, h = mask.size
    rnd = random.Random(11)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ramp = ["#120f1c", "#1b1729", "#262036", "#3a3350"]
    inside = [[mask.getpixel((x, y))[3] > 127 for x in range(w)] for y in range(h)]
    for y in range(h):
        for x in range(w):
            if not inside[y][x]:
                continue
            l = lit.getpixel((x, y))[0] / 255
            v = 0.15 + l * 0.45
            c = dither_pick(ramp[:3], v, x, y)
            # rim light where the moon (upper right) grazes the edge
            if x + 1 < w and y - 1 >= 0 and (not inside[y][x + 1] or not inside[y - 1][x]):
                c = ramp[3]
            out.putpixel((x, y), rgba(c))
    # lit windows: pairs of 1x2 slits on masses away from edges
    for _ in range(90):
        x, y = rnd.randrange(4, w - 4), rnd.randrange(8, h - 30)
        if all(inside[y + dy][x + dx] for dx in (-2, 0, 2) for dy in (-2, 0, 3)):
            c = "#e8b04a" if rnd.random() < 0.7 else "#9a6a30"
            out.putpixel((x, y), rgba(c))
            out.putpixel((x, y + 1), rgba(c))
    out.save(OUT / f"{name}.png")


def courtyard_mid(name, w=640, h=96):
    """Iron fence, dead trees and weathered statues, as near-black silhouettes."""
    rnd = random.Random(21)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dark, mid = rgba("#0e0b14"), rgba("#1c1826")
    # fence: posts every 8 px, rails, spear tips
    for x in range(w):
        for y in (h - 30, h - 12):
            img.putpixel((x, y), dark)
        if x % 8 == 0:
            for y in range(h - 36, h):
                img.putpixel((x, y), dark)
            img.putpixel((x, h - 37), mid)
            img.putpixel((x - 1 if x else 0, h - 35), dark)
            img.putpixel((x + 1, h - 35), dark)
    # dead trees
    def branch(x, y, a, L, wdt):
        for i in range(int(L)):
            px, py = x + math.cos(a) * i, y - math.sin(a) * i
            for k in range(max(1, int(wdt))):
                ix, iy = int(px + k), int(py)
                if 0 <= iy < h:
                    img.putpixel((ix % w, iy), dark)
        if L > 6:
            ex, ey = x + math.cos(a) * L, y - math.sin(a) * L
            branch(ex, ey, a + rnd.uniform(0.3, 0.7), L * 0.62, wdt * 0.7)
            branch(ex, ey, a - rnd.uniform(0.3, 0.7), L * 0.62, wdt * 0.7)
    for tx in (70, 300, 520):
        branch(tx, h, math.pi / 2 + rnd.uniform(-0.15, 0.15), 30, 4)
    # statues on plinths
    for sx in (190, 420):
        for y in range(h - 28, h):
            for x in range(sx - 8, sx + 8):
                img.putpixel((x, y), mid if y == h - 28 else dark)
        for y in range(h - 52, h - 28):
            half = 4 if y > h - 44 else 3
            for x in range(sx - half, sx + half):
                img.putpixel((x, y), dark)
        for y in range(h - 58, h - 52):
            for x in range(sx - 2, sx + 3):
                img.putpixel((x, y), dark)
        for k in range(10):   # a wing raised behind the angel
            for j in range(3):
                img.putpixel((sx + 3 + k // 2, h - 50 - k + j), dark)
    img.save(OUT / f"{name}.png")


def hall_wall(name, w=320, h=192):
    """Interior back wall: two tall arched windows with moonlit panes, pillars, a tapestry."""
    rnd = random.Random(31)
    img = Image.new("RGBA", (w, h))
    wall = ["#140c10", "#1e1418", "#2a1c1e", "#382628"]
    for y in range(h):
        for x in range(w):
            course = y // 8
            off = 0 if course % 2 == 0 else 8
            if y % 8 == 7 or (x + off) % 16 == 15:
                c = wall[0]
            else:
                c = dither_pick(wall[1:], 0.45 + rnd.uniform(-0.1, 0.1) - y / h * 0.3, x, y)
            img.putpixel((x, y), rgba(c))
    for wx in (80, 240):
        top, bot, half = 30, 132, 18
        for y in range(top - half, bot):
            for x in range(wx - half - 3, wx + half + 3):
                inarch = y >= top or math.hypot(x + 0.5 - wx, y + 0.5 - top) <= half + 3
                glass = (y >= top and abs(x + 0.5 - wx) < half) or math.hypot(x + 0.5 - wx, y + 0.5 - top) < half
                if not inarch:
                    continue
                if glass:
                    mull = abs(x + 0.5 - wx) < 1 or (y - top) % 20 == 0 or abs(x + 0.5 - wx) in (9.5,)
                    if mull:
                        c = "#0c0810"
                    else:
                        v = 0.3 + (1 - (y - (top - half)) / (bot - top + half)) * 0.5 + (0.12 if x < wx else 0)
                        c = dither_pick(["#1a2240", "#2a3a66", "#4a6092", "#7a90bc"], v, x, y)
                else:
                    c = "#4a3432" if x < wx else "#2a1c1e"
                img.putpixel((x, y), rgba(c))
        for x in range(wx - half - 5, wx + half + 5):   # sill
            for y in (bot, bot + 1):
                img.putpixel((x, y), rgba("#5a4038" if y == bot else "#1a1014"))
    for px in (0, 160):   # pillars at tile-width spacing that wrap
        for y in range(h):
            for x in range(px - 7, px + 7):
                xx = x % w
                c = ["#1e1418", "#2e2024", "#3e2c2c", "#523a36", "#3e2c2c", "#2e2024", "#1e1418"][min(6, max(0, (x - px + 7) // 2))]
                img.putpixel((xx, y), rgba(c))
    for y in range(40, 110):   # red tapestry between the windows (at x=160 pillar? no: 120..200 wall)
        pass
    img.save(OUT / f"{name}.png")


def bells_far(name, w=640, h=192):
    """Belfry skyline: slender bell towers with open arches and hanging bells."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dark, rim, bell = rgba("#101420"), rgba("#2c3450"), rgba("#6a5a3a")
    for i, (tx, tw, th) in enumerate(((60, 24, 120), (230, 30, 150), (420, 22, 110), (560, 26, 135))):
        top = h - th
        for y in range(top, h):
            for x in range(tx - tw // 2, tx + tw // 2):
                img.putpixel((x, y), rim if x == tx + tw // 2 - 1 else dark)
        for k in range(tw // 2 + 6):   # pointed roof
            for x in range(tx - tw // 2 - 3 + k // 2, tx + tw // 2 + 3 - k // 2):
                if 0 <= top - k < h:
                    img.putpixel((x, top - k), dark)
        ay = top + 14
        for y in range(ay, ay + 20):   # arch opening, the sky shows through
            for x in range(tx - tw // 2 + 4, tx + tw // 2 - 4):
                if y > ay + 3 or abs(x - tx) < (y - ay) + 3:
                    img.putpixel((x, y), (0, 0, 0, 0))
        for y in range(ay + 6, ay + 14):   # the bell
            half = 1 + (y - ay - 6) // 2
            for x in range(tx - half, tx + half + 1):
                img.putpixel((x, y), bell)
    img.save(OUT / f"{name}.png")


def fog(name, w=320, h=48):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            v = (y / h) * (0.6 + 0.4 * math.sin(x / 23.0) * math.sin(x / 57.0 + 1.3))
            th = (BAYER[y % 4][x % 4] + 0.5) / 16
            if v > th:
                img.putpixel((x, y), rgba("#8a88a8", 70 if v < 0.6 else 110))
    img.save(OUT / f"{name}.png")


def wall_base(w, h, ramp, seed, course=8, block=16):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (w, h))
    for y in range(h):
        for x in range(w):
            off = 0 if (y // course) % 2 == 0 else block // 2
            if y % course == course - 1 or (x + off) % block == block - 1:
                c = ramp[0]
            else:
                c = dither_pick(ramp[1:], 0.5 + rnd.uniform(-0.1, 0.1) - (y / h) * 0.25, x, y)
            img.putpixel((x, y), rgba(c))
    return img


def ossuary(name, w=320, h=192):
    """Catacomb wall: rows of arched niches, each holding a skull; bones stacked between."""
    img = wall_base(w, h, ["#0c0a0c", "#1a1618", "#262022", "#322a2a"], 41)
    bone = ["#3e3830", "#6a6052", "#948670"]
    for row, ny in enumerate((28, 76, 124)):
        for nx in range(10 + (row % 2) * 20, w, 40):
            for y in range(ny - 12, ny + 14):
                for x in range(nx - 10, nx + 10):
                    inside = y >= ny - 4 or math.hypot(x + 0.5 - nx, y + 0.5 - (ny - 4)) < 9
                    if inside and 0 <= x < w:
                        img.putpixel((x, y), rgba("#08060a"))
            for y in range(ny, ny + 9):   # a skull in the niche
                for x in range(nx - 4, nx + 5):
                    d = math.hypot((x - nx) / 4.5, (y - ny - 4) / 4.5)
                    if d < 1 and 0 <= x < w:
                        c = bone[2] if x < nx and y < ny + 4 else bone[1]
                        img.putpixel((x, y), rgba(c))
            for (ex, ey) in ((nx - 2, ny + 4), (nx + 1, ny + 4)):
                img.putpixel((ex, ey), rgba("#08060a"))
            for x in range(nx - 10, nx + 10):    # stacked long bones along the ledge
                if 0 <= x < w:
                    img.putpixel((x, ny + 14), rgba(bone[1] if x % 5 else bone[0]))
                    img.putpixel((x, ny + 15), rgba(bone[0]))
    img.save(OUT / f"{name}.png")


def battlements(name, w=640, h=96):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dark, rim = rgba("#100e18"), rgba("#262234")
    for x in range(w):
        top = h - 40 if (x // 12) % 2 == 0 else h - 48
        for y in range(top, h):
            img.putpixel((x, y), rim if y == top else dark)
    for tx in (90, 330, 540):   # round towers with conical caps
        for y in range(h - 80, h):
            for x in range(tx - 14, tx + 14):
                img.putpixel((x % w, y), rim if x == tx + 13 else dark)
        for k in range(18):
            for x in range(tx - 17 + k, tx + 17 - k):
                img.putpixel((x % w, h - 80 - k), dark)
        for y in (h - 64, h - 52):
            img.putpixel((tx % w, y), rgba("#e8b04a"))
    img.save(OUT / f"{name}.png")


def tower_wall(name, w=320, h=192):
    img = wall_base(w, h, ["#0a0c12", "#161a24", "#1e2432", "#283042"], 51)
    for sx in (60, 180, 290):   # arrow slits with moonlight
        for y in range(40, 90):
            for x in range(sx - 2, sx + 2):
                img.putpixel((x, y), rgba("#4a6092" if x < sx else "#2a3a66"))
        for y in range(36, 94):
            img.putpixel((sx - 3, y), rgba("#303a50"))
            img.putpixel((sx + 2, y), rgba("#0a0c12"))
    for tx in (120, 240):   # iron torch brackets with a warm glow
        for y in range(100, 112):
            img.putpixel((tx, y), rgba("#3c3450"))
        for r in range(1, 14):
            for a in range(0, 360, 12):
                x = int(tx + math.cos(math.radians(a)) * r)
                y = int(96 + math.sin(math.radians(a)) * r)
                if 0 <= x < w and 0 <= y < h and (BAYER[y % 4][x % 4] + 0.5) / 16 < (1 - r / 14) * 0.6:
                    img.putpixel((x, y), rgba("#5a3a26"))
    img.save(OUT / f"{name}.png")


def dungeon_wall(name, w=320, h=192):
    img = wall_base(w, h, ["#080706", "#141210", "#1e1a16", "#2a241e"], 61, course=10, block=20)
    for cx in (70, 230):    # barred cell openings
        for y in range(70, 150):
            for x in range(cx - 26, cx + 26):
                inside = y >= 86 or math.hypot(x + 0.5 - cx, y + 0.5 - 86) < 26
                if inside:
                    img.putpixel((x, y), rgba("#040304"))
        for bx in range(cx - 22, cx + 24, 7):
            for y in range(62, 150):
                if y >= 86 or math.hypot(bx + 0.5 - cx, y + 0.5 - 86) < 26:
                    img.putpixel((bx, y), rgba("#4a4a58"))
                    img.putpixel((bx + 1, y), rgba("#24242e"))
    for chx in (150, 300):   # hanging chains with manacles
        for y in range(0, 70):
            c = "#4a4a58" if (y // 3) % 2 == 0 else "#24242e"
            img.putpixel((chx + (1 if (y // 3) % 2 else 0), y), rgba(c))
        for x in range(chx - 3, chx + 4):
            img.putpixel((x, 72), rgba("#4a4a58"))
    img.save(OUT / f"{name}.png")


def gears(name, w=640, h=192, seed=71):
    """Huge clock gears silhouetted behind the spire (a slow parallax layer)."""
    rnd = random.Random(seed)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for gx, gy, R, teeth in ((90, 70, 60, 18), (260, 150, 44, 14), (420, 60, 70, 20), (580, 140, 50, 16)):
        for y in range(max(0, gy - R - 8), min(h, gy + R + 9)):
            for x in range(gx - R - 8, gx + R + 9):
                d = math.hypot(x + 0.5 - gx, y + 0.5 - gy)
                a = math.atan2(y - gy, x - gx)
                tooth = (math.sin(a * teeth) > 0.2)
                edge = R + (6 if tooth else 0)
                if d <= edge and not (R * 0.45 < d < R * 0.75 and (int(math.degrees(a) + 360) // 30) % 2 == 0):
                    if d > R * 0.18:
                        c = "#2a2018" if d > edge - 2 else "#1a1410"
                        img.putpixel((x % w, y), rgba(c))
    img.save(OUT / f"{name}.png")


def throne_hall(name, w=320, h=192):
    img = wall_base(w, h, ["#0a0408", "#160a10", "#201016", "#2c161e"], 81)
    cx, cy, R = 160, 60, 38     # rose window
    for y in range(cy - R - 3, cy + R + 4):
        for x in range(cx - R - 3, cx + R + 4):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= R:
                a = math.atan2(y - cy, x - cx)
                petal = (math.cos(a * 8) + 1) / 2
                if abs(math.sin(a * 8)) < 0.12 or abs(d - R * 0.45) < 1 or abs(d - R * 0.85) < 1:
                    c = "#0a0408"
                else:
                    ramp = ["#3a0a14", "#7a1a24", "#b83040", "#e0a060"] if d > R * 0.45 else ["#243c78", "#4a7ad0", "#9ad0f4"]
                    c = dither_pick(ramp, 0.3 + 0.5 * petal * (1 - d / R) + 0.2, x, y)
                img.putpixel((x, y), rgba(c))
            elif d <= R + 3:
                img.putpixel((x, y), rgba("#4a2a30"))
    for px in (40, 280):    # columns
        for y in range(h):
            for x in range(px - 10, px + 10):
                k = (x - px + 10) / 20
                c = dither_pick(["#1e0e14", "#3a1e26", "#5a3038", "#3a1e26", "#1e0e14"], k, x, y)
                img.putpixel((x, y), rgba(c))
    for bx in (90, 230):    # crimson banners with a thorn device
        for y in range(20, 120):
            for x in range(bx - 12, bx + 12):
                if y < 110 or abs(x - bx) < (120 - y) + 2:
                    c = dither_pick(["#3a0a14", "#7a1a24", "#b83040"], 0.6 - abs(x - bx) / 30, x, y)
                    img.putpixel((x, y), rgba(c))
        for k in range(30):
            img.putpixel((bx + int(math.sin(k * 0.5) * 5), 50 + k), rgba("#c8962e"))
    img.save(OUT / f"{name}.png")


AREAS = {
    "courtyard": {"sky": "#0c0a1a", "rain": True, "lightning": True, "fog": True, "bats": True,
                  "layers": [{"file": "bg_sky_moon", "px": 0.0, "py": 0.0},
                             {"file": "bg_clouds", "px": 0.05, "py": 0.0, "drift": 0.08, "y": 0},
                             {"file": "bg_castle", "px": 0.15, "py": 0.05, "y": 0},
                             {"file": "bg_courtyard_mid", "px": 0.45, "py": 0.2, "y": 96}]},
    "hall": {"sky": "#0a0608", "rain": False, "lightning": True, "fog": False,
             "layers": [{"file": "bg_hall_wall", "px": 0.4, "py": 0.1, "y": 0}]},
    "belfry": {"sky": "#0a0c16", "rain": False, "lightning": False, "fog": True, "bats": True,
               "layers": [{"file": "bg_sky_belfry", "px": 0.0, "py": 0.0},
                          {"file": "bg_clouds_belfry", "px": 0.08, "py": 0.0, "drift": 0.15},
                          {"file": "bg_bells", "px": 0.3, "py": 0.1, "y": 0}]},
    "catacomb": {"sky": "#060406", "fog": True, "layers": [{"file": "bg_ossuary", "px": 0.4, "py": 0.2}]},
    "rampart": {"sky": "#0c0a1a", "rain": True, "lightning": True, "fog": False, "bats": True,
                "layers": [{"file": "bg_sky_moon", "px": 0.0, "py": 0.0},
                           {"file": "bg_clouds", "px": 0.06, "py": 0.0, "drift": 0.2},
                           {"file": "bg_castle", "px": 0.12, "py": 0.05},
                           {"file": "bg_battlements", "px": 0.4, "py": 0.2, "y": 96}]},
    "tower": {"sky": "#080a10", "layers": [{"file": "bg_tower_wall", "px": 0.5, "py": 0.5}]},
    "dungeon": {"sky": "#050404", "fog": True, "layers": [{"file": "bg_dungeon_wall", "px": 0.4, "py": 0.2}]},
    "clock": {"sky": "#0e0a08", "layers": [{"file": "bg_tower_wall", "px": 0.3, "py": 0.3},
                                            {"file": "bg_gears", "px": 0.5, "py": 0.4}]},
    "throne": {"sky": "#0a0408", "lightning": True, "layers": [{"file": "bg_throne", "px": 0.35, "py": 0.2}]},
}


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for a in AREA_STONE:
        tileset(a)
    sky("bg_sky_moon", "#07061a", "#2a1f3e", moon=(250, 40, 16), seed=1)
    clouds("bg_clouds", seed=3)
    castle_far("bg_castle")
    courtyard_mid("bg_courtyard_mid")
    hall_wall("bg_hall_wall")
    sky("bg_sky_belfry", "#050814", "#1c2a44", moon=(70, 36, 11), seed=5)
    clouds("bg_clouds_belfry", seed=8, col=("#1a2236", "#26304a", "#34405e"), y0=40)
    bells_far("bg_bells")
    fog("fog")
    ossuary("bg_ossuary")
    battlements("bg_battlements")
    tower_wall("bg_tower_wall")
    dungeon_wall("bg_dungeon_wall")
    gears("bg_gears")
    throne_hall("bg_throne")
    (OUT / "areas.json").write_text(json.dumps(AREAS, indent=1))
    print("world art written")


if __name__ == "__main__":
    build()
