#!/usr/bin/env python3
"""Paint the nine Hyper Bluff portraits and save them as Aseprite sources.

    python3 tools/art/portraits.py            # writes art/portraits/<id>.aseprite
    python3 tools/art/portraits.py rin mako   # only these

Each file is 96x96, five frames (neutral, happy, shock, defeat, fierce; 200 ms each,
one tag per frame) and the layers, bottom to top:

    hair_back  hair, collars, ribbons and props that sit behind the body
    body       neck, shoulders, clothes (only a sliver: the head fills the cell)
    face       head, ears, eyes, nose, mouth, face shading
    hair       hair in front of the face, hats, hoods, masks' straps, ornaments
    fx         eyebrows, glasses, hand props, sweat drops and other marks
    eyeband    HIDDEN guide: a 96x24 box over the eyes; its y is the "eye_y" that
               export_portraits.py writes to portraits.json for the cut-in close-up

Every character has their own painter: own head shape, eyes, brows, nose, mouth,
pose and per-expression changes. Only low-level helpers are shared. The painting
is procedural and deterministic (no random numbers). All designs are original.
"""
import math
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paintkit as K                      # noqa: E402
from paintkit import Layer, XX, YY, shift, grow, rim   # noqa: E402
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
FX = {"sweat": "#8fd4ff", "gloom": "#5a62b0"}


# --------------------------------------------------------------------------- shared low-level helpers

class Art:
    def __init__(self, P):
        self.P = P
        self.L = {n: Layer(n) for n in LAYERS}
        self.hb, self.body, self.face, self.hair, self.fx = (self.L[n] for n in LAYERS)
        self.feat = K.empty()         # eyes and brows, for the cut-in band

    def finish(self, flip=False, outline=("hair_back", "body", "face", "hair")):
        K.reset_xf()
        for n in outline:
            self.L[n].outline(self.P["ink"])
        if flip:
            for n in LAYERS:
                self.L[n].a = self.L[n].a[:, ::-1].copy()
            self.feat = self.feat[:, ::-1].copy()
        return self


def pmask(L, m, ink, col, diag=False):
    """Fill m with col and give it a dark outline (so it reads on any backdrop)."""
    L.fill(grow(m, diag), ink)
    L.fill(m, col)


SHAPES = {
    "round": [(-1, .05), (-.8, -.6), (-.35, -.95), (.3, -1), (.8, -.7), (1, -.05), (.85, .6), (.4, .95), (-.3, 1), (-.8, .65)],
    "tall": [(-1, .1), (-.92, -.6), (-.5, -.97), (.4, -1), (.9, -.75), (1, -.1), (.92, .65), (.5, .97), (-.4, 1), (-.9, .7)],
    "cat": [(-1, .4), (-.7, -.35), (-.15, -.85), (.55, -1), (1, -.8), (.95, -.1), (.75, .55), (.3, .92), (-.35, 1), (-.85, .82)],
    "droop": [(-1, -.1), (-.75, -.7), (-.2, -1), (.45, -.85), (.9, -.4), (1, .3), (.8, .78), (.3, 1), (-.4, .95), (-.9, .55)],
    "almond": [(-1, .3), (-.5, -.5), (.2, -.95), (.8, -.8), (1, -.45), (.7, .35), (.1, .85), (-.5, .8)],
    "box": [(-1, .2), (-.95, -.7), (-.6, -1), (.6, -1), (.95, -.7), (1, .2), (.9, .8), (.5, 1), (-.5, 1), (-.9, .8)],
}


def eye(A, cx, cy, w, h, shape="round", s=1, lid=0.0, tilt=0.0, low=0.0, iris=(0.0, 0.1, 0.62, 0.95), pup=0.45,
        lash=2, hl=((-0.5, -0.5, 1.4), (0.45, 0.5, 0.8)), lower=True, flick=0.0, glow=False, feat=True):
    """One eye. s=+1: outer corner on the right. lid/low cut the eye from the top/bottom
    (fractions of its height), tilt slants the upper lid (inner end lower when > 0)."""
    L, P = A.face, A.P

    def Wd(u, v):
        return (cx + s * u * w / 2.0, cy + v * h / 2.0)
    E = K.m_blob([Wd(u, v) for u, v in SHAPES[shape]], 6)
    top = -1 + 2 * lid
    bot = 1 - 2 * low
    cut = K.m_poly([Wd(-2, top + 2 * tilt), Wd(2, top - 2 * tilt), Wd(2, bot), Wd(-2, bot)])
    white = E & cut
    ix, iy, irx, iry = iris
    icx, icy = Wd(ix, iy)
    rx, ry = irx * w / 2.0, iry * h / 2.0
    I = K.m_ellipse(icx, icy, rx, ry) & white
    lt = I & K.m_ellipse(icx, icy + 0.72 * ry, rx * 0.95, ry * 0.6)
    pu = I & K.m_ellipse(icx, icy - 0.05 * ry, rx * pup, ry * pup)
    up = K.empty()
    for k in range(1, lash + 1):
        up |= shift(white, 0, -k)
    up &= ~white
    upper_half = K.m_poly([Wd(-2.4, -3), Wd(2.4, -3), Wd(2.4, top + 0.55 - 2.4 * tilt * 0.5), Wd(-2.4, top + 0.55 + 2.4 * tilt * 0.5)])
    lashm = up | (grow(white) & ~white & upper_half)
    if flick:
        lashm |= K.m_poly([Wd(0.75, top + 0.15 - 0.75 * tilt), Wd(1.0 + 2 * flick / w, top - 0.25 - tilt - 2 * flick / h), Wd(1.02, top + 0.75 - tilt)])
    L.fill(white, P["ew"])
    L.fill(I, P["iris"])
    L.fill(lt, P["iris_lt"])
    L.fill(I & (shift(lashm, 0, 1) | shift(lashm, 0, 2)), P["iris_dk"])
    L.fill(pu, P["iris_dk"])
    if glow:
        L.fill(I & K.m_ellipse(icx, icy, rx * 0.5, ry * 0.5), P["iris_lt"])
        L.fill(I & K.m_ellipse(icx, icy, rx * 0.22, ry * 0.3), WHITE)
    if lower:
        lo = shift(white, 0, 1) & ~white & K.m_poly([Wd(0.1, -0.2), Wd(2, -0.2), Wd(2, 3), Wd(0.1, 3)])
        L.fill(lo, P["line"])
    L.fill(lashm & ~white, P["ink"])
    for u, v, r in hl:
        hx, hy = icx + u * rx, icy + v * ry
        m = K.m_ellipse(hx, hy, r, r) if r >= 1.0 else K.m_px((hx, hy))
        L.fill(m & (white | lashm), WHITE)
    if feat:
        A.feat |= E | lashm
    return dict(white=white, lash=lashm, E=E, iris=I)


def arc_eye(A, pts, t=1.8, col=None, layer=None):
    m = K.m_stroke(pts, t, True)
    (layer or A.face).fill(m, col or A.P["ink"])
    A.feat |= m
    return m


def brow(A, pts, t, col=None, layer=None):
    m = K.m_stroke(pts, t, True)
    (layer or A.fx).fill(m, col or A.P["brow"])
    A.feat |= m
    return m


def mouth(A, pts, teeth_top=None, teeth_bot=None, tongue=None, fangs=(), smooth=True, layer=None, lip=None):
    """Open mouth: dark hole with optional teeth rows (y limits), tongue ellipse and fangs."""
    L, P = layer or A.face, A.P
    m = K.m_blob(pts, 6) if smooth else K.m_poly(pts)
    L.fill(grow(m), lip or P["line"])
    L.fill(m, P["mouth"])
    if tongue:
        L.fill(m & K.m_ellipse(*tongue), P["tongue"])
    if teeth_top is not None:
        L.fill(m & K.m_poly(teeth_top), WHITE)
    if teeth_bot is not None:
        L.fill(m & K.m_poly(teeth_bot), WHITE)
    for f in fangs:
        L.fill(K.m_poly(f) & (m | grow(m)), WHITE)
    return m


def skin_fill(A, head, cast=None, rim_dx=3, rim_dy=1, side=1):
    """Flat skin, a rim shadow on the side away from the light, and the hair's cast shadow."""
    L, P = A.face, A.P
    L.fill(head, P["skin"])
    L.fill(rim(head, rim_dx * side, rim_dy), P["skin_sh"])
    if cast is not None:
        L.fill(head & cast, P["skin_sh"])


def dramatic(A, region):
    """Fierce shadow: push skin tones one step darker inside region."""
    L, P = A.face, A.P
    sh = L.is_col(P["skin_sh"]) & region
    L.fill(region, P["skin_sh"], only=P["skin"])
    L.fill(sh, P["skin_dk"])


def sweat(A, x, y, k=1.0, layer=None):
    L, P = layer or A.fx, A.P
    m = K.m_poly([(x, y - 5 * k), (x + 3 * k, y + 0.6 * k), (x + 2.4 * k, y + 3 * k), (x, y + 4.2 * k), (x - 2.4 * k, y + 3 * k), (x - 3 * k, y + 0.6 * k)])
    pmask(L, m, P["ink"], P["sweat"])
    L.fill(K.m_px((x - 1, y + 0.6 * k), (x - 1, y + 1.6 * k)), WHITE)


def shock_lines(A, x, y, flip=False, n=3, layer=None):
    """Short outlined white ticks radiating from (x, y)."""
    L, P = layer or A.fx, A.P
    s = -1 if flip else 1
    rays = ((-5, -3, -9, -6), (0, -6, 0, -11), (5, -3, 9, -6))[:n]
    m = K.empty()
    for x0, y0, x1, y1 in rays:
        m |= K.m_stroke([(x + s * x0, y + y0), (x + s * x1, y + y1)], 1.5)
    pmask(L, m, P["ink"], WHITE)


def gloom(A, x, y, lens=(10, 14, 9, 12, 7), gap=3, layer=None):
    L, P = layer or A.fx, A.P
    m = K.empty()
    for i, n in enumerate(lens):
        m |= K.m_line([(x + i * gap, y), (x + i * gap, y + n)])
    L.fill(grow(m) & ~m, P["ink"])
    L.fill(m, P["gloom"])


def tear_stream(A, x, y, w, n, layer=None):
    L, P = layer or A.face, A.P
    m = K.m_rect(x, y, x + w, y + n) | K.m_ellipse(x + w / 2.0, y + n, w / 2.0 + 0.6, 1.8)
    pmask(L, m, P["ink"], P["sweat"])
    L.fill(K.m_line([(x + 1, y + 1), (x + 1, y + n - 2)]), WHITE)


def tips(m, n):
    """The top n pixels of every upward point of a mask (flame / spike tips)."""
    return m & ~shift(m, 0, n)


def star(cx, cy, r, r2=None, rot=-90):
    r2 = r2 or r * 0.45
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r2
        t = math.radians(rot + i * 36)
        pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
    return K.m_poly(pts)


def mirx(pts, cx=48.0):
    return [(2 * cx - x, y) for x, y in reversed(pts)]


def stretch_up(pts, y0, k):
    """Scale the part of a point list above y0 (hair flaring up or wilting)."""
    return [(x, y0 + (y - y0) * k if y < y0 else y) for x, y in pts]


# --------------------------------------------------------------------------- characters

# ---- 1. Rin: flame hair blown to one side, flying headband tails, nose plaster, fang grin

