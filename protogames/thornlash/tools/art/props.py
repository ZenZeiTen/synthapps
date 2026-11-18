"""Props sheet for Thornlash: light sources, pickups, sub-weapons, projectiles, effects.

Small icons are authored by hand below as character grids (one character = one pixel);
fire and glows are generated. Every design is original to this game. One 15-colour
palette (+ transparency). Frame canvas 32x40; pivot is the bottom centre of the object's
game hitbox unless a frame says otherwise.
"""
import json
import math
import random
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "art" / "build" / "props"
W, H = 32, 40
PIV = (16, 39)

KEY = {
    'o': "#140c18", 's': "#2a1a22", 'r': "#6a1622", 'R': "#c42a34", 'P': "#f06a5a",
    'g': "#6c4a1c", 'G': "#c8962e", 'Y': "#f4d68a", 'i': "#3c3450", 'I': "#7a8090",
    'L': "#c8ccd6", 'W': "#fff4e0", 'b': "#243c78", 'B': "#4a7ad0", 'C': "#9ad0f4",
}
PALETTE = list(KEY.values())


def rgba(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def grid(rows, swap=None):
    """Character grid -> RGBA image (tight)."""
    w = max(len(r) for r in rows)
    img = Image.new("RGBA", (w, len(rows)), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if swap and c in swap:
                c = swap[c]
            if c in KEY:
                img.putpixel((x, y), rgba(KEY[c]))
    return img


def place(icon, bottom=39, cx=16, dy=0):
    """Put an icon on the frame canvas so its bottom-centre sits at (cx, bottom)."""
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    f.alpha_composite(icon, (cx - icon.width // 2, bottom - icon.height + 1 + dy))
    return f


def outline(img):
    px = img.load()
    out = []
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < img.width and 0 <= ny < img.height and px[nx, ny][3] and px[nx, ny] != rgba(KEY['o']):
                        out.append((x, y))
                        break
    for x, y in out:
        px[x, y] = rgba(KEY['o'])
    return img


# ------------------------------------------------------------------ hand-authored icons
HEART = [".oo.oo.", "oRPoRRo", "oRRRRRo", ".oRRRo.", "..oRo..", "...o..."]
BIGHEART = [".ooo...ooo.", "oRPPo.oRRRo", "oRPRRoRRRRo", "oRRRRRRRRRo", "oRRRRRRRRro",
            ".oRRRRRRro.", "..oRRRRro..", "...oRRRo...", "....oRo....", ".....o....."]
BAG = ["...oooo...", "...oGGo...", "....oo....", "..oYYGGo..", ".oYGGGGGo.", "oYGGGGGGgo",
       "oGGGGGGGgo", "oGGGGGGGgo", "oGGGGGGggo", ".oGGGGggo.", "..oooooo.."]
WHIPICON = ["....oooooo..", "...oLIIIILo.", "..oIoooooIIo", ".oIo.....oIo", ".oIo.....oIo",
            ".oIIo...oIIo", "..oIIoooIIo.", "...oIIIIIo..", "....oooGo...", "......oGo...",
            "......oGo...", "......ogo...", ".......o...."]
DAGGER = [".oo...........", "oGGoooooooo...", "oYGoLLLLLLLoo.", "oGGoIIIIIIIIIo", ".oo.oooooooo.."]
AXE = ["....oooo....", "..ooLLLLo...", ".oLLIIIIIo..", "oLIIoooIIo..", "oLIo.oGoIo..",
       "oIIo.oGooo..", ".oIo.oGo....", "..oo.oGo....", ".....oGo....", ".....oGo....",
       ".....ogo....", ".....ogo....", "......o....."]
FLASK = ["..oooo..", "..oLLo..", "...oo...", "..oCCo..", ".oCBBBo.", "oCBBBBBo",
         "oBBWBBbo", "oBBBBBbo", "oBBBBbbo", ".obbbbo.", "..oooo.."]
SUNWHEEL = ["......o......", ".....oLo.....", ".....oLo.....", "....oLILo....", ".oooLIIILooo.",
            "oLLIIIoIIILLo", ".oooLIIILooo.", "....oLILo....", ".....oIo.....", ".....oIo.....",
            "......o......"]
GLASS = ["ooooooooo", "oGYYYYYGo", ".oYYYYYo.", ".oCWWWCo.", "..oCWCo..", "...oCo...",
         "...oCo...", "..oCCCo..", ".oCCWCCo.", ".oCWWWCo.", "oGYYYYYGo", "ooooooooo"]
ROAST = ["......oooo...", "....ooGGGGo..", "...oGYYGGGgo.", "..oGYGGGGGgo.", "..oGGGGGGggo.",
         "...oGGGGggo..", "....oggggo...", "...oLoooo....", "..oLWo.......", "..ooo........"]
BELL = [".....o.....", "....oLo....", "....ooo....", "...oLLIo...", "..oLIIIIo..", "..oLIIIIo..",
        "..oLIIIio..", ".oLIIIIIio.", "oLIIIIIIiio", "ooooooooooo", "....oIo....", ".....o....."]
POTION = ["..ooo..", "..oLo..", "..oLo..", ".oCCCo.", "oCBBBBo", "oBWBBbo", "oBBBBbo",
          "oBBBbbo", ".obbbo.", "..ooo.."]
GEM2 = ["..ooooooo..", ".oPPPRRRRo.", "oPRRRRRRRro", "oRWWRWWRRro", "oRWWRWWRRro",
        "oRRRRRRRRro", ".orrrrrrro.", "..ooooooo.."]
GEM3 = ["..ooooooo..", ".oPPPRRRRo.", "oPRRRRRRRro", "oWWRWWRWWro", "oWWRWWRWWro",
        "oRRRRRRRRro", ".orrrrrrro.", "..ooooooo.."]
EMBER = ["....o....", "...oYo...", "...oYo...", "..oYWYo..", ".oGYWYGo.", ".oGYWYGo.",
         "oRGYWYGRo", "oRGGYGGRo", ".oRGGGRo.", "..oRRRo..", "...ooo..."]
CANDLE = ["....oo....", "...oWWo...", "...oWLo...", "...oWLo...", "...oWLo...", "...oLLo...",
          "...oLIo...", ".oooooooo.", "..oIIIIo..", "...oIIo...", "....oo....", "....oo....",
          "....oo....", "...oIIo...", "..oIIIIo..", ".oooooooo."]
LAMP = ["....oo....", "....oo....", ".oooooooo.", ".oIIIIIIo.", "oIoYYYYoIo", "oIoYWWYoIo",
        "oIoYWWYoIo", "oIoGYYGoIo", "oIoGGGGoIo", ".oIIIIIIo.", "..oooooo..", "....oo....",
        "....oo...."]
BONE = ["oo......oo", "oWo....oWo", ".oWooooWo.", "..oWWWWo..", ".oWooooWo.", "oWo....oWo", "oo......oo"]


def flame(seed, w, h, hot=0.0):
    """Procedural pixel flame: ramp white->yellow->gold->red->dark red, flickering by seed."""
    rnd = random.Random(seed)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cx = (w - 1) / 2
    off = [rnd.uniform(-0.8, 0.8) for _ in range(h)]
    for y in range(h):
        t = y / max(1, h - 1)             # 0 top .. 1 bottom
        half = (w / 2) * (0.25 + 0.75 * math.sin(min(1.0, t * 1.15) * math.pi / 2))
        sway = off[y] * (1 - t)
        for x in range(w):
            dx = abs(x - cx - sway) / max(0.5, half)
            if dx <= 1.0:
                heat = (1 - dx) * (0.35 + 0.65 * t) + hot
                c = 'W' if heat > 0.78 else 'Y' if heat > 0.55 else 'G' if heat > 0.34 else 'R' if heat > 0.16 else 'r'
                img.putpixel((x, y), rgba(KEY[c]))
    return img


def brazier(fr):
    """Tall iron brazier, fire in the bowl. 40 px: the game box is 10 x 40."""
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    stand = [
        ".oooooooooooooo.", "oGYYYGGGGGGGGGgo", "oGGGGGGGGGGGGGgo", ".ogggggggggggggo.",
        "..oiiiiiiiiiio..", "...oIIIIIIIIo...", "....oooIIooo....", "......oIIo......",
        "......oLIo......", "......oLIo......", "......oLIo......", ".....ooLIoo.....",
        ".....oGGGGo.....", ".....ooLIoo.....", "......oLIo......", "......oLIo......",
        "......oLIo......", "......oLIo......", "......oLIo......", ".....ooLIoo.....",
        "....oIILIIIo....", "...oIIoLIoIIo...", "..oIIo.oo.oIIo..", ".oIIo......oIIo.",
        "oIIo........oIIo", "oooo........oooo",
    ]
    st = grid(stand)
    f.alpha_composite(st, (16 - st.width // 2, 39 - st.height + 1))
    fl = flame(100 + fr, 12, 14)
    f.alpha_composite(fl, (10, 39 - st.height - 12))
    return f


def candle(fr):
    c = grid(CANDLE)
    f = place(c)
    fl = flame(200 + fr, 5, 6, hot=0.1)
    f.alpha_composite(fl, (14, 39 - c.height - 4))
    return f


def lamp(fr):
    swap = {'W': 'Y', 'Y': 'G'} if fr % 2 else None
    f = place(grid(LAMP, swap), bottom=33)   # hangs from its bracket in the tile above
    return f


def spinning(icon, n, bottom=39):
    out = []
    for i in range(n):
        im = icon.rotate(-90 * i, expand=True)
        out.append(place(im, bottom))
    return out


def burst(i, n=5):
    """Death/destroy burst: flash, expanding flames, breaking into embers."""
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rnd = random.Random(300 + i)
    cx, cy = 16, 26
    if i == 0:
        f.alpha_composite(flame(301, 10, 12, hot=0.4), (11, 18))
        return f
    for k in range(7 - i):
        a = k / (7 - i) * 2 * math.pi + i
        r = 3 + i * 3
        fl = flame(310 + i * 10 + k, 6, 7 - min(3, i))
        f.alpha_composite(fl, (int(cx + math.cos(a) * r) - 3, int(cy + math.sin(a) * r * 0.7) - 4))
    for k in range(i * 2):
        x, y = cx + rnd.randint(-9, 9), cy + rnd.randint(-10, 6)
        if 0 <= x < W and 0 <= y < H:
            f.putpixel((x, y), rgba(KEY['Y' if k % 2 else 'G']))
    return f


def spark(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = 3 + i * 2
    for k in range(-r, r + 1):
        c = rgba(KEY['W' if abs(k) < 2 else 'Y'])
        f.putpixel((16 + k, 20), c)
        f.putpixel((16, 20 + k), c)
        if i == 0 and abs(k) < 3:
            f.putpixel((16 + k, 20 + k), c)
            f.putpixel((16 + k, 20 - k), c)
    return f


def rubble(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rnd = random.Random(400)
    for k in range(8):
        vx, vy = rnd.uniform(-1.5, 1.5), rnd.uniform(-3.2, -1.2)
        t = i * 4
        x = 16 + vx * t
        y = 30 + vy * t + 0.2 * t * t
        for dx in range(2):
            for dy in range(2):
                px, py = int(x) + dx, int(y) + dy
                if 0 <= px < W and 0 <= py < H:
                    f.putpixel((px, py), rgba(KEY['I' if (dx + dy) == 0 else 'i']))
    return f


def splash(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for k in range(-3, 4):
        h = int((8 - abs(k) * 2) * math.sin(min(1.0, (i + 1) / 3) * math.pi) * (1 - i / 6))
        for y in range(max(0, h)):
            px, py = 16 + k * 2, 38 - y
            f.putpixel((px, py), rgba(KEY['C' if y > h - 2 else 'B']))
    return f


def boom(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    s = [14, 20, 24, 22, 16, 10][i]
    fl = flame(500 + i, s, s, hot=0.3 - i * 0.12)
    f.alpha_composite(fl, (16 - s // 2, 22 - s // 2))
    return f


def fireball(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fl = flame(600 + i, 8, 8, hot=0.2).rotate(90, expand=True)
    f.alpha_composite(fl, (12, 31))
    return f


def orb(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    r = 6.5 + (0.6 if i % 2 else 0)
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - 16, y + 0.5 - 30)
            if d <= r:
                lx, ly = (x + 0.5 - 14) / r, (y + 0.5 - 28) / r
                l2 = lx * lx + ly * ly
                c = 'W' if l2 < 0.08 else 'C' if l2 < 0.35 else 'B' if d < r - 1.2 else 'b'
                f.putpixel((x, y), rgba(KEY[c]))
            elif d <= r + 2.5 and (x + y + i) % 2 == 0:
                f.putpixel((x, y), rgba(KEY['C' if d < r + 1.2 else 'b']))
    return f


def pwflame(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for k, off in enumerate((-6, 0, 6)):
        h = 10 + ((i + k) % 3) * 3
        fl = flame(700 + i * 3 + k, 7, h)
        f.alpha_composite(fl, (16 + off - 3, 39 - h + 1))
    return f


def animations():
    A = {}
    A["candle"] = ([candle(i) for i in range(3)], [120, 120, 120], True)
    A["brazier"] = ([brazier(i) for i in range(3)], [100, 100, 100], True)
    A["lamp"] = ([lamp(i) for i in range(2)], [300, 300], True)
    icons = {"heart": HEART, "bigheart": BIGHEART, "whip": WHIPICON, "dagger": DAGGER, "axe": AXE,
             "flask": FLASK, "cross": SUNWHEEL, "glass": GLASS, "roast": ROAST, "rosary": BELL,
             "potion": POTION, "double": GEM2, "triple": GEM3, "oneup": EMBER}
    for k, g in icons.items():
        A["item_" + k] = ([place(grid(g))], [1000], True)
    for k, sw in {"bag100": {'Y': 'L', 'G': 'I', 'g': 'i'}, "bag400": None,
                  "bag700": {'Y': 'P', 'G': 'R', 'g': 'r'}, "bag1000": {'Y': 'C', 'G': 'B', 'g': 'b'}}.items():
        A["item_" + k] = ([place(grid(BAG, sw))], [1000], True)
    A["item_orb"] = ([orb(0), orb(1)], [200, 200], True)
    # player projectiles: pivot at the bottom-centre of the game box
    A["pw_dagger"] = ([place(grid(DAGGER))], [1000], True)
    A["pw_axe"] = (spinning(grid(AXE), 4), [60] * 4, True)
    A["pw_flask"] = (spinning(grid(FLASK), 4), [60] * 4, True)
    A["pw_flame"] = ([pwflame(i) for i in range(4)], [70] * 4, True)
    A["pw_cross"] = (spinning(grid(SUNWHEEL), 2), [50, 50], True)
    A["ep_fire"] = ([fireball(i) for i in range(2)], [80, 80], True)
    A["ep_bone"] = (spinning(grid(BONE), 4), [70] * 4, True)
    A["ep_axe"] = (spinning(grid(AXE), 4), [60] * 4, True)
    A["fx_burst"] = ([burst(i) for i in range(5)], [50, 50, 67, 67, 67], False)
    A["fx_spark"] = ([spark(i) for i in range(2)], [50, 83], False)
    A["fx_rubble"] = ([rubble(i) for i in range(5)], [100] * 5, False)
    A["fx_splash"] = ([splash(i) for i in range(5)], [100] * 5, False)
    A["fx_boom"] = ([boom(i) for i in range(6)], [67] * 6, False)
    return A


def build():
    BUILD.mkdir(parents=True, exist_ok=True)
    meta = {"tags": [], "frames": [], "size": [W, H], "pivot": list(PIV), "palette": PALETTE}
    idx = 0
    for name, (frames, ms, loop) in animations().items():
        start = idx
        for i, img in enumerate(frames):
            img = outline(img) if name.startswith(("fx_", "pw_flame", "ep_fire", "item_orb")) is False else img
            img.save(BUILD / f"{idx:03d}.png")
            meta["frames"].append({"file": f"{idx:03d}.png", "ms": ms[i], "anim": name, "i": i})
            idx += 1
        meta["tags"].append({"name": name, "from": start, "to": idx - 1, "loop": loop})
    (BUILD / "frames.json").write_text(json.dumps(meta, indent=1))
    cols = 16
    rows = (idx + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * W, rows * H), (48, 44, 60, 255))
    for i in range(idx):
        sheet.alpha_composite(Image.open(BUILD / f"{i:03d}.png"), ((i % cols) * W, (i // cols) * H))
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(ROOT / "art" / "build" / "props_preview.png")
    print("props frames:", idx)



# ---------------------------------------------------------------- boss projectiles
IRONBALL = ["...oooo...", ".ooIIIIoo.", ".oILLIIIo.", "oILLIIIIio", "oILIIIIIio", "oIIIIIIiio",
            "oIIIIIiiio", ".oIIiiiio.", ".ooiiiioo.", "...oooo..."]
GEAR = ["...o.o...", "..oIoIo..", ".ooIIIoo.", "oIIIooIIo", ".oIo.oIo.", "oIIIooIIo", ".ooIIIoo.",
        "..oIoIo..", "...o.o..."]
LANTERN = ["....oo....", "...oIIo...", "..oooooo..", ".oIoYYoIo.", ".oIYWWYIo.", ".oIYWWYIo.",
           ".oIoYYoIo.", ".oIoGGoIo.", "..oooooo..", "...oIIo...", "....oo...."]
BLADE = ["o..........o", "oLo......oLo", ".oLo....oLo.", ".oLLooooLLo.", "..oLLLLLLo..", "...oooooo...",
         ".....oo.....", ".....oo....."]


def wave(i):
    f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rnd = random.Random(900 + i)
    for k in range(12):
        x = 10 + k + rnd.randint(-1, 1)
        h = int(8 * math.sin((k + 1) / 13 * math.pi)) + (i % 2)
        for y in range(h):
            f.putpixel((x, 39 - y), rgba(KEY['L' if y > h - 2 else 'I' if y > h / 2 else 'i']))
    return f


_prev_animations = animations


def animations():
    A = _prev_animations()
    A["ep_ball"] = (spinning(grid(IRONBALL), 4), [80] * 4, True)
    A["ep_gear"] = (spinning(grid(GEAR), 2), [60, 60], True)
    A["ep_lantern"] = ([place(grid(LANTERN)), place(grid(LANTERN, {'W': 'Y', 'Y': 'G'}))], [120, 120], True)
    A["ep_blade"] = ([place(grid(BLADE))], [1000], True)
    A["ep_wave"] = ([wave(i) for i in range(2)], [60, 60], True)
    A["ep_flame"] = ([pwflame(i + 4) for i in range(4)], [70] * 4, True)
    VERT = ["....oo....", "...oWLo...", ".ooWLLLoo.", "oWLLooLLIo", "oLLo..oLIo", "oLLLooLIIo",
            ".ooLLLIoo.", "...oIIo...", "....oo...."]
    A["wyrm_seg"] = ([place(grid(VERT))], [1000], True)
    A["wyrm_seg_small"] = ([place(grid(["..oo..", ".oWLo.", "oLooIo", "oLooIo", ".oLIo.", "..oo.."]))], [1000], True)
    return A


if __name__ == "__main__":
    build()
