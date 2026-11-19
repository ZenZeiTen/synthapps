"""Shared helpers for the art scripts: turn drawn canvases into .aseprite sources that
match the manifest (pipeline/manifest.py).

    from sheet import save_sprite, save_tiles
    save_sprite("heart", [c0, c1, c2])            # frames in manifest tag order
    save_tiles("moss", canvas_256x96)

Both assert the manifest's sizes and frame counts, so a drawing that breaks the contract
fails when the art is built, not when the game runs.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import asefile as A  # noqa: E402
from canvas import Canvas  # noqa: E402
from manifest import SPRITES, TILE_COLS, TILE_ROWS  # noqa: E402
from palette import RGBA  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art", "aseprite")


def tag_ranges(name: str) -> list[tuple[str, int, int]]:
    out, i = [], 0
    for tag, n in SPRITES[name][4]:
        out.append((tag, i, i + n - 1))
        i += n
    return out


def save_sprite(name: str, frames: list[Canvas], durations: list[int] | None = None) -> str:
    w, h, _org, _src, tags = SPRITES[name]
    want = sum(n for _, n in tags)
    assert len(frames) == want, f"{name}: {len(frames)} frames, manifest wants {want}"
    for i, c in enumerate(frames):
        assert (c.w, c.h) == (w, h), f"{name} frame {i}: {c.w}x{c.h}, manifest wants {w}x{h}"
    durations = durations or [100] * len(frames)
    spr = A.Sprite(w, h, [A.Frame([c.to_rgba()], d) for c, d in zip(frames, durations)],
                   ["art"], list(RGBA), tag_ranges(name))
    os.makedirs(ART, exist_ok=True)
    path = os.path.join(ART, name + ".aseprite")
    A.write(path, spr)
    return path


def save_tiles(theme: str, sheet: Canvas) -> str:
    w, h = TILE_COLS * 16, TILE_ROWS * 16
    assert (sheet.w, sheet.h) == (w, h), f"tiles {theme}: {sheet.w}x{sheet.h}, want {w}x{h}"
    spr = A.Sprite(w, h, [A.Frame([sheet.to_rgba()], 100)], ["tiles"], list(RGBA), [])
    os.makedirs(ART, exist_ok=True)
    path = os.path.join(ART, "tiles_" + theme + ".aseprite")
    A.write(path, spr)
    return path
