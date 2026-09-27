"""Screen art for Tidebell, drawn in code: the font, HUD icons, the window frame, the menu
cursor, the dialog portraits, the logo and the map marks. All designs are Tidebell's own.

    python3 pipeline/aseprite/art_ui.py
"""
from __future__ import annotations

import art_creatures as CR
import art_people as PE
import puppet as P
from canvas import Canvas
from font_data import FONT
from palette import N
from puppet import disc, thick
from sheet import save_sprite


def glyph(ch: str, top="white", bot="stone4", shadow="ink") -> Canvas:
    c = Canvas(6, 8)
    rows = FONT[ch]
    for y, r in enumerate(rows):
        for x, p in enumerate(r):
            if p == "o" and c.get(x + 1, y + 1) is None:
                c.set(x + 1, y + 1, shadow)
    for y, r in enumerate(rows):
        for x, p in enumerate(r):
            if p == "o":
                c.set(x, y, top if y < 4 else bot)
    return c


def font() -> Canvas:
    c = Canvas(576, 8)
    for i in range(96):
        c.blit(glyph(chr(32 + i)), i * 6, 0)
    c.set(5, 7, "ink")      # the space keeps one pixel (verify_art rejects empty cells); never drawn
    return c


def head_icon(hero: str) -> Canvas:
    c = Canvas(16, 16)
    o = PE.OUTFITS[hero]
    rig = P.Rig(2.0)
    P.draw(c, o, P.pose(), feet=(7, 72), rig=rig)
    c.rect(9, 8, 10, 9, "ink")
    c.outline("ink")
    return c


def hud() -> list[Canvas]:
    out = [head_icon(h) for h in ("kess", "june", "brannoch")]
    box = Canvas(16, 16)
    box.frame(0, 0, 15, 15, "gold0")
    box.frame(1, 1, 14, 14, "gold2")
    box.rect(2, 2, 13, 13, "night0")
    out.append(box)
    heart = Canvas(16, 16)
    disc(heart, 5, 6, 3.4, N["red2"])
    disc(heart, 10, 6, 3.4, N["red2"])
    for y in range(7, 14):
        for x in range(2 + (y - 7), 14 - (y - 7)):
            heart.set(x, y, "red2")
    heart.set(5, 5, "red3")
    heart.outline("ink")
    out.append(heart)
    return out


def panel() -> Canvas:
    # a 9-slice window frame: rope-wound brass edges around a deep-sea plate
    c = Canvas(24, 24)
    c.rect(0, 0, 23, 23, "night0")
    c.frame(0, 0, 23, 23, "ink")
    c.frame(1, 1, 22, 22, "gold0")
    c.frame(2, 2, 21, 21, "gold1")
    c.frame(3, 3, 20, 20, "wood1")
    for i in range(4, 20, 3):
        for (x, y) in ((i, 2), (i, 21), (2, i), (21, i)):
            c.set(x, y, "gold2")
    for (x, y) in ((2, 2), (21, 2), (2, 21), (21, 21)):
        disc(c, x + 0.5, y + 0.5, 2.2, N["gold2"])
        c.set(x, y, "white")
    c.rect(4, 4, 19, 19, "night0")
    return c


def cursor() -> list[Canvas]:
    out = []
    for f in range(2):
        c = Canvas(8, 8)
        for y in range(7):
            w = 3 - abs(y - 3)
            c.rect(f, y, f + w, y, "gold2" if y < 4 else "gold1")
        c.outline("ink")
        out.append(c)
    return out


def portrait_person(name: str, bg: str) -> Canvas:
    c = Canvas(48, 48)
    c.rect(0, 0, 47, 47, bg)
    o = dict(PE.OUTFITS[name])
    rig = P.Rig(3.0 * o.get("scale", 1.0), o.get("bulk", 0) * 2)
    pts = P.draw(c, o, P.pose(uaF=-6, faF=0, uaB=6, wep=0), feet=(22, 118), rig=rig)
    hx, hy = pts["head"]
    # a portrait face: eyes, brows, nose, mouth
    for dx in (-3, 5):
        c.rect(int(hx + dx), int(hy - 1), int(hx + dx + 1), int(hy), "ink")
        c.set(int(hx + dx), int(hy - 1), "white")
        c.rect(int(hx + dx - 1), int(hy - 4), int(hx + dx + 2), int(hy - 4), "wood0")
    c.rect(int(hx + 2), int(hy + 2), int(hx + 3), int(hy + 4), N[o["colors"]["dark"].get("skin", "skin0")])
    c.rect(int(hx - 1), int(hy + 7), int(hx + 5), int(hy + 7), "red1")
    c.frame(0, 0, 47, 47, "ink")
    return c


def portrait_blit(src: Canvas, bg: str, scale: int, ox: int, oy: int) -> Canvas:
    c = Canvas(48, 48)
    c.rect(0, 0, 47, 47, bg)
    for y in range(src.h):
        for x in range(src.w):
            v = src.px[y * src.w + x]
            if v is not None:
                for yy in range(scale):
                    for xx in range(scale):
                        c.set(ox + x * scale + xx, oy + y * scale + yy, v)
    c.frame(0, 0, 47, 47, "ink")
    return c


