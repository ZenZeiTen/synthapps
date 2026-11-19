"""The game's 48-colour palette: hue-shifted ramps (darks lean violet, lights lean warm).
Every sprite and tile uses only these colours; import_renders.py snaps Blender renders to it
and tests/verify_art.py rejects any exported pixel outside it."""
from __future__ import annotations

RAMPS: list[tuple[str, list[tuple[int, int, int]]]] = [
    ("ink", [(20, 16, 28)]),
    ("stone", [(46, 40, 58), (74, 68, 88), (110, 104, 122), (152, 148, 160), (200, 198, 204)]),
    ("white", [(240, 238, 230)]),
    ("wood", [(52, 34, 32), (86, 54, 42), (128, 82, 56), (170, 120, 74), (212, 168, 110)]),
    ("skin", [(120, 70, 60), (196, 130, 100), (236, 186, 148)]),
    ("moss", [(22, 48, 40), (34, 82, 52), (62, 122, 58), (114, 164, 70), (180, 208, 98)]),
    ("shard", [(18, 70, 86), (28, 122, 122), (64, 186, 160), (160, 240, 210)]),
    ("water", [(22, 30, 72), (34, 58, 120), (52, 98, 168), (88, 150, 210), (150, 206, 236)]),
    ("violet", [(46, 28, 78), (88, 48, 128), (140, 82, 176), (196, 140, 220)]),
    ("fire", [(60, 16, 28), (122, 26, 36), (186, 46, 40), (230, 96, 44), (248, 156, 60), (252, 214, 110)]),
    ("gold", [(122, 86, 22), (200, 150, 40), (248, 214, 90)]),
    ("berry", [(110, 30, 70), (186, 60, 110), (236, 130, 160)]),
    ("dawn", [(240, 200, 170), (214, 150, 150), (120, 90, 140)]),
]

NAMES: list[str] = []
COLORS: list[tuple[int, int, int]] = []
for _name, _ramp in RAMPS:
    for _i, _c in enumerate(_ramp):
        NAMES.append(_name if len(_ramp) == 1 else f"{_name}{_i}")
        COLORS.append(_c)

N: dict[str, int] = {n: i for i, n in enumerate(NAMES)}          # name -> index
RGBA: list[tuple[int, int, int, int]] = [(r, g, b, 255) for (r, g, b) in COLORS]
assert len(COLORS) == 48, len(COLORS)


def nearest(r: int, g: int, b: int) -> int:
    """Index of the closest palette colour (red-mean weighted RGB distance)."""
    best, bi = 1 << 30, 0
    for i, (R, G, B) in enumerate(COLORS):
        rm = (r + R) / 2
        d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
        if d < best:
            best, bi = d, i
    return bi
