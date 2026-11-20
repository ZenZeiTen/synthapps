"""Read and write .aseprite files directly, following Aseprite's published file spec
(docs/ase-file-specs.md in the aseprite/aseprite repository).

Why this exists: this build machine has neither Aseprite nor the Aseprite MCP server,
so the pipeline writes the editable sources itself. The export step then reads the
.aseprite files back (never the in-memory art), so a file edited by hand in Aseprite
is what ships. With Aseprite installed, `aseprite -b x.aseprite --sheet x.png`
produces the same pixels (see docs/PIPELINE.md).

Scope: RGBA (32 bpp) sprites, one layer per sprite unless given more, compressed
image cels, a palette chunk, an sRGB colour profile and animation tags. That is
everything the game's art needs.
"""
from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

MAGIC_FILE = 0xA5E0
MAGIC_FRAME = 0xF1FA
CH_LAYER = 0x2004
CH_CEL = 0x2005
CH_PROFILE = 0x2007
CH_TAGS = 0x2018
CH_PALETTE = 0x2019

RGBA = tuple[int, int, int, int]


@dataclass
class Frame:
    # One pixel list per layer, row-major, width*height RGBA tuples.
    layers: list[list[RGBA]]
    duration_ms: int = 100


@dataclass
class Sprite:
    width: int
    height: int
    frames: list[Frame]
    layer_names: list[str] = field(default_factory=lambda: ["art"])
    palette: list[RGBA] = field(default_factory=list)
    tags: list[tuple[str, int, int]] = field(default_factory=list)  # (name, from, to)


