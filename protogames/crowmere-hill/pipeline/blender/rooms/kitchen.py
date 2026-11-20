"""Kitchen: iron stove with a bubbling cauldron, pantry (dog biscuits), chopping
table (the candle), and a trapdoor over the cellar steps. Doorway west."""
import math
from rooms._shell import shell, doorway_markup, camera

HOLE = (-3.6, -2.4, -0.6, 0.6)      # the trapdoor opening, x0 x1 y0 y1


def build(R):
    shell(R, 'tiles', 'brick', doors=('l',), beyond={'l': ('wood_floor', 'wallpaper_red')}, wainscot=None, floor=False,
          back_holes=[(3.3, 4.4, 0.0, 2.5)])
    hx0, hx1, hy0, hy1 = HOLE
    for name, (a, b, c, d) in {'floor_w': (-6.0, hx0, -5.0, 6.3), 'floor_e': (hx1, 6.0, -5.0, 6.3),
                               'floor_s': (hx0, hx1, -5.0, hy0), 'floor_n': (hx0, hx1, hy1, 6.3)}.items():
        R.span(name, a, b, c, d, -0.2, 0.0, 'tiles', walk=True, group='floor')
    # the pit under the trapdoor: black, with the top of the cellar steps
    R.span('pit', hx0, hx1, hy0, hy1, -2.2, -1.9, 'c_black', group='pit')
    for w in (('pit_w', hx0 - 0.05, hx0, hy0, hy1), ('pit_e', hx1, hx1 + 0.05, hy0, hy1),
              ('pit_s', hx0, hx1, hy0 - 0.05, hy0), ('pit_n', hx0, hx1, hy1, hy1 + 0.05)):
        R.span(w[0], w[1], w[2], w[3], w[4], -2.2, 0.0, 'stone_wall', group='pit')
    for k in range(3):
        R.span(f'pit_step{k}', hx0, hx1, hy1 - 0.3 * (k + 1), hy1, -0.35 * (k + 1), -0.35 * k, 'stone_floor', group='pit')
    R.span('trap_lid', hx0, hx1, hy0, hy1, 0.0, 0.04, 'wood_boards', pivot=(hx0, hy1, 0.02), walk=True, group='trapdoor')
    R.span('trap_ring', -3.08, -2.92, -0.35, -0.25, 0.04, 0.06, 'c_dgray', pivot=(hx0, hy1, 0.02), walk=True, group='trapdoor')

    # ------------------------------------------------------------ stove, cauldron, pots
    sx0, sx1 = -3.3, -1.3
    R.span('stove', sx0, sx1, 5.15, 6.0, 0, 1.0, 'iron', group='stove')
    R.span('stove_top', sx0 - 0.05, sx1 + 0.05, 5.1, 6.0, 1.0, 1.06, 'c_dgray', group='stove')
    R.span('stove_door', sx0 + 0.25, sx0 + 0.95, 5.12, 5.15, 0.2, 0.75, 'c_dgray', group='stove_door')
    R.span('stove_fire', sx1 - 0.75, sx1 - 0.25, 5.12, 5.14, 0.25, 0.35, 'c_red', glow=True, group='stove_fire')
    R.cyl('stovepipe', 0.14, 6.5, (-1.7, 5.8, 1.06), 'iron', segs=8, group='stovepipe')
    R.cyl('cauldron', 0.46, 0.55, (-2.45, 5.55, 1.06), 'iron', segs=12, radius2=0.52, group='cauldron')
    R.cyl('stew', 0.47, 0.02, (-2.45, 5.55, 1.55), 'c_green', segs=12, group='stew')
    R.marker('bubbles', -2.45, 5.35, 1.58)
    R.span('pot_rack', -3.6, -1.0, 5.3, 5.36, 2.9, 2.96, 'c_dgray', group='pots')
    for i, (x, r, t) in enumerate(((-3.2, 0.14, 'c_brown'), (-2.6, 0.18, 'c_red'), (-1.95, 0.12, 'c_brown'), (-1.4, 0.16, 'c_red'))):
        R.span(f'pot_hook{i}', x - 0.01, x + 0.01, 5.32, 5.34, 2.55, 2.9, 'c_dgray', group='pots')
        R.cyl(f'pot{i}', r, 0.22, (x, 5.33, 2.33), t, segs=8, group='pots')

    # ------------------------------------------------------------ back wall: window, shelf with jars
    R.span('win_frame', -0.2, 1.8, 5.92, 6.0, 1.3, 3.0, 'wood_dark', group='window')
    R.span('win_glass', -0.08, 1.68, 5.9, 5.92, 1.42, 2.88, 'window_night', uv='fit', group='window_glass')
    R.span('shelf', 2.0, 2.9, 5.65, 6.0, 1.6, 1.66, 'wood_dark', group='shelf')
    for i, (x, t) in enumerate(((2.15, 'c_green'), (2.4, 'c_brown'), (2.65, 'c_cyan'))):
        R.cyl(f'jar{i}', 0.09, 0.26, (x, 5.82, 1.66), t, segs=8, group='jars')

    # ------------------------------------------------------------ pantry in the back wall
    px0, px1 = 3.3, 4.4
    R.span('pantry_frame_l', px0 - 0.14, px0, 5.9, 6.05, 0, 2.6, 'wood_dark', group='pantry_frame')
    R.span('pantry_frame_r', px1, px1 + 0.14, 5.9, 6.05, 0, 2.6, 'wood_dark', group='pantry_frame')
    R.span('pantry_frame_t', px0 - 0.14, px1 + 0.14, 5.9, 6.05, 2.5, 2.64, 'wood_dark', group='pantry_frame')
    R.span('pantry_back', px0 - 0.2, px1 + 0.2, 7.0, 7.1, 0, 2.6, 'c_black', group='pantry_inside')
    R.span('pantry_side_l', px0 - 0.2, px0, 6.0, 7.0, 0, 2.6, 'wood_dark', group='pantry_inside')
    R.span('pantry_side_r', px1, px1 + 0.2, 6.0, 7.0, 0, 2.6, 'wood_dark', group='pantry_inside')
    for i, z in enumerate((0.6, 1.2, 1.8)):
        R.span(f'pantry_shelf{i}', px0, px1, 6.2, 7.0, z, z + 0.05, 'wood_dark', group='pantry_inside')
    R.cyl('pantry_jar', 0.1, 0.28, (px1 - 0.25, 6.6, 1.85), 'c_green', segs=8, group='pantry_inside')
    R.span('pantry_door', px0, px1, 5.94, 6.0, 0, 2.5, 'wood_boards', pivot=(px0, 5.94, 0), group='pantry_door')
    R.marker('biscuits', px0 + 0.4, 6.45, 1.25)

    # ------------------------------------------------------------ chopping table with the candle
    tx0, tx1, ty0, ty1 = -0.6, 1.4, 1.7, 2.8
    R.span('table_top', tx0, tx1, ty0, ty1, 0.88, 0.96, 'wood_boards', group='table')
    for i, (x, y) in enumerate(((tx0 + 0.1, ty0 + 0.1), (tx1 - 0.1, ty0 + 0.1), (tx0 + 0.1, ty1 - 0.1), (tx1 - 0.1, ty1 - 0.1))):
        R.span(f'table_leg{i}', x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, 0.88, 'wood_dark', group='table')
    R.span('cleaver', 0.7, 1.1, 2.3, 2.42, 0.96, 0.98, 'c_lgray', group='cleaver')
    R.marker('candle', 0.1, 2.15, 0.96)
    R.cyl('lantern', 0.12, 0.3, (0.4, 2.2, 3.2), 'c_yellow', segs=8, glow=True, group='lantern')
    R.cyl('lantern_chain', 0.01, 3.9, (0.4, 2.2, 3.5), 'c_dgray', segs=4, group='lantern_chain')

    # ------------------------------------------------------------ light
    R.light('POINT', (-2.05, 4.7, 0.5), 420, color=(1.0, 0.5, 0.22), size=0.3)
    R.light('POINT', (-2.45, 4.6, 2.3), 360, color=(0.7, 1.0, 0.6), size=0.4)   # the stew's sickly glow
    R.light('POINT', (0.4, 2.2, 2.9), 700, color=(1.0, 0.82, 0.5), size=0.3)
    R.light('POINT', (3.9, 4.2, 1.6), 70, color=(0.8, 0.8, 1.0), size=0.8)
    R.ambient = 0.03

    # ------------------------------------------------------------ gameplay markup
    doorway_markup(R, 'l', zone='door_west')
    R.point('stove', -2.3, 4.4)
    R.point('table', 0.3, 1.05)
    # the table stands free: Gus walks behind it (hidden by depth), never through it.
    # behind_table sits where the table top used to hide the floor -- an invisible wall
    # in the old walk mask; under_table is floor seen between the legs, once walkable.
    R.probe('behind_table', 0.4, 4.6, walkable=True)
    R.probe('just_behind_table', 0.4, 3.3, walkable=True)
    R.probe('under_table', 0.4, 2.25, walkable=False)
    R.point('pantry', 3.85, 4.9)
    R.point('trapdoor', -3.0, -1.25)
    R.point('from_cellar', -3.0, -1.35)
    R.zone('trapdoor', [(hx0 + 0.05, hy0 + 0.05), (hx1 - 0.05, hy0 + 0.05), (hx1 - 0.05, hy1 - 0.05), (hx0 + 0.05, hy1 - 0.05)], (-3.0, 0.0))

    R.state('pantry_open', lambda S: setattr(S.get('pantry_door').rotation_euler, 'z', math.radians(-100)))

    def trap_open(S):
        for n in ('trap_lid', 'trap_ring'):
            S.get(n).rotation_euler.x = math.radians(100)
    R.state('trapdoor_open', trap_open)
    camera(R)
