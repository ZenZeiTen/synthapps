"""Player forms (hero, tiny, moth) and Sable the owl, drawn in code.

    python3 pipeline/aseprite/art_chars.py

Also holds the small drawing kit that art_enemies.py and art_fx.py share: a Fig is a
layered "material map". Each shape is painted with a material name on the current layer;
render() turns materials into palette colours with light from the upper left:
  - a pixel whose right (within the material's shadow width) or lower neighbour is a lower
    layer or empty is in form shadow;
  - a pixel whose left, upper or upper-left neighbour is a higher layer is in cast shadow;
  - otherwise a pixel whose left or upper neighbour is lower or empty takes the highlight.
Then a 1 px ink outline goes around the whole figure. Left-facing frames are made by
mirroring the material map before shading, so the light stays in the upper left.
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from canvas import Canvas, dither, rng  # noqa: E402,F401
from palette import N  # noqa: E402
from sheet import save_sprite  # noqa: E402

# ---------------------------------------------------------------------------------------
# drawing kit
# ---------------------------------------------------------------------------------------

# material: (shadow, base, light, shadow width)
MATS: dict[str, tuple] = {}


def mat(name: str, shadow: str, base: str, light: str, sw: int = 1) -> None:
    MATS[name] = (N[shadow], N[base], N[light], sw)


# Orrin
mat("coat", "shard0", "shard1", "shard2", 2)
mat("coat_far", "shard0", "shard0", "shard1")
mat("lining", "shard0", "shard0", "shard0")
mat("hair", "wood0", "wood1", "wood2")
mat("skin", "skin0", "skin1", "skin2")
mat("skin_far", "skin0", "skin0", "skin1")
mat("scarf", "fire2", "fire3", "fire4")
mat("scarf_far", "fire1", "fire2", "fire3")
mat("pants", "wood1", "wood2", "wood3")
mat("pants_far", "wood0", "wood1", "wood2")
mat("boot", "stone0", "wood0", "wood1")
mat("boot_far", "ink", "stone0", "wood0")
mat("belt", "wood0", "wood0", "wood1")
mat("brass", "gold0", "gold1", "gold2")
mat("glow", "fire5", "fire5", "white")
# general purpose
mat("ink", "ink", "ink", "ink")
mat("white", "stone4", "white", "white")
mat("bone", "stone3", "stone4", "white")


class Fig:
    """Layered material map; see the module docstring."""

    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.m: list[str | None] = [None] * (w * h)
        self.l: list[int] = [-1] * (w * h)
        self.L = 0
        self.dots: dict[tuple[int, int], int] = {}
        self.rims: set[int] = set()

    def lay(self, rim: bool = False) -> "Fig":
        """Start a new layer. rim=True draws an ink line on the lower layers where they
        touch this layer's left, right and lower edges (a limb in front of the body)."""
        self.L += 1
        if rim:
            self.rims.add(self.L)
        return self

    def put(self, x, y, m):
        x, y = int(math.floor(x + 0.5)), int(math.floor(y + 0.5))
        if 0 <= x < self.w and 0 <= y < self.h:
            i = y * self.w + x
            if m is None:
                self.m[i], self.l[i] = None, -1
            else:
                self.m[i], self.l[i] = m, self.L

    def has(self, x, y) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h and self.m[y * self.w + x] is not None

    def rect(self, x0, y0, x1, y1, m):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.put(x, y, m)

    def ellipse(self, cx, cy, rx, ry, m):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / max(rx, 0.01)) ** 2 + ((y - cy) / max(ry, 0.01)) ** 2 <= 1.0:
                    self.put(x, y, m)

    def oval(self, cx, cy, a, b, ang, m):
        """Ellipse with semi-axes a (along ang, degrees) and b, centred at (cx, cy)."""
        c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        R = int(max(a, b)) + 2
        for y in range(int(cy) - R, int(cy) + R + 1):
            for x in range(int(cx) - R, int(cx) + R + 1):
                dx, dy = x - cx, y - cy
                u, v = dx * c + dy * s, -dx * s + dy * c
                if (u / a) ** 2 + (v / b) ** 2 <= 1.0:
                    self.put(x, y, m)

    def disc(self, cx, cy, r, m):
        self.ellipse(cx, cy, r, r, m)

    def poly(self, pts, m):
        """Scanline fill of a polygon given in pixel-centre coordinates (edges included)."""
        ys = [p[1] for p in pts]
        for y in range(int(math.floor(min(ys))), int(math.ceil(max(ys))) + 1):
            xs = []
            n = len(pts)
            for i in range(n):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
                if y0 == y1:
                    continue
                if min(y0, y1) <= y < max(y0, y1) or (y == max(ys) and min(y0, y1) < y <= max(y0, y1)):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for a, b in zip(xs[::2], xs[1::2]):
                for x in range(int(math.ceil(a - 0.01)), int(math.floor(b + 0.01)) + 1):
                    self.put(x, y, m)
        # edges, so thin polygons keep their outline
        for i in range(len(pts)):
            self.seg(pts[i], pts[(i + 1) % len(pts)], 1, m)

    def seg(self, a, b, wd, m):
        """Thick line from a to b; wd is the stroke width in pixels."""
        (x0, y0), (x1, y1) = a, b
        if wd <= 1:
            dx, dy = x1 - x0, y1 - y0
            n = int(max(abs(dx), abs(dy))) + 1
            for i in range(n + 1):
                t = i / max(n, 1)
                self.put(x0 + dx * t, y0 + dy * t, m)
            return
        r = wd / 2.0
        vx, vy = x1 - x0, y1 - y0
        ll = vx * vx + vy * vy
        off = 0.5 if wd % 2 == 0 else 0.0
        for y in range(int(min(y0, y1) - r - 1), int(max(y0, y1) + r + 2)):
            for x in range(int(min(x0, x1) - r - 1), int(max(x0, x1) + r + 2)):
                px, py = x - off, y - off
                t = 0.0 if ll == 0 else max(0.0, min(1.0, ((px - x0) * vx + (py - y0) * vy) / ll))
                qx, qy = x0 + vx * t, y0 + vy * t
                if (px - qx) ** 2 + (py - qy) ** 2 <= r * r - 0.05:
                    self.put(x, y, m)

    def limb(self, pts, wd, m):
        for a, b in zip(pts, pts[1:]):
            self.seg(a, b, wd, m)

    def tmpl(self, x, y, rows, key, flip=False):
        """Stamp an ASCII template. key maps a char to a material; '.' and ' ' are skipped.
        A value starting with '#' is a detail colour (drawn after shading)."""
        for j, row in enumerate(rows):
            if flip:
                row = row[::-1]
            for i, ch in enumerate(row):
                if ch in ". ":
                    continue
                v = key[ch]
                if v.startswith("#"):
                    self.put(x + i, y + j, key.get("_under", "ink"))
                    self.dot(x + i, y + j, v[1:])
                else:
                    self.put(x + i, y + j, v)

    def dot(self, x, y, color):
        self.dots[(int(x), int(y))] = N[color] if isinstance(color, str) else color

    def erase(self, x, y):
        self.put(x, y, None)
        self.dots.pop((int(x), int(y)), None)

    def render(self, flip=False, outline: str | None = "ink") -> Canvas:
        w, h = self.w, self.h
        m, l, dots = self.m, self.l, self.dots
        if flip:
            m = [m[y * w + (w - 1 - x)] for y in range(h) for x in range(w)]
            l = [l[y * w + (w - 1 - x)] for y in range(h) for x in range(w)]
            dots = {(w - 1 - x, y): c for (x, y), c in dots.items()}

        def lv(x, y):
            return l[y * w + x] if 0 <= x < w and 0 <= y < h else -1

        out = Canvas(w, h)
        for y in range(h):
            for x in range(w):
                k = m[y * w + x]
                if k is None:
                    continue
                sh, base, li, sw = MATS[k]
                me = l[y * w + x]
                cast = lv(x - 1, y) > me or lv(x, y - 1) > me or lv(x - 1, y - 1) > me
                form = lv(x, y + 1) < me or any(lv(x + d, y) < me for d in range(1, sw + 1))
                hl = lv(x - 1, y) < me or lv(x, y - 1) < me
                out.px[y * w + x] = sh if (cast or form) else (li if hl else base)
        rimmed = []
        for y in range(h):
            for x in range(w):
                me = l[y * w + x]
                if me in self.rims:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1)):
                        X, Y = x + dx, y + dy
                        if 0 <= X < w and 0 <= Y < h and m[Y * w + X] is not None and -1 < l[Y * w + X] < me:
                            rimmed.append(Y * w + X)
        for i in rimmed:
            out.px[i] = N["ink"]
        for (x, y), c in dots.items():
            if 0 <= x < w and 0 <= y < h:
                out.px[y * w + x] = c
        if outline:
            out.outline(outline)
        return out


