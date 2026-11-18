"""Art checks.

1. Every exported PNG in godot/content/{textures,items,portraits,ui,sprites} equals the
   flattened frames of its .aseprite source, pixel for pixel (the export step is honest,
   and nobody edited a PNG behind the source's back).
2. Every opaque pixel is one of the 32 palette colours; there is no partial alpha.
3. Every sprite sheet with a JSON sidecar has frames that tile the sheet exactly.

    python tests/verify_art.py
"""
import glob
import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
import asefile as A  # noqa: E402
from palette import RGB  # noqa: E402

DEST = {"tex": "textures", "ui": "ui", "item": "items", "portrait": "portraits", "mob": "sprites"}
PAL = set(RGB)
fails = []
n_px = 0
sources = sorted(glob.glob(os.path.join(ROOT, "art", "aseprite", "*.aseprite")))
for src in sources:
    base = os.path.basename(src)[:-len(".aseprite")]
    kind, name = base.split("_", 1)
    png = os.path.join(ROOT, "godot", "content", DEST[kind], name + ".png")
    if not os.path.exists(png):
        fails.append(f"{base}: no exported PNG")
        continue
    spr = A.read(src)
    im = Image.open(png).convert("RGBA")
    if im.size != (spr.width * len(spr.frames), spr.height):
        fails.append(f"{base}: sheet size {im.size} != {spr.width * len(spr.frames)}x{spr.height}")
        continue
    got = list(im.getdata()) if not hasattr(im, "get_flattened_data") else list(im.get_flattened_data())
    for fi in range(len(spr.frames)):
        want = A.flatten(spr, fi)
        for y in range(spr.height):
            for x in range(spr.width):
                p = got[y * im.width + fi * spr.width + x]
                w = want[y * spr.width + x]
                if (p[3] == 0 and w[3] == 0):
                    continue
                n_px += 1
                if p != w:
                    fails.append(f"{base}: frame {fi} pixel {x},{y} is {p}, source has {w}")
                    break
                if p[3] != 255:
                    fails.append(f"{base}: partial alpha at {x},{y}")
                    break
                if p[:3] not in PAL:
                    fails.append(f"{base}: off-palette colour {p[:3]} at {x},{y}")
                    break
    js = png[:-4] + ".json"
    if os.path.exists(js):
        meta = json.load(open(js))
        xs = sorted(f["frame"]["x"] for f in meta["frames"])
        if xs != [i * spr.width for i in range(len(spr.frames))]:
            fails.append(f"{base}: sidecar frames do not tile the sheet")
print(f"{len(sources)} .aseprite sources, {n_px} opaque pixels checked")
for f in fails[:30]:
    print("FAIL", f)
print("art OK" if not fails else f"{len(fails)} failures")
sys.exit(1 if fails else 0)
