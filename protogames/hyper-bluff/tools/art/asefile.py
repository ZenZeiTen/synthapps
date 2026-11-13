"""Read and write Aseprite .aseprite files (RGBA) without needing the Aseprite app.

The format is the public one from the Aseprite repository (docs/ase-file-specs.md).
Writing keeps things simple so the files stay easy to edit by hand in Aseprite:
RGBA colour mode, normal layers, one compressed cel per layer per frame, tags, palette.

Reading accepts what Aseprite itself saves after a hand edit of such a file: trimmed
cels with offsets, raw / linked / compressed cels, hidden layers, layer and cel opacity.
Group layers are walked; tilemaps and indexed / grayscale files are rejected loudly.

    spr = Sprite(96, 96)
    spr.palette = ["#101020", ...]
    art = spr.add_layer("art")
    f = spr.add_frame(120)                 # duration in ms
    spr.set_cel(art, f, pil_rgba_image)
    spr.add_tag("idle", 0, 3)
    spr.save("x.aseprite")
    spr2 = Sprite.load("x.aseprite"); img = spr2.flatten(0)
"""
import struct
import zlib
from PIL import Image

MAGIC_FILE = 0xA5E0
MAGIC_FRAME = 0xF1FA
CH_LAYER, CH_CEL, CH_PROFILE, CH_TAGS, CH_PALETTE = 0x2004, 0x2005, 0x2007, 0x2018, 0x2019


def _string(s):
    b = s.encode("utf-8")
    return struct.pack("<H", len(b)) + b


def _chunk(kind, data):
    return struct.pack("<IH", len(data) + 6, kind) + data


