"""Item icons, 24x24, light from top-left, dark outline one step below the ramp.
The same icons stand on the dungeon floor as billboards."""
from __future__ import annotations

from canvas import Canvas

S = 24


def _done(c: Canvas, ol=0) -> Canvas:
    c.outline(ol)
    return c


def blade(c, x0, y0, x1, y1, lo=5, hi=7):
    c.line(x0, y0, x1, y1, lo)
    c.line(x0 + 1, y0, x1 + 1, y1, hi)
    c.line(x0, y0 + 1, x1, y1 + 1, 4)


def sword():
    c = Canvas(S, S)
    blade(c, 6, 17, 18, 5)
    c.set(19, 4, 8)
    c.line(3, 15, 9, 21, 12)   # crossguard
    c.line(4, 15, 9, 20, 30)
    c.line(4, 20, 6, 18, 10)   # grip
    c.line(3, 21, 4, 20, 11)
    c.set(2, 22, 30)
    return _done(c)


def dagger():
    c = Canvas(S, S)
    blade(c, 9, 14, 16, 7)
    c.line(6, 13, 10, 17, 3)
    c.line(6, 17, 8, 15, 11)
    c.set(5, 18, 13)
    return _done(c)


def axe():
    c = Canvas(S, S)
    c.line(5, 20, 15, 6, 11)
    c.line(6, 20, 16, 6, 12)
    c.ellipse(16, 8, 4.5, 5.5, 5)
    c.ellipse(15, 8, 3, 4, 6)
    c.line(19, 4, 20, 11, 7)
    c.line(14, 7, 17, 5, 3)
    return _done(c)


def mace():
    c = Canvas(S, S)
    c.line(5, 20, 13, 10, 10)
    c.line(6, 20, 14, 10, 11)
    c.disc(15.5, 7.5, 4, 4)
    c.disc(14.5, 6.5, 2.2, 6)
    for (x, y) in [(15, 2), (20, 7), (11, 7), (15, 12), (19, 4), (19, 11), (12, 4)]:
        c.set(x, y, 5)
    return _done(c)


def staff():
    c = Canvas(S, S)
    c.line(4, 21, 17, 6, 11)
    c.line(5, 21, 18, 6, 12)
    c.disc(18.5, 4.5, 2.6, 24)
    c.set(18, 3, 25)
    c.set(17, 4, 8)
    return _done(c)


def bow():
    c = Canvas(S, S)
    for i in range(17):
        import math
        t = i / 16
        x = int(6 + 8 * math.sin(t * math.pi))
        y = 3 + i
        c.set(x, y, 11)
        c.set(x + 1, y, 12)
    c.line(6, 3, 6, 19, 7)
    c.set(13, 11, 9)
    return _done(c)


def arrows():
    c = Canvas(S, S)
    for dx in (0, 3, 6):
        c.line(5 + dx, 20, 12 + dx, 5, 12)
        c.set(12 + dx, 4, 6)
        c.set(13 + dx, 4, 7)
        c.set(5 + dx, 19, 8)
        c.set(4 + dx, 20, 28)
    return _done(c)


def shield():
    c = Canvas(S, S)
    for y in range(3, 21):
        half = 8 if y < 12 else int(8 - (y - 12) * 0.9)
        for x in range(12 - half, 12 + half):
            c.set(x, y, 27 if (x < 12) == (y < 12) else 5)
    c.line(4, 3, 19, 3, 7)
    c.line(4, 3, 4, 11, 7)
    c.disc(11.5, 11, 2, 30)
    return _done(c)


def helm():
    c = Canvas(S, S)
    c.ellipse(11.5, 11, 7, 7, 5)
    c.rect(5, 11, 18, 18, 5)
    c.ellipse(9.5, 8, 3, 3, 7)
    c.rect(7, 12, 16, 13, 0)   # eye slit
    c.rect(11, 12, 12, 18, 4)
    c.line(5, 18, 18, 18, 3)
    return _done(c)


def armor():
    c = Canvas(S, S)
    c.rect(6, 5, 17, 19, 4)
    c.rect(3, 5, 6, 11, 5)
    c.rect(17, 5, 20, 11, 5)
    c.rect(9, 3, 14, 5, None)
    for y in range(7, 19, 3):
        c.line(7, y, 16, y, 3)
    c.line(7, 6, 7, 18, 6)
    c.line(11, 6, 12, 18, 3)
    c.rect(6, 17, 17, 18, 11)
    c.set(11, 17, 30)
    return _done(c)


def leather():
    c = Canvas(S, S)
    c.rect(6, 5, 17, 19, 11)
    c.rect(3, 5, 6, 10, 12)
    c.rect(17, 5, 20, 10, 12)
    c.rect(9, 3, 14, 6, None)
    c.line(7, 6, 7, 18, 13)
    for y in range(9, 18, 4):
        c.set(10, y, 9)
        c.set(13, y, 9)
    c.rect(6, 16, 17, 17, 9)
    return _done(c)


def boots():
    c = Canvas(S, S)
    for ox in (3, 12):
        c.rect(ox + 1, 5, ox + 5, 15, 10)
        c.rect(ox + 1, 15, ox + 8, 18, 10)
        c.line(ox + 1, 5, ox + 1, 17, 12)
        c.line(ox + 1, 18, ox + 8, 18, 9)
        c.line(ox + 1, 7, ox + 5, 7, 11)
    return _done(c)


