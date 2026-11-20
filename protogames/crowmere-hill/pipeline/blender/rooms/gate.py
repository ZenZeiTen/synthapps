"""Crowmere Gate (exterior, night): the house, porch, doormat, gravestones, dead
tree and mailbox. Leaving is blocked; the front door leads to the hall."""
import math


def window(R, name, x, z0, z1, w, lit, y=9.98):
    R.span(name + '_frame', x - w / 2 - 0.12, x + w / 2 + 0.12, y - 0.06, y + 0.02, z0 - 0.12, z1 + 0.12, 'wood_dark', group=name)
    R.span(name + '_glass', x - w / 2, x + w / 2, y - 0.08, y - 0.06, z0, z1, 'window_lit' if lit else 'window_night',
           uv='fit', glow=lit, group=name + '_g')
    R.span(name + '_sill', x - w / 2 - 0.2, x + w / 2 + 0.2, y - 0.2, y + 0.02, z0 - 0.22, z0 - 0.12, 'wood_dark', group=name)


def build(R):
    R.sky = True
    R.erode = [3, 0]
    # ------------------------------------------------------------ ground
    R.span('ground', -7.9, 7.9, -7.0, 10.2, -0.2, 0.0, 'grass', walk=True, group='ground')
    for side, (a, b) in (('l', (-16.0, -7.9)), ('r', (7.9, 16.0))):
        R.span(f'ground_{side}', a, b, -7.0, 16.0, -0.2, 0.0, 'grass', group='ground')
    R.span('ground_back', -7.9, 7.9, 10.2, 16.0, -0.2, 0.0, 'grass', group='ground')
    R.span('path', -0.75, 0.75, -7.0, 7.06, 0.0, 0.015, 'dirt', walk=True, group='path')

    # ------------------------------------------------------------ the house
    R.span('facade', -6.5, 6.5, 10.0, 12.0, 0, 8.4, 'siding', group='house')
    R.span('trim', -6.6, 6.6, 9.9, 10.0, 8.25, 8.45, 'wood_dark', group='house')
    R.prism('roof', [(-7.3, 8.3), (7.3, 8.3), (0.0, 12.9)], 3.2, (0, 9.5, 0), 'shingles', group='roof')
    R.span('chimney', 3.4, 4.3, 10.4, 11.3, 8.0, 13.6, 'brick_dark', group='chimney')
    window(R, 'win_ul', -3.6, 5.5, 7.2, 1.3, True)
    window(R, 'win_ur', 3.6, 5.5, 7.2, 1.3, True)
    window(R, 'win_um', 0.0, 5.7, 7.0, 0.9, False)
    window(R, 'win_gl', -4.8, 1.3, 2.9, 1.1, False)
    window(R, 'win_gr', 4.8, 1.3, 2.9, 1.1, False)
    R.span('shutter', 1.95, 2.35, 9.86, 9.9, 5.4, 7.0, 'wood_dark', rot=(0, 12, 0), group='shutter')
    window(R, 'win_attic', 0.0, 9.3, 10.2, 0.7, False, y=9.48)

    # ------------------------------------------------------------ porch, steps, door, mat
    R.span('porch', -3.2, 3.2, 7.8, 10.0, 0, 0.6, 'porch_boards', walk=True, group='porch')
    R.span('step0', -1.2, 1.2, 7.05, 7.8, 0.0, 0.2, 'porch_boards', walk=True, group='steps')
    R.span('step1', -1.2, 1.2, 7.3, 7.8, 0.2, 0.4, 'porch_boards', walk=True, group='steps')
    R.span('step2', -1.2, 1.2, 7.55, 7.8, 0.4, 0.6, 'porch_boards', walk=True, group='steps')
    R.span('porch_roof', -3.5, 3.5, 7.6, 10.0, 3.2, 3.45, 'shingles', group='porch_roof')
    for i, x in enumerate((-3.05, 3.05, -1.35, 1.35)):
        R.span(f'post{i}', x - 0.1, x + 0.1, 7.82, 8.02, 0.6 if abs(x) > 2 else 0.6, 3.2, 'wood_dark', occlude=False, group='posts')
        R.blocker(f'post{i}_b', x - 0.25, x + 0.25, 7.8, 8.15, 0.6)
    for i, (x0, x1) in enumerate(((-3.05, -1.35), (1.35, 3.05))):
        R.span(f'rail{i}_top', x0, x1, 7.86, 7.98, 1.45, 1.55, 'wood_dark', occlude=False, group='rails')
        R.span(f'rail{i}_bot', x0, x1, 7.86, 7.98, 0.72, 0.78, 'wood_dark', occlude=False, group='rails')
        n = int((x1 - x0) / 0.28)
        for k in range(1, n):
            bx = x0 + k * (x1 - x0) / n
            R.span(f'bal{i}_{k}', bx - 0.03, bx + 0.03, 7.89, 7.95, 0.78, 1.45, 'wood_dark', occlude=False, group='rails')
        R.blocker(f'rail{i}_b', x0, x1, 7.8, 8.2, 0.6)
    R.span('door_frame', -0.8, 0.8, 9.9, 10.0, 0.6, 3.0, 'wood_dark', group='door_frame')
    R.span('doorway', -0.6, 0.6, 9.98, 10.05, 0.6, 2.85, 'c_black', group='doorway')
    R.span('door', -0.6, 0.6, 9.9, 9.97, 0.6, 2.85, 'wood_boards', pivot=(-0.6, 9.97, 0.6), group='door')
    R.span('knocker', -0.08, 0.08, 9.84, 9.9, 1.85, 2.05, 'c_yellow', group='door')
    R.span('mat', -0.55, 0.55, 9.05, 9.6, 0.6, 0.625, 'dirt', pivot=(0, 9.05, 0.6), group='mat')
    R.span('lamp', 1.02, 1.22, 9.72, 9.9, 2.45, 2.75, 'c_yellow', glow=True, group='lamp')
    R.marker('brass_key', 0.12, 9.32, 0.61)

    # ------------------------------------------------------------ gravestones, tree, mailbox
    for i, (x, y, tilt) in enumerate(((-4.7, 3.3, 9), (-3.4, 3.7, -7))):
        R.box(f'grave{i}', (0.72, 0.18, 1.05), (x, y, 0), 'stone_grave', rot=(0, tilt, 0), group=f'grave{i}')
        R.span(f'mound{i}', x - 0.42, x + 0.42, y - 1.35, y - 0.1, 0.0, 0.14, 'dirt', group='mounds')
    R.cyl('trunk', 0.32, 4.4, (5.7, 4.6, 0), 'wood_dark', segs=8, radius2=0.14, group='tree')
    for i, (z, rx, ry, ln) in enumerate(((2.3, 0, 48, 2.0), (3.0, 0, -52, 1.8), (3.6, 20, 30, 1.6), (4.0, -15, -25, 1.5), (1.6, 0, 70, 1.3))):
        R.box(f'branch{i}', (0.11, 0.11, ln), (5.7, 4.6, z), 'wood_dark', rot=(rx, ry, 0), group='tree')
    R.span('mail_post', 5.15, 5.3, -0.8, -0.65, 0, 1.0, 'wood_dark', group='mailbox')
    R.span('mail_box', 4.9, 5.55, -1.0, -0.45, 1.0, 1.42, 'iron', group='mailbox')
    R.span('mail_papers', 5.0, 5.45, -1.08, -1.0, 1.08, 1.32, 'c_white', group='mail_papers')

    # ------------------------------------------------------------ side fences (thin: blockers do the stopping)
    for side in (-1, 1):
        x = side * 7.95
        for k in range(-7, 11):
            R.span(f'fence{side}_{k}', x - 0.05, x + 0.05, k - 0.05, k + 0.05, 0, 1.5, 'iron', occlude=False, group='fence')
        for z in (0.35, 1.2):
            R.span(f'fence{side}_rail{z}', x - 0.03, x + 0.03, -7.0, 10.0, z, z + 0.06, 'iron', occlude=False, group='fence')
    R.cyl('moon', 1.4, 0.2, (-17.0, 34.0, 8.9), 'c_white', segs=24, rot=(90, 0, 0), glow=True, group='moon')

    # ------------------------------------------------------------ light
    R.light('SUN', (0, 0, 30), 1.1, color=(0.55, 0.65, 1.0), rot=(52, 0, 28))
    R.light('POINT', (1.12, 9.5, 2.55), 170, color=(1.0, 0.78, 0.42), size=0.1)
    R.light('POINT', (-3.6, 9.4, 6.3), 260, color=(1.0, 0.85, 0.5), size=0.3)
    R.light('POINT', (3.6, 9.4, 6.3), 260, color=(1.0, 0.85, 0.5), size=0.3)
    R.ambient = 0.035

    # ------------------------------------------------------------ gameplay markup
    R.point('spawn', 0.0, 0.8)
    R.point('doormat', 0.0, 8.7, 0.6)
    R.point('door', 0.0, 9.3, 0.6)
    R.point('graves', -3.9, 2.0)
    R.point('tree', 4.9, 3.6)
    R.point('mailbox', 4.5, -0.1)
    R.zone('front_door', [(-0.62, 9.64, 0.6), (0.62, 9.64, 0.6), (0.62, 9.98, 0.6), (-0.62, 9.98, 0.6)], (0.0, 9.8, 0.6))
    # the bottom three rows of the picture (y = -1.0 projects to row 164.9): walking off
    # the bottom edge is how a player tries to go home, so the exit must be on screen
    R.zone('leave', [(-7.9, -7.0), (7.9, -7.0), (7.9, -1.0), (-7.9, -1.0)], (0.0, -1.2))

    R.state('front_open', lambda S: setattr(S.get('door').rotation_euler, 'z', math.radians(78)))
    R.state('mat_lifted', lambda S: setattr(S.get('mat').rotation_euler, 'x', math.radians(-165)))

    R.camera((0.0, -15.0, 6.0), (0.0, 8.0, 2.8), lens=40)
