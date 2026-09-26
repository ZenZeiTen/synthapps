"""Tests for hd2d-forge/scripts/sprite_normalmap.py (pure standard library)."""

from __future__ import annotations

import importlib.util
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parent.parent
    / "plugins/gamedev-forge/skills/hd2d-forge/scripts/sprite_normalmap.py"
)
_spec = importlib.util.spec_from_file_location("sprite_normalmap", SCRIPT)
assert _spec is not None and _spec.loader is not None
snm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(snm)

CLEAR = (0, 0, 0, 0)
Pixel = tuple[int, int, int, int]


def disc(size: int, radius: float, color: Pixel = (180, 120, 90, 255)) -> list[list[Pixel]]:
    c = (size - 1) / 2
    return [
        [color if (x - c) ** 2 + (y - c) ** 2 <= radius**2 else CLEAR for x in range(size)]
        for y in range(size)
    ]


def square(w: int, h: int, color: Pixel = (200, 200, 200, 255)) -> list[list[Pixel]]:
    return [[color] * w for _ in range(h)]


def chunk(ctype: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(ctype + body) & 0xFFFFFFFF
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", crc)


def encode_png(
    width: int,
    height: int,
    ctype: int,
    depth: int,
    rows: list[bytes],
    filters: list[int],
    extra: bytes = b"",
) -> bytes:
    """Build a PNG with explicit per-row filter types, to exercise the reader's unfilter."""
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = max(1, depth * channels // 8)
    raw = bytearray()
    prev = bytes(len(rows[0]))
    for row, f in zip(rows, filters, strict=True):
        out = bytearray()
        for i, v in enumerate(row):
            left = row[i - bpp] if i >= bpp else 0
            up = prev[i]
            ul = prev[i - bpp] if i >= bpp else 0
            pred = [0, left, up, (left + up) >> 1, snm._paeth(left, up, ul)][f]
            out.append((v - pred) & 0xFF)
        raw.append(f)
        raw += out
        prev = row
    ihdr = struct.pack(">IIBBBBB", width, height, depth, ctype, 0, 0, 0)
    return (
        snm.PNG_SIGNATURE
        + chunk(b"IHDR", ihdr)
        + extra
        + chunk(b"IDAT", zlib.compress(bytes(raw)))
        + chunk(b"IEND", b"")
    )


class PngReadTests(unittest.TestCase):
    def roundtrip(self, data: bytes) -> tuple[int, int, list[list[Pixel]]]:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "in.png"
            p.write_bytes(data)
            return snm.read_png(p)

    def test_rgba_every_filter_type(self) -> None:
        rows = [bytes((x * 40 + y * 7) % 256 for x in range(3 * 4)) for y in range(5)]
        w, h, px = self.roundtrip(encode_png(3, 5, 6, 8, rows, [0, 1, 2, 3, 4]))
        self.assertEqual((w, h), (3, 5))
        for y in range(5):
            for x in range(3):
                self.assertEqual(px[y][x], tuple(rows[y][4 * x : 4 * x + 4]))

    def test_palette_4bit_with_trns(self) -> None:
        plte = chunk(b"PLTE", bytes([0, 0, 0, 255, 0, 0, 0, 255, 0]))
        trns = chunk(b"tRNS", bytes([0, 255, 128]))
        # indices 0,1,2,1,0 packed two per byte -> 3 bytes per row
        row = bytes([0x01, 0x21, 0x00])
        w, h, px = self.roundtrip(encode_png(5, 2, 3, 4, [row, row], [0, 2], plte + trns))
        self.assertEqual(
            px[0],
            [(0, 0, 0, 0), (255, 0, 0, 255), (0, 255, 0, 128), (255, 0, 0, 255), (0, 0, 0, 0)],
        )
        self.assertEqual(px[1], px[0])

    def test_grey_16bit_and_colour_key(self) -> None:
        trns = chunk(b"tRNS", struct.pack(">H", 0x1234))
        row = struct.pack(">HH", 0x1234, 0xFF00)
        _, _, px = self.roundtrip(encode_png(2, 1, 0, 16, [row], [1], trns))
        self.assertEqual(px[0], [(0x12, 0x12, 0x12, 0), (0xFF, 0xFF, 0xFF, 255)])

    def test_writer_reader_roundtrip(self) -> None:
        pixels = disc(9, 3.5)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "x.png"
            snm.write_png(p, 9, 9, pixels)
            self.assertEqual(snm.read_png(p), (9, 9, pixels))

    def test_rejects_interlaced_and_non_png(self) -> None:
        ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 1)
        bad = snm.PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IEND", b"")
        with self.assertRaisesRegex(snm.PngError, "interlaced"):
            self.roundtrip(bad)
        with self.assertRaisesRegex(snm.PngError, "not a PNG"):
            self.roundtrip(b"GIF89a....")


class NormalMapTests(unittest.TestCase):
    def test_transparent_pixels_are_flat_and_keep_alpha(self) -> None:
        out = snm.normal_map(9, 9, disc(9, 3.5))
        self.assertEqual(out[0][0], (128, 128, 255, 0))

    def test_plateau_is_flat(self) -> None:
        out = snm.normal_map(21, 21, square(21, 21), bevel=2, luma=0)
        self.assertEqual(out[10][10][:3], (128, 128, 255))

    def test_edges_face_outward_opengl(self) -> None:
        out = snm.normal_map(15, 15, disc(15, 6.5), luma=0)
        top, bottom = out[1][7], out[13][7]
        left, right = out[7][1], out[7][13]
        self.assertGreater(top[1], 150, "top edge should face up (green > 128)")
        self.assertLess(bottom[1], 106, "bottom edge should face down (green < 128)")
        self.assertLess(left[0], 106, "left edge should face left (red < 128)")
        self.assertGreater(right[0], 150, "right edge should face right (red > 128)")

    def test_flip_green_inverts_only_green(self) -> None:
        gl = snm.normal_map(15, 15, disc(15, 6.5), luma=0)
        dx = snm.normal_map(15, 15, disc(15, 6.5), luma=0, flip_green=True)
        for y in range(15):
            for x in range(15):
                self.assertEqual(gl[y][x][0], dx[y][x][0])
                self.assertEqual(gl[y][x][2], dx[y][x][2])
                self.assertLessEqual(abs(gl[y][x][1] + dx[y][x][1] - 255), 1)

    def test_normals_are_unit_length(self) -> None:
        out = snm.normal_map(15, 15, disc(15, 6.5), luma=0.5)
        for row in out:
            for r, g, b, a in row:
                if a:
                    n = [(c / 255) * 2 - 1 for c in (r, g, b)]
                    self.assertAlmostEqual(sum(v * v for v in n), 1.0, delta=0.03)

    def test_frames_are_bevelled_separately(self) -> None:
        # Two opaque 8x8 frames side by side: without --frame the seam is interior and flat;
        # with --frame each frame gets its own right and left edges at the seam.
        sheet = square(16, 8)
        whole = snm.normal_map(16, 8, sheet, luma=0)
        framed = snm.normal_map(16, 8, sheet, frame=(8, 8), luma=0)
        self.assertEqual(whole[4][7][:3], (128, 128, 255))
        self.assertGreater(framed[4][7][0], 150, "frame 1's right edge faces right")
        self.assertLess(framed[4][8][0], 106, "frame 2's left edge faces left")

    def test_rejects_bad_frame_and_bevel(self) -> None:
        with self.assertRaisesRegex(ValueError, "whole number"):
            snm.normal_map(10, 8, square(10, 8), frame=(4, 8))
        with self.assertRaisesRegex(ValueError, "bevel"):
            snm.normal_map(4, 4, square(4, 4), bevel=0)


class CliTests(unittest.TestCase):
    def test_cli_writes_normal_map(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "s.png", Path(tmp) / "n.png"
            snm.write_png(src, 16, 8, square(16, 8))
            proc = subprocess.run(
                [sys.executable, str(SCRIPT), str(src), str(dst), "--frame", "8x8", "--flip-green"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("DirectX", proc.stdout)
            w, h, _ = snm.read_png(dst)
            self.assertEqual((w, h), (16, 8))

    def test_cli_reports_errors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "s.png"
            src.write_bytes(b"not a png")
            proc = subprocess.run(
                [sys.executable, str(SCRIPT), str(src), str(Path(tmp) / "n.png")],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn("not a PNG", proc.stderr)


if __name__ == "__main__":
    unittest.main()
