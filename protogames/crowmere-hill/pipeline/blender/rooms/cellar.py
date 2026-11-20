"""Cellar (dark: the game shows only the candle's circle): stairs up to the
kitchen, wine racks, barrels, crates (Crumpet hides behind them), and a coal heap
under the padlocked coal-chute door -- the way out."""
import math
from rooms._shell import shell, camera

CHUTE = (2.4, 3.6, 1.5, 2.4)


def build(R):
    shell(R, 'stone_floor', 'stone_wall', wainscot=None, back_holes=[CHUTE])

    # ------------------------------------------------------------ stairs down from the kitchen (along the left wall)
    R.stairs('stairs', -5.7, -4.0, 2.7, steps=11, rise=0.3, run=0.32, tex='stone_floor', back=6.0, group='stairs')
    R.span('stair_wall', -4.0, -3.85, 2.7, 6.0, 0, 3.3, 'stone_wall', group='stair_wall')
    for k in range(4):
        R.span(f'stair_post{k}', -4.02, -3.94, 2.75 + k * 0.85, 2.83 + k * 0.85, 0.3 * (k * 2.6), 0.3 * (k * 2.6) + 1.0,
               'wood_dark', occlude=False, group='stair_rail')

    # ------------------------------------------------------------ the chute: door in the back wall above a coal heap
    cx0, cx1, cz0, cz1 = CHUTE
    R.span('chute_tunnel_l', cx0 - 0.05, cx0, 6.3, 8.0, cz0, cz1, 'stone_wall', group='chute_tunnel')
    R.span('chute_tunnel_r', cx1, cx1 + 0.05, 6.3, 8.0, cz0, cz1, 'stone_wall', group='chute_tunnel')
    R.span('chute_tunnel_f', cx0, cx1, 6.3, 8.0, cz0 - 0.05, cz0, 'coal', group='chute_tunnel')
    R.span('chute_outside', cx0, cx1, 8.0, 8.1, cz0, cz1, 'c_lcyan', glow=True, group='chute_outside')
    R.span('chute_door', cx0, cx1, 5.9, 5.98, cz0, cz1, 'iron', pivot=(cx0, 5.9, cz0), group='chute_door')
    R.span('padlock', cx1 - 0.3, cx1 - 0.14, 5.84, 5.9, cz0 + 0.3, cz0 + 0.5, 'c_yellow', pivot=(cx0, 5.9, cz0), group='chute_door')
    R.cyl('coal_heap', 1.7, 1.45, (3.0, 5.35, 0.0), 'coal', segs=14, radius2=0.25, group='coal')

    # ------------------------------------------------------------ racks and barrels on the right
    R.span('rack', 4.6, 5.95, 1.2, 4.6, 0, 2.6, 'bottles', group='rack')
    R.span('rack_top', 4.55, 5.95, 1.15, 4.65, 2.6, 2.7, 'wood_dark', group='rack')
    for i, (x, y) in enumerate(((4.4, -0.9), (4.35, 0.25))):
        R.cyl(f'barrel{i}', 0.46, 1.15, (x, y, 0), 'barrel', segs=12, group=f'barrel{i}')
    R.cyl('barrel_top', 0.46, 1.15, (4.38, -0.33, 1.15), 'barrel', segs=12, group='barrel_top')

    # ------------------------------------------------------------ crates (Crumpet hides behind these)
    R.span('crate0', -1.75, -0.95, 3.0, 3.8, 0, 0.8, 'crate', group='crates')
    R.span('crate1', -0.9, -0.1, 3.0, 3.8, 0, 0.8, 'crate', group='crates')
    R.span('crate2', -1.4, -0.6, 3.1, 3.8, 0.8, 1.55, 'crate', group='crates')
    R.marker('crumpet', -0.45, 3.95, 0.8)
    R.span('web', -6.0, -5.2, 5.99, 6.0, 3.2, 4.2, 'cobweb_grey', group='web')

    # ------------------------------------------------------------ light: even, the candle circle does the drama
    R.light('POINT', (0.0, 1.5, 3.4), 900, color=(1.0, 0.85, 0.6), size=1.5)
    R.light('POINT', (3.0, 5.6, 2.2), 120, color=(0.7, 0.85, 1.0), size=0.3)
    R.ambient = 0.12

    # ------------------------------------------------------------ gameplay markup
    R.point('from_kitchen', -4.85, 2.05)
    R.point('stairs', -4.85, 1.95)
    R.point('crates', -0.9, 2.4)
    R.point('chute', 3.0, 3.05)
    R.point('racks', 4.0, 2.9)
    R.zone('stairs', [(-5.6, 2.2), (-4.1, 2.2), (-4.1, 2.68), (-5.6, 2.68)], (-4.85, 2.45))
    R.zone('chute', [(2.0, 3.35), (4.0, 3.35), (4.0, 3.75), (2.0, 3.75)], (3.0, 3.55))

    R.state('chute_open', lambda S: [setattr(S.get(n).rotation_euler, 'z', math.radians(-110)) for n in ('chute_door', 'padlock')])
    camera(R)
