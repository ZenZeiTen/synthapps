"""Step 1 of the art pipeline: draw every pixel asset and save it as an editable
.aseprite source in art/aseprite/. Nothing here writes game content; export_art.py
reads the .aseprite files back, so hand edits made in Aseprite are what ships.

    python pipeline/aseprite/build_art.py [--only textures,ui,items,portraits]
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import asefile as A  # noqa: E402
from palette import RGBA  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "art", "aseprite")


def save(name: str, frames, ms: int = 100, tags=None):
    w, h = frames[0].w, frames[0].h
    spr = A.Sprite(w, h, [A.Frame([f.to_rgba()], ms) for f in frames], ["art"], list(RGBA), tags or [])
    A.write(os.path.join(OUT, name + ".aseprite"), spr)


def main():
    only = next((a[7:].split(",") for a in sys.argv if a.startswith("--only=")), None)
    want = lambda k: only is None or k in only  # noqa: E731
    os.makedirs(OUT, exist_ok=True)
    n = 0
    if want("textures"):
        from art_textures import TEXTURES, FRAME_MS
        for name, fn in TEXTURES.items():
            frames = fn()
            save("tex_" + name, frames, FRAME_MS.get(name, 100), [("loop", 0, len(frames) - 1)] if len(frames) > 1 else None)
            n += 1
    if want("ui"):
        from art_ui import UI
        for name, fn in UI.items():
            save("ui_" + name, fn())
            n += 1
    if want("items"):
        from art_items import ITEMS
        for name, fn in ITEMS.items():
            save("item_" + name, [fn()])
            n += 1
    if want("portraits"):
        from art_portraits import PORTRAITS
        for name, fn in PORTRAITS.items():
            save("portrait_" + name, [fn()])
            n += 1
    print(f"wrote {n} .aseprite files to {OUT}")


if __name__ == "__main__":
    main()