def paint(cv: Canvas, x, y, rows, key, flip=False):
    """Stamp an ASCII template straight onto a Canvas (key: char -> palette name)."""
    for j, row in enumerate(rows):
        if flip:
            row = row[::-1]
        for i, ch in enumerate(row):
            if ch not in ". ":
                cv.set(x + i, y + j, N[key[ch]])


def recolor(cv: Canvas, table: dict[str, str]) -> Canvas:
    k = cv.copy()
    t = {N[a]: N[b] for a, b in table.items()}
    k.px = [t.get(c, c) if c is not None else None for c in k.px]
    return k


def shift(cv: Canvas, dx: int, dy: int) -> Canvas:
    k = Canvas(cv.w, cv.h)
    k.blit(cv, dx, dy)
    return k


# ---------------------------------------------------------------------------------------
# Orrin, the lamplighter (hero): 32x48 frames, hitbox 24x40 at (4, 8), feet on row 47
# ---------------------------------------------------------------------------------------

HEAD_SIDE = [          # facing right, 12x12
    "..H..HH.H...",
    ".HHhhHHHHH..",
    "HHhhHHHHHHH.",
    "HHHHHHHHHHHH",
    "HHHHHHHHHHHH",
    "HHHHHHHHSSHH",
    "HHHHHrSSSES.",
    "HHHHHrSSSESS",
    "HHHHSSSSSSS.",
    ".HHHSSSSSSS.",
    "..HHSSSSSS..",
    "....SSSSS...",
]
HEAD_FRONT = [
    "..H.HH..H...",
    ".HHHHHHHHHH.",
    "HHHhhHHHHHHH",
    "HHhhHHHHHHHH",
    "HHHHHHHHHHHH",
    "HHSHHSSHHSHH",
    "HSSSSSSSSSSH",
    "HSSESSSSESSH",
    "rSSESSSSESSr",
    ".SSSSSSSSSS.",
    "..SSSmmSSS..",
    "...SSSSSS...",
]
HEAD_BACK = [
    "..H.HH..H...",
    ".HHHHHHHHHH.",
    "HHHhhHHHHHHH",
    "HHhhHHHHHHHH",
    "HHHHHHHHHHHH",
    "HHHHHHHHHHHH",
    "HHHHHHHHHHHH",
    "rHHHHHHHHHHr",
    "rHHHHHHHHHHr",
    ".HHHHHHHHHH.",
    "..HHHHHHHH..",
    "...SSSSSS...",
]
HEAD_KEY = {"H": "hair", "S": "skin", "E": "#ink", "r": "#skin0", "m": "#skin0", "h": "#wood2",
            "_under": "skin"}
BOOT_SIDE = ["BBB...", "BBBB..", "BBBBBB", "BBBBBB"]
BOOT_FRONT = ["BBBB", "BBBB", "BBBBB"]
LANTERN = [".GG.", "GGGG", "GWWG", "GWWG", "GGGG"]


def _boot(f, ax, ay, far=False, flip=False):
    f.tmpl(ax - 2 if not flip else ax - 3, ay, BOOT_SIDE, {"B": "boot_far" if far else "boot"}, flip=flip)


