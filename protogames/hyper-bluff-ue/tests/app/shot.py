"""Composite a draw list written by `test_app <root> --shot <script> <list.txt>` into a PNG
(nearest-neighbour, sRGB blending, x2). For looking at layouts, not a check.
Usage: python3 shot.py <hyper-bluff-ue> <list.txt> <out.png>"""
import sys
from PIL import Image
root, lst, out = sys.argv[1:4]
names = ["font", "font_big", "font_ital", "cards", "icons", "portraits", "bg_floor1", "bg_floor2", "bg_floor3",
         "bg_floor4", "bg_floor5", "bg_title", "chip_spin", "chips", "star_spin", "trophy", "coin_burst"]
tex = [Image.open(f"{root}/Content/Raw/Art/{n}.png").convert("RGBA") for n in names]
canvas = Image.new("RGBA", (640, 360), (6, 5, 10, 255))
for line in open(lst):
    t, x, y, w, h, u, v, uw, vh, r, g, b, a = line.split()
    t = int(t); x, y, w, h = (float(q) for q in (x, y, w, h))
    if w < 0.5 or h < 0.5:
        continue
    col = tuple(int(round(float(c) * 255)) for c in (r, g, b, a))
    box = (int(round(x)), int(round(y)), int(round(x + w)), int(round(y + h)))
    bw, bh = max(1, box[2] - box[0]), max(1, box[3] - box[1])
    if t < 0:
        layer = Image.new("RGBA", (bw, bh), col)
    else:
        src = tex[t].crop((int(float(u)), int(float(v)), int(float(u) + float(uw)), int(float(v) + float(vh))))
        layer = src.resize((bw, bh), Image.NEAREST)
        tint = Image.new("RGBA", (bw, bh), col)
        from PIL import ImageChops
        layer = ImageChops.multiply(layer, tint)
    tmp = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    tmp.paste(layer, box[:2])
    canvas = Image.alpha_composite(canvas, tmp)
canvas.resize((1280, 720), Image.NEAREST).save(out)
