"""Boss sprites for Thornlash (all original designs). Canvas 96x64.

Flying bosses pivot at (48, 40) (the centre-bottom of their game box sits mid-body);
walking bosses pivot at the feet (48, 63).
"""
import json
import math
import sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import enemies as E  # noqa: E402
from paint2d import Frame, clean_orphans, hexrgb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
W, H = 96, 64
FLY = (48, 40)
FEET = (48, 63)
OUT = E.OUTLINE

E.MAT.update({
    "flesh": ["#3a2a2a", "#7a5a50", "#b08a78"],
    "leather": ["#2a1a22", "#6c3024", "#a0543a"],
    "hood": ["#0e0a10", "#1e1620", "#342834"],
    "brass": ["#4a2e14", "#9a6a28", "#e0b050", "#fff0b0"],
    "face": ["#8a8070", "#d8ceb4", "#fff4e0"],
    "ash": ["#141018", "#2a2430", "#4a4052", "#6e6478"],
    "ember": ["#6a1622", "#e0402c", "#f4d68a"],
    "coat": ["#1a1820", "#3a3844", "#5e5c6a"],
    "pale": ["#8a7a80", "#c8b8c0", "#f0e8ec"],
    "crimson": ["#3a0a14", "#7a1a24", "#b83040"],
})


def big_humanoid(P, mats, extras, size):
    saved = (E.W, E.H, E.FX, E.FY)
    E.W, E.H, E.FX, E.FY = W, H, FEET[0], FEET[1]
    try:
        return E.humanoid(P, mats, extras, size=size)
    finally:
        E.W, E.H, E.FX, E.FY = saved


# ------------------------------------------------------------------ Nightwing (stage 1)
def nightwing(i, mode="fly"):
    return E.bat(i, hang=(mode == "sleep"), big=3.0, canvas=(W, H), piv=FLY)


# ------------------------------------------------------------------ Ossuary Wyrm (stage 2)
def wyrm_skull(i):
    f = Frame(W, H, E.MAT, OUT)
    cx, cy = FLY[0], FLY[1] - 9
    f.ellipse((cx, cy), 10, 7.5, "bone", "skull", 5)
    f.poly([(cx + 4, cy - 2), (cx + 16, cy + 1), (cx + 4, cy + 5)], "bone", "snout", 5.2)
    jaw = 3 + (3 if i else 0)
    f.poly([(cx - 4, cy + 4), (cx + 14, cy + 3 + jaw), (cx + 3, cy + 7 + jaw)], "bone", "jaw", 5.1, dim=0.1)
    for k in (-1, 1):
        f.capsule((cx - 3, cy - 5 * (k > 0) - 2), (cx - 14, cy - 9 - 4 * (k > 0)), 2.2, 0.6, "bone", "horn%d" % k, 4 + k)
    f.ellipse((cx + 4, cy - 1.5), 2.0, 1.6, "rag", "eye", 6, bias=-0.5)
    f.pixel(cx + 4, cy - 1.5, "#e0402c")
    for k in range(4):
        f.pixel(cx + 7 + k * 2, cy + 3, "#e8e0c8")
    return clean_orphans(f.render(), hexrgb(OUT))


# ------------------------------------------------------------------ Lantern Warden (stage 3)
def warden(i, st="walk"):
    p = E.walkp(i, amp=12, lean=4, nua=40, nfa=70, fua=10, ffa=30, tw=5.6)
    if st == "slam":
        p.update(nua=[-160, 70][i], nfa=[-140, 80][i], lean=[-6, 14][i])
    mats = {"leg": "iron", "foot": "iron", "arm": "iron", "hand": "iron", "torso": "iron", "head": "iron"}

    def ex(f, J, P):
        # tabard, great helm slit glowing, pauldron
        hip, u, fw = J["hip"], J["u"], J["fwd"]
        f.poly([E.add(E.add(hip, u, 10), fw, 4), E.add(E.add(hip, u, 10), fw, -3),
                E.add(E.add(hip, u, -9), fw, -2), E.add(E.add(hip, u, -9), fw, 5)], "crimson", "tabard", 6.2)
        slit = E.add(J["head"], fw, 1.5)
        for k in range(-2, 4):
            f.pixel(slit[0] + k * 0.7, slit[1], "#f4d68a" if k % 2 else "#e0402c")
        f.ellipse(E.add(J["nsh"], u, 1.0), 4.0, 3.0, "iron", "paul", 8.5, bias=0.1)
    return big_humanoid(p, mats, ex, 1.35)


