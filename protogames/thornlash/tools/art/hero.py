"""Corvin Ashdown, hero of Thornlash: an original design.

Painted frame by frame from a 2D rig (tools/art/paint2d.py). Faces right; the engine
mirrors it. Palette: 15 colours + transparency, i.e. one 4bpp SNES/Genesis sprite palette.

Costume: deep-green hooded mantle with its hood thrown back, oxblood leather jerkin with
brass studs, dark trousers, tall brown boots, an iron pauldron and bracers; dark hair tied
back and a short beard. Weapon: the Thornlash, a chain whip with a barbed head.
"""
import math
import json
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from paint2d import Frame, hexrgb, clean_orphans  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "art" / "build" / "hero"

OUTLINE = "#140c18"
SHADOW = "#2a1a22"
PALETTE = [OUTLINE, SHADOW, "#6c3024", "#a8674a", "#e0a07a", "#a0543a", "#4a2e26", "#3c3450",
           "#5c5470", "#1c2e2c", "#2e5046", "#4e7c62", "#7a8090", "#c8ccd6", "#c8962e"]
MAT = {
    "skin": ["#6c3024", "#a8674a", "#e0a07a"],
    "hair": [SHADOW, "#4a2e26", "#6c3024"],
    "boot": [SHADOW, "#4a2e26", "#6c3024"],
    "leather": [SHADOW, "#6c3024", "#a0543a"],
    "cloth": [SHADOW, "#3c3450", "#5c5470"],
    "mantle": ["#1c2e2c", "#2e5046", "#4e7c62"],
    "iron": ["#3c3450", "#7a8090", "#c8ccd6"],
    "gold": ["#6c3024", "#c8962e", "#c8ccd6"],
}
for ramp in MAT.values():
    for c in ramp:
        assert c in PALETTE, c

W, H = 64, 64
FX, FY = 32, 62          # feet pivot inside the frame
THIGH, SHIN, FOOT = 10.0, 10.0, 5.0
TORSO = 14.0
UARM, FARM = 7.5, 7.0


def d(a):
    r = math.radians(a)
    return (math.sin(r), math.cos(r))


def add(p, v, k=1.0):
    return (p[0] + v[0] * k, p[1] + v[1] * k)


BASE = dict(hx=0.0, hy=0.0, lean=4.0, head=0.0,
            nt=10.0, ns=-4.0, nf=90.0, ft=-12.0, fs=-8.0, ff=86.0,
            nua=18.0, nfa=40.0, fua=-12.0, ffa=10.0,
            cape=0.0, blink=False, hand_open=False)


def pose(**kw):
    p = dict(BASE)
    p.update(kw)
    return p


