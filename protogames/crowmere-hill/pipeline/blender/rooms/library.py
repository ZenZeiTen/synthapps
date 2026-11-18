"""Library: bookshelves, a writing desk under the window (drawer holds the dog
whistle), a skeleton reading in an armchair, a cold fireplace. Doorway east."""
from rooms._shell import shell, doorway_markup, camera


def build(R):
    shell(R, 'wood_floor', 'wallpaper_green', doors=('r',), beyond={'r': ('wood_floor', 'wallpaper_red')})
    R.span('rug', -3.8, 1.4, -1.6, 3.8, 0.0, 0.02, 'rug_field', walk=True, group='rug')

    # ------------------------------------------------------------ bookcase along the back wall
    x0, x1, top = -1.7, 5.7, 4.3
    R.span('shelf_books', x0 + 0.12, x1 - 0.12, 5.55, 5.98, 0.12, top - 0.12, 'books', group='bookcase')
    R.span('shelf_side_l', x0, x0 + 0.12, 5.45, 6.0, 0, top, 'wood_dark', group='bookcase')
    R.span('shelf_side_r', x1 - 0.12, x1, 5.45, 6.0, 0, top, 'wood_dark', group='bookcase')
    R.span('shelf_mid', 1.94, 2.06, 5.45, 6.0, 0, top, 'wood_dark', group='bookcase')
    R.span('shelf_top', x0 - 0.05, x1 + 0.05, 5.4, 6.0, top, top + 0.15, 'wood_dark', group='bookcase')
    R.span('shelf_base', x0, x1, 5.45, 6.0, 0, 0.12, 'wood_dark', group='bookcase')
    R.span('ladder_l', 3.3, 3.36, 4.75, 4.82, 0, 3.9, 'wood_dark', rot=(-9, 0, 0), group='ladder')
    R.span('ladder_r', 3.86, 3.92, 4.75, 4.82, 0, 3.9, 'wood_dark', rot=(-9, 0, 0), group='ladder')
    for k in range(1, 8):
        R.span(f'rung{k}', 3.3, 3.92, 4.8 + 0.07 * k, 4.86 + 0.07 * k, k * 0.48, k * 0.48 + 0.05, 'wood_dark', group='ladder')

    # ------------------------------------------------------------ window with the desk beneath
    wx0, wx1 = -5.0, -2.6
    R.span('win_frame', wx0 - 0.12, wx1 + 0.12, 5.92, 6.0, 1.28, 3.52, 'wood_dark', group='window')
    R.span('win_glass', wx0, wx1, 5.9, 5.92, 1.4, 3.4, 'window_night', uv='fit', group='window_glass')
    R.span('win_sill', wx0 - 0.2, wx1 + 0.2, 5.75, 6.0, 1.22, 1.3, 'wood_dark', group='window')
    R.span('curtain_l', wx0 - 0.55, wx0 - 0.05, 5.8, 5.9, 1.0, 3.8, 'curtain', group='curtains')
    R.span('curtain_r', wx1 + 0.05, wx1 + 0.55, 5.8, 5.9, 1.0, 3.8, 'curtain', group='curtains')
    dx0, dx1 = -4.7, -2.9
    R.span('desk_top', dx0 - 0.08, dx1 + 0.08, 4.95, 5.85, 0.78, 0.84, 'wood_dark', group='desk')
    R.span('desk_leg_l', dx0, dx0 + 0.1, 5.0, 5.8, 0, 0.78, 'wood_dark', group='desk')
    R.span('desk_leg_r', dx1 - 0.1, dx1, 5.0, 5.8, 0, 0.78, 'wood_dark', group='desk')
    R.span('desk_back', dx0, dx1, 5.7, 5.8, 0.2, 0.78, 'wood_dark', group='desk')
    R.span('drawer', -4.25, -3.35, 5.0, 5.65, 0.56, 0.76, 'wood_boards', pivot=(-3.8, 5.0, 0.56), group='drawer')
    R.span('drawer_knob', -3.84, -3.76, 4.96, 5.0, 0.64, 0.68, 'c_yellow', pivot=(-3.8, 5.0, 0.56), group='drawer_knob')
    R.span('lamp_base', -4.5, -4.2, 5.3, 5.6, 0.84, 0.9, 'c_brown', group='lamp')
    R.cyl('lamp_glass', 0.1, 0.28, (-4.35, 5.45, 0.9), 'c_yellow', segs=8, glow=True, group='lamp_glow')
    R.cyl('globe', 0.26, 0.04, (-2.1, 5.2, 0.0), 'c_brown', segs=8, group='globe')
    R.cyl('globe_stem', 0.03, 0.8, (-2.1, 5.2, 0.04), 'c_brown', segs=6, group='globe')
    R.ball('globe_ball', 0.3, (-2.1, 5.2, 1.12), 'c_cyan', segs=10, group='globe_ball')
    R.marker('whistle', -3.8, 4.82, 0.74)

    # ------------------------------------------------------------ armchair and its reader
    ax, ay = -2.3, 2.9
    R.span('chair_seat', ax - 0.62, ax + 0.62, ay - 0.5, ay + 0.5, 0, 0.5, 'rug_field', group='armchair')
    R.span('chair_back', ax - 0.62, ax + 0.62, ay + 0.3, ay + 0.55, 0.5, 1.85, 'rug_field', group='armchair')
    R.span('chair_arm_l', ax - 0.74, ax - 0.56, ay - 0.5, ay + 0.5, 0, 0.82, 'rug_field', group='armchair')
    R.span('chair_arm_r', ax + 0.56, ax + 0.74, ay - 0.5, ay + 0.5, 0, 0.82, 'rug_field', group='armchair')
    R.span('skull', ax - 0.12, ax + 0.12, ay + 0.02, ay + 0.24, 1.18, 1.46, 'c_white', group='skeleton')
    R.span('eye_l', ax - 0.08, ax - 0.03, ay - 0.0, ay + 0.02, 1.3, 1.36, 'c_black', group='skeleton')
    R.span('eye_r', ax + 0.03, ax + 0.08, ay - 0.0, ay + 0.02, 1.3, 1.36, 'c_black', group='skeleton')
    R.span('jaw', ax - 0.08, ax + 0.08, ay + 0.02, ay + 0.2, 1.1, 1.18, 'c_lgray', group='skeleton')
    R.span('ribs', ax - 0.17, ax + 0.17, ay + 0.1, ay + 0.3, 0.72, 1.08, 'siding', group='skeleton')
    R.span('spine', ax - 0.03, ax + 0.03, ay + 0.28, ay + 0.33, 0.5, 1.1, 'c_lgray', group='skeleton')
    for s in (-1, 1):
        R.span(f'femur{s}', ax + s * 0.12 - 0.04, ax + s * 0.12 + 0.04, ay - 0.45, ay + 0.1, 0.5, 0.58, 'c_lgray', group='skeleton')
        R.span(f'shin{s}', ax + s * 0.12 - 0.035, ax + s * 0.12 + 0.035, ay - 0.5, ay - 0.42, 0.0, 0.52, 'c_lgray', group='skeleton')
        R.span(f'arm{s}', ax + s * 0.22 - 0.03, ax + s * 0.22 + 0.03, ay - 0.2, ay + 0.2, 0.86, 0.92, 'c_lgray', group='skeleton')
    R.span('book', ax - 0.2, ax + 0.2, ay - 0.26, ay - 0.2, 0.86, 1.14, 'c_red', group='book')
    R.span('book_pages', ax - 0.17, ax + 0.17, ay - 0.27, ay - 0.26, 0.88, 1.12, 'c_white', group='book')

    # ------------------------------------------------------------ fireplace in the left wall
    R.span('fp_surround', -6.0, -5.55, 1.6, 4.0, 0, 2.3, 'brick', group='fireplace')
    R.span('fp_mouth', -5.57, -5.54, 2.1, 3.5, 0, 1.35, 'c_black', group='fireplace_mouth')
    R.span('fp_ashes', -5.56, -5.3, 2.2, 3.4, 0, 0.1, 'coal', group='fireplace_mouth')
    R.span('fp_mantel', -6.0, -5.35, 1.45, 4.15, 2.3, 2.45, 'wood_dark', group='fireplace')
    R.span('fp_hearth', -5.6, -4.9, 1.5, 4.1, 0.0, 0.05, 'stone_floor', walk=True, group='hearth')
    for i, y in enumerate((1.9, 3.7)):
        R.cyl(f'mantel_candle{i}', 0.04, 0.2, (-5.62, y, 2.45), 'c_white', segs=6, group='mantel')
        R.box(f'mantel_flame{i}', (0.05, 0.05, 0.08), (-5.62, y, 2.65), 'c_yellow', glow=True, group='flames')

    # ------------------------------------------------------------ light
    R.light('POINT', (-4.35, 5.3, 1.4), 260, color=(1.0, 0.8, 0.45), size=0.2)
    R.light('POINT', (-5.5, 2.8, 2.9), 180, color=(1.0, 0.78, 0.45), size=0.2)
    R.light('AREA', (-3.8, 6.6, 3.0), 260, color=(0.5, 0.6, 1.0), size=2.0, rot=(-70, 0, 0))
    R.light('POINT', (1.5, 2.0, 5.0), 500, color=(0.9, 0.8, 0.65), size=1.0)
    R.cyl('floorlamp_pole', 0.03, 1.7, (-1.25, 3.4, 0), 'c_brown', segs=6, group='floorlamp')
    R.cyl('floorlamp_shade', 0.28, 0.32, (-1.25, 3.4, 1.62), 'c_yellow', segs=10, radius2=0.14, glow=True, group='floorlamp_glow')
    R.light('POINT', (-1.25, 3.1, 1.7), 330, color=(1.0, 0.82, 0.5), size=0.2)   # reading light for the reader
    R.ambient = 0.025

    # ------------------------------------------------------------ gameplay markup
    doorway_markup(R, 'r', zone='door_east')
    R.point('shelves', 1.9, 4.8)
    R.point('skeleton', ax, 1.7)
    R.point('desk', -3.8, 4.35)
    R.point('fireplace', -4.4, 2.8)

    def drawer_open(S):
        for n in ('drawer', 'drawer_knob'):
            S.get(n).location.y -= 0.38
    R.state('drawer_open', drawer_open)
    camera(R)
