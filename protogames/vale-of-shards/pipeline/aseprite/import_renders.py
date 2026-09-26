"""Blender renders -> palette-locked .aseprite sources (art/aseprite/<name>.aseprite).

    python3 pipeline/aseprite/import_renders.py [name ...]     # default: every "blender" sprite

Reads build/renders/<name>/<tag>_<i>.png for every frame in the manifest's tag order
(a one-frame tag may also be <tag>.png, as the backdrops are: bg_moss/far.png,
title/scene.png), written by pipeline/blender/sprites.py and backdrops.py.

Sprites (every "blender" entry except the backdrops):
  1. alpha is thresholded at 50% (pixel art has no partial alpha);
  2. every colour snaps to the nearest palette colour (palette.nearest, no dithering, so
     characters stay clean);
  3. a 1-px outline in ink (palette index 0) goes around the silhouette, never on top of it.
Backdrops (bg_*, title; opaque, full frame):
  every pixel is ordered-dithered (4x4 Bayer) between two of its nearest palette colours
  (the pair that brackets it; see lock_backdrop), in proportion to where it lies between
  them. No outline.

Then save_sprite() writes the .aseprite and asserts the manifest contract (size, frame
count). A render missing from build/renders is an error: run the Blender scripts first.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
from canvas import BAYER4, Canvas  # noqa: E402
from manifest import SPRITES  # noqa: E402
from palette import COLORS, N, nearest  # noqa: E402
from sheet import save_sprite  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RENDERS = os.path.join(ROOT, "build", "renders")
BACKDROPS = {n for n in SPRITES if n.startswith("bg_")} | {"title"}
INK = N["ink"]

# frame duration in ms by tag (default 100)
DURATIONS = {
    "walk_r": 130, "walk_l": 130, "roll": 90, "idle": 420, "cast": 300, "hurt": 200,
    "left": 200, "hover": 200, "right": 200, "armored_left": 200, "armored_hover": 200,
    "armored_right": 200, "fall": 200, "aim": 100, "glow": 80, "whole": 500, "cracked": 500,
}


def frame_files(name: str) -> list[tuple[str, str]]:
    """(tag, path) for every frame of name, in manifest order."""
    d = os.path.join(RENDERS, name)
    out = []
    for tag, n in SPRITES[name][4]:
        for i in range(n):
            p = os.path.join(d, f"{tag}_{i}.png")
            if n == 1 and not os.path.exists(p):
                p = os.path.join(d, f"{tag}.png")
            if not os.path.exists(p):
                raise SystemExit(f"{name}: missing render {p} (run pipeline/blender/*.py first)")
            out.append((tag, p))
    return out


def lock_sprite(path: str) -> Canvas:
    im = Image.open(path).convert("RGBA")
    c = Canvas(im.width, im.height)
    cache: dict = {}
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            k = (r, g, b)
            if k not in cache:
                cache[k] = nearest(r, g, b)
            c.px[y * c.w + x] = cache[k]
    c.outline(INK)
    return c


_PAL = np.array(COLORS, dtype=np.float64)          # 48 x 3
NEAREST_K = 4
PAIR_SPREAD = 0.08    # penalty on far-apart pairs: less hue noise in dark areas
_BAYER = (np.array(BAYER4, dtype=np.float64) + 0.5) / 16.0


def _redmean(rgb: np.ndarray) -> np.ndarray:
    """Weighted squared distances (same metric as palette.nearest): pixels x 48."""
    r = rgb[:, None, :]
    p = _PAL[None, :, :]
    rm = (r[..., 0] + p[..., 0]) / 2
    d = r - p
    return (2 + rm / 256) * d[..., 0] ** 2 + 4 * d[..., 1] ** 2 + (2 + (255 - rm) / 256) * d[..., 2] ** 2


def lock_backdrop(path: str) -> Canvas:
    """Ordered dither between two palette colours per pixel. The pair is taken from the
    pixel's NEAREST_K nearest palette colours: the pair whose connecting line passes
    closest to the pixel's colour (usually the nearest colour and the next one on the other
    side of it). Taking simply the two nearest often picks two colours on the same side,
    and then gradients collapse into flat bands; the bracketing pair keeps them smooth."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    rgb = np.asarray(im, dtype=np.float64).reshape(-1, 3)
    order = np.argsort(_redmean(rgb), axis=1)[:, :NEAREST_K]
    wts = np.array([2.0, 4.0, 3.0])                  # redmean-like channel weights
    best_err = np.full(len(rgb), np.inf)
    best_a = order[:, 0].copy()
    best_b = order[:, 0].copy()
    best_t = np.zeros(len(rgb))
    for i in range(NEAREST_K):
        for j in range(i + 1, NEAREST_K):
            pa, pb = _PAL[order[:, i]], _PAL[order[:, j]]
            seg = pb - pa
            t = ((rgb - pa) * seg * wts).sum(1) / np.maximum((seg * seg * wts).sum(1), 1e-9)
            t = np.clip(t, 0.0, 1.0)
            q = pa + seg * t[:, None]
            err = (((rgb - q) ** 2) * wts).sum(1) + PAIR_SPREAD * ((seg ** 2) * wts).sum(1) + 1e-3 * (i + j)
            better = err < best_err
            best_err = np.where(better, err, best_err)
            best_a = np.where(better, order[:, i], best_a)
            best_b = np.where(better, order[:, j], best_b)
            best_t = np.where(better, t, best_t)
    ys, xs = np.divmod(np.arange(w * h), w)
    thr = _BAYER[ys % 4, xs % 4]
    idx = np.where(best_t > thr, best_b, best_a)
    c = Canvas(w, h)
    c.px = [int(v) for v in idx]
    return c


def import_one(name: str) -> str:
    files = frame_files(name)
    lock = lock_backdrop if name in BACKDROPS else lock_sprite
    frames = [lock(p) for _, p in files]
    for (tag, p), c in zip(files, frames):
        if all(v is None for v in c.px):
            raise SystemExit(f"{name}: {os.path.basename(p)} is empty")
    durations = [DURATIONS.get(tag, 100) for tag, _ in files]
    return save_sprite(name, frames, durations)


def main():
    names = sys.argv[1:] or [n for n, spec in SPRITES.items() if spec[3] == "blender"]
    for n in names:
        print(import_one(n))


if __name__ == "__main__":
    main()