def paint(P):
    f = Frame(W, H, MAT, OUTLINE)
    hip = (FX + P["hx"], FY - (THIGH + SHIN + 3) + P["hy"])
    lean = P["lean"]
    u = d(180 - lean)                 # torso axis, hip -> neck
    fwd = (-u[1], u[0])               # perpendicular pointing to the facing side
    neck = add(hip, u, TORSO)
    # ---------------------------------------------------------------- legs
    joints = {}
    for side, t, s, ft_, dx, z, dim in (("f", P["ft"], P["fs"], P["ff"], -1.2, 2, 0.14),
                                        ("n", P["nt"], P["ns"], P["nf"], 1.2, 6, 0.0)):
        hj = add(hip, fwd, dx)
        knee = add(hj, d(t), THIGH)
        ankle = add(knee, d(s), SHIN)
        toe = add(ankle, d(ft_), FOOT)
        joints[side] = (hj, knee, ankle, toe)
        g = "leg" + side
        f.capsule(hj, knee, 3.3, 2.7, "cloth", g, z, dim)
        mid = add(knee, d(s), SHIN * 0.35)
        f.capsule(knee, mid, 2.5, 2.4, "cloth", g, z + 0.1, dim)
        f.capsule(mid, ankle, 2.7, 2.5, "boot", g, z + 0.2, dim)      # tall boot
        f.capsule(add(mid, d(s), -0.8), add(mid, d(s), 0.6), 3.0, 3.0, "boot", g, z + 0.25, dim, bias=0.12)  # cuff
        f.capsule(add(ankle, d(ft_), -1.2), toe, 2.3, 1.7, "boot", g, z + 0.3, dim)
    # ---------------------------------------------------------------- cape (behind all)
    back_sh = add(neck, fwd, -4.5)
    cape_len = 15 + P["cape"] * 0.5
    trail = add(add(back_sh, u, -cape_len), fwd, -4.0 - P["cape"])
    trail2 = add(add(neck, u, -cape_len + 2), fwd, -1.0 - P["cape"] * 0.4)
    f.poly([add(neck, fwd, 2.0), back_sh, trail, add(trail, fwd, 2.5), trail2], "mantle", "cape", 0.5, dim=0.08)
    # ---------------------------------------------------------------- far arm
    fsh = add(add(neck, fwd, -2.5), u, -2.2)
    fel = add(fsh, d(P["fua"]), UARM)
    fwr = add(fel, d(P["ffa"]), FARM)
    f.capsule(fsh, fel, 2.7, 2.3, "leather", "armf", 1, 0.16)
    f.capsule(fel, fwr, 2.3, 2.0, "skin", "armf", 1.1, 0.16)
    f.capsule(add(fel, d(P["ffa"]), 3.5), fwr, 2.4, 2.3, "iron", "armf", 1.2, 0.26)   # bracer
    f.ellipse(add(fwr, d(P["ffa"]), 1.4), 1.8, 1.8, "skin", "armf", 1.3, 0.16)
    # ---------------------------------------------------------------- torso
    tw_h, tw_s = 4.8, 6.6
    chest = [add(hip, fwd, tw_h), add(hip, fwd, -tw_h + 0.3), add(add(neck, fwd, -tw_s + 0.8), u, -1.0),
             add(neck, fwd, -2.0), add(neck, fwd, 2.5), add(add(neck, fwd, tw_s), u, -2.0)]
    f.poly(chest, "leather", "torso", 5)
    # coat skirt: front and back flaps that follow the thighs
    hn, kn = joints["n"][0], joints["n"][1]
    hf, kf = joints["f"][0], joints["f"][1]
    fr_tip = add(hn, (kn[0] - hn[0], kn[1] - hn[1]), 0.65)
    bk_tip = add(hf, (kf[0] - hf[0], kf[1] - hf[1]), 0.6)
    f.poly([add(hip, fwd, 4.4), add(hip, fwd, -1.0), add(bk_tip, fwd, -3.2), add(bk_tip, fwd, 1.0)], "leather", "skirtb", 2.6, dim=0.12)
    f.poly([add(hip, fwd, -0.6), add(hip, fwd, 4.6), add(fr_tip, fwd, 2.8), add(fr_tip, fwd, -2.4)], "leather", "skirtf", 6.5)
    # belt with a brass buckle, studs on the chest
    b0 = add(add(hip, u, 1.5), fwd, -tw_h)
    b1 = add(add(hip, u, 1.5), fwd, tw_h + 0.3)
    f.capsule(b0, b1, 1.3, 1.3, "leather", "torso", 5.3, bias=-0.35)
    bk = add(add(hip, u, 1.5), fwd, 2.8)
    f.pixel(bk[0], bk[1], "#c8962e")
    f.pixel(bk[0], bk[1] - 1, "#c8ccd6")
    for k in (5.0, 8.5, 12.0):
        st = add(add(hip, u, k), fwd, 3.2 - k * 0.06)
        f.pixel(st[0], st[1], "#c8962e")
    # hood thrown back: a bunched collar of mantle cloth around the neck
    f.ellipse(add(add(neck, fwd, -2.0), u, -0.5), 4.4, 2.8, "mantle", "hood", 6.8, angle=math.radians(-lean * 0.5))
    # ---------------------------------------------------------------- head
    hc = add(neck, d(180 - lean - P["head"]), 5.2)
    hf2 = d(90 - lean - P["head"])       # facing direction of the head
    f.ellipse(hc, 4.0, 4.4, "skin", "head", 7)
    # hair: dark cap over the back and top, tied tail behind
    hb = add(add(hc, hf2, -2.3), u, 1.2)
    f.ellipse(hb, 3.5, 3.6, "hair", "hair", 7.2)
    f.ellipse(add(add(hc, hf2, 0.4), u, 3.3), 3.0, 1.3, "hair", "hair", 7.25)
    f.capsule(add(hc, hf2, -3.2), add(add(hc, hf2, -6.0), u, -3.5), 1.6, 1.0, "hair", "hair", 6.9)
    # face: eye, brow, nose, beard
    eye = add(add(hc, hf2, 2.2), u, -0.2)
    if P["blink"]:
        f.pixel(eye[0], eye[1], "#6c3024")
    else:
        f.pixel(eye[0], eye[1], SHADOW)
    f.pixel(eye[0], eye[1] - 1, "#4a2e26")
    f.pixel(eye[0] - 1, eye[1] - 1, "#4a2e26")
    for k in (-1.0, 0.0, 1.0, 2.0):
        bpx = add(add(hc, hf2, k + 0.5), u, -3.0 + abs(k - 0.5) * 0.4)
        f.pixel(bpx[0], bpx[1], "#4a2e26")
    chin = add(add(hc, hf2, 1.8), u, -3.8)
    f.pixel(chin[0], chin[1], "#4a2e26")
    # ---------------------------------------------------------------- near arm (front)
    nsh = add(add(neck, fwd, 2.0), u, -2.4)
    nel = add(nsh, d(P["nua"]), UARM)
    nwr = add(nel, d(P["nfa"]), FARM)
    f.capsule(nsh, nel, 2.9, 2.5, "leather", "armn", 8)
    f.capsule(nel, nwr, 2.4, 2.1, "skin", "armn", 8.1)
    f.capsule(add(nel, d(P["nfa"]), 3.6), nwr, 2.6, 2.5, "iron", "armn", 8.2, bias=-0.12)
    hand = add(nwr, d(P["nfa"]), 1.5)
    f.ellipse(hand, 2.0, 2.0, "skin", "armn", 8.3)
    f.ellipse(add(nsh, u, 0.6), 3.0, 2.3, "iron", "armn", 8.4, bias=-0.18, angle=math.radians(-lean))   # pauldron
    img = f.render()
    img = clean_orphans(img, hexrgb(OUTLINE))
    return img, (round(hand[0] - FX), round(hand[1] - FY))