def ring():
    c = Canvas(S, S)
    c.disc(11.5, 13.5, 5.5, 30)
    c.disc(11.5, 13.5, 3.5, None)
    c.disc(11.5, 7, 2.5, 28)
    c.set(11, 6, 29)
    c.set(8, 11, 31)
    return _done(c)


def amulet():
    c = Canvas(S, S)
    for i in range(12):
        c.set(5 + i, 3 + i // 2 if i < 6 else 3 + (11 - i) // 2, 30)
    c.line(6, 3, 11, 10, 12)
    c.line(17, 3, 12, 10, 12)
    c.disc(11.5, 14, 4, 30)
    c.disc(11.5, 14, 2.5, 24)
    c.set(10, 13, 25)
    return _done(c)


def potion(col, hi):
    c = Canvas(S, S)
    c.rect(10, 3, 13, 4, 11)
    c.rect(10, 5, 13, 8, 6)
    c.disc(11.5, 14, 6, 6)
    c.disc(11.5, 14.5, 5, col)
    c.rect(7, 10, 16, 11, 6)
    c.set(8, 12, 8)
    c.set(8, 13, 8)
    c.set(9, 16, hi)
    return _done(c)


def key(col, hi, bit):
    c = Canvas(S, S)
    c.disc(7, 8, 4, col)
    c.disc(7, 8, 1.6, None)
    c.line(10, 11, 18, 19, col)
    c.line(11, 11, 19, 19, hi)
    c.line(15, 18, 13, 20, bit)
    c.line(18, 17, 16, 19, bit)
    c.set(5, 6, hi)
    return _done(c)


def scroll():
    c = Canvas(S, S)
    c.rect(5, 6, 18, 17, 7)
    c.rect(4, 4, 19, 6, 13)
    c.rect(4, 17, 19, 19, 13)
    c.line(4, 4, 19, 4, 17)
    for y in (9, 11, 13, 15):
        c.line(7, y, 16 if y != 15 else 12, y, 5)
    c.set(15, 15, 27)
    return _done(c)


def rune(col, hi):
    c = Canvas(S, S)
    c.ellipse(11.5, 12, 7.5, 8.5, 4)
    c.ellipse(10.5, 10.5, 5.5, 6, 5)
    c.line(9, 7, 9, 16, col)
    c.line(9, 7, 14, 10, col)
    c.line(9, 12, 14, 16, col)
    c.set(9, 7, hi)
    return _done(c)


def bread():
    c = Canvas(S, S)
    c.ellipse(11.5, 13, 8.5, 5.5, 12)
    c.ellipse(10, 11.5, 6, 3, 13)
    for x in (7, 11, 15):
        c.line(x, 10, x + 2, 12, 11)
    return _done(c)


def coins():
    c = Canvas(S, S)
    for (x, y) in [(8, 15), (14, 15), (11, 11), (11, 17)]:
        c.ellipse(x, y, 4, 2.5, 30)
        c.set(x - 2, y - 1, 31)
        c.line(x - 3, y + 2, x + 3, y + 2, 12)
    return _done(c)


def gem():
    c = Canvas(S, S)
    c.rect(8, 7, 15, 8, 25)
    for y in range(8, 17):
        w = max(0, 16 - y)
        c.line(12 - w, y, 11 + w, y, 24 if y > 11 else 25)
    c.set(9, 8, 8)
    return _done(c)


def bone():
    c = Canvas(S, S)
    c.line(6, 17, 17, 6, 7)
    c.line(7, 17, 18, 6, 8)
    for (x, y) in [(5, 16), (6, 19), (17, 4), (19, 7)]:
        c.disc(x, y, 1.6, 7)
    return _done(c)


ITEMS = {
    "sword": sword, "dagger": dagger, "axe": axe, "mace": mace, "staff": staff, "bow": bow,
    "arrows": arrows, "shield": shield, "helm": helm, "mail": armor, "leather": leather,
    "boots": boots, "ring": ring, "amulet": amulet,
    "potion_red": lambda: potion(28, 29), "potion_blue": lambda: potion(24, 25),
    "potion_green": lambda: potion(20, 21),
    "key_iron": lambda: key(5, 7, 4), "key_gold": lambda: key(30, 31, 12), "key_bone": lambda: key(7, 8, 6),
    "scroll": scroll, "rune_fire": lambda: rune(28, 30), "rune_frost": lambda: rune(24, 25),
    "rune_life": lambda: rune(20, 21), "rune_void": lambda: rune(0, 3),
    "bread": bread, "coins": coins, "gem": gem, "bone": bone,
}


def sealstone():
    c = Canvas(S, S)
    c.disc(11.5, 12, 8.5, 3)
    c.disc(11.5, 12, 7.5, 5)
    c.disc(10.5, 11, 5, 6)
    c.disc(11.5, 12, 3.5, 23)
    c.disc(11.5, 12, 2.2, 24)
    c.set(11, 11, 25)
    c.set(12, 12, 8)
    for (x, y) in [(5, 12), (18, 12), (11, 5), (11, 19)]:
        c.set(x, y, 24)
    return _done(c)


ITEMS.update({"rune_air": lambda: rune(30, 31), "rune_earth": lambda: rune(12, 13), "sealstone": sealstone})
