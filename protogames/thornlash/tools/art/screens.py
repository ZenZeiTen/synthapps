"""Title screen and ending pages for Thornlash (original art). 320x224 each.

title.png:     moonlit sky, the Hollowmoor skyline, a crag with Corvin looking up at the
               keep, and the THORNLASH logo: bevelled capitals wrapped in a thorn vine.
ending_0..2:   dawn over the collapsing keep; the empty crag in morning light; Corvin on
               the causeway home.
"""
import math
import random
from pathlib import Path
from PIL import Image

import world as Wd

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "godot" / "content" / "art"
BUILD = ROOT / "art" / "build"
W, H = 320, 224


def rgba(h, a=255):
    return Wd.rgba(h, a)


def sky(top, bottom, seed=1, stars=True):
    ramp = [Wd.lerp_hex(top, bottom, k / 5) for k in range(6)]
    img = Image.new("RGBA", (W, H))
    rnd = random.Random(seed)
    for y in range(H):
        for x in range(W):
            img.putpixel((x, y), rgba(Wd.dither_pick(ramp, y / H, x, y)))
    if stars:
        for _ in range(70):
            img.putpixel((rnd.randrange(W), rnd.randrange(120)), rgba("#b4b0d0" if rnd.random() < 0.8 else "#ffffff"))
    return img


def paste_layer(img, path, dx, dy, tint=None):
    lay = Image.open(path).convert("RGBA")
    if tint:
        px = lay.load()
        for y in range(lay.height):
            for x in range(lay.width):
                if px[x, y][3]:
                    px[x, y] = rgba(tint)
    img.alpha_composite(lay.crop((dx, 0, dx + W, lay.height)) if lay.width >= dx + W else lay, (0, dy))


def crag(img, top_y, col="#0a0810", rim="#2a2438", seed=4):
    rnd = random.Random(seed)
    h = top_y
    for x in range(W):
        h += rnd.choice((-1, 0, 0, 1))
        h = max(top_y - 8, min(top_y + 8, h))
        for y in range(h, H):
            img.putpixel((x, y), rgba(rim if y == h else col))


