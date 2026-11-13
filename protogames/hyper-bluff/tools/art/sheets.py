"""Cards, power icons and fonts.

  python3 tools/art/sheets.py paint    # paint frames -> art/cards.aseprite, art/icons.aseprite
  python3 tools/art/sheets.py export   # .aseprite -> godot/assets/art/cards.png, icons.png (+json)
  python3 tools/art/sheets.py fonts    # godot/assets/art/font*.png
  python3 tools/art/sheets.py all

The export step reads the .aseprite files, so a hand edit made in Aseprite is what ships.
Run `paint` only to start over: it overwrites the sources.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from asefile import Sprite
import fontglyphs as FG

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art"
OUT = ROOT / "godot" / "assets" / "art"
CW, CH = 40, 56
RANKS = "23456789TJQKA"
INK = (24, 20, 44, 255)
RED = (214, 40, 72, 255)
NAVY = (36, 44, 96, 255)
PAPER = (250, 246, 232, 255)
SHADE = (214, 204, 186, 255)
GOLD = (248, 196, 56, 255)

PIPS = {
    0: ["....#....", "...###...", "..#####..", ".#######.", "#########", "#########", ".##.#.##.", "....#....", "...###..."],
    1: [".##...##.", "####.####", "#########", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."],
    2: ["....#....", "...###...", "..#####..", ".#######.", "#########", ".#######.", "..#####..", "...###...", "....#...."],
    3: ["...###...", "..#####..", "..#####..", ".#.###.#.", "####.####", "#########", ".##.#.##.", "....#....", "...###..."],
}
ICONS = ["hawk", "swap", "guard", "over", "sight", "glare", "empty", "star", "dealer"]


def glyph(img, ch, x, y, col, scale=1):
    for gy, row in enumerate(FG.glyph_rows(ch)):
        for gx, c in enumerate(row):
            if c == "#":
                for dy in range(scale):
                    for dx in range(scale):
                        px, py = x + gx * scale + dx, y + gy * scale + dy
                        if 0 <= px < img.width and 0 <= py < img.height:
                            img.putpixel((px, py), col)


def pip(img, suit, x, y, col, scale=1):
    for gy, row in enumerate(PIPS[suit]):
        for gx, c in enumerate(row):
            if c == "#":
                for dy in range(scale):
                    for dx in range(scale):
                        img.putpixel((x + gx * scale + dx, y + gy * scale + dy), col)


def card_base():
    img = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, CW - 1, CH - 1], 4, fill=PAPER, outline=INK)
    d.line([2, CH - 3, CW - 3, CH - 3], fill=SHADE)
    d.line([CW - 3, 3, CW - 3, CH - 3], fill=SHADE)
    return img


def card_face(c):
    r, s = c % 13, c // 13
    col = RED if s in (1, 2) else NAVY
    base = card_base()
    art = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    if r >= 9 and r <= 11:      # J Q K: a gold banner with a crown
        d.rectangle([14, 30, 36, 50], fill=GOLD, outline=INK)
        for i in range(3 if r == 9 else 5):
            x0 = 16 + i * (8 if r == 9 else 4)
            d.polygon([(x0, 30), (x0 + 2, 24 if i % 2 == 0 else 26), (x0 + 4, 30)], fill=GOLD, outline=INK)
        pip(art, s, 21, 36, col)
    elif r == 12:               # ace: one huge pip with a gold burst
        for a in range(8):
            import math
            x1 = 25 + int(15 * math.cos(a * math.pi / 4))
            y1 = 36 + int(15 * math.sin(a * math.pi / 4))
            d.line([25, 36, x1, y1], fill=GOLD)
        pip(art, s, 12, 23, col, 3)
    else:
        pip(art, s, 16, 26, col, 2)
    label = "10" if r == 8 else RANKS[r]
    x = 3
    for ch in label:
        glyph(art, ch, x, 3, col, 2)
        x += 9 if label == "10" else 12
    pip(art, s, 4, 19 if True else 0, col) if False else None
    small = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    pip(small, s, 26 if label == "10" else 18, 4, col)
    art = Image.alpha_composite(art, small)
    return base, art


def card_back():
    img = card_base()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([3, 3, CW - 4, CH - 4], 2, fill=(120, 36, 150, 255), outline=INK)
    for y in range(5, CH - 5):
        for x in range(5, CW - 5):
            if (x + y) % 6 == 0 or (x - y) % 6 == 0:
                img.putpixel((x, y), (236, 96, 190, 255))
    d.polygon([(20, 18), (30, 28), (20, 38), (10, 28)], fill=GOLD, outline=INK)
    d.polygon([(20, 23), (25, 28), (20, 33), (15, 28)], fill=(255, 244, 190, 255))
    return img


def tile(col):
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, 31, 31], 5, fill=col, outline=INK)
    d.rounded_rectangle([2, 2, 29, 29], 4, outline=tuple(min(255, v + 60) for v in col[:3]) + (255,))
    return img, d


def icon(name):
    W = (255, 255, 255, 255)
    if name == "hawk":
        img, d = tile((30, 120, 200, 255))
        d.polygon([(4, 16), (16, 7), (28, 16), (16, 25)], fill=W, outline=INK)
        d.ellipse([11, 11, 21, 21], fill=GOLD, outline=INK)
        d.ellipse([14, 14, 18, 18], fill=INK)
    elif name == "swap":
        img, d = tile((40, 160, 90, 255))
        d.arc([6, 6, 26, 26], 200, 340, fill=W, width=3)
        d.arc([6, 6, 26, 26], 20, 160, fill=W, width=3)
        d.polygon([(24, 5), (29, 13), (20, 13)], fill=W)
        d.polygon([(8, 27), (3, 19), (12, 19)], fill=W)
    elif name == "guard":
        img, d = tile((110, 110, 140, 255))
        d.polygon([(16, 4), (27, 8), (26, 18), (16, 28), (6, 18), (5, 8)], fill=(210, 220, 240, 255), outline=INK)
        d.polygon([(16, 7), (16, 25), (8, 17), (8, 10)], fill=(150, 165, 200, 255))
        d.line([16, 10, 16, 22], fill=GOLD, width=2)
        d.line([11, 14, 21, 14], fill=GOLD, width=2)
    elif name == "over":
        img, d = tile((220, 80, 30, 255))
        d.polygon([(18, 3), (8, 17), (15, 17), (12, 29), (24, 13), (17, 13)], fill=GOLD, outline=INK)
    elif name == "sight":
        img, d = tile((130, 60, 190, 255))
        d.ellipse([6, 4, 26, 24], fill=(190, 230, 255, 255), outline=INK)
        d.arc([9, 7, 20, 18], 180, 270, fill=W, width=2)
        d.polygon([(8, 24), (24, 24), (27, 29), (5, 29)], fill=GOLD, outline=INK)
        d.point([(18, 13), (17, 14), (19, 14), (18, 15)], fill=(130, 60, 190, 255))
    elif name == "glare":
        img, d = tile((60, 16, 40, 255))
        for x0, flip in ((4, 1), (18, -1)):
            pts = [(x0, 12), (x0 + 10, 16), (x0 + 10, 21), (x0, 19)] if flip == 1 else [(x0 + 10, 12), (x0, 16), (x0, 21), (x0 + 10, 19)]
            d.polygon(pts, fill=(255, 60, 60, 255), outline=INK)
            d.rectangle([x0 + 4, 15, x0 + 6, 19], fill=GOLD)
        d.line([3, 9, 13, 13], fill=W, width=2)
        d.line([28, 9, 18, 13], fill=W, width=2)
    elif name == "empty":
        img, d = tile((30, 26, 56, 255))
        d.rounded_rectangle([8, 8, 23, 23], 3, outline=(80, 74, 120, 255))
    elif name == "star":
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        import math
        pts = []
        for i in range(10):
            rad = 14 if i % 2 == 0 else 6
            a = -math.pi / 2 + i * math.pi / 5
            pts.append((16 + rad * math.cos(a), 16 + rad * math.sin(a)))
        d.polygon(pts, fill=GOLD, outline=INK)
        d.polygon([(16, 8), (18, 14), (16, 16), (12, 14)], fill=(255, 250, 200, 255))
    else:
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse([4, 4, 27, 27], fill=W, outline=INK)
        d.ellipse([7, 7, 24, 24], outline=RED)
        glyph(img, "D", 11, 9, INK, 2)
    return img


def paint():
    ART.mkdir(exist_ok=True)
    spr = Sprite(CW, CH)
    spr.palette = ["#18142c", "#d62848", "#242c60", "#faf6e8", "#d6ccba", "#f8c438", "#782496", "#ec60be"]
    lb = spr.add_layer("card")
    la = spr.add_layer("pips")
    for c in range(52):
        f = spr.add_frame(100)
        base, art = card_face(c)
        spr.set_cel(lb, f, base)
        spr.set_cel(la, f, art)
    f = spr.add_frame(100)
    spr.set_cel(lb, f, card_back())
    for s, n in enumerate(["spades", "hearts", "diamonds", "clubs"]):
        spr.add_tag(n, s * 13, s * 13 + 12)
    spr.add_tag("back", 52, 52)
    spr.save(ART / "cards.aseprite")
    spr = Sprite(32, 32)
    spr.palette = ["#18142c", "#f8c438", "#ffffff", "#1e78c8", "#28a05a", "#6e6e8c", "#dc501e", "#823cbe", "#3c1028"]
    lay = spr.add_layer("icon")
    for i, n in enumerate(ICONS):
        f = spr.add_frame(100)
        spr.set_cel(lay, f, icon(n))
        spr.add_tag(n, i, i)
    spr.save(ART / "icons.aseprite")
    print("painted cards.aseprite, icons.aseprite")


def export():
    OUT.mkdir(parents=True, exist_ok=True)
    spr = Sprite.load(ART / "cards.aseprite")
    assert (spr.w, spr.h, len(spr.durations)) == (CW, CH, 53), "cards.aseprite must be 40x56 with 53 frames"
    sheet = Image.new("RGBA", (13 * CW, 5 * CH), (0, 0, 0, 0))
    for c in range(53):
        sheet.paste(spr.flatten(c), ((c % 13) * CW, (c // 13) * CH))
    sheet.save(OUT / "cards.png")
    spr = Sprite.load(ART / "icons.aseprite")
    names = [t["name"] for t in sorted(spr.tags, key=lambda t: t["from"])]
    strip = Image.new("RGBA", (32 * len(names), 32), (0, 0, 0, 0))
    for i, n in enumerate(names):
        strip.paste(spr.flatten(spr.tag_frames(n)[0]), (i * 32, 0))
    strip.save(OUT / "icons.png")
    (OUT / "sheets.json").write_text(json.dumps({"card": [CW, CH], "icons": names}, indent=1))
    print("exported cards.png", sheet.size, "icons.png", strip.size)


def fonts():
    OUT.mkdir(parents=True, exist_ok=True)
    chars = [chr(i) for i in range(32, 127)]
    small = Image.new("RGBA", (16 * 6, 6 * 9), (0, 0, 0, 0))
    big = Image.new("RGBA", (16 * 12, 6 * 18), (0, 0, 0, 0))
    ital = Image.new("RGBA", (16 * 16, 6 * 18), (0, 0, 0, 0))
    for i, c in enumerate(chars):
        cx, cy = i % 16, i // 16
        glyph(small, c, cx * 6, cy * 9, (255, 255, 255, 255))
        g = Image.new("RGBA", (12, 18), (0, 0, 0, 0))
        glyph(g, c, 0, 0, (255, 255, 255, 255), 2)
        edge = Image.new("RGBA", (12, 18), (0, 0, 0, 0))
        for y in range(18):
            for x in range(12):
                if g.getpixel((x, y))[3] == 0 and x > 0 and y > 0 and g.getpixel((x - 1, y - 1))[3]:
                    edge.putpixel((x, y), (150, 150, 150, 255))
        g = Image.alpha_composite(edge, g)
        big.paste(g, (cx * 12, cy * 18))
        for y in range(18):
            sh = (17 - y) // 4
            for x in range(12):
                p = g.getpixel((x, y))
                if p[3]:
                    ital.putpixel((cx * 16 + x + sh, cy * 18 + y), p)
    small.save(OUT / "font.png")
    big.save(OUT / "font_big.png")
    ital.save(OUT / "font_ital.png")
    print("fonts written")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("paint", "all"):
        paint()
    if cmd in ("export", "all"):
        export()
    if cmd in ("fonts", "all"):
        fonts()
