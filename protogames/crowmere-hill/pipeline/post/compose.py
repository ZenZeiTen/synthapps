"""Turn Blender's raw passes (build/rooms/<room>/) into game assets (content/rooms/<room>/).

  bg.png        the finished 320x168 EGA background
  depth.png     R = scene depth, G = floor depth under a walkable pixel, B = walk mask
  ov_<s>.png    state overlays (open doors...), cropped, alpha = changed pixels
  room.json     walk mask (RLE), points, zones, markers, overlays, depth range

Shading is EGA-authentic: never a blend. Each colour has a ramp of darker EGA colours
(white -> light grey -> dark grey -> black, yellow -> brown -> black...). The EEVEE
light pass picks a position along that ramp, and a 4x4 Bayer matrix dithers between
neighbouring steps -- which is how EGA artists shaded with 16 colours.

Outlines are 1px black lines on the nearer object wherever the object-id changes AND
depth jumps (a silhouette), so creases like wall/floor get no line.

    python pipeline/post/compose.py [room ...]
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EGA = np.array([(0, 0, 0), (0, 0, 170), (0, 170, 0), (0, 170, 170), (170, 0, 0), (170, 0, 170), (170, 85, 0), (170, 170, 170),
                (85, 85, 85), (85, 85, 255), (85, 255, 85), (85, 255, 255), (255, 85, 85), (255, 85, 255), (255, 255, 85), (255, 255, 255)],
               dtype=np.int32)
# darker steps for each EGA index (0 black ... 15 white)
RAMP = {0: [0], 1: [1, 0], 2: [2, 0], 3: [3, 1, 0], 4: [4, 0], 5: [5, 1, 0], 6: [6, 0], 7: [7, 8, 0],
        8: [8, 0], 9: [9, 1, 0], 10: [10, 2, 0], 11: [11, 3, 1, 0], 12: [12, 4, 0], 13: [13, 5, 1, 0], 14: [14, 6, 0], 15: [15, 7, 8, 0]}
# one brighter step, used only where the light is strong (candle pools, lamp glow)
UP = {0: 8, 1: 9, 2: 10, 3: 11, 4: 12, 5: 13, 6: 14, 7: 15, 8: 7, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 15, 15: 15}
BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) + 0.5) / 16.0
DEFAULT_SHADE = {'full': 0.55, 'black': 0.08, 'steps': 3.0, 'hi': 0.93, 'outline_depth': 3}


def load(path, mode='RGBA'):
    return np.array(Image.open(path).convert(mode))


def to_index(rgba):
    """Nearest EGA index per pixel; -1 where transparent. Returns (index, max error)."""
    rgb = rgba[..., :3].astype(np.int32)
    d = ((rgb[..., None, :] - EGA[None, None, :, :]) ** 2).sum(-1)
    idx = d.argmin(-1)
    err = np.sqrt(d.min(-1))
    idx[rgba[..., 3] < 128] = -1
    return idx, float(err[rgba[..., 3] >= 128].max(initial=0.0))


def shade(idx, light, s):
    h, w = idx.shape
    L = light[..., :3].astype(np.float32).mean(-1) / 255.0
    t = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w]
    D = np.clip((s['full'] - L) / (s['full'] - s['black']), 0.0, 1.0) * s['steps']
    level = np.floor(D + t).astype(np.int32)
    out = idx.copy()
    for c, ramp in RAMP.items():
        m = idx == c
        if m.any():
            r = np.array(ramp)
            out[m] = r[np.minimum(level[m], len(ramp) - 1)]
    # highlight: dither one step brighter where the light exceeds `hi`
    H = np.clip((L - s['hi']) / max(1e-6, 1.0 - s['hi']), 0.0, 1.0)
    up = (H > t) & (idx >= 0) & (level == 0)
    if up.any():
        lut = np.array([UP[i] for i in range(16)])
        out[up] = lut[idx[up]]
    return out


def outlines(img, ids, depth, thr):
    h, w = img.shape
    out = img.copy()
    dep = depth.astype(np.int32).copy()
    dep[ids == 0] = 10_000
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nid = np.full_like(ids, -1)
        ndep = np.full_like(dep, -10_000)
        ys = slice(max(0, dy), h + min(0, dy)); yd = slice(max(0, -dy), h + min(0, -dy))
        xs = slice(max(0, dx), w + min(0, dx)); xd = slice(max(0, -dx), w + min(0, -dx))
        nid[yd, xd] = ids[ys, xs]
        ndep[yd, xd] = dep[ys, xs]
        edge = (ids > 0) & (nid >= 0) & (nid != ids) & (ndep - dep > thr)
        out[edge] = 0
    return out


def sky(h, w, seed=7):
    """Night sky for exteriors: blue dithered toward black at the top, a few stars."""
    y = np.arange(h, dtype=np.float32)[:, None].repeat(w, 1)
    t = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w]
    v = 1.0 - y / (h * 0.75)
    out = np.where(v * 1.3 > t + 0.35, 0, 1)
    rng = np.random.default_rng(seed)
    for _ in range(int(w * h * 0.004)):
        sx, sy = rng.integers(0, w), rng.integers(0, int(h * 0.6))
        out[sy, sx] = 15 if rng.random() < 0.3 else 7
    return out


def compose_image(d, prefix, meta, s):
    color = load(os.path.join(d, prefix + 'color.png'))
    idx, err = to_index(color)
    ids_rgba = load(os.path.join(d, prefix + 'ids.png'))
    ids = ids_rgba[..., 0].astype(np.int32) + 256 * ids_rgba[..., 1].astype(np.int32)
    ids[ids_rgba[..., 3] < 128] = 0
    depth = load(os.path.join(d, prefix + 'depth.png'))[..., 0]
    light = load(os.path.join(d, prefix + 'light.png'))
    img = shade(idx, light, s)
    glow = np.isin(ids, np.array(meta.get('glow_ids', []), dtype=np.int32))
    img = np.where(glow & (idx >= 0), idx, img)
    img = outlines(img, ids, depth, s['outline_depth'])
    if meta.get('sky'):
        sk = sky(*img.shape)
        img = np.where(idx < 0, sk, img)
    else:
        img = np.where(idx < 0, 0, img)
    return img, err, ids, depth


def rle_rows(mask):
    rows = []
    for y in range(mask.shape[0]):
        runs, x, w = [], 0, mask.shape[1]
        while x < w:
            if mask[y, x]:
                x0 = x
                while x < w and mask[y, x]:
                    x += 1
                runs += [x0, x - x0]
            else:
                x += 1
        rows.append(runs)
    return rows


def erode(mask, rx, ry):
    out = mask.copy()
    h, w = mask.shape
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            sh = np.zeros_like(mask)
            ys = slice(max(0, dy), h + min(0, dy)); yd = slice(max(0, -dy), h + min(0, -dy))
            xs = slice(max(0, dx), w + min(0, dx)); xd = slice(max(0, -dx), w + min(0, -dx))
            sh[yd, xd] = mask[ys, xs]
            out &= sh
    return out


def snap(mask, x, y, report, label):
    xi, yi = int(round(x)), int(round(y))
    h, w = mask.shape
    if 0 <= yi < h and 0 <= xi < w and mask[yi, xi]:
        return [xi, yi]
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        raise SystemExit(f'{label}: no walkable pixels at all')
    k = int(np.argmin((xs - x) ** 2 + ((ys - y) * 2.0) ** 2))
    report.append(f'{label} ({x:.0f},{y:.0f}) not walkable -> snapped to ({xs[k]},{ys[k]})')
    return [int(xs[k]), int(ys[k])]


def save_index_png(img, path, alpha=None):
    rgb = EGA[np.clip(img, 0, 15)].astype(np.uint8)
    if alpha is None:
        Image.fromarray(rgb, 'RGB').save(path, optimize=True)
    else:
        Image.fromarray(np.dstack([rgb, alpha.astype(np.uint8)]), 'RGBA').save(path, optimize=True)


def compose(room):
    d = os.path.join(ROOT, 'build', 'rooms', room)
    out = os.path.join(ROOT, 'content', 'rooms', room)
    os.makedirs(out, exist_ok=True)
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
    game = json.load(open(os.path.join(ROOT, 'content', 'game.json'), encoding='utf-8'))
    anims = json.load(open(os.path.join(ROOT, 'content', 'sprites', 'anims.json'), encoding='utf-8'))
    s = dict(DEFAULT_SHADE, **meta.get('shade', {}))
    report = []

    base, err, ids, depth = compose_image(d, '', meta, s)
    if err > 0:
        report.append(f'colour pass max error {err:.1f} (expected 0: check view transform/dither)')
    save_index_png(base, os.path.join(out, 'bg.png'))

    walk = load(os.path.join(d, 'walk.png'))
    walkable = (walk[..., 0] > 127) & (walk[..., 3] > 127)
    er = meta.get('erode', [3, 0])
    walk_ok = erode(walkable, er[0], er[1])
    scene_depth = np.where(depth == 0, 255, depth).astype(np.uint8)
    floor_depth = np.where(walkable, walk[..., 1], 0).astype(np.uint8)
    Image.fromarray(np.dstack([scene_depth, floor_depth, (walk_ok * 255).astype(np.uint8)]), 'RGB').save(os.path.join(out, 'depth.png'), optimize=True)

    points = {n: snap(walk_ok, v[0], v[1], report, f'point {n}') for n, v in meta['points'].items()}
    zones = {}
    for n, z in meta['zones'].items():
        zones[n] = {'poly': [[round(p[0], 1), round(p[1], 1)] for p in z['poly']], 'target': snap(walk_ok, *z['target'], report, f'zone {n} target')}
    markers = {n: [round(v[0]), round(v[1]), v[2]] for n, v in meta.get('markers', {}).items()}
    # probes are assertions, not destinations: never snapped (tests/lint.test.mjs reads them)
    probes = {n: {'x': round(v[0], 2), 'y': round(v[1], 2), 'walkable': bool(v[2])} for n, v in meta.get('probes', {}).items()}
    for n, p in probes.items():
        xi, yi = int(p['x']), int(p['y'])
        got = bool(0 <= yi < walk_ok.shape[0] and 0 <= xi < walk_ok.shape[1] and walk_ok[yi, xi])
        if got != p['walkable']:
            report.append(f'probe {n} expects {"walkable" if p["walkable"] else "blocked"}, mask says {"walkable" if got else "blocked"}')

    overlays = {}
    state_imgs = {}
    for sname, sinfo in meta.get('states', {}).items():
        img, err_s, _, _ = compose_image(d, sname + '_', meta, s)
        state_imgs[sname] = img
    for sname, img in state_imgs.items():
        ref = state_imgs[meta['states'][sname]['base']] if meta['states'][sname].get('base') else base
        changed = img != ref
        if not changed.any():
            report.append(f'state {sname}: renders identical to its base (no overlay)')
            continue
        ys, xs = np.nonzero(changed)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        crop = img[y0:y1, x0:x1]
        alpha = (changed[y0:y1, x0:x1] * 255)
        save_index_png(crop, os.path.join(out, f'ov_{sname}.png'), alpha)
        overlays[sname] = {'img': f'ov_{sname}.png', 'x': int(x0), 'y': int(y0)}

    # item overlays: an item sprite frame drawn at the marker of the same name
    item_frames = set(anims['items']['frames'])
    for oid in game['rooms'][room].get('overlays', {}):
        if oid in overlays:
            continue
        if oid in markers and oid in item_frames:
            overlays[oid] = {'sprite': 'items', 'frame': oid, 'x': markers[oid][0], 'y': markers[oid][1]}
        else:
            report.append(f'overlay {oid}: no state render and no marker+item sprite')

    room_json = {
        'id': room, 'size': [base.shape[1], base.shape[0]], 'bg': 'bg.png', 'depth': 'depth.png',
        'depthRange': [round(meta['near'], 3), round(meta['far'], 3)],
        'walk': {'w': base.shape[1], 'h': base.shape[0], 'rows': rle_rows(walk_ok)},
        'points': points, 'zones': zones, 'markers': markers, 'overlays': overlays,
    }
    if probes:
        room_json['probes'] = probes
    with open(os.path.join(out, 'room.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(room_json, fh, indent=1)
        fh.write('\n')
    used = np.bincount(base.ravel(), minlength=16)
    print(f'{room}: bg {base.shape[1]}x{base.shape[0]}, walkable {int(walk_ok.sum())} px, '
          f'{len(points)} points, {len(zones)} zones, {len(overlays)} overlays, colours used {int((used > 0).sum())}/16')
    for line in report:
        print('  !', line)
    return report


if __name__ == '__main__':
    rooms = sys.argv[1:] or sorted(os.listdir(os.path.join(ROOT, 'build', 'rooms')))
    for r in rooms:
        compose(r)
