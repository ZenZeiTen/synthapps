"""UI pieces: a 9-slice panel, slot frame, compass dial, cursors and 16x16 button icons."""
from __future__ import annotations

from canvas import Canvas


def panel():
    """24x24 9-slice source (8 px borders): dark stone with a brass inner rim."""
    c = Canvas(24, 24, 2)
    c.frame(0, 0, 23, 23, 0)
    c.frame(1, 1, 22, 22, 4)
    c.frame(2, 2, 21, 21, 12)
    c.frame(3, 3, 20, 20, 9)
    for (x, y) in [(1, 1), (22, 1), (1, 22), (22, 22)]:
        c.set(x, y, 30)
    for x in range(4, 20):
        c.set(x, 4, 3)
    return c


def slot():
    c = Canvas(28, 28, 1)
    c.frame(0, 0, 27, 27, 0)
    c.line(1, 1, 26, 1, 0)
    c.line(1, 1, 1, 26, 0)
    c.line(1, 26, 26, 26, 4)
    c.line(26, 1, 26, 26, 4)
    return c


def compass():
    c = Canvas(40, 40, None)
    c.disc(19.5, 19.5, 19, 9)
    c.disc(19.5, 19.5, 18, 12)
    c.disc(19.5, 19.5, 16, 1)
    c.disc(19.5, 19.5, 15, 2)
    for i in range(12):
        import math
        a = i * math.pi / 6
        c.set(int(19.5 + math.cos(a) * 17), int(19.5 + math.sin(a) * 17), 30)
    # needle pointing up (the engine rotates the letter, not the art)
    for y in range(6, 20):
        w = (y - 6) // 5
        c.line(19 - w, y, 20 + w, y, 28)
    for y in range(20, 33):
        w = (33 - y) // 5
        c.line(19 - w, y, 20 + w, y, 5)
    c.disc(19.5, 19.5, 1.5, 30)
    return c


def cursor():
    rows = [
        "X.........",
        "XX........",
        "XWX.......",
        "XWWX......",
        "XWWWX.....",
        "XWWWWX....",
        "XWWWWWX...",
        "XWWWWWWX..",
        "XWWWWXXXX.",
        "XWXWWX....",
        "XX.XWWX...",
        "X...XWX...",
        ".....XX...",
    ]
    c = Canvas(10, 13)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "X":
                c.set(x, y, 0)
            elif ch == "W":
                c.set(x, y, 8)
    return c


def _icon(rows, pal):
    c = Canvas(16, 16)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch in pal:
                c.set(x, y, pal[ch])
    c.outline(0)
    return c