def build_rin(e):
    P = dict(FX, ink="#3a1420", line="#a03c30",
             skin="#ffd8b0", skin_sh="#ee9e78", skin_dk="#aa5c5c", blush="#ff9484",
             hair="#ee3a22", hair_sh="#a41a26", hair_hl="#ff8a26", hair_tip="#ffd648", brow="#7a1418",
             ew="#ffffff", iris="#8a3c1a", iris_lt="#e89a40", iris_dk="#3c1612", mouth="#701830", tongue="#f47070",
             band="#f8f8ff", band_sh="#b0bee4", plaster="#f6dcaa",
             jacket="#d82032", jacket_sh="#8a1428")
    A = Art(P)
    rot = {"neutral": 7, "happy": 12, "shock": 3, "defeat": -9, "fierce": -2}[e]
    off = {"neutral": (-5, 3), "happy": (-4, 2), "shock": (-1, 1), "defeat": (-8, 8), "fierce": (-6, 4)}[e]
    flare = {"neutral": 1.0, "happy": 1.05, "shock": 1.22, "defeat": 0.72, "fierce": 1.2}[e]

    # body sliver (drawn straight)
    neck = K.m_poly([(38, 78), (62, 74), (64, 100), (36, 100)])
    A.body.fill(neck, P["skin"])
    A.body.fill(neck & (YY < 90), P["skin_sh"])
    sh = K.m_poly([(34, 92), (64, 92), (70, 100), (30, 100)])
    A.body.fill(sh, P["band"])
    for pts in ([(10, 100), (18, 84), (30, 80), (40, 90), (43, 100)], [(54, 100), (60, 88), (72, 78), (84, 84), (92, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["jacket"])
        A.body.fill(rim(c, 3, 2), P["jacket_sh"])

    K.set_xf(rot, (46, 78), *off)
    # --- hair behind the head: flames blown to the right
    back = stretch_up([(26, 34), (19, 22), (27, 24), (25, 8), (34, 16), (37, -3), (46, 9), (53, -8), (60, 7), (71, -6), (73, 9),
                       (88, 0), (84, 15), (101, 12), (91, 25), (104, 33), (89, 37), (98, 50), (84, 49), (86, 62), (76, 58),
                       (72, 66), (70, 34), (48, 22)], 40, flare)
    bm = K.m_poly(back)
    A.hb.fill(bm, P["hair"])
    A.hb.fill(rim(bm, 3, 3), P["hair_sh"])
    A.hb.fill(tips(bm, 8) & ~rim(bm, 3, 3), P["hair_hl"])
    A.hb.fill(tips(bm, 3), P["hair_tip"])
    # headband tails
    if e == "defeat":
        tails = [[(75, 31), (83, 36), (87, 58), (84, 84), (79, 83), (81, 58), (76, 40)],
                 [(74, 34), (79, 44), (78, 64), (73, 74), (70, 72), (73, 60), (72, 44)]]
    else:
        lift = -4 if e in ("shock", "fierce") else 0
        tails = [[(75, 30), (86, 25 + lift), (98, 29 + lift), (108, 22 + lift), (108, 33 + lift), (97, 38 + lift), (86, 34 + lift), (76, 36)],
                 [(75, 33), (86, 40), (95, 50 + lift), (108, 53 + lift), (104, 61 + lift), (91, 57 + lift), (82, 47), (75, 38)]]
    for t in tails:
        m = K.m_blob(t, 5)
        A.hb.fill(grow(m), P["ink"])
        A.hb.fill(m, P["band"])
        A.hb.fill(rim(m, 1, 2), P["band_sh"])

    # --- head: 3/4, looking to the left (flipped at the end), square young jaw
    head = K.m_poly([(27, 22), (23, 36), (22.4, 46), (21.4, 54), (23.5, 64), (28.5, 74), (35, 82), (41.5, 84.5), (51, 82.5),
                     (61, 76), (69, 66), (73, 54), (74, 38), (70, 24), (48, 16)])
    ear = K.m_ellipse(74, 54, 4.4, 7.4)
    A.face.fill(ear, P["skin"])
    A.face.fill(K.m_curve([(73, 50), (75.5, 53), (73.5, 58)]), P["skin_sh"])
    front = K.m_poly(stretch_up([(21, 30), (24, 18), (34, 10), (50, 8), (66, 12), (75, 22), (77, 34), (48, 27)], 30, 1.0))
    locks = [[(23, 24), (30, 15), (41, 13), (37, 24), (30.5, 41)],
             [(35, 21), (46, 11), (59, 14), (52, 26), (44.5, 44)],
             [(53, 19), (64, 13), (73, 21), (68, 28), (64.5, 41)],
             [(70, 24), (78, 34), (77, 50), (72.5, 44)]]
    band = K.m_poly([(21, 28.5), (34, 27.4), (48, 27), (62, 27.6), (76, 29.5), (76.6, 36), (62, 34), (48, 33.4), (34, 33.8), (20.8, 35)])
    lk = K.empty()
    for l in locks:
        lk |= K.m_poly(l)
    cast = shift(lk | band, 0, 2)
    skin_fill(A, head, cast, side=1)
    if e == "fierce":
        dramatic(A, head & K.m_poly([(10, 10), (90, 10), (90, 60), (48, 64), (10, 58)]))
    if e == "happy":
        for bx in (30, 60):
            A.face.fill(K.m_ellipse(bx, 62, 4.5, 2.0) & head, P["blush"], only=[P["skin"], P["skin_sh"]])

    # eyes
    if e == "happy":
        arc_eye(A, [(25.5, 53.5), (30.5, 48.5), (35.5, 53.5)], 2.2)
        arc_eye(A, [(49, 54), (56, 48), (63, 54)], 2.4)
    elif e == "defeat":
        arc_eye(A, [(25.5, 51), (30.5, 53), (35.5, 51.5)], 2.0)
        arc_eye(A, [(49, 52), (56, 54.5), (63, 52)], 2.2)
        tear_stream(A, 28.5, 55, 4, 12)
        tear_stream(A, 53.5, 56.5, 5, 13)
    elif e == "shock":
        eye(A, 30.5, 50.5, 10.5, 14.5, "round", s=-1, iris=(0.1, 0.0, 0.3, 0.3), pup=0.5, lash=1, hl=(), lower=False)
        eye(A, 56, 51, 14.5, 15.5, "round", s=1, iris=(-0.15, 0.0, 0.3, 0.3), pup=0.5, lash=1, hl=(), lower=False)
    elif e == "fierce":
        eye(A, 30.5, 51, 10, 12.5, "tall", s=-1, lid=0.3, tilt=0.22, low=0.08, iris=(0.2, 0.1, 0.6, 0.9), lash=2, hl=((-0.5, -0.2, 1.0),))
        eye(A, 56, 51.5, 13.5, 13.5, "tall", s=1, lid=0.3, tilt=0.22, low=0.08, iris=(-0.2, 0.1, 0.6, 0.9), lash=2, hl=((-0.5, -0.2, 1.2),))
    else:
        eye(A, 30.5, 50.5, 9.6, 13.5, "tall", s=-1, iris=(0.2, 0.1, 0.62, 0.92), lash=2)
        eye(A, 56, 51, 13, 14.5, "tall", s=1, iris=(-0.2, 0.1, 0.62, 0.92), lash=2)

    # nose + plaster
    A.face.fill(K.m_curve([(39.5, 57), (36.8, 62.5), (40, 64)]), P["line"])
    pl = K.m_poly([(35.5, 55.6), (47.5, 54.4), (48.2, 59.4), (36.2, 60.6)])
    A.face.fill(grow(pl), P["ink"])
    A.face.fill(pl, P["plaster"])
    A.face.fill(K.m_rect(40, 56, 44, 59), P["band"])

    # mouth
    if e == "neutral":
        mouth(A, [(30, 68.5), (41, 71), (53, 67.5), (51.5, 75), (43, 79.5), (34, 76)],
              teeth_top=[(28, 66), (55, 66), (55, 71.6), (28, 72.6)], tongue=(42, 79, 5.5, 2.6),
              fangs=([(46.6, 70.5), (50, 70), (48.6, 75)],))
    elif e == "happy":
        mouth(A, [(28, 66), (41, 69.5), (55, 65), (53.5, 76), (43, 82.5), (32, 77.5)],
              teeth_top=[(26, 64), (57, 64), (57, 69.6), (26, 70.6)], tongue=(42.5, 81, 7, 3.4),
              fangs=([(47.6, 69), (51.4, 68.4), (49.8, 74)],))
    elif e == "shock":
        mouth(A, [(33, 68.5), (50, 67.5), (52, 73), (50.5, 81.5), (34.5, 82), (32, 74)],
              teeth_top=[(30, 66), (54, 66), (54, 70.4), (30, 70.8)], teeth_bot=[(30, 79.6), (54, 79.2), (54, 84), (30, 84)], smooth=False)
    elif e == "defeat":
        A.face.fill(K.m_stroke([(32, 73), (35.5, 71), (39, 73.5), (42.5, 71), (46, 73.5), (49.5, 71.5)], 1.5), P["line"])
    else:
        mouth(A, [(30, 67), (41, 70), (55, 64.5), (54, 77.5), (44, 82), (33, 78)],
              teeth_top=[(27, 62), (58, 62), (58, 69.4), (27, 71.4)], teeth_bot=[(27, 77.4), (58, 75.4), (58, 86), (27, 86)],
              fangs=([(47.6, 68.6), (51.6, 67.8), (50, 74.5)], [(35, 78), (38, 77.6), (36.6, 73.6)]), smooth=False)

    # hair in front: forehead tufts, headband, flame locks over it
    A.hair.fill(front, P["hair"])
    A.hair.fill(tips(front, 4), P["hair_hl"])
    A.hair.fill(grow(band) & ~band, P["ink"])
    A.hair.fill(band, P["band"])
    A.hair.fill(band & shift(band, 0, -3) & ~shift(band, 0, -9), P["band"])
    A.hair.fill(band & ~shift(band, 0, -2), P["band_sh"])
    A.hair.fill(grow(lk) & band, P["ink"])
    A.hair.fill(lk, P["hair"])
    A.hair.fill(rim(lk, 2, 0), P["hair_sh"])
    A.hair.fill(lk & ~shift(lk, -3, 0) & ~rim(lk, 2, 0), P["hair_hl"])
    kn = K.m_ellipse(77, 33, 2.6, 3.2)
    A.hair.fill(grow(kn), P["ink"])
    A.hair.fill(kn, P["band"])

    # brows over the hair
    bt = 2.8
    if e == "neutral":
        brow(A, [(36.5, 41.5), (30.5, 38.5), (25, 41)], bt)
        brow(A, [(48, 42.5), (56, 37.5), (65, 39)], bt)
    elif e == "happy":
        brow(A, [(36.5, 41), (30.5, 37), (25, 39.5)], bt)
        brow(A, [(48, 41), (56, 36.5), (65, 39.5)], bt)
    elif e == "shock":
        brow(A, [(36, 36.5), (30.5, 34), (25.5, 36.5)], 2.2)
        brow(A, [(49, 36.5), (56, 33.5), (64, 36.5)], 2.2)
    elif e == "defeat":
        brow(A, [(36.5, 41), (31, 43), (25, 46)], bt)
        brow(A, [(48, 42), (56, 43.5), (65, 47)], bt)
    else:
        brow(A, [(38, 46.5), (31, 42), (24.5, 39)], 3.2)
        brow(A, [(46.5, 47), (56, 42), (66, 38)], 3.2)

    # marks
    if e == "shock":
        shock_lines(A, 16, 30)
        sweat(A, 16, 60)
    elif e == "defeat":
        gloom(A, 30, 6)
    return A.finish(flip=True)


# ---- 2. Mako: star headphones, low twin tails, bubble gum, half-lidded eyes (cyan / white)

def build_mako(e):
    P = dict(FX, ink="#12224a", line="#a8485c",
             skin="#ffe6d2", skin_sh="#f2ae9c", skin_dk="#9a7aa4", blush="#ff9cb0",
             hair="#2cc4ec", hair_sh="#1478b8", hair_hl="#b8f6ff", brow="#126890",
             ew="#ffffff", iris="#d83c8c", iris_lt="#ffa4cc", iris_dk="#6c1848", mouth="#701838", tongue="#f47890",
             gum="#ff7cb4", gum_hl="#ffd4e6",
             phone="#f4f8ff", phone_sh="#a8bcdc", navy="#1c3a78", star="#ffd83c", star_sh="#d88c1c")
    A = Art(P)
    rot = {"neutral": -4, "happy": 7, "shock": 3, "defeat": -13, "fierce": -8}[e]
    off = {"neutral": (0, 2), "happy": (0, 1), "shock": (3, 0), "defeat": (-3, 7), "fierce": (-1, 3)}[e]

    neck = K.m_poly([(40, 76), (58, 73), (60, 100), (38, 100)])
    A.body.fill(neck, P["skin_sh"])
    for pts in ([(14, 100), (22, 88), (36, 84), (44, 92), (46, 100)], [(50, 100), (56, 90), (68, 82), (82, 88), (90, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["phone"])
        A.body.fill(rim(c, 3, 2), P["phone_sh"])
        A.body.fill(c & ~shift(c, 0, 3), P["hair"])

    K.set_xf(rot, (46, 76), *off)
    droop = 6 if e == "defeat" else 0
    backh = K.m_blob([(22, 28), (26, 12), (40, 4.5), (58, 4.5), (72, 12), (79.5, 28), (80.5, 48), (77, 62), (70, 67), (26, 67), (19.5, 48)])
    A.hb.fill(backh, P["hair_sh"])
    for pts, band in (([(71, 58), (80, 55), (89, 65), (93, 82), (99, 110), (78, 110), (81, 88), (76, 72)], [(73, 58), (81, 55.5), (83, 60.5), (75, 63.5)]),
                      ([(23, 58), (16, 61), (11, 76), (6, 110), (22, 110), (22, 86), (27, 70)], [(15.5, 61), (24, 58), (25.5, 63), (17, 66)])):
        t = K.m_blob(pts, 6)
        A.hb.fill(grow(t), P["ink"])
        A.hb.fill(t, P["hair"])
        A.hb.fill(rim(t, 3, 0), P["hair_sh"])
        A.hb.fill(t & shift(t, 3, 0) & ~shift(t, 5, 0), P["hair_hl"])
        b = K.m_poly(band)
        A.hb.fill(grow(b), P["ink"])
        A.hb.fill(b, P["navy"])
    fc = K.m_ellipse(19.5, 53 + droop, 4.2, 10)
    A.hb.fill(grow(fc), P["ink"])
    A.hb.fill(fc, P["phone_sh"])

    head = K.m_blob([(28, 22), (24, 36), (23, 47), (22.6, 55), (25.4, 64), (31, 73.5), (37.5, 80.5), (42.5, 82), (50, 79.5),
                     (60, 72.5), (68, 62.5), (72, 52), (73, 38), (69, 24), (48, 16)], 6)
    window = [(22.5, 62), (22.5, 46), (26, 41), (29, 47), (34, 38.5), (40, 48), (47, 37.5), (52, 46), (60, 36.5), (64, 44.5), (69, 38.5), (71.5, 62)]
    cap = K.m_blob([(20.5, 44), (22, 24), (32, 11.5), (48, 7.5), (64, 9.5), (75, 19), (78.5, 36), (76.5, 52), (48, 52)]) & ~K.m_poly(window)
    skin_fill(A, head, shift(cap, 0, 2))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(10, 10), (90, 10), (90, 59), (10, 62)]))
    if e in ("happy", "shock"):
        for bx, by in ((29, 62), (60, 63)):
            A.face.fill(K.m_ellipse(bx, by, 4.4, 1.8) & head, P["blush"], only=[P["skin"], P["skin_sh"]])

    lf = dict(flick=2.4, lash=2)
    if e == "neutral":
        eye(A, 31, 53, 9.2, 11.5, "cat", s=-1, lid=0.36, iris=(0.2, 0.1, 0.62, 0.95), hl=((-0.4, 0.0, 1.0),), **lf)
        eye(A, 55.5, 53.5, 13, 12.5, "cat", s=1, lid=0.36, iris=(-0.2, 0.1, 0.62, 0.95), hl=((-0.4, 0.0, 1.2),), **lf)
    elif e == "happy":          # wink
        arc_eye(A, [(26.5, 55), (31, 51.5), (36, 54.5)], 2.0)
        eye(A, 55.5, 53.5, 13, 12.5, "cat", s=1, lid=0.22, iris=(-0.2, 0.1, 0.62, 0.95), **lf)
    elif e == "shock":
        eye(A, 31, 52, 10, 14, "round", s=-1, iris=(0.15, 0, 0.36, 0.36), lash=1, hl=((-0.4, -0.4, 0.8),), lower=False)
        eye(A, 55.5, 52.5, 14, 15, "round", s=1, iris=(-0.15, 0, 0.36, 0.36), lash=1, hl=((-0.4, -0.4, 0.8),), lower=False)
    elif e == "defeat":
        arc_eye(A, [(26.5, 54), (31, 55.5), (36, 54.5)], 1.8)
        arc_eye(A, [(49.5, 55), (55.5, 56.5), (62, 55)], 1.8)
    else:                       # for once the lids come all the way up
        eye(A, 31, 53, 9.6, 12.5, "cat", s=-1, lid=0.14, tilt=0.2, iris=(0.2, 0.05, 0.56, 0.86), pup=0.3, hl=((-0.4, -0.3, 1.0),), **lf)
        eye(A, 55.5, 53.5, 13.5, 13.5, "cat", s=1, lid=0.14, tilt=0.2, iris=(-0.2, 0.05, 0.56, 0.86), pup=0.3, hl=((-0.4, -0.3, 1.2),), **lf)
    A.face.fill(K.m_line([(38, 62.5), (37, 64.5), (39, 65.2)]), P["line"])

    # bubble gum
    gx, gy = 38.5, 72.5
    if e == "neutral":
        g = K.m_ellipse(gx - 1.5, gy, 6.2, 6.0)
    elif e == "happy":
        g = None
        A.face.fill(K.m_stroke([(33, 71.5), (38, 74), (44, 73), (48, 70)], 1.4, True), P["line"])
        tn = K.m_ellipse(44.5, 75.6, 2.6, 2.6)
        A.face.fill(grow(tn), P["line"])
        A.face.fill(tn, P["tongue"])
    elif e == "shock":          # the bubble burst over her face
        g = K.m_poly([(30, 66), (36, 63), (40, 66.5), (46, 64), (48, 70), (53, 73), (47, 76), (46, 81), (40, 78), (34, 81), (33, 75), (27, 73)])
    elif e == "defeat":         # gum sags out of the mouth
        g = K.m_blob([(36, 70), (41, 70), (42.5, 76), (41, 83), (38, 85), (35.5, 82), (35.5, 75)], 6)
    else:                       # the bubble pops
        g = None
        A.face.fill(K.m_stroke([(33.5, 73.5), (38.5, 71.5), (44, 73.5)], 1.6, True), P["line"])
        burst = K.empty()
        for i in range(6):
            t = math.radians(i * 60 + 20)
            burst |= K.m_stroke([(gx - 3 + 6 * math.cos(t), gy + 6 * math.sin(t)), (gx - 3 + 10.5 * math.cos(t), gy + 10.5 * math.sin(t))], 2.6)
        pmask(A.fx, burst, P["ink"], P["gum"])
        frag = K.m_ellipse(30, 81, 2.2, 1.8) | K.m_ellipse(47, 79, 1.8, 1.6)
        pmask(A.fx, frag, P["ink"], P["gum_hl"])
    if g is not None:
        pmask(A.fx, g, P["ink"], P["gum"])
        if e in ("neutral",):
            A.fx.fill(K.m_ellipse(gx - 3.6, gy - 2.2, 1.8, 1.5), P["gum_hl"])
        A.fx.fill(rim(g, 2, 2), P["iris"])

    # fringe, headband, cups
    A.hair.fill(cap, P["hair"])
    A.hair.fill(cap & shift(K.m_poly(window), 0, -3), P["hair_sh"])
    hlb = K.m_blob([(26, 26), (36, 19.5), (50, 18), (64, 20), (72, 26), (63, 24), (50, 22.5), (37, 23.5)])
    A.hair.fill(hlb & cap, P["hair_hl"])
    for x0, y0, x1, y1 in ((34, 38, 33, 27), (47, 37, 47, 26), (60, 36, 61, 26)):
        A.hair.fill(K.m_line([(x0, y0), (x1, y1)]), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    hbnd = K.m_stroke([(18.5, 46 + droop), (21.5, 22 + droop), (35, 7.5 + droop), (52, 4 + droop), (68, 9 + droop), (77, 24 + droop), (78.5, 44 + droop)], 4.6, True)
    A.hair.fill(grow(hbnd), P["ink"])
    A.hair.fill(hbnd, P["phone"])
    A.hair.fill(hbnd & ~shift(hbnd, 0, 2), P["phone_sh"])
    cup = K.m_ellipse(77, 53 + droop, 10, 12.5)
    A.hair.fill(grow(cup), P["ink"])
    A.hair.fill(cup, P["phone"])
    A.hair.fill(rim(cup, 3, 2), P["phone_sh"])
    A.hair.fill(cup & ~shift(cup, -3, 0), P["navy"])
    st = star(78.5, 53 + droop, 6.4, 2.9)
    A.hair.fill(grow(st), P["ink"])
    A.hair.fill(st, P["star"] if e != "defeat" else P["star_sh"])
    A.hair.fill(rim(st, 1, 1), P["star_sh"])
    if e == "fierce":
        sp = K.m_stroke([(78.5, 40), (78.5, 34)], 1.5) | K.m_stroke([(88, 44), (92, 40)], 1.5) | K.m_stroke([(69, 44), (65, 40)], 1.5)
        pmask(A.fx, sp, P["ink"], P["star"])

    bt = 1.6
    if e == "neutral":
        brow(A, [(35.5, 44.5), (31, 43.2), (26, 44.6)], bt)
        brow(A, [(49, 45), (56, 43.4), (63, 44.6)], bt)
    elif e == "happy":
        brow(A, [(35.5, 45), (31, 43.6), (26, 46)], bt)
        brow(A, [(49, 43), (56, 40.6), (63, 43)], bt)
    elif e == "shock":
        brow(A, [(35.5, 40), (31, 38.4), (26.5, 40.6)], bt)
        brow(A, [(49.5, 40), (56, 37.6), (62.5, 40)], bt)
    elif e == "defeat":
        brow(A, [(35.5, 46), (31, 47.6), (26, 50)], bt)
        brow(A, [(49, 47), (56, 48.4), (63, 51)], bt)
    else:
        brow(A, [(37, 47.6), (31, 44.2), (25.5, 42)], 2.2)
        brow(A, [(47.5, 48.4), (56, 44.2), (64.5, 41)], 2.2)
    if e == "shock":
        shock_lines(A, 14, 30)
        sweat(A, 13, 66, 0.9)
    elif e == "defeat":
        gloom(A, 34, 8)
        sweat(A, 15, 44)
    return A.finish(flip=False)


# ---- 3. Jiro: wide-brim gambler hat over one eye, stubble, toothpick, loose tie (olive / mustard)

def build_jiro(e):
    P = dict(FX, ink="#1c2414", line="#7c4830",
             skin="#f0c89c", skin_sh="#cc9468", skin_dk="#7c5a4c", blush="#f09c7c",
             hair="#3e5c36", hair_sh="#22361f", brow="#22361f",
             hat="#7e8e3c", hat_sh="#4c5a24", hat_hl="#aebe60", must="#eab826", must_sh="#a87414",
             ew="#fffbe8", iris="#a87414", iris_lt="#f6d654", iris_dk="#4a3008", mouth="#5c1c1c", tongue="#e07068",
             pick="#f6ecc4", shirt="#f0ead8", shirt_sh="#b4ac94")
    A = Art(P)
    rot = {"neutral": 7, "happy": -5, "shock": 0, "defeat": 12, "fierce": 3}[e]
    off = {"neutral": (0, 3), "happy": (0, 2), "shock": (0, 5), "defeat": (2, 8), "fierce": (0, 5)}[e]
    hat_rot = {"neutral": -11, "happy": 5, "shock": -22, "defeat": 0, "fierce": -13}[e]
    hat_off = {"neutral": (0, 0), "happy": (2, -9), "shock": (4, -19), "defeat": (0, 9), "fierce": (0, 3)}[e]

    # shirt, loose tie
    neck = K.m_poly([(37, 80), (59, 80), (61, 100), (35, 100)])
    A.body.fill(neck, P["skin_sh"])
    for pts in ([(8, 100), (20, 90), (34, 86), (44, 96), (45, 100)], [(52, 100), (54, 95), (62, 86), (76, 90), (88, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["shirt"])
        A.body.fill(rim(c, 3, 2), P["shirt_sh"])
    tie = K.m_poly([(45, 93), (53, 91), (57, 97), (55, 100), (43, 100), (43, 96)])
    A.body.fill(grow(tie), P["ink"])
    A.body.fill(tie, P["must"])
    A.body.fill(rim(tie, 2, 1), P["must_sh"])

    K.set_xf(rot, (48, 80), *off)
    for sgn in (1, -1):
        def M(pts):
            return pts if sgn == 1 else mirx(pts)
        t = K.m_poly(M([(72, 34), (79, 46), (81, 62), (77, 76), (73, 70), (76, 62), (72, 56)]))
        A.hb.fill(t, P["hair"])
        A.hb.fill(rim(t, 2, 2), P["hair_sh"])
    head = K.m_poly([(26, 26), (23.5, 40), (23.5, 55), (26, 66.5), (32, 77.5), (40, 85), (48, 86.5), (56, 85), (64, 77.5),
                     (70, 66.5), (72.5, 55), (72.5, 40), (70, 26), (48, 18)])
    ears = K.m_ellipse(22.6, 55, 3.6, 6.6) | K.m_ellipse(73.4, 55, 3.6, 6.6)
    A.face.fill(ears, P["skin"])
    A.face.fill(K.m_line([(73, 52), (74.5, 55), (73, 58)]) | K.m_line([(23, 52), (21.5, 55), (23, 58)]), P["skin_sh"])
    # hat geometry in its own tilt
    def hat_xf():
        K.set_xf(rot, (48, 80), *off)
        p = K.xf([(48, 36)])[0]
        K.set_xf(rot + hat_rot, (48, 36), p[0] - 48 + hat_off[0], p[1] - 36 + hat_off[1])
    hat_xf()
    brim = K.m_blob([(-12, 37), (8, 28.5), (30, 30), (48, 34), (66, 30), (88, 28.5), (108, 37), (88, 43.5), (48, 47), (8, 43.5)], 8)
    crown = K.m_poly([(21.5, 33), (23.5, 9), (31, 0), (41, -3), (48, 1.5), (55, -3), (65, 0), (72.5, 9), (74.5, 33), (48, 37)])
    K.set_xf(rot, (48, 80), *off)
    skin_fill(A, head, shift(brim, 0, 3) | shift(brim, 0, 6))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(0, 0), (96, 0), (96, 62), (48, 66), (0, 62)]))
    # stubble
    st = [(33, 74), (36, 77), (39.5, 80), (43, 82), (47, 83), (51, 83), (55, 81.5), (58.5, 79), (61.5, 76), (64, 73),
          (37, 73), (41, 77.5), (45, 79.5), (50, 80), (54.5, 78), (58.5, 74.5), (42, 70), (46, 69.4), (50, 69.4), (54, 70)]
    A.face.fill(K.m_px(*st), P["skin_dk"], only=[P["skin"], P["skin_sh"]])

    def brows(l, r, t=2.0):
        if l:
            brow(A, l, t, layer=A.face)
        if r:
            brow(A, r, t, layer=A.face)
    if e == "neutral":
        eye(A, 35, 54, 12, 9.5, "droop", s=-1, lid=0.42, iris=(0.0, 0.1, 0.55, 1.0), hl=((-0.4, 0.2, 0.9),), lash=1)
        eye(A, 61, 54, 12, 9.5, "droop", s=1, lid=0.42, iris=(0.0, 0.1, 0.55, 1.0), hl=((-0.4, 0.2, 0.9),), lash=1)
        brows([(41, 46.6), (35, 45.2), (28.5, 47)], [(55, 46), (61, 44), (67.5, 46.4)])
    elif e == "happy":
        arc_eye(A, [(29.5, 56), (35, 51), (40.5, 56)], 2.0)
        arc_eye(A, [(55.5, 56), (61, 51), (66.5, 56)], 2.0)
        brows([(41, 46), (35, 43.4), (28.5, 46)], [(55, 46), (61, 43.4), (67.5, 46)])
        for bx in (33, 63):
            A.face.fill(K.m_ellipse(bx, 62, 4.2, 1.6), P["blush"], only=[P["skin"], P["skin_sh"]])
    elif e == "shock":
        eye(A, 35, 53, 12.5, 13.5, "round", s=-1, iris=(0.0, 0, 0.3, 0.3), hl=(), lash=1, lower=False)
        eye(A, 61, 53, 12.5, 13.5, "round", s=1, iris=(0.0, 0, 0.3, 0.3), hl=(), lash=1, lower=False)
        brows([(41, 42), (35, 39.6), (29, 42.6)], [(55, 42), (61, 39.6), (67, 42.6)])
    elif e == "defeat":
        arc_eye(A, [(29.5, 55), (35, 57), (40.5, 55.5)], 1.8)
        arc_eye(A, [(55.5, 55.5), (61, 57), (66.5, 55)], 1.8)
    else:
        eye(A, 35, 54, 12, 9.5, "droop", s=-1, lid=0.3, tilt=0.25, iris=(0.0, 0.1, 0.5, 1.0), hl=(), lash=1)
        eye(A, 61, 54, 12.5, 10.5, "droop", s=1, lid=0.24, tilt=0.25, iris=(-0.1, 0.1, 0.5, 1.0), pup=0.3, hl=((-0.4, 0.0, 1.0),), lash=2)
        brows([(42, 50), (35, 46.5), (28, 44.5)], [(54, 50), (61, 46), (68.5, 43.5)], 2.6)
    A.face.fill(K.m_curve([(47, 56), (45.4, 64), (47, 66), (50.5, 65.6)]), P["line"])
    A.face.fill(K.m_px((50, 64), (51, 64)), P["skin_sh"])

    # mouth and toothpick
    pk = None
    if e == "neutral":
        A.face.fill(K.m_stroke([(38.5, 73.5), (46, 75.4), (54, 74), (58, 71.4)], 1.5, True), P["line"])
        pk = [(54.5, 73.6), (70, 68.5)]
    elif e == "happy":
        mouth(A, [(36, 71), (48, 73), (60, 70), (57, 77), (48, 80), (39, 77.5)], teeth_top=[(30, 66), (66, 66), (66, 74.4), (30, 75.4)])
        pk = [(56, 72.5), (69, 62)]
    elif e == "shock":
        mouth(A, [(42, 71), (54, 71), (55.5, 77), (52, 82), (44, 82), (40.5, 77)], tongue=(48, 82, 4.6, 2.4))
        K.reset_xf()
        pmask(A.fx, K.m_stroke([(62, 80), (70, 91)], 1.5), P["ink"], P["pick"])
        K.set_xf(rot, (48, 80), *off)
    elif e == "defeat":
        A.face.fill(K.m_stroke([(39, 76.5), (44, 74), (52, 74), (57, 76.5)], 1.5, True), P["line"])
        pk = [(53, 75), (60, 86)]
    else:
        mouth(A, [(37, 72.5), (48, 73.5), (61, 68), (59, 75.5), (49, 79), (40, 77.5)], teeth_top=[(30, 60), (70, 60), (70, 90), (30, 90)], smooth=False)
        A.face.fill(K.m_line([(40, 75.5), (58, 71.6)]), P["line"])
        pk = [(55.5, 72.5), (71, 63)]
    if pk:
        pmask(A.fx, K.m_stroke(pk, 1.5), P["ink"], P["pick"])

    # hair under the hat, sideburn locks, then the hat
    top = K.m_poly([(24.5, 44), (25.5, 28), (34, 19), (48, 16.5), (62, 19), (70.5, 28), (71.5, 44), (66, 36), (61, 41), (55, 35), (49, 40), (42, 35), (36, 41), (30, 36)])
    A.hair.fill(top, P["hair"])
    A.hair.fill(top & ~shift(top, 0, -3), P["hair_sh"])
    for sgn in (1, -1):
        lk = K.m_poly([(69, 36), (74.5, 38), (74, 54), (71.5, 62), (69.5, 52)])
        if sgn == -1:
            lk = K.m_poly(mirx([(69, 36), (74.5, 38), (74, 54), (71.5, 62), (69.5, 52)]))
        A.hair.fill(lk, P["hair"])
        A.hair.fill(rim(lk, 2, 0), P["hair_sh"])
    A.hair.outline(P["ink"])
    hat_xf()
    hat = brim | crown
    A.hair.fill(grow(hat), P["ink"])
    A.hair.fill(crown, P["hat"])
    A.hair.fill(rim(crown, 4, 0), P["hat_sh"])
    A.hair.fill(K.m_poly([(26, 10), (31, 3), (38, 0), (36, 8), (30, 14), (28, 24)]) & crown, P["hat_hl"])
    A.hair.fill(K.m_poly([(44, -2), (48, 1.5), (52, -2), (50, 14), (46, 14)]) & crown, P["hat_sh"])
    bnd = crown & K.m_poly([(10, 24.5), (48, 28), (86, 24.5), (86, 33), (48, 37.5), (10, 33)])
    A.hair.fill(bnd, P["must"])
    A.hair.fill(bnd & ~shift(bnd, 0, -2), P["must_sh"])
    A.hair.fill(brim, P["hat"])
    A.hair.fill(brim & ~shift(brim, 0, -4), P["hat_sh"])
    A.hair.fill(brim & ~shift(brim, 0, 2) & ~crown, P["hat_hl"])
    A.hair.fill(grow(crown) & brim & ~crown, P["ink"])
    card = K.m_poly([(63, 14), (71, 12.5), (72.5, 25), (64.5, 26.5)])
    A.hair.fill(grow(card), P["ink"])
    A.hair.fill(card, P["shirt"])
    A.hair.fill(K.m_poly([(67.8, 15.5), (70, 19), (67.8, 22.5), (65.6, 19)]), P["must_sh"])
    K.set_xf(rot, (48, 80), *off)
    if e == "fierce":           # the hidden eye glints from under the brim
        gl = K.m_stroke([(30, 52.5), (40, 52.5)], 1.4) | K.m_stroke([(35, 48.5), (35, 56.5)], 1.4)
        pmask(A.fx, gl, P["ink"], P["iris_lt"])
        A.fx.fill(K.m_px((35, 52)), WHITE)
        A.feat |= gl
    if e == "shock":
        K.reset_xf()
        shock_lines(A, 48, 26)
        sweat(A, 84, 58)
    elif e == "defeat":
        K.reset_xf()
        sweat(A, 82, 62)
        gloom(A, 6, 58)
    return A.finish(flip=False, outline=("hair_back", "body", "face"))


# ---- 4. Aya: deep pointed hood with a gold crescent, one eye behind her hair, glowing eye (violet / gold)

def build_aya(e):
    P = dict(FX, ink="#1c0c34", line="#a04c68",
             skin="#ffeee2", skin_sh="#e8b8c4", skin_dk="#8a64a6", blush="#ffa4bc",
             hair="#5a2aa0", hair_sh="#341468", hair_hl="#a06ce4", brow="#341468",
             hood="#8044cc", hood_sh="#4c2290", hood_in="#261244",
             gold="#f6ca38", gold_sh="#b87c18",
             ew="#fffbe6", iris="#f0a010", iris_lt="#fff27a", iris_dk="#8c4c08", mouth="#701840", tongue="#f07898",
             gem="#48e0d0")
    A = Art(P)
    rot = {"neutral": 0, "happy": -7, "shock": 0, "defeat": 8, "fierce": 0}[e]
    off = {"neutral": (0, 0), "happy": (0, -1), "shock": (0, -2), "defeat": (0, 5), "fierce": (0, 2)}[e]
    K.set_xf(rot, (48, 84), *off)

    if e == "defeat":           # the peak flops over
        outer = [(60, 6), (74, 0), (86, 6), (82, 12), (74, 13), (81, 28), (86, 48), (91, 72), (98, 112), (-2, 112), (5, 72), (10, 48), (15, 28), (24, 13), (40, 4)]
    else:
        up = -6 if e == "shock" else 0
        outer = [(48, -8 + up), (59, 2), (72, 12), (81, 28), (86, 48), (91, 72), (98, 112), (-2, 112), (5, 72), (10, 48), (15, 28), (24, 12), (37, 2)]
    hood = K.m_blob(outer, 6)
    opening = K.m_blob([(48, 13), (62, 17), (71.5, 29), (75, 48), (73, 66), (67, 81), (57, 96), (39, 96), (29, 81), (23, 66),
                        (21, 48), (24.5, 29), (34, 17)], 6)
    A.hb.fill(hood, P["hood_in"])
    # robe and choker inside the opening
    neck = K.m_poly([(40, 78), (56, 78), (57, 100), (39, 100)])
    A.body.fill(neck, P["skin_sh"])
    ch = K.m_rect(39.5, 88, 56.5, 91.5)
    A.body.fill(ch, P["ink"])
    A.body.fill(K.m_poly([(48, 90), (50.6, 93), (48, 96.5), (45.4, 93)]), P["gem"])
    A.body.fill(K.m_px((47, 92)), WHITE)

    head = K.m_blob([(48, 20), (62, 23), (71, 34), (73.4, 50), (70.4, 64), (62, 76), (52.5, 83.5), (48, 84.6), (43.5, 83.5),
                     (34, 76), (25.6, 64), (22.6, 50), (25, 34), (34, 23)], 6)
    if e == "shock":            # the hair is blown off the hidden eye
        sweep = [(48, 18), (64, 20), (74.5, 32), (79, 44), (84, 52), (76, 49), (70, 41), (62, 36), (54, 34), (46, 31)]
    else:
        sweep = [(48, 18), (64, 20), (74.5, 32), (76.5, 50), (74, 67), (67, 72), (61, 61), (55, 50), (50.5, 40), (46, 31)]
    swp = K.m_poly(sweep)
    bang = K.m_poly([(49, 18), (34, 20), (24, 32), (21.5, 47), (26.5, 45), (30, 37), (34.5, 44.5), (39, 35.5), (44, 42.5), (48.5, 31)])
    strands = K.m_poly([(21.5, 44), (26, 46), (27.5, 70), (24.5, 88), (20.5, 70)]) | K.m_poly([(73, 60), (76.5, 62), (76.5, 86), (72.5, 91), (70.5, 72)])
    fr = swp | bang | strands
    skin_fill(A, head, shift(fr, 0, 2) | shift(~opening, 0, 3) | shift(~opening, -3, 0))
    if e == "fierce":
        dramatic(A, head)
    if e == "happy":
        for bx in (33, 63):
            A.face.fill(K.m_ellipse(bx, 63, 4.4, 1.8) & head, P["blush"], only=[P["skin"], P["skin_sh"]])
    A.face.fill(K.m_px((47, 64), (48, 64.8)), P["line"])
    A.face.fill(K.m_px((30, 62.5)), P["ink"])

    if e == "neutral":
        eye(A, 36, 54, 13.5, 12, "almond", s=-1, lid=0.2, iris=(0.05, 0.05, 0.56, 0.95), glow=True, hl=((-0.5, -0.4, 1.2),), flick=3, lash=2)
        A.face.fill(K.m_stroke([(44.5, 72), (48, 73.4), (51.5, 72)], 1.3, True), P["line"])
    elif e == "happy":
        arc_eye(A, [(29.5, 56), (36, 51), (42.5, 56)], 2.0)
        A.face.fill(K.m_stroke([(42, 71), (45, 73.6), (48, 71.4), (51, 73.6), (54, 71)], 1.3, True), P["line"])
    elif e == "shock":
        eye(A, 36, 53, 13.5, 14.5, "round", s=-1, iris=(0.0, 0.0, 0.36, 0.36), glow=False, hl=((-0.4, -0.4, 0.8),), lash=1, lower=False)
        eye(A, 60, 53, 13.5, 14.5, "round", s=1, iris=(0.0, 0.0, 0.36, 0.36), glow=False, hl=((-0.4, -0.4, 0.8),), lash=1, lower=False)
        mouth(A, [(45, 71), (51, 71), (52.5, 75), (50, 79), (46, 79), (43.5, 75)])
    elif e == "defeat":
        arc_eye(A, [(29.5, 54.5), (36, 57), (42.5, 54.5)], 1.9)
        A.face.fill(K.m_stroke([(44, 74.5), (48, 72.6), (52, 74.5)], 1.3, True), P["line"])
        tear_stream(A, 33, 59, 3, 9)
    else:
        ey = eye(A, 36, 54, 14.5, 14, "almond", s=-1, lid=0.04, tilt=0.12, iris=(0.05, 0.0, 0.5, 0.86), pup=0.2, glow=True, hl=(), flick=3, lash=2)
        A.face.fill(ey["iris"] & K.m_ellipse(35.6, 54, 1.6, 4.4), P["iris_dk"])
        sm = K.m_stroke([(37, 70), (41, 73.6), (48, 75), (55, 73.6), (59, 70)], 1.4, True)
        A.face.fill(sm, P["line"])
        A.face.fill(K.m_poly([(42, 74), (45, 74.6), (43.6, 78)]), WHITE)

    # hair, hood rim, crescent
    A.hair.fill(fr, P["hair"])
    A.hair.fill(rim(swp, 2, 1) | rim(bang, 2, 0) | rim(strands, 2, 0), P["hair_sh"])
    A.hair.fill(K.m_blob([(30, 28), (38, 23.5), (48, 22.5), (60, 24), (68, 29.5), (59, 27.5), (48, 26.5), (38, 27.5)]) & fr, P["hair_hl"], only=P["hair"])
    for pts in ([(52, 30), (58, 42), (64, 56), (68, 68)], [(58, 28), (66, 40), (71, 54), (72, 64)], [(39, 35), (40, 27)], [(30, 37), (32, 28)]):
        A.hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    A.hair.outline(P["ink"])
    rimm = hood & ~opening
    A.hair.fill(rimm, P["hood"])
    A.hair.fill(rimm & ((XX > 48) & shift(opening, 9, 0) | rim(hood, 4, 0)), P["hood_sh"])
    A.hair.fill(K.m_curve([(22, 20), (14, 40), (9, 66), (5, 96)]) | K.m_curve([(74, 20), (82, 40), (87, 66), (91, 96)]), P["hood_sh"], only=P["hood"])
    A.hair.fill(grow(opening) & ~opening & rimm | (shift(opening, 1, 0) | shift(opening, -1, 0) | shift(opening, 0, -1)) & rimm, P["gold"])
    A.hair.fill(grow(grow(opening)) & ~grow(opening) & rimm, P["gold_sh"])
    cx_, cy_ = (48, 11) if e != "defeat" else (52, 15)
    cr_rot = {"happy": 25, "defeat": -30}.get(e, 0)
    c1 = K.m_ellipse(cx_, cy_, 7, 7)
    c2 = K.m_ellipse(cx_ + 2.4 * math.sin(math.radians(cr_rot)), cy_ - 3.2 * math.cos(math.radians(cr_rot)), 5.8, 5.8)
    cres = c1 & ~c2
    A.hair.fill(grow(cres), P["ink"])
    A.hair.fill(cres, P["gold"])
    A.hair.fill(rim(cres, 1, 1), P["gold_sh"])
    if e == "fierce":
        A.hair.fill(K.shrink(cres), P["iris_lt"])
        g2 = K.m_ellipse(61.5, 54.5, 3.6, 2.2)
        pmask(A.fx, g2, P["ink"], P["gold"])
        A.fx.fill(K.m_ellipse(61.5, 54.5, 1.6, 1.0), P["iris_lt"])
        A.feat |= g2
        rays = K.m_stroke([(24, 46), (20, 42)], 1.4) | K.m_stroke([(24, 62), (20, 66)], 1.4) | K.m_stroke([(22, 54), (17, 54)], 1.4)
        pmask(A.fx, rays, P["ink"], P["iris_lt"])

    if e == "neutral":
        brow(A, [(42.5, 45.6), (36, 44.2), (29, 46.2)], 1.5)
    elif e == "happy":
        brow(A, [(42.5, 45), (36, 43), (29, 45.6)], 1.5)
    elif e == "shock":
        brow(A, [(42, 41), (36, 39), (30, 41.6)], 1.5)
        brow(A, [(54, 41), (60, 39), (66, 41.6)], 1.5)
        K.reset_xf()
        shock_lines(A, 82, 16)
        sweat(A, 16, 60, 0.9)
    elif e == "defeat":
        brow(A, [(42.5, 45), (36, 46.6), (29, 49.6)], 1.5)
        K.reset_xf()
        gloom(A, 40, 28)
    else:
        brow(A, [(44, 48.5), (36, 45), (28, 43)], 2.0)
    return A.finish(flip=False, outline=("hair_back", "body", "face"))


# ---- 5. Pochi: two huge buns with dice ties, oversized visor pushed up, giant eyes, gap tooth (orange / green)

def build_pochi(e):
    P = dict(FX, ink="#3c1c0c", line="#b0503c",
             skin="#ffe0c4", skin_sh="#f4ac8c", skin_dk="#b07078", blush="#ff8c8c",
             hair="#ff8c1c", hair_sh="#c0540c", hair_hl="#ffd060", brow="#a04810",
             visor="#30c860", visor_sh="#148048", visor_hl="#b4fcc4",
             ew="#ffffff", iris="#18a050", iris_lt="#98fa98", iris_dk="#0c5030", mouth="#7a1c2c", tongue="#ff8080",
             dice="#fffdf4", dice_sh="#c4c0b4", bow="#e02c44")
    A = Art(P)
    rot = {"neutral": -6, "happy": 7, "shock": 0, "defeat": -3, "fierce": 3}[e]
    off = {"neutral": (0, 2), "happy": (0, 0), "shock": (0, 0), "defeat": (0, 5), "fierce": (0, 4)}[e]
    bun_dy = {"happy": -3, "shock": -5, "defeat": 4}.get(e, 0)

    A.body.fill(K.m_poly([(40, 82), (56, 82), (58, 100), (38, 100)]), P["skin_sh"])
    for pts in ([(24, 100), (30, 92), (42, 89), (47, 96), (47, 100)], [(49, 100), (49, 96), (54, 89), (66, 92), (72, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["dice"])
    bw = K.m_poly([(48, 95), (40, 91), (40, 100), (56, 100), (56, 91)])
    A.body.fill(grow(bw), P["ink"])
    A.body.fill(bw, P["bow"])

    K.set_xf(rot, (48, 82), *off)
    backh = K.m_blob([(48, 5), (66, 10), (78, 28), (81, 52), (77, 70), (68, 80), (28, 80), (19, 70), (15, 52), (18, 28), (30, 10)], 6)
    A.hb.fill(backh, P["hair"])
    A.hb.fill(backh & (YY > 30), P["hair_sh"])
    A.hb.fill(K.m_blob([(34, 11), (48, 7.5), (62, 11), (48, 10)], 5), P["hair_hl"])
    for bx in (14.5, 81.5):
        bun = K.m_ellipse(bx, 21 + bun_dy, 16, 15.5)
        A.hb.fill(grow(bun), P["ink"])
        A.hb.fill(bun, P["hair"])
        A.hb.fill(rim(bun, 4, 4), P["hair_sh"])
        A.hb.fill(K.m_blob([(bx - 10, 17 + bun_dy), (bx - 5, 9.5 + bun_dy), (bx + 3, 8.5 + bun_dy), (bx - 3, 12 + bun_dy), (bx - 7, 18 + bun_dy)], 5) & bun, P["hair_hl"])
        A.hb.fill(K.m_curve([(bx - 8, 26 + bun_dy), (bx - 2, 18 + bun_dy), (bx + 6, 20 + bun_dy), (bx + 6, 27 + bun_dy), (bx, 28 + bun_dy)]), P["hair_sh"], only=P["hair"])

    chin = 4 if e == "shock" else 0
    head = K.m_blob([(48, 24), (64, 27), (74.5, 38), (77, 54), (73.5, 68), (64, 79.5), (53, 85 + chin), (43, 85 + chin), (32, 79.5), (22.5, 68),
                     (19, 54), (21.5, 38), (32, 27)], 6)
    window = [(20, 72), (20, 51), (25.5, 45), (31, 50.5), (38, 42), (45, 50), (52, 42.5), (59, 49.5), (66, 43), (71, 50), (76, 46), (76, 72)]
    cap = K.m_blob([(17.5, 54), (19, 36), (28, 23), (40, 17), (56, 17), (68, 23), (77, 36), (78.5, 54), (48, 56)], 6) & ~K.m_poly(window)
    skin_fill(A, head, shift(cap, 0, 2))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(0, 0), (96, 0), (96, 60), (0, 60)]))
        for bx in (27, 69):     # puffed cheeks
            pf = K.m_ellipse(bx, 72, 7.5, 6)
            A.face.fill(pf, P["skin"])
            A.face.fill(K.m_ellipse(bx, 73, 5, 3), P["blush"])
    elif e != "shock":
        for bx in (27.5, 68.5):
            A.face.fill(K.m_ellipse(bx, 69.5, 5, 2.4) & head, P["blush"], only=[P["skin"], P["skin_sh"]])
    A.face.fill(K.m_px((30, 66), (33, 67.5), (27.5, 68.5), (65, 66), (62, 67.5), (67.5, 68.5)), P["line"], only=[P["skin"], P["skin_sh"], P["blush"]])
    A.face.fill(K.m_px((47, 68.5), (48, 69)), P["line"])

    big = ((-0.5, -0.5, 2.4), (0.5, 0.55, 1.4), (0.55, -0.6, 0.8))
    if e == "neutral":
        eye(A, 34, 59, 15.5, 17, "round", s=-1, iris=(0.0, 0.06, 0.72, 0.94), pup=0.36, hl=big, lash=2)
        eye(A, 62, 59, 15.5, 17, "round", s=1, iris=(0.0, 0.06, 0.72, 0.94), pup=0.36, hl=big, lash=2)
        mouth(A, [(40, 73), (48, 74.6), (56, 73), (54.5, 78.5), (48, 81), (41.5, 78.5)], tongue=(48, 81.5, 4, 2.2))
        A.face.fill(K.m_rect(43, 73.4, 47, 76.6) | K.m_rect(49, 73.4, 53, 76.6), WHITE)
    elif e == "happy":
        arc_eye(A, [(26.5, 62), (34, 54.5), (41.5, 62)], 2.6)
        arc_eye(A, [(54.5, 62), (62, 54.5), (69.5, 62)], 2.6)
        mouth(A, [(37, 71), (48, 73), (59, 71), (57.5, 80), (48, 85), (38.5, 80)], tongue=(48, 84.5, 6.5, 3.4))
        A.face.fill(K.m_rect(42, 72, 47, 76) | K.m_rect(49, 72, 54, 76), WHITE)
    elif e == "shock":
        eye(A, 34, 58, 16, 18, "round", s=-1, iris=(0.0, 0.0, 0.2, 0.2), pup=0.9, hl=(), lash=1, lower=False)
        eye(A, 62, 58, 16, 18, "round", s=1, iris=(0.0, 0.0, 0.2, 0.2), pup=0.9, hl=(), lash=1, lower=False)
        mouth(A, [(44, 73), (52, 73), (54.5, 79), (52, 86), (44, 86), (41.5, 79)], tongue=(48, 86.5, 4.6, 2.6))
        A.face.fill(K.m_rect(44.4, 73.4, 47.2, 76) | K.m_rect(48.8, 73.4, 51.6, 76), WHITE)
    elif e == "defeat":
        arc_eye(A, [(26.5, 58), (30, 60.5), (34, 58.5), (38, 60.5), (41.5, 58)], 2.2)
        arc_eye(A, [(54.5, 58), (58, 60.5), (62, 58.5), (66, 60.5), (69.5, 58)], 2.2)
        mouth(A, [(37, 73.5), (42.5, 71.5), (48, 73.5), (53.5, 71.5), (59, 73.5), (57, 81), (48, 85), (39, 81)], tongue=(48, 84.5, 6, 3))
        A.face.fill(K.m_rect(43, 73.6, 47, 76.4) | K.m_rect(49, 73.6, 53, 76.4), WHITE)
    else:
        st1 = ((-0.45, -0.3, 1.8), (0.4, 0.5, 1.0))
        eye(A, 34, 59.5, 15.5, 15, "round", s=-1, lid=0.2, tilt=0.2, iris=(0.0, 0.1, 0.7, 0.94), pup=0.34, hl=st1, lash=2)
        eye(A, 62, 59.5, 15.5, 15, "round", s=1, lid=0.2, tilt=0.2, iris=(0.0, 0.1, 0.7, 0.94), pup=0.34, hl=st1, lash=2)
        A.face.fill(K.m_stroke([(43, 79), (48, 75.5), (53, 79)], 1.6), P["line"])
        A.face.fill(K.m_rect(49.4, 77.6, 51.8, 80), WHITE)

    # fringe
    A.hair.fill(cap, P["hair"])
    A.hair.fill(cap & shift(K.m_poly(window), 0, -3), P["hair_sh"])
    for x0, y0, x1 in ((38, 42, 37), (52, 42.5, 52), (66, 43, 67)):
        A.hair.fill(K.m_line([(x0, y0), (x1, y0 - 7)]), P["hair_sh"], only=P["hair"])
    A.hair.outline(P["ink"])
    # visor
    vrot, vdx, vdy = {"shock": (-9, 0, -13), "defeat": (15, 3, 6), "happy": (0, 0, -3)}.get(e, (0, 0, 0))
    K.set_xf(rot, (48, 82), *off)
    p = K.xf([(48, 34)])[0]
    K.set_xf(rot + vrot, (48, 34), p[0] - 48 + vdx, p[1] - 34 + vdy)
    vband = K.m_poly([(19, 32), (34, 26.5), (48, 25), (62, 26.5), (77, 32), (77, 37.5), (62, 32.5), (48, 31), (34, 32.5), (19, 37.5)])
    bd = 7 if e == "fierce" else 0      # pulled down hard when she means it
    bill = K.m_blob([(17, 36), (34, 31), (48, 29.5), (62, 31), (79, 36), (86, 43 + bd), (68, 46.5 + bd), (48, 47.5 + bd), (28, 46.5 + bd), (10, 43 + bd)], 6)
    A.hair.fill(grow(vband | bill), P["ink"])
    A.hair.fill(bill, P["visor"])
    A.hair.fill(bill & ~shift(bill, 0, -3), P["visor_sh"])
    A.hair.fill(K.m_poly([(24, 38), (40, 34.5), (42, 37.5), (26, 41.5)]) | K.m_poly([(45, 34.2), (49, 34), (49.6, 37), (46, 37.2)]), P["visor_hl"])
    A.hair.fill(vband, P["visor_sh"])
    A.hair.fill(vband & ~shift(vband, 0, 2), P["visor"])
    K.set_xf(rot, (48, 82), *off)
    # dice hair ties at the foot of each bun
    for dx_, pips in ((20.5, ((0, 0),)), (75.5, ((-1.6, -1.6), (1.6, 1.6)))):
        cy_ = 33.5 + bun_dy * 0.6
        d = K.m_poly([(dx_ - 5, cy_ - 4), (dx_ + 4, cy_ - 5), (dx_ + 5, cy_ + 4), (dx_ - 4, cy_ + 5)])
        A.hair.fill(grow(d), P["ink"])
        A.hair.fill(d, P["dice"])
        A.hair.fill(rim(d, 2, 2), P["dice_sh"])
        for px_, py_ in pips:
            A.hair.fill(K.m_rect(dx_ + px_ - 1, cy_ + py_ - 1, dx_ + px_ + 1, cy_ + py_ + 1), P["bow"])

    bt = 2.0
    if e == "neutral":
        brow(A, [(40, 47.6), (34, 46), (28.5, 47.6)], bt)
        brow(A, [(56, 47.6), (62, 46), (67.5, 47.6)], bt)
    elif e == "happy":
        brow(A, [(40, 48.6), (34, 46), (28.5, 48)], bt)
        brow(A, [(56, 48.6), (62, 46), (67.5, 48)], bt)
        for sx, sy in ((10, 50), (86, 46)):
            pmask(A.fx, star(sx, sy, 5, 1.8), P["ink"], P["hair_hl"])
    elif e == "shock":
        brow(A, [(39.5, 44.6), (34, 42.6), (28.5, 45)], bt)
        brow(A, [(56.5, 44.6), (62, 42.6), (67.5, 45)], bt)
        K.reset_xf()
        shock_lines(A, 12, 46)
        shock_lines(A, 84, 46, flip=True)
    elif e == "defeat":
        brow(A, [(40.5, 49.6), (34, 51), (28, 54)], bt)
        brow(A, [(55.5, 49.6), (62, 51), (68, 54)], bt)
        # fountains of tears
        for sgn in (-1, 1):
            cx_ = 48 + sgn * 22
            f = K.m_stroke([(cx_, 59), (cx_ + sgn * 7, 50), (cx_ + sgn * 15, 49), (cx_ + sgn * 21, 57), (cx_ + sgn * 23, 68)], 3.4, True)
            pmask(A.fx, f, P["ink"], P["sweat"])
            A.fx.fill(K.m_curve([(cx_ + sgn * 3, 55), (cx_ + sgn * 9, 49.5), (cx_ + sgn * 15, 49)]), WHITE, only=P["sweat"])
            for qx, qy in ((cx_ + sgn * 12, 62), (cx_ + sgn * 18, 76), (cx_ + sgn * 6, 68)):
                pmask(A.fx, K.m_ellipse(qx, qy, 1.6, 2.2), P["ink"], P["sweat"])
    else:
        brow(A, [(42, 53), (35, 49.5), (28, 48)], 2.8)
        brow(A, [(54, 53), (61, 49.5), (68, 48)], 2.8)
        K.reset_xf()
        pf = K.m_stroke([(8, 62), (3, 59)], 1.5) | K.m_stroke([(8, 68), (2, 68)], 1.5) | K.m_stroke([(88, 62), (93, 59)], 1.5) | K.m_stroke([(88, 68), (94, 68)], 1.5)
        pmask(A.fx, pf, P["ink"], WHITE)
    return A.finish(flip=False, outline=("hair_back", "body", "face"))