def logo(img, y0, glow=True):
    """THORNLASH in 3x bevelled capitals from the game font, wrapped by a thorn vine."""
    font = Image.open(ART / "font.png").convert("RGBA")
    text = "THORNLASH"
    S = 3
    cw = 6 * S
    x0 = (W - len(text) * cw) // 2
    ink = set()
    for i, ch in enumerate(text):
        gi = ord(ch) - 32
        gx, gy = (gi % 16) * 6, (gi // 16) * 9
        for y in range(7):
            for x in range(5):
                if font.getpixel((gx + x, gy + y))[3]:
                    for dy in range(S):
                        for dx in range(S):
                            ink.add((x0 + i * cw + x * S + dx, y0 + y * S + dy))
    ramp = ["#5a0a14", "#a01a22", "#d8403a", "#f4b070"]
    # drop shadow, body with a vertical ramp, top highlight, dark outline
    for (x, y) in ink:
        img.putpixel((x + 2, y + 2), rgba("#050206"))
    for (x, y) in ink:
        k = (y - y0) / (7 * S)
        c = Wd.dither_pick(ramp[1:3] if k > 0.35 else ramp[2:], 1 - k, x, y)
        if (x, y - 1) not in ink:
            c = ramp[3]
        if (x + 1, y) not in ink or (x, y + 1) not in ink:
            c = ramp[0]
        img.putpixel((x, y), rgba(c))
    edge = set()
    for (x, y) in ink:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in ink:
                edge.add((x + dx, y + dy))
    for (x, y) in edge:
        if 0 <= x < W and 0 <= y < H:
            img.putpixel((x, y), rgba("#140810"))
    # the thorn vine: a wave threaded through the letters, with thorns
    for x in range(x0 - 14, x0 + len(text) * cw + 14):
        y = int(y0 + 10 + math.sin((x - x0) / 9.0) * 12)
        for t in (0, 1):
            if 0 <= x < W and (x, y + t) not in ink:
                img.putpixel((x, y + t), rgba("#2e5046" if t else "#4e7c62"))
        if x % 9 == 0:
            for k in range(1, 4):
                yy = y - k if (x // 9) % 2 else y + 1 + k
                if (x + k // 2, yy) not in ink:
                    img.putpixel((x + k // 2, yy), rgba("#1c2e2c"))


def text_small(img, s, cx, y, col):
    font = Image.open(ART / "font.png").convert("RGBA")
    x0 = cx - len(s) * 3
    for i, ch in enumerate(s):
        gi = ord(ch) - 32
        gx, gy = (gi % 16) * 6, (gi // 16) * 9
        for yy in range(9):
            for xx in range(6):
                if font.getpixel((gx + xx, gy + yy))[3]:
                    img.putpixel((x0 + i * 6 + xx + 1, y + yy + 1), rgba("#050206"))
                    img.putpixel((x0 + i * 6 + xx, y + yy), rgba(col))


def hero_frame(anim, i=0):
    import json
    m = json.loads((BUILD / "hero" / "frames.json").read_text())
    for f in m["frames"]:
        if f["anim"] == anim and f["i"] == i:
            return Image.open(BUILD / "hero" / f["file"]).convert("RGBA")
    raise KeyError(anim)


def title():
    img = sky("#05041a", "#2a1f3e", seed=2)
    # the moon, big and low behind the keep
    mx, my, r = 206, 70, 30
    for y in range(my - r - 12, my + r + 13):
        for x in range(mx - r - 12, mx + r + 13):
            d = math.hypot(x + 0.5 - mx, y + 0.5 - my)
            if d <= r:
                c = Wd.dither_pick(["#9a9ab4", "#c4c4d8", "#e8e8f0", "#fbf9ff"], 0.95 - d / r * 0.35 - (0.12 if (x * 3 + y * 5) % 17 < 3 and d < r * 0.8 else 0), x, y)
                img.putpixel((x, y), rgba(c))
            elif d <= r + 12 and (Wd.BAYER[y % 4][x % 4] + 0.5) / 16 < (1 - (d - r) / 12) * 0.5:
                img.putpixel((x, y), rgba("#4a4468"))
    paste_layer(img, ART / "bg_castle.png", 150, 38)
    crag(img, 186, seed=9)
    hero = hero_frame("idle", 0)
    sil = Image.new("RGBA", hero.size)
    px, sp = hero.load(), sil.load()
    for y in range(hero.height):
        for x in range(hero.width):
            if px[x, y][3]:
                sp[x, y] = rgba("#0a0810")
    img.alpha_composite(sil, (40, 186 - 62))
    logo(img, 108)
    text_small(img, "THE VIGIL OF HOLLOWMOOR", 160, 140, "#f0d8a0")
    img.save(ART / "title.png")


def ending(n):
    if n == 0:
        img = sky("#1a1030", "#e07a4a", seed=5, stars=False)
        paste_layer(img, ART / "bg_castle.png", 150, 30, tint="#1a1020")
        # the keep folding into smoke: a dithered plume
        for y in range(10, 120):
            for x in range(120, 220):
                d = abs(x - 170 - math.sin(y / 9) * 8) / (10 + (120 - y) * 0.35)
                if d < 1 and (Wd.BAYER[y % 4][x % 4] + 0.5) / 16 < (1 - d) * 0.8:
                    img.putpixel((x, y), rgba("#4a3a4a" if y < 60 else "#6a4a4a"))
        crag(img, 170, col="#140c14", rim="#3a2430", seed=3)
    elif n == 1:
        img = sky("#4a6aa0", "#f4c08a", seed=6, stars=False)
        sx, sy, r = 160, 150, 22
        for y in range(sy - r, sy + 1):
            for x in range(sx - r, sx + r + 1):
                if math.hypot(x - sx, y - sy) <= r:
                    img.putpixel((x, y), rgba("#fff0c0"))
        crag(img, 150, col="#2a2030", rim="#6a4a50", seed=12)
    else:
        img = sky("#6a8ac0", "#f0d0a0", seed=7, stars=False)
        for y in range(160, H):   # the causeway across the fen
            for x in range(W):
                c = "#3a3040" if 170 <= y <= 176 else Wd.dither_pick(["#2a4a44", "#3e6a58", "#5a8a6a"], (y - 160) / 64, x, y)
                img.putpixel((x, y), rgba(c))
        hero = hero_frame("walk", 2)
        img.alpha_composite(hero, (200, 176 - 62))
    img.save(ART / f"ending_{n}.png")


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    title()
    for n in range(3):
        ending(n)
    print("title and ending pages written")
