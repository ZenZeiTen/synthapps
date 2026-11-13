#!/usr/bin/env python3
"""Export art/portraits/*.aseprite to the game's portrait sheet.

    python3 tools/art/export_portraits.py

The .aseprite files are the source of truth: every cell is the flattened visible
layers of one tagged frame, so a hand edit saved from Aseprite ships as drawn.

Writes godot/assets/art/portraits.png  (5 columns x 9 rows of 96x96 cells: rows in
cast order, columns neutral / happy / shock / defeat / fierce) and portraits.json:
{"cell", "order", "expr", "names", "eye_y"}. eye_y is the top row of the 96x24
cut-in strip; it is read from the y position of the hidden "eyeband" guide layer.
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asefile import Sprite            # noqa: E402
from portraits import CAST, EXPR      # noqa: E402  (ids, display names, expression order)

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(ROOT, "art", "portraits")
DST = os.path.join(ROOT, "godot", "assets", "art")
CELL = 96


def eye_band(spr, cid):
    for li, lay in enumerate(spr.layers):
        if lay["name"] == "eyeband":
            frames = spr.tag_frames("fierce")
            cel = spr.cels.get((li, frames[0])) or next((c for (l, _f), c in sorted(spr.cels.items()) if l == li), None)
            if cel is None:
                break
            y = cel[1]
            if not 0 <= y <= CELL - 24:
                raise SystemExit(f"{cid}: eyeband guide at y={y} does not fit a 24 px strip")
            return int(y)
    raise SystemExit(f"{cid}: no 'eyeband' guide layer (a hidden layer with a 96x24 box over the eyes)")


def main():
    sheet = Image.new("RGBA", (CELL * len(EXPR), CELL * len(CAST)), (0, 0, 0, 0))
    eye_y = {}
    for row, (cid, _name) in enumerate(CAST):
        path = os.path.join(SRC, cid + ".aseprite")
        spr = Sprite.load(path)
        if (spr.w, spr.h) != (CELL, CELL):
            raise SystemExit(f"{cid}: sprite is {spr.w}x{spr.h}, expected {CELL}x{CELL}")
        for col, e in enumerate(EXPR):
            frames = spr.tag_frames(e)          # KeyError names the missing tag
            cell = spr.flatten(frames[0])
            lo, hi = cell.getchannel("A").getextrema()
            if hi == 0:
                raise SystemExit(f"{cid}/{e}: empty frame")
            bad = [a for a, n in enumerate(cell.getchannel("A").histogram()) if n and a not in (0, 255)]
            if bad:
                raise SystemExit(f"{cid}/{e}: semi-transparent pixels (alpha {sorted(bad)[:4]}); portraits must be hard-edged")
            sheet.paste(cell, (col * CELL, row * CELL))
        eye_y[cid] = eye_band(spr, cid)
    os.makedirs(DST, exist_ok=True)
    sheet.save(os.path.join(DST, "portraits.png"))
    meta = {"cell": CELL, "order": [c for c, _ in CAST], "expr": EXPR,
            "names": {c: n for c, n in CAST}, "eye_y": eye_y}
    with open(os.path.join(DST, "portraits.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
        fh.write("\n")
    print(f"portraits.png {sheet.size[0]}x{sheet.size[1]}, eye_y {eye_y}")


if __name__ == "__main__":
    main()