def _string(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack("<H", len(b)) + b


def _chunk(kind: int, data: bytes) -> bytes:
    return struct.pack("<IH", 6 + len(data), kind) + data


def _bbox(px: list[RGBA], w: int, h: int):
    xs = [i % w for i, p in enumerate(px) if p[3]]
    ys = [i // w for i, p in enumerate(px) if p[3]]
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def write(path: str, spr: Sprite) -> None:
    w, h = spr.width, spr.height
    frames_bin = []
    for fi, fr in enumerate(spr.frames):
        chunks = []
        if fi == 0:
            chunks.append(_chunk(CH_PROFILE, struct.pack("<HHI8x", 1, 0, 0)))
            if spr.palette:
                pal = struct.pack("<III8x", len(spr.palette), 0, len(spr.palette) - 1)
                for (r, g, b, a) in spr.palette:
                    pal += struct.pack("<HBBBB", 0, r, g, b, a)
                chunks.append(_chunk(CH_PALETTE, pal))
            for name in spr.layer_names:
                # flags: visible|editable; type normal; child level 0; blend normal; opacity 255
                chunks.append(_chunk(CH_LAYER, struct.pack("<HHHHHHB3x", 3, 0, 0, 0, 0, 0, 255) + _string(name)))
            if spr.tags:
                t = struct.pack("<H8x", len(spr.tags))
                for (name, a, b) in spr.tags:
                    t += struct.pack("<HHBH6x3Bx", a, b, 0, 0, 0, 0, 0) + _string(name)
                chunks.append(_chunk(CH_TAGS, t))
        for li, px in enumerate(fr.layers):
            assert len(px) == w * h, (path, fi, li, len(px))
            bb = _bbox(px, w, h)
            if bb is None:
                continue  # empty cel: Aseprite simply has no cel there
            x0, y0, x1, y1 = bb
            raw = bytearray()
            for y in range(y0, y1):
                for x in range(x0, x1):
                    raw += bytes(px[y * w + x])
            data = struct.pack("<HhhBHh5x", li, x0, y0, 255, 2, 0)
            data += struct.pack("<HH", x1 - x0, y1 - y0) + zlib.compress(bytes(raw), 9)
            chunks.append(_chunk(CH_CEL, data))
        body = b"".join(chunks)
        n = len(chunks)
        header = struct.pack("<IHHH2xI", 16 + len(body), MAGIC_FRAME, min(n, 0xFFFF), fr.duration_ms, n)
        frames_bin.append(header + body)
    frames_blob = b"".join(frames_bin)
    ncolors = len(spr.palette) if spr.palette else 256
    head = struct.pack(
        "<IHHHHHIHIIB3xHBBhhHH84x",
        128 + len(frames_blob), MAGIC_FILE, len(spr.frames), w, h, 32, 1, 100, 0, 0,
        0, ncolors, 1, 1, 0, 0, 16, 16,
    )
    assert len(head) == 128
    with open(path, "wb") as f:
        f.write(head + frames_blob)


def read(path: str) -> Sprite:
    """Parse an RGBA .aseprite file (ours or one saved by Aseprite) and flatten cels
    onto per-layer canvases. Linked cels (type 1) are resolved; hidden layers are
    reported so callers can skip them."""
    with open(path, "rb") as f:
        buf = f.read()
    (size, magic, nframes, w, h, depth) = struct.unpack_from("<IHHHHH", buf, 0)
    if magic != MAGIC_FILE:
        raise ValueError(f"{path}: not an .aseprite file")
    if depth != 32:
        raise ValueError(f"{path}: colour depth {depth}; the pipeline expects RGBA (32)")
    pos = 128
    layer_names: list[str] = []
    layer_visible: list[bool] = []
    palette: list[RGBA] = []
    tags: list[tuple[str, int, int]] = []
    frames: list[Frame] = []
    for fi in range(nframes):
        fsize, fmagic, old_n, dur = struct.unpack_from("<IHHH", buf, pos)
        new_n = struct.unpack_from("<I", buf, pos + 12)[0]
        if fmagic != MAGIC_FRAME:
            raise ValueError(f"{path}: bad frame magic in frame {fi}")
        n = new_n if new_n else old_n
        cp = pos + 16
        cels: dict[int, tuple] = {}
        for _ in range(n):
            csize, ctype = struct.unpack_from("<IH", buf, cp)
            d = cp + 6
            if ctype == CH_LAYER:
                flags = struct.unpack_from("<H", buf, d)[0]
                ln = struct.unpack_from("<H", buf, d + 16)[0]
                layer_names.append(buf[d + 18:d + 18 + ln].decode("utf-8"))
                layer_visible.append(bool(flags & 1))
            elif ctype == CH_PALETTE:
                count, first, last = struct.unpack_from("<III", buf, d)
                e = d + 20
                palette = []
                for _i in range(first, last + 1):
                    fl, r, g, b, a = struct.unpack_from("<HBBBB", buf, e)
                    e += 6
                    if fl & 1:
                        e += 2 + struct.unpack_from("<H", buf, e)[0]
                    palette.append((r, g, b, a))
            elif ctype == CH_TAGS:
                nt = struct.unpack_from("<H", buf, d)[0]
                e = d + 10
                for _i in range(nt):
                    a, b = struct.unpack_from("<HH", buf, e)
                    e += 17
                    ln = struct.unpack_from("<H", buf, e)[0]
                    tags.append((buf[e + 2:e + 2 + ln].decode("utf-8"), a, b))
                    e += 2 + ln
            elif ctype == CH_CEL:
                li, x, y, op, ct = struct.unpack_from("<HhhBH", buf, d)
                e = d + 16
                if ct == 1:
                    cels[li] = ("link", struct.unpack_from("<H", buf, e)[0])
                elif ct in (0, 2):
                    cw, chh = struct.unpack_from("<HH", buf, e)
                    raw = buf[e + 4:cp + csize]
                    raw = zlib.decompress(raw) if ct == 2 else raw[:cw * chh * 4]
                    cels[li] = ("img", x, y, cw, chh, raw)
            cp += csize
        pos += fsize
        layers = []
        for li in range(len(layer_names)):
            px = [(0, 0, 0, 0)] * (w * h)
            c = cels.get(li)
            if c and c[0] == "link":
                src = frames[c[1]].layers[li]
                px = list(src)
            elif c:
                _, x, y, cw, chh, raw = c
                for yy in range(chh):
                    for xx in range(cw):
                        X, Y = x + xx, y + yy
                        if 0 <= X < w and 0 <= Y < h:
                            o = (yy * cw + xx) * 4
                            px[Y * w + X] = tuple(raw[o:o + 4])
            layers.append(px)
        frames.append(Frame(layers, dur))
    spr = Sprite(w, h, frames, layer_names, palette, tags)
    spr.layer_visible = layer_visible  # type: ignore[attr-defined]
    return spr


def flatten(spr: Sprite, frame: int) -> list[RGBA]:
    """Composite visible layers of one frame (normal blend, no partial alpha: pixel art)."""
    out = [(0, 0, 0, 0)] * (spr.width * spr.height)
    vis = getattr(spr, "layer_visible", [True] * len(spr.layer_names))
    for li, px in enumerate(spr.frames[frame].layers):
        if not vis[li]:
            continue
        for i, p in enumerate(px):
            if p[3]:
                out[i] = p
    return out