def pell() -> Canvas:
    # Pell: an old hermit crab in a brass lantern-shell, with spectacles
    c = Canvas(48, 48)
    c.rect(0, 0, 47, 47, "night1")
    c.rect(10, 14, 38, 44, "gold0")
    c.rect(12, 16, 36, 42, "gold1")
    c.rect(16, 18, 32, 40, "orange1")
    c.rect(18, 20, 30, 38, "gold2")
    c.rect(8, 10, 40, 14, "gold0")
    c.rect(20, 4, 28, 10, "gold0")
    c.frame(12, 16, 36, 42, "wood0")
    # the crab peeking out of the lantern door
    disc(c, 24, 36, 9, N["red2"])
    disc(c, 24, 34, 7, N["red3"])
    for s in (-1, 1):
        thick(c, 24 + s * 4, 30, 24 + s * 6, 24, 1.6, N["red2"])
        disc(c, 24 + s * 6, 23, 2.6, N["white"])
        c.set(24 + s * 6, 23, "ink")
        c.frame(24 + s * 6 - 3, 20, 24 + s * 6 + 3, 26, "stone4")    # spectacles
        thick(c, 24 + s * 10, 38, 24 + s * 16, 44, 3, N["red2"])
        disc(c, 24 + s * 17, 45, 3, N["red1"])
    c.rect(21, 20, 27, 21, "stone4")
    c.rect(20, 38, 28, 39, "red1")
    c.frame(0, 0, 47, 47, "ink")
    return c


def siltking_face() -> Canvas:
    c = Canvas(48, 48)
    c.rect(0, 0, 47, 47, "ink")
    disc(c, 24, 26, 18, N["silt0"])
    disc(c, 24, 24, 15, N["silt1"])
    for (x, y) in ((12, 16), (30, 34), (20, 38), (34, 18)):
        disc(c, x, y, 2, N["silt0"])
    # Grane's tricorn, half sunk in the silt
    thick(c, 8, 10, 40, 10, 4, N["night1"])
    c.rect(14, 3, 34, 9, "night1")
    c.set(24, 5, "gold2")
    for s in (-1, 1):
        c.rect(24 + s * 7 - 2, 20, 24 + s * 7 + 2, 23, "orange1")
        c.rect(24 + s * 7 - 1, 21, 24 + s * 7, 22, "gold2")
    for x in range(14, 35, 3):
        c.rect(x, 32, x + 1, 36 + (x % 2) * 2, "silt2")
    c.frame(0, 0, 47, 47, "ink")
    return c


def portraits() -> list[Canvas]:
    return [
        pell(),
        portrait_person("kess", "sea1"),
        portrait_person("june", "leaf1"),
        portrait_person("brannoch", "wood0"),
        portrait_person("vell", "leaf0"),
        _crop_scale(CR.hullbreaker(0), "sea0", 2, 36, 6, 24, 24),
        portrait_person("tallyman", "violet0"),
        _crop_scale(CR.oldgrey(0), "blue1", 2, 30, 10, 24, 22),
        _crop_scale(CR.warden(0), "night0", 2, 6, 0, 28, 24),
        portrait_person("grane", "red0"),
        siltking_face(),
        portrait_person("captive", "sea0"),
    ]


def _crop_scale(src: Canvas, bg: str, scale: int, sx: int, sy: int, w: int, h: int) -> Canvas:
    part = Canvas(w, h)
    for y in range(h):
        for x in range(w):
            if 0 <= sx + x < src.w and 0 <= sy + y < src.h:
                v = src.px[(sy + y) * src.w + sx + x]
                if v is not None:
                    part.px[y * w + x] = v
    return portrait_blit(part, bg, scale, 0, 0)


LOGO_W, LOGO_H = 256, 56


def logo() -> Canvas:
    c = Canvas(LOGO_W, LOGO_H)
    word = "TIDEBELL"
    scale = 4
    gap = 4
    total = len(word) * (5 * scale + gap) - gap
    x0 = (LOGO_W - total) // 2
    y0 = 18
    ramp = ["gold2", "gold2", "gold1", "gold1", "orange0", "gold0", "gold0"]
    for i, ch in enumerate(word):
        rows = FONT[ch]
        for y, r in enumerate(rows):
            for x, p in enumerate(r):
                if p == "o":
                    c.rect(x0 + i * (5 * scale + gap) + x * scale, y0 + y * scale,
                           x0 + i * (5 * scale + gap) + x * scale + scale - 1, y0 + y * scale + scale - 1, ramp[y])
    # a small bell hanging over the I
    bx = x0 + 1 * (5 * scale + gap) + 10
    thick(c, bx, 2, bx, 6, 1, N["wood2"])
    for y in range(6, 15):
        w = 2 + (y - 6) // 2
        c.rect(bx - w, y, bx + w, y, "gold1" if y < 12 else "gold0")
    c.rect(bx - 6, 15, bx + 6, 15, "gold0")
    disc(c, bx, 16.5, 1.4, N["gold2"])
    c.outline("ink", diagonal=True)
    # a wave line under the word
    for x in range(x0, x0 + total):
        y = 50 + (1 if (x // 6) % 2 else 0)
        c.set(x, y, "sea3")
        c.set(x, y + 1, "sea2")
    return c


def mapmark() -> list[Canvas]:
    island = Canvas(16, 16)
    island.ellipse(8, 10, 6, 4, "silt2")
    island.ellipse(8, 9, 4, 2.5, "leaf3")
    island.outline("ink")
    done = island.copy()
    for y in range(2, 9):
        w = 1 + (y - 2) // 2
        done.rect(8 - w, y, 8 + w, y, "gold2" if y < 6 else "gold1")
    done.outline("ink")
    here = []
    for f in range(2):
        c = Canvas(16, 16)
        c.frame(1 + f, 1 + f, 14 - f, 14 - f, "white" if f == 0 else "gold2")
        here.append(c)
    return [island, done] + here


def build() -> list[str]:
    return [
        save_sprite("font", [font()]),
        save_sprite("hud", hud()),
        save_sprite("panel", [panel()]),
        save_sprite("cursor", cursor()),
        save_sprite("portraits", portraits()),
        save_sprite("logo", [logo()]),
        save_sprite("mapmark", mapmark()),
    ]


if __name__ == "__main__":
    for p in build():
        print(p)
