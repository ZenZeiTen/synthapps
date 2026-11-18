"""Tidebell's 48-colour palette. Every colour is one of the Genesis's 512 (3 bits per
channel, on the console's output ladder), as the source cartridge's are. Every sprite,
tile and backdrop uses only these colours; import_renders.py snaps Blender and reality.js
renders to them, and tests/verify_art.py rejects any exported pixel outside them."""
from __future__ import annotations

LADDER = [0, 52, 87, 116, 144, 172, 206, 255]   # Genesis colour levels 0..7

RAMPS: list[tuple[str, list[tuple[int, int, int]]]] = [
    ("ink", [(0, 0, 52)]),
    ("night", [(0, 52, 87), (52, 52, 116), (52, 87, 144), (87, 116, 172)]),
    ("stone", [(52, 52, 52), (87, 87, 87), (116, 116, 116), (172, 172, 172), (206, 206, 206)]),
    ("white", [(255, 255, 255)]),
    ("wood", [(87, 52, 0), (116, 87, 52), (144, 87, 52), (172, 116, 52), (206, 172, 87)]),
    ("skin", [(144, 87, 52), (206, 144, 116), (255, 206, 172)]),
    ("leaf", [(0, 52, 52), (0, 87, 52), (52, 116, 52), (87, 144, 52), (144, 206, 87)]),
    ("sea", [(0, 52, 87), (0, 87, 116), (52, 144, 172), (116, 206, 206)]),
    ("blue", [(0, 0, 116), (0, 52, 172), (52, 116, 206), (116, 172, 255)]),
    ("red", [(87, 0, 0), (144, 0, 0), (206, 52, 52), (255, 116, 87)]),
    ("gold", [(144, 116, 0), (206, 172, 0), (255, 255, 87)]),
    ("violet", [(52, 0, 87), (116, 52, 144), (172, 116, 206)]),
    ("silt", [(87, 87, 52), (144, 144, 87), (206, 206, 144)]),
    ("orange", [(206, 116, 0), (255, 172, 52)]),
    ("pink", [(255, 144, 172)]),
]

NAMES: list[str] = []
COLORS: list[tuple[int, int, int]] = []
for _name, _ramp in RAMPS:
    for _i, _c in enumerate(_ramp):
        NAMES.append(_name if len(_ramp) == 1 else f"{_name}{_i}")
        COLORS.append(_c)

N: dict[str, int] = {n: i for i, n in enumerate(NAMES)}
RGBA: list[tuple[int, int, int, int]] = [(r, g, b, 255) for (r, g, b) in COLORS]
assert len(COLORS) == 48, len(COLORS)
assert all(v in LADDER for c in COLORS for v in c)


def nearest(r: int, g: int, b: int) -> int:
    """Index of the closest palette colour (red-mean weighted RGB distance)."""
    best, bi = 1 << 30, 0
    for i, (R, G, B) in enumerate(COLORS):
        rm = (r + R) / 2
        d = (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2
        if d < best:
            best, bi = d, i
    return bi