# ==================================================================== animations
# Angles: 0 = straight down, +90 = forward (facing), -90 = backward, 180 = up.

def idle(i, n=6):
    k = math.sin(i / n * 2 * math.pi)
    return pose(hy=round(k * 0.6), lean=4, nt=16, ns=0, ft=-16, fs=-10, ff=84,
                nua=14 + k * 2, nfa=34 + k * 3, fua=-8, ffa=12, cape=1 + k, blink=(i == 3))


def walk(i, n=8):
    ph = i / n * 2 * math.pi
    s = math.sin(ph)
    c = math.cos(ph)
    bob = -abs(math.sin(ph)) * 1.4 + 0.7
    return pose(hy=round(bob), lean=7,
                nt=24 * s, ns=24 * s - 22 * max(0, -c) - 6, nf=90 + 10 * max(0, -s),
                ft=-24 * s, fs=-24 * s - 22 * max(0, c) - 6, ff=90 + 10 * max(0, s),
                nua=-22 * s + 4, nfa=-10 * s + 30, fua=22 * s, ffa=22 * s + 20, cape=2.5 + s)


def jump(i):
    tuck = [0.4, 1.0, 1.0][i]
    return pose(hy=-2 * tuck, lean=10, nt=50 + 40 * tuck, ns=-20 - 10 * tuck, ft=30 + 40 * tuck, fs=-40,
                nua=-30, nfa=40, fua=-50, ffa=-10, cape=4 + 2 * i)


