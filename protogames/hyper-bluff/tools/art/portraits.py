#!/usr/bin/env python3
"""Paint the nine Hyper Bluff portraits and save them as Aseprite sources.

    python3 tools/art/portraits.py            # writes art/portraits/<id>.aseprite
    python3 tools/art/portraits.py rin mako   # only these

Each file is 96x96, five frames (neutral, happy, shock, defeat, fierce; 200 ms each,
one tag per frame) and the layers, bottom to top:

    hair_back  hair, collars and ribbons that sit behind the body
    body       neck, shoulders, clothes
    face       head, ears, eyes, nose, mouth, face shading
    hair       hair in front of the face, hats, hair ornaments
    fx         eyebrows, glasses, sweat drops and other marks drawn over the hair
    eyeband    HIDDEN guide: a 96x24 box over the eyes; its y is the "eye_y" that
               export_portraits.py writes to portraits.json for the cut-in close-up

The painting is procedural and deterministic (no random numbers). All designs are
original to this game.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paintkit as K                      # noqa: E402
from paintkit import Layer, XX, YY, mx, sym, mirror, shift, grow, rim   # noqa: E402
from asefile import Sprite                # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_DIR = os.path.join(ROOT, "art", "portraits")

EXPR = ["neutral", "happy", "shock", "defeat", "fierce"]
CAST = [
    ("rin", "Rin Hoshikawa"),
    ("mako", "Mako Tendo"),
    ("jiro", "Jiro Kanzaki"),
    ("aya", "Aya Kurogane"),
    ("pochi", "Pochi Maruyama"),
    ("goro", '"Thunder" Goro Daimon'),
    ("yuki", "Lady Shirayuki"),
    ("zeno", "Professor Zeno Quark"),
    ("onyx", "Baron Onyx"),
]
LAYERS = ["hair_back", "body", "face", "hair", "fx"]
WHITE = "#ffffff"


# --------------------------------------------------------------------------- face

def face_cfg(**kw):
    d = dict(
        skull=(48.0, 38.0, 19.5, 23.0),
        jaw=[(67.5, 38), (67.0, 50), (62.5, 58.5), (55.0, 65.0), (50.5, 67.5)],
        ears=True, ear_y=47.0, ear_x=20.0,
        eye_dx=9.0, eye_y=46.0, eye_w=9.0, eye_h=11.0, eye_tilt=0.3, eye_drop=0.0,
        iris=1.0, lash=0.8, flick=True, lower_lid=True, big_hl=True,
        brow_y=36.0, brow_t=1.7,
        nose_y=55.0, mouth_y=61.0, mouth_w=1.0,
    )
    d.update(kw)
    return d


def head_mask(F):
    cx, cy, rx, ry = F["skull"]
    return K.m_ellipse(cx, cy, rx, ry) | K.m_poly(sym(F["jaw"]))


def eye_masks(F, st):
    """Masks for the viewer's-right eye (outer side = +x). Mirror for the other eye."""
    ex, ey = 48.0 + F["eye_dx"], F["eye_y"]
    w, h = F["eye_w"], F["eye_h"]
    a, b = w / 2.0, h / 2.0
    tilt, drop, iris_s, lash_t = F["eye_tilt"], F["eye_drop"], F["iris"], 1.6
    out = {}
    if st in ("open", "half", "fierce", "wide", "teary", "smug"):
        raise_bottom = 0.0
        ring_up = F["lash"]
        if st == "wide":
            a += 0.5
            b += 1.0
            iris_s *= 0.62
            ring_up = 0.2
            drop = 0.0
        elif st == "half":
            drop = max(drop, 0.0) + 0.34
        elif st == "smug":
            drop = max(drop, 0.0) + 0.24
            raise_bottom = 0.16
        elif st == "fierce":
            drop = max(drop, 0.0) + 0.26
            tilt = tilt + 1.5
            raise_bottom = 0.10
        E = K.m_superellipse(ex, ey, a, b, 2.6)
        yl = ey - b + drop * h - tilt * (XX - ex) / a
        white = E & (YY >= yl)
        if raise_bottom:
            white &= YY <= ey + b - raise_bottom * h
        Eg = K.m_superellipse(ex, ey - ring_up, a + 1.0, b + 1.0 + ring_up * 0.4, 2.6)
        upper = Eg & ~E & (YY < ey - 0.05 * b)
        if drop > 0.01 or tilt > 0.8:
            upper &= YY >= yl - lash_t
        band = E & (YY < yl) & (YY >= yl - lash_t)
        lash = upper | band
        if F["flick"]:
            lash |= K.m_poly([(ex + a - 1.0, ey - 0.5 * b - 0.5 * tilt + drop * h * 0.6),
                              (ex + a + 2.2, ey - 0.78 * b - tilt + drop * h * 0.5),
                              (ex + a + 0.7, ey - 0.02 * b + drop * h * 0.3)])
        out["white"] = white
        out["lash"] = lash & ~white
        if F["lower_lid"]:
            yb = ey + b - raise_bottom * h
            Lg = K.m_superellipse(ex, ey + 0.2, a + 0.7, b + 0.9, 2.6)
            if raise_bottom:
                low = E & (YY > yb) & (YY <= yb + 1.0) & (XX > ex - 0.5 * a)
            else:
                low = Lg & ~E & (YY > ey + 0.55 * b) & (XX > ex + 0.25 * a)
            out["lid"] = low
        ix, iy = ex - 0.4, ey + 0.2
        ia = 0.38 * w * iris_s
        ib = (b - 0.1) * (iris_s if iris_s < 0.95 else 1.0)
        if st == "wide":
            ib = ia * 1.15
            iy = ey
        I = (((XX - ix) / ia) ** 2 + ((YY - iy) / ib) ** 2 <= 1.0) & white
        out["iris"] = I
        out["iris_lt"] = I & (((XX - ix) / (ia * 0.95)) ** 2 + ((YY - (iy + 0.7 * ib)) / (0.62 * ib)) ** 2 <= 1.0)
        out["pupil"] = I & (((XX - ix) / (0.46 * ia)) ** 2 + ((YY - (iy - 0.08 * ib)) / (0.44 * ib)) ** 2 <= 1.0)
        out["geom"] = (ix, iy, ia, ib)
    elif st == "happy":      # ^ arcs
        out["lash"] = K.m_stroke([(ex - a, ey + 1.8), (ex - 0.55 * a, ey - 0.6), (ex, ey - 1.6),
                                  (ex + 0.55 * a, ey - 0.6), (ex + a, ey + 1.8)], 1.7, True)
    elif st == "shut":       # U arcs, eyes closed
        out["lash"] = K.m_stroke([(ex - a, ey + 0.6), (ex - 0.5 * a, ey + 2.3), (ex, ey + 2.9),
                                  (ex + 0.5 * a, ey + 2.3), (ex + a, ey + 0.4)], 1.6, True)
        out["lash"] |= K.m_line([(ex + a - 0.5, ey + 1.5), (ex + a + 1.5, ey + 3.0)])
        out["lash"] |= K.m_line([(ex + 0.3 * a, ey + 3.0), (ex + 0.6 * a, ey + 4.6)])
    elif st == "line":       # calm closed eye
        out["lash"] = K.m_stroke([(ex - a, ey + 1.6), (ex, ey + 2.4), (ex + a + 0.6, ey + 0.8)], 1.6, True)
    elif st == "scrunch":    # > <
        out["lash"] = K.m_stroke([(ex + a, ey - 3.2), (ex - a + 1.2, ey + 0.2), (ex + a, ey + 3.4)], 1.6)
    out["box"] = (ex - a - 1, ey - b - 2, ex + a + 3, ey + b + 2)
    return out


def paint_eye(L, P, F, m, right, st, hl=True):
    def side(k):
        if k not in m:
            return None
        return m[k] if right else mirror(m[k])
    if side("white") is not None:
        L.fill(side("white"), P.get("eye_white", WHITE))
        L.fill(side("iris"), P["iris"])
        L.fill(side("iris_lt"), P["iris_lt"])
        L.fill(side("pupil"), P["ink"])
        if side("lid") is not None:
            L.fill(side("lid"), P["line"])
    L.fill(side("lash"), P["ink"])
    if "geom" in m and hl:
        ix, iy, ia, ib = m["geom"]
        if not right:
            ix = 96.0 - ix
        if st == "wide":
            L.fill(K.m_px((ix - 0.9, iy - 0.9)), WHITE)
        else:
            x0, y0 = math.floor(ix - 0.75 * ia), math.floor(iy - 0.72 * ib)
            if F["big_hl"] and st != "fierce":
                L.fill(K.m_px((x0, y0), (x0 + 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 1)), WHITE)
            else:
                L.fill(K.m_px((x0, y0), (x0 + 1, y0)), WHITE)
            if st != "fierce":
                L.fill(K.m_px((ix + 0.55 * ia, iy + 0.5 * ib)), WHITE)
        if st == "teary":
            L.fill(K.m_px((ix - 0.2, iy + 0.75 * ib), (ix + 0.8, iy + 0.75 * ib), (ix + 0.75 * ia, iy - 0.3 * ib)), WHITE)


