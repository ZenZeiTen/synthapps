"""Read and write .aseprite files from plain Python: no Aseprite, no MCP server needed.

Follows Aseprite's published file spec (docs/ase-file-specs.md in the aseprite/aseprite
repository). Written for a game pipeline on a machine with neither Aseprite nor its MCP
server. An independent reader (the npm package `ase-parser`) parsed its output back with
the same size, frames, layer, tag and cel bytes. It has also round-tripped files through
this module's own reader.

Scope: RGBA (32 bpp) sprites, one or more layers, zlib-compressed image cels, a palette
chunk, an sRGB colour profile and animation tags. Indexed and greyscale files are not
read; linked cels are.

Library use:
    import asefile as A
    spr = A.Sprite(16, 16, [A.Frame([pixels], 120)], ["art"], palette, [("idle", 0, 0)])
    A.write("hero.aseprite", spr)
    spr = A.read("hero.aseprite"); px = A.flatten(spr, 0)

Command line (needs Pillow for PNG in/out):
    python asefile.py info hero.aseprite
    python asefile.py sheet hero.aseprite hero.png [hero.json]      # horizontal strip + Aseprite-style JSON
    python asefile.py from-png out.aseprite f0.png f1.png ... [--duration 120] [--tag idle:0:1]
                     [--palette pal.png|pal.aseprite] [--lock] [--outline R,G,B[,A]]
      --lock     snaps every colour to the palette (redmean distance) and thresholds alpha
                 at 50%: the clean-up for Blender renders
      --outline  draws a 1-px outline outside the silhouette, never on top of it
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


# ------------------------------------------------------------------ helpers for renders

def _redmean(c1, c2) -> float:
    r, g, b = c1[:3]
    R, G, B = c2[:3]
    rm = (r + R) / 2
    return (2 + rm / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2


def lock_to_palette(px: list[RGBA], palette: list[RGBA], alpha_cut: int = 128) -> list[RGBA]:
    """Snap each opaque pixel to the nearest palette colour; pixels under alpha_cut vanish.
    No dithering: characters stay clean (use ordered dither only for smoke and gradients)."""
    opaque = [p for p in palette if p[3] > 0]
    cache: dict = {}
    out = []
    for p in px:
        if p[3] < alpha_cut:
            out.append((0, 0, 0, 0))
            continue
        k = p[:3]
        if k not in cache:
            best = min(opaque, key=lambda q: _redmean(k, q))
            cache[k] = (best[0], best[1], best[2], 255)
        out.append(cache[k])
    return out


def outline(px: list[RGBA], w: int, h: int, colour: RGBA, diagonal: bool = False) -> list[RGBA]:
    """1-px outline in `colour` around the opaque shape, outside it (never on top)."""
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, 1), (1, -1), (-1, -1)] if diagonal else [])
    out = list(px)
    for y in range(h):
        for x in range(w):
            if px[y * w + x][3]:
                continue
            for dx, dy in nb:
                X, Y = x + dx, y + dy
                if 0 <= X < w and 0 <= Y < h and px[Y * w + X][3]:
                    out[y * w + x] = colour
                    break
    return out


def _pixels(im):
    # Pillow 12+ deprecates getdata() in favour of get_flattened_data()
    return im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata()


def _main(argv: list[str]) -> int:
    import json
    import os
    if not argv or argv[0] not in ("info", "sheet", "from-png"):
        print(__doc__)
        return 2
    cmd = argv[0]
    if cmd == "info":
        spr = read(argv[1])
        print(f"{argv[1]}: {spr.width}x{spr.height}, {len(spr.frames)} frames, layers {spr.layer_names}, "
              f"{len(spr.palette)} palette colours, tags {spr.tags}, durations {[f.duration_ms for f in spr.frames]}")
        return 0
    from PIL import Image
    if cmd == "sheet":
        spr = read(argv[1])
        n = len(spr.frames)
        sheet = Image.new("RGBA", (spr.width * n, spr.height), (0, 0, 0, 0))
        frames = []
        for i in range(n):
            im = Image.new("RGBA", (spr.width, spr.height))
            im.putdata(flatten(spr, i))
            sheet.paste(im, (i * spr.width, 0))
            frames.append({"filename": f"{os.path.basename(argv[1])} {i}",
                           "frame": {"x": i * spr.width, "y": 0, "w": spr.width, "h": spr.height},
                           "trimmed": False, "duration": spr.frames[i].duration_ms,
                           "spriteSourceSize": {"x": 0, "y": 0, "w": spr.width, "h": spr.height},
                           "sourceSize": {"w": spr.width, "h": spr.height}})
        sheet.save(argv[2])
        if len(argv) > 3:
            meta = {"image": os.path.basename(argv[2]), "size": {"w": sheet.width, "h": sheet.height},
                    "frameTags": [{"name": t, "from": a, "to": b, "direction": "forward"} for (t, a, b) in spr.tags]}
            with open(argv[3], "w") as f:
                json.dump({"frames": frames, "meta": meta}, f, indent=1)
        print(f"wrote {argv[2]} ({n} frames)")
        return 0
    # from-png
    out, rest = argv[1], argv[2:]
    pngs, tags, dur, pal_src, lock, oc = [], [], 100, None, False, None
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--duration":
            dur = int(rest[i + 1]); i += 2
        elif a == "--tag":
            name, fa, fb = rest[i + 1].split(":"); tags.append((name, int(fa), int(fb))); i += 2
        elif a == "--palette":
            pal_src = rest[i + 1]; i += 2
        elif a == "--lock":
            lock = True; i += 1
        elif a == "--outline":
            v = [int(x) for x in rest[i + 1].split(",")]; oc = tuple(v + [255] * (4 - len(v))); i += 2
        else:
            pngs.append(a); i += 1
    palette: list[RGBA] = []
    if pal_src:
        if pal_src.endswith(".aseprite") or pal_src.endswith(".ase"):
            palette = read(pal_src).palette
        else:
            seen = []
            for p in _pixels(Image.open(pal_src).convert("RGBA")):
                if p[3] and p not in seen:
                    seen.append(p)
            palette = seen
    if lock and not palette:
        print("--lock needs --palette")
        return 2
    ims = [Image.open(p).convert("RGBA") for p in pngs]
    w, h = ims[0].size
    assert all(im.size == (w, h) for im in ims), "all frames must be the same size"
    frames = []
    for im in ims:
        px = [tuple(p) for p in _pixels(im)]
        if lock:
            px = lock_to_palette(px, palette)
        if oc:
            px = outline(px, w, h, oc)
        frames.append(Frame([px], dur))
    write(out, Sprite(w, h, frames, ["art"], palette, tags))
    print(f"wrote {out}: {w}x{h}, {len(frames)} frames, {len(palette)} palette colours, tags {tags}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv[1:]))
