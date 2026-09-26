"""Entrance Hall: staircase up (bedroom), doorways west (library) and east
(kitchen), grandfather clock, portrait, suit of armor, chandelier."""
import math

WALL_H = 7.5


def build(R):
    # ---------------------------------------------------------------- shell
    R.span('floor', -6.0, 6.0, -5.0, 6.3, -0.2, 0.0, 'wood_floor', walk=True, group='floor')
    R.span('rug', -0.8, 0.8, -5.0, 4.3, 0.0, 0.02, 'rug_field', walk=True, group='rug')
    for i, (x0, x1, t) in enumerate(((-0.92, -0.86, 'c_brown'), (-0.86, -0.8, 'c_yellow'), (0.8, 0.86, 'c_yellow'), (0.86, 0.92, 'c_brown'))):
        R.span(f'rug_edge{i}', x0, x1, -5.0, 4.3, 0.0, 0.02, t, walk=True, group='rug')
    # back wall with the stair opening (x 1.4..3.6, up to z 3.4)
    R.span('bwall_a', -6.0, 1.4, 6.0, 6.3, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
    R.span('bwall_b', 3.6, 6.0, 6.0, 6.3, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
    R.span('bwall_c', 1.4, 3.6, 6.0, 6.3, 3.4, WALL_H, 'wallpaper_red', group='walls', occlude=True)
    for nm, x0, x1 in (('ws_a', -6.0, 1.4), ('ws_b', 3.6, 6.0)):
        R.span(nm, x0, x1, 5.96, 6.0, 0, 1.1, 'wainscot', group='walls', occlude=True)
        R.span(nm + '_rail', x0, x1, 5.92, 6.0, 1.1, 1.18, 'wood_dark', group='walls', occlude=True)
    # side walls with doorways (y 1.4..3.2), and a glimpse of the rooms beyond
    for side, sx in (('l', -1), ('r', 1)):
        xa, xb = sorted((sx * 6.0, sx * 6.3))
        R.span(f'swall_{side}_a', xa, xb, -5.0, 1.4, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
        R.span(f'swall_{side}_b', xa, xb, 3.2, 6.3, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
        R.span(f'swall_{side}_c', xa, xb, 1.4, 3.2, 2.7, WALL_H, 'wallpaper_red', group='walls', occlude=True)
        wa, wb = sorted((sx * 5.96, sx * 6.0))
        R.span(f'ws_{side}_a', wa, wb, -5.0, 1.28, 0, 1.1, 'wainscot', group='walls', occlude=True)
        R.span(f'ws_{side}_b', wa, wb, 3.32, 6.0, 0, 1.1, 'wainscot', group='walls', occlude=True)
        fa, fb = sorted((sx * 5.9, sx * 6.3))
        R.span(f'jamb_{side}_1', fa, fb, 1.24, 1.4, 0, 2.85, 'wood_dark', group=f'frame_{side}', occlude=True)
        R.span(f'jamb_{side}_2', fa, fb, 3.2, 3.36, 0, 2.85, 'wood_dark', group=f'frame_{side}', occlude=True)
        R.span(f'head_{side}', fa, fb, 1.24, 3.36, 2.7, 2.9, 'wood_dark', group=f'frame_{side}', occlude=True)
        ta, tb = sorted((sx * 6.0, sx * 7.6))
        R.span(f'thresh_{side}', ta, tb, 1.4, 3.2, -0.2, 0.0, 'wood_floor' if side == 'l' else 'tiles', walk=True, group='floor')
        ba, bb = sorted((sx * 7.6, sx * 7.8))
        R.span(f'beyond_{side}', ba, bb, 0.8, 3.8, 0, 3.2, 'wallpaper_green' if side == 'l' else 'brick', group=f'beyond_{side}', occlude=True)

    # ---------------------------------------------------------------- staircase
    R.stairs('stairs', 1.45, 3.55, 4.9, steps=14, rise=0.245, run=0.3, tex='wood_dark',
             runner='c_red', runner_w=1.1, back=9.6, group='stairs')
    R.span('well_l', 1.2, 1.4, 6.3, 9.6, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
    R.span('well_r', 3.6, 3.8, 6.3, 9.6, 0, WALL_H, 'wallpaper_red', group='walls', occlude=True)
    R.span('well_back', 1.2, 3.8, 9.6, 9.8, 0, WALL_H, 'c_black', group='well')
    R.span('newel', 1.32, 1.58, 4.84, 5.1, 0, 1.3, 'wood_dark', group='banister')
    R.ball('newel_cap', 0.15, (1.45, 4.97, 1.3), 'wood_dark', group='banister')
    for i in range(4):
        z = 0.245 * (i + 1)
        R.span(f'bal_{i}', 1.46, 1.52, 5.12 + i * 0.3, 5.18 + i * 0.3, z, z + 0.95, 'wood_dark', group='banister')

    # ---------------------------------------------------------------- grandfather clock
    cx, cy = -2.9, 5.7
    R.span('clock_base', cx - 0.42, cx + 0.42, cy - 0.28, cy + 0.28, 0, 0.45, 'wood_dark', group='clock')
    R.span('clock_case', cx - 0.32, cx + 0.32, cy - 0.22, cy + 0.22, 0.45, 1.9, 'wood_dark', group='clock')
    R.span('clock_inside', cx - 0.24, cx + 0.24, cy - 0.231, cy - 0.221, 0.55, 1.8, 'c_black', group='clock_inside')
    R.cyl('pendulum', 0.09, 0.02, (cx, cy - 0.232, 0.85), 'c_yellow', segs=10, rot=(90, 0, 0), group='clock_inside')
    R.span('pend_rod', cx - 0.012, cx + 0.012, cy - 0.235, cy - 0.232, 0.94, 1.75, 'c_brown', group='clock_inside')
    R.span('clock_door', cx - 0.26, cx + 0.26, cy - 0.26, cy - 0.235, 0.52, 1.83, 'window_night', uv='fit',
           pivot=(cx - 0.26, cy - 0.26, 0.52), group='clock_door')
    R.span('clock_head', cx - 0.42, cx + 0.42, cy - 0.28, cy + 0.28, 1.9, 2.65, 'wood_dark', group='clock')
    R.span('clock_crown', cx - 0.48, cx + 0.48, cy - 0.31, cy + 0.31, 2.65, 2.8, 'wood_dark', group='clock')
    R.cyl('clock_face', 0.26, 0.03, (cx, cy - 0.28, 2.27), 'c_white', segs=14, rot=(90, 0, 0), group='clock_face')
    R.span('hand_m', cx - 0.21, cx, cy - 0.315, cy - 0.31, 2.26, 2.285, 'c_black', group='clock_face')
    R.span('hand_h', cx - 0.012, cx + 0.012, cy - 0.315, cy - 0.31, 2.27, 2.43, 'c_black', group='clock_face')
    R.marker('matches', cx, cy - 0.24, 0.6)

    # ---------------------------------------------------------------- portrait
    px, pz0, pz1 = -0.4, 1.75, 3.35
    R.span('portrait_frame', px - 0.68, px + 0.68, 5.9, 5.98, pz0 - 0.09, pz1 + 0.09, 'c_yellow', group='portrait')
    R.span('portrait_canvas', px - 0.58, px + 0.58, 5.86, 5.9, pz0, pz1, 'portrait', uv='fit', group='portrait_canvas')
    R.marker('portrait_eyes', px, 5.85, pz0 + (1 - 6.5 / 16) * (pz1 - pz0))

    # ---------------------------------------------------------------- suit of armor with its axe
    ax, ay = 4.5, 4.6
    R.span('armor_plinth', ax - 0.45, ax + 0.45, ay - 0.4, ay + 0.4, 0, 0.22, 'wood_dark', group='armor_plinth')
    for i, dx in enumerate((-0.13, 0.13)):
        R.cyl(f'armor_leg{i}', 0.1, 0.78, (ax + dx, ay, 0.22), 'armor', segs=8, group='armor')
    R.span('armor_skirt', ax - 0.3, ax + 0.3, ay - 0.18, ay + 0.18, 0.95, 1.12, 'armor', group='armor')
    R.span('armor_torso', ax - 0.26, ax + 0.26, ay - 0.16, ay + 0.16, 1.1, 1.7, 'armor', group='armor')
    R.span('armor_shoulders', ax - 0.38, ax + 0.38, ay - 0.17, ay + 0.17, 1.6, 1.74, 'armor', group='armor')
    for i, dx in enumerate((-0.36, 0.36)):
        R.cyl(f'armor_arm{i}', 0.075, 0.62, (ax + dx, ay, 1.05), 'armor', segs=8, group='armor')
    R.span('armor_neck', ax - 0.07, ax + 0.07, ay - 0.07, ay + 0.07, 1.74, 1.8, 'c_dgray', group='armor')
    R.span('armor_helm', ax - 0.17, ax + 0.17, ay - 0.18, ay + 0.16, 1.8, 2.18, 'armor', group='armor')
    R.span('armor_visor', ax - 0.14, ax + 0.14, ay - 0.2, ay - 0.18, 1.95, 2.0, 'c_black', group='armor')
    R.cyl('armor_plume', 0.06, 0.3, (ax, ay, 2.18), 'c_red', segs=6, radius2=0.01, group='armor')
    R.cyl('axe_shaft', 0.03, 2.3, (ax - 0.42, ay - 0.12, 0.22), 'c_brown', segs=6, group='axe')
    R.span('axe_blade', ax - 0.78, ax - 0.44, ay - 0.15, ay - 0.09, 1.9, 2.35, 'armor', group='axe')

    # ---------------------------------------------------------------- chandelier and sconces
    chx, chy = 0.0, 2.4
    R.cyl('chain', 0.02, 3.2, (chx, chy, 4.55), 'c_dgray', segs=6, group='chandelier')
    R.cyl('ch_hub', 0.13, 0.4, (chx, chy, 4.2), 'c_brown', segs=8, group='chandelier')
    R.cyl('ch_ring', 0.75, 0.08, (chx, chy, 4.45), 'c_brown', segs=16, group='chandelier')
    for i in range(6):
        a = math.radians(i * 60 + 30)
        x, y = chx + 0.68 * math.cos(a), chy + 0.68 * math.sin(a)
        R.cyl(f'ch_c{i}', 0.04, 0.16, (x, y, 4.53), 'c_white', segs=6, group='chandelier')
        R.box(f'ch_f{i}', (0.05, 0.05, 0.08), (x, y, 4.69), 'c_yellow', glow=True, group='flames')
    for i, sx in enumerate((-5.1, 5.2)):
        R.span(f'sconce{i}', sx - 0.08, sx + 0.08, 5.85, 5.96, 1.95, 2.05, 'c_brown', group=f'sconce{i}')
        R.cyl(f'sconce{i}_c', 0.04, 0.16, (sx, 5.88, 2.05), 'c_white', segs=6, group=f'sconce{i}')
        R.box(f'sconce{i}_f', (0.05, 0.05, 0.08), (sx, 5.88, 2.21), 'c_yellow', glow=True, group='flames')

    # ---------------------------------------------------------------- lights (EEVEE pass only)
    R.light('POINT', (chx, chy, 4.0), 1150, color=(1.0, 0.8, 0.52), size=0.5)
    R.shade = {'hi': 0.965}
    R.light('POINT', (-5.1, 5.6, 2.3), 140, color=(1.0, 0.78, 0.5), size=0.1)
    R.light('POINT', (5.2, 5.6, 2.3), 140, color=(1.0, 0.78, 0.5), size=0.1)
    R.ambient = 0.02

    # ---------------------------------------------------------------- gameplay markup
    R.point('from_gate', 0.0, -2.6)
    R.point('front', 0.0, -2.8)
    R.point('from_library', -4.7, 2.3)
    R.point('west_door', -4.9, 2.3)
    R.point('from_kitchen', 4.7, 2.3)
    R.point('east_door', 4.9, 2.3)
    R.point('clock', cx, 4.95)
    R.point('portrait', px, 5.1)
    R.point('armor', 3.8, 3.8)
    R.point('stairs', 2.5, 4.3)
    R.point('from_bedroom', 2.5, 4.15)
    R.zone('door_west', [(-7.4, 1.5), (-5.4, 1.5), (-5.4, 3.1), (-7.4, 3.1)], (-5.8, 2.3))
    R.zone('door_east', [(5.4, 1.5), (7.4, 1.5), (7.4, 3.1), (5.4, 3.1)], (5.8, 2.3))
    R.zone('stairs', [(1.6, 4.55), (3.4, 4.55), (3.4, 4.95), (1.6, 4.95)], (2.5, 4.72))
    R.zone('front', [(-3.0, -5.0), (3.0, -5.0), (3.0, -3.4), (-3.0, -3.4)], (0.0, -3.7))

    def clock_open(S):
        S.get('clock_door').rotation_euler.z = math.radians(-105)
    R.state('clock_open', clock_open)

    R.camera((0.0, -14.0, 6.2), (0.0, 3.0, 1.1), lens=40)