# ------------------------------------------------------------------ Chainmaster (stage 4)
def chainmaster(i, st="walk"):
    p = E.walkp(i, amp=12, lean=10, nua=30, nfa=60, fua=20, ffa=50, tw=6.4)
    if st == "throw":
        p.update(nua=[-150, 80][i], nfa=[-120, 90][i], lean=[-4, 16][i])
    if st == "leap":
        p.update(nt=70, ns=-10, ft=40, fs=-30, nua=-150, nfa=-160, fua=-140, ffa=-150)
    if st == "stomp":
        p.update(hy=4, nt=40, ns=-10, ft=-30, fs=-20, nua=60, nfa=80, fua=50, ffa=70, lean=24)
    mats = {"leg": "leather", "foot": "hood", "arm": "flesh", "hand": "flesh", "torso": "flesh", "head": "hood"}

    def ex(f, J, P):
        hip, u, fw = J["hip"], J["u"], J["fwd"]
        # leather apron, iron collar, manacles, hood eyeholes
        f.poly([E.add(E.add(hip, u, 8), fw, 5), E.add(E.add(hip, u, 8), fw, -2),
                E.add(E.add(hip, u, -10), fw, -1), E.add(E.add(hip, u, -10), fw, 6)], "leather", "apron", 6.4)
        f.capsule(E.add(J["neck"], fw, -4), E.add(J["neck"], fw, 4), 2.0, 2.0, "iron", "collar", 7.5)
        f.ellipse(J["hand"], 3.0, 2.2, "iron", "manacle", 8.5)
        for k in (0.8, 2.6):
            e = E.add(J["head"], fw, k)
            f.pixel(e[0], e[1], "#e0402c")
    return big_humanoid(p, mats, ex, 1.3)


# ------------------------------------------------------------------ Horologist (stage 5)
def horologist(i):
    f = Frame(W, H, E.MAT, OUT)
    cx, cy = FLY[0], FLY[1] - 18
    # gear wings behind
    for side in (-1, 1):
        gc = (cx + side * 16, cy - 4)
        f.ellipse(gc, 9, 9, "brass", "wing%d" % side, 2, dim=0.15)
        for k in range(8):
            a = k / 8 * 2 * math.pi + i * 0.4 * side
            f.capsule(gc, (gc[0] + math.cos(a) * 11, gc[1] + math.sin(a) * 11), 1.8, 1.6, "brass", "wing%d" % side, 2.1, dim=0.15)
        f.ellipse(gc, 3, 3, "iron", "hub%d" % side, 2.2)
    # body: a brass bell-shaped case, pendulum below
    f.poly([(cx - 8, cy - 2), (cx + 8, cy - 2), (cx + 11, cy + 14), (cx - 11, cy + 14)], "brass", "body", 5)
    sw = math.sin(i / 4 * 2 * math.pi) * 5
    f.capsule((cx, cy + 14), (cx + sw, cy + 30), 1.0, 1.0, "iron", "rod", 4)
    f.ellipse((cx + sw, cy + 31), 4, 3, "brass", "bob", 4.2)
    # clock-face head
    f.ellipse((cx, cy - 10), 9, 9, "brass", "rim", 6)
    f.ellipse((cx, cy - 10), 7, 7, "face", "face", 6.5)
    for k in range(12):
        a = k / 12 * 2 * math.pi
        f.pixel(cx + math.cos(a) * 5.6, cy - 10 + math.sin(a) * 5.6, "#4a2e14")
    ha = i * 0.8
    for L, a in ((4.5, ha), (3.0, ha * 0.2 + 2)):
        for s in range(int(L * 2)):
            f.pixel(cx + math.cos(a) * s / 2, cy - 10 + math.sin(a) * s / 2, "#140c18")
    f.pixel(cx, cy - 10, "#e0402c")
    # arms ending in pincers
    for side in (-1, 1):
        sh = (cx + side * 8, cy + 1)
        f.capsule(sh, (sh[0] + side * 7, sh[1] + 8), 1.8, 1.4, "iron", "arm%d" % side, 7)
    return clean_orphans(f.render(), hexrgb(OUT))