# ---- 6. Goro: pompadour bigger than the cell, cross scar, one thick brow, jaw wider than the skull, gold tooth

def build_goro(e):
    P = dict(FX, ink="#201810", line="#7c3820",
             skin="#eeb078", skin_sh="#c47c4c", skin_dk="#74483c", blush="#e8805c",
             hair="#ffd428", hair_sh="#c88c14", hair_hl="#fffaae", brow="#201810",
             ew="#ffffff", iris="#284460", iris_lt="#8cbce0", iris_dk="#101c2c", mouth="#5c1418", tongue="#e06458",
             gold="#ffb41c", scar="#b03c30", leather="#2e2c38", leather_hl="#626074", stud="#dce0ec")
    A = Art(P)
    rot = {"neutral": 0, "happy": -6, "shock": 0, "defeat": 6, "fierce": 0}[e]
    off = {"neutral": (0, 0), "happy": (0, -2), "shock": (0, -3), "defeat": (1, 4), "fierce": (0, 2)}[e]

    for pts in ([(-4, 100), (0, 86), (16, 84), (26, 96), (27, 100)], [(69, 100), (70, 96), (80, 84), (96, 86), (100, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["leather"])
        A.body.fill(c & ~shift(c, 0, 2), P["leather_hl"])
    for sx, sy in ((6, 90), (14, 90), (82, 90), (90, 90)):
        A.body.fill(K.m_rect(sx - 1.5, sy - 1.5, sx + 1.5, sy + 1.5), P["stud"])
    A.body.fill(K.m_poly([(24, 84), (72, 84), (74, 100), (22, 100)]), P["skin_sh"])

    K.set_xf(rot, (48, 88), *off)
    jaw = 5 if e == "shock" else 0
    head = K.m_poly([(30, 24), (27, 40), (22, 56), (18.5, 68), (20, 78 + jaw), (28, 86.5 + jaw), (40, 90.5 + jaw), (56, 90.5 + jaw), (68, 86.5 + jaw),
                     (76, 78 + jaw), (77.5, 68), (74, 56), (69, 40), (66, 24), (48, 20)])
    ears = K.m_ellipse(22.5, 55, 3.6, 6) | K.m_ellipse(73.5, 55, 3.6, 6)
    A.face.fill(ears, P["skin"])
    sides = K.m_poly([(26, 46), (27, 28), (34, 22), (33, 34), (29.5, 46)]) | K.m_poly(mirx([(26, 46), (27, 28), (34, 22), (33, 34), (29.5, 46)]))
    if e == "defeat":           # the pompadour collapses over one eye
        pomp = K.m_blob([(24, 36), (15, 27), (13, 12), (24, 1), (44, -3), (64, 1), (77, 11), (82, 26), (78, 38), (74, 54), (66, 64),
                         (58, 54), (59, 40), (48, 35), (36, 32)], 7)
    else:
        k = {"shock": -7, "fierce": 4, "happy": -2}.get(e, 0)
        pomp = K.m_blob([(24, 35 + k), (13, 25 + k), (6, 8 + k), (13, -9 + k), (34, -16), (60, -16), (83, -9 + k), (92, 10 + k), (84, 27 + k),
                         (72, 35 + k), (60, 31 + k), (48, 34.5 + k), (36, 31 + k)], 7)
    skin_fill(A, head, shift(pomp, 0, 3) | shift(pomp, 0, 5))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(0, 0), (96, 0), (96, 64), (48, 70), (0, 64)]))
    A.face.fill(rim(head, 0, 3) & (YY > 80), P["skin_sh"])
    # cross scar on the cheek
    sc = K.m_stroke([(24, 64), (33, 73)], 1.6) | K.m_stroke([(33, 64), (24, 73)], 1.6)
    A.face.fill(sc & head, P["scar"])
    # broad nose
    A.face.fill(K.m_curve([(44.5, 61), (42, 69), (45, 71.5)]) | K.m_curve([(51.5, 61), (54, 69), (51, 71.5)]), P["line"])
    A.face.fill(K.m_px((45.5, 70), (50, 70)), P["ink"])

    def tooth(x, y, w=3.4, h=3.6):
        t = K.m_rect(x, y, x + w, y + h)
        A.face.fill(grow(t), P["ink"])
        A.face.fill(t, P["gold"])
        A.face.fill(K.m_px((x + 0.5, y + 0.5)), WHITE)
    sm = dict(lash=1, lower=False, hl=((-0.3, -0.3, 0.8),))
    if e == "neutral":
        eye(A, 37.5, 60, 10, 7, "almond", s=-1, iris=(0.0, 0.0, 0.42, 0.8), **sm)
        eye(A, 58.5, 60, 10, 7, "almond", s=1, iris=(0.0, 0.0, 0.42, 0.8), **sm)
        brow(A, [(28, 52), (39, 55), (48, 56.5), (57, 55), (68, 52)], 4.2)
        A.face.fill(K.m_stroke([(33, 81.5), (40, 79.5), (56, 79.5), (63, 81.5)], 1.7, True), P["line"])
        tooth(53, 76.4)
    elif e == "happy":
        arc_eye(A, [(32, 61.5), (37.5, 57.5), (43, 61.5)], 2.2)
        arc_eye(A, [(53, 61.5), (58.5, 57.5), (64, 61.5)], 2.2)
        brow(A, [(28, 52.5), (38, 48.5), (48, 52.5), (58, 48.5), (68, 52.5)], 4.0)
        mouth(A, [(30, 75), (48, 77.5), (66, 75), (64, 84), (48, 89), (32, 84)], teeth_top=[(20, 70), (76, 70), (76, 80), (20, 80)],
              tongue=(48, 89, 9, 3.4))
        tooth(52, 76.6, 4, 3.6)
        pmask(A.fx, star(60, 73, 4.4, 1.4), P["ink"], WHITE)
    elif e == "shock":
        eye(A, 37.5, 58, 11.5, 12, "round", s=-1, iris=(0.0, 0.0, 0.26, 0.26), pup=0.9, lash=1, lower=False, hl=())
        eye(A, 58.5, 58, 11.5, 12, "round", s=1, iris=(0.0, 0.0, 0.26, 0.26), pup=0.9, lash=1, lower=False, hl=())
        brow(A, [(29, 46), (39, 44.5), (48, 46.5), (57, 44.5), (67, 46)], 3.6)
        mouth(A, [(37, 77), (59, 77), (61, 86), (57, 94), (39, 94), (35, 86)], teeth_top=[(20, 70), (76, 70), (76, 80.4), (20, 80.4)],
              tongue=(48, 94, 8, 3.6), smooth=False)
        tooth(52, 77.4, 4, 3.4)
    elif e == "defeat":
        arc_eye(A, [(32, 60), (37.5, 62.5), (43, 60.5)], 2.0)
        brow(A, [(28, 58), (38, 52.5), (48, 51.5), (58, 52.5), (68, 58)], 4.0)
        A.face.fill(K.m_stroke([(33, 81), (37.5, 79), (42.5, 81.5), (48, 79), (53.5, 81.5), (58.5, 79), (63, 81)], 1.6), P["line"])
        tear_stream(A, 35, 64, 3.4, 9)
    else:
        for ex in (37.5, 58.5):
            gl = K.m_ellipse(ex, 61, 3.4, 2.2)
            A.face.fill(grow(gl), P["ink"])
            A.face.fill(gl, WHITE)
            A.face.fill(K.m_px((ex, 60.5)), P["iris_dk"])
            A.feat |= gl
        brow(A, [(26, 46), (38, 55), (48, 60.5), (58, 55), (70, 46)], 5.2)
        mouth(A, [(30, 75), (48, 73.5), (66, 75), (67, 85), (48, 87), (29, 85)], teeth_top=[(0, 0), (96, 0), (96, 100), (0, 100)], smooth=False)
        g = K.m_poly([(30, 75), (48, 73.5), (66, 75), (67, 85), (48, 87), (29, 85)])
        A.face.fill(g & K.m_stroke([(29, 80.5), (67, 80.5)], 1.2), P["line"])
        for tx in (35, 41, 47, 53, 59):
            A.face.fill(g & K.m_line([(tx, 72), (tx, 90)]), P["line"])
        A.face.fill(g & K.m_rect(53.6, 75, 59, 80), P["gold"])
        A.face.fill(K.m_curve([(40, 70), (36, 72.5), (33, 72)]) | K.m_curve([(56, 70), (60, 72.5), (63, 72)]), P["line"])

    # hair
    A.hair.fill(sides, P["hair_sh"])
    A.hair.outline(P["ink"])
    A.hair.fill(grow(pomp), P["ink"])
    A.hair.fill(pomp, P["hair"])
    A.hair.fill(pomp & ~shift(pomp, 0, -6), P["hair_sh"])
    if e == "defeat":
        A.hair.fill(K.m_blob([(22, 14), (30, 5), (46, 2), (60, 5), (48, 7), (34, 10), (26, 18)], 6) & pomp, P["hair_hl"])
        for pts in ([(22, 26), (36, 20), (54, 20), (68, 26), (72, 44), (66, 58)], [(30, 30), (44, 26), (58, 28), (64, 40)]):
            A.hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    else:
        A.hair.fill(K.m_blob([(14, 12 + k), (22, 0 + k), (40, -5 + k), (60, -4 + k), (74, 2 + k), (58, 2 + k), (40, 3 + k), (26, 8 + k), (19, 18 + k)], 6) & pomp, P["hair_hl"])
        for pts in ([(14, 22 + k), (30, 14 + k), (50, 12 + k), (70, 15 + k), (84, 24 + k)], [(24, 30 + k), (38, 23 + k), (56, 22 + k), (72, 28 + k)]):
            A.hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    if e == "shock":
        K.reset_xf()
        shock_lines(A, 10, 44)
        sweat(A, 86, 56)
    elif e == "defeat":
        K.reset_xf()
        gloom(A, 6, 40)
        sweat(A, 12, 66, 0.9)
    elif e == "fierce":         # anger vein and sparks off the pompadour
        v = K.m_stroke([(76, 44), (80, 47.5), (84, 44)], 1.6) | K.m_stroke([(76, 55), (80, 51.5), (84, 55)], 1.6) | \
            K.m_stroke([(74.5, 46), (77.5, 49.5), (74.5, 53)], 1.6) | K.m_stroke([(85.5, 46), (82.5, 49.5), (85.5, 53)], 1.6)
        pmask(A.fx, v, P["ink"], P["scar"])
        for pts in ([(6, 36), (11, 40), (7, 42), (13, 47)], [(90, 30), (86, 35), (91, 36), (87, 42)]):
            pmask(A.fx, K.m_stroke(pts, 1.5), P["ink"], P["hair_hl"])
    return A.finish(flip=False, outline=("hair_back", "body", "face"))


