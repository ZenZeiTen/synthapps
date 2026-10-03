#!/usr/bin/env python3
"""Check a render.mjs frame folder and build a contact sheet to look at.

    python review.py <frames dir> [--out contact.png] [--count 12] [--cols 4] [--width 1600]
                     [--bg 60,140,70] [--pick 0,15,30] [--loop] [--sprite]

--loop    treat the frames as a loop: compare the wrap step (last -> first) with the
          ordinary frame-to-frame steps. A seamless loop's wrap looks like any other step.
          Strongest proof: render with --extra 1 and check frame N == frame 0 (printed
          automatically when the manifest says extra >= 1).
--sprite  label contact-sheet tiles by index only (frames are directions, not times)

Prints: frame count vs manifest, size, blank frames (one flat colour / fully
transparent), frozen runs (consecutive identical frames), and mean motion per frame.
Exits 1 when frames are missing or every frame is blank, so it can gate a pipeline.
Transparent frames are composited over --bg so alpha problems are visible.
"""
import argparse
import glob
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('--out')
    ap.add_argument('--count', type=int, default=12)
    ap.add_argument('--cols', type=int, default=4)
    ap.add_argument('--width', type=int, default=1600)
    ap.add_argument('--bg', default='60,140,70')
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--sprite', action='store_true')
    ap.add_argument('--pick', help='explicit frame indices for the contact sheet, e.g. 0,15,30')
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.frames, 'frame_*.png')))
    if not files:
        sys.exit(f'no frame_*.png in {a.frames}')
    man_path = os.path.join(a.frames, 'manifest.json')
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    expected = man.get('frames')
    ok = True
    if expected is not None and expected != len(files):
        print(f'MISSING: manifest says {expected} frames, folder has {len(files)}')
        ok = False

    hashes, blanks, motion, steps = [], [], [], []
    first_rgb = prev_rgb = None
    prev = None
    for i, f in enumerate(files):
        raw = open(f, 'rb').read()
        hashes.append(hashlib.md5(raw).hexdigest())
        im = np.asarray(Image.open(f).convert('RGBA')).astype(np.int16)
        if im[..., 3].max() == 0 or (im[..., :3].reshape(-1, 3).std(0).max() < 0.5):
            blanks.append(i)
        rgb = im[..., :3]
        if a.loop:
            if prev_rgb is not None:
                steps.append(float(np.abs(rgb - prev_rgb).mean()))
            if first_rgb is None:
                first_rgb = rgb
            prev_rgb = rgb
        small = im[::4, ::4]   # quick motion estimate: every 4th pixel, RGBA
        if prev is not None:
            motion.append(float(np.abs(small - prev).mean()))
        prev = small

    frozen, run = [], 0
    for i in range(1, len(hashes)):
        if hashes[i] == hashes[i - 1]:
            run += 1
        else:
            if run:
                frozen.append((i - 1 - run, i - 1))
            run = 0
    if run:
        frozen.append((len(hashes) - 1 - run, len(hashes) - 1))

    w, h = Image.open(files[0]).size
    print(f'{len(files)} frames, {w}x{h}, fps {man.get("fps")}, alpha {man.get("alpha")}')
    print(f'blank frames: {blanks if blanks else "none"}')
    print(f'frozen runs (identical consecutive frames): {frozen if frozen else "none"}')
    if motion:
        mo = np.array(motion)
        print(f'motion per frame: mean {mo.mean():.2f}, min {mo.min():.2f} (frame {int(mo.argmin()) + 1}), max {mo.max():.2f} (frame {int(mo.argmax()) + 1})')
    if a.loop and steps:
        extra = int(man.get('extra') or 0)
        if extra >= 1:
            n_loop = len(files) - extra
            same = hashes[n_loop] == hashes[0]
            print(f'loop proof: frame {n_loop} (t = loop length) vs frame 0: {"IDENTICAL" if same else "DIFFERENT"}')
            if not same:
                ok = False
            body = steps[:n_loop - 1]
            wrap = float(np.abs(np.asarray(Image.open(files[n_loop - 1]).convert('RGB')).astype(np.int16) - first_rgb).mean())
        else:
            body = steps
            wrap = float(np.abs(prev_rgb - first_rgb).mean())
        b = np.array(body)
        verdict = 'seamless (within the normal step range)' if b.min() * 0.5 <= wrap <= b.max() * 1.5 else 'POP or HOLD at the seam'
        print(f'loop wrap step (last -> first): {wrap:.3f}; normal steps {b.min():.3f}..{b.max():.3f} (mean {b.mean():.3f}) -> {verdict}')
        if not verdict.startswith('seamless'):
            ok = False
        if wrap < 1e-9:
            print('  wrap step is 0: the last frame equals the first, so the loop holds one frame (drop the last frame)')
    if len(blanks) == len(files):
        print('ALL FRAMES BLANK')
        ok = False

    if a.out:
        idx = [int(x) for x in a.pick.split(',')] if a.pick else None
        if idx is None:
            n = min(a.count, len(files))
            idx = sorted({round(i * (len(files) - 1) / max(1, n - 1)) for i in range(n)})
        cols = min(a.cols, len(idx))
        rows = (len(idx) + cols - 1) // cols
        cw = a.width // cols
        chh = round(cw * h / w)
        bg = tuple(int(x) for x in a.bg.split(',')) + (255,)
        sheet = Image.new('RGBA', (cols * cw, rows * (chh + 18)), (20, 20, 24, 255))
        d = ImageDraw.Draw(sheet)
        for j, i in enumerate(idx):
            im = Image.open(files[i]).convert('RGBA').resize((cw, chh), Image.LANCZOS)
            tile = Image.new('RGBA', (cw, chh), bg)
            tile.alpha_composite(im)
            r, c = divmod(j, cols)
            sheet.paste(tile, (c * cw, r * (chh + 18) + 18))
            fps = man.get('fps') or 30
            label = f'#{i}' if a.sprite else f'#{i}  t={i / fps:.2f}s'
            d.text((c * cw + 4, r * (chh + 18) + 3), label, fill=(230, 230, 230, 255))
        sheet.convert('RGB').save(a.out)
        print(f'contact sheet: {a.out} (frames {idx})')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