def fall(i):
    return pose(lean=6, nt=30, ns=-6, ft=-4, fs=-20, nua=-50 - 6 * i, nfa=-20, fua=-70, ffa=-40, cape=-2 - i)


def crouch(i):
    k = [0.6, 1.0][i]
    return pose(hy=7 * k, lean=16 * k, nt=70 * k, ns=-20 * k, ft=30 * k, fs=-80 * k, ff=90,
                nua=30, nfa=60, fua=10, ffa=30, cape=0)


# whip: anticipation (arm cocked high behind the head), strike (arm snaps forward), hold, recover
WHIP_POSES = [
    dict(nua=-140, nfa=-70, fua=30, ffa=60, lean=-3),
    dict(nua=-150, nfa=-95, fua=36, ffa=70, lean=-6),
    dict(nua=120, nfa=100, fua=-10, ffa=20, lean=10),
    dict(nua=95, nfa=90, fua=-30, ffa=-10, lean=12),
    dict(nua=90, nfa=88, fua=-30, ffa=-10, lean=11),
    dict(nua=60, nfa=70, fua=-10, ffa=10, lean=8),
]
WHIP_MS = [50, 67, 67, 67, 67, 50]   # 7 + 8 + 7 frames at 60 Hz, matching Game.WHIP_*


def whip(i, base):
    p = dict(base)
    p.update(WHIP_POSES[i])
    return pose(**p)


STAND_BASE = dict(nt=26, ns=6, ft=-22, fs=-14, ff=84, cape=1)
CROUCH_BASE = dict(hy=7, nt=70, ns=-20, ft=30, fs=-80, ff=90, cape=0)
AIR_BASE = dict(hy=-2, nt=90, ns=-30, ft=70, fs=-40, cape=4)

THROW_POSES = [
    dict(nua=-120, nfa=-80, lean=0), dict(nua=-150, nfa=-120, lean=-3),
    dict(nua=40, nfa=70, lean=10), dict(nua=80, nfa=88, lean=12),
    dict(nua=70, nfa=80, lean=10), dict(nua=40, nfa=55, lean=6),
]
THROW_MS = [50, 50, 67, 67, 33, 33]


def throw(i, base):
    p = dict(base)
    p.update(THROW_POSES[i])
    return pose(**p)


def stair(i, up=True, n=4):
    # the stair rises one step every 8 px; legs alternate on a raised step
    ph = i / n * 2 * math.pi
    s = math.sin(ph)
    if up:
        return pose(lean=10, nt=40 + 30 * s, ns=-10 + 10 * s, ft=10 - 30 * s, fs=-10 - 20 * s,
                    nua=-10 * s, nfa=30, fua=10 * s, ffa=20, cape=2 + s)
    return pose(lean=-2, hy=1, nt=20 + 25 * s, ns=5 + 15 * s, ft=-10 - 20 * s, fs=0 - 10 * s,
                nua=-10 * s + 10, nfa=40, fua=10 * s, ffa=20, cape=1 + s)


def hurt(i):
    return pose(hx=-1 - i, lean=-18 - 4 * i, head=-12, nt=40, ns=10, ft=-20, fs=-10,
                nua=-120, nfa=-90, fua=-150, ffa=-120, cape=5)


