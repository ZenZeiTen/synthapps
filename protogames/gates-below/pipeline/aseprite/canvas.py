"""A tiny indexed canvas for drawing pixel art in code. Pixels hold palette indices
(or None for transparent); to_rgba() converts for the .aseprite writer."""
from __future__ import annotations

import random

from palette import RGBA, N


class Canvas:
    def __init__(self, w: int, h: int, fill: int | None = None):
        self.w, self.h = w, h
        self.px: list[int | None] = [fill] * (w * h)

    # --- access -----------------------------------------------------------
    def get(self, x: int, y: int):
        return self.px[(y % self.h) * self.w + (x % self.w)]

    def set(self, x: int, y: int, c, wrap: bool = False):
        if isinstance(c, str):
            c = N[c]
        if wrap:
            x, y = x % self.w, y % self.h
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y * self.w + x] = c

    def copy(self) -> "Canvas":
        k = Canvas(self.w, self.h)
        k.px = list(self.px)
        return k

    # --- shapes -----------------------------------------------------------
    def rect(self, x0, y0, x1, y1, c, wrap=False):
        """Filled rectangle, inclusive corners."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c, wrap)

    def frame(self, x0, y0, x1, y1, c):
        for x in range(x0, x1 + 1):
            self.set(x, y0, c)
            self.set(x, y1, c)
        for y in range(y0, y1 + 1):
            self.set(x0, y, c)
            self.set(x1, y, c)

    def line(self, x0, y0, x1, y1, c):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    self.set(x, y, c)

    def blit(self, other: "Canvas", ox: int, oy: int):
        for y in range(other.h):
            for x in range(other.w):
                c = other.px[y * other.w + x]
                if c is not None:
                    self.set(ox + x, oy + y, c)

    def outline(self, c, diagonal=False):
        """1-px outline outside the opaque shape (never on top of it)."""
        src = list(self.px)
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diagonal:
            nb += [(1, 1), (-1, 1), (1, -1), (-1, -1)]
        for y in range(self.h):
            for x in range(self.w):
                if src[y * self.w + x] is not None:
                    continue
                for dx, dy in nb:
                    X, Y = x + dx, y + dy
                    if 0 <= X < self.w and 0 <= Y < self.h and src[Y * self.w + X] is not None:
                        self.px[y * self.w + x] = N[c] if isinstance(c, str) else c
                        break

    def flip_h(self) -> "Canvas":
        k = Canvas(self.w, self.h)
        for y in range(self.h):
            for x in range(self.w):
                k.px[y * self.w + x] = self.px[y * self.w + (self.w - 1 - x)]
        return k

    def to_rgba(self):
        return [RGBA[c] if c is not None else (0, 0, 0, 0) for c in self.px]


def rng(seed: str) -> random.Random:
    return random.Random(seed)


BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def dither(x: int, y: int, t: float) -> bool:
    """Ordered-dither test: True on about t (0..1) of pixels."""
    return (BAYER4[y % 4][x % 4] + 0.5) / 16.0 < t
