"""Party portraits, 40x48, built from parts: head shape, skin ramp, hair, beard,
headgear, and a clothing colour. All eight are original characters."""
from __future__ import annotations

from canvas import Canvas

W, H = 40, 48
SKIN = {"fair": (15, 16, 17), "tan": (14, 15, 16), "dark": (9, 14, 15)}


def face(skin="fair", hair=(10, 11), hair_style="short", beard=None, hat=None, cloth=(23, 24),
         eyes=0, scar=False, jaw=9.0) -> Canvas:
    k0, k1, k2 = SKIN[skin]
    c = Canvas(W, H, 1)
    # backdrop: a dim arch
    for y in range(H):
        for x in range(W):
            if (x - 19.5) ** 2 / 400 + (y - 20) ** 2 / 700 < 1:
                c.set(x, y, 2)
    # shoulders / clothing
    c.ellipse(19.5, 47, 17, 9, cloth[0])
    c.ellipse(17, 45, 12, 5, cloth[1])
    c.rect(16, 34, 23, 40, k0)          # neck
    c.line(16, 34, 16, 39, 9)
    # head
    c.ellipse(19.5, 22, 10, 12.5, k1)
    c.ellipse(20.5, 27, jaw, 7.5, k1)
    c.ellipse(17.5, 19, 6, 8, k2)       # lit side (light from top-left)
    for y in range(12, 36):
        for x in range(24, 32):
            if c.get(x, y) == k1 and (x - 19.5) + (y - 22) * 0.4 > 7:
                c.set(x, y, k0)
    # ears
    c.rect(9, 21, 10, 26, k0)
    c.rect(29, 21, 30, 26, k0)
    # eyes and brows
    ec = [0, 23, 19][eyes]
    for ex in (15, 23):
        c.rect(ex, 22, ex + 2, 23, 8)
        c.set(ex + 1, 22, ec)
        c.set(ex + 1, 23, ec)
        c.line(ex - 1, 20, ex + 2, 20, hair[0])
    # nose and mouth
    c.line(20, 23, 20, 28, k0)
    c.set(19, 28, k0)
    c.line(17, 31, 22, 31, 14 if skin != "dark" else 9)
    if scar:
        c.line(24, 18, 27, 27, 27)
    # hair
    h0, h1 = hair
    if hair_style in ("short", "long", "tied"):
        c.ellipse(19.5, 13, 10.5, 5.5, h0)
        c.ellipse(17, 11.5, 7, 3.5, h1)
        c.rect(9, 13, 11, 22, h0)
        c.rect(28, 13, 30, 20, h0)
    if hair_style == "long":
        c.rect(8, 16, 11, 40, h0)
        c.rect(28, 16, 31, 40, h0)
        c.line(9, 18, 9, 38, h1)
    if hair_style == "tied":
        c.disc(31, 12, 3, h0)
        c.disc(30, 11, 1.5, h1)
    if hair_style == "bald":
        c.set(15, 12, 8)
        c.set(16, 12, k2)
    if beard:
        b0, b1 = beard
        for y in range(27, 40):
            for x in range(10, 31):
                if ((x - 20) / 10) ** 2 + ((y - 29) / 10) ** 2 < 1 and y > 27 + abs(x - 20) * 0.2:
                    c.set(x, y, b0)
        c.line(16, 29, 24, 29, b1)
        c.line(17, 31, 22, 31, 0)
    if hat == "helm":
        c.ellipse(19.5, 13, 11.5, 7, 5)
        c.rect(8, 13, 31, 16, 5)
        c.line(8, 16, 31, 16, 3)
        c.ellipse(15.5, 10, 4, 2, 7)
        c.rect(19, 16, 20, 25, 4)       # nasal
    elif hat == "hood":
        for y in range(4, 42):
            for x in range(4, 36):
                inside = ((x - 19.5) / 15) ** 2 + ((y - 22) / 19) ** 2 < 1
                face_hole = ((x - 19.5) / 10.5) ** 2 + ((y - 24) / 14) ** 2 < 1
                if inside and not face_hole:
                    c.set(x, y, cloth[0] if x > 19 else cloth[1])
    elif hat == "circlet":
        c.line(9, 16, 30, 16, 30)
        c.set(19, 15, 24)
        c.set(20, 15, 25)
    c.frame(0, 0, W - 1, H - 1, 0)
    return c


PORTRAITS = {
    "brann": lambda: face("fair", (27, 28), "short", beard=(27, 28), hat="helm", cloth=(4, 5), scar=True),
    "ilsa": lambda: face("fair", (30, 13), "long", cloth=(23, 24), eyes=1, jaw=8.0),
    "odo": lambda: face("tan", (1, 3), "bald", beard=(4, 6), cloth=(11, 12), jaw=9.5),
    "maren": lambda: face("dark", (0, 2), "tied", cloth=(19, 20), eyes=2, jaw=8.0),
    "tobin": lambda: face("tan", (10, 11), "short", cloth=(27, 28), jaw=8.5),
    "vesna": lambda: face("fair", (1, 3), "long", hat="circlet", cloth=(0, 2), jaw=7.5, eyes=1),
    "garrow": lambda: face("dark", (1, 2), "short", beard=(1, 2), cloth=(9, 10), jaw=10.0),
    "sefa": lambda: face("tan", (27, 28), "long", hat="hood", cloth=(18, 19), eyes=2, jaw=7.5),
}