def die(i):
    # stagger, knees buckle, fall back, lie still
    seq = [
        pose(lean=-16, head=-10, nt=30, ns=10, ft=-20, fs=-10, nua=-110, nfa=-80, fua=-140, ffa=-110, cape=5),
        pose(hy=3, lean=-10, head=-6, nt=50, ns=-10, ft=10, fs=-30, nua=-60, nfa=-30, fua=-80, ffa=-60, cape=4),
        pose(hy=8, lean=10, head=6, nt=80, ns=-30, ft=60, fs=-40, nua=20, nfa=40, fua=10, ffa=30, cape=2),
        pose(hy=12, lean=30, head=10, nt=90, ns=-60, ft=80, fs=-60, nua=60, nfa=80, fua=40, ffa=70, cape=1),
        pose(hy=16, lean=-60, head=-10, nt=60, ns=80, ft=40, fs=80, nua=-100, nfa=-90, fua=-110, ffa=-100, cape=0),
        pose(hy=19, lean=-84, head=-4, nt=80, ns=90, ft=70, fs=90, nua=-100, nfa=-90, fua=-110, ffa=-100, cape=0),
        pose(hy=19, lean=-86, head=-2, nt=82, ns=90, ft=74, fs=90, nua=-96, nfa=-90, fua=-108, ffa=-100, cape=0),
        pose(hy=19, lean=-86, head=-2, nt=82, ns=90, ft=74, fs=90, nua=-96, nfa=-90, fua=-108, ffa=-100, cape=0, blink=True),
    ]
    return seq[i]


def animations():
    A = {}
    A["idle"] = ([idle(i) for i in range(6)], [150, 150, 150, 150, 150, 150], True)
    A["walk"] = ([walk(i) for i in range(8)], [100] * 8, True)
    A["jump"] = ([jump(i) for i in range(3)], [60, 80, 400], False)
    A["fall"] = ([fall(i) for i in range(2)], [100, 400], False)
    A["crouch"] = ([crouch(i) for i in range(2)], [50, 400], False)
    A["whip"] = ([whip(i, STAND_BASE) for i in range(6)], WHIP_MS, False)
    A["crouch_whip"] = ([whip(i, CROUCH_BASE) for i in range(6)], WHIP_MS, False)
    A["jump_whip"] = ([whip(i, AIR_BASE) for i in range(6)], WHIP_MS, False)
    A["throw"] = ([throw(i, STAND_BASE) for i in range(6)], THROW_MS, False)
    A["crouch_throw"] = ([throw(i, CROUCH_BASE) for i in range(6)], THROW_MS, False)
    A["stair_up"] = ([stair(i, True) for i in range(4)], [110] * 4, True)
    A["stair_down"] = ([stair(i, False) for i in range(4)], [110] * 4, True)
    su = dict(lean=10, nt=60, ns=-10, ft=10, fs=-10, cape=2)
    sd = dict(lean=-2, hy=1, nt=30, ns=10, ft=-20, fs=0, cape=1)
    A["stair_up_whip"] = ([whip(i, su) for i in range(6)], WHIP_MS, False)
    A["stair_down_whip"] = ([whip(i, sd) for i in range(6)], WHIP_MS, False)
    A["hurt"] = ([hurt(i) for i in range(2)], [80, 600], False)
    A["die"] = ([die(i) for i in range(8)], [120, 120, 120, 150, 150, 200, 600, 2000], False)
    return A


# ==================================================================== the Thornlash (whip)
WHIP_LEN = {1: 26, 2: 26, 3: 42}   # Game.WHIP_LEN; the lash starts 14 px ahead of the feet


