"""Draws every frame of the named .aseprite sprites on a grey sheet, scaled up, for review.

    python3 tools/contact_sheet.py out.png kess june raider
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline", "aseprite"))
import asefile as A  # noqa: E402

ART = os.path.join(HERE, "..", "art", "aseprite")


def main(out, names, scale=3):
    rows = []
    for n in names:
        spr = A.read(os.path.join(ART, n + ".aseprite"))
        ims = []
        for i in range(len(spr.frames)):
            im = Image.new("RGBA", (spr.width, spr.height))
            im.putdata(A.flatten(spr, i))
            ims.append(im)
        rows.append((n, spr.width, spr.height, ims))
    per = 16
    W = max(min(len(r[3]), per) * (r[1] + 2) for r in rows) * scale + 80
    H = sum(((len(r[3]) + per - 1) // per) * (r[2] + 2) * scale + 4 for r in rows)
    sheet = Image.new("RGBA", (W, H), (96, 104, 112, 255))
    d = ImageDraw.Draw(sheet)
    y = 0
    for n, w, h, ims in rows:
        d.text((2, y + 2), n, fill=(255, 255, 255, 255))
        for i, im in enumerate(ims):
            x = 80 + (i % per) * (w + 2) * scale
            yy = y + (i // per) * (h + 2) * scale
            sheet.alpha_composite(im.resize((w * scale, h * scale), Image.NEAREST), (x, yy))
        y += ((len(ims) + per - 1) // per) * (h + 2) * scale + 4
    sheet.save(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
