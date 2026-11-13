#!/usr/bin/env python3
"""Turn the raw Blender renders into the game's pixel-art PNGs.

    python3 tools/blender/pixelize.py            # everything
    python3 tools/blender/pixelize.py --report   # also print the readability numbers

Backgrounds: 2x render -> box filter -> limited palette (k-means) with a subtle
ordered (Bayer 4x4) dither.  Sprites: 8x render -> premultiplied box filter ->
alpha snapped fully on/off -> small palette, no dither -> 1 px dark outline.
Deterministic: no random numbers are used.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "art", "blender", "render")
DST = os.path.join(ROOT, "godot", "assets", "art")

BG_SCALE = 2
SPR_SCALE = 8
OUTLINE = (24, 10, 34)

BACKGROUNDS = {"bg_floor1": 44, "bg_floor2": 44, "bg_floor3": 44, "bg_floor4": 44, "bg_floor5": 40, "bg_title": 44}       # name -> palette size
# name -> (frame_w, frame_h, frames, colours, palette per frame?, raw is one wide image?)
SPRITES = {
    "chip_spin": (24, 24, 8, 10, False, False),
    "chips": (20, 20, 5, 6, True, True),
    "star_spin": (24, 24, 8, 8, False, False),
    "trophy": (64, 64, 1, 14, False, True),
    "coin_burst": (32, 32, 6, 8, False, False),
}
BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) + 0.5) / 16 - 0.5


def load(name):
    return np.asarray(Image.open(os.path.join(RAW, name + ".png"))).astype(np.float32)


def box_down(a, s):
    h, w, c = a.shape
    assert h % s == 0 and w % s == 0, (a.shape, s)
    return a.reshape(h // s, s, w // s, s, c).mean(axis=(1, 3))


def nearest(px, pal):
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(axis=2)
    return d.argmin(axis=1)


def kmeans_palette(px, k, iters=16):
    """Deterministic k-means; seeded from PIL's median cut."""
    px = px.reshape(-1, 3)
    n = len(px)
    side = int(np.ceil(np.sqrt(n)))
    pad = np.concatenate([px, np.repeat(px[-1:], side * side - n, axis=0)])
    im = Image.fromarray(pad.reshape(side, side, 3).clip(0, 255).astype(np.uint8), "RGB")
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    used = sorted(set(q.getdata()))
    pal = np.array(q.getpalette()[: 3 * (max(used) + 1)], dtype=np.float32).reshape(-1, 3)[used]
    for _ in range(iters):
        idx = nearest(px, pal)
        for i in range(len(pal)):
            sel = px[idx == i]
            if len(sel):
                pal[i] = sel.mean(axis=0)
    return np.unique(np.round(pal), axis=0).astype(np.float32)


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def background(name, colours, dither=9.0):
    a = box_down(load(name)[..., :3], BG_SCALE)
    h, w, _ = a.shape
    pal = kmeans_palette(a, colours)
    bay = np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w, None] * dither
    idx = nearest((a + bay).reshape(-1, 3), pal)
    out = pal[idx].reshape(h, w, 3).astype(np.uint8)
    Image.fromarray(out, "RGB").save(os.path.join(DST, name + ".png"), optimize=True)
    return out


def sprite(name, fw, fh, frames, colours, per_frame, wide):
    if wide:
        raw = load(name)
    else:
        raw = np.concatenate([load(f"{name}_{i}") for i in range(frames)], axis=1)
    alpha = raw[..., 3:4] / 255.0
    pm = box_down(raw[..., :3] * alpha, SPR_SCALE)
    al = box_down(alpha, SPR_SCALE)
    rgb = pm / np.maximum(al, 1e-4)
    mask = al[..., 0] >= 0.5
    assert rgb.shape[:2] == (fh, fw * frames), rgb.shape
    out = np.zeros((fh, fw * frames, 4), dtype=np.uint8)
    shared = None if per_frame else kmeans_palette(rgb[mask], colours)
    for f in range(frames):
        sl = slice(f * fw, (f + 1) * fw)
        m, c = mask[:, sl], rgb[:, sl]
        if m.any():
            pal = shared if shared is not None else kmeans_palette(c[m], colours)
            q = pal[nearest(c[m], pal)]
            fr = np.zeros((fh, fw, 4), dtype=np.uint8)
            fr[m, :3] = q.astype(np.uint8)
            fr[m, 3] = 255
            if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any():
                print(f"WARNING {name} frame {f}: sprite touches the frame edge, outline is clipped")
            grow = np.zeros_like(m)
            grow[1:] |= m[:-1]
            grow[:-1] |= m[1:]
            grow[:, 1:] |= m[:, :-1]
            grow[:, :-1] |= m[:, 1:]
            edge = grow & ~m
            fr[edge, :3] = OUTLINE
            fr[edge, 3] = 255
            out[:, sl] = fr
    Image.fromarray(out, "RGBA").save(os.path.join(DST, name + ".png"), optimize=True)
    return out


def report(name, img):
    regions = [("logo x120..520 y30..170", (120, 30, 520, 170))] if name == "bg_title" else [
        ("felt x60..580 y150..350", (60, 150, 580, 350)), ("top-centre x250..390 y0..120", (250, 0, 390, 120))]
    for label, (x0, y0, x1, y1) in regions:
        lum = luminance(img[y0:y1, x0:x1].astype(np.float32))
        print(f"  {name:9s} {label:30s} mean {lum.mean():6.1f}  std {lum.std():5.1f}  max {lum.max():5.0f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    os.makedirs(DST, exist_ok=True)
    for name, colours in BACKGROUNDS.items():
        if not os.path.exists(os.path.join(RAW, name + ".png")):
            print(f"skip {name}: no raw render")
            continue
        img = background(name, colours)
        n = len(np.unique(img.reshape(-1, 3), axis=0))
        print(f"{name}.png {img.shape[1]}x{img.shape[0]} colours={n}")
        if a.report:
            report(name, img)
    meta = {}
    for name, (fw, fh, frames, colours, per_frame, wide) in SPRITES.items():
        img = sprite(name, fw, fh, frames, colours, per_frame, wide)
        al = img[..., 3]
        assert set(np.unique(al)) <= {0, 255}
        n = len(np.unique(img[al > 0][:, :3], axis=0))
        print(f"{name}.png {img.shape[1]}x{img.shape[0]} colours={n} transparent={(al == 0).mean() * 100:.0f}%")
        meta[name] = {"frame_w": fw, "frame_h": fh, "frames": frames}
    with open(os.path.join(DST, "blender_sprites.json"), "w") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
