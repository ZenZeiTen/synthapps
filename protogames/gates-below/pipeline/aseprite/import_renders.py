"""Blender renders -> palette-locked, outlined .aseprite sources (art/aseprite/mob_*.aseprite).

    python3 pipeline/aseprite/import_renders.py [name ...]

For each build/renders/<name>/<frame>.png:
  1. alpha is thresholded at 50% (pixel art has no partial alpha);
  2. every colour snaps to the nearest palette colour (weighted RGB distance, no
     dithering: characters stay clean; see aseprite-pixel-forge, 'From Blender renders');
  3. a 1-px outline in the palette's near-black violet (index 1) goes around the
     silhouette, never on top of it.
Frames become one sprite with tags idle, attack, hurt, side, back.
"""
from __future__ import annotations

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import asefile as A  # noqa: E402
from canvas import Canvas  # noqa: E402
from palette import RGB, RGBA  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRAMES = ["idle_0", "idle_1", "attack_0", "attack_1", "hurt", "side_0", "side_1", "back_0", "back_1"]
TAGS = [("idle", 0, 1), ("attack", 2, 3), ("hurt", 4, 4), ("side", 5, 6), ("back", 7, 8)]
NPC_TAGS = [("idle", 0, 1)]
DURATIONS = {"idle": 400, "attack": 160, "hurt": 200, "side": 180, "back": 180}


def nearest(r: int, g: int, b: int) -> int:
    best, bi = 1e18, 0
    for i, (R, G, B) in enumerate(RGB):
        # "redmean" weighting: cheap and close to perceptual for these ramps
        rm = (r + R) / 2
        d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
        if d < best:
            best, bi = d, i
    return bi


def lock(path: str) -> Canvas:
    im = Image.open(path).convert("RGBA")
    c = Canvas(im.width, im.height)
    cache: dict = {}
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = im.getpixel((x, y))
            if a < 128:
                continue
            k = (r, g, b)
            if k not in cache:
                cache[k] = nearest(r, g, b)
            c.px[y * c.w + x] = cache[k]
    c.outline(1)
    return c


def import_one(name: str) -> str:
    d = os.path.join(ROOT, "build", "renders", name)
    frames = [f for f in FRAMES if os.path.exists(os.path.join(d, f + ".png"))]
    canv = [lock(os.path.join(d, f + ".png")) for f in frames]
    tags = TAGS if len(frames) == len(FRAMES) else NPC_TAGS
    dur = {}
    for (t, a, b) in tags:
        for i in range(a, b + 1):
            dur[i] = DURATIONS[t]
    spr = A.Sprite(canv[0].w, canv[0].h, [A.Frame([k.to_rgba()], dur.get(i, 200)) for i, k in enumerate(canv)],
                   ["art"], list(RGBA), tags)
    out = os.path.join(ROOT, "art", "aseprite", f"mob_{name}.aseprite")
    A.write(out, spr)
    return out


def main():
    names = sys.argv[1:] or sorted(os.listdir(os.path.join(ROOT, "build", "renders")))
    for n in names:
        print(import_one(n))


if __name__ == "__main__":
    main()
