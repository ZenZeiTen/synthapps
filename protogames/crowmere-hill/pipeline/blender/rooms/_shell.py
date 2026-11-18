"""Shared room shell: floor, three walls, optional side doorways with a glimpse
of what lies beyond, wainscot. Every interior uses the same camera rig so Gus is
the same size everywhere (sprites never scale)."""

WALL_H = 7.5
CAMERA = ((0.0, -14.0, 6.2), (0.0, 3.0, 1.1), 40)


def shell(R, floor_tex, wall_tex, doors=(), beyond=None, wainscot='wainscot', floor_walk=True, back=6.0, floor=True, back_holes=()):
    """doors: iterable of 'l'/'r' -- a doorway (y 1.4..3.2) in that side wall.
    beyond: {'l': (floor_tex, wall_tex), 'r': ...} what shows through each doorway."""
    if floor:
        R.span('floor', -6.0, 6.0, -5.0, back + 0.3, -0.2, 0.0, floor_tex, walk=floor_walk, group='floor')
    # back wall, cut around any openings (x0, x1, z0, z1): pantry doors, real windows
    xs = -6.3
    for i, (hx0, hx1, hz0, hz1) in enumerate(sorted(back_holes)):
        R.span(f'bwall_{i}a', xs, hx0, back, back + 0.3, 0, WALL_H, wall_tex, group='walls', occlude=True)
        if hz0 > 0:
            R.span(f'bwall_{i}b', hx0, hx1, back, back + 0.3, 0, hz0, wall_tex, group='walls', occlude=True)
        R.span(f'bwall_{i}c', hx0, hx1, back, back + 0.3, hz1, WALL_H, wall_tex, group='walls', occlude=True)
        xs = hx1
    R.span('bwall', xs, 6.3, back, back + 0.3, 0, WALL_H, wall_tex, group='walls', occlude=True)
    if wainscot:
        xs = -6.0
        for i, (hx0, hx1, hz0, hz1) in enumerate(sorted(back_holes)):
            R.span(f'ws_back{i}', xs, hx0, back - 0.04, back, 0, 1.1, wainscot, group='walls', occlude=True)
            R.span(f'ws_back{i}_rail', xs, hx0, back - 0.08, back, 1.1, 1.18, 'wood_dark', group='walls', occlude=True)
            if hz0 >= 1.18:
                R.span(f'ws_back{i}_u', hx0, hx1, back - 0.04, back, 0, 1.1, wainscot, group='walls', occlude=True)
                R.span(f'ws_back{i}_urail', hx0, hx1, back - 0.08, back, 1.1, 1.18, 'wood_dark', group='walls', occlude=True)
            xs = hx1
        R.span('ws_back', xs, 6.0, back - 0.04, back, 0, 1.1, wainscot, group='walls', occlude=True)
        R.span('ws_back_rail', xs, 6.0, back - 0.08, back, 1.1, 1.18, 'wood_dark', group='walls', occlude=True)
    for side, sx in (('l', -1), ('r', 1)):
        xa, xb = sorted((sx * 6.0, sx * 6.3))
        wa, wb = sorted((sx * 5.96, sx * 6.0))
        if side in doors:
            R.span(f'swall_{side}_a', xa, xb, -5.0, 1.4, 0, WALL_H, wall_tex, group='walls', occlude=True)
            R.span(f'swall_{side}_b', xa, xb, 3.2, back + 0.3, 0, WALL_H, wall_tex, group='walls', occlude=True)
            R.span(f'swall_{side}_c', xa, xb, 1.4, 3.2, 2.7, WALL_H, wall_tex, group='walls', occlude=True)
            if wainscot:
                R.span(f'ws_{side}_a', wa, wb, -5.0, 1.28, 0, 1.1, wainscot, group='walls', occlude=True)
                R.span(f'ws_{side}_b', wa, wb, 3.32, back, 0, 1.1, wainscot, group='walls', occlude=True)
            fa, fb = sorted((sx * 5.9, sx * 6.3))
            R.span(f'jamb_{side}_1', fa, fb, 1.24, 1.4, 0, 2.85, 'wood_dark', group=f'frame_{side}', occlude=True)
            R.span(f'jamb_{side}_2', fa, fb, 3.2, 3.36, 0, 2.85, 'wood_dark', group=f'frame_{side}', occlude=True)
            R.span(f'head_{side}', fa, fb, 1.24, 3.36, 2.7, 2.9, 'wood_dark', group=f'frame_{side}', occlude=True)
            bf, bw = (beyond or {}).get(side, ('wood_floor', 'c_black'))
            ta, tb = sorted((sx * 6.0, sx * 7.6))
            R.span(f'thresh_{side}', ta, tb, 1.4, 3.2, -0.2, 0.0, bf, walk=True, group='floor')
            ba, bb = sorted((sx * 7.6, sx * 7.8))
            R.span(f'beyond_{side}', ba, bb, 0.8, 3.8, 0, 3.2, bw, group=f'beyond_{side}', occlude=True)
        else:
            R.span(f'swall_{side}', xa, xb, -5.0, back + 0.3, 0, WALL_H, wall_tex, group='walls', occlude=True)
            if wainscot:
                R.span(f'ws_{side}', wa, wb, -5.0, back, 0, 1.1, wainscot, group='walls', occlude=True)


def doorway_markup(R, side, zone='door', point='door', arrive='from_hall'):
    sx = -1 if side == 'l' else 1
    R.point(arrive, sx * 4.7, 2.3)
    R.point(point, sx * 4.9, 2.3)
    xs = sorted((sx * 5.4, sx * 7.4))
    R.zone(zone, [(xs[0], 1.5), (xs[1], 1.5), (xs[1], 3.1), (xs[0], 3.1)], (sx * 5.8, 2.3))


def camera(R):
    loc, target, lens = CAMERA
    R.camera(loc, target, lens=lens)
