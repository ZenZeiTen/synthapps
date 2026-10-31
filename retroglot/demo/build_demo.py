#!/usr/bin/env python3
"""Build HOSHI.COM, a tiny DOS demo with Japanese dialogue, for trying out translation.

"Hoshifuri" is original content written for retroglot. It runs in VGA mode 13h
(320x200, 256 colours), shows a night scene and five dialogue screens in
Japanese; any key moves to the next screen, Esc quits. The text is drawn with
GNU Unifont (SIL OFL 1.1), a 16-pixel bitmap font, so it looks like the
built-in fonts of real games of the era.

Needs Python 3 with Pillow, nasm, and unifont_jp.otf (fonts-unifont package):
    python3 demo/build_demo.py
"""

import os
import random
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_PATHS = [
    "/usr/share/fonts/opentype/unifont/unifont_jp.otf",
    "/usr/share/fonts/truetype/unifont/unifont_jp.ttf",
    os.path.join(HERE, "unifont_jp.otf"),
]

W, H = 320, 200
BOX_TOP = 124  # rows from here down are redrawn for each screen

# 16-colour palette, 8-bit RGB (stored as 6-bit for the VGA DAC).
PALETTE = [
    (5, 6, 18), (10, 14, 40), (16, 24, 64), (26, 38, 92),     # 0-3 sky bands
    (40, 56, 120), (255, 255, 255), (250, 226, 150), (255, 190, 90),  # 4 haze, 5 white, 6 moon, 7 lamp
    (14, 30, 28), (22, 46, 40), (60, 40, 36), (120, 70, 50),  # 8-9 hills, 10-11 house
    (20, 32, 110), (150, 170, 255), (250, 210, 120), (180, 190, 220),  # 12 box, 13 border, 14 name, 15 dim text
]

SCREENS = [
    ("村長", ["ようこそ、旅の人。", "ここは星降る村です。"]),
    ("村長", ["北の塔には、古い魔法の本が", "眠っていると言われています。"]),
    ("リナ", ["わかりました。", "明日の朝、塔へ向かいます！"]),
    ("村長", ["夜の森には影の獣が出ます。", "どうか気をつけて。"]),
    ("", ["塔へ行きますか？", "　▶はい　　いいえ"]),
]


def font():
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, 16)
    sys.exit("unifont_jp.otf not found; install the fonts-unifont package or put it in demo/")


