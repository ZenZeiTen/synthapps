#!/usr/bin/env python3
"""Pack render.mjs frames into a sprite sheet + metadata.

    python spritesheet.py <frames dir> <out.png> [--cols N] [--trim] [--pad 2]
                          [--scale 1] [--cell WxH] [--names dir0,dir1,...]
                          [--per-row K] [--start 0] [--end N] [--pivot 0.5,0.5]

Writes:
  <out.png>                    the atlas (RGBA)
  <out>.json                   generic: frames [{name, x, y, w, h}] (y from TOP), cell, fps
  <out>.playcanvas.json        PlayCanvas texture-atlas "frames" data (rect y from BOTTOM),
                               ready for modify_assets data.frames on a textureatlas asset

--trim crops every frame to the union bounding box of non-transparent pixels, so the
sprite stays registered (same pivot) across frames.
--per-row K with --names: rows are named groups (e.g. 8 directions x K walk frames).
--names without --per-row: one name per frame (e.g. S,W,N,E for a 4-direction strip,
  laid out with --cols).
--cell WxH: fixed cell size. A frame larger than the cell is an error unless --fit
  (scale down to fit, keeping aspect). Typical fixed-cell recipe: render 2x, --trim, --fit.
"""
import argparse
import glob
import json
import math
import os
import sys

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames')
    ap.add_argument('out')
    ap.add_argument('--cols', type=int)
    ap.add_argument('--trim', action='store_true')
    ap.add_argument('--pad', type=int, default=2)
    ap.add_argument('--scale', type=float, default=1)
    ap.add_argument('--cell')
    ap.add_argument('--fit', action='store_true', help='with --cell: scale frames down to fit the cell')
    ap.add_argument('--names')
    ap.add_argument('--per-row', type=int)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--end', type=int)
    ap.add_argument('--pivot', default='0.5,0.5')
    ap.add_argument('--pow2', action='store_true', help='round the atlas up to power-of-two sides')
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.frames, 'frame_*.png')))[a.start:a.end]
    if not files:
        sys.exit(f'no frame_*.png in {a.frames}')
    ims = [Image.open(f).convert('RGBA') for f in files]

    if a.trim:
        box = None
        for im in ims:
            b = im.getchannel('A').getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        if box is None:
            sys.exit('--trim: every frame is fully transparent (render with --alpha?)')
        ims = [im.crop(box) for im in ims]
    else:
        box = (0, 0, ims[0].width, ims[0].height)

    if a.scale != 1:
        ims = [im.resize((max(1, round(im.width * a.scale)), max(1, round(im.height * a.scale))), Image.LANCZOS) for im in ims]
    cw, ch = ims[0].size
    if a.cell:
        cw, ch = map(int, a.cell.lower().split('x'))
        out = []
        if a.fit:
            f = min(1.0, cw / max(im.width for im in ims), ch / max(im.height for im in ims))
            if f < 1:   # one factor for all frames so the sprite keeps its scale
                ims = [im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS) for im in ims]
        big = [i for i, im in enumerate(ims) if im.width > cw or im.height > ch]
        if big:
            sys.exit(f'--cell {cw}x{ch}: frames {big[:5]} are {ims[big[0]].width}x{ims[big[0]].height} and would be cropped; '
                     f'use --fit, --trim, a smaller render or --scale')
        for im in ims:
            c = Image.new('RGBA', (cw, ch))
            c.paste(im, ((cw - im.width) // 2, (ch - im.height) // 2))
            out.append(c)
        ims = out

    n = len(ims)
    names = a.names.split(',') if a.names else None
    if names and a.per_row:
        if len(names) * a.per_row != n:
            sys.exit(f'--names x --per-row = {len(names) * a.per_row} but there are {n} frames')
        cols = a.per_row
    else:
        if names and len(names) != n:
            sys.exit(f'--names has {len(names)} names but there are {n} frames (or add --per-row K)')
        cols = a.cols or math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    p = a.pad
    W, H = cols * (cw + p) + p, rows * (ch + p) + p
    if a.pow2:
        W, H = 1 << (W - 1).bit_length(), 1 << (H - 1).bit_length()
    sheet = Image.new('RGBA', (W, H))
    px, py = map(float, a.pivot.split(','))

    frames, pc_frames = [], {}
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        x, y = p + c * (cw + p), p + r * (ch + p)
        sheet.paste(im, (x, y))
        if names and a.per_row:
            name = f'{names[r]}_{c}'
        elif names:
            name = names[i]
        else:
            name = f'frame_{i}'
        frames.append({'name': name, 'x': x, 'y': y, 'w': cw, 'h': ch, 'source': os.path.basename(files[i])})
        pc_frames[str(i)] = {'name': name, 'rect': [x, H - y - ch, cw, ch], 'pivot': [px, py], 'border': [0, 0, 0, 0]}

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sheet.save(a.out)
    base = os.path.splitext(a.out)[0]
    fps = None
    man = os.path.join(a.frames, 'manifest.json')
    if os.path.exists(man):
        fps = json.load(open(man)).get('fps')
    meta = {'image': os.path.basename(a.out), 'size': [W, H], 'cell': [cw, ch], 'cols': cols, 'rows': rows,
            'pad': p, 'fps': fps, 'trimBox': list(box), 'frames': frames}
    json.dump(meta, open(base + '.json', 'w'), indent=1)
    json.dump({'frames': pc_frames}, open(base + '.playcanvas.json', 'w'), indent=1)
    print(f'{a.out}: {n} frames, cell {cw}x{ch}, {cols}x{rows} grid, sheet {W}x{H}')


if __name__ == '__main__':
    main()
