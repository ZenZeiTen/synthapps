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


UI = {"panel": lambda: [panel()], "slot": lambda: [slot()], "compass": lambda: [compass()], "cursor": lambda: [cursor()],
      "dead": lambda: [_dead()]}
for _k, _rows in ICON_ROWS.items():
    UI["icon_" + _k] = (lambda rows=_rows: [_icon(rows, ICON_PAL)])
