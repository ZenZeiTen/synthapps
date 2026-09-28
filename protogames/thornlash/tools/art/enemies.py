"""Thornlash bestiary (all original designs), painted with tools/art/paint2d.py.

Canvas 48x48, pivot (24, 47) = feet / bottom of the game hitbox; art faces right.
Animation names match render.gd: <kind>_<state>.
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from paint2d import Frame, clean_orphans, hexrgb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "art" / "build" / "enemies"
W, H = 48, 48
FX, FY = 24, 47
OUTLINE = "#140c18"

MAT = {
    "rot": ["#2a2a22", "#4e5238", "#7a7a52"],        # ghoul flesh
    "rag": ["#1e1620", "#3a2c34", "#564450"],
    "bone": ["#4a4038", "#948670", "#d8ceb4"],
    "redbone": ["#4a1418", "#a8343a", "#e87a6a"],
    "iron": ["#1e1c2a", "#3e4052", "#6a7084", "#a4aabb"],
    "plume": ["#4a1418", "#a8343a", "#e87a6a"],
    "scale": ["#10262a", "#1e4a4a", "#3a7a6a"],
    "fin": ["#2a1a30", "#5a3a5e", "#8a6a90"],
    "fur": ["#16121a", "#2e2630", "#4c4250"],
    "wing": ["#1a1020", "#3a2436", "#5e3c52"],
    "eye": ["#6a1622", "#e0402c", "#f4d68a"],
    "imp": ["#3a1414", "#7a2a22", "#b85a3a"],
    "spirit": ["#1e3a6a", "#4a7ad0", "#9ad0f4"],
    "stone": ["#1e1a26", "#3c3648", "#625a70", "#8e86a0"],
    "gold": ["#6c4a1c", "#c8962e", "#f4d68a"],
    "wood": ["#2a1a18", "#4e3224", "#76503a"],
}


def d(a):
    r = math.radians(a)
    return (math.sin(r), math.cos(r))


def add(p, v, k=1.0):
    return (p[0] + v[0] * k, p[1] + v[1] * k)


def humanoid(P, mats, extras=None, size=1.0):
    """Generic upright body: mats = {skin, torso, leg, foot, arm, hand, head}."""
    f = Frame(W, H, MAT, OUTLINE)
    s = size
    hip = (FX + P.get("hx", 0), FY - 21 * s + P.get("hy", 0))
    lean = P.get("lean", 5)
    u = d(180 - lean)
    fwd = (-u[1], u[0])
    neck = add(hip, u, 13 * s)
    legs = {}
    for side, t, sh, dx, z, dim in (("f", P["ft"], P["fs"], -1.2, 2, 0.15), ("n", P["nt"], P["ns"], 1.2, 6, 0.0)):
        hj = add(hip, fwd, dx)
        knee = add(hj, d(t), 9.5 * s)
        ank = add(knee, d(sh), 9.5 * s)
        toe = add(ank, d(88), 4.5 * s)
        legs[side] = (hj, knee, ank)
        f.capsule(hj, knee, 2.7 * s, 2.3 * s, mats["leg"], "l" + side, z, dim)
        f.capsule(knee, ank, 2.3 * s, 2.0 * s, mats["leg"], "l" + side, z + 0.1, dim)
        f.capsule(add(ank, d(88), -1), toe, 2.0 * s, 1.6 * s, mats["foot"], "l" + side, z + 0.2, dim)
    fsh = add(add(neck, fwd, -2.5), u, -2)
    fel = add(fsh, d(P["fua"]), 7 * s)
    fwr = add(fel, d(P["ffa"]), 6.5 * s)
    f.capsule(fsh, fel, 2.3 * s, 2.0 * s, mats["arm"], "af", 1, 0.16)
    f.capsule(fel, fwr, 2.0 * s, 1.7 * s, mats["arm"], "af", 1.1, 0.16)
    f.ellipse(add(fwr, d(P["ffa"]), 1.2), 1.7 * s, 1.7 * s, mats["hand"], "af", 1.2, 0.16)
    tw = P.get("tw", 4.5) * s
    f.poly([add(hip, fwd, tw * 0.85), add(hip, fwd, -tw * 0.85), add(neck, fwd, -tw * 1.2),
            add(neck, fwd, tw * 1.2)], mats["torso"], "torso", 5)
    hc = add(neck, d(180 - lean - P.get("head", 0)), 4.6 * s)
    f.ellipse(hc, 3.6 * s, 4.0 * s, mats["head"], "head", 7)
    nsh = add(add(neck, fwd, 2), u, -2)
    nel = add(nsh, d(P["nua"]), 7 * s)
    nwr = add(nel, d(P["nfa"]), 6.5 * s)
    f.capsule(nsh, nel, 2.4 * s, 2.1 * s, mats["arm"], "an", 8)
    f.capsule(nel, nwr, 2.1 * s, 1.8 * s, mats["arm"], "an", 8.1)
    hand = add(nwr, d(P["nfa"]), 1.2)
    f.ellipse(hand, 1.8 * s, 1.8 * s, mats["hand"], "an", 8.2)
    J = dict(hip=hip, neck=neck, head=hc, u=u, fwd=fwd, hand=hand, fhand=fwr, legs=legs, nsh=nsh)
    if extras:
        extras(f, J, P)
    img = clean_orphans(f.render(), hexrgb(OUTLINE))
    return img


def walkp(i, n=4, amp=22, **kw):
    ph = i / n * 2 * math.pi
    s = math.sin(ph)
    c = math.cos(ph)
    p = dict(nt=amp * s, ns=amp * s - 18 * max(0, -c) - 4, ft=-amp * s, fs=-amp * s - 18 * max(0, c) - 4,
             nua=-18 * s, nfa=20 - 10 * s, fua=18 * s, ffa=18 + 10 * s, hy=round(-abs(s) * 1.0))
    p.update(kw)
    return p


# ------------------------------------------------------------------ humanoids

def ghoul(i, rise=None):
    """Peat ghoul: hunched, arms reaching, ragged shroud."""
    p = walkp(i, amp=14, lean=24, head=-18, nua=80 - 6 * math.sin(i * 1.6), nfa=70, fua=70, ffa=60, tw=4.2)
    mats = {"leg": "rag", "foot": "rot", "arm": "rot", "hand": "rot", "torso": "rag", "head": "rot"}

    def ex(f, J, P):
        e = add(add(J["head"], J["fwd"], 2.0), J["u"], 0.3)
        f.pixel(e[0], e[1], "#e0402c")
        f.pixel(e[0] - 2, e[1], "#6a1622")
        m = add(add(J["head"], J["fwd"], 2.2), J["u"], -2.3)
        f.pixel(m[0], m[1], "#1e1620")
    img = humanoid(p, mats, ex)
    if rise is not None:
        # emerging from the ground: sink the whole body and hide what is below the surface
        sink = int((2 - rise) / 3 * 30) + 6
        moved = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        moved.alpha_composite(img, (0, sink))
        px = moved.load()
        for y in range(FY - 1, H):
            for x in range(W):
                px[x, y] = (0, 0, 0, 0)
        for x in range(13, 36):   # clods of disturbed earth
            if (x * 7) % 3:
                px[x, FY - 1] = hexrgb("#3e2a22")
                if x % 4 == 0:
                    px[x, FY - 2] = hexrgb("#5a3e2e")
        img = moved
    return img


def skeleton(i, red=False, down=False):
    bone = "redbone" if red else "bone"
    if down:
        f = Frame(W, H, MAT, OUTLINE)
        for k, (x, y, r) in enumerate(((18, 45, 2.5), (24, 44, 3), (30, 45, 2.4), (22, 42, 2), (27, 41, 3.2))):
            f.ellipse((x, y), r + 1, r * 0.7, bone, "p%d" % k, k)
        f.ellipse((27, 40), 3.2, 2.8, bone, "skull", 9)
        f.pixel(28, 40, "#140c18")
        return clean_orphans(f.render(), hexrgb(OUTLINE))
    p = walkp(i, amp=16, lean=4, nua=20, nfa=40, fua=-20, ffa=10, tw=3.2)
    if i >= 10:   # throw frames
        p.update(nua=-150 if i == 10 else 70, nfa=-110 if i == 10 else 80)
    mats = {"leg": bone, "foot": bone, "arm": bone, "hand": bone, "torso": bone, "head": bone}

    def ex(f, J, P):
        # ribs: dark gaps across the torso; eye socket; jaw
        for k in range(4):
            a = add(J["hip"], J["u"], 4 + k * 2.2)
            for w in range(-2, 3):
                f.pixel(a[0] + w, a[1], "#140c18" if k % 2 == 0 and abs(w) < 2 else None or "#4a4038")
        e = add(J["head"], J["fwd"], 1.6)
        f.pixel(e[0], e[1], "#140c18")
        f.pixel(e[0] + 1, e[1], "#140c18")
        j = add(add(J["head"], J["fwd"], 1.8), J["u"], -3.0)
        f.pixel(j[0], j[1], "#140c18")
    return humanoid(p, mats, ex, size=0.95)


def knight(i, heavy=False, throw=-1):
    p = walkp(i, amp=14, lean=3, nua=30, nfa=60, fua=10, ffa=40, tw=5.2)
    if throw >= 0:
        p.update(nua=[-140, -160, 80][throw], nfa=[-100, -130, 85][throw], lean=[-4, -6, 12][throw])
    mats = {"leg": "iron", "foot": "iron", "arm": "iron", "hand": "iron", "torso": "iron", "head": "iron"}
    size = 1.12 if heavy else 1.0

    def ex(f, J, P):
        # visor slit, plume, and a spear or a great axe
        v = add(J["head"], J["fwd"], 1.8)
        for k in range(-1, 3):
            f.pixel(v[0] + k * 0.6, v[1], "#140c18")
        top = add(J["head"], J["u"], 4.0)
        f.capsule(top, add(add(top, J["fwd"], -6), J["u"], -3), 1.6, 0.8, "plume", "plume", 7.5)
        if not heavy:
            base = add(J["hand"], J["u"], -9)
            tip = add(J["hand"], J["u"], 16)
            f.capsule(base, tip, 0.9, 0.9, "wood", "spear", 8.5)
            f.capsule(tip, add(tip, J["u"], 4), 1.6, 0.3, "iron", "spear", 8.6)
            # kite shield on the far arm
            sc = add(add(J["neck"], J["fwd"], 4.5), J["u"], -7)
            f.poly([add(sc, J["u"], 6), add(sc, J["fwd"], 3.8), add(sc, J["u"], -8), add(sc, J["fwd"], -3.8)],
                   "plume", "shield", 8.4)
        elif P.get("axe", True):
            h0 = J["hand"]
            h1 = add(h0, J["u"], 12)
            f.capsule(add(h0, J["u"], -3), h1, 1.0, 1.0, "wood", "axe", 8.5)
            f.ellipse(add(h1, J["fwd"], 3), 4.2, 3.2, "iron", "axe", 8.6)
    return humanoid(p, mats, ex, size=size)


def drowned(i, st="walk"):
    p = walkp(i, amp=15, lean=12, head=-6, nua=40, nfa=70, fua=20, ffa=50, tw=4.6)
    if st == "leap":
        p.update(nt=70, ns=-20, ft=50, fs=-40, nua=-150, nfa=-160, fua=-160, ffa=-170)
    if st == "spit":
        p.update(lean=-6, head=-18)
    mats = {"leg": "scale", "foot": "fin", "arm": "scale", "hand": "fin", "torso": "scale", "head": "scale"}

    def ex(f, J, P):
        # dorsal fin down the back, gill slits, big eye, open maw when spitting
        for k in range(5):
            b = add(add(J["hip"], J["u"], 3 + k * 2.4), J["fwd"], -4.6)
            f.capsule(b, add(b, J["fwd"], -2.4 + k * 0.2), 1.0, 0.4, "fin", "fin", 4.8)
        e = add(add(J["head"], J["fwd"], 1.8), J["u"], 1.0)
        f.pixel(e[0], e[1], "#f4d68a")
        f.pixel(e[0] + 1, e[1], "#6a1622")
        if st == "spit":
            m = add(add(J["head"], J["fwd"], 3.0), J["u"], -1.6)
            f.pixel(m[0], m[1], "#e0402c")
            f.pixel(m[0] + 1, m[1], "#f4d68a")
    return humanoid(p, mats, ex)


# ------------------------------------------------------------------ creatures

def bat(i, hang=False, big=1.0, canvas=(W, H), piv=(FX, FY)):
    cw, ch = canvas
    f = Frame(cw, ch, MAT, OUTLINE)
    cx, cy = piv[0], piv[1] - 5 * big
    if hang:
        f.ellipse((cx, cy - 2 * big), 3.2 * big, 5.5 * big, "wing", "body", 5)
        f.ellipse((cx, cy + 3 * big), 2.4 * big, 2.2 * big, "fur", "head", 6)
        f.pixel(cx - 1, cy + 3 * big, "#e0402c")
        f.pixel(cx + 1, cy + 3 * big, "#e0402c")
        return clean_orphans(f.render(), hexrgb(OUTLINE))
    flap = [1.0, 0.35, -0.6, 0.2][i % 4]
    f.ellipse((cx, cy), 3.0 * big, 3.6 * big, "fur", "body", 5)
    for side in (-1, 1):
        root = (cx + side * 2 * big, cy - 1 * big)
        tip = (cx + side * 11 * big, cy - 7 * big * flap)
        mid = (cx + side * 6 * big, cy - 5 * big * flap - 1)
        low = (cx + side * 9 * big, cy + 2 * big - 3 * big * flap)
        f.poly([root, mid, tip, low, (cx + side * 4 * big, cy + 2 * big)], "wing", "w%d" % side, 4 if side < 0 else 6)
    f.ellipse((cx + 1.5 * big, cy - 3 * big), 2.4 * big, 2.2 * big, "fur", "head", 7)
    for k in (-1, 1):   # ears
        f.pixel(cx + 1.5 * big + k * 1.4 * big, cy - 5.6 * big, "#2e2630")
    f.pixel(cx + 2.5 * big, cy - 3.2 * big, "#e0402c")
    if big > 1.5:
        f.pixel(cx + 3.5 * big, cy - 3.2 * big, "#f4d68a")
        for k in range(3):   # fangs
            f.pixel(cx + 2 * big + k, cy - 1.2 * big, "#e8e0c8")
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def wisp(i):
    """A skull wreathed in cold blue fire, drifting in waves."""
    f = Frame(W, H, MAT, OUTLINE)
    cx, cy = FX, FY - 7
    for k in range(4):
        L = 8 + ((i + k) % 3) * 2
        a = -90 - 20 + k * 12
        base = (cx - 2, cy - 1 + k - 2)
        f.capsule(base, add(base, d(a), L), 3.0 - k * 0.4, 0.6, "spirit", "fire", 1 + k * 0.1)
    f.ellipse((cx + 1, cy), 4.6, 4.2, "bone", "skull", 5)
    f.ellipse((cx + 2, cy + 3.2), 2.8, 1.6, "bone", "jaw", 5.2)
    for x, y in ((cx + 2, cy - 0.5), (cx + 4, cy - 0.5)):
        f.pixel(x, y, "#140c18")
    f.pixel(cx + 3, cy + 1.5, "#4a4038")
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def warg(i, st="run"):
    f = Frame(W, H, MAT, OUTLINE)
    ph = i / 4 * 2 * math.pi
    s = math.sin(ph)
    bob = -abs(s) * 1.5 if st == "run" else 0
    body_y = FY - 11 + bob
    if st == "idle":
        body_y = FY - 9
    hip = (FX - 7, body_y)
    sh = (FX + 6, body_y - (2 if st != "idle" else 5))
    f.capsule(hip, sh, 5.0, 5.4, "fur", "body", 5)
    legs = []
    if st == "run":
        legs = [(sh, 40 * s, 1), (sh, -40 * s, 0), (hip, -40 * s, 1), (hip, 40 * s, 0)]
    elif st == "leap":
        legs = [(sh, 110, 1), (sh, 100, 0), (hip, -110, 1), (hip, -100, 0)]
    else:   # sitting: haunches down, fore legs straight
        legs = [(sh, 0, 1), (sh, 6, 0), (hip, 70, 1), (hip, 80, 0)]
    for base, a, near in legs:
        z = 6 if near else 2
        dim = 0.0 if near else 0.18
        knee = add(base, d(a), 6)
        paw = add(knee, d(a * 0.3), 5)
        f.capsule(base, knee, 2.4, 1.8, "fur", "leg%d%d" % (near, int(a)), z, dim)
        f.capsule(knee, paw, 1.8, 1.5, "fur", "leg%d%d" % (near, int(a)), z + 0.1, dim)
    head = add(sh, (5, -4 if st != "idle" else -7))
    f.ellipse(head, 4.2, 3.4, "fur", "head", 7)
    f.capsule(head, add(head, (5.5, 1.5)), 2.4, 1.6, "fur", "head", 7.1)
    f.capsule(add(head, (-1.5, -2.5)), add(head, (-1, -6)), 1.4, 0.4, "fur", "ear", 7.2)
    tail = add(hip, (-4, -1))
    f.capsule(tail, add(tail, (-7, -3 if st == "run" else 1)), 2.0, 0.8, "fur", "tail", 4)
    f.pixel(head[0] + 2, head[1] - 1, "#f4d68a")
    f.pixel(head[0] + 5, head[1] + 1.5, "#e8e0c8")
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def raven(i, perch=False):
    f = Frame(W, H, MAT, OUTLINE)
    cx, cy = FX, FY - 6
    f.ellipse((cx, cy), 5.0, 3.2, "fur", "body", 5)
    f.ellipse((cx + 5, cy - 2), 2.6, 2.4, "fur", "head", 6)
    f.poly([(cx + 7, cy - 2.5), (cx + 11, cy - 1), (cx + 7, cy - 0.5)], "gold", "beak", 6.5)
    f.poly([(cx - 5, cy - 1), (cx - 10, cy - 3), (cx - 10, cy + 2)], "fur", "tail", 4)
    f.pixel(cx + 5.5, cy - 2.6, "#e0402c")
    if perch:
        f.poly([(cx - 3, cy - 2), (cx + 3, cy - 2), (cx + 1, cy + 3), (cx - 4, cy + 2)], "wing", "wing", 5.5)
    else:
        flap = [1.0, 0.1, -0.8][i % 3]
        for side, z in ((-1, 4), (1, 6)):
            f.poly([(cx - 2, cy - 1), (cx + 2, cy - 1), (cx + 1 - side * 2, cy - 12 * flap), (cx - 6, cy - 9 * flap)],
                   "wing", "w%d" % side, z, 0.1 if side < 0 else 0.0)
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def imp(i, hop=False):
    f = Frame(W, H, MAT, OUTLINE)
    cx = FX
    base = FY - (3 if hop else 0)
    body = (cx, base - 7)
    f.ellipse(body, 4.6, 5.0, "imp", "body", 5)
    f.ellipse((cx + 2, base - 13), 3.6, 3.2, "imp", "head", 6)
    for k in (-1, 1):   # horns
        f.capsule((cx + 2 + k * 2, base - 15), (cx + 2 + k * 3.5, base - 19), 1.0, 0.3, "bone", "horn%d" % k, 6.5)
    leg_a = 50 if hop else 20
    for k, z in ((-1, 3), (1, 7)):
        hj = (cx + k * 2, base - 4)
        f.capsule(hj, add(hj, d(leg_a * k), 4.5), 1.8, 1.5, "imp", "leg%d" % k, z, 0.15 if k < 0 else 0)
    f.capsule((cx + 3, base - 9), (cx + 8, base - 7 - (4 if hop else 0)), 1.5, 1.2, "imp", "arm", 8)
    f.pixel(cx + 3.5, base - 13.5, "#f4d68a")
    f.pixel(cx + 4.5, base - 11.5, "#e8e0c8")
    f.capsule((cx - 4, base - 6), (cx - 9, base - 10 + (i % 2) * 2), 1.0, 0.4, "imp", "tail", 4)
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def ghost(i):
    """Hooded wraith: a tattered cowl trailing to nothing."""
    f = Frame(W, H, MAT, OUTLINE)
    cx, cy = FX, FY - 10
    sway = [0, 1, 0, -1][i % 4]
    f.poly([(cx - 5, cy - 6), (cx + 5, cy - 6), (cx + 7 + sway, cy + 6), (cx + 2 + sway, cy + 9),
            (cx - 1 + sway, cy + 6), (cx - 4 + sway, cy + 10), (cx - 7 + sway, cy + 5)], "spirit", "robe", 4, dim=0.1)
    f.ellipse((cx + 1, cy - 7), 4.6, 4.6, "spirit", "hood", 6)
    f.ellipse((cx + 2.5, cy - 6.5), 2.4, 2.8, "rag", "face", 7, bias=-0.4)
    f.pixel(cx + 2, cy - 7, "#f4d68a")
    f.pixel(cx + 4, cy - 7, "#f4d68a")
    f.capsule((cx + 4, cy - 2), (cx + 10, cy - 4 + sway), 1.4, 0.8, "spirit", "arm", 8)
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def pillar(i):
    """Gargoyle totem: a squat stone column crowned by a snarling head that spits fire."""
    f = Frame(W, H, MAT, OUTLINE)
    cx = FX
    f.poly([(cx - 7, FY), (cx + 7, FY), (cx + 6, FY - 30), (cx - 6, FY - 30)], "stone", "col", 3)
    for k in range(4):
        y = FY - 6 - k * 7
        f.capsule((cx - 7, y), (cx + 7, y), 1.2, 1.2, "stone", "ring%d" % k, 3.5, bias=-0.3)
    head = (cx + 1, FY - 36)
    f.ellipse(head, 7.0, 6.0, "stone", "head", 5)
    f.poly([(cx + 3, FY - 40), (cx + 11, FY - 37 + (1 if i else 0)), (cx + 4, FY - 33)], "stone", "snout", 5.5)
    for k in (-1, 1):
        f.capsule((cx - 1 + k * 3, FY - 41), (cx - 3 + k * 5, FY - 46), 1.4, 0.4, "stone", "horn%d" % k, 5.6)
    f.pixel(cx + 4, FY - 39, "#e0402c" if i else "#6a1622")
    if i:
        f.pixel(cx + 10, FY - 35, "#f4d68a")
        f.pixel(cx + 9, FY - 35, "#e0402c")
    return clean_orphans(f.render(), hexrgb(OUTLINE))


def animations():
    A = {}
    A["ghoul_rise"] = ([ghoul(0, r) for r in range(3)], [130, 130, 140], False)
    A["ghoul_walk"] = ([ghoul(i) for i in range(4)], [160] * 4, True)
    A["bat_idle"] = ([bat(0, hang=True)], [1000], True)
    A["bat_fly"] = ([bat(i) for i in range(4)], [80] * 4, True)
    A["wisp_idle"] = ([wisp(i) for i in range(3)], [100] * 3, True)
    A["drowned_walk"] = ([drowned(i) for i in range(4)], [150] * 4, True)
    A["drowned_leap"] = ([drowned(0, "leap")], [1000], True)
    A["drowned_spit"] = ([drowned(0, "spit")], [1000], True)
    A["knight_walk"] = ([knight(i) for i in range(4)], [200] * 4, True)
    A["axeknight_walk"] = ([knight(i, heavy=True) for i in range(4)], [220] * 4, True)
    A["axeknight_throw"] = ([knight(0, True, k) for k in range(3)], [120, 120, 250], False)
    A["skel_walk"] = ([skeleton(i) for i in range(4)], [150] * 4, True)
    A["skel_down"] = ([skeleton(0, down=True)], [1000], True)
    A["redskel_walk"] = ([skeleton(i, red=True) for i in range(4)], [150] * 4, True)
    A["redskel_down"] = ([skeleton(0, red=True, down=True)], [1000], True)
    A["warg_idle"] = ([warg(0, "idle")], [1000], True)
    A["warg_leap"] = ([warg(0, "leap")], [1000], True)
    A["warg_run"] = ([warg(i, "run") for i in range(4)], [70] * 4, True)
    A["raven_idle"] = ([raven(0, perch=True)], [1000], True)
    A["raven_dive"] = ([raven(i) for i in range(3)], [90] * 3, True)
    A["imp_wait"] = ([imp(i) for i in range(2)], [250, 250], True)
    A["imp_hop"] = ([imp(0, hop=True)], [1000], True)
    A["ghost_drift"] = ([ghost(i) for i in range(4)], [180] * 4, True)
    A["pillar_idle"] = ([pillar(0), pillar(1)], [900, 300], True)
    return A


def build(name="enemies", anims=None, size=(W, H), piv=(FX, FY), preview_cols=12):
    out = ROOT / "art" / "build" / name
    out.mkdir(parents=True, exist_ok=True)
    meta = {"tags": [], "frames": [], "size": list(size), "pivot": list(piv)}
    idx = 0
    for an, (frames, ms, loop) in (anims or animations()).items():
        start = idx
        for i, img in enumerate(frames):
            img.save(out / f"{idx:03d}.png")
            meta["frames"].append({"file": f"{idx:03d}.png", "ms": ms[i], "anim": an, "i": i})
            idx += 1
        meta["tags"].append({"name": an, "from": start, "to": idx - 1, "loop": loop})
    (out / "frames.json").write_text(json.dumps(meta, indent=1))
    rows = (idx + preview_cols - 1) // preview_cols
    sw, sh = size
    sheet = Image.new("RGBA", (preview_cols * sw, rows * sh), (48, 44, 60, 255))
    for i in range(idx):
        sheet.alpha_composite(Image.open(out / f"{i:03d}.png"), ((i % preview_cols) * sw, (i // preview_cols) * sh))
    sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(ROOT / "art" / "build" / f"{name}_preview.png")
    print(name, "frames:", idx)


if __name__ == "__main__":
    build()