BROWS = {            # inner dy, outer dy, arch
    "neutral": (0.0, 0.3, 0.9),
    "soft": (-0.6, 0.6, 1.0),
    "up": (-1.2, -0.6, 1.5),
    "high": (-3.2, -2.6, 1.6),
    "sad": (-2.6, 1.2, 0.2),
    "angry": (3.4, -2.2, -0.2),
    "stern": (1.6, -0.9, 0.0),
    "cocky": (1.0, -1.6, 0.6),
}


def brow_mask(F, kind, right=True, t=None):
    ex = 48.0 + F["eye_dx"]
    a = F["eye_w"] / 2.0
    by = F["brow_y"]
    i, o, arch = BROWS[kind]
    pts = [(ex - a - 0.2, by + i), (ex + 0.1 * a, by + (i + o) / 2.0 - arch), (ex + a + 1.6, by + o)]
    m = K.m_stroke(pts, t or F["brow_t"], True)
    return m if right else mirror(m)


def paint_mouth(L, P, F, kind):
    cx, y = 48.0, F["mouth_y"]
    s = F["mouth_w"]
    ink, line, dark = P["ink"], P["line"], P["mouth"]
    if kind == "line":
        L.fill(K.m_line([(cx - 3 * s, y), (cx + 2 * s, y)]), line)
    elif kind == "smile":
        L.fill(K.m_curve([(cx - 4 * s, y - 0.6), (cx - 2 * s, y + 0.6), (cx, y + 1.0), (cx + 2 * s, y + 0.6), (cx + 3.6 * s, y - 0.6)]), line)
    elif kind == "smirk":
        L.fill(K.m_curve([(cx - 3.5 * s, y + 0.6), (cx, y + 1.0), (cx + 3 * s, y + 0.2), (cx + 5 * s, y - 1.6)]), line)
    elif kind == "frown":
        L.fill(K.m_curve([(cx - 3.6 * s, y + 1.2), (cx - 1.5 * s, y), (cx + 1.0 * s, y), (cx + 3.2 * s, y + 1.2)]), line)
    elif kind == "wavy":
        L.fill(K.m_line([(cx - 5 * s, y + 1), (cx - 3 * s, y - 0.2), (cx - 1 * s, y + 1), (cx + 1 * s, y - 0.2), (cx + 3 * s, y + 1), (cx + 4.6 * s, y)]), line)
    elif kind == "grin":       # closed teeth, friendly
        m = K.m_blob([(cx - 6 * s, y - 1.6), (cx, y - 1.0), (cx + 6 * s, y - 1.6), (cx + 4.2 * s, y + 1.8), (cx, y + 3.0), (cx - 4.2 * s, y + 1.8)])
        L.fill(grow(m), line)
        L.fill(m, WHITE)
    elif kind == "laugh":      # wide open
        m = K.m_blob([(cx - 6 * s, y - 2.0), (cx, y - 1.6), (cx + 6 * s, y - 2.0), (cx + 4.6 * s, y + 2.6), (cx, y + 4.6), (cx - 4.6 * s, y + 2.6)])
        L.fill(grow(m), line)
        L.fill(m, dark)
        L.fill(m & (YY < y - 0.2), WHITE)
        L.fill(m & K.m_ellipse(cx, y + 4.6, 3.4 * s, 2.2), P["tongue"])
    elif kind == "open":       # medium open smile
        m = K.m_blob([(cx - 4.5 * s, y - 1.6), (cx, y - 1.2), (cx + 4.5 * s, y - 1.6), (cx + 3.2 * s, y + 1.8), (cx, y + 3.2), (cx - 3.2 * s, y + 1.8)])
        L.fill(grow(m), line)
        L.fill(m, dark)
        L.fill(m & (YY < y - 0.4), WHITE)
        L.fill(m & (YY > y + 1.6), P["tongue"])
    elif kind == "o":          # shock
        m = K.m_ellipse(cx, y + 1.2, 2.6 * s, 3.4)
        L.fill(grow(m), line)
        L.fill(m, dark)
        L.fill(m & (YY > y + 2.6), P["tongue"])
    elif kind == "gasp":       # big shock
        m = K.m_blob([(cx - 4 * s, y - 1.6), (cx, y - 2.4), (cx + 4 * s, y - 1.6), (cx + 3.6 * s, y + 3.0), (cx, y + 4.8), (cx - 3.6 * s, y + 3.0)])
        L.fill(grow(m), line)
        L.fill(m, dark)
        L.fill(m & (YY < y - 0.8), WHITE)
        L.fill(m & (YY > y + 2.4), P["tongue"])
    elif kind == "small_o":
        m = K.m_ellipse(cx, y + 0.5, 1.6, 1.9)
        L.fill(grow(m), line)
        L.fill(m, dark)
    elif kind in ("grit", "snarl", "battle"):
        if kind == "grit":
            pts = [(cx - 5.5 * s, y - 1.8), (cx + 5.5 * s, y - 1.8), (cx + 5.0 * s, y + 2.4), (cx - 5.0 * s, y + 2.4)]
        elif kind == "snarl":
            pts = [(cx - 6 * s, y - 0.6), (cx - 3 * s, y - 2.2), (cx + 3 * s, y - 2.2), (cx + 6 * s, y - 0.6), (cx + 5 * s, y + 3.0), (cx - 5 * s, y + 3.0)]
        else:                  # battle grin, lopsided
            pts = [(cx - 5 * s, y - 0.4), (cx + 2 * s, y - 1.4), (cx + 7 * s, y - 3.4), (cx + 5.4 * s, y + 1.6), (cx, y + 3.2), (cx - 3.6 * s, y + 2.2)]
        m = K.m_poly(pts)
        L.fill(grow(m), line)
        L.fill(m, WHITE)
        ys = np.where(m.any(axis=1))[0]
        mid = (ys.min() + ys.max() + 1) // 2 if kind != "battle" else None
        if mid is not None:
            row = K.empty()
            row[mid, :] = True
            L.fill(m & row, line)
        for dx in (-3, 0, 3) if kind != "battle" else (-2, 1, 4):
            col = K.empty()
            col[:, int(math.floor(cx + dx * s)) + K.PAD] = True
            L.fill(m & col, P.get("teeth_line", line) if kind == "battle" else line)
    else:
        raise KeyError(kind)


def paint_face(L, P, F, E, cast=None, pre_eyes=None):
    """Head, ears, shading, nose, mouth, eyes. Returns the head mask."""
    head = head_mask(F)
    if F["ears"]:
        er = K.m_ellipse(48 + F["ear_x"], F["ear_y"], 3.0, 5.2)
        ears = er | mirror(er)
        L.fill(ears, P["skin"])
        inr = K.m_line([(48 + F["ear_x"] + 0.4, F["ear_y"] - 2), (48 + F["ear_x"] + 0.4, F["ear_y"] + 1.5)])
        L.fill(inr | mirror(inr), P["skin_sh"])
    L.fill(head, P["skin"])
    # light from upper-left: rim shadow down the right cheek
    L.fill(rim(head, 3, 1) & (XX > 55) & (YY > 30), P["skin_sh"])
    if cast is not None:
        L.fill(head & cast, P["skin_sh"])
    if E.get("shadow"):
        ey, b = F["eye_y"], F["eye_h"] / 2.0
        yb = ey + b + 3.5 - np.abs(XX - 48.0) * 0.10
        reg = (head | (L.opaque())) & (YY < yb)
        sh = L.is_col(P["skin_sh"]) & reg
        L.fill(reg, P["skin_sh"], only=P["skin"])
        L.fill(sh, P["skin_dk"])
    if E.get("blush"):
        bl = K.m_ellipse(48 + F["eye_dx"] + 1.5, F["eye_y"] + F["eye_h"] / 2 + 3.6, 3.2, 1.4)
        L.fill(bl | mirror(bl), P["blush"], only=[P["skin"], P["skin_sh"]])
    # nose
    ny = F["nose_y"]
    L.fill(K.m_px((49, ny - 1), (49, ny), (50, ny)), P["skin_sh"])
    L.fill(K.m_px((48, ny + 1), (49, ny + 1)), P["line"])
    paint_mouth(L, P, F, E["mouth"])
    if pre_eyes:
        pre_eyes(L)
    eyes = E["eyes"]
    if isinstance(eyes, str):
        eyes = (eyes, eyes)
    for right, st in ((False, eyes[0]), (True, eyes[1])):
        if st is None:
            continue
        m = eye_masks(F, st)
        paint_eye(L, P, F, m, right, st)
    return head


