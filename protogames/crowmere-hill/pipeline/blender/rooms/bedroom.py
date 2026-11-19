"""Master bedroom: four-poster bed (something breathes underneath), wardrobe,
rocking chair, and a real window onto the ledge where the crow guards the iron
key. Doorway west to the stairs."""
import math
from rooms._shell import shell, doorway_markup, camera

WIN = (0.4, 2.4, 1.0, 3.2)


def build(R):
    R.sky = True                      # the night sky shows through the window
    shell(R, 'wood_floor', 'wallpaper_blue', doors=('l',), beyond={'l': ('wood_floor', 'c_black')}, back_holes=[WIN])
    R.span('rug', -3.2, 2.0, -0.6, 3.6, 0.0, 0.02, 'rug_field', walk=True, group='rug')

    # ------------------------------------------------------------ the window, its sash, the ledge outside
    wx0, wx1, wz0, wz1 = WIN
    for n, (a, b, c, d) in {'wf_l': (wx0 - 0.14, wx0, wz0 - 0.14, wz1 + 0.14), 'wf_r': (wx1, wx1 + 0.14, wz0 - 0.14, wz1 + 0.14),
                            'wf_t': (wx0, wx1, wz1, wz1 + 0.14), 'wf_b': (wx0 - 0.25, wx1 + 0.25, wz0 - 0.14, wz0)}.items():
        R.span(n, a, b, 5.9, 6.05, c, d, 'wood_dark', group='window_frame')
    zm = (wz0 + wz1) / 2
    for n, (a, b, c, d) in {'sash_l': (wx0, wx0 + 0.07, wz0, zm), 'sash_r': (wx1 - 0.07, wx1, wz0, zm),
                            'sash_t': (wx0, wx1, zm - 0.07, zm), 'sash_b': (wx0, wx1, wz0, wz0 + 0.07),
                            'sash_m': ((wx0 + wx1) / 2 - 0.03, (wx0 + wx1) / 2 + 0.03, wz0, zm)}.items():
        R.span(n, a, b, 6.08, 6.14, c, d, 'wood_dark', pivot=(wx0, 6.1, wz0), group='sash')
    R.span('upper_mullion', (wx0 + wx1) / 2 - 0.03, (wx0 + wx1) / 2 + 0.03, 6.16, 6.2, zm, wz1, 'wood_dark', group='window_frame')
    R.span('upper_bar', wx0, wx1, 6.16, 6.2, zm + (wz1 - zm) / 2 - 0.03, zm + (wz1 - zm) / 2 + 0.03, 'wood_dark', group='window_frame')
    R.span('ledge', wx0 - 0.3, wx1 + 0.3, 6.3, 6.95, 0.72, 0.9, 'stone_wall', group='ledge')
    R.cyl('nest', 0.34, 0.14, (1.62, 6.62, 0.9), 'dirt', segs=10, radius2=0.42, group='nest')
    R.marker('crow', 1.66, 6.62, 1.02)
    R.marker('iron_key', 1.5, 6.55, 1.02)
    for n, x in (('curtain_l', wx0 - 0.75), ('curtain_r', wx1 + 0.15)):
        R.span(n, x, x + 0.6, 5.8, 5.9, 0.7, 3.8, 'curtain', group='curtains')
    R.span('curtain_rod', wx0 - 0.9, wx1 + 0.9, 5.78, 5.85, 3.78, 3.86, 'c_brown', group='curtains')

    # ------------------------------------------------------------ four-poster bed
    bx0, bx1, by0, by1 = -3.8, -0.9, 3.4, 5.95
    R.span('bed_frame', bx0, bx1, by0, by1, 0.25, 0.5, 'wood_dark', group='bed')
    R.span('mattress', bx0 + 0.05, bx1 - 0.05, by0 + 0.05, by1 - 0.05, 0.5, 0.85, 'bedspread', group='bed')
    R.span('pillow', bx0 + 0.25, bx1 - 0.25, by1 - 0.6, by1 - 0.15, 0.85, 1.0, 'c_white', group='pillow')
    R.span('headboard', bx0, bx1, by1 - 0.1, by1, 0.25, 1.8, 'wood_dark', group='bed')
    for i, (x, y) in enumerate(((bx0, by0), (bx1 - 0.1, by0), (bx0, by1 - 0.1), (bx1 - 0.1, by1 - 0.1))):
        R.span(f'post{i}', x, x + 0.1, y, y + 0.1, 0, 2.7, 'wood_dark', group='bed')
    R.span('canopy', bx0 - 0.05, bx1 + 0.05, by0 - 0.05, by1 + 0.05, 2.7, 2.82, 'curtain', group='canopy')
    R.span('valance', bx0 - 0.05, bx1 + 0.05, by0 - 0.07, by0 - 0.03, 2.35, 2.82, 'curtain', group='canopy')
    R.span('under_bed', bx0 + 0.1, bx1 - 0.1, by0 + 0.1, by1 - 0.3, 0, 0.25, 'c_black', group='under_bed')
    for i, x in enumerate((-2.55, -2.3)):
        R.span(f'eye{i}', x, x + 0.08, by0 + 0.08, by0 + 0.1, 0.1, 0.16, 'c_yellow', glow=True, group='eyes')
    R.span('nightstand', -4.7, -4.0, 5.2, 5.85, 0, 0.7, 'wood_dark', group='nightstand')
    R.cyl('ns_candle', 0.04, 0.18, (-4.35, 5.5, 0.7), 'c_white', segs=6, group='nightstand')
    R.box('ns_flame', (0.05, 0.05, 0.08), (-4.35, 5.5, 0.88), 'c_yellow', glow=True, group='flames')
    R.marker('collar', -1.4, 2.7, 0.03)

    # ------------------------------------------------------------ wardrobe
    ox0, ox1 = 3.0, 4.7
    R.span('wardrobe', ox0, ox1, 5.1, 6.0, 0, 3.0, 'wood_dark', group='wardrobe')
    R.span('wardrobe_top', ox0 - 0.08, ox1 + 0.08, 5.02, 6.0, 3.0, 3.18, 'wood_dark', group='wardrobe')
    R.span('wardrobe_inside', ox0 + 0.08, ox1 - 0.08, 5.1, 5.12, 0.15, 2.85, 'c_black', group='wardrobe_inside')
    mid = (ox0 + ox1) / 2
    R.span('ward_door_l', ox0 + 0.05, mid, 5.04, 5.1, 0.15, 2.85, 'wood_boards', group='ward_door_l')
    R.span('ward_door_r', mid, ox1 - 0.05, 5.04, 5.1, 0.15, 2.85, 'wood_boards', pivot=(ox1 - 0.05, 5.04, 0.15), group='ward_door_r')
    R.span('ward_knob', mid + 0.06, mid + 0.12, 4.99, 5.04, 1.4, 1.5, 'c_yellow', pivot=(ox1 - 0.05, 5.04, 0.15), group='ward_door_r')

    # ------------------------------------------------------------ rocking chair
    cx, cy = 3.7, 1.3
    R.span('rock_seat', cx - 0.35, cx + 0.35, cy - 0.3, cy + 0.3, 0.45, 0.52, 'wood_dark', group='rocker')
    R.span('rock_back', cx - 0.33, cx + 0.33, cy + 0.26, cy + 0.33, 0.52, 1.5, 'wood_dark', rot=(-8, 0, 0), group='rocker')
    for s in (-1, 1):
        R.span(f'rock_leg{s}a', cx + s * 0.3 - 0.03, cx + s * 0.3 + 0.03, cy - 0.25, cy - 0.19, 0.08, 0.45, 'wood_dark', group='rocker')
        R.span(f'rock_leg{s}b', cx + s * 0.3 - 0.03, cx + s * 0.3 + 0.03, cy + 0.19, cy + 0.25, 0.08, 0.45, 'wood_dark', group='rocker')
        R.span(f'rocker{s}', cx + s * 0.3 - 0.03, cx + s * 0.3 + 0.03, cy - 0.5, cy + 0.5, 0.02, 0.08, 'wood_dark', group='rocker')

    # ------------------------------------------------------------ light
    R.light('AREA', (1.4, 7.6, 3.6), 520, color=(0.5, 0.6, 1.0), size=2.4, rot=(-62, 0, 0))
    R.light('POINT', (-4.35, 5.3, 1.1), 190, color=(1.0, 0.78, 0.45), size=0.1)
    R.light('POINT', (0.5, 1.5, 5.2), 380, color=(0.75, 0.75, 0.95), size=1.0)
    R.light('POINT', (3.4, 3.2, 3.2), 420, color=(0.6, 0.7, 1.0), size=1.2)      # moonlight pooling by the wardrobe
    R.span('sconce', 5.9, 5.96, 2.9, 3.1, 1.9, 2.05, 'c_brown', group='sconce')
    R.box('sconce_flame', (0.05, 0.05, 0.08), (5.88, 3.0, 2.2), 'c_yellow', glow=True, group='flames')
    R.light('POINT', (5.6, 3.0, 2.3), 160, color=(1.0, 0.78, 0.45), size=0.1)
    R.ambient = 0.025

    # ------------------------------------------------------------ gameplay markup
    doorway_markup(R, 'l', zone='stairs', point='stairs', arrive='from_hall')
    R.point('bed', -2.35, 2.95)
    R.point('collar', -1.4, 2.35)
    R.point('window', 1.4, 5.0)
    R.point('wardrobe', 3.85, 4.4)
    R.point('chair', 3.1, 0.6)

    def window_open(S):
        for n in ('sash_l', 'sash_r', 'sash_t', 'sash_b', 'sash_m'):
            S.get(n).location.z += 1.0
    R.state('window_open', window_open)
    R.state('wardrobe_open', lambda S: [setattr(S.get(n).rotation_euler, 'z', math.radians(-105)) for n in ('ward_door_r', 'ward_knob')])
    camera(R)
