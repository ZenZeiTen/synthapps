"""Small image helpers that work without Pillow: an RGB frame type and a PNG encoder.

Pillow, when installed, is used for resizing and JPEG (smaller uploads). Without
it frames are shrunk by sampling and sent as PNG.
"""

from __future__ import annotations

import base64
import io
import struct
import zlib
from dataclasses import dataclass


@dataclass(frozen=True)
class Frame:
    width: int
    height: int
    rgb: bytes  # width * height * 3 bytes, row by row

    def pixel(self, x: int, y: int) -> tuple[int, int, int]:
        i = (y * self.width + x) * 3
        return self.rgb[i], self.rgb[i + 1], self.rgb[i + 2]


def encode_png(frame: Frame) -> bytes:
    raw = bytearray()
    stride = frame.width * 3
    for y in range(frame.height):
        raw.append(0)  # filter: none
        raw += frame.rgb[y * stride:(y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", frame.width, frame.height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def _sample_down(frame: Frame, width: int, height: int) -> Frame:
    out = bytearray(width * height * 3)
    for y in range(height):
        sy = y * frame.height // height
        for x in range(width):
            sx = x * frame.width // width
            si, di = (sy * frame.width + sx) * 3, (y * width + x) * 3
            out[di:di + 3] = frame.rgb[si:si + 3]
    return Frame(width, height, bytes(out))


def fit(width: int, height: int, max_edge: int) -> tuple[int, int]:
    scale = min(1.0, max_edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def encode_for_model(frame: Frame, max_edge: int = 1024, jpeg_quality: int = 80) -> tuple[str, str]:
    """Return (media_type, base64 data) ready for an image content block."""
    w, h = fit(frame.width, frame.height, max_edge)
    try:
        from PIL import Image  # type: ignore[import-not-found]
    except ImportError:
        small = frame if (w, h) == (frame.width, frame.height) else _sample_down(frame, w, h)
        return "image/png", base64.standard_b64encode(encode_png(small)).decode("ascii")
    img = Image.frombytes("RGB", (frame.width, frame.height), frame.rgb)
    if (w, h) != img.size:
        img = img.resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=jpeg_quality)
    return "image/jpeg", base64.standard_b64encode(buf.getvalue()).decode("ascii")