def _lantern(f, x, y):
    f.lay()
    f.tmpl(x, y, LANTERN, {"G": "brass", "W": "glow"})
    f.dot(x + 1, y + 2, "white")


def hero_side(p: dict) -> Fig:
    """Profile facing right. p holds joint lists (absolute frame coordinates)."""
    f = Fig(32, 48)
    cx, by = p.get("cx", 15), p.get("by", 0)
    top = 21 + by
    # far arm, far leg (behind the body)
    f.lay().limb(p["arm_far"], 3, "coat_far")
    hx, hy = p["arm_far"][-1]
    f.disc(hx, hy + 1, 1, "skin_far")
    f.lay().limb(p["leg_far"], 4, "pants_far")
    _boot(f.lay(), *p["leg_far"][-1], far=True)
    # scarf tail streams behind
    f.lay().limb(p["scarf"], 3, "scarf_far")
    # near leg (the coat covers the thigh)
    f.lay().limb(p["leg_near"], 4, "pants")
    _boot(f.lay(), *p["leg_near"][-1])
    # coat
    hb, hf = p.get("hem_back", (0, 0)), p.get("hem_front", (0, 0))
    hem = 38 + by
    coat = [(cx - 3, top), (cx + 3, top), (cx + 5, top + 3), (cx + 5, top + 9),
            (cx + 6 + hf[0], hem + hf[1]), (cx - 6 + hb[0], hem + hb[1]), (cx - 5, top + 9), (cx - 5, top + 3)]
    f.lay().poly(coat, "coat")
    f.rect(cx - 5, top + 9, cx + 5, top + 9, "belt")
    # lantern at the front hip
    if p.get("lantern", True):
        lx, ly = p.get("lantern_at", (cx + 5, top + 10))
        _lantern(f, lx, ly)
    # head
    hdx, hdy = p.get("head", (0, 0))
    f.lay().tmpl(cx - 6 + hdx, 8 + by + hdy, p.get("head_rows", HEAD_SIDE), HEAD_KEY)
    # scarf wrap
    f.lay().rect(cx - 4 + hdx // 2, top - 1, cx + 3 + hdx // 2, top + 1, "scarf")
    # near arm
    f.lay(rim=True).limb(p["arm_near"], 3, "coat")
    hx, hy = p["arm_near"][-1]
    f.disc(hx, hy + 1, 1, "skin")
    return f


def _swap_rows(rows, repl: dict[int, str]):
    out = list(rows)
    for k, v in repl.items():
        out[k] = v
    return out


HEAD_SIDE_HURT = _swap_rows(HEAD_SIDE, {6: "HHHHHrSSSSS.", 7: "HHHHHrSSEESS", 9: ".HHHSSSSSSE."})
HEAD_SIDE_UP = _swap_rows(HEAD_SIDE, {5: "HHHHHHHHSEH.", 6: "HHHHHrSSSES.", 7: "HHHHHrSSSSSS"})
HEAD_FRONT_BLINK = _swap_rows(HEAD_FRONT, {7: "HSSSSSSSSSSH", 8: "rSEESSSEESSr"})
HEAD_FRONT_UP = _swap_rows(HEAD_FRONT, {6: "HSSESSSSESSH", 7: "HSSESSSSESSH", 8: "rSSSSSSSSSSr",
                                        10: "..SSSSSSSS..", 11: "...SSmmSS..."})
HEAD_FRONT_OW = _swap_rows(HEAD_FRONT, {7: "HSEESSSSEESH", 8: "rSSSSSSSSSSr", 10: "..SSSmmSSS.."})


def hero_stand(cx=15):
    return dict(cx=cx,
                leg_far=[(cx - 1, 33), (cx - 2, 40), (cx - 2, 44)],
                leg_near=[(cx + 1, 33), (cx + 1, 40), (cx + 1, 44)],
                arm_far=[(cx - 1, 24), (cx - 2, 28), (cx - 2, 32)],
                arm_near=[(cx, 24), (cx + 1, 28), (cx + 2, 31)],
                scarf=[(cx - 4, 21), (cx - 6, 25), (cx - 6, 28)])


def hero_run(k: int, cx=15) -> dict:
    """Four-frame run: 0 near leg forward, 1 passing, 2 far leg forward, 3 passing."""
    by = -1 if k % 2 else 0
    hip = 33 + by
    fwd = [None, (cx + 4, 39), (cx + 7, 43)]
    back = [None, (cx - 3, 39), (cx - 7, 42)]
    sup = [None, (cx + 1, 39), (cx, 44)]
    lift = [None, (cx + 4, 37 + by), (cx + 1, 41 + by)]
    arm_fwd = [(cx, 24 + by), (cx + 3, 27 + by), (cx + 6, 27 + by)]
    arm_back = [(cx - 1, 24 + by), (cx - 3, 28 + by), (cx - 5, 30 + by)]
    arm_mid = [(cx, 24 + by), (cx, 28 + by), (cx + 1, 31 + by)]
    if k == 0:
        near, far, an, af = fwd, back, arm_back, arm_fwd
    elif k == 1:
        near, far, an, af = sup, lift, arm_mid, arm_mid
    elif k == 2:
        near, far, an, af = back, fwd, arm_fwd, arm_back
    else:
        near, far, an, af = lift, sup, arm_mid, arm_mid
    near = [(cx + 1, hip)] + near[1:]
    far = [(cx - 1, hip)] + far[1:]
    wave = [0, -1, 0, 1][k]
    return dict(cx=cx, by=by, leg_near=near, leg_far=far, arm_near=an, arm_far=af,
                head=(1, 0), hem_back=(-3, -2 + (k % 2)), hem_front=(1, 0),
                scarf=[(cx - 4, 21 + by), (cx - 8, 20 + by + wave), (cx - 12, 21 + by - wave)])


def hero_jump(cx=15):
    return dict(cx=cx, by=-1,
                leg_near=[(cx + 1, 32), (cx + 5, 36), (cx + 3, 41)],
                leg_far=[(cx - 1, 32), (cx - 2, 39), (cx - 5, 43)],
                arm_near=[(cx, 23), (cx + 4, 21), (cx + 9, 18)],
                arm_far=[(cx - 1, 23), (cx - 4, 26), (cx - 7, 27)],
                hem_back=(-2, 1), hem_front=(1, 0),
                scarf=[(cx - 4, 20), (cx - 7, 24), (cx - 9, 28)])


def hero_fall(cx=15):
    return dict(cx=cx,
                leg_near=[(cx + 1, 33), (cx + 3, 40), (cx + 4, 44)],
                leg_far=[(cx - 1, 33), (cx - 3, 39), (cx - 5, 43)],
                arm_near=[(cx + 1, 24), (cx + 5, 22), (cx + 9, 19)],
                arm_far=[(cx - 2, 24), (cx - 6, 21), (cx - 9, 18)],
                hem_back=(-3, -3), hem_front=(2, -2), head_rows=HEAD_SIDE_UP,
                scarf=[(cx - 4, 21), (cx - 6, 16), (cx - 7, 12)])


def hero_takeoff(cx=15):
    """Leaving the floor: stretched tall, legs trailing, the near arm reaching up."""
    return dict(cx=cx, by=-2,
                leg_near=[(cx + 1, 31), (cx, 38), (cx - 1, 44)],
                leg_far=[(cx - 1, 31), (cx - 3, 38), (cx - 5, 43)],
                arm_near=[(cx + 1, 22), (cx + 6, 18), (cx + 9, 13)],
                arm_far=[(cx - 1, 22), (cx - 4, 26), (cx - 7, 29)],
                hem_back=(-2, 2), hem_front=(0, 1),
                scarf=[(cx - 4, 19), (cx - 6, 24), (cx - 7, 29)])


def hero_apex(cx=15):
    """The top of the arc: knees tucked, arms out level, the scarf floating."""
    return dict(cx=cx, by=-2,
                leg_near=[(cx + 1, 31), (cx + 6, 34), (cx + 4, 39)],
                leg_far=[(cx - 1, 31), (cx + 3, 35), (cx, 40)],
                arm_near=[(cx, 22), (cx + 5, 22), (cx + 9, 21)],
                arm_far=[(cx - 1, 22), (cx - 5, 22), (cx - 9, 21)],
                hem_back=(-3, -2), hem_front=(2, -1),
                scarf=[(cx - 4, 19), (cx - 8, 18), (cx - 12, 19)])


def hero_land(cx=15):
    """Touching down in profile: knees bent, hands out for balance, the coat settling."""
    return dict(cx=cx, by=4, head=(1, 0),
                leg_near=[(cx + 1, 37), (cx + 5, 40), (cx + 4, 44)],
                leg_far=[(cx - 1, 37), (cx - 4, 40), (cx - 3, 44)],
                arm_near=[(cx, 28), (cx + 4, 31), (cx + 7, 32)],
                arm_far=[(cx - 1, 28), (cx - 4, 31), (cx - 6, 33)],
                hem_back=(-2, 0), hem_front=(2, 0),
                scarf=[(cx - 4, 25), (cx - 7, 28), (cx - 8, 32)])


def hero_hurt(cx=15):
    return dict(cx=cx, by=1, head=(-2, 0), head_rows=HEAD_SIDE_HURT,
                leg_near=[(cx + 1, 34), (cx + 4, 39), (cx + 7, 42)],
                leg_far=[(cx - 1, 34), (cx - 1, 40), (cx - 2, 44)],
                arm_near=[(cx, 25), (cx + 4, 27), (cx + 8, 25)],
                arm_far=[(cx - 1, 25), (cx + 3, 21), (cx + 7, 18)],
                hem_back=(-1, -1), hem_front=(3, -2),
                scarf=[(cx - 5, 22), (cx - 4, 16), (cx - 2, 12)])


def hero_front(p: dict) -> Fig:
    """Facing the camera (or, with back=True, facing away on a vine)."""
    f = Fig(32, 48)
    cx, by, back = 16, p.get("by", 0), p.get("back", False)
    top = 21 + by
    # legs
    for leg in (p["leg_l"], p["leg_r"]):
        f.lay().limb(leg, 4, "pants")
        ax, ay = leg[-1]
        f.lay().tmpl(ax - 2, ay, BOOT_FRONT, {"B": "boot"})
    hem = p.get("hem", 38 + by)
    spread = p.get("spread", 0)
    coat = [(cx - 4, top), (cx + 3, top), (cx + 6, top + 2), (cx + 6, top + 9), (cx + 7 + spread, hem),
            (cx - 8 - spread, hem), (cx - 7, top + 9), (cx - 7, top + 2)]
    f.lay().poly(coat, "coat")
    if not back:
        f.rect(cx - 1, top + 3, cx - 1, hem, "lining")
    else:
        f.rect(cx - 1, top + 11, cx - 1, hem, "lining")
    f.rect(cx - 7, top + 9, cx + 6, top + 9, "belt")
    if not back:
        _lantern(f, cx + 1, top + 10)
    arms_behind = p.get("arms_behind_head", False)
    if not arms_behind:
        f.lay().tmpl(cx - 6, 8 + by + p.get("head_dy", 0), p.get("head_rows", HEAD_BACK if back else HEAD_FRONT),
                     HEAD_KEY)
    f.lay().rect(cx - 5, top - 1, cx + 4, top + 1, "scarf")
    if back:
        f.lay().limb([(cx + 2, top + 1), (cx + 3, top + 7)], 3, "scarf")
    else:
        f.lay().limb([(cx - 3, top + 1), (cx - 3, top + 6)], 2, "scarf")
        f.dot(cx - 4, top + 7, "fire4")
        f.dot(cx - 2, top + 7, "fire4")
    for arm in (p["arm_l"], p["arm_r"]):
        f.lay(rim=True).limb(arm, 3, "coat")
        hx, hy = arm[-1]
        f.disc(hx, hy + (1 if hy > arm[0][1] else -1), 1, "skin")
    if arms_behind:
        f.lay().tmpl(cx - 6, 8 + by, p.get("head_rows", HEAD_BACK), HEAD_KEY)
    if back:
        _lantern(f, cx - 10, top + 10)
    return f


def front_stand(**kw):
    cx = 16
    d = dict(leg_l=[(cx - 3, 33), (cx - 3, 44)], leg_r=[(cx + 2, 33), (cx + 2, 44)],
             arm_l=[(cx - 7, 23), (cx - 8, 28), (cx - 8, 31)],
             arm_r=[(cx + 6, 23), (cx + 7, 28), (cx + 7, 31)])
    d.update(kw)
    return d


def hero_frames() -> list[Canvas]:
    cx = 15
    out: list[Canvas] = []

    def side(p):
        f = hero_side(p)
        return f.render(), f.render(flip=True)

    sr, sl = side(hero_stand(cx))
    out += [sr, sl]
    # front, blink
    out.append(hero_front(front_stand()).render())
    out.append(hero_front(front_stand(head_rows=HEAD_FRONT_BLINK)).render())
    # look_up
    out.append(hero_front(front_stand(head_rows=HEAD_FRONT_UP, head_dy=-1)).render())
    # squat: 7 px lower, knees out, hands on knees, coat pooled
    c = 16
    out.append(hero_front(front_stand(
        by=7, hem=45, spread=2,
        leg_l=[(c - 3, 40), (c - 7, 42), (c - 5, 44)], leg_r=[(c + 2, 40), (c + 6, 42), (c + 4, 44)],
        arm_l=[(c - 7, 30), (c - 8, 34), (c - 7, 38)], arm_r=[(c + 6, 30), (c + 7, 34), (c + 6, 38)])).render())
    # land: knees bent, 3 px lower
    out.append(hero_front(front_stand(
        by=3, hem=41, spread=1,
        leg_l=[(c - 3, 36), (c - 5, 40), (c - 4, 44)], leg_r=[(c + 2, 36), (c + 4, 40), (c + 3, 44)],
        arm_l=[(c - 7, 26), (c - 10, 29), (c - 11, 32)], arm_r=[(c + 6, 26), (c + 9, 29), (c + 10, 32)])).render())
    # run
    runs = [side(hero_run(k, cx)) for k in range(4)]
    out += [r for r, _ in runs] + [l for _, l in runs]
    jr, jl = side(hero_jump(cx))
    fr, fl = side(hero_fall(cx))
    out += [jr, fr, jl, fl]
    # jump_up: arms overhead, one knee up
    out.append(hero_front(front_stand(
        by=-1, hem=37,
        leg_l=[(c - 3, 32), (c - 5, 37), (c - 3, 41)], leg_r=[(c + 2, 32), (c + 2, 43)],
        arm_l=[(c - 7, 22), (c - 9, 17), (c - 9, 12)], arm_r=[(c + 6, 22), (c + 8, 17), (c + 8, 12)],
        head_rows=HEAD_FRONT_UP)).render())
    # fall_down: arms out, legs apart
    out.append(hero_front(front_stand(
        hem=36, spread=2,
        leg_l=[(c - 3, 33), (c - 5, 39), (c - 6, 44)], leg_r=[(c + 2, 33), (c + 4, 39), (c + 5, 44)],
        arm_l=[(c - 7, 23), (c - 11, 21), (c - 13, 18)], arm_r=[(c + 6, 23), (c + 10, 21), (c + 12, 18)],
        head_rows=HEAD_FRONT_OW)).render())
    # climb: back view, hands alternating on the vine (x 14..17)
    cl = [
        dict(arm_l=[(c - 6, 23), (c - 5, 14), (c - 3, 7)], arm_r=[(c + 5, 23), (c + 8, 27), (c + 6, 30)],
             leg_l=[(c - 3, 33), (c - 5, 37), (c - 3, 41)], leg_r=[(c + 2, 33), (c + 2, 44)]),
        dict(arm_l=[(c - 6, 23), (c - 9, 18), (c - 7, 13)], arm_r=[(c + 5, 23), (c + 8, 18), (c + 6, 13)],
             leg_l=[(c - 3, 33), (c - 3, 43)], leg_r=[(c + 2, 33), (c + 2, 43)], by=-1),
        dict(arm_l=[(c - 6, 23), (c - 9, 27), (c - 7, 30)], arm_r=[(c + 5, 23), (c + 4, 14), (c + 2, 7)],
             leg_l=[(c - 3, 33), (c - 3, 44)], leg_r=[(c + 2, 33), (c + 4, 37), (c + 2, 41)]),
    ]
    for p in cl:
        p.update(back=True, arms_behind_head=False)
        out.append(hero_front(p).render())
    hr, hl = side(hero_hurt(cx))
    out += [hr, hl]
    out += hero_ash(out[2])
    out += hero_warp(out[2])
    # the jump in profile: takeoff, apex, landing (right, then left for each)
    for pose in (hero_takeoff, hero_apex, hero_land):
        out += list(side(pose(cx)))
    return out


def _cells(cv: Canvas):
    return [(x, y) for y in range(cv.h) for x in range(cv.w) if cv.px[y * cv.w + x] is not None]


ASH = {"coat": None}


def _char(cv: Canvas) -> Canvas:
    """Charred copy: light colours become ash grey, darks become stone, with glowing seams."""
    k = cv.copy()
    for i, c in enumerate(k.px):
        if c is None or c == N["ink"]:
            continue
        r, g, b = __import__("palette").COLORS[c]
        lum = (r * 3 + g * 4 + b) / 8
        k.px[i] = N["stone0"] if lum < 70 else N["stone1"] if lum < 120 else N["stone2"]
    return k


def hero_ash(base: Canvas) -> list[Canvas]:
    """Five frames: charred with ember seams, crumbling from the head down, a glowing heap."""
    r = rng("ash")
    cells = _cells(base)
    frames = []
    ch = _char(base)
    # ember seams: a few short jagged lines across the body
    seams = []
    for _ in range(9):
        x, y = r.randint(9, 22), r.randint(10, 42)
        for _s in range(r.randint(2, 4)):
            seams.append((x, y))
            x += r.choice((-1, 0, 1))
            y += 1
    heap_h = [0, 2, 4, 5, 4]
    heap_w = [0, 8, 10, 11, 9]
    cuts = [0, 16, 27, 38, 48]
    for k in range(5):
        cv = Canvas(32, 48)
        for (x, y) in cells:
            if y >= cuts[k] + (r.random() < 0.35) * 2:
                cv.set(x, y, ch.px[y * 32 + x])
        for (x, y) in seams:
            if cv.get(x, y) is not None and cv.get(x, y) != N["ink"] and y >= cuts[k]:
                cv.set(x, y, N["fire4"] if k < 2 else N["fire3"])
        if k:
            hw, hh = heap_w[k], heap_h[k]
            for y in range(48 - hh, 48):
                t = (y - (48 - hh) + 1) / hh
                half = int(hw * (0.35 + 0.65 * t))
                for x in range(16 - half, 16 + half):
                    cv.set(x, y, N["stone1"] if (x + y) % 3 else N["stone2"])
            # glowing embers in the heap
            for _ in range(3 + k):
                x = 16 + r.randint(-hw // 2, hw // 2)
                y = 47 - r.randint(0, max(hh - 2, 0))
                cv.set(x, y, N["fire4"] if r.random() < 0.6 else N["fire5"])
            # falling dust and rising sparks between the crumbling edge and the heap
            for _ in range(10 if k < 4 else 4):
                x = 16 + r.randint(-9, 9)
                y = r.randint(max(cuts[k] - 6, 4), 46 - hh)
                cv.set(x, y, r.choice([N["stone2"], N["stone3"], N["fire4"], N["fire5"]]))
        k_out = cv
        # keep an ink rim on the remaining body so it still reads against the sky
        if k < 4:
            k_out = _reoutline(cv)
        else:
            k_out = _reoutline(cv)
        frames.append(k_out)
    return frames


def _reoutline(cv: Canvas) -> Canvas:
    k = cv.copy()
    k.px = [None if c == N["ink"] else c for c in k.px]
    k.outline("ink")
    return k


def sparkle(cv: Canvas, x, y, size, core="white", arm="shard3"):
    cv.set(x, y, N[core])
    for d in range(1, size + 1):
        c = N[arm] if d < size else N["shard2"]
        cv.set(x + d, y, c)
        cv.set(x - d, y, c)
        cv.set(x, y + d, c)
        cv.set(x, y - d, c)


def hero_warp(base: Canvas) -> list[Canvas]:
    """Four frames: the body thins out bottom-up into pale light while sparkles rise."""
    r = rng("warp")
    cells = _cells(base)
    pts = [(r.randint(8, 24), r.randint(4, 46), r.choice((1, 1, 2))) for _ in range(14)]
    frames = []
    for k in range(4):
        cv = Canvas(32, 48)
        t = [0.15, 0.45, 0.75, 1.01][k]
        for (x, y) in cells:
            c = base.px[y * 32 + x]
            # dissolve starts at the feet and climbs
            local = t * 1.6 - (47 - y) / 48.0
            if dither(x, y, local):
                continue
            if k >= 1 and c != N["ink"]:
                c = N["shard3"] if k == 1 else N["white"]
            cv.set(x, y, c)
        for (x, y, s) in pts:
            yy = y - k * 6
            if 0 <= yy < 48 and r.random() < 0.85:
                sparkle(cv, x, yy, s if k < 3 else 1)
        frames.append(cv)
    return frames


def build_hero():
    save_sprite("hero", hero_frames())


# ---------------------------------------------------------------------------------------
# tiny Orrin on the overworld: 16x16, hitbox 10x16 at (3, 0); 3/4 top-down view
# ---------------------------------------------------------------------------------------

TINY_KEY = {"H": "hair", "S": "skin", "E": "#ink", "R": "scarf", "C": "coat", "P": "pants", "B": "boot",
            "G": "brass", "W": "glow", "h": "#wood2", "_under": "skin"}
TINY_DOWN = [
    "..H.HH..",
    ".HHhHHH.",
    "HHhHHHHH",
    "HHSHHSHH",
    "HSSSSSSH",
    "HSESSESH",
    ".SSSSSS.",
    "RRRRRRRR",
    "CCRRCCCC",
    "CCRCCCCC",
    "SCCCCGCS",
    ".CCCCWC.",
    ".CCCCCC.",
]
TINY_UP = [
    "..H.HH..",
    ".HHhHHH.",
    "HHhHHHHH",
    "HHHHHHHH",
    "HHHHHHHH",
    "HHHHHHHH",
    ".HHHHHH.",
    "RRRRRRRR",
    "CCCCCRRC",
    "CCCCCRRC",
    "SCCCCCRS",
    ".CCCCCC.",
    ".CCCCCC.",
]
TINY_SIDE = [          # facing right
    ".H.HH...",
    "HHhHHH..",
    "HhHHHHH.",
    "HHHHHSSH",
    "HHHSSSSS",
    "HHHSSSES",
    ".HHSSSS.",
    "RRRRRR..",
    "RCCCCC..",
    "RCCCSC..",
    ".CCCGCC.",
    ".CCCWCC.",
    ".CCCCCC.",
]
TINY_LEGS = {
    "down": (["..P..P..", "..B..P..", ".....B.."], ["..P..P..", "..P..B..", "..B....."]),
    "up": (["..P..P..", "..B..P..", ".....B.."], ["..P..P..", "..P..B..", "..B....."]),
    "side": ([".PP..PP.", "BB....BB", "........"], ["..PPP...", "..BBBB..", "........"]),
}


def tiny_frames() -> list[Canvas]:
    out = []
    for view, body in (("down", TINY_DOWN), ("up", TINY_UP)):
        for k in range(2):
            f = Fig(16, 16)
            bob = k  # the second frame is the passing pose, one pixel higher
            f.lay().tmpl(4, 13 - bob if False else 13, TINY_LEGS[view][k], TINY_KEY)
            f.lay().tmpl(4, 1 - 0, body, TINY_KEY)
            out.append(f.render())
    side = []
    for k in range(2):
        f = Fig(16, 16)
        f.lay().tmpl(4, 13, TINY_LEGS["side"][k], TINY_KEY)
        f.lay().tmpl(4, 1 + (k == 1) * 0, TINY_SIDE, TINY_KEY)
        side.append(f)
    out += [f.render(flip=True) for f in side]      # left
    out += [f.render() for f in side]               # right
    return out


# ---------------------------------------------------------------------------------------
# the moth form: 32x32, hitbox 24x24 at (4, 4)
# ---------------------------------------------------------------------------------------

mat("mwing", "violet1", "dawn2", "dawn1")
mat("mwing_far", "violet0", "violet1", "dawn2")
mat("mhind", "violet1", "violet2", "dawn1")
mat("fuzz", "dawn2", "dawn1", "dawn0")
mat("ant", "wood1", "wood2", "wood3")


def _eye_spot(f, x, y):
    f.dot(x, y, "violet0")
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        f.dot(x + dx, y + dy, "dawn0")


def _moth_body_side(f):
    f.lay().oval(10, 19, 6.5, 3.5, 6, "fuzz")
    for x in (6, 9, 12):
        f.dot(x, 19, "violet1")
        f.dot(x, 20, "violet1")
        f.dot(x, 21, "violet1")
    f.lay().disc(17, 17, 3.5, "fuzz")
    f.lay().oval(20.5, 17, 2, 4, 0, "scarf")
    f.lay().disc(23.5, 16.5, 3, "fuzz")
    f.rect(24, 15, 25, 17, "ink")
    f.dot(24, 15, "white")
    f.lay()
    f.seg((23, 13), (25, 9), 1, "ant")
    f.seg((25, 9), (28, 7), 1, "ant")
    f.dot(26, 10, "wood2")
    f.dot(27, 9, "wood2")
    f.dot(17, 21, "ink")
    f.dot(19, 21, "ink")


def _moth_side(k: int) -> Fig:
    f = Fig(32, 32)
    up = k == 0
    f.lay()
    if up:
        f.oval(19, 8, 6.5, 3.5, -70, "mwing_far")
    else:
        f.oval(19, 24, 5.5, 3, 70, "mwing_far")
    _moth_body_side(f)
    f.lay(rim=True)
    if up:
        f.oval(12, 8, 7.5, 4.5, -112, "mwing")
        _eye_spot(f, 11, 7)
    else:
        f.oval(13, 24, 6.5, 4.5, 112, "mwing")
        _eye_spot(f, 12, 25)
    return f


def _moth_front(k: int, fall=False) -> Fig:
    f = Fig(32, 32)
    f.lay()
    if fall:
        for sx in (-1, 1):
            f.oval(16 + sx * 4, 8, 7, 3.2, -90 - sx * 18, "mwing")
        _eye_spot(f, 13, 6)
        _eye_spot(f, 19, 6)
    elif k == 0:
        for sx in (-1, 1):
            f.oval(16 + sx * 8, 11, 7.5, 5, -90 - sx * 60, "mwing")
        f.lay()
        for sx in (-1, 1):
            f.oval(16 + sx * 6, 21, 4.5, 3, 90 - sx * 60, "mhind")
        _eye_spot(f, 10, 10)
        _eye_spot(f, 22, 10)
    else:
        for sx in (-1, 1):
            f.oval(16 + sx * 8, 17, 7, 4.5, 90 - sx * 80, "mwing")
        f.lay()
        for sx in (-1, 1):
            f.oval(16 + sx * 5, 24, 4.5, 3, 90 - sx * 35, "mhind")
        _eye_spot(f, 10, 17)
        _eye_spot(f, 22, 17)
    f.lay().oval(16, 21, 3, 6, 0, "fuzz")
    for y in (20, 22, 24):
        f.dot(15, y, "violet1")
        f.dot(16, y, "violet1")
    f.lay().disc(16, 15, 3, "fuzz")
    f.lay().oval(16, 12, 4, 1.5, 0, "scarf")
    f.lay().disc(16, 9, 3, "fuzz")
    for ex in (14, 17):
        f.rect(ex, 8, ex + 1, 9 if not fall else 10, "ink")
        f.dot(ex, 8, "white")
    f.lay()
    spread = 2 if fall else 0
    f.seg((14, 6), (12 - spread, 3), 1, "ant")
    f.seg((12 - spread, 3), (10 - spread, 2 + spread), 1, "ant")
    f.seg((18, 6), (20 + spread, 3), 1, "ant")
    f.seg((20 + spread, 3), (22 + spread, 2 + spread), 1, "ant")
    return f


def moth_frames() -> list[Canvas]:
    side = [_moth_side(0), _moth_side(1)]
    out = [f.render() for f in side] + [f.render(flip=True) for f in side]
    out += [_moth_front(0).render(), _moth_front(1).render()]
    out.append(_moth_front(0, fall=True).render())
    return out


# ---------------------------------------------------------------------------------------
# Sable the owl: 40x48, hitbox 34x44 at (3, 2)
# ---------------------------------------------------------------------------------------

mat("plume", "stone1", "stone2", "stone3", 2)
mat("owl_wing", "stone1", "stone2", "stone3", 1)
mat("owl_wing_far", "stone0", "stone1", "stone1")
mat("owl_face", "stone3", "stone4", "white")
mat("owl_belly", "stone2", "stone3", "stone4")
mat("owl_eye", "gold1", "gold2", "gold2")
mat("beak", "gold0", "gold1", "gold2")
mat("talon", "wood1", "gold0", "gold1")
mat("brow", "stone4", "white", "white")
mat("owl_fold", "violet0", "stone1", "stone2", 2)


def _owl_wing(f, hinge, ang, length, width, m, bars=True):
    """Broad wing with a scalloped trailing edge and fingered tip; trailing side faces back (-x)."""
    ux, uy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    vx, vy = -uy, ux
    if vx > 0 or (vx == 0 and vy < 0):
        vx, vy = -vx, -vy
    hx, hy = hinge
    pts = []
    for t in (0.0, 0.3, 0.6, 0.85):
        pts.append((hx + ux * length * t - vx * 1.2 * math.sin(math.pi * t),
                    hy + uy * length * t - vy * 1.2 * math.sin(math.pi * t)))
    pts.append((hx + ux * length, hy + uy * length))
    ts = [1.0, 0.86, 0.72, 0.58, 0.44, 0.3, 0.16, 0.02]

    def wd(t):
        return width * (0.75 + 0.35 * math.sin(math.pi * min(t * 1.15, 1.0))) * (1 - 0.55 * max(0.0, (t - 0.7) / 0.3))
    prev = None
    for t in ts:
        p = (hx + ux * length * t + vx * wd(t), hy + uy * length * t + vy * wd(t))
        if prev is not None:
            tm = (t + prev) / 2
            pts.append((hx + ux * length * tm + vx * (wd(tm) - 1.6), hy + uy * length * tm + vy * (wd(tm) - 1.6)))
        pts.append(p)
        prev = t
    f.poly(pts, m)
    if bars:
        for t in (0.35, 0.55, 0.75):
            for d in (0.35, 0.7):
                f.dot(round(hx + ux * length * t + vx * wd(t) * d), round(hy + uy * length * t + vy * wd(t) * d),
                      "stone3")


def _owl_fly(k: int) -> Fig:
    f = Fig(40, 48)
    angs = [-100, -168, 112, -168][k]
    far_angs = [-78, -150, 92, -150][k]
    hinge = (21, 22)
    f.lay()
    _owl_wing(f, (23, 21), far_angs, 16, 4.5, "owl_wing_far", bars=False)
    # tail
    f.lay().poly([(10, 24), (3, 26), (3, 31), (10, 31)], "owl_wing")
    # body and head
    f.lay().oval(18, 27, 11, 7.5, -8, "plume")
    f.oval(19, 30, 7, 4, -8, "owl_belly")
    for x, y in ((15, 29), (19, 31), (23, 29), (17, 32)):
        f.dot(x, y, "stone2")
    f.lay().disc(29, 20, 7, "plume")
    f.oval(32, 21, 3.5, 5.5, 0, "owl_face")
    f.lay().seg((25, 14), (23, 10), 2, "plume")
    f.lay().rect(32, 18, 34, 20, "owl_eye")
    f.dot(34, 19, "ink")
    f.dot(33, 19, "ink")
    f.lay().seg((31, 16), (36, 17), 1, "brow")
    f.lay().rect(36, 21, 37, 22, "beak")
    f.dot(37, 23, "gold0")
    # tucked talons
    f.lay().rect(22, 34, 24, 35, "talon")
    # near wing
    f.lay(rim=True)
    _owl_wing(f, hinge, angs, 19, 5.5, "owl_wing")
    return f


def _owl_perch(blink: bool) -> Fig:
    f = Fig(40, 48)
    f.lay().oval(20, 30, 13, 14, 0, "plume")
    f.oval(20, 33, 8, 9, 0, "owl_belly")
    for (x, y) in ((17, 28), (21, 29), (18, 32), (22, 33), (16, 36), (20, 37), (24, 36), (19, 40), (23, 40)):
        f.dot(x, y, "stone2")
        f.dot(x + 1, y + 1, "stone2")
    # ear tufts, head
    f.lay().poly([(9, 8), (7, 1), (14, 6)], "plume")
    f.poly([(31, 8), (33, 1), (26, 6)], "plume")
    f.lay().oval(20, 15, 12, 10, 0, "plume")
    f.disc(15, 15, 5.5, "owl_face")
    f.disc(25, 15, 5.5, "owl_face")
    # eyes
    f.lay()
    for ex in (15, 25):
        if blink:
            f.rect(ex - 3, 15, ex + 2, 16, "owl_face")
            for x in range(ex - 3, ex + 3):
                f.dot(x, 16, "stone1")
        else:
            f.disc(ex - 0.5, 15.5, 2.8, "owl_eye")
            f.rect(ex - 1, 15, ex, 16, "ink")
            f.dot(ex - 1, 15, "white")
    # the monocle on the right eye, with a chain to the chest
    for a in range(0, 360, 12):
        x = 24.5 + 4.3 * math.cos(math.radians(a))
        y = 15.5 + 4.3 * math.sin(math.radians(a))
        f.dot(round(x), round(y), "gold1")
    for (x, y) in ((28, 20), (28, 22), (27, 24), (26, 26)):
        f.dot(x, y, "gold1")
    # bushy pale brows
    f.lay().seg((10, 9), (17, 11), 2, "brow")
    f.seg((30, 9), (23, 11), 2, "brow")
    f.lay().rect(19, 18, 20, 21, "beak")
    f.dot(20, 21, "gold0")
    # folded wings at the sides
    f.lay(rim=True).oval(9, 31, 5, 11, 8, "owl_fold")
    f.lay(rim=True).oval(31, 31, 5, 11, -8, "owl_fold")
    for (x, y) in ((8, 36), (9, 39), (32, 36), (31, 39)):
        f.dot(x, y, "stone0")
    # talons
    f.lay()
    for fx in (15, 24):
        f.rect(fx, 43, fx + 2, 44, "talon")
        for d in (0, 2):
            f.dot(fx + d, 45, "gold0")
    return f


def owl_frames() -> list[Canvas]:
    out = [_owl_fly(k).render() for k in range(4)]
    out += [_owl_perch(False).render(), _owl_perch(True).render()]
    return out


def build() -> None:
    build_hero()
    save_sprite("tiny", tiny_frames())
    save_sprite("moth", moth_frames())
    save_sprite("owl", owl_frames())


if __name__ == "__main__":
    build()
