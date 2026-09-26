#!/usr/bin/env python3
"""
palette_lut.py — turn a palette into an N x 1 PNG LUT for shader-side quantization.

Why a texture and not a uniform array: GLSL ES 1.00 restricts dynamic indexing of
uniform arrays in fragment shaders on some drivers, so a `palette[i]` lookup with a
computed index can fail to compile on mobile. A 1D texture always works.

Usage
    # a built-in palette
    python3 palette_lut.py --name pico8 -o pico8.png

    # your own hex list
    python3 palette_lut.py --hex "#0f380f,#306230,#8bac0f,#9bbc0f" -o gb.png

    # extract from an image (needs Pillow)
    python3 palette_lut.py --from-image art.png --colors 16 -o extracted.png

    # list what's built in
    python3 palette_lut.py --list

Then in three.js:
    const tex = new THREE.TextureLoader().load('pico8.png');
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    new RetroPipeline(renderer, { paletteTexture: tex, paletteSize: 16, ... });

Stdlib only unless --from-image is used.
"""

import argparse
import struct
import sys
import zlib

PALETTES = {
    "gb_dmg": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
    "gb_pocket": ["#181818", "#4a4a4a", "#949494", "#d8d8d8"],
    "cga_cyan": ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
    "cga_green": ["#000000", "#55ff55", "#ff5555", "#ffff55"],
    "pico8": [
        "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f",
        "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436",
        "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
    "c64": [
        "#000000", "#ffffff", "#880000", "#aaffee", "#cc44cc", "#00cc55",
        "#0000aa", "#eeee77", "#dd8855", "#664400", "#ff7777", "#333333",
        "#777777", "#aaff66", "#0088ff", "#bbbbbb",
    ],
    "y2k_chrome": ["#0a0f1a", "#1b2a4a", "#3d5a8a", "#7fa3c9", "#c8dced", "#ffffff", "#00e5ff"],
    "frutiger_aero": [
        "#0d6ba8", "#1a9bd7", "#4fc3e8", "#a8dff0", "#e8f7ff",
        "#ffffff", "#8fd14f", "#4caf50",
    ],
    "vaporwave": ["#1a0033", "#2d1b69", "#ff71ce", "#01cdfe", "#05ffa1", "#b967ff", "#fffb96"],
}


def websafe():
    """The historic 216-colour web-safe palette. Generated, not listed."""
    steps = [0x00, 0x33, 0x66, 0x99, 0xCC, 0xFF]
    return ["#%02x%02x%02x" % (r, g, b) for r in steps for g in steps for b in steps]


PALETTES["websafe"] = websafe()


def parse_hex(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        raise ValueError("bad hex colour: %r" % h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def write_png(path, rgb_rows):
    """Minimal RGBA PNG writer. rgb_rows: list of rows, each a list of (r,g,b)."""
    h = len(rgb_rows)
    w = len(rgb_rows[0])
    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)                       # filter type: none
        for (r, g, b) in row:
            raw += bytes((r, g, b, 255))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def extract_from_image(path, k):
    """Median-cut extraction. Requires Pillow; nothing else here does."""
    try:
        from PIL import Image
    except ImportError:
        sys.exit("--from-image needs Pillow:  pip install Pillow")
    img = Image.open(path).convert("RGB")
    # Pillow's own median cut, then read the palette back out.
    q = img.quantize(colors=k, method=Image.MEDIANCUT)
    pal = q.getpalette()[: k * 3]
    return [tuple(pal[i * 3:i * 3 + 3]) for i in range(k)]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", help="built-in palette name")
    ap.add_argument("--hex", help="comma-separated hex colours")
    ap.add_argument("--from-image", help="extract a palette from an image (needs Pillow)")
    ap.add_argument("--colors", type=int, default=16, help="palette size for --from-image")
    ap.add_argument("--list", action="store_true", help="list built-in palettes")
    ap.add_argument("-o", "--out", default="palette.png")
    a = ap.parse_args()

    if a.list:
        for k, v in PALETTES.items():
            print(f"{k:16s} {len(v):3d} colours")
        return

    if a.from_image:
        colors = extract_from_image(a.from_image, a.colors)
    elif a.hex:
        colors = [parse_hex(h) for h in a.hex.split(",")]
    elif a.name:
        if a.name not in PALETTES:
            sys.exit(f"unknown palette {a.name!r}; try --list")
        colors = [parse_hex(h) for h in PALETTES[a.name]]
    else:
        ap.error("give one of --name, --hex, --from-image, or --list")

    if len(colors) > 64:
        print(f"warning: {len(colors)} colours — the reference shader loop caps at 64. "
              "Raise MAXN in retro-glsl.js or reduce the palette.", file=sys.stderr)

    write_png(a.out, [colors])
    print(f"wrote {a.out}  ({len(colors)} x 1)")
    print(f"  paletteSize: {len(colors)}")


if __name__ == "__main__":
    main()