def paint_brows(L, P, F, E, col=None):
    kind = E["brows"]
    if isinstance(kind, str):
        kind = (kind, kind)
    for right, k in ((False, kind[0]), (True, kind[1])):
        if k:
            L.fill(brow_mask(F, k, right), col or P["brow"])


# --------------------------------------------------------------------------- marks

def sweat_drop(L, P, x, y, big=True):
    if big:
        m = K.m_poly([(x, y - 4.2), (x + 2.6, y + 0.6), (x + 2.2, y + 2.6), (x, y + 3.6), (x - 2.2, y + 2.6), (x - 2.6, y + 0.6)])
    else:
        m = K.m_poly([(x, y - 2.6), (x + 1.8, y + 0.6), (x, y + 2.2), (x - 1.8, y + 0.6)])
    L.fill(grow(m), P["ink"])
    L.fill(m, P["sweat"])
    L.fill(K.m_px((x - 1, y + 0.4)) if big else K.m_px((x - 0.6, y)), WHITE)


def gloom_lines(L, P, x0, y0, lens=(9, 12, 8, 11, 6), gap=3):
    for i, n in enumerate(lens):
        L.fill(K.m_line([(x0 + i * gap, y0), (x0 + i * gap, y0 + n)]), P["gloom"])


def tear(L, P, x, y, n=5):
    m = K.m_rect(x, y, x + 2, y + n) | K.m_ellipse(x + 1, y + n, 1.6, 1.6)
    L.fill(m, P["sweat"])
    L.fill(K.m_px((x, y + 1), (x, y + 2)), WHITE)


def shock_marks(L, P, x, y, flip=False):
    s = -1 if flip else 1
    for dx0, dy0, dx1, dy1 in ((0, 0, -3, -4), (4, -1, 4, -6), (8, 1, 11, -3)):
        L.fill(K.m_line([(x + s * dx0, y + dy0), (x + s * dx1, y + dy1)]), P.get("spark", WHITE))


# --------------------------------------------------------------------------- shading helpers

def shade_mass(L, m, P, base, sh, hl=None, hl_mask=None, dx=2, dy=2, extra_sh=None):
    """Flat fill + rim shadow on the lower-right + optional hard highlight band."""
    L.fill(m, P[base])
    s = rim(m, dx, dy)
    if extra_sh is not None:
        s |= (extra_sh & m)
    L.fill(s, P[sh])
    if hl and hl_mask is not None:
        L.fill(hl_mask & m & ~s, P[hl])


def zigzag_band(x0, x1, y_at, thick, teeth=5, amp=2.0):
    """Hard-edged highlight band across hair: polygon between two zig-zag lines."""
    n = teeth * 2
    top, bot = [], []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        z = amp if i % 2 else -amp
        y = y_at(x)
        top.append((x, y + z * 0.5))
        bot.append((x, y + thick + z))
    return K.m_poly(top + bot[::-1])


def arc_y(cx, y_mid, y_edge, half):
    return lambda x: y_mid + (y_edge - y_mid) * min(1.0, abs(x - cx) / half) ** 2


def star(cx, cy, r, r2=None, rot=-90):
    r2 = r2 or r * 0.45
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r2
        t = math.radians(rot + i * 36)
        pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
    return K.m_poly(pts)


def neck_and(L, P, head, x0=42.5, x1=53.5, y0=58, y1=78):
    m = K.m_poly([(x0, y0), (x1, y0), (x1 + 1.0, y1), (x0 - 1.0, y1)])
    L.fill(m, P["skin"])
    L.fill(m & shift(head, 1, 5), P["skin_sh"])
    return m


# --------------------------------------------------------------------------- characters
# Each builder returns (layers dict, face cfg). `e` is the expression name.

BASE_FX = {"sweat": "#9fdcff", "gloom": "#5a62a8"}


def expr_table(**over):
    t = {
        "neutral": dict(eyes="open", brows="neutral", mouth="smile"),
        "happy": dict(eyes="happy", brows="up", mouth="laugh", blush=True, dy=-1),
        "shock": dict(eyes="wide", brows="high", mouth="gasp", marks="shock"),
        "defeat": dict(eyes="shut", brows="sad", mouth="wavy", marks="defeat", dy=2),
        "fierce": dict(eyes="fierce", brows="angry", mouth="grit", shadow=True, dy=1),
    }
    for k, v in over.items():
        t[k] = dict(t[k], **v)
    return t


def new_layers():
    return {n: Layer(n) for n in LAYERS}


def finish(Ls, P, E, outline=("hair_back", "body", "face", "hair")):
    for n in outline:
        Ls[n].outline(P["ink"])
    dy = E.get("dy", 0)
    dx = E.get("dx", 0)
    if dy or dx:
        for n in ("face", "hair", "fx"):
            Ls[n].nudge(dx, dy)
        if E.get("back_moves", True):
            Ls["hair_back"].nudge(dx, dy)


def common_marks(Ls, P, E, sweat=(70, 30), gloom=(58, 10), shock=(70, 12)):
    fx = Ls["fx"]
    k = E.get("marks")
    if k == "defeat":
        gloom_lines(fx, P, *gloom)
        sweat_drop(fx, P, *sweat)
    elif k == "sweat":
        sweat_drop(fx, P, *sweat)
    elif k == "shock":
        shock_marks(fx, P, *shock)
        sweat_drop(fx, P, sweat[0], sweat[1] + 6, big=False)


# ---- 1. Rin -----------------------------------------------------------------

