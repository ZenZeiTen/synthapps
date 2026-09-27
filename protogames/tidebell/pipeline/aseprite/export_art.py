"""Export every .aseprite source in the manifest to both builds.

    python3 pipeline/aseprite/export_art.py

Reads art/aseprite/<name>.aseprite (never the drawing code, so an edit made in Aseprite
ships) and writes, for godot/content and web/public/content:
  sprites/<name>.png   a horizontal strip of frames
  tiles/<theme>.png    the tile sheets (tiles_<theme>.aseprite)
  backdrops/<theme>_far.png, _mid.png   (bg_<theme>_<layer>.aseprite)
  stills/<name>.png    the painted stills (still_<name>.aseprite)
and content/data/manifest.json (sizes, origins, tags), which sync_content.py copies.

With Aseprite installed the same strip is
  aseprite -b art/aseprite/kess.aseprite --sheet kess.png --sheet-type horizontal
"""
from __future__ import annotations

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asefile as A  # noqa: E402
from manifest import SPRITES, STILLS, THEMES, write_manifest  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art", "aseprite")
OUTS = [os.path.join(ROOT, "godot", "content"), os.path.join(ROOT, "web", "public", "content")]


def image(spr: A.Sprite, frame: int) -> Image.Image:
    im = Image.new("RGBA", (spr.width, spr.height))
    im.putdata(A.flatten(spr, frame))
    return im


def main() -> None:
    missing = []
    for out in OUTS:
        os.makedirs(os.path.join(out, "sprites"), exist_ok=True)
        os.makedirs(os.path.join(out, "tiles"), exist_ok=True)
        os.makedirs(os.path.join(out, "backdrops"), exist_ok=True)
        os.makedirs(os.path.join(out, "stills"), exist_ok=True)
    n = 0
    for name, (w, h, _org, _src, tags) in SPRITES.items():
        path = os.path.join(ART, name + ".aseprite")
        if not os.path.exists(path):
            missing.append(name)
            continue
        spr = A.read(path)
        want = sum(k for _, k in tags)
        assert (spr.width, spr.height) == (w, h) and len(spr.frames) == want, name
        strip = Image.new("RGBA", (w * want, h))
        for i in range(want):
            strip.paste(image(spr, i), (i * w, 0))
        for out in OUTS:
            strip.save(os.path.join(out, "sprites", name + ".png"), optimize=True)
        n += 1
    for theme in THEMES:
        spr = A.read(os.path.join(ART, "tiles_" + theme + ".aseprite"))
        for out in OUTS:
            image(spr, 0).save(os.path.join(out, "tiles", theme + ".png"), optimize=True)
    for theme in THEMES:
        for layer in ("far", "mid"):
            path = os.path.join(ART, f"bg_{theme}_{layer}.aseprite")
            if not os.path.exists(path):
                missing.append(f"bg_{theme}_{layer}")
                continue
            im = image(A.read(path), 0)
            for out in OUTS:
                im.save(os.path.join(out, "backdrops", f"{theme}_{layer}.png"), optimize=True)
    for still in STILLS:
        path = os.path.join(ART, f"still_{still}.aseprite")
        if not os.path.exists(path):
            missing.append("still_" + still)
            continue
        im = image(A.read(path), 0)
        for out in OUTS:
            im.save(os.path.join(out, "stills", still + ".png"), optimize=True)
    write_manifest(ROOT)
    # the palette, for the three.js build's last pass (it snaps every pixel to these)
    import json
    from palette import COLORS
    with open(os.path.join(ROOT, "content", "data", "palette.json"), "w") as f:
        json.dump([list(c) for c in COLORS], f)
        f.write("\n")
    print("exported %d sprites, %d tile sets%s" % (n, len(THEMES),
          ("; missing: " + ", ".join(missing)) if missing else ""))


if __name__ == "__main__":
    main()