def _hex_rgb(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _mul_un8(a, b):
    t = a * b + 0x80
    return ((t >> 8) + t) >> 8


def _cdiv(n, d):
    q = abs(n) // d
    return q if n >= 0 else -q


def _blend(back, src, opacity):
    br, bg, bb, ba = back
    sr, sg, sb, sa = src
    if ba == 0:
        return (sr, sg, sb, _mul_un8(sa, opacity))
    if sa == 0:
        return back
    sa = _mul_un8(sa, opacity)
    ra = sa + ba - _mul_un8(ba, sa)
    if ra == 0:
        return (0, 0, 0, 0)
    return (br + _cdiv((sr - br) * sa, ra), bg + _cdiv((sg - bg) * sa, ra), bb + _cdiv((sb - bb) * sa, ra), ra)


class Sprite:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.layers = []      # dicts: name, visible, opacity, group
        self.durations = []   # ms per frame
        self.cels = {}        # (layer, frame) -> (x, y, RGBA image, opacity)
        self.tags = []        # dicts: name, from, to
        self.palette = []     # "#rrggbb"

    # ---- building -------------------------------------------------------
    def add_layer(self, name, visible=True, opacity=255):
        self.layers.append({"name": name, "visible": visible, "opacity": opacity, "group": False})
        return len(self.layers) - 1

    def add_frame(self, ms=100):
        self.durations.append(int(ms))
        return len(self.durations) - 1

    def set_cel(self, layer, frame, img, x=0, y=0, opacity=255):
        img = img.convert("RGBA")
        box = img.getbbox()
        if box is None:
            self.cels.pop((layer, frame), None)
            return
        self.cels[(layer, frame)] = (x + box[0], y + box[1], img.crop(box), opacity)

    def add_tag(self, name, first, last):
        self.tags.append({"name": name, "from": first, "to": last})

    # ---- writing --------------------------------------------------------
    def save(self, path):
        frames = []
        for f, ms in enumerate(self.durations):
            chunks = []
            if f == 0:
                chunks.append(_chunk(CH_PROFILE, struct.pack("<HHI8x", 1, 0, 0)))
                if self.palette:
                    n = len(self.palette) + 1
                    body = struct.pack("<III8x", n, 0, n - 1) + struct.pack("<HBBBB", 0, 0, 0, 0, 0)
                    for h in self.palette:
                        r, g, b = _hex_rgb(h)
                        body += struct.pack("<HBBBB", 0, r, g, b, 255)
                    chunks.append(_chunk(CH_PALETTE, body))
                for lay in self.layers:
                    flags = (1 if lay["visible"] else 0) | 2
                    body = struct.pack("<HHHHHHB3x", flags, 0, 0, 0, 0, 0, lay["opacity"])
                    chunks.append(_chunk(CH_LAYER, body + _string(lay["name"])))
                if self.tags:
                    body = struct.pack("<H8x", len(self.tags))
                    for t in self.tags:
                        body += struct.pack("<HHBH6x3xB", t["from"], t["to"], 0, 0, 0) + _string(t["name"])
                    chunks.append(_chunk(CH_TAGS, body))
            for li in range(len(self.layers)):
                cel = self.cels.get((li, f))
                if cel is None:
                    continue
                x, y, img, op = cel
                body = struct.pack("<HhhBHh5x", li, x, y, op, 2, 0)
                body += struct.pack("<HH", img.width, img.height) + zlib.compress(img.tobytes(), 9)
                chunks.append(_chunk(CH_CEL, body))
            data = b"".join(chunks)
            n = len(chunks)
            frames.append(struct.pack("<IHHH2xI", len(data) + 16, MAGIC_FRAME, min(n, 0xFFFF), ms, n) + data)
        body = b"".join(frames)
        head = struct.pack("<IHHHHHIHIIB3xHBBhhHH", len(body) + 128, MAGIC_FILE, len(self.durations),
                           self.w, self.h, 32, 1, 100, 0, 0, 0, 0, 1, 1, 0, 0, 16, 16)
        head += b"\0" * (128 - len(head))
        with open(path, "wb") as fh:
            fh.write(head + body)

    # ---- reading --------------------------------------------------------
    @classmethod
    def load(cls, path):
        raw = open(path, "rb").read()
        size, magic, nframes, w, h, depth, flags = struct.unpack_from("<IHHHHHI", raw, 0)
        if magic != MAGIC_FILE:
            raise ValueError(f"{path}: not an Aseprite file")
        if depth != 32:
            raise ValueError(f"{path}: colour depth {depth} is not RGBA; convert the sprite to RGB mode")
        spr = cls(w, h)
        pos = 128
        for f in range(nframes):
            fsize, fmagic, old_n, ms, new_n = struct.unpack_from("<IHHH2xI", raw, pos)
            if fmagic != MAGIC_FRAME:
                raise ValueError(f"{path}: bad frame header at {pos}")
            spr.durations.append(ms)
            n = new_n if new_n else old_n
            cp = pos + 16
            for _ in range(n):
                csize, kind = struct.unpack_from("<IH", raw, cp)
                d = raw[cp + 6:cp + csize]
                if kind == CH_LAYER:
                    lflags, ltype, _child, _dw, _dh, blend, op = struct.unpack_from("<HHHHHHB", d, 0)
                    if ltype == 2:
                        raise ValueError(f"{path}: tilemap layers are not supported")
                    nlen = struct.unpack_from("<H", d, 16)[0]
                    spr.layers.append({"name": d[18:18 + nlen].decode("utf-8"), "visible": bool(lflags & 1),
                                       "opacity": op if flags & 1 else 255, "group": ltype == 1})
                elif kind == CH_CEL:
                    li, x, y, op, ctype = struct.unpack_from("<HhhBH", d, 0)
                    if ctype in (0, 2):
                        cw, ch = struct.unpack_from("<HH", d, 16)
                        px = d[20:] if ctype == 0 else zlib.decompress(d[20:])
                        img = Image.frombytes("RGBA", (cw, ch), px[:cw * ch * 4])
                        spr.cels[(li, f)] = (x, y, img, op)
                    elif ctype == 1:
                        src = struct.unpack_from("<H", d, 16)[0]
                        if (li, src) in spr.cels:
                            spr.cels[(li, f)] = spr.cels[(li, src)]
                    else:
                        raise ValueError(f"{path}: cel type {ctype} is not supported")
                elif kind == CH_TAGS:
                    nt = struct.unpack_from("<H", d, 0)[0]
                    tp = 10
                    for _t in range(nt):
                        a, b = struct.unpack_from("<HH", d, tp)
                        nlen = struct.unpack_from("<H", d, tp + 17)[0]
                        spr.tags.append({"name": d[tp + 19:tp + 19 + nlen].decode("utf-8"), "from": a, "to": b})
                        tp += 19 + nlen
                elif kind == CH_PALETTE:
                    n_ent, first, last = struct.unpack_from("<III", d, 0)
                    ep = 20
                    pal = {}
                    for i in range(first, last + 1):
                        eflags, r, g, b, a = struct.unpack_from("<HBBBB", d, ep)
                        ep += 6
                        if eflags & 1:
                            nlen = struct.unpack_from("<H", d, ep)[0]
                            ep += 2 + nlen
                        pal[i] = (r, g, b, a)
                    spr.palette = ["#%02x%02x%02x" % pal[i][:3] for i in sorted(pal) if pal[i][3] > 0]
                cp += csize
            pos += fsize
        return spr

    def flatten(self, frame):
        """Composite the visible layers of one frame, bottom layer first, with the same
        integer maths as Aseprite's renderer (normal blend), so exports match it exactly."""
        out = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        po = out.load()
        for li, lay in enumerate(self.layers):
            if not lay["visible"] or lay["group"]:
                continue
            cel = self.cels.get((li, frame))
            if cel is None:
                continue
            x, y, img, op = cel
            opacity = _mul_un8(op, lay["opacity"])
            ps = img.load()
            for j in range(img.height):
                for i in range(img.width):
                    px, py = x + i, y + j
                    if 0 <= px < self.w and 0 <= py < self.h:
                        po[px, py] = _blend(po[px, py], ps[i, j], opacity)
        return out

    def tag_frames(self, name):
        for t in self.tags:
            if t["name"] == name:
                return list(range(t["from"], t["to"] + 1))
        raise KeyError(name)
