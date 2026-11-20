"""Pixel-exact check of everything the Aseprite MCP exported.

Every frame in content/sprites/*.png is compared, pixel by pixel, against the ASCII
definition it was drawn from (dumped by tools/dump_art.mjs), using the frame rects in
Aseprite's own JSON sidecar. The font sheet and every texture are checked the same
way. "The file exists" is not evidence; this is.

    node tools/dump_art.mjs && python tests/verify_art.py
"""
import json, sys, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dump = json.load(open(os.path.join(ROOT, 'build', 'art_dump.json'), encoding='utf-8'))
PAL = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in dump['EGA'].items()}
errors = []


def expect_rows(img, ox, oy, rows, label):
    bad = 0
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            r, g, b, a = img.getpixel((ox + x, oy + y))
            if ch in PAL:
                ok = a == 255 and (r, g, b) == PAL[ch]
            else:
                ok = a == 0
            if not ok:
                bad += 1
                if bad <= 3:
                    errors.append(f'{label} ({x},{y}): expected {ch!r}, got {(r, g, b, a)}')
    return bad


total = 0
for name, spr in dump['sprites'].items():
    img = Image.open(os.path.join(ROOT, 'content', 'sprites', name + '.png')).convert('RGBA')
    side = json.load(open(os.path.join(ROOT, 'content', 'sprites', name + '.json'), encoding='utf-8'))
    frames = side['frames']
    rects = [f['frame'] for f in (frames.values() if isinstance(frames, dict) else frames)]
    if len(rects) != len(spr['frames']):
        errors.append(f'{name}: sidecar has {len(rects)} frames, definition {len(spr["frames"])}')
        continue
    for rect, (fname, rows) in zip(rects, spr['frames']):
        if (rect['w'], rect['h']) != (len(rows[0]), len(rows)):
            errors.append(f'{name}.{fname}: rect {rect} vs size {len(rows[0])}x{len(rows)}')
            continue
        total += 1
        expect_rows(img, rect['x'], rect['y'], rows, f'{name}.{fname}')
    tags = [t['name'] for t in side['meta'].get('frameTags', [])]
    if tags != [t[0] for t in spr['tags']]:
        errors.append(f'{name}: tags {tags} vs {[t[0] for t in spr["tags"]]}')

font = Image.open(os.path.join(ROOT, 'content', 'font', 'font.png')).convert('RGBA')
want = {(p['x'], p['y']) for p in dump['font_points']}
for y in range(font.height):
    for x in range(font.width):
        r, g, b, a = font.getpixel((x, y))
        lit = a == 255 and (r, g, b) == (255, 255, 255)
        if lit != ((x, y) in want):
            errors.append(f'font ({x},{y}): lit={lit}')
tex_checked = 0
for name, rows in dump['textures'].items():
    p = os.path.join(ROOT, 'art', 'textures', name + '.png')
    if not os.path.exists(p):
        continue
    tex_checked += 1
    expect_rows(Image.open(p).convert('RGBA'), 0, 0, rows, f'texture {name}')

if errors:
    print('\n'.join(errors[:40]))
    print(f'FAIL: {len(errors)} problems')
    sys.exit(1)
print(f'ok: {total} sprite frames, font {font.width}x{font.height}, {tex_checked} textures pixel-exact')
