"""Surface textures, 32x32, drawn in code. Light comes from the top-left.
Each entry returns a list of frames (Canvas). Wall decals are transparent overlays
drawn on top of a wall face by the engine."""
from __future__ import annotations

from canvas import Canvas, rng, dither

S = 32


def _stone_blocks(seed: str, base=(3, 4, 5), mortar=1, rows=4, cols=2, rough=0.0) -> Canvas:
    """Running-bond stone blocks. base = (dark, mid, light) palette indices."""
    r = rng(seed)
    c = Canvas(S, S, mortar)
    bh = S // rows
    for row in range(rows):
        off = 0 if row % 2 == 0 else (S // cols) // 2
        bw = S // cols
        for col in range(-1, cols + 1):
            x0 = col * bw + off
            y0 = row * bh
            shade = r.choice([0, 0, 1, 1, 1, 2]) if rough == 0 else r.choice([0, 1, 1, 2])
            mid = base[1] if shade == 1 else (base[0] if shade == 0 else base[2])
            for y in range(y0 + 1, y0 + bh):
                for x in range(x0 + 1, x0 + bw):
                    c.set(x, y, mid, wrap=True)
            # top-left lit edge, bottom-right shadow edge
            for x in range(x0 + 1, x0 + bw):
                c.set(x, y0 + 1, base[2] if mid != base[2] else 6, wrap=True)
                c.set(x, y0 + bh - 1, base[0] if mid != base[0] else 2, wrap=True)
            for y in range(y0 + 1, y0 + bh):
                c.set(x0 + 1, y, base[2] if mid != base[2] else 6, wrap=True)
                c.set(x0 + bw - 1, y, base[0] if mid != base[0] else 2, wrap=True)
            # pits and chips
            for _ in range(3 + int(rough * 6)):
                px, py = x0 + r.randint(2, bw - 3), y0 + r.randint(2, bh - 3)
                c.set(px, py, base[0], wrap=True)
                if r.random() < 0.5:
                    c.set(px + 1, py, base[0] if r.random() < 0.5 else 2, wrap=True)
    return c


def wall_stone():
    return [_stone_blocks("wall_stone")]


def wall_moss():
    c = _stone_blocks("wall_moss")
    r = rng("moss")
    for x in range(S):
        if r.random() < 0.55:
            length = r.randint(1, 9)
            for y in range(length):
                c.set(x, y, 19 if y < length - 2 else 18)
            c.set(x, 0, 20)
            if length > 3 and r.random() < 0.4:
                c.set(x, 1, 21)
    for _ in range(18):
        x, y = r.randint(0, S - 1), r.randint(12, S - 1)
        c.set(x, y, 19)
        c.set(x + 1, y, 18)
    return [c]


def wall_cave():
    r = rng("cave")
    c = Canvas(S, S, 3)
    for y in range(S):
        for x in range(S):
            v = r.random()
            c.set(x, y, 2 if v < 0.18 else (4 if v > 0.8 else 3))
    # a few boulders with lit tops
    for _ in range(7):
        cx, cy, rr = r.randint(0, S), r.randint(0, S), r.randint(3, 6)
        for y in range(cy - rr, cy + rr + 1):
            for x in range(cx - rr, cx + rr + 1):
                d = (x - cx) ** 2 + (y - cy) ** 2
                if d <= rr * rr:
                    lit = (x - cx) + (y - cy) < -rr * 0.6
                    shadow = (x - cx) + (y - cy) > rr * 0.7
                    c.set(x, y, 5 if lit else (2 if shadow else 4), wrap=True)
    return [c]


def wall_crypt():
    """Dressed ashlar with an inscribed band: the deeper halls."""
    c = _stone_blocks("crypt", base=(2, 3, 4), rows=4, cols=1)
    for x in range(S):
        c.set(x, 14, 1)
        c.set(x, 15, 5)
        c.set(x, 16, 4)
        c.set(x, 17, 1)
    r = rng("glyphs")
    x = 2
    while x < S - 3:
        w = r.randint(1, 3)
        for dx in range(w):
            c.set(x + dx, 15, 2)
        c.set(x, 16, 2)
        x += w + 2
    return [c]


def floor_flag():
    r = rng("flag")
    c = Canvas(S, S, 1)
    slabs = [(0, 0, 15, 11), (16, 0, 31, 7), (16, 8, 31, 19), (0, 12, 10, 25), (11, 12, 15, 25),
             (0, 26, 20, 31), (21, 20, 31, 31), (16, 20, 20, 25)]
    for (x0, y0, x1, y1) in slabs:
        mid = r.choice([3, 3, 4])
        c.rect(x0 + 1, y0 + 1, x1, y1, mid)
        for x in range(x0 + 1, x1 + 1):
            c.set(x, y0 + 1, mid + 1)
        for y in range(y0 + 1, y1 + 1):
            c.set(x0 + 1, y, mid + 1)
        for _ in range(4):
            c.set(r.randint(x0 + 2, max(x0 + 2, x1 - 1)), r.randint(y0 + 2, max(y0 + 2, y1 - 1)), 2)
    return [c]


def floor_dirt():
    r = rng("dirt")
    c = Canvas(S, S, 10)
    for y in range(S):
        for x in range(S):
            v = r.random()
            if v < 0.2:
                c.set(x, y, 9)
            elif v > 0.9:
                c.set(x, y, 11)
    for _ in range(10):
        x, y = r.randint(0, S - 1), r.randint(0, S - 1)
        c.set(x, y, 4)
        c.set(x + 1, y, 5, wrap=True)
        c.set(x, y + 1, 3, wrap=True)
    return [c]


def ceiling_stone():
    c = _stone_blocks("ceil", base=(1, 2, 3), rows=2, cols=2)
    return [c]


def ceiling_beams():
    c = Canvas(S, S, 1)
    r = rng("beams")
    for x in range(S):
        for y in range(S):
            if r.random() < 0.15:
                c.set(x, y, 2)
    for y0 in (4, 20):
        c.rect(0, y0, S - 1, y0 + 7, 10)
        for x in range(S):
            c.set(x, y0, 12)
            c.set(x, y0 + 1, 11)
            c.set(x, y0 + 7, 9)
            if r.random() < 0.25:
                c.set(x, y0 + r.randint(2, 6), 9)
    return [c]


def water():
    """Four frames; highlights drift one pixel per frame so the loop is seamless."""
    frames = []
    r = rng("water")
    glints = [(r.randint(0, S - 1), r.randint(0, S - 1), r.randint(2, 4)) for _ in range(14)]
    for f in range(4):
        c = Canvas(S, S, 23)
        for y in range(S):
            for x in range(S):
                if dither(x + f, y, 0.25 if (y // 4) % 2 else 0.1):
                    c.set(x, y, 22)
        for (gx, gy, gl) in glints:
            for d in range(gl):
                c.set(gx + d + f * 2, gy, 24 if d else 25, wrap=True)
        frames.append(c)
    return frames


def door_wood():
    r = rng("door")
    c = Canvas(S, S, None)
    c.rect(2, 1, 29, 31, 10)
    for x0 in range(3, 29, 5):
        c.rect(x0, 1, x0 + 3, 31, r.choice([11, 11, 12]))
        c.line(x0, 1, x0, 31, 12)
        c.line(x0 + 4, 1, x0 + 4, 31, 9)
        for _ in range(3):
            y = r.randint(3, 29)
            c.set(x0 + r.randint(1, 3), y, 10)
    for y0 in (5, 24):  # iron bands
        c.rect(2, y0, 29, y0 + 2, 3)
        c.line(2, y0, 29, y0, 5)
        for x in range(4, 29, 6):
            c.set(x, y0 + 1, 6)
    c.disc(23, 16, 2.2, 3)  # ring pull
    c.disc(23, 16, 1.0, 10)
    c.set(22, 14, 6)
    c.frame(1, 0, 30, 31, 0)
    return [c]


def portcullis():
    c = Canvas(S, S, None)
    for x in range(3, S, 7):
        c.rect(x, 0, x + 1, 30, 4)
        c.line(x, 0, x, 30, 6)
        c.set(x, 31, 3)
        c.set(x + 1, 31, 3)
    for y in (6, 17, 27):
        c.rect(0, y, S - 1, y + 1, 3)
        c.line(0, y, S - 1, y, 5)
    return [c]


def lever(up: bool):
    c = Canvas(S, S, None)
    c.rect(11, 11, 20, 23, 3)
    c.frame(11, 11, 20, 23, 1)
    c.line(12, 12, 19, 12, 5)
    c.rect(14, 16, 17, 19, 1)
    if up:
        c.line(15, 17, 12, 5, 11)
        c.line(16, 17, 13, 5, 12)
        c.disc(12.5, 4.5, 1.8, 28)
        c.set(12, 3, 29)
    else:
        c.line(15, 18, 12, 29, 11)
        c.line(16, 18, 13, 29, 12)
        c.disc(12.5, 29, 1.8, 28)
        c.set(12, 28, 29)
    return [c]


def button(pressed: bool):
    c = Canvas(S, S, None)
    c.rect(12, 12, 19, 19, 2)
    c.frame(12, 12, 19, 19, 1)
    if pressed:
        c.rect(14, 14, 17, 17, 3)
    else:
        c.rect(13, 13, 18, 18, 27)
        c.line(13, 13, 18, 13, 28)
        c.line(13, 13, 13, 18, 28)
        c.set(14, 14, 29)
    return [c]


def torch():
    """Sconce with a 4-frame flame (light is added by the engine)."""
    frames = []
    shapes = [
        [(15, 5), (16, 6), (15, 7), (16, 8)],
        [(16, 4), (15, 6), (16, 7), (15, 8)],
        [(15, 4), (15, 5), (16, 7), (16, 8)],
        [(16, 5), (16, 6), (15, 7), (15, 8)],
    ]
    for f in range(4):
        c = Canvas(S, S, None)
        c.rect(14, 12, 17, 20, 10)
        c.line(14, 12, 14, 20, 12)
        c.rect(12, 20, 19, 21, 3)
        c.line(12, 20, 19, 20, 5)
        c.rect(15, 21, 16, 25, 3)
        c.ellipse(15.5, 9.5, 3.2, 4.2, 28)
        c.ellipse(15.5, 10.0, 2.2, 3.0, 29)
        for (x, y) in shapes[f]:
            c.set(x, y, 30)
        c.set(15, 10, 31)
        c.set(16, 11, 31)
        frames.append(c)
    return frames


def plaque():
    c = Canvas(S, S, None)
    c.rect(7, 9, 24, 22, 11)
    c.frame(7, 9, 24, 22, 9)
    c.line(8, 10, 23, 10, 13)
    c.line(8, 10, 8, 21, 12)
    for y in (13, 16, 19):
        for x in range(10, 22, 2):
            c.set(x, y, 9)
    return [c]


def keyhole():
    c = Canvas(S, S, None)
    c.rect(12, 11, 19, 21, 30)
    c.frame(12, 11, 19, 21, 12)
    c.line(13, 12, 18, 12, 31)
    c.disc(15.5, 14.5, 1.3, 0)
    c.rect(15, 15, 16, 18, 0)
    return [c]


def banner():
    c = Canvas(S, S, None)
    c.line(6, 3, 25, 3, 12)
    c.rect(8, 4, 23, 24, 27)
    for x in range(8, 24):
        c.set(x, 4, 28)
    for i in range(8):  # swallowtail
        c.set(8 + i, 25 + i // 3, 27)
        c.set(23 - i, 25 + i // 3, 27)
    c.rect(8, 25, 15, 26, 27)
    c.rect(16, 25, 23, 26, 27)
    for y in range(25, 29):
        for x in range(12, 20):
            if abs(x - 15.5) < (y - 24):
                c.set(x, y, None)
    # emblem: a key over a gate
    c.rect(13, 9, 18, 17, 30)
    c.rect(14, 10, 17, 17, 26)
    c.line(15, 10, 15, 17, 30)
    c.line(16, 10, 16, 17, 30)
    c.line(11, 20, 20, 20, 30)
    c.disc(11, 20, 1.5, 30)
    c.set(18, 21, 30)
    c.set(20, 21, 30)
    return [c]


def pit():
    """Floor with a dark hole: drawn on the floor quad of a pit cell."""
    c = floor_flag()[0]
    for y in range(S):
        for x in range(S):
            d = max(abs(x - 15.5), abs(y - 15.5))
            if d < 12:
                c.set(x, y, 0)
            elif d < 13:
                c.set(x, y, 1)
    for x in range(4, 28):  # far lip catches light
        c.set(x, 4, 5)
    return [c]


def grate():
    c = Canvas(S, S, None)
    c.rect(2, 2, 29, 29, 0)
    for i in range(4, 29, 5):
        c.rect(i, 2, i + 1, 29, 4)
        c.rect(2, i, 29, i + 1, 4)
        c.line(i, 2, i, 29, 5)
    c.frame(2, 2, 29, 29, 3)
    return [c]


def teleport():
    """Swirl on the floor, 4 frames."""
    frames = []
    for f in range(4):
        c = Canvas(S, S, None)
        for y in range(S):
            for x in range(S):
                dx, dy = x - 15.5, y - 15.5
                d = (dx * dx + dy * dy) ** 0.5
                if d > 14:
                    continue
                import math
                a = math.atan2(dy, dx) + d * 0.45 - f * (math.pi / 2)
                band = (math.sin(a * 3) + 1) / 2
                if band > 0.7:
                    c.set(x, y, 25 if d < 6 else 24)
                elif band > 0.45 and dither(x, y, 0.5):
                    c.set(x, y, 23)
        frames.append(c)
    return frames


TEXTURES = {
    "wall_stone": wall_stone, "wall_moss": wall_moss, "wall_cave": wall_cave, "wall_crypt": wall_crypt,
    "floor_flag": floor_flag, "floor_dirt": floor_dirt, "ceiling_stone": ceiling_stone,
    "ceiling_beams": ceiling_beams, "water": water, "pit": pit,
    "door_wood": door_wood, "portcullis": portcullis,
    "lever_up": lambda: lever(True), "lever_down": lambda: lever(False),
    "button_up": lambda: button(False), "button_down": lambda: button(True),
    "torch": torch, "plaque": plaque, "keyhole": keyhole, "banner": banner,
    "grate": grate, "teleport": teleport,
}
FRAME_MS = {"water": 220, "torch": 110, "teleport": 120}


def niche():
    """Recess cut into the wall: dark back, lit lower lip, where items rest."""
    c = Canvas(S, S, None)
    c.rect(8, 10, 23, 22, 1)
    c.rect(9, 11, 22, 21, 0)
    c.line(8, 10, 23, 10, 3)
    c.line(8, 10, 8, 22, 3)
    c.line(9, 22, 23, 22, 6)       # lip catches the light
    c.line(9, 23, 23, 23, 4)
    return [c]


def fountain():
    """Lion-less wall fountain: a spout and a stone basin with water."""
    c = Canvas(S, S, None)
    c.disc(15.5, 8, 4, 4)
    c.disc(15.5, 8, 2.5, 3)
    c.rect(15, 11, 16, 13, 5)
    c.rect(15, 14, 16, 19, 24)      # falling water
    c.set(15, 16, 25)
    c.rect(7, 20, 24, 26, 4)
    c.line(7, 20, 24, 20, 6)
    c.rect(9, 20, 22, 21, 24)
    c.line(9, 20, 22, 20, 25)
    c.line(7, 26, 24, 26, 2)
    return [c]


def gate_face():
    """The Nether Gate: a sealed round door with a hand-sized hollow at its centre."""
    c = Canvas(S, S, None)
    c.disc(15.5, 16, 15, 2)
    c.disc(15.5, 16, 13.5, 3)
    for a in range(0, 360, 30):
        import math
        x = 15.5 + math.cos(math.radians(a)) * 11
        y = 16 + math.sin(math.radians(a)) * 11
        c.set(int(x), int(y), 23)
        c.set(int(x) + 1, int(y), 24)
    c.disc(15.5, 16, 7, 4)
    c.disc(15.5, 16, 4.5, 1)
    c.disc(15.5, 16, 3.5, 0)
    c.line(3, 16, 8, 16, 1)
    c.line(23, 16, 28, 16, 1)
    c.set(10, 8, 25)
    c.set(21, 24, 25)
    return [c]


TEXTURES.update({"niche": niche, "fountain": fountain, "gate": gate_face})