def scene():
    img = Image.new("P", (W, H), 0)
    img.putpalette([c for rgb in PALETTE for c in rgb] + [0] * (768 - 48))
    d = ImageDraw.Draw(img)
    bands = [0, 0, 1, 1, 2, 2, 3, 3, 4]
    for y in range(H):
        d.line([(0, y), (W, y)], fill=bands[min(len(bands) - 1, y * len(bands) // 130)])
    rnd = random.Random(7)
    for _ in range(70):
        x, y = rnd.randrange(W), rnd.randrange(100)
        d.point((x, y), fill=rnd.choice([5, 5, 15, 6]))
    for _ in range(6):  # falling stars
        x, y = rnd.randrange(20, W - 40), rnd.randrange(5, 70)
        d.line([(x, y), (x + 10, y + 5)], fill=15)
        d.point((x + 11, y + 6), fill=5)
    d.ellipse([250, 14, 274, 38], fill=6)
    d.ellipse([258, 12, 280, 34], fill=0)
    d.polygon([(0, 120), (60, 92), (120, 112), (190, 86), (260, 108), (320, 96), (320, 200), (0, 200)], fill=8)
    d.polygon([(0, 140), (90, 118), (170, 132), (250, 116), (320, 128), (320, 200), (0, 200)], fill=9)
    d.rectangle([140, 100, 176, 124], fill=10)
    d.polygon([(134, 100), (158, 84), (182, 100)], fill=11)
    d.rectangle([150, 106, 158, 114], fill=7)
    d.rectangle([164, 110, 170, 124], fill=11)
    return img


def screen(base, f, speaker, lines):
    img = base.copy()
    d = ImageDraw.Draw(img)
    d.fontmode = "1"  # no anti-aliasing: crisp bitmap glyphs
    d.rectangle([6, 136, 313, 195], fill=12, outline=13, width=2)
    if speaker:
        tw = int(d.textlength(speaker, font=f))
        d.rectangle([10, 126, 18 + tw + 6, 144], fill=12, outline=13, width=2)
        d.text((16, 127), speaker, font=f, fill=14)
    for i, line in enumerate(lines):
        d.text((16, 150 + i * 20), line, font=f, fill=5)
    d.polygon([(298, 186), (306, 186), (302, 191)], fill=13)
    return img


def rle(data):
    out = bytearray()
    i = 0
    while i < len(data):
        v = data[i]
        n = 1
        while i + n < len(data) and data[i + n] == v and n < 255:
            n += 1
        out += bytes([n, v])
        i += n
    return bytes(out + b"\x00")


ASM = r"""
; HOSHI.COM - retroglot demo. Built by build_demo.py; do not edit by hand.
org 100h
start:
    mov ax, 0013h          ; 320x200x256
    int 10h
    mov dx, 3C8h           ; load the 16-colour palette
    xor al, al
    out dx, al
    inc dx
    mov si, palette
    mov cx, 48
.pal:
    lodsb
    out dx, al
    loop .pal
    mov ax, 0A000h
    mov es, ax
    cld
    mov si, background     ; whole screen once
    xor di, di
    call unrle
    xor bp, bp
show:
    mov bx, bp
    shl bx, 1
    mov si, [pages + bx]
    mov di, BOX_TOP * 320
    call unrle
.key:
    xor ah, ah
    int 16h
    cmp al, 27             ; Esc quits
    je quit
    inc bp
    cmp bp, PAGE_COUNT
    jb show
    xor bp, bp
    jmp show
quit:
    mov ax, 0003h
    int 10h
    mov dx, bye
    mov ah, 09h
    int 21h
    mov ax, 4C00h
    int 21h

unrle:                     ; ds:si = (count, colour) pairs ending in 0, es:di = screen
    lodsb
    or al, al
    jz .done
    mov cl, al
    xor ch, ch
    lodsb
    rep stosb
    jmp unrle
.done:
    ret

bye: db 'Hoshifuri demo for retroglot. Thanks for playing!', 13, 10, '$'
palette: incbin "build/palette.bin"
background: incbin "build/background.rle"
pages: dw {page_labels}
{page_data}
"""


def main():
    f = font()
    base = scene()
    build = os.path.join(HERE, "build")
    os.makedirs(build, exist_ok=True)
    with open(os.path.join(build, "palette.bin"), "wb") as fh:
        fh.write(bytes(v >> 2 for rgb in PALETTE for v in rgb))
    with open(os.path.join(build, "background.rle"), "wb") as fh:
        fh.write(rle(base.tobytes()))
    data = []
    for i, (speaker, lines) in enumerate(SCREENS):
        img = screen(base, f, speaker, lines)
        if i == 0:
            img.resize((W * 3, H * 3), Image.NEAREST).convert("RGB").save(os.path.join(HERE, "hoshifuri-preview.png"))
        part = img.tobytes()[BOX_TOP * W:]
        with open(os.path.join(build, f"page{i}.rle"), "wb") as fh:
            fh.write(rle(part))
        data.append(f'page{i}: incbin "build/page{i}.rle"')
    asm = ASM.replace("{page_labels}", ", ".join(f"page{i}" for i in range(len(SCREENS)))).replace("{page_data}", "\n".join(data))
    asm = f"BOX_TOP equ {BOX_TOP}\nPAGE_COUNT equ {len(SCREENS)}\n" + asm
    src = os.path.join(build, "hoshi.asm")
    with open(src, "w", encoding="utf-8") as fh:
        fh.write(asm)
    out = os.path.join(HERE, "HOSHI.COM")
    subprocess.run(["nasm", "-f", "bin", "-o", out, src], check=True, cwd=HERE)
    size = os.path.getsize(out)
    if size > 65000:
        sys.exit(f"HOSHI.COM is {size} bytes; a .COM program must stay under 64 KB")
    print(f"HOSHI.COM: {size} bytes, {len(SCREENS)} screens")


if __name__ == "__main__":
    main()