# ---- 7. Yuki: long narrow face, folding fan over the mouth, camellia, straight fringe, eyes almost shut

def build_yuki(e):
    P = dict(FX, ink="#222a58", line="#a8587c",
             skin="#fff4ee", skin_sh="#e6c4d4", skin_dk="#8c80b8", blush="#ffb4c8",
             hair="#f4f6ff", hair_sh="#aab6e0", brow="#7c88bc",
             ew="#ffffff", iris="#3c8ce0", iris_lt="#c0eeff", iris_dk="#183c80", mouth="#7a2850", lip="#e04870",
             fan="#2c3a98", fan_sh="#1a2264", fan_hl="#5c74d8",
             red="#e02c4c", red_sh="#901838", gold="#f4cc50", leaf="#2c8c58")
    A = Art(P)
    rot = {"neutral": -3, "happy": 7, "shock": 4, "defeat": -11, "fierce": -6}[e]
    off = {"neutral": (-2, 0), "happy": (-2, -1), "shock": (2, -3), "defeat": (-5, 6), "fierce": (-3, 2)}[e]

    for pts in ([(16, 100), (24, 90), (36, 86), (42, 94), (43, 100)], [(52, 100), (55, 92), (64, 84), (78, 90), (88, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["fan"])
        A.body.fill(c & ~shift(c, 0, 3), P["hair"])
        A.body.fill(c & shift(c, 0, 3) & ~shift(c, 0, 4), P["red"])
    A.body.fill(K.m_poly([(38, 82), (56, 78), (58, 100), (36, 100)]), P["skin_sh"])

    K.set_xf(rot, (46, 84), *off)
    curtain = K.m_poly([(23, 20), (19, 40), (17, 70), (13, 118), (88, 118), (83, 70), (80, 40), (75, 20), (48, 5)])
    A.hb.fill(curtain, P["hair"])
    A.hb.fill(rim(curtain, 3, 0) | (curtain & (XX > 26) & (XX < 72) & (YY > 40)), P["hair_sh"])
    for x in (20, 79):
        A.hb.fill(K.m_line([(x, 44), (x - 2 if x < 48 else x + 2, 100)]), P["hair_sh"], only=P["hair"])
    # two long hairpins cross behind the head
    for pts, bead in (([(60, 20), (88, -2)], (86, -0.5)), ([(66, 26), (95, 14)], (92.5, 15))):
        st = K.m_stroke(pts, 2.2)
        A.hb.fill(grow(st), P["ink"])
        A.hb.fill(st, P["gold"])
        bd = K.m_ellipse(bead[0], bead[1], 3.2, 3.2)
        A.hb.fill(grow(bd), P["ink"])
        A.hb.fill(bd, P["red"])

    head = K.m_blob([(31, 20), (27, 34), (25.8, 46), (25.2, 56), (27, 66), (31, 76), (36.5, 85.5), (41.5, 88.5), (47.5, 86.5), (56.5, 79),
                     (64.5, 68), (69, 56), (70.5, 40), (67.5, 24), (48, 15)], 5)
    capo = K.m_blob([(22, 50), (23.5, 26), (33, 12), (48, 7), (64, 9), (75, 20), (78.5, 40), (78, 50), (48, 50)], 6)
    fr = capo & K.m_poly([(0, 0), (96, 0), (96, 46.5), (0, 44)])
    side_n = K.m_poly([(66.5, 40), (78.5, 40), (79.5, 77), (67.5, 77)])
    side_f = K.m_poly([(21.5, 40), (27.5, 40), (26.5, 72), (21, 72)])
    front = fr | side_n | side_f
    skin_fill(A, head, shift(front, 0, 2))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(0, 0), (96, 0), (96, 66), (0, 66)]))
    if e == "happy":
        for bx, by in ((30, 65), (58, 66)):
            A.face.fill(K.m_ellipse(bx, by, 4, 1.6) & head, P["blush"], only=[P["skin"], P["skin_sh"]])
    A.face.fill(K.m_curve([(38.4, 65.5), (37, 69.5), (40, 71)]), P["line"])

    lf = dict(flick=3, lash=2, lower=False)
    if e == "neutral":
        eye(A, 32, 56.5, 9.5, 9, "almond", s=-1, lid=0.6, iris=(0.2, 0.3, 0.6, 0.9), hl=(), **lf)
        eye(A, 55, 57.5, 13.5, 9.5, "almond", s=1, lid=0.6, iris=(-0.2, 0.3, 0.6, 0.9), hl=(), **lf)
    elif e == "happy":
        arc_eye(A, [(27.5, 58), (32, 54.5), (36.5, 57.5)], 1.9)
        arc_eye(A, [(48.5, 59), (55, 54.5), (62, 58)], 2.0)
    elif e == "shock":
        eye(A, 32, 56, 10, 13.5, "round", s=-1, iris=(0.15, 0, 0.42, 0.42), hl=((-0.4, -0.4, 0.8),), lash=1, lower=False)
        eye(A, 55, 57, 14, 14.5, "round", s=1, iris=(-0.15, 0, 0.42, 0.42), hl=((-0.4, -0.4, 0.8),), lash=1, lower=False)
    elif e == "defeat":
        arc_eye(A, [(27.5, 57), (32, 59), (36.5, 57.5)], 1.8)
        arc_eye(A, [(48.5, 58), (55, 60), (62, 58)], 1.8)
    else:
        eye(A, 32, 56.5, 10, 10, "almond", s=-1, lid=0.3, tilt=0.2, iris=(0.2, 0.15, 0.5, 0.9), pup=0.3, hl=((-0.3, -0.1, 1.0),), glow=True, **lf)
        eye(A, 55, 57.5, 14, 10.5, "almond", s=1, lid=0.3, tilt=0.2, iris=(-0.2, 0.15, 0.5, 0.9), pup=0.3, hl=((-0.3, -0.1, 1.0),), glow=True, **lf)
    if e == "shock":
        mouth(A, [(38.5, 76), (43, 76), (44, 79.5), (42, 82.5), (39, 82.5), (37.5, 79.5)], lip=P["lip"])
    elif e == "defeat":
        A.face.fill(K.m_stroke([(37.5, 80), (41, 78.4), (45, 80)], 1.4, True), P["lip"])
    else:
        A.face.fill(K.m_stroke([(38, 78.5), (41, 79.6), (44.5, 78.5)], 1.4, True), P["lip"])

    # hair in front
    A.hair.fill(front, P["hair"])
    A.hair.fill(rim(side_n, 3, 0) | rim(side_f, 2, 0) | (fr & ~shift(fr, 0, -2)), P["hair_sh"])
    for x in range(30, 72, 6):
        A.hair.fill(K.m_line([(x, 45), (x + (x - 48) * 0.06, 36)]), P["hair_sh"], only=P["hair"])
    A.hair.fill(K.m_curve([(28, 30), (38, 21), (52, 18), (66, 22), (74, 30)]), P["hair_sh"], only=P["hair"])
    if e in ("defeat", "shock"):    # a strand comes loose
        sd = K.m_stroke([(60, 12), (65, 3), (72, 0)] if e == "defeat" else [(40, 12), (36, 2), (30, -3)], 1.8, True)
        A.hair.fill(sd, P["hair"])
    A.hair.outline(P["ink"])
    # camellia
    fx_, fy_ = 71, 22
    lv = K.m_poly([(fx_ + 4, fy_ + 4), (fx_ + 15, fy_ + 6), (fx_ + 9, fy_ + 13)]) | K.m_poly([(fx_ - 3, fy_ + 6), (fx_ - 4, fy_ + 17), (fx_ + 4, fy_ + 11)])
    A.hair.fill(grow(lv), P["ink"])
    A.hair.fill(lv, P["leaf"])
    pet = [K.m_ellipse(fx_ + 5.2 * math.cos(math.radians(-90 + i * 72)), fy_ + 5.2 * math.sin(math.radians(-90 + i * 72)), 4.6, 4.6) for i in range(5)]
    allp = K.empty()
    for p_ in pet:
        allp |= p_
    A.hair.fill(grow(allp), P["ink"])
    for p_ in pet:
        A.hair.fill(p_, P["red"])
        A.hair.fill(rim(p_, 2, 2), P["red_sh"])
    A.hair.fill(K.m_ellipse(fx_, fy_, 2.6, 2.6), P["gold"])
    A.hair.fill(K.m_px((fx_ - 1, fy_ - 1)), WHITE)

    bt = 1.5
    if e == "neutral":
        brow(A, [(36, 48.6), (32, 47.2), (27.5, 48.4)], bt)
        brow(A, [(48.5, 49.4), (55, 47.6), (62, 48.8)], bt)
    elif e == "happy":
        brow(A, [(36, 47.6), (32, 46), (27.5, 47.8)], bt)
        brow(A, [(48.5, 48.4), (55, 46), (62, 48)], bt)
    elif e == "shock":
        brow(A, [(36, 44.6), (32, 43), (28, 45)], bt)
        brow(A, [(49, 45), (55, 43), (61.5, 45.4)], bt)
    elif e == "defeat":
        brow(A, [(36, 49), (32, 50.4), (27.5, 53)], bt)
        brow(A, [(48.5, 50), (55, 51.4), (62, 54.4)], bt)
    else:
        brow(A, [(37.5, 52), (32, 49), (27, 47.4)], 2.0)
        brow(A, [(47, 53), (55, 49.4), (63, 47)], 2.0)

    # the fan (drawn straight, in front of everything)
    K.reset_xf()

    def fan_open(px, py, r, a0, a1, tilt=0.0):
        K.set_xf(tilt, (px, py))
        pts = [(px, py)]
        n = 9
        for i in range(n * 2 + 1):
            a = math.radians(a0 + (a1 - a0) * i / (n * 2))
            rr = r if i % 2 == 0 else r - 2.2
            pts.append((px + rr * math.cos(a), py + rr * math.sin(a)))
        f = K.m_poly(pts)
        A.fx.fill(grow(f), P["ink"])
        A.fx.fill(f, P["fan"])
        inner = K.m_ellipse(px, py, r - 7, r - 7)
        A.fx.fill(f & ~inner, P["hair"])
        A.fx.fill(f & ~K.m_ellipse(px, py, r - 5.4, r - 5.4) & inner, P["red"])
        A.fx.fill(f & K.m_ellipse(px, py, r * 0.42, r * 0.42), P["fan_sh"])
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            A.fx.fill(K.m_line([(px + r * 0.42 * math.cos(a), py + r * 0.42 * math.sin(a)), (px + (r - 7.5) * math.cos(a), py + (r - 7.5) * math.sin(a))]),
                      P["fan_hl"], only=P["fan"])
        for a_, rr in ((238, 0.66), (262, 0.74), (288, 0.64), (312, 0.72)):
            a = math.radians(a_)
            A.fx.fill(K.m_ellipse(px + r * rr * math.cos(a), py + r * rr * math.sin(a), 1.7, 1.7) & f, P["hair"])
        K.reset_xf()
    if e == "neutral":
        fan_open(50, 118, 45, 208, 332)
    elif e == "happy":
        fan_open(52, 118, 46, 208, 332, tilt=-9)
    elif e == "shock":
        fan_open(50, 134, 45, 215, 325, tilt=14)
    elif e == "defeat":         # snapped shut
        st = K.m_poly([(70, 104), (76, 104), (88, 66), (83.5, 64.5)])
        A.fx.fill(grow(st), P["ink"])
        A.fx.fill(st, P["fan"])
        A.fx.fill(K.m_line([(72, 102), (84.5, 66)]), P["hair"])
        A.fx.fill(K.m_line([(75, 102), (87, 67)]), P["fan_sh"])
    else:
        fan_open(49, 111, 45, 206, 334)
        for sx, sy, r in ((12, 40, 5), (86, 52, 4), (8, 58, 3)):
            pmask(A.fx, star(sx, sy, r, r * 0.3, rot=0) | star(sx, sy, r * 0.7, r * 0.25, rot=45), P["ink"], WHITE)
    if e == "shock":
        shock_lines(A, 16, 24, flip=False)
        sweat(A, 14, 58, 0.9)
    elif e == "defeat":
        gloom(A, 30, 10)
    return A.finish(flip=True, outline=("hair_back", "body", "face"))