def _whip_px(img, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        img.putpixel((int(x), int(y)), hexrgb(c))


def _chain_path(img, pts, lv):
    """Draw the lash along a polyline of (x, y) points, one link every 2 px."""
    dark = {1: SHADOW, 2: "#3c3450", 3: "#3c3450"}[lv]
    mid = {1: "#6c3024", 2: "#7a8090", 3: "#7a8090"}[lv]
    lite = {1: "#a0543a", 2: "#c8ccd6", 3: "#c8ccd6"}[lv]
    k = 0
    for (x, y) in pts:
        top = lite if k % 4 < 2 else mid
        _whip_px(img, x, y, top)
        _whip_px(img, x, y + 1, dark if lv > 1 else mid)
        if lv > 1 and k % 6 == 3:          # thorns along the chain
            _whip_px(img, x, y - 1, lite)
        k += 1


def _barb(img, x, y):
    for dx, dy, c in ((0, 0, "#c8ccd6"), (1, 0, "#7a8090"), (0, 1, "#7a8090"), (1, 1, "#3c3450"),
                      (-1, -1, "#c8ccd6"), (2, -1, "#c8ccd6"), (-1, 2, "#7a8090"), (2, 2, "#7a8090"),
                      (3, 0, "#c8ccd6"), (0, -2, "#c8ccd6")):
        _whip_px(img, x + dx, y + dy, c)


def whip_frames():
    """name -> (image, pivot) with the pivot at the grip. Drawn facing right."""
    out = {}
    gx, gy = 30, 34
    for lv in (1, 2, 3):
        # back: the lash hangs behind the raised hand in a loose S
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        n = 18 if lv < 3 else 26
        pts = [(gx - i, gy + int(round(math.sin(i / 5.0) * 2 + i * 0.55))) for i in range(n)]
        _chain_path(img, pts, lv)
        if lv == 3:
            _barb(img, pts[-1][0] - 1, pts[-1][1])
        out[f"whip{lv}_back"] = (img, (gx, gy))
        # mid: swinging over the shoulder, a rising arc forward
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        pts = []
        for i in range(n):
            a = math.pi * (0.95 - i / n * 0.9)
            r = 4 + i * 0.9
            pts.append((gx + int(round(math.cos(a) * r * 0.6)), gy - int(round(math.sin(a) * r * 0.9))))
        _chain_path(img, pts, lv)
        if lv == 3:
            _barb(img, pts[-1][0], pts[-1][1] - 1)
        out[f"whip{lv}_mid"] = (img, (gx, gy))
        # out: fully extended, level with the hitbox (Game.whip_rect)
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        L = WHIP_LEN[lv] - 6
        ox = 4
        pts = [(ox + i, gy + (1 if i < 3 else 0)) for i in range(L)]
        _chain_path(img, pts, lv)
        if lv == 3:
            _barb(img, ox + L, gy - 1)
        else:
            _whip_px(img, ox + L, gy, "#c8ccd6" if lv == 2 else "#a0543a")
        out[f"whip{lv}_out"] = (img, (ox, gy))
    return out


def build(preview=True):
    BUILD.mkdir(parents=True, exist_ok=True)
    A = animations()
    meta = {"tags": [], "frames": []}
    idx = 0
    for name, (poses, ms, loop) in A.items():
        start = idx
        for i, P in enumerate(poses):
            img, hand = paint(P)
            img.save(BUILD / f"{idx:03d}.png")
            meta["frames"].append({"file": f"{idx:03d}.png", "ms": ms[i], "hand": hand, "anim": name, "i": i})
            idx += 1
        meta["tags"].append({"name": name, "from": start, "to": idx - 1, "loop": loop})
    for name, (img, piv) in whip_frames().items():
        img.save(BUILD / f"{idx:03d}.png")
        meta["frames"].append({"file": f"{idx:03d}.png", "ms": 100, "pivot": list(piv), "anim": name, "i": 0})
        meta["tags"].append({"name": name, "from": idx, "to": idx, "loop": False})
        idx += 1
    meta["size"] = [W, H]
    meta["pivot"] = [FX, FY]
    meta["palette"] = PALETTE
    (BUILD / "frames.json").write_text(json.dumps(meta, indent=1))
    if preview:
        cols = 12
        rows = (idx + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * W, rows * H), (64, 58, 74, 255))
        for i in range(idx):
            im = Image.open(BUILD / f"{i:03d}.png")
            sheet.alpha_composite(im, ((i % cols) * W, (i // cols) * H))
        sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
        sheet.save(ROOT / "art" / "build" / "hero_preview.png")
    print("hero frames:", idx)
    return meta


if __name__ == "__main__":
    build()
