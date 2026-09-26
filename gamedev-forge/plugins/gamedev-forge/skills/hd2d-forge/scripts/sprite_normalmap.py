"""Make a tangent-space normal map from a pixel-art sprite or sprite sheet.

The height field has two parts:

- a bevel grown inward from the sprite's alpha edge, so every silhouette reads as a
  rounded cushion under a moving light (the part that stops a lit billboard looking flat);
- a small luminance term, so painted highlights sit slightly higher than painted shadows.

Normals come from a Sobel gradient of that height. The output uses the OpenGL convention
(green = +Y = up in the image), which is what three.js and Godot expect. Pass
--flip-green for the DirectX convention (green = down), which Unreal expects.

Sheets: pass --frame WxH so each cell is bevelled on its own. Cell borders then count as
transparent, and a frame never leans on its neighbour.

Pure Python standard library: reads 8- and 16-bit PNGs of every colour type (grey,
grey+alpha, RGB, RGBA, palette with or without tRNS; palette and grey at 1/2/4/8 bits),
non-interlaced. Writes 8-bit RGBA. Transparent pixels get a flat normal and keep their
alpha, so the engine's alpha test cuts the normal map exactly where it cuts the colour.

Examples:
    python sprite_normalmap.py hero.png hero_n.png
    python sprite_normalmap.py hero_sheet.png hero_sheet_n.png --frame 32x48 --bevel 3
    python sprite_normalmap.py hero.png hero_n_dx.png --flip-green     # Unreal
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

Pixel = tuple[int, int, int, int]
Rows = list[list[Pixel]]


class PngError(ValueError):
    """The file is not a PNG this script can read."""


# --------------------------------------------------------------------------- PNG reading


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _unfilter(raw: bytes, width_bytes: int, height: int, bpp: int) -> list[bytearray]:
    rows: list[bytearray] = []
    prev = bytearray(width_bytes)
    stride = width_bytes + 1
    if len(raw) < stride * height:
        raise PngError("image data is shorter than the header says")
    for y in range(height):
        ftype = raw[y * stride]
        line = bytearray(raw[y * stride + 1 : (y + 1) * stride])
        if ftype == 1:
            for i in range(bpp, width_bytes):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(width_bytes):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(width_bytes):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(width_bytes):
                left = line[i - bpp] if i >= bpp else 0
                upleft = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + _paeth(left, prev[i], upleft)) & 0xFF
        elif ftype != 0:
            raise PngError(f"unknown PNG row filter {ftype}")
        rows.append(line)
        prev = line
    return rows


def _samples(line: bytearray, count: int, depth: int) -> list[int]:
    """Unpack `count` samples of `depth` bits from one row, scaled to 0-255."""
    if depth == 8:
        return list(line[:count])
    if depth == 16:
        return [line[2 * i] for i in range(count)]  # high byte is enough for 8-bit output
    per_byte = 8 // depth
    mask = (1 << depth) - 1
    out = []
    for i in range(count):
        byte = line[i // per_byte]
        shift = 8 - depth * (i % per_byte + 1)
        out.append((byte >> shift) & mask)
    return out


def read_png(path: Path) -> tuple[int, int, Rows]:
    """Return (width, height, rows of RGBA tuples)."""
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise PngError(f"{path} is not a PNG file")
    pos = len(PNG_SIGNATURE)
    ihdr = None
    palette: list[tuple[int, int, int]] = []
    trns = b""
    idat = bytearray()
    while pos + 8 <= len(data):
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", body)
        elif ctype == b"PLTE":
            palette = [tuple(body[i : i + 3]) for i in range(0, len(body), 3)]  # type: ignore[misc]
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if ihdr is None:
        raise PngError("missing IHDR chunk")
    width, height, depth, ctype_, _comp, _filt, interlace = ihdr
    if interlace:
        raise PngError("interlaced (Adam7) PNGs are not supported; re-save without interlacing")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype_)
    if channels is None:
        raise PngError(f"unknown PNG colour type {ctype_}")
    if depth not in (1, 2, 4, 8, 16) or (ctype_ in (2, 4, 6) and depth < 8):
        raise PngError(f"unsupported bit depth {depth} for colour type {ctype_}")
    if ctype_ == 3 and not palette:
        raise PngError("palette image without a PLTE chunk")

    bits_per_pixel = depth * channels
    width_bytes = (width * bits_per_pixel + 7) // 8
    bpp = max(1, bits_per_pixel // 8)
    rows = _unfilter(zlib.decompress(bytes(idat)), width_bytes, height, bpp)

    scale = 255 // ((1 << depth) - 1) if depth < 8 else 1
    key: tuple[int, ...] | None = None
    if trns and ctype_ == 0:
        key = (struct.unpack(">H", trns[:2])[0],)
    elif trns and ctype_ == 2:
        key = struct.unpack(">HHH", trns[:6])
    if key is not None and depth == 16:
        key = tuple(k >> 8 for k in key)
    elif key is not None and depth < 8:
        key = tuple(k * scale for k in key)

    pixels: Rows = []
    for line in rows:
        s = _samples(line, width * channels, depth)
        row: list[Pixel] = []
        for x in range(width):
            if ctype_ == 3:
                idx = s[x]
                r, g, b = palette[idx] if idx < len(palette) else (0, 0, 0)
                a = trns[idx] if idx < len(trns) else 255
            elif ctype_ == 0:
                v = s[x] * scale
                r = g = b = v
                a = 0 if key is not None and (v,) == key else 255
            elif ctype_ == 4:
                r = g = b = s[2 * x]
                a = s[2 * x + 1]
            elif ctype_ == 2:
                r, g, b = s[3 * x : 3 * x + 3]
                a = 0 if key is not None and (r, g, b) == key else 255
            else:
                r, g, b, a = s[4 * x : 4 * x + 4]
            row.append((r, g, b, a))
        pixels.append(row)
    return width, height, pixels


# --------------------------------------------------------------------------- PNG writing


def _chunk(ctype: bytes, body: bytes) -> bytes:
    return (
        struct.pack(">I", len(body))
        + ctype
        + body
        + struct.pack(">I", zlib.crc32(ctype + body) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rows: Rows) -> None:
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for px in row:
            raw.extend(px)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        PNG_SIGNATURE
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


# --------------------------------------------------------------------------- normal map


def _edge_distance(solid: list[list[bool]], x0: int, y0: int, w: int, h: int) -> list[list[float]]:
    """Chamfer (3-4) distance, in pixels, from each solid pixel to the nearest non-solid
    pixel or cell border. Non-solid pixels get 0; a solid pixel touching the edge gets 1."""
    big = 1 << 30
    d = [[big if solid[y0 + y][x0 + x] else 0 for x in range(w)] for y in range(h)]

    def at(x: int, y: int) -> int:
        return d[y][x] if 0 <= x < w and 0 <= y < h else 0  # outside the cell counts as edge

    for y in range(h):
        for x in range(w):
            if d[y][x]:
                d[y][x] = min(
                    d[y][x],
                    at(x - 1, y) + 3,
                    at(x, y - 1) + 3,
                    at(x - 1, y - 1) + 4,
                    at(x + 1, y - 1) + 4,
                )
    for y in range(h - 1, -1, -1):
        for x in range(w - 1, -1, -1):
            if d[y][x]:
                d[y][x] = min(
                    d[y][x],
                    at(x + 1, y) + 3,
                    at(x, y + 1) + 3,
                    at(x + 1, y + 1) + 4,
                    at(x - 1, y + 1) + 4,
                )
    return [[v / 3.0 for v in row] for row in d]


def normal_map(
    width: int,
    height: int,
    pixels: Rows,
    *,
    frame: tuple[int, int] | None = None,
    bevel: float = 2.0,
    depth: float | None = None,
    luma: float = 0.25,
    profile: str = "round",
    alpha_threshold: int = 128,
    flip_green: bool = False,
) -> Rows:
    """Return RGBA rows of the normal map. `depth` is the plateau height in pixels
    (default: equal to `bevel`, which makes the bevel roughly a 45-degree chamfer)."""
    if bevel <= 0:
        raise ValueError("bevel must be positive")
    depth = bevel if depth is None else depth
    fw, fh = frame if frame else (width, height)
    if width % fw or height % fh:
        raise ValueError(f"image {width}x{height} is not a whole number of {fw}x{fh} frames")

    solid = [[px[3] >= alpha_threshold for px in row] for row in pixels]
    hmap = [[0.0] * width for _ in range(height)]
    for cy in range(0, height, fh):
        for cx in range(0, width, fw):
            dist = _edge_distance(solid, cx, cy, fw, fh)
            for y in range(fh):
                for x in range(fw):
                    if not solid[cy + y][cx + x]:
                        continue
                    t = min(dist[y][x], bevel) / bevel
                    if profile == "round":
                        t = math.sqrt(max(0.0, 1.0 - (1.0 - t) ** 2))
                    r, g, b, _a = pixels[cy + y][cx + x]
                    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
                    hmap[cy + y][cx + x] = depth * t + luma * lum

    def h_at(x: int, y: int, cx: int, cy: int) -> float:
        # Samples outside the pixel's own cell read as height 0 (transparent).
        if cx <= x < cx + fw and cy <= y < cy + fh:
            return hmap[y][x]
        return 0.0

    out: Rows = []
    for y in range(height):
        cy = (y // fh) * fh
        row: list[Pixel] = []
        for x in range(width):
            alpha = pixels[y][x][3]
            if not solid[y][x]:
                row.append((128, 128, 255, alpha))
                continue
            cx = (x // fw) * fw

            # 3x3 neighbourhood, row by row: n[0] is the row above, n[2] the row below.
            n = [[h_at(x + dx, y + dy, cx, cy) for dx in (-1, 0, 1)] for dy in (-1, 0, 1)]
            gx = (n[0][2] + 2 * n[1][2] + n[2][2] - n[0][0] - 2 * n[1][0] - n[2][0]) / 8.0
            gy = (n[2][0] + 2 * n[2][1] + n[2][2] - n[0][0] - 2 * n[0][1] - n[0][2]) / 8.0
            # Image rows run downward; tangent-space +Y is up, so dh/dy_up = -gy.
            nx, ny, nz = -gx, gy, 1.0
            if flip_green:
                ny = -ny
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            row.append(
                (
                    round((nx * inv * 0.5 + 0.5) * 255),
                    round((ny * inv * 0.5 + 0.5) * 255),
                    round((nz * inv * 0.5 + 0.5) * 255),
                    alpha,
                )
            )
        out.append(row)
    return out


# --------------------------------------------------------------------------- CLI


def _frame_arg(text: str) -> tuple[int, int]:
    try:
        w, h = (int(v) for v in text.lower().split("x"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("use WxH, for example 32x48") from exc
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError("frame size must be positive")
    return w, h


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        epilog="Output convention: OpenGL (green up) unless --flip-green.",
    )
    ap.add_argument("input", type=Path, help="sprite or sheet PNG")
    ap.add_argument("output", type=Path, help="normal map PNG to write (8-bit RGBA)")
    ap.add_argument("--frame", type=_frame_arg, help="cell size WxH; bevel each frame on its own")
    ap.add_argument("--bevel", type=float, default=2.0, help="bevel width in pixels (default: 2)")
    ap.add_argument("--depth", type=float, help="plateau height in pixels (default: bevel)")
    ap.add_argument(
        "--luma", type=float, default=0.25, help="luminance height weight (default: 0.25)"
    )
    ap.add_argument(
        "--profile",
        choices=("round", "linear"),
        default="round",
        help="bevel shape (default: round)",
    )
    ap.add_argument(
        "--alpha-threshold", type=int, default=128, help="alpha counted as solid (default: 128)"
    )
    ap.add_argument("--flip-green", action="store_true", help="DirectX convention (green down)")
    args = ap.parse_args(argv)

    try:
        width, height, pixels = read_png(args.input)
        result = normal_map(
            width,
            height,
            pixels,
            frame=args.frame,
            bevel=args.bevel,
            depth=args.depth,
            luma=args.luma,
            profile=args.profile,
            alpha_threshold=args.alpha_threshold,
            flip_green=args.flip_green,
        )
    except (OSError, PngError, ValueError, zlib.error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    write_png(args.output, width, height, result)
    convention = "DirectX (green down)" if args.flip_green else "OpenGL (green up)"
    print(f"wrote {args.output} ({width}x{height}, {convention})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