# ---- 8. Zeno: lightning-bolt hair, giant goggles whose lenses change, wall-to-wall grin (teal / lime)

def build_zeno(e):
    P = dict(FX, ink="#0c2830", line="#8c4838",
             skin="#f6dcc0", skin_sh="#d8a888", skin_dk="#84708c", blush="#f8a088",
             hair="#14c4b0", hair_sh="#0a7c84", hair_hl="#a4fde8", brow="#0a5c64",
             lime="#b8f224", lime_sh="#6ca010", lens="#e6fdf2", lens_sh="#98dcc8", strap="#3c3650",
             mouth="#5c1830", tongue="#e87078",
             coat="#f4f6fa", coat_sh="#b0bcd0")
    A = Art(P)
    rot = {"neutral": 9, "happy": -9, "shock": 0, "defeat": 14, "fierce": -5}[e]
    off = {"neutral": (0, 4), "happy": (0, 3), "shock": (0, 2), "defeat": (2, 9), "fierce": (0, 6)}[e]

    for pts in ([(18, 100), (26, 92), (40, 88), (46, 97), (46, 100)], [(50, 100), (50, 97), (56, 88), (70, 92), (78, 100)]):
        c = K.m_poly(pts)
        A.body.fill(grow(c), P["ink"])
        A.body.fill(c, P["coat"])
        A.body.fill(rim(c, 3, 2), P["coat_sh"])
    A.body.fill(K.m_poly([(41, 84), (55, 84), (56, 100), (40, 100)]), P["skin_sh"])
    bw = K.m_poly([(48, 96), (41, 92.5), (41, 100), (55, 100), (55, 92.5)])
    A.body.fill(grow(bw), P["ink"])
    A.body.fill(bw, P["lime"])

    K.set_xf(rot, (48, 88), *off)
    # lightning bolts of hair
    BOLT = [(-6, 2), (-2.5, -15), (-7.5, -15), (3, -38), (1, -21), (6.5, -21), (5, 2)]
    if e == "defeat":
        spec = ((27, 26, -78, 0.62), (40, 20, -42, 0.6), (56, 20, 40, 0.6), (69, 26, 76, 0.62))
    else:
        k = {"fierce": 1.14, "shock": 1.2}.get(e, 1.0)
        spec = ((26, 28, -30, 0.9 * k), (40, 21, -9, 1.08 * k), (56, 21, 9, 1.08 * k), (70, 28, 30, 0.9 * k))
    bolts = K.empty()
    for bx, by, ang, sc in spec:
        c_, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        bolts |= K.m_poly([(bx + (x * c_ - y * s_) * sc, by + (x * s_ + y * c_) * sc) for x, y in BOLT])
    A.hb.fill(bolts, P["hair"])
    A.hb.fill(rim(bolts, 2, 0), P["hair_sh"])
    A.hb.fill(tips(bolts, 5) & ~rim(bolts, 2, 0), P["hair_hl"])
    tuft = [(26, 36), (12, 31), (19, 40), (8, 45), (20, 48), (12, 56), (26, 54)]
    tf = K.m_poly(tuft) | K.m_poly(mirx(tuft))
    A.hb.fill(tf, P["hair"])
    A.hb.fill(rim(tf, 2, 2), P["hair_sh"])

    head = K.m_poly([(28, 22), (24.5, 38), (23.5, 54), (27, 66), (34, 78), (43, 88.5), (48, 91), (53, 88.5), (62, 78), (69, 66),
                     (72.5, 54), (71.5, 38), (68, 22), (48, 16)])
    cap = K.m_poly([(23.5, 37), (25.5, 21), (36, 14), (48, 12), (60, 14), (70.5, 21), (72.5, 37), (66, 28), (60, 33.5), (54, 27), (48, 32.5),
                    (42, 27), (36, 33.5), (30, 28)])
    skin_fill(A, head, shift(cap, 0, 2))
    if e == "fierce":
        dramatic(A, head & K.m_poly([(0, 0), (96, 0), (96, 70), (0, 70)]))
    A.face.fill(K.m_curve([(48, 64), (46, 70), (49.5, 71)]), P["line"])
    if e == "happy":
        for bx in (27.5, 68.5):
            A.face.fill(K.m_ellipse(bx, 72, 3.4, 1.6) & head, P["blush"], only=[P["skin"], P["skin_sh"]])

    # mouth
    def teeth_lines(m, xs, mid=None):
        for tx in xs:
            A.face.fill(m & K.m_line([(tx, 60), (tx, 96)]), P["line"])
        if mid:
            A.face.fill(m & K.m_curve(mid), P["line"])
    if e == "neutral":
        g = [(29, 73), (38, 75.5), (48, 76.2), (58, 75.5), (67, 73), (63, 80.5), (55, 85), (48, 86), (41, 85), (33, 80.5)]
        m = mouth(A, g, teeth_top=[(0, 0), (96, 0), (96, 100), (0, 100)])
        teeth_lines(m, (35, 40, 45, 51, 56, 61), [(30, 77), (40, 80.4), (48, 81), (56, 80.4), (66, 77)])
    elif e == "happy":
        g = [(30, 72), (48, 75), (66, 72), (63, 82), (55, 87.5), (48, 88.5), (41, 87.5), (33, 82)]
        m = mouth(A, g, teeth_top=[(0, 0), (96, 0), (96, 78.5), (0, 78.5)], tongue=(48, 88, 8, 3.6))
        teeth_lines(m & (YY < 79 + 20), ())
        for tx in (36, 42, 48, 54, 60):
            A.face.fill(m & K.m_line([(tx, 70), (tx, 77.6)]), P["line"])
    elif e == "shock":
        m = mouth(A, [(41, 76), (55, 76), (57, 81), (54, 87), (42, 87), (39, 81)],
                  teeth_top=[(0, 0), (96, 0), (96, 79), (0, 79)], teeth_bot=[(0, 84.6), (96, 84.6), (96, 100), (0, 100)], smooth=False)
        for tx in (44.5, 48, 51.5):
            A.face.fill(m & K.m_line([(tx, 70), (tx, 95)]), P["line"], only=WHITE)
    elif e == "defeat":
        A.face.fill(K.m_stroke([(31, 79), (35.5, 76.5), (40, 79.5), (44.5, 76.5), (49, 79.5), (53.5, 76.5), (58, 79.5), (62.5, 76.5), (66, 78.5)], 1.6), P["line"])
    else:                       # shark grin
        g = [(27, 71), (38, 75.5), (48, 76.5), (58, 75.5), (69, 71), (65, 81), (56, 86.5), (48, 87.5), (40, 86.5), (31, 81)]
        m = mouth(A, g)
        zt = [(27, 70)]
        for i, x in enumerate(range(29, 69, 4)):
            zt += [(x, 72.5 + abs(x - 48) * -0.12 + 3), (x + 2, 79.5 - abs(x + 2 - 48) * 0.1)]
        zt.append((69, 70))
        zb = [(29, 92)]
        for i, x in enumerate(range(31, 67, 4)):
            zb += [(x, 87 - abs(x - 48) * 0.28 + 0), (x + 2, 80.5 - abs(x + 2 - 48) * 0.1)]
        zb.append((67, 92))
        A.face.fill(m & K.m_poly(zt), WHITE)
        A.face.fill(m & K.m_poly(zb), WHITE)

    A.hair.fill(cap, P["hair"])
    A.hair.fill(cap & ~shift(cap, 0, -3), P["hair_sh"])
    A.hair.fill(tips(cap, 3), P["hair_hl"])
    A.hair.outline(P["ink"])

    # goggles
    gy = 54
    crack = e == "defeat"
    strap = K.m_stroke([(21, gy - 2), (75, gy - 2)], 5.0)
    A.fx.fill(grow(strap) & (head | cap), P["ink"])
    A.fx.fill(strap & (head | cap), P["strap"])
    for gx in (35, 61):
        rimo = K.m_ellipse(gx, gy, 14.6, 14.6)
        lens = K.m_ellipse(gx, gy, 11.6, 11.6)
        A.fx.fill(grow(rimo), P["ink"])
        A.fx.fill(rimo, P["lime"])
        A.fx.fill(rim(rimo, 3, 3) & ~lens, P["lime_sh"])
        A.fx.fill(grow(lens), P["ink"])
        A.fx.fill(lens, P["lens"] if e != "fierce" else P["lime"])
        A.fx.fill(rim(lens, 3, 3), P["lens_sh"] if e != "fierce" else P["lime_sh"])
        A.feat |= K.m_ellipse(gx, gy, 9.5, 9.5)
        left = gx < 48
        if e == "neutral":      # spirals
            pts = []
            for i in range(60):
                t = i / 59.0
                a = t * 5.2 * math.pi * (1 if left else -1)
                pts.append((gx + (1 + 8.6 * t) * math.cos(a), gy + (1 + 8.6 * t) * math.sin(a)))
            A.fx.fill(K.m_line(pts) & lens, P["hair_sh"])
        elif e == "happy":
            A.fx.fill(K.m_stroke([(gx - 6.5, gy + 3), (gx, gy - 4.5), (gx + 6.5, gy + 3)], 2.4, True), P["ink"])
            A.fx.fill(K.m_poly([(gx - 9, gy - 2), (gx - 3, gy - 9), (gx - 1.5, gy - 9), (gx - 9, gy + 0.5)]) & lens, WHITE, only=P["lens"])
        elif e == "shock":      # exclamation marks
            A.fx.fill(K.m_poly([(gx - 2.4, gy - 8), (gx + 2.4, gy - 8), (gx + 1.2, gy + 2.4), (gx - 1.2, gy + 2.4)]) | K.m_ellipse(gx, gy + 6.2, 1.9, 1.9), P["ink"])
        elif e == "defeat":
            if left:            # cracked lens
                for pts in ([(gx - 9, gy - 7), (gx - 3, gy - 2), (gx - 5, gy + 2), (gx + 1, gy + 4), (gx + 6, gy + 10)],
                            [(gx - 3, gy - 2), (gx + 3, gy - 5), (gx + 9, gy - 4)], [(gx - 5, gy + 2), (gx - 10, gy + 5)], [(gx + 1, gy + 4), (gx - 1, gy + 10)]):
                    A.fx.fill(K.m_line(pts) & lens, P["ink"])
                sh = K.m_poly([(gx + 3, gy - 5), (gx + 9, gy - 4), (gx + 8, gy - 10)]) & lens
                A.fx.fill(sh, P["skin_sh"])
            else:
                A.fx.fill((K.m_stroke([(gx - 5, gy - 5), (gx + 5, gy + 5)], 2.0) | K.m_stroke([(gx + 5, gy - 5), (gx - 5, gy + 5)], 2.0)), P["ink"])
        else:                   # glare with small wicked eyes
            sg = 1 if left else -1
            A.fx.fill(K.m_poly([(gx - sg * 7, gy - 5.5), (gx + sg * 6.5, gy + 1.5), (gx + sg * 5, gy + 5), (gx - sg * 6, gy + 2.5)]), P["ink"])
            A.fx.fill(K.m_px((gx - sg * 1, gy + 0.2), (gx, gy + 0.2)), WHITE)
            A.fx.fill(K.m_poly([(gx - 10, gy - 4), (gx - 3, gy - 11), (gx - 0.5, gy - 11), (gx - 10, gy - 0.5)]) & lens, P["lens"], only=P["lime"])
    br = K.m_stroke([(46, gy - 2), (50, gy - 2)], 3.0)
    A.fx.fill(grow(br), P["ink"])
    A.fx.fill(br, P["lime_sh"])

    # zigzag brows over the goggles
    def zb(pts, t=1.8):
        brow(A, pts, t)
    if e == "neutral":
        A.fx.fill(K.m_stroke([(26, 37.5), (33, 34), (41, 36.5)], 2.0), P["brow"])
        A.fx.fill(K.m_stroke([(55, 33.5), (63, 29.5), (70, 33)], 2.0), P["brow"])
    elif e == "happy":
        A.fx.fill(K.m_stroke([(26, 35), (33, 31.5), (41, 34.5)], 2.0) | K.m_stroke([(55, 34.5), (63, 31.5), (70, 35)], 2.0), P["brow"])
    elif e == "shock":
        A.fx.fill(K.m_stroke([(27, 32), (33, 29), (40, 32)], 2.0) | K.m_stroke([(56, 32), (63, 29), (69, 32)], 2.0), P["brow"])
        K.reset_xf()
        shock_lines(A, 10, 54)
        shock_lines(A, 86, 54, flip=True)
    elif e == "defeat":
        A.fx.fill(K.m_stroke([(40, 34), (33, 35.5), (26, 39)], 2.0) | K.m_stroke([(56, 34), (63, 35.5), (70, 39)], 2.0), P["brow"])
        K.reset_xf()
        puff = K.m_ellipse(20, 12, 6, 5) | K.m_ellipse(27, 8, 5, 4.4) | K.m_ellipse(14, 7, 4, 3.6)
        pmask(A.fx, puff, P["ink"], P["coat_sh"])
    else:
        A.fx.fill(K.m_stroke([(42, 40), (34, 34.5), (25, 32)], 2.6) | K.m_stroke([(54, 40), (62, 34.5), (71, 32)], 2.6), P["brow"])
        K.reset_xf()
        for pts in ([(6, 30), (12, 35), (7, 37), (14, 43)], [(90, 26), (85, 31), (90, 33), (84, 39)], [(4, 60), (9, 63), (5, 66)]):
            pmask(A.fx, K.m_stroke(pts, 1.5), P["ink"], P["lime"])
    return A.finish(flip=False, outline=("hair_back", "body", "face"))