ICON_ROWS = {
    "bag": ["................", "......wwww......", ".....w....w.....", "....LLLLLLLL....", "...LBBBBBBBBL...",
            "..LBBBBBBBBBBL..", "..LBBBBGGBBBBL..", "..LBBBBGGBBBBL..", "..LBBBBBBBBBBL..", "..LBBBBBBBBBBL..",
            "..LBBBBBBBBBBL..", "...LBBBBBBBBL...", "....LLLLLLLL....", "................", "................", "................"],
    "map": ["................", "..PPPP.PPPP.PPP.", "..PpPP.PPpP.PPP.", "..PPPPPPPPPPPPP.", "..PPPrrPPPPPPPP.",
            "..PPPPrrPPPPPPP.", "..PPPPPPrPPPPPP.", "..PPPPPPPrrPPPP.", "..PPPPPPPPPxPPP.", "..PPPPPPPPPPPPP.",
            "..PPPPpPPPPPPPP.", "..PPP.PPPP.PPPP.", "................", "................", "................", "................"],
    "book": ["................", "..BBBBBBBBBBBB..", "..BPPPPPBPPPPB..", "..BPPPPPBPPPPB..", "..BPrrPPBPrrPB..",
             "..BPPPPPBPPPPB..", "..BPrrPPBPrrPB..", "..BPPPPPBPPPPB..", "..BPrrPPBPrrPB..", "..BPPPPPBPPPPB..",
             "..BBBBBBBBBBBB..", "................", "................", "................", "................", "................"],
    "rest": ["................", ".......YYYY.....", ".....YYYY.......", "....YYY.........", "....YYY.........",
             "...YYY..........", "...YYY..........", "...YYY......z...", "....YYY....zz...", "....YYYY...z....",
             ".....YYYYYY.....", ".......YYY......", "................", "................", "................", "................"],
    "cast": ["................", "......SSSS......", "....SSSSSSSS....", "...SSSRSSSSSS...", "...SSSRSSSSSS...",
             "..SSSSRRRRSSSS..", "..SSSSRSSSRSSS..", "..SSSSRSSSSSSS..", "..SSSSRRRRSSSS..", "...SSSSSSSRSS...",
             "...SSSSSSSRSS...", "....SSSSSSSS....", "......SSSS......", "................", "................", "................"],
    "menu": ["................", ".......gg.......", "...g..gggg..g...", "...gggggggggg...", "....gggHHggg....",
             "..gggggHHgggggg.", "..ggggHHHHgggg..", "..gggggHHggggg..", "....gggHHggg....", "...gggggggggg...",
             "...g..gggg..g...", ".......gg.......", "................", "................", "................", "................"],
    "attack": ["..............S.", ".............SS.", "............SS..", "...........SS...", "..........SS....",
               ".........SS.....", "........SS......", "...G...SS.......", "....G.SS........", ".....GS.........",
               "....WGG.........", "...W..G.........", "..W.............", ".W..............", "................", "................"],
    "guard": ["................", "..SSSSSSSSSSSS..", "..SRRRRRSSSSSS..", "..SRRRRRSSSSSS..", "..SRRRRRSSSSSS..",
              "..SRRRRRSSSSSS..", "..SSSSSYYSSSSS..", "..SSSSSYYRRRRS..", "...SSSSSSRRRS...", "....SSSSSRRS....",
              ".....SSSSRS.....", "......SSSS......", ".......SS.......", "................", "................", "................"],
    "flee": ["................", "......BB........", "......BB........", "......BB........", "......BB........",
             "......BBB.......", "......BBBBBB....", ".....BBBBBBBB...", ".....BBBBBBBB...", "................",
             "..w...w...w.....", ".w...w...w......", "................", "................", "................", "................"],
    "throw": ["................", "...........YY...", "..........YYYY..", "...........YY...", "................",
              "......K.........", ".....KKK.K......", ".....KKKKK......", "....KKKKKK......", "....KKKKK.......",
              ".....KKKK.......", "......KK........", "................", "................", "................", "................"],
}
ICON_PAL = {"w": 12, "L": 9, "B": 11, "G": 30, "P": 7, "p": 5, "r": 27, "x": 28, "Y": 30, "z": 25, "S": 5, "R": 28,
            "g": 5, "H": 2, "W": 12, "K": 16}


def _dead():
    """Overlay drawn across a dead character's portrait: a skull on grey."""
    rows = [
        "....SSSSSS....",
        "..SSSSSSSSSS..",
        ".SSSSSSSSSSSS.",
        ".SSSSSSSSSSSS.",
        "SSS...SS...SSS",
        "SSS...SS...SSS",
        "SSSS.SSSS.SSSS",
        ".SSSSS..SSSSS.",
        "..SSSSSSSSSS..",
        "...S.S.S.S.S..",
        "...SSSSSSSSS..",
    ]
    c = Canvas(40, 48)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "S":
                c.set(13 + x, 16 + y, 7)
    c.outline(0)
    return c


