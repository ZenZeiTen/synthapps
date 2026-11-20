"""A jointed pixel puppet: every person in Tidebell is drawn from joint angles on one rig,
so all of them animate the same way and a pose table serves every character.

A pose is a dict of angles in degrees, measured from straight down, positive toward the
way the figure faces (figures face right; the game flips them):

    torso   lean of the body            head   tilt of the head
    thB/shB back thigh and shin         thF/shF front thigh and shin
    uaB/faB back upper arm and forearm  uaF/faF front upper arm and forearm
    wep     weapon angle (in the front hand)
    dx, dy  hip offset in pixels (dy > 0 lowers the body)

An outfit (see art_people.py) gives the colours, headwear and weapon.
"""
from __future__ import annotations

import math

from canvas import Canvas
from palette import N


def pt(x, y, ang, length):
    a = math.radians(ang)
    return x + math.sin(a) * length, y + math.cos(a) * length


def thick(c: Canvas, x0, y0, x1, y1, w, col):
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) * 2) + 1)
    r = w / 2.0
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        for yy in range(int(y - r - 1), int(y + r + 2)):
            for xx in range(int(x - r - 1), int(x + r + 2)):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r + 0.15:
                    c.set(xx, yy, col)


def disc(c: Canvas, cx, cy, r, col):
    for yy in range(int(cy - r - 1), int(cy + r + 2)):
        for xx in range(int(cx - r - 1), int(cx + r + 2)):
            if (xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= r * r:
                c.set(xx, yy, col)


BASE = {"torso": 0, "head": 0, "thB": -4, "shB": 0, "thF": 4, "shF": 0, "uaB": -8, "faB": -4, "uaF": 8,
        "faF": 20, "wep": 60, "dx": 0, "dy": 0}


def pose(**kw) -> dict:
    p = dict(BASE)
    p.update(kw)
    return p


class Rig:
    """Sizes of a figure. scale 1.0 is a warden (38 px from feet to crown)."""

    def __init__(self, scale=1.0, bulk=0):
        s = scale
        self.thigh = 8 * s
        self.shin = 8 * s
        self.torso = 11 * s
        self.upper = 6 * s
        self.fore = 6 * s
        self.head_r = 4.2 * s
        self.leg_w = 3.4 * s + bulk * 0.5
        self.arm_w = 2.6 * s + bulk * 0.3
        self.body_w = 6 * s + bulk


def draw(c: Canvas, outfit: dict, p: dict, feet=(24, 46), rig: Rig | None = None, shade=False):
    """Draws the figure into c (facing right). Returns the key points."""
    r = rig or Rig(outfit.get("scale", 1.0), outfit.get("bulk", 0))
    fx, fy = feet
    hip = (fx + p["dx"], fy - r.thigh - r.shin - 1 + p["dy"])
    neck = pt(hip[0], hip[1], 180 + p["torso"], r.torso)
    shoulder = pt(neck[0], neck[1], p["torso"], 1.5)
    head = pt(neck[0], neck[1], 180 + p["torso"] + p["head"], r.head_r + 1.2)

    def leg(th, sh):
        knee = pt(hip[0], hip[1], th, r.thigh)
        foot = pt(knee[0], knee[1], th + sh, r.shin)
        return knee, foot

    def arm(ua, fa):
        elbow = pt(shoulder[0], shoulder[1], ua, r.upper)
        hand = pt(elbow[0], elbow[1], ua + fa, r.fore)
        return elbow, hand

    kB, fB = leg(p["thB"], p["shB"])
    kF, fF = leg(p["thF"], p["shF"])
    eB, hB = arm(p["uaB"], p["faB"])
    eF, hF = arm(p["uaF"], p["faF"])
    col = outfit["colors"]
    dark = col.get("dark", {})

    def cc(part, back=False):
        name = col[part]
        if back and part in dark:
            name = dark[part]
        return N[name]

    # back limbs, darker
    thick(c, shoulder[0], shoulder[1], eB[0], eB[1], r.arm_w, cc("sleeve", True))
    thick(c, eB[0], eB[1], hB[0], hB[1], r.arm_w, cc("arm", True))
    disc(c, hB[0], hB[1], r.arm_w * 0.55, cc("skin", True))
    if outfit.get("weapon2"):
        outfit["weapon2"](c, hB[0], hB[1], p["wep"] - 25, True)
    thick(c, hip[0], hip[1], kB[0], kB[1], r.leg_w, cc("legs", True))
    thick(c, kB[0], kB[1], fB[0], fB[1], r.leg_w, cc("boots", True))
    thick(c, fB[0], fB[1], fB[0] + 2.5, fB[1], 2.2, cc("boots", True))
    # body
    thick(c, hip[0], hip[1] - 1, neck[0], neck[1] + 1, r.body_w, cc("shirt"))
    if outfit.get("coat"):
        # coat tails behind the hips
        tail = pt(hip[0], hip[1], -20 + p["torso"], 7)
        thick(c, neck[0] - 1, neck[1] + 2, tail[0] - 1, tail[1], r.body_w * 0.55, cc("coat"))
        thick(c, hip[0] - 1, hip[1] - 2, tail[0], tail[1], r.body_w * 0.7, cc("coat"))
    belt = pt(hip[0], hip[1], 180 + p["torso"], 2)
    thick(c, belt[0] - r.body_w * 0.45, belt[1], belt[0] + r.body_w * 0.45, belt[1], 1.6, cc("belt"))
    # front leg
    thick(c, hip[0], hip[1], kF[0], kF[1], r.leg_w, cc("legs"))
    thick(c, kF[0], kF[1], fF[0], fF[1], r.leg_w, cc("boots"))
    thick(c, fF[0], fF[1], fF[0] + 2.5, fF[1], 2.2, cc("boots"))
    # head
    disc(c, head[0], head[1], r.head_r, cc("skin"))
    hx, hy = head
    face = 1
    c.set(int(hx + 2 * face), int(hy - 0.5), N["ink"])        # eye
    if outfit.get("headwear"):
        outfit["headwear"](c, hx, hy, r.head_r, p)
    # front arm and weapon
    thick(c, shoulder[0], shoulder[1], eF[0], eF[1], r.arm_w, cc("sleeve"))
    thick(c, eF[0], eF[1], hF[0], hF[1], r.arm_w, cc("arm"))
    if outfit.get("weapon"):
        outfit["weapon"](c, hF[0], hF[1], p["wep"], False)
    disc(c, hF[0], hF[1], r.arm_w * 0.6, cc("skin"))
    return {"hip": hip, "neck": neck, "head": head, "hand": hF, "hand_b": hB, "feet": (fB, fF)}


# ------------------------------------------------------------------ weapons
def cutlass(c, x, y, ang, back):
    tip = pt(x, y, ang, 14)
    mid = pt(x, y, ang + 6, 8)
    thick(c, x, y, mid[0], mid[1], 2.2, N["stone3"])
    thick(c, mid[0], mid[1], tip[0], tip[1], 1.8, N["stone4"])
    g0 = pt(x, y, ang + 90, 2.5)
    g1 = pt(x, y, ang - 90, 2.5)
    thick(c, g0[0], g0[1], g1[0], g1[1], 1.4, N["gold1"])


def hook(c, x, y, ang, back):
    tip = pt(x, y, ang, 8)
    thick(c, x, y, tip[0], tip[1], 1.6, N["stone2"] if back else N["stone4"])
    h = pt(tip[0], tip[1], ang + 110, 3)
    thick(c, tip[0], tip[1], h[0], h[1], 1.4, N["stone2"] if back else N["stone3"])


def anchor(c, x, y, ang, back):
    top = pt(x, y, ang + 180, 4)
    head = pt(x, y, ang, 13)
    thick(c, top[0], top[1], head[0], head[1], 2.0, N["wood2"])
    thick(c, top[0], top[1], head[0], head[1], 1.0, N["wood3"])
    for s in (-1, 1):
        fl = pt(head[0], head[1], ang + s * 100, 5)
        thick(c, head[0], head[1], fl[0], fl[1], 2.6, N["stone2"])
        tip = pt(fl[0], fl[1], ang + 180 + s * 30, 2.5)
        thick(c, fl[0], fl[1], tip[0], tip[1], 2.0, N["stone3"])
    disc(c, head[0], head[1], 2.2, N["stone3"])


def sabre(c, x, y, ang, back):
    tip = pt(x, y, ang, 13)
    thick(c, x, y, tip[0], tip[1], 2.0, N["stone3"])
    g0 = pt(x, y, ang + 90, 2)
    g1 = pt(x, y, ang - 90, 2)
    thick(c, g0[0], g0[1], g1[0], g1[1], 1.4, N["wood1"])


def rapier(c, x, y, ang, back):
    tip = pt(x, y, ang, 17)
    thick(c, x, y, tip[0], tip[1], 1.4, N["stone4"])
    disc(c, x, y, 2.2, N["gold2"])


def bottle(c, x, y, ang, back):
    disc(c, x, y - 2, 2.4, N["leaf3"])
    thick(c, x, y - 4, x, y - 7, 1.4, N["wood2"])


def netroll(c, x, y, ang, back):
    for i in range(3):
        disc(c, x + i - 1, y - 2 + (i % 2), 2.5, N["silt2"] if i % 2 else N["silt1"])


def ledger(c, x, y, ang, back):
    thick(c, x - 3, y - 1, x + 3, y - 1, 4, N["red1"])
    thick(c, x - 3, y - 2, x + 3, y - 2, 1, N["white"])


# ------------------------------------------------------------------ headwear
def scarf(c, hx, hy, r, p):
    # a red headscarf with a knot at the back; dark hair at the nape
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy - r - 1), int(hy - 0.5)):
            if (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= (r + 0.6) ** 2:
                c.set(x, y, N["red2"])
    c.set(int(hx - r - 1), int(hy - 1), N["red1"])
    c.set(int(hx - r - 2), int(hy), N["red1"])
    c.set(int(hx - r - 1), int(hy + 1), N["red2"])
    c.set(int(hx - r + 0.5), int(hy + 1), N["wood0"])


def hood(c, hx, hy, r, p):
    for x in range(int(hx - r - 1), int(hx + r + 1)):
        for y in range(int(hy - r - 1), int(hy + r)):
            d = (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2
            if d <= (r + 1.2) ** 2 and (x < hx + 1 or y < hy - 1.5):
                c.set(x, y, N["leaf2"])
    c.set(int(hx - r - 1), int(hy + 2), N["leaf1"])
    c.set(int(hx + 1), int(hy - r + 1), N["leaf3"])


def bald_beard(c, hx, hy, r, p):
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy + 1), int(hy + r + 2)):
            if (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= (r + 1) ** 2 and x > hx - 2:
                c.set(x, y, N["stone3"])
    c.set(int(hx - 1), int(hy - r + 1), N["skin2"])


def bandana(c, hx, hy, r, p):
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy - r), int(hy - 1)):
            if (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= (r + 0.5) ** 2:
                c.set(x, y, N["stone1"])
    c.set(int(hx - r - 1), int(hy - 1), N["stone1"])
    c.set(int(hx + 2), int(hy + 2), N["stone0"])     # a scowl of stubble


def tricorn(c, hx, hy, r, p):
    thick(c, hx - r - 2.5, hy - r + 1, hx + r + 2.5, hy - r + 1, 2.2, N["night1"])
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy - r - 3), int(hy - r + 1)):
            c.set(x, y, N["night1"])
    c.set(int(hx), int(hy - r - 2), N["gold2"])
    c.set(int(hx + 1), int(hy + 2), N["stone0"])


def netcap(c, hx, hy, r, p):
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy - r - 1), int(hy - 1)):
            if (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= (r + 0.8) ** 2:
                c.set(x, y, N["silt1"] if (x + y) % 2 else N["silt0"])


def topper(c, hx, hy, r, p):
    for x in range(int(hx - r + 1), int(hx + r)):
        for y in range(int(hy - r - 5), int(hy - r + 1)):
            c.set(x, y, N["ink"])
    thick(c, hx - r - 1.5, hy - r + 1, hx + r + 1.5, hy - r + 1, 1.4, N["ink"])
    c.set(int(hx), int(hy - r - 1), N["red2"])
    c.set(int(hx + 2), int(hy), N["gold2"])            # a monocle


def plainhair(c, hx, hy, r, p):
    for x in range(int(hx - r), int(hx + r + 1)):
        for y in range(int(hy - r - 1), int(hy - 1)):
            if (x + 0.5 - hx) ** 2 + (y + 0.5 - hy) ** 2 <= (r + 0.6) ** 2 and x < hx + 2:
                c.set(x, y, N["wood1"])