# ---- 9. Onyx: half-white half-black harlequin mask, one glowing red eye, diamond tear, collar spikes

def build_onyx(e):
    P = dict(FX, ink="#100a18", line="#6c3c58",
             skin="#f0e0dc", skin_sh="#c8a8b8", skin_dk="#74587c",
             hair="#2e2a44", hair_sh="#181424", hair_hl="#706c9c", brow="#181424",
             ivory="#f8f4ec", ivory_sh="#beb6c8", black="#261e34", black_hl="#4e4268",
             red="#e01838", red_lt="#ff7a6c", red_dk="#7c0c24", gold="#f6c83c", gold_sh="#b07818")
    A = Art(P)
    rot = {"neutral": -5, "happy": 7, "shock": 0, "defeat": 9, "fierce": -3}[e]
    off = {"neutral": (0, -4), "happy": (0, -6), "shock": (0, -6), "defeat": (2, 2), "fierce": (0, -2)}[e]

    # collar spikes behind the head (drawn straight), crimson lining
    flare = {"fierce": 1.12, "shock": 1.08, "defeat": 0.86}.get(e, 1.0)
    sp = [(30, 104), (25, 76), (17, 56), (8, 30), (8, 54), (-2, 36), (2, 64), (-8, 56), (-3, 86), (4, 104)]
    sp = [(x, 104 + (y - 104) * flare) for x, y in sp]
    wings = K.m_poly(sp) | K.m_poly(mirx(sp))
    A.hb.fill(wings, P["black"])
    lin = K.shrink(K.shrink(wings))
    A.hb.fill(lin, P["red"])
    A.hb.fill(lin & (np.abs(XX - 48) < 34), P["red_dk"])
    A.hb.fill(wings & ~K.shrink(wings) & ~shift(wings, 0, 1), P["gold"])
    cape = K.m_poly([(28, 100), (34, 88), (62, 88), (68, 100)])
    A.body.fill(cape, P["black"])
    A.body.fill(K.m_poly([(40, 84), (56, 84), (57, 100), (39, 100)]), P["skin_sh"])
    cl = K.m_poly([(48, 92), (52, 96.5), (48, 101), (44, 96.5)])
    A.body.fill(grow(cl), P["ink"])
    A.body.fill(cl, P["gold"])

    K.set_xf(rot, (48, 88), *off)
    tails = [(25, 40), (20, 54), (15, 68), (22, 64), (20, 76), (28, 68), (28, 44)]
    th = K.m_poly(tails) | K.m_poly(mirx(tails))
    A.hb.fill(grow(th), P["ink"])
    A.hb.fill(th, P["hair"])
    A.hb.fill(rim(th, 2, 2), P["hair_sh"])

    head = K.m_poly([(28, 24), (24, 40), (23, 54), (25.5, 66), (32, 77), (40.5, 87.5), (48, 94), (55.5, 87.5), (64, 77), (70.5, 66),
                     (73, 54), (72, 40), (68, 24), (48, 18)])
    ears = K.m_ellipse(22.6, 55, 3.2, 6.2) | K.m_ellipse(73.4, 55, 3.2, 6.2)
    A.face.fill(ears, P["skin"])
    cap = K.m_poly([(22.5, 40), (24.5, 23), (33, 12.5), (48, 8), (63, 12.5), (71.5, 23), (73.5, 40), (67, 31.5), (58.5, 28.5), (52, 30), (48, 35),
                    (44, 30), (37.5, 28.5), (29, 31.5)])
    skin_fill(A, head, shift(cap, 0, 2))

    # the mask sits on the face, a touch askew when startled
    mrot = 9 if e == "shock" else 0
    K.set_xf(rot, (48, 88), *off)
    p = K.xf([(48, 60)])[0]
    K.set_xf(rot + mrot, (48, 60), p[0] - 48, p[1] - 60)
    mshape = K.m_poly([(26, 37), (24.5, 54), (27, 66), (33.5, 77), (41.5, 87), (48, 92.5), (54.5, 87), (62.5, 77), (69, 66), (71.5, 54),
                       (70, 37), (60, 33), (48, 36.5), (36, 33)])
    lefth = K.m_poly([(0, 0), (48, 0), (48, 110), (0, 110)])
    chip = K.empty()
    if e == "defeat":           # a shard has broken away over the white eye
        chip = K.m_poly([(24, 30), (41, 32), (44.5, 46), (38, 55), (31, 60.5), (22, 60)])
    mk = mshape & ~chip
    A.face.fill(grow(mk) & ~chip, P["ink"])
    A.face.fill(mk & lefth, P["ivory"])
    A.face.fill(mk & lefth & ~shift(mshape, 3, -2), P["ivory_sh"])
    A.face.fill(mk & ~lefth, P["black"])
    A.face.fill(mk & ~lefth & ~shift(mshape, 3, 2), P["black_hl"])
    A.face.fill(mk & K.m_line([(48, 30), (48, 96)]), P["gold"])
    if e == "fierce":
        A.face.fill(mk & lefth & K.m_poly([(0, 0), (48, 0), (48, 66), (0, 62)]), P["ivory_sh"])
    # diamond tear on the white half
    dm = K.m_poly([(35.5, 64.5), (38.6, 69.5), (35.5, 75), (32.4, 69.5)])
    A.face.fill(grow(dm) & mk, P["ink"])
    A.face.fill(dm & mk, P["red"])
    A.face.fill(K.m_px((34.6, 68)), P["red_lt"])

    L = A.face

    def hole(m, col=None):
        L.fill(grow(m) & ~lefth, P["gold_sh"])
        L.fill(m, col or P["ink"])
        A.feat |= m
    if e == "neutral":
        hole(K.m_poly([(29, 55.5), (35, 52), (42, 53.5), (43.5, 57), (36, 58.5), (30, 58)]))
        L.fill(K.m_px((36, 55), (37, 55)), P["red"])
        g = K.m_poly([(52.5, 57), (54, 53.5), (61, 52), (67, 55.5), (66, 58), (60, 58.5)])
        hole(g, P["red"])
        L.fill(g & K.m_ellipse(59.5, 55.4, 3.4, 2.2), P["red_lt"])
        L.fill(K.m_px((59, 55), (60, 55)), WHITE)
    elif e == "happy":
        hole(K.m_stroke([(29.5, 57.5), (36, 52.5), (42.5, 57.5)], 2.2, True))
        hole(K.m_stroke([(53.5, 57.5), (60, 52.5), (66.5, 57.5)], 2.4, True), P["red"])
        L.fill(K.m_curve([(54.5, 56.5), (60, 52.6), (65.5, 56.5)]), P["red_lt"])
    elif e == "shock":
        hole(K.m_ellipse(36, 55.5, 6, 6))
        L.fill(K.m_ellipse(36, 55.5, 1.6, 1.6), P["red"])
        g = K.m_ellipse(60, 55.5, 6, 6)
        hole(g, P["red"])
        L.fill(K.m_ellipse(60, 55.5, 3.2, 3.2), P["red_lt"])
        L.fill(K.m_ellipse(60, 55.5, 1.2, 1.2), WHITE)
    elif e == "defeat":
        g = K.m_poly([(53, 56), (60, 54.5), (67, 56), (60, 57.6)])
        hole(g, P["red_dk"])
        # the real eye and brow behind the missing shard
        K.set_xf(rot, (48, 88), *off)
        m = K.m_stroke([(29.5, 54.5), (36, 57), (42, 55)], 1.8, True)
        L.fill(m, P["ink"])
        A.feat |= m
        m = K.m_stroke([(42.5, 47.5), (36, 48.6), (29, 52)], 1.8, True)
        L.fill(m, P["brow"])
        A.feat |= m
    else:
        hole(K.m_poly([(28.5, 53), (36, 54), (43.5, 58.5), (36, 59.4), (30, 57.6)]))
        L.fill(K.m_ellipse(37, 56.6, 1.8, 1.4), P["red"])
        L.fill(K.m_px((37, 56)), P["red_lt"])
        g = K.m_poly([(52, 58.5), (59, 53), (68.5, 51), (66, 57.5), (60, 60)])
        hole(g, P["red"])
        L.fill(g & K.m_ellipse(60, 56, 4.2, 2.4), P["red_lt"])
        L.fill(g & K.m_ellipse(60, 56, 1.8, 1.2), WHITE)
    # painted smile
    def smile(pts, t=2.0, curls=True):
        m = K.m_stroke(pts, t, True)
        if curls:
            m |= K.m_curve([pts[0], (pts[0][0] - 2.4, pts[0][1] - 2.2), (pts[0][0] - 0.6, pts[0][1] - 4)])
            m |= K.m_curve([pts[-1], (pts[-1][0] + 2.4, pts[-1][1] - 2.2), (pts[-1][0] + 0.6, pts[-1][1] - 4)])
        L.fill(m & lefth & mk, P["ink"])
        L.fill(m & ~lefth & mk, P["gold"])
    if e == "neutral":
        smile([(36, 77), (42, 80.6), (48, 81.6), (54, 80.6), (60, 77)])
    elif e == "happy":
        cres = K.m_blob([(33.5, 74.5), (41, 78.5), (48, 79.5), (55, 78.5), (62.5, 74.5), (57, 83), (48, 86), (39, 83)], 6) & mk
        L.fill(cres & lefth, P["ink"])
        L.fill(cres & ~lefth, P["gold"])
        L.fill(K.shrink(cres) & (YY < 200), P["red_dk"])
        smile([(33.5, 74.5), (62.5, 74.5)], 1.0)
    elif e == "shock":
        o = K.m_ellipse(48, 81, 2.6, 3.4) & mk
        L.fill(grow(o) & lefth, P["ink"])
        L.fill(grow(o) & ~lefth, P["gold"])
        L.fill(o, P["red_dk"])
    elif e == "defeat":
        K.set_xf(rot, (48, 88), *off)
        p = K.xf([(48, 60)])[0]
        K.set_xf(rot + mrot, (48, 60), p[0] - 48, p[1] - 60)
        smile([(37, 82.5), (42, 79.6), (48, 78.8), (54, 79.6), (59, 82.5)], curls=False)
        for pts in ([(41, 32), (45, 44), (41, 52), (47, 62), (43, 72)], [(45, 44), (52, 49), (58, 46)], [(47, 62), (55, 66), (58, 74)], [(41, 52), (36, 56)]):
            c = K.m_line(pts) & mk
            L.fill(c & lefth, P["ink"])
            L.fill(c & ~lefth, P["ivory_sh"])
    else:
        jag = K.m_poly([(32, 73), (37, 77.5), (40, 75), (43, 79.5), (46, 76.5), (48, 80.5), (50, 76.5), (53, 79.5), (56, 75), (59, 77.5), (64, 73),
                        (59, 82.5), (53, 85.5), (48, 86.5), (43, 85.5), (37, 82.5)]) & mk
        L.fill(grow(jag) & lefth & mk, P["ink"])
        L.fill(grow(jag) & ~lefth & mk, P["gold"])
        L.fill(jag, P["red_dk"])
        L.fill(jag & K.m_poly([(32, 73), (37, 77.5), (40, 75), (43, 79.5), (46, 76.5), (48, 80.5), (50, 76.5), (53, 79.5), (56, 75), (59, 77.5), (64, 73), (64, 80), (32, 80)]) & (YY > 0), P["red"])

    # hair
    K.set_xf(rot, (48, 88), *off)
    A.hair.fill(cap, P["hair"])
    A.hair.fill(rim(cap, 3, 0), P["hair_sh"])
    A.hair.fill(K.m_blob([(30, 22), (38, 15.5), (48, 13.5), (58, 15), (66, 21), (58, 18.5), (48, 17.5), (38, 19)], 5) & cap, P["hair_hl"])
    for pts in ([(37.5, 28), (33, 21), (31, 15)], [(58.5, 28), (63, 21), (65, 15)], [(52, 30), (54, 20), (53, 11)]):
        A.hair.fill(K.m_curve(pts), P["hair_sh"], only=[P["hair"], P["hair_hl"]])
    stk = K.m_poly([(41.5, 30), (47.6, 34), (46, 9), (38.5, 11)])
    A.hair.fill(stk & cap, P["ivory"])
    A.hair.fill(stk & cap & rim(stk, 2, 0), P["ivory_sh"])
    if e == "defeat":
        sd = K.m_stroke([(50, 30), (54, 40), (52, 50)], 1.8, True)
        A.hair.fill(sd, P["hair"])

    if e == "shock":
        K.reset_xf()
        shock_lines(A, 48, 10)
        sweat(A, 84, 40)
    elif e == "defeat":
        K.reset_xf()
        sh = K.m_poly([(14, 70), (22, 66), (24, 76), (17, 80)])
        pmask(A.fx, sh, P["ink"], P["ivory"])
        A.fx.fill(rim(sh, 2, 2), P["ivory_sh"])
        gloom(A, 78, 28, lens=(8, 12, 7, 10))
    elif e == "fierce":         # the red eye burns
        K.set_xf(rot, (48, 88), *off)
        fl = K.m_blob([(63, 55), (70, 50), (76, 41), (77, 49), (83, 44), (79, 55), (71, 58)], 5)
        pmask(A.fx, fl, P["ink"], P["red"])
        A.fx.fill(K.m_blob([(66, 55), (72, 51), (75, 47), (75.5, 52), (72, 56)], 5), P["red_lt"])
    return A.finish(flip=False)