def build_rin(e):
    P = dict(BASE_FX, ink="#3a1420", line="#9a4030",
             skin="#ffd8b0", skin_sh="#eca078", skin_dk="#b86a5a", blush="#ff9c8c",
             hair="#f05a1e", hair_sh="#b42c1c", hair_hl="#ffa63c", brow="#7a1c14",
             iris="#7a3c1c", iris_lt="#d08a3c", mouth="#7a1c2c", tongue="#f07070",
             band="#f6f8ff", band_sh="#b8c4e0",
             jacket="#dc2a34", jacket_sh="#961a2c", shirt="#f6f8ff", shirt_sh="#b8c4e0", gold="#ffd040")
    F = face_cfg(eye_w=9.0, eye_h=10.0, eye_tilt=0.5, flick=False, brow_t=2.2, brow_y=36.0, lash=0.6)
    E = expr_table(
        neutral=dict(mouth="grin", brows="cocky"),
        happy=dict(eyes="happy", mouth="laugh"),
        defeat=dict(eyes="scrunch", mouth="wavy"),
        fierce=dict(mouth="battle"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    # hair: one spiky mass, headband over it, fringe over the band
    mass = K.m_poly([
        (27.5, 47), (25, 39), (18.5, 41), (23.5, 32), (13.5, 29), (22.5, 23.5), (15, 13), (26.5, 15.5),
        (25.5, 3.5), (35, 10), (40.5, 0.5), (46.5, 8), (55.5, -0.5), (58, 9), (69, 2.5), (68, 13),
        (80.5, 9.5), (73, 20), (83, 24.5), (74, 28.5), (80, 37.5), (71.5, 37), (69.5, 47),
        (67.5, 40), (66.5, 30), (48, 26), (29.5, 30), (28.5, 40)])
    fringe = K.empty()
    for x0, x1, tx, ty in ((31, 37.5, 33.5, 37.5), (42.5, 53.5, 48.5, 41.5), (58, 64.5, 61.5, 37.5)):
        fringe |= K.m_poly([(x0, 22), (x1, 22), (tx, ty)])
    band = K.m_poly([(26.5, 26.5), (37, 28.6), (48, 29.2), (59, 28.6), (69.5, 26.5), (69.8, 31.5), (59, 33.8), (48, 34.4), (37, 33.8), (26.2, 31.5)])
    allhair = mass | fringe
    cast = shift(fringe | band, 0, 2) & ~(fringe | band)

    head = paint_face(face, P, F, E, cast=cast)

    shade_mass(hair, mass, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(20, 76, arc_y(48, 11.5, 18, 28), 3.2, teeth=6, amp=2.2), dx=2, dy=2)
    hair.fill(band, P["band"])
    hair.fill(band & (YY > 31.6 + np.abs(XX - 48) * -0.09 + 1.2), P["band_sh"])
    hair.fill(grow(fringe) & band & ~fringe, P["band_sh"])
    hair.fill(fringe, P["hair"])
    hair.fill(rim(fringe, 2, 0) & (YY > 25), P["hair_sh"])

    # headband tails, behind everything
    t1 = K.m_poly([(69, 28), (80, 31), (90, 27.5), (93, 33), (84, 37), (72, 33)])
    t2 = K.m_poly([(70, 31), (79, 38), (86, 47), (81, 49.5), (74, 42), (69, 34.5)])
    hb.fill(t1 | t2, P["band"])
    hb.fill(rim(t1, 1, 2) | rim(t2, 2, 1), P["band_sh"])

    # body
    neck_and(body, P, head)
    shirt = K.m_poly([(40, 72), (56, 72), (60, 100), (36, 100)])
    body.fill(shirt, P["shirt"])
    body.fill(K.m_curve([(42, 75), (48, 79), (54, 75)]), P["shirt_sh"])
    body.fill(shirt & (XX > 52.5) & (YY > 78), P["shirt_sh"])
    jl = K.m_poly([(37, 74), (12, 81), (5, 100), (43.5, 100), (41, 76)])
    jr = mirror(jl)
    for m in (jl, jr):
        body.fill(m, P["jacket"])
    body.fill(rim(jl, 2, 0) | rim(jr, 3, 0) | (jr & (YY > 110 - XX * 0.25)), P["jacket_sh"])
    body.fill(K.m_line([(43, 80), (42.5, 99)]) | K.m_line([(52.6, 80), (53, 99)]), P["ink"])
    body.fill(K.m_line([(41.4, 82), (41, 99)]) | K.m_line([(54.4, 82), (55, 99)]), P["gold"])
    # popped collar
    cl = K.m_poly([(31.5, 60.5), (39.5, 67), (44.5, 79), (36, 83.5), (27.5, 73)])
    cr = mirror(cl)
    body.fill(grow(cl | cr), P["ink"])
    body.fill(cl | cr, P["jacket"])
    body.fill(rim(cl, 2, 2) | rim(cr, 2, 2), P["jacket_sh"])
    body.fill(K.m_line([(31.5, 62), (29, 72.5)]) | K.m_line([(64, 62), (66.5, 72.5)]), P["hair_hl"], only=P["jacket"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(72, 31), gloom=(56, 11))
    finish(Ls, P, E)
    return Ls, P, F, E


def cap_hair(cx, cy, rx, ry, ymax, window):
    return K.m_ellipse(cx, cy, rx, ry) & (YY < ymax) & ~K.m_poly(window)


def both(m):
    return m | mirror(m)


# ---- 2. Mako ----------------------------------------------------------------

def build_mako(e):
    P = dict(BASE_FX, ink="#141c48", line="#a04858",
             skin="#ffe4cc", skin_sh="#f0ac98", skin_dk="#a87494", blush="#ff9cac",
             hair="#3f7cf0", hair_sh="#2848b0", hair_hl="#94d4ff", brow="#1c2c80",
             iris="#5a2cb8", iris_lt="#b890f8", mouth="#6a1c3c", tongue="#f07080",
             star="#ffd838", star_sh="#d88a18",
             coat="#f4f6fc", coat_sh="#b4c0dc", teal="#1cb4a8", teal_sh="#0e6c78")
    F = face_cfg(eye_w=9.5, eye_h=11.0, eye_tilt=0.9, brow_t=1.4, brow_y=35.5)
    E = expr_table(
        neutral=dict(mouth="line", brows="stern"),
        happy=dict(eyes="happy", mouth="smirk", brows="cocky", dy=-1),
        shock=dict(mouth="o"),
        defeat=dict(eyes="line", mouth="frown"),
        fierce=dict(mouth="grit"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    tail = K.m_blob([(28, 17), (18, 11), (8, 15), (2, 28), (0.5, 46), (4, 63), (2, 80), (7, 97),
                     (14, 84), (15.5, 66), (13, 48), (15, 35), (21, 28), (29, 25)])
    back = K.m_ellipse(48, 35, 22, 22)
    bm = both(tail) | back
    shade_mass(hb, bm, P, "hair", "hair_sh", dx=3, dy=1)
    hlt = K.m_blob([(10, 22), (5.5, 34), (4, 46), (6.5, 46), (8, 34), (12, 24)])
    hb.fill(both(hlt) & bm, P["hair_hl"], only=P["hair"])
    hb.fill(both(K.m_curve([(20, 20), (11, 30), (9, 48), (11, 66), (9, 82)])), P["hair_sh"], only=P["hair"])

    window = [(31.5, 62), (31.5, 41), (34, 35.5), (37, 41), (41, 33.5), (44.5, 41.5), (48, 35), (51.5, 41.5),
              (55, 33.5), (59, 41), (62, 35.5), (64.5, 41), (64.5, 62)]
    cap = cap_hair(48, 32, 22.6, 21, 46, window)
    lock = K.m_poly([(25.6, 30), (32, 32), (32, 50), (30.4, 65), (27.8, 56), (25.2, 44)])
    front = cap | both(lock)
    cast = shift(front, 0, 2) & ~front
    head = paint_face(face, P, F, E, cast=cast)
    shade_mass(hair, front, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(27, 69, arc_y(48, 17.5, 23, 22), 3.0, teeth=6, amp=1.8), dx=2, dy=1)
    hair.fill(front & shift(K.m_poly(window), 0, -2) & (YY > 30), P["hair_sh"], only=P["hair"])
    for x0, y0, x1, y1 in ((41, 33.5, 39.5, 24), (55, 33.5, 56.5, 24), (48, 35, 48, 25)):
        hair.fill(K.m_line([(x0, y0), (x1, y1)]), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    for sx in (25.5, 70.5):
        st = star(sx, 20.5, 5.4, 2.5)
        hair.fill(grow(st), P["ink"])
        hair.fill(st, P["star"])
        hair.fill(rim(st, 1, 1), P["star_sh"])

    neck_and(body, P, head)
    jl = K.m_poly([(38, 73), (19, 79.5), (11, 100), (48, 100), (48, 76)])
    body.fill(both(jl), P["coat"])
    body.fill(rim(both(jl), 2, 0) | (both(jl) & (YY > 93 - (XX - 48) * 0.5) & (XX > 48)), P["coat_sh"])
    stripe = K.m_poly([(20, 80), (24, 79), (17, 100), (12, 100)])
    body.fill(both(stripe), P["teal"])
    body.fill(K.m_line([(48, 78), (48, 99)]), P["ink"])
    col = K.m_poly([(37.5, 65), (45.5, 71), (47.5, 83.5), (39.5, 80.5), (34.5, 72)])
    body.fill(grow(both(col)), P["ink"])
    body.fill(both(col), P["teal"])
    body.fill(rim(col, 2, 2) | rim(mirror(col), 2, 2), P["teal_sh"])
    body.fill(K.m_px((48, 84), (48, 85)), P["star"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(68, 30), gloom=(54, 12), shock=(62, 9))
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 3. Jiro ----------------------------------------------------------------

def build_jiro(e):
    P = dict(BASE_FX, ink="#10281c", line="#8a4430",
             skin="#f8d2a8", skin_sh="#dc9c74", skin_dk="#9c6660", blush="#f8a088",
             hair="#3cb454", hair_sh="#1c7438", hair_hl="#a0ec78", brow="#145028",
             iris="#3c2c1c", iris_lt="#8a6a3c", mouth="#6a2028", tongue="#e87070",
             lens="#ffb048", lens_sh="#e08428", lens_w="#ffe8a8",
             jacket="#32344e", jacket_sh="#1c1c2e", jacket_hl="#5c6088", gold="#f0c040", pick="#f0e0b0")
    F = face_cfg(eye_w=9.0, eye_h=9.0, eye_tilt=-0.1, eye_drop=0.06, flick=False, brow_t=1.8, brow_y=36.5,
                 eye_y=46.0, big_hl=False)
    E = expr_table(
        neutral=dict(eyes="half", mouth="smirk", brows="neutral"),
        happy=dict(eyes="happy", mouth="grin", blush=False),
        shock=dict(mouth="small_o"),
        defeat=dict(eyes="line", mouth="frown"),
        fierce=dict(mouth="battle"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    window = [(30.5, 62), (30.5, 37), (33, 30), (48, 27), (63, 30), (65.5, 37), (65.5, 62)]
    side = cap_hair(48, 33, 21.8, 20.5, 45, window)
    pomp = K.m_blob([(30, 30.5), (25.5, 22), (25, 12), (31, 5), (43, 1), (57, 0.5), (69, 4), (76, 11), (76, 20),
                     (72, 27), (64, 26.5), (55, 29.5), (46, 27.5), (38, 30.5)], 12)
    pomp |= K.m_poly([(68, 6), (79, 12), (87, 25), (79, 22), (75, 30), (70, 22)])
    pomp |= K.m_poly([(27, 14), (20.5, 21), (26.5, 24)])
    cast = shift(pomp | side, 0, 2) & ~(pomp | side)
    head = paint_face(face, P, F, E, cast=cast)
    hair.fill(side, P["hair_sh"])
    hair.fill(grow(pomp) & side, P["ink"])
    shade_mass(hair, pomp, P, "hair", "hair_sh", "hair_hl",
               K.m_blob([(29, 12), (35, 5.5), (48, 3), (62, 4.5), (72, 9.5), (62, 8.5), (48, 7.5), (37, 9.5)]), dx=2, dy=3)
    for pts in ([(28, 22), (36, 13), (52, 10.5), (68, 12), (80, 17), (85, 23)],
                [(32, 28), (40, 19.5), (54, 17), (67, 18.5), (77, 22)],
                [(44, 27), (52, 23), (62, 22.5), (70, 24)]):
        hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])

    neck_and(body, P, head)
    jl = K.m_poly([(38, 72), (13, 79), (5, 100), (48, 100), (48, 74)])
    body.fill(both(jl), P["jacket"])
    body.fill(rim(both(jl), 2, 0) | (both(jl) & (XX > 48) & (YY > 108 - XX * 0.3)), P["jacket_sh"])
    body.fill(K.m_line([(14, 80), (30, 75.5)]) | K.m_line([(81, 80), (65, 75.5)]), P["jacket_hl"])
    col = K.m_poly([(37.5, 63.5), (47.4, 68), (47.4, 81), (36.5, 77.5)])
    body.fill(grow(both(col)), P["ink"])
    body.fill(both(col), P["jacket"])
    body.fill(both(K.m_line([(38, 64.5), (46.5, 68.4)])), WHITE)
    body.fill(both(K.m_line([(38, 65.5), (46.5, 69.4)])), P["jacket_hl"])
    body.fill(K.m_line([(48, 68), (48, 99)]), P["ink"])
    for by in (85, 93):
        body.fill(K.m_rect(49.2, by, 51.8, by + 2.6), P["gold"])

    # shades: tint whatever the face shows through two round lenses
    ex, ey = F["eye_dx"], F["eye_y"]
    lens = K.m_ellipse(48 + ex, ey + 0.4, 6.7, 6.7)
    lens = both(lens)
    for src, dst in (("skin", "lens"), ("skin_sh", "lens_sh"), ("skin_dk", "lens_sh"), ("blush", "lens_sh")):
        fx.fill(lens & face.is_col(P[src]), P[dst])
    fx.fill(lens & face.is_col(WHITE), P["lens_w"])
    for c in (P["ink"], P["iris"], P["iris_lt"], P["line"]):
        fx.fill(lens & face.is_col(c), c)
    fx.fill(lens & ~fx.opaque(), P["lens"])
    fx.fill(grow(lens) & ~lens, P["ink"])
    fx.fill(K.m_line([(48 - ex + 7, ey - 1), (48 + ex - 7, ey - 1)]), P["ink"])
    fx.fill(both(K.m_line([(48 + ex + 7, ey - 1), (68.5, ey - 2)])), P["ink"])
    fx.fill(both(K.m_line([(48 + ex - 4.4, ey - 3.6), (48 + ex - 2.4, ey - 5.2)])), P["lens_w"])
    paint_brows(fx, P, F, E)
    # toothpick
    if e == "shock":
        fx.fill(K.m_line([(56, 67), (62, 73)]), P["pick"])
        fx.fill(K.m_line([(57, 67), (63, 73)]), P["ink"])
    elif e == "defeat":
        fx.fill(K.m_line([(51, 62), (58, 68)]), P["pick"])
    elif e == "fierce":
        fx.fill(K.m_line([(55, 59), (64, 55)]), P["pick"])
    else:
        fx.fill(K.m_line([(52, 61), (62, 64)]), P["pick"])
    common_marks(Ls, P, E, sweat=(70, 34), gloom=(20, 30), shock=(16, 22))
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 4. Aya -----------------------------------------------------------------

def build_aya(e):
    P = dict(BASE_FX, ink="#201038", line="#a04c60",
             skin="#ffeada", skin_sh="#ecb4ac", skin_dk="#9c6c9c", blush="#ff9cb0",
             hair="#7c3cc4", hair_sh="#4a2288", hair_hl="#c084f4", brow="#2c1454",
             iris="#d48c10", iris_lt="#ffe660", mouth="#6a1c44", tongue="#e8708c",
             dress="#302860", dress_sh="#1c173a", gold="#f0c448", gem="#48e0d0")
    F = face_cfg(eye_w=9.5, eye_h=9.5, eye_tilt=0.5, eye_drop=0.08, brow_t=1.3, brow_y=36.0)
    E = expr_table(
        neutral=dict(mouth="smile", brows="soft"),
        happy=dict(eyes="happy", mouth="open", brows="soft", dy=0),
        shock=dict(mouth="o"),
        defeat=dict(eyes="shut", mouth="frown"),
        fierce=dict(mouth="battle"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    curtain = K.m_poly([(26, 20), (21, 40), (18, 62), (13.5, 102), (82.5, 102), (78, 62), (75, 40), (70, 20), (48, 11)])
    shade_mass(hb, curtain, P, "hair", "hair_sh", dx=3, dy=0)
    hb.fill(curtain & (XX > 31) & (XX < 65) & (YY > 40), P["hair_sh"])
    for x in (20, 24.5, 71.5, 76):
        hb.fill(K.m_line([(x, 52), (x - 2 if x < 48 else x + 2, 99)]), P["hair_sh"], only=P["hair"])

    cap = K.m_ellipse(48, 32, 22.6, 21.6)
    fr = cap & (YY < 39.5 - np.abs(XX - 48) * 0.02)
    lock = K.m_poly([(25.6, 28), (33, 28), (33, 62), (26.4, 62)])
    front = fr | both(lock)
    cast = shift(front, 0, 2) & ~front
    head = paint_face(face, P, F, E, cast=cast)
    face.fill(K.m_px((60, 54)), P["ink"])
    shade_mass(hair, front, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(28, 68, arc_y(48, 19, 25, 21), 3.0, teeth=7, amp=1.4), dx=2, dy=0)
    for x in range(35, 62, 4):
        hair.fill(K.m_line([(x, 39), (x, 33 + (x % 3))]), P["hair_sh"], only=P["hair"])
    hair.fill(both(K.m_line([(33, 39), (33, 61)])), P["ink"])
    moon = K.m_ellipse(35, 21, 3.6, 3.6) & ~K.m_ellipse(36.8, 20, 3.2, 3.2)
    hair.fill(grow(moon), P["ink"])
    hair.fill(moon, P["gold"])

    sh = K.m_poly([(41, 71), (24, 79), (15, 100), (81, 100), (72, 79), (55, 71)])
    body.fill(sh, P["skin"])
    body.fill(rim(sh, 3, 0), P["skin_sh"])
    neck_and(body, P, head)
    body.fill(K.m_curve([(39, 80), (44, 82.5), (47, 82)]) | K.m_curve([(57, 80), (52, 82.5), (49, 82)]), P["skin_sh"])
    dr = K.m_poly([(19, 89), (33, 86), (48, 92), (63, 86), (77, 89), (86, 100), (10, 100)])
    body.fill(grow(dr), P["ink"])
    body.fill(dr, P["dress"])
    body.fill(dr & (XX > 52) & (YY > 94), P["dress_sh"])
    body.fill(K.m_line([(19, 89), (33, 86), (48, 92), (63, 86), (77, 89)]), P["gold"])
    body.fill(K.m_rect(41.5, 68, 54.5, 71), P["ink"])
    body.fill(K.m_px((47, 71), (48, 71), (47, 72), (48, 72)), P["gem"])
    body.fill(K.m_px((47, 71)), WHITE)

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(69, 31), gloom=(53, 13), shock=(62, 8))
    if e == "defeat":
        tear(face, P, 60, 52, 4)
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 5. Pochi ---------------------------------------------------------------

def build_pochi(e):
    P = dict(BASE_FX, ink="#40200c", line="#a8503c",
             skin="#ffdec4", skin_sh="#f2aa8c", skin_dk="#b07478", blush="#ff9a90",
             hair="#f48c28", hair_sh="#bc5a18", hair_hl="#ffca64", brow="#8a3c10",
             iris="#1c8c48", iris_lt="#84f08c", mouth="#7a1c2c", tongue="#f07878",
             visor="#2cc068", visor_sh="#147c44", visor_hl="#a4f8b4",
             vest="#3a3654", shirt="#f6f8ff", shirt_sh="#bcc4e0",
             bow="#d42c44")
    F = face_cfg(skull=(48.0, 38.5, 20.0, 23.0),
                 jaw=[(68, 38), (67.6, 51), (63.5, 59.5), (56, 65.5), (51, 67.5)],
                 eye_w=10.5, eye_h=12.0, eye_tilt=-0.2, eye_dx=9.6, eye_y=47.0, brow_t=1.4, brow_y=36.5,
                 mouth_w=0.9, mouth_y=61.5, nose_y=56.0)
    E = expr_table(
        happy=dict(eyes="happy", mouth="laugh"),
        defeat=dict(eyes="teary", mouth="wavy", brows="sad"),
        fierce=dict(mouth="grit", brows="angry"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    bob = K.m_blob([(48, 8.5), (63, 11), (72.5, 21), (76, 36), (75.5, 52), (71, 62.5), (62, 64.5),
                    (34, 64.5), (25, 62.5), (20.5, 52), (20, 36), (23.5, 21), (33, 11)])
    shade_mass(hb, bob, P, "hair", "hair_sh", dx=3, dy=1)
    hb.fill(bob & (XX > 30) & (XX < 66) & (YY > 44), P["hair_sh"])

    window = [(31, 64), (31, 41), (34, 37), (38, 41.5), (43, 36), (47.5, 41.5), (53, 36.5), (58, 41.5),
              (62, 37), (65, 41), (65, 64)]
    cap = cap_hair(48, 31.5, 23.2, 21.5, 45, window)
    lock = K.m_poly([(24.6, 32), (31.5, 34), (31.5, 52), (34.6, 60.5), (28, 64.5), (22.5, 54)])
    front = cap | both(lock)
    band = K.m_poly([(24.6, 21.5), (36, 19), (48, 18.2), (60, 19), (71.4, 21.5), (72, 25.5), (48, 22), (24, 25.5)])
    bill = K.m_poly([(20, 26), (33, 22.8), (48, 21.8), (63, 22.8), (76, 26), (72, 31), (60, 33.4), (48, 34.2), (36, 33.4), (24, 31)])
    cast = shift(front | bill, 0, 2) & ~front
    head = paint_face(face, P, F, E, cast=cast)
    for dx_, dy_ in ((-13, 54), (-10.5, 55.5), (-15.5, 56)):
        face.fill(K.m_px((48 + dx_, dy_), (47 - dx_, dy_)), P["line"])
    shade_mass(hair, front, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(28, 68, arc_y(48, 12, 17, 22), 2.6, teeth=5, amp=1.4), dx=2, dy=1)
    hair.fill(front & shift(K.m_poly(window), 0, -2) & (YY > 33), P["hair_sh"], only=P["hair"])
    hair.fill(grow(band | bill), P["ink"])
    hair.fill(band, P["visor_sh"])
    hair.fill(bill, P["visor"])
    hair.fill(bill & ~shift(bill, 0, -1), P["visor_sh"])
    hair.fill(K.m_poly([(28, 26.5), (40, 24.4), (41.5, 26.2), (30, 28.4)]) | K.m_poly([(44, 24), (47, 23.8), (47.6, 25.6), (45, 25.8)]), P["visor_hl"])

    neck_and(body, P, head, 43.0, 53.0)
    sh = K.m_poly([(39, 72), (23, 79), (16, 100), (80, 100), (73, 79), (57, 72)])
    body.fill(sh, P["shirt"])
    body.fill(rim(sh, 3, 0), P["shirt_sh"])
    vl = K.m_poly([(37, 76), (27, 80), (22, 100), (45.5, 100), (47.5, 85)])
    body.fill(grow(both(vl)), P["ink"])
    body.fill(both(vl), P["vest"])
    cl = K.m_poly([(39.5, 67.5), (47.5, 74.5), (41, 80), (35.5, 72)])
    body.fill(grow(both(cl)), P["ink"])
    body.fill(both(cl), P["shirt"])
    wing = K.m_poly([(47.5, 75), (40, 70.5), (40, 80.5)])
    body.fill(grow(both(wing)), P["ink"])
    body.fill(both(wing), P["bow"])
    body.fill(both(wing) & (YY > 77.5), P["line"])
    knot = K.m_rect(46, 73, 50, 78)
    body.fill(grow(knot), P["ink"])
    body.fill(knot, P["bow"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(72, 38), gloom=(54, 4), shock=(64, 6))
    if e == "defeat":
        tear(face, P, 34, 54, 5)
        tear(face, P, 60, 54, 5)
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 6. Goro ----------------------------------------------------------------

def build_goro(e):
    P = dict(BASE_FX, ink="#2c1c10", line="#7c3c28",
             skin="#eeb27e", skin_sh="#c67e52", skin_dk="#7c4c44", blush="#e8846c",
             hair="#fad44c", hair_sh="#c48c20", hair_hl="#fff8b0", brow="#5a3410",
             iris="#2c4868", iris_lt="#8cb8d8", mouth="#6a1c20", tongue="#e06868", scar="#a04434",
             leather="#3e3848", leather_sh="#231f2b", leather_hl="#6a647c",
             stud="#dce0ec", tank="#f2eee4", tank_sh="#b8b0a8")
    F = face_cfg(skull=(48.0, 38.0, 21.4, 22.5),
                 jaw=[(69.4, 38), (69.4, 53), (66, 62.5), (58.5, 69), (50, 70)],
                 ear_x=21.8, ear_y=47.5,
                 eye_w=8.6, eye_h=6.6, eye_dx=9.6, eye_y=45.5, eye_tilt=0.5, iris=0.85, flick=False,
                 big_hl=False, brow_t=3.0, brow_y=38.6, nose_y=55.0, mouth_y=62.5, mouth_w=1.3, lash=0.5)
    E = expr_table(
        neutral=dict(brows="stern", mouth="frown"),
        happy=dict(eyes="happy", mouth="laugh", blush=False),
        defeat=dict(eyes="shut", mouth="wavy"),
        fierce=dict(mouth="snarl"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    window = [(28.6, 62), (28.6, 35), (32, 28), (64, 28), (67.4, 35), (67.4, 62)]
    side = cap_hair(48, 34, 23.4, 20.5, 44, window)
    pomp = K.m_blob([(27, 30), (20.5, 20), (24, 7.5), (37, 0.5), (59, 0.5), (72, 6.5), (77, 19), (72, 30.5),
                     (62, 27.5), (48, 29.5), (34, 27.5)], 12)
    cast = shift(pomp | side, 0, 3) & ~(pomp | side)
    head = paint_face(face, P, F, E, cast=cast)
    face.fill(K.m_line([(58, 50), (64, 59)]), P["scar"])
    face.fill(K.m_px((59, 54), (63, 54), (60, 57), (64, 56)), P["scar"])
    # jaw shade and chin dimple
    hair.fill(side, P["hair_sh"])
    hair.fill(grow(pomp) & side, P["ink"])
    shade_mass(hair, pomp, P, "hair", "hair_sh", "hair_hl",
               K.m_blob([(27, 15), (33, 6.5), (46, 3.5), (60, 5), (68, 10.5), (58, 9), (46, 8), (35, 11)]), dx=2, dy=4)
    hair.fill(K.m_curve([(26, 22), (36, 17.5), (50, 16.5), (64, 18.5), (73, 23)]), P["hair_sh"], only=P["hair"])
    hair.fill(K.m_curve([(40, 27), (44, 22), (52, 21), (58, 22.5)]), P["hair_sh"], only=P["hair"])

    neck_and(body, P, head, 38.5, 57.5, 60, 80)
    tank = K.m_poly([(36, 76), (60, 76), (66, 100), (30, 100)])
    body.fill(tank, P["tank"])
    body.fill(K.m_curve([(39, 78), (48, 83), (57, 78)]), P["tank_sh"])
    body.fill(tank & (XX > 54) & (YY > 82), P["tank_sh"])
    jl = K.m_poly([(37, 72), (8, 75), (-6, 100), (39.5, 100), (40, 79)])
    body.fill(both(jl), P["leather"])
    body.fill(rim(both(jl), 3, 0) | (mirror(jl) & (YY > 86)), P["leather_sh"])
    body.fill(K.m_line([(9, 76), (30, 73.6)]) | K.m_line([(86, 76), (65, 73.6)]), P["leather_hl"])
    cl = K.m_poly([(25.5, 58.5), (37.5, 66.5), (43.5, 83), (31.5, 88), (19.5, 73)])
    body.fill(grow(both(cl)), P["ink"])
    body.fill(both(cl), P["leather"])
    body.fill(rim(cl, 2, 2) | rim(mirror(cl), 2, 2), P["leather_sh"])
    body.fill(both(K.m_line([(26, 60), (36.5, 67)])), P["leather_hl"])
    for sx, sy in ((23.5, 68.5), (26, 75), (29.5, 81)):
        st = K.m_rect(sx, sy, sx + 2, sy + 2)
        body.fill(both(st), P["stud"])
        body.fill(both(K.m_px((sx + 1, sy + 1))), P["leather_hl"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(73, 36), gloom=(56, 6), shock=(10, 30))
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 7. Yuki ----------------------------------------------------------------

def build_yuki(e):
    P = dict(BASE_FX, ink="#2a3058", line="#a05870",
             skin="#fff2ea", skin_sh="#e8c0cc", skin_dk="#9686b8", blush="#ffb0c0",
             hair="#eef0fc", hair_sh="#a8b4dc", brow="#7480b4",
             iris="#3080d0", iris_lt="#b4e8ff", mouth="#7a2848", tongue="#e87898", lip="#d85c84",
             kimono="#f6f6fc", indigo="#2e3c94", indigo_sh="#1a2262",
             red="#dc3050", red_sh="#941a3a", gold="#f0c850")
    F = face_cfg(eye_w=9.5, eye_h=9.5, eye_tilt=0.9, eye_drop=0.06, brow_t=1.3, brow_y=35.5)
    E = expr_table(
        neutral=dict(eyes="half", mouth="line", brows="neutral"),
        happy=dict(eyes="smug", mouth="open", brows="up", dy=-2),
        shock=dict(mouth="small_o"),
        defeat=dict(eyes="line", mouth="frown"),
        fierce=dict(mouth="grit"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    bun = K.m_ellipse(61, 8.5, 10, 8.2)
    back = K.m_ellipse(48, 35, 21.6, 22)
    shade_mass(hb, bun | back, P, "hair", "hair_sh", dx=3, dy=2)
    hb.fill(K.m_curve([(54, 9), (60, 5.5), (67, 8)]) | K.m_curve([(55, 13), (61, 10), (68, 12.5)]), P["hair_sh"], only=P["hair"])

    window = [(31.5, 64), (31.5, 43), (35, 37), (41, 31.5), (47.6, 26.5), (54, 31.5), (60, 37), (64.5, 43), (64.5, 64)]
    cap = cap_hair(48, 32, 22.6, 21, 45, window)
    lock = K.m_poly([(25.4, 30), (31.6, 34), (32.4, 56), (30.4, 78), (27.6, 94), (25, 78), (24.4, 56)])
    front = cap | both(lock)
    cast = shift(front, 0, 2) & ~front
    head = paint_face(face, P, F, E, cast=cast)
    face.fill(K.m_px((47, F["mouth_y"] + 2), (48, F["mouth_y"] + 2)), P["lip"], only=[P["skin"], P["skin_sh"]])
    shade_mass(hair, front, P, "hair", "hair_sh", dx=2, dy=1)
    hair.fill(front & shift(K.m_poly(window), 0, -2) & (YY > 27), P["hair_sh"], only=P["hair"])
    hair.fill(K.m_curve([(47.6, 26.5), (46, 20), (47, 13)]), P["hair_sh"], only=P["hair"])
    # camellia hair ornament with dangling beads
    for i in range(5):
        t = math.radians(-90 + i * 72)
        pet = K.m_ellipse(33.5 + 3.4 * math.cos(t), 15 + 3.4 * math.sin(t), 2.7, 2.7)
        hair.fill(grow(pet), P["ink"])
    for i in range(5):
        t = math.radians(-90 + i * 72)
        pet = K.m_ellipse(33.5 + 3.4 * math.cos(t), 15 + 3.4 * math.sin(t), 2.7, 2.7)
        hair.fill(pet, P["red"])
        hair.fill(rim(pet, 1, 1), P["red_sh"])
    hair.fill(K.m_rect(32.5, 14, 34.5, 16), P["gold"])
    for x, n in ((28, 9), (31, 12)):
        hair.fill(K.m_line([(x, 20), (x, 20 + n)]), P["gold"])
        hair.fill(K.m_rect(x - 0.5, 20 + n, x + 1.5, 22 + n), P["red"])

    neck_and(body, P, head, 43.0, 53.0)
    kim = K.m_poly([(40, 71), (21, 81), (13, 100), (83, 100), (75, 81), (56, 71)])
    body.fill(kim, P["indigo"])
    body.fill(rim(kim, 3, 0) | (kim & (XX > 60) & (YY > 90)), P["indigo_sh"])
    vskin = K.m_poly([(42.5, 70), (53.5, 70), (49.5, 85)])
    body.fill(vskin, P["skin"])
    body.fill(vskin & (YY < 75), P["skin_sh"])
    rb = K.m_poly([(60, 68.5), (54, 66.5), (45.5, 84), (50, 89.5)])
    lb = K.m_poly([(36, 68.5), (42, 66.5), (57.5, 97), (52, 101)])
    for bnd in (rb, lb):
        body.fill(grow(bnd), P["ink"])
        body.fill(bnd, P["kimono"])
    body.fill(K.m_line([(42.6, 68.5), (57.2, 97.5)]) | K.m_line([(53.6, 68.5), (47, 82)]), P["red"])
    body.fill(K.m_line([(22, 82), (38, 73)]) | K.m_line([(74, 82), (58, 73)]), P["hair_sh"], only=P["indigo"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(69, 32), gloom=(40, 14), shock=(66, 20))
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 8. Zeno ----------------------------------------------------------------

def build_zeno(e):
    P = dict(BASE_FX, ink="#0c2c38", line="#8c4840",
             skin="#f8dec4", skin_sh="#dcaa8c", skin_dk="#8c7090", blush="#f8a090",
             hair="#1cbcac", hair_sh="#0c7880", hair_hl="#90f8e0", brow="#0c5460",
             iris="#a0288c", iris_lt="#f080d8", mouth="#6a1c30", tongue="#e87080",
             lens="#d4f4fc", lens_sh="#8cc8e0",
             coat="#f2f4fa", coat_sh="#b4bcd4", shirt="#6c4cac", shirt_sh="#40286c", tie="#f0c030")
    F = face_cfg(skull=(48.0, 37.0, 19.0, 23.0),
                 jaw=[(67, 37), (66, 50), (61, 59), (54, 66), (50.5, 68.5)],
                 eye_w=8.0, eye_h=8.6, eye_tilt=0.0, iris=0.62, flick=False, big_hl=False,
                 brow_t=1.5, brow_y=34.0, mouth_w=1.25, mouth_y=61.5, eye_dx=9.4)
    E = expr_table(
        neutral=dict(mouth="grin", brows=("neutral", "up")),
        happy=dict(eyes=(None, None), mouth="laugh", blush=False, brows="cocky"),
        defeat=dict(eyes="shut", mouth="wavy"),
        fierce=dict(mouth="snarl"),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)

    mass = K.m_poly([
        (29.5, 47), (24, 41), (12.5, 46), (19, 36), (5, 34), (17, 28), (4, 19.5), (18, 20), (11.5, 7.5),
        (24, 13), (27, 1.5), (34, 11), (42, 4), (47, 12.5), (55, 3), (61, 11), (70, 1.5), (72, 13),
        (85, 8), (78, 20), (92, 20.5), (79, 28), (91, 35), (77, 36), (83.5, 46), (72, 41), (66.5, 47),
        (67, 36), (63.5, 26.5), (56, 21.5), (48, 24), (40, 21.5), (32.5, 26.5), (29, 36)])
    cast = shift(mass, 0, 2) & ~mass
    head = paint_face(face, P, F, E, cast=cast)
    shade_mass(hair, mass, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(16, 80, arc_y(48, 13.5, 22, 34), 3.0, teeth=8, amp=2.4), dx=2, dy=2)
    ah = K.m_stroke([(49, 13), (52, 5), (58, 0), (63, 2)], 1.8, True)
    hair.fill(ah, P["hair"])

    neck_and(body, P, head, 43.5, 52.5)
    sv = K.m_poly([(41, 71), (55, 71), (53, 100), (43, 100)])
    body.fill(sv, P["shirt"])
    body.fill(sv & (XX > 50), P["shirt_sh"])
    tie = K.m_poly([(46.4, 75), (49.6, 75), (51, 96), (48, 100), (45, 96)])
    body.fill(grow(tie), P["ink"])
    body.fill(tie, P["tie"])
    for y in (80, 86, 92):
        body.fill(K.m_line([(45, y + 2), (51, y)]), P["ink"], only=P["tie"])
    cl = K.m_poly([(38, 73), (19, 80), (12, 100), (44, 100), (41.5, 78)])
    cr = K.m_poly([(58, 71), (76, 77), (85, 100), (52, 100), (54.5, 76)])
    body.fill(cl | cr, P["coat"])
    body.fill(rim(cl | cr, 3, 0) | (cr & (YY > 90)), P["coat_sh"])
    ll = K.m_poly([(39, 68.5), (45.5, 84), (40.5, 97), (31, 79)])
    lr = K.m_poly([(57, 66.5), (50.5, 82), (55.5, 95), (65, 77)])
    body.fill(grow(ll | lr), P["ink"])
    body.fill(ll | lr, P["coat"])
    body.fill(rim(ll, 2, 1) | rim(lr, 2, 1), P["coat_sh"])

    # round glasses
    ex, ey = F["eye_dx"], F["eye_y"]
    lens = both(K.m_ellipse(48 + ex, ey + 0.2, 7.0, 7.0))
    glare = (((XX + YY) % 14.0) < 3.2)
    if e == "happy":
        fx.fill(lens, P["lens"])
        fx.fill(lens & glare, WHITE)
        fx.fill(lens & rim(lens, 2, 2), P["lens_sh"])
    elif e == "fierce":
        fx.fill(both(K.m_line([(48 + ex - 5, ey - 1.5), (48 + ex - 2, ey - 5)])), WHITE)
    else:
        g = lens & (((XX + YY) % 14.0) < 2.2) & (face.is_col(P["skin"]) | face.is_col(P["skin_sh"]))
        fx.fill(g, P["lens"])
    fx.fill(grow(lens) & ~lens, P["ink"])
    fx.fill(K.m_line([(48 - ex + 7.4, ey - 1), (48 + ex - 7.4, ey - 1)]), P["ink"])
    fx.fill(both(K.m_line([(48 + ex + 7.4, ey - 1), (67.5, ey - 2)])), P["ink"])
    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(73, 44), gloom=(40, 26), shock=(45, 30))
    finish(Ls, P, E)
    return Ls, P, F, E


# ---- 9. Onyx ----------------------------------------------------------------

def build_onyx(e):
    P = dict(BASE_FX, ink="#120c1c", line="#84485c",
             skin="#f2e2dc", skin_sh="#cca8b4", skin_dk="#7c5e88", blush="#e89cac",
             hair="#343048", hair_sh="#1e1a2c", hair_hl="#7470a0", brow="#1e1a2c",
             streak="#f2f2fa", streak_sh="#b0b0d0",
             iris="#d41c30", iris_lt="#ff8878", mouth="#5a1028", tongue="#d86078",
             mask="#4a3478", mask_sh="#2c1e4c", gold="#f0c448",
             red="#cc1a3c", red_sh="#800e2a", cape="#2c2640", cape_sh="#18141f")
    F = face_cfg(jaw=[(67.5, 38), (66.6, 50), (61.5, 58.5), (54, 65.5), (50.2, 68.5)],
                 eye_w=9.6, eye_h=8.6, eye_tilt=1.0, eye_drop=0.08, brow_t=1.6, brow_y=36.5, big_hl=False)
    E = expr_table(
        neutral=dict(mouth="smirk", brows=("cocky", None)),
        happy=dict(eyes="smug", mouth="grin", brows=("cocky", None), blush=False, dy=-1),
        shock=dict(mouth="o", brows=("high", None)),
        defeat=dict(eyes="line", mouth="frown", brows=("sad", None)),
        fierce=dict(mouth="battle", brows=("angry", None)),
    )[e]
    Ls = new_layers()
    hb, body, face, hair, fx = (Ls[n] for n in LAYERS)
    E["back_moves"] = False

    # tall cape collar behind the head: dark outside, crimson lining facing us
    wing = K.m_poly([(34, 76), (29, 60), (20, 40), (8, 21), (5.5, 42), (8, 62), (13, 82), (26, 86)])
    wings = both(wing)
    hb.fill(wings, P["cape"])
    lin = K.shrink(K.shrink(wings)) | (wings & (YY > 70))
    hb.fill(lin, P["red"])
    hb.fill(lin & (np.abs(XX - 48) < 26 - (YY - 40) * 0.12), P["red_sh"])
    backhair = K.m_poly([(28, 34), (24.5, 48), (20, 61), (26.5, 57.5), (25, 67), (32, 60), (32, 40)])
    hb.fill(grow(both(backhair)), P["ink"])
    hb.fill(both(backhair), P["hair"])
    hb.fill(rim(both(backhair), 2, 1), P["hair_sh"])

    window = [(30, 62), (30, 39), (32.5, 32), (40, 27), (45, 28), (48, 32.5), (51, 28), (56, 27), (63.5, 32),
              (66, 39), (66, 62)]
    cap = cap_hair(48, 31.5, 22, 20.6, 43, window)
    cast = shift(cap, 0, 2) & ~cap
    mask = K.m_poly([(49.6, 39.5), (55, 36.6), (63, 35.4), (71.5, 32), (69, 47), (65, 55.5), (61, 61.5), (56.5, 54.5), (51, 49.5)])

    def pre(L):
        L.fill(mask, P["mask"])
        L.fill(rim(mask, 2, 1), P["mask_sh"])
        L.fill(mask & ~K.shrink(mask), P["gold"])
        d = K.m_poly([(60.6, 51.8), (63.6, 55.4), (60.6, 59.2), (57.6, 55.4)])
        L.fill(d, P["gold"])
        L.fill(K.shrink(d), P["streak"])
    head = paint_face(face, P, F, E, cast=cast, pre_eyes=pre)
    face.fill(mask & ~head & ~K.shrink(mask), P["gold"])
    shade_mass(hair, cap, P, "hair", "hair_sh", "hair_hl",
               zigzag_band(30, 66, arc_y(48, 16.5, 21, 18), 2.4, teeth=5, amp=1.2), dx=2, dy=1)
    for pts in ([(40, 27), (35, 20), (33, 14)], [(56, 27), (61, 20), (63, 14)], [(48, 32), (48, 22), (49, 13)]):
        hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    stk = K.m_poly([(37.5, 28.6), (42.6, 27), (41, 11.5), (35.5, 13)])
    hair.fill(stk & cap, P["streak"])
    hair.fill(stk & cap & rim(stk, 2, 0), P["streak_sh"])

    neck_and(body, P, head)
    cape = K.m_poly([(37, 72), (11, 79), (2, 100), (94, 100), (85, 79), (59, 72)])
    body.fill(cape, P["cape"])
    body.fill(rim(cape, 3, 0) | (cape & (XX > 62) & (YY > 86)), P["cape_sh"])
    body.fill(K.m_line([(12, 80), (34, 73.6)]) | K.m_line([(83, 80), (61, 73.6)]), P["hair_hl"])
    cr = K.m_poly([(42.5, 69.5), (53.5, 69.5), (56, 80), (48, 88), (40, 80)])
    body.fill(grow(cr), P["ink"])
    body.fill(cr, P["streak"])
    body.fill(cr & (YY > 79 + (48 - XX) * 0.5) | K.m_line([(48, 72), (48, 80)]), P["streak_sh"], only=P["streak"])
    body.fill(K.m_curve([(28, 81), (38, 90), (48, 93), (58, 90), (68, 81)]), P["gold"])
    for cx_ in (28, 68):
        dd = K.m_poly([(cx_, 77), (cx_ + 3.4, 81), (cx_, 85), (cx_ - 3.4, 81)])
        body.fill(grow(dd), P["ink"])
        body.fill(dd, P["red"])
        body.fill(K.m_px((cx_ - 1, 80)), P["iris_lt"])

    paint_brows(fx, P, F, E)
    common_marks(Ls, P, E, sweat=(28, 34), gloom=(34, 12), shock=(34, 10))
    finish(Ls, P, E)
    return Ls, P, F, E


BUILDERS = {"rin": build_rin, "mako": build_mako, "jiro": build_jiro, "aya": build_aya, "pochi": build_pochi,
            "goro": build_goro, "yuki": build_yuki, "zeno": build_zeno, "onyx": build_onyx}



# --------------------------------------------------------------------------- output

def build_sprite(cid):
    spr = Sprite(96, 96)
    idx = {n: spr.add_layer(n) for n in LAYERS}
    guide = spr.add_layer("eyeband", visible=False)
    used = []
    pal = None
    band_y = None
    frames = []
    for e in EXPR:
        Ls, P, F, E = BUILDERS[cid](e)
        pal = P
        frames.append((Ls, F))
        if e == "fierce":
            box = eye_masks(F, "fierce")["box"]
            dy = E.get("dy", 0)
            top, bot = F["brow_y"] - 4.0 + dy, box[3] + dy
            band_y = max(0, min(72, int(round((top + bot) / 2.0 - 12))))
        f = spr.add_frame(200)
        for n in LAYERS:
            spr.set_cel(idx[n], f, Ls[n].image())
        spr.add_tag(e, f, f)
    from PIL import Image
    g = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    g.paste((255, 0, 255, 96), (0, band_y, 96, band_y + 24))
    for f in range(len(EXPR)):
        spr.set_cel(guide, f, g)
    # palette: declared colours that are really used, in declaration order
    seen = set()
    for Ls, _F in frames:
        for n in LAYERS:
            a = Ls[n].a[K.PAD:K.PAD + 96, K.PAD:K.PAD + 96].reshape(-1, 4)
            for r, g_, b, al in np.unique(a, axis=0):
                if al:
                    seen.add("#%02x%02x%02x" % (r, g_, b))
    declared = []
    for v in list(pal.values()) + [WHITE]:
        if v not in declared:
            declared.append(v)
    stray = seen - set(declared)
    if stray:
        raise SystemExit(f"{cid}: colours not in the palette: {sorted(stray)}")
    spr.palette = [c for c in declared if c in seen]
    return spr


def main(argv):
    ids = argv or [c for c, _ in CAST]
    os.makedirs(OUT_DIR, exist_ok=True)
    for cid in ids:
        spr = build_sprite(cid)
        path = os.path.join(OUT_DIR, cid + ".aseprite")
        spr.save(path)
        print(f"{cid}: {len(spr.palette)} colours -> {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:])