# ------------------------------------------------------------------ Pale Margrave (stage 6)
def margrave(i, st="stand"):
    k = math.sin(i / 2 * math.pi)
    p = dict(nt=8, ns=0, ft=-8, fs=-4, nua=10 + 3 * k, nfa=30, fua=-10, ffa=10, lean=2, hy=0, tw=4.0)
    if st == "cast":
        p.update(nua=100, nfa=110, lean=8)
    if st == "dying":
        p.update(hy=12, nt=80, ns=-40, ft=40, fs=-60, lean=30, nua=60, nfa=80)
    mats = {"leg": "coat", "foot": "hood", "arm": "coat", "hand": "pale", "torso": "coat", "head": "pale"}

    def ex(f, J, P):
        hip, u, fw = J["hip"], J["u"], J["fwd"]
        # long coat skirts to the knees, crimson high collar, long white hair
        f.poly([E.add(hip, fw, 5), E.add(hip, fw, -5), E.add(E.add(hip, u, -16), fw, -8 - k),
                E.add(E.add(hip, u, -16), fw, 7)], "coat", "skirt", 6.3)
        f.poly([E.add(E.add(J["neck"], fw, -5), u, -1), E.add(E.add(J["neck"], fw, 4), u, -1),
                E.add(E.add(J["neck"], fw, 5), u, 5), E.add(E.add(J["neck"], fw, -6), u, 6)], "crimson", "collar", 7.4)
        f.capsule(E.add(E.add(J["head"], fw, -3), u, 2), E.add(E.add(J["head"], fw, -6), u, -12), 3.0, 1.6, "pale", "hair", 6.8, bias=0.2)
        e = E.add(J["head"], fw, 2.2)
        f.pixel(e[0], e[1], "#e0402c")
        f.pixel(e[0] + 1, e[1], "#e0402c")
    img = big_humanoid(p, mats, ex, 1.25)
    if st == "fade":
        # dissolve on a 4x4 ordered pattern
        px = img.load()
        for y in range(H):
            for x in range(W):
                if px[x, y][3] and ((x % 4) * 4 + (y % 4)) % (2 + i) != 0:
                    px[x, y] = (0, 0, 0, 0)
    return img


# ------------------------------------------------------------------ Ashen Beast (stage 6, final)
def beast(i, st="stand"):
    f = Frame(W, H, E.MAT, OUT)
    fx0, fy0 = FEET
    lift = 6 if st == "leap" else 0
    body = (fx0 - 2, fy0 - 30 - lift)
    # wings
    flap = {"stand": 0.2 * (i % 2), "breathe": 0.0, "leap": 1.0, "transform": 0.5}[st]
    for side, z in ((-1, 1), (1, 3)):
        root = (body[0] - 4 + side * 2, body[1] - 12)
        tip = (root[0] - 30 + side * 4, root[1] - 18 - 12 * flap)
        f.poly([root, tip, (tip[0] + 6, tip[1] + 22), (root[0] - 12, root[1] + 16), (root[0] - 2, root[1] + 10)],
               "ash", "wing%d" % side, z, dim=0.12 if side < 0 else 0.0)
    f.ellipse(body, 14, 13, "ash", "body", 5)
    # haunches and legs
    for side, z in ((-1, 4), (1, 6)):
        hj = (body[0] - 6 + side * 3, body[1] + 8)
        knee = (hj[0] + 6, hj[1] + 10 - lift)
        paw = (knee[0] - 4, fy0 - 2)
        f.capsule(hj, knee, 5.0, 4.0, "ash", "leg%d" % side, z)
        f.capsule(knee, paw, 3.6, 3.0, "ash", "leg%d" % side, z + 0.1)
        f.ellipse(paw, 4.4, 2.4, "ash", "leg%d" % side, z + 0.2)
    # neck, horned head, maw
    neck = (body[0] + 12, body[1] - 10)
    head = (neck[0] + 8, neck[1] - 4 + (4 if st == "breathe" else 0))
    f.capsule((body[0] + 6, body[1] - 4), neck, 7, 5, "ash", "neck", 6.5)
    f.ellipse(head, 8, 6, "ash", "head", 7)
    f.poly([(head[0] + 4, head[1] - 2), (head[0] + 14, head[1] + 1), (head[0] + 4, head[1] + 4)], "ash", "snout", 7.1)
    for k in (-1, 1):
        f.capsule((head[0] - 2, head[1] - 4), (head[0] - 10 + k * 3, head[1] - 16), 2.2, 0.5, "bone", "horn%d" % k, 7.3)
    # ember cracks and eyes
    for (dx, dy) in ((-6, -2), (-2, 4), (4, -6), (8, 2), (-10, 6), (0, -9)):
        f.pixel(body[0] + dx, body[1] + dy, "#e0402c")
        f.pixel(body[0] + dx + 1, body[1] + dy + 1, "#f4d68a")
    f.pixel(head[0] + 3, head[1] - 2, "#f4d68a")
    if st == "breathe":
        for k in range(4):
            f.pixel(head[0] + 13 + k, head[1] + 2 + (k % 2), "#f4d68a" if k % 2 else "#e0402c")
    img = clean_orphans(f.render(), hexrgb(OUT))
    if st == "transform":
        px = img.load()
        for y in range(H):
            for x in range(W):
                if px[x, y][3] and ((x * 3 + y * 5 + i * 7) % 5 < 2 + i):
                    px[x, y] = (0, 0, 0, 0)
    return img


