"""Step 2 of the art pipeline: read every art/aseprite/*.aseprite and export PNGs
into the Godot content package. Multi-frame sprites become a horizontal strip plus
a JSON sidecar in Aseprite's json-array layout (frame rects + durations + tags).

    python pipeline/aseprite/export_art.py
"""
from __future__ import annotations

import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import asefile as A  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "art", "aseprite")
DEST = {"tex": "textures", "ui": "ui", "item": "items", "portrait": "portraits"}


def export_one(path: str) -> str:
    base = os.path.basename(path)[:-len(".aseprite")]
    kind, name = base.split("_", 1)
    out_dir = os.path.join(ROOT, "godot", "content", DEST[kind])
    os.makedirs(out_dir, exist_ok=True)
    spr = A.read(path)
    n = len(spr.frames)
    img = Image.new("RGBA", (spr.width * n, spr.height))
    frames_meta = []
    for i in range(n):
        px = A.flatten(spr, i)
        fr = Image.new("RGBA", (spr.width, spr.height))
        fr.putdata(px)
        img.paste(fr, (i * spr.width, 0))
        frames_meta.append({"frame": {"x": i * spr.width, "y": 0, "w": spr.width, "h": spr.height},
                            "duration": spr.frames[i].duration_ms})
    png = os.path.join(out_dir, name + ".png")
    img.save(png, optimize=False)
    if n > 1:
        meta = {"frames": frames_meta, "meta": {"size": {"w": img.width, "h": img.height},
                "frameTags": [{"name": t, "from": a, "to": b, "direction": "forward"} for (t, a, b) in spr.tags]}}
        with open(os.path.join(out_dir, name + ".json"), "w") as f:
            json.dump(meta, f, indent=1)
    return png


def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.aseprite")))
    for p in files:
        export_one(p)
    print(f"exported {len(files)} sprites")


if __name__ == "__main__":
    main()