def disc():
    """The creation disc, 171x171, centre (85, 85), usable radius 75 (the original's
    PERLA_MAXPOLOMER). Eight wedges, one per archetype profile of CHARGEN.C, counted
    counter-clockwise from the east. Each wedge is tinted by its profile's strong
    stats (red STR, blue MAG, green DEX, gold MOB), dithered, fading to plain stone at
    the balanced centre."""
    import math
    from canvas import dither
    size, cx, cy, R = 171, 85, 85, 75
    tint = {"str": 27, "mag": 23, "dex": 19, "mob": 12}
    corners = [("str", "mob"), ("mob", "mob"), ("mag", "mob"), ("mag", "mag"),
               ("mag", "dex"), ("dex", "dex"), ("str", "dex"), ("str", "str")]
    c = Canvas(size, size)
    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, cy - y            # y up, as the original measures the angle
            d = math.hypot(dx, dy)
            if d > R + 9:
                continue
            if d > R + 1:                      # rim: carved stone band
                col = 5 if (dx + dy) < 0 else 3
                if R + 4 <= d <= R + 5:
                    col = 12
                c.set(x, y, col)
                continue
            ang = math.degrees(math.atan2(dy, dx)) % 360
            k = int(((ang + 22.5) % 360) // 45)
            pair = corners[k]
            base = 2
            t_ = min(1.0, d / R) * 0.85
            col = base
            if dither(x, y, t_):
                col = tint[pair[0]] if (x + y) % 2 == 0 or pair[0] == pair[1] else tint[pair[1]]
            c.set(x, y, col)
            # wedge borders and rings
            if abs(((ang + 22.5) % 45) - 0.0) < 0.9 and d > 8:
                c.set(x, y, 1)
            if abs(d - R * 0.5) < 0.5 or abs(d - R) < 0.6:
                c.set(x, y, 4)
    # notches on the rim at each archetype
    for i in range(8):
        a = math.radians(i * 45)
        for rr in range(R + 2, R + 8):
            c.set(int(round(cx + math.cos(a) * rr)), int(round(cy - math.sin(a) * rr)), 30)
    c.disc(cx, cy, 6, 3)
    c.disc(cx, cy, 4, 5)
    c.set(cx - 1, cy - 2, 7)
    return c


def pearl():
    c = Canvas(11, 11)
    c.disc(5, 5, 5, 6)
    c.disc(5, 5, 4, 7)
    c.disc(4, 4, 2.5, 8)
    c.set(3, 3, 31)
    c.outline(0)
    return c


ARROW_UP = [
    "................",
    "................",
    ".......AA.......",
    "......AAAA......",
    ".....AAAAAA.....",
    "....AAAAAAAA....",
    "...AAAAAAAAAA...",
    "......AAAA......",
    "......AAAA......",
    "......AAAA......",
    "......AAAA......",
    "......AAAA......",
    "......AAAA......",
    "................",
    "................",
    "................",
]
ARROW_TURN_LEFT = [
    "................",
    "................",
    "....A...........",
    "...AA...........",
    "..AAAAAAAAAA....",
    ".AAAAAAAAAAAA...",
    "..AAAAAAAAAAAA..",
    "...AA......AAA..",
    "....A.......AA..",
    "............AA..",
    "............AA..",
    "............AA..",
    "............AA..",
    "................",
    "................",
    "................",
]


def _arrow(rows, rot=0, flip=False):
    """rot: quarter turns clockwise; flip: mirror left-right."""
    grid = [list(r) for r in rows]
    for _ in range(rot % 4):
        grid = [list(r) for r in zip(*grid[::-1])]
    if flip:
        grid = [r[::-1] for r in grid]
    c = Canvas(16, 16)
    for y, r in enumerate(grid):
        for x, ch in enumerate(r):
            if ch == "A":
                c.set(x, y, 7)
    c.outline(0)
    return c


UI = {"panel": lambda: [panel()], "disc": lambda: [disc()], "pearl": lambda: [pearl()], "slot": lambda: [slot()], "compass": lambda: [compass()], "cursor": lambda: [cursor()],
      "dead": lambda: [_dead()]}
for _k, _rows in ICON_ROWS.items():
    UI["icon_" + _k] = (lambda rows=_rows: [_icon(rows, ICON_PAL)])
# the movement pad (the original's six-arrow pad) and the turn cursors
UI.update({
    "move_fwd": lambda: [_arrow(ARROW_UP)], "move_back": lambda: [_arrow(ARROW_UP, 2)],
    "move_left": lambda: [_arrow(ARROW_UP, 3)], "move_right": lambda: [_arrow(ARROW_UP, 1)],
    "turn_left": lambda: [_arrow(ARROW_TURN_LEFT)], "turn_right": lambda: [_arrow(ARROW_TURN_LEFT, 0, True)],
})