def animations():
    A = {}
    fly = [(nightwing(i), FLY) for i in range(4)]
    A["boss_nightwing_sleep"] = ([(nightwing(0, "sleep"), FLY)], [1000], True)
    for st, ms in (("rise", 90), ("glide", 110), ("perch", 140)):
        A["boss_nightwing_" + st] = (fly, [ms] * 4, True)
    A["boss_nightwing_swoop"] = ([(nightwing(2), FLY)], [1000], True)
    A["boss_nightwing_dying"] = ([(nightwing(0), FLY), (nightwing(2), FLY)], [60, 60], True)

    skull = [(wyrm_skull(i), FLY) for i in range(2)]
    A["boss_wyrm_arc"] = (skull, [150, 150], True)
    A["boss_wyrm_dying"] = (skull, [60, 60], True)

    ww = [(warden(i), FEET) for i in range(4)]
    A["boss_warden_sleep"] = ([ww[0]], [1000], True)
    A["boss_warden_walk"] = (ww, [240] * 4, True)
    A["boss_warden_slam"] = ([(warden(0, "slam"), FEET), (warden(1, "slam"), FEET)], [500, 1000], False)
    A["boss_warden_dying"] = ([ww[0], ww[2]], [60, 60], True)

    cm = [(chainmaster(i), FEET) for i in range(4)]
    A["boss_chainmaster_sleep"] = ([cm[0]], [1000], True)
    A["boss_chainmaster_walk"] = (cm, [220] * 4, True)
    A["boss_chainmaster_throw"] = ([(chainmaster(0, "throw"), FEET), (chainmaster(1, "throw"), FEET)], [330, 1000], False)
    A["boss_chainmaster_leap"] = ([(chainmaster(0, "leap"), FEET)], [1000], True)
    A["boss_chainmaster_stomp"] = ([(chainmaster(0, "stomp"), FEET)], [1000], True)
    A["boss_chainmaster_dying"] = ([cm[0], cm[2]], [60, 60], True)

    ho = [(horologist(i), FLY) for i in range(4)]
    for st in ("sleep", "hover", "blink", "dying"):
        A["boss_horologist_" + st] = (ho, [120] * 4, True)

    mg = [(margrave(i), FEET) for i in range(2)]
    A["boss_margrave_intro"] = (mg, [500, 500], True)
    A["boss_margrave_stand"] = ([mg[0], (margrave(1, "cast"), FEET)], [400, 400], True)
    A["boss_margrave_fade"] = ([(margrave(0, "fade"), FEET), (margrave(1, "fade"), FEET), (margrave(2, "fade"), FEET)], [120, 120, 1000], False)
    A["boss_margrave_dying"] = ([(margrave(0, "dying"), FEET)], [1000], True)

    A["boss_beast_transform"] = ([(beast(i, "transform"), FEET) for i in range(3)][::-1], [300, 300, 900], False)
    A["boss_beast_stand"] = ([(beast(i), FEET) for i in range(2)], [300, 300], True)
    A["boss_beast_breathe"] = ([(beast(0, "breathe"), FEET)], [1000], True)
    A["boss_beast_leap"] = ([(beast(0, "leap"), FEET)], [1000], True)
    A["boss_beast_dying"] = ([(beast(0), FEET), (beast(0, "transform"), FEET)], [80, 80], True)
    return A


def build():
    out = ROOT / "art" / "build" / "bosses"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    meta = {"tags": [], "frames": [], "size": [W, H], "pivot": list(FLY)}
    idx = 0
    for an, (frames, ms, loop) in animations().items():
        start = idx
        for i, (img, piv) in enumerate(frames):
            img.save(out / f"{idx:03d}.png")
            meta["frames"].append({"file": f"{idx:03d}.png", "ms": ms[i], "anim": an, "i": i, "pivot": list(piv)})
            idx += 1
        meta["tags"].append({"name": an, "from": start, "to": idx - 1, "loop": loop})
    (out / "frames.json").write_text(json.dumps(meta, indent=1))
    cols = 8
    rows = (idx + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * W, rows * H), (48, 44, 60, 255))
    for i in range(idx):
        sheet.alpha_composite(Image.open(out / f"{i:03d}.png"), ((i % cols) * W, (i // cols) * H))
    sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(ROOT / "art" / "build" / "bosses_preview.png")
    print("bosses frames:", idx)


if __name__ == "__main__":
    build()
