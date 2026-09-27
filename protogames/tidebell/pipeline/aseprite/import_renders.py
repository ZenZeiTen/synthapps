"""Reduce Blender and reality.js renders (build/renders/*.png) to the palette and store
them as .aseprite sources in art/aseprite/, so they ship through the same export as the
drawn art.

    python3 pipeline/aseprite/import_renders.py

- bg_<theme>_far / _mid: the stage backdrops (640x224). Mid layers are pushed back
  (darkened toward night blue) so they never read as platforms.
- still_<name>: the painted stills (title, map, dawn), 320x224.
- sprite renders (siltking, bell): frames side by side in build/renders/<name>.png;
  written to the manifest's sprite of that name.
Colours are matched with 4x4 ordered dither between the two nearest palette colours.
"""
from __future__ import annotations

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import asefile as A  # noqa: E402
from canvas import BAYER4  # noqa: E402
from manifest import SPRITES, STILLS, THEMES  # noqa: E402
from palette import COLORS, RGBA  # noqa: E402
from sheet import ART, save_sprite  # noqa: E402
from canvas import Canvas  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
REN = os.path.join(ROOT, "build", "renders")
_cache: dict = {}


def two_nearest(r, g, b):
    k = (r >> 2, g >> 2, b >> 2)
    if k in _cache:
        return _cache[k]
    ds = []
    for i, (R, G, B) in enumerate(COLORS):
        rm = (r + R) / 2
        d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
        ds.append((d, i))
    ds.sort()
    (d0, i0), (d1, i1) = ds[0], ds[1]
    t = d0 / (d0 + d1) if d0 + d1 > 0 else 0.0
    _cache[k] = (i0, i1, t)
    return _cache[k]


def quantize(im: Image.Image, dither=True, alpha_cut=128) -> Canvas:
    im = im.convert("RGBA")
    c = Canvas(im.width, im.height)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < alpha_cut:
                continue
            i0, i1, t = two_nearest(r, g, b)
            if dither and t > 0.18 and (BAYER4[y % 4][x % 4] + 0.5) / 16.0 < t:
                c.px[y * c.w + x] = i1
            else:
                c.px[y * c.w + x] = i0
    return c


def push_back(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (int(r * 0.55 + 8), int(g * 0.55 + 10), int(b * 0.6 + 30), a)
    return im


def save_image(name: str, c: Canvas) -> str:
    spr = A.Sprite(c.w, c.h, [A.Frame([c.to_rgba()], 100)], ["render"], list(RGBA), [])
    path = os.path.join(ART, name + ".aseprite")
    A.write(path, spr)
    return path


def main() -> None:
    done = []
    for theme in THEMES:
        for layer in ("far", "mid"):
            src = os.path.join(REN, f"bg_{theme}_{layer}.png")
            if not os.path.exists(src):
                continue
            im = Image.open(src)
            if layer == "mid":
                im = push_back(im)
            done.append(save_image(f"bg_{theme}_{layer}", quantize(im)))
    for still in STILLS:
        src = os.path.join(REN, f"still_{still}.png")
        if os.path.exists(src):
            im = Image.open(src).convert("RGBA").resize((320, 224), Image.LANCZOS)
            done.append(save_image(f"still_{still}", quantize(im)))
    for name, (w, h, _o, source, tags) in SPRITES.items():
        src = os.path.join(REN, name + ".png")
        if source != "blender" or not os.path.exists(src):
            continue
        im = Image.open(src).convert("RGBA")
        n = sum(k for _, k in tags)
        frames = []
        for i in range(n):
            f = quantize(im.crop((i * w, 0, (i + 1) * w, h)), dither=False)
            f.outline("ink")
            frames.append(f)
        done.append(save_sprite(name, frames))
    print("imported %d renders" % len(done))


if __name__ == "__main__":
    main()
