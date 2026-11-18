"""Art check: every sprite and tile sheet in the manifest exists, matches its source and
the contract, and uses only palette colours.

    python3 tests/verify_art.py

For each manifest sprite:
  - art/aseprite/<name>.aseprite and godot/content/sprites/<name>.png/.json exist;
  - the strip is frames*w x h, the JSON agrees with the manifest (size, origin, tags);
  - every frame of the PNG equals the .aseprite frame pixel for pixel (the export is not stale);
  - every opaque pixel is a palette colour and alpha is 0 or 255;
  - no frame is completely empty.
Tile sheets get the same source, palette and alpha checks.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "pipeline", "aseprite"))
import asefile as A  # noqa: E402
from manifest import MAP_THEME, SIDE_THEMES, SPRITES, as_json  # noqa: E402
from palette import COLORS  # noqa: E402

PAL = set(COLORS)
fails: list[str] = []


def check_pixels(label: str, im: Image.Image) -> None:
    bad = 0
    for (r, g, b, a) in im.getdata():
        if a not in (0, 255) or (a == 255 and (r, g, b) not in PAL):
            bad += 1
    if bad:
        fails.append(f"{label}: {bad} pixels off-palette or with partial alpha")


def main() -> None:
    man = as_json()["sprites"]
    n = 0
    for name, spec in man.items():
        src = os.path.join(ROOT, "art", "aseprite", name + ".aseprite")
        png = os.path.join(ROOT, "godot", "content", "sprites", name + ".png")
        js = os.path.join(ROOT, "godot", "content", "sprites", name + ".json")
        if not (os.path.exists(src) and os.path.exists(png) and os.path.exists(js)):
            fails.append(f"{name}: missing source or export")
            continue
        meta = json.load(open(js))
        for k in ("w", "h", "frames", "origin", "tags"):
            if meta[k] != spec[k]:
                fails.append(f"{name}: json {k}={meta[k]} but manifest {spec[k]}")
        im = Image.open(png).convert("RGBA")
        if im.size != (spec["w"] * spec["frames"], spec["h"]):
            fails.append(f"{name}: strip {im.size}")
            continue
        spr = A.read(src)
        for i in range(spec["frames"]):
            fr = im.crop((i * spec["w"], 0, (i + 1) * spec["w"], spec["h"]))
            if list(fr.getdata()) != [tuple(p) for p in A.flatten(spr, i)]:
                fails.append(f"{name}: frame {i} differs from its .aseprite source (re-export)")
            if fr.getbbox() is None:
                fails.append(f"{name}: frame {i} is empty")
        check_pixels(name, im)
        n += 1
    for theme in SIDE_THEMES + [MAP_THEME]:
        src = os.path.join(ROOT, "art", "aseprite", "tiles_" + theme + ".aseprite")
        png = os.path.join(ROOT, "godot", "content", "tiles", theme + ".png")
        if not (os.path.exists(src) and os.path.exists(png)):
            fails.append(f"tiles {theme}: missing")
            continue
        im = Image.open(png).convert("RGBA")
        if list(im.getdata()) != [tuple(p) for p in A.flatten(A.read(src), 0)]:
            fails.append(f"tiles {theme}: differs from source")
        check_pixels("tiles " + theme, im)
        n += 1
    for f in fails:
        print("FAIL", f)
    print(f"art: {n} sheets checked, {len(fails)} problems")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