BUILDERS = {"rin": build_rin, "mako": build_mako, "jiro": build_jiro, "aya": build_aya, "pochi": build_pochi, "goro": build_goro,
            "yuki": build_yuki, "zeno": build_zeno, "onyx": build_onyx}



# --------------------------------------------------------------------------- output

def eye_band_top(A):
    rows = np.where(A.feat[K.PAD:K.PAD + 96, K.PAD:K.PAD + 96].any(axis=1))[0]
    top, bot = int(rows.min()), int(rows.max())
    y = int(round((top + bot + 1) / 2.0 - 12))
    return max(0, min(72, y)), top, bot


def build_sprite(cid):
    spr = Sprite(96, 96)
    idx = {n: spr.add_layer(n) for n in LAYERS}
    guide = spr.add_layer("eyeband", visible=False)
    frames = []
    band_y = None
    for e in EXPR:
        A = BUILDERS[cid](e)
        frames.append(A)
        f = spr.add_frame(200)
        for n in LAYERS:
            A.L[n].clean() if n != "fx" else None
            spr.set_cel(idx[n], f, A.L[n].image())
        spr.add_tag(e, f, f)
        if e == "fierce":
            band_y, top, bot = eye_band_top(A)
            if bot - top + 1 > 24:
                print(f"  note: {cid} fierce eyes+brows span {bot - top + 1} rows ({top}..{bot}); band is centred")
    g = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    g.paste((255, 0, 255, 96), (0, band_y, 96, band_y + 24))
    for f in range(len(EXPR)):
        spr.set_cel(guide, f, g)
    seen = set()
    for A in frames:
        for n in LAYERS:
            a = A.L[n].a[K.PAD:K.PAD + 96, K.PAD:K.PAD + 96].reshape(-1, 4)
            for r, g_, b, al in np.unique(a, axis=0):
                if al:
                    seen.add("#%02x%02x%02x" % (r, g_, b))
    declared = []
    for v in list(frames[0].P.values()) + [WHITE]:
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
