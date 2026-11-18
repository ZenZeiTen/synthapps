"""Every exported image in both builds uses only the palette (or full transparency), every
sprite strip matches the manifest, and no sprite frame is empty.

    python3 tests/verify_art.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
from palette import COLORS  # noqa: E402

PAL = set(COLORS)


def check_image(path, errors):
    im = Image.open(path).convert("RGBA")
    bad = 0
    for (r, g, b, a) in im.getdata():
        if a == 0:
            continue
        if a != 255 or (r, g, b) not in PAL:
            bad += 1
    if bad:
        errors.append(f"{os.path.relpath(path, ROOT)}: {bad} pixels outside the palette")
    return im


def main():
    errors = []
    man = json.load(open(os.path.join(ROOT, "content", "data", "manifest.json")))
    n = 0
    for base in ("godot/content", "web/public/content"):
        for name, m in man["sprites"].items():
            path = os.path.join(ROOT, base, "sprites", name + ".png")
            if not os.path.exists(path):
                errors.append(f"{base}: missing sprite {name}")
                continue
            im = check_image(path, errors)
            if im.size != (m["w"] * m["frames"], m["h"]):
                errors.append(f"{name}: strip {im.size}, manifest wants {m['w'] * m['frames']}x{m['h']}")
            for i in range(m["frames"]):
                if im.crop((i * m["w"], 0, (i + 1) * m["w"], m["h"])).getbbox() is None:
                    errors.append(f"{name}: frame {i} is empty")
            n += 1
        for sub, names in (("tiles", man["tiles"]["themes"]),
                           ("backdrops", [f"{t}_{l}" for t in man["backdrops"] for l in ("far", "mid")]),
                           ("stills", man["stills"])):
            for nm in names:
                path = os.path.join(ROOT, base, sub, nm + ".png")
                if not os.path.exists(path):
                    errors.append(f"{base}: missing {sub}/{nm}")
                    continue
                check_image(path, errors)
                n += 1
    for e in errors[:40]:
        print("ART", e)
    print("ART ok (%d images)" % n if not errors else "ART FAIL (%d problems)" % len(errors))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
