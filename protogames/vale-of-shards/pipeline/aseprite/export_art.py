"""Export every .aseprite source listed in the manifest to the game's content folder.

    python3 pipeline/aseprite/export_art.py

Reads art/aseprite/<name>.aseprite (never the drawing code, so an edit made in Aseprite
ships) and writes:
  godot/content/sprites/<name>.png   horizontal strip of frames
  godot/content/sprites/<name>.json  {"w","h","frames","origin","tags","ms"}
  godot/content/tiles/<theme>.png    tile sheets (tiles_<theme>.aseprite)

With Aseprite installed the equivalent strip is
  aseprite -b art/aseprite/heart.aseprite --sheet heart.png --sheet-type horizontal
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import asefile as A  # noqa: E402
from manifest import MAP_THEME, SIDE_THEMES, SPRITES  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art", "aseprite")
OUT_S = os.path.join(ROOT, "godot", "content", "sprites")
OUT_T = os.path.join(ROOT, "godot", "content", "tiles")


def to_image(spr: A.Sprite, frame: int) -> Image.Image:
    im = Image.new("RGBA", (spr.width, spr.height))
    im.putdata(A.flatten(spr, frame))
    return im


def export_sprite(name: str) -> bool:
    path = os.path.join(ART, name + ".aseprite")
    if not os.path.exists(path):
        return False
    spr = A.read(path)
    w, h, org, _src, _tags = SPRITES[name]
    strip = Image.new("RGBA", (spr.width * len(spr.frames), spr.height))
    for i in range(len(spr.frames)):
        strip.paste(to_image(spr, i), (i * spr.width, 0))
    strip.save(os.path.join(OUT_S, name + ".png"), optimize=True)
    meta = {"w": spr.width, "h": spr.height, "frames": len(spr.frames), "origin": list(org),
            "tags": {t: [a, b] for (t, a, b) in spr.tags}, "ms": [f.duration_ms for f in spr.frames]}
    with open(os.path.join(OUT_S, name + ".json"), "w") as f:
        json.dump(meta, f, sort_keys=True)
    return True


def main() -> None:
    os.makedirs(OUT_S, exist_ok=True)
    os.makedirs(OUT_T, exist_ok=True)
    done, missing = 0, []
    for name in SPRITES:
        if export_sprite(name):
            done += 1
        else:
            missing.append(name)
    tiles = 0
    for theme in SIDE_THEMES + [MAP_THEME]:
        path = os.path.join(ART, "tiles_" + theme + ".aseprite")
        if os.path.exists(path):
            to_image(A.read(path), 0).save(os.path.join(OUT_T, theme + ".png"), optimize=True)
            tiles += 1
        else:
            missing.append("tiles_" + theme)
    sig = os.path.join(OUT_S, "sigil.png")
    if os.path.exists(sig):
        # the window/app icon: the first sigil frame at 4x (not a manifest sprite)
        im = Image.open(sig).crop((0, 0, 24, 24)).resize((96, 96), Image.NEAREST)
        im.save(os.path.join(ROOT, "godot", "content", "app_icon.png"), optimize=True)
    print(f"exported {done} sprites, {tiles} tile sheets" + (f"; missing: {' '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
