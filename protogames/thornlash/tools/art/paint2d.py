"""2D part-based pixel painter used for Thornlash characters.

A frame is painted from shaded primitives (capsules, ellipses, polygons) into a per-pixel
buffer of (material, shade, part group, depth). Shading comes from a pseudo-normal per
primitive and a fixed light (upper left, toward the viewer), quantized to a 3-4 step ramp
per material. Two passes then make it read as hand-pixelled sprite art:
  * selective interior lines: where a nearer part overlaps a farther part of another
    group, the farther part's edge pixel takes that material's darkest tone;
  * a 1 px outer outline in a dark plum, never pure black.
Everything is deterministic, so a frame can be regenerated after any tweak.
"""
import math
from PIL import Image

LIGHT = (-0.55, -0.62, 0.56)
_l = math.sqrt(sum(c * c for c in LIGHT))
LIGHT = tuple(c / _l for c in LIGHT)


def hexrgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


class Frame:
    def __init__(self, w, h, materials, outline):
        self.w, self.h = w, h
        self.mat = materials          # name -> [dark, mid, light, (hilite)] hex
        self.outline = hexrgb(outline)
        self.buf = [[None] * w for _ in range(h)]   # (mat, level, group, z)
        self.over = {}                # (x,y) -> rgba painted details on top

    # ------------------------------------------------------------------ core put
    def _put(self, x, y, mat, level, group, z):
        if 0 <= x < self.w and 0 <= y < self.h:
            cur = self.buf[y][x]
            if cur is None or z >= cur[3]:
                self.buf[y][x] = (mat, level, group, z)

    def level_from_normal(self, nx, ny, mat, dim=0.0, bias=0.0):
        nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
        l = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
        l = 0.5 + 0.5 * l - dim + bias
        steps = len(self.mat[mat])
        if steps >= 4:
            cuts = (0.36, 0.62, 0.86)
        else:
            cuts = (0.47, 0.80, 9.0)
        lev = 0
        for c in cuts:
            if l >= c:
                lev += 1
        return min(lev, steps - 1)

    # ------------------------------------------------------------------ primitives
    def capsule(self, a, b, r0, r1, mat, group, z, dim=0.0, bias=0.0):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-6
        L = math.sqrt(L2)
        ux, uy = dx / L, dy / L
        rmax = max(r0, r1)
        for y in range(int(math.floor(min(ay, by) - rmax - 1)), int(math.ceil(max(ay, by) + rmax + 1))):
            for x in range(int(math.floor(min(ax, bx) - rmax - 1)), int(math.ceil(max(ax, bx) + rmax + 1))):
                px, py = x + 0.5, y + 0.5
                t = ((px - ax) * dx + (py - ay) * dy) / L2
                tc = min(1.0, max(0.0, t))
                cx, cy = ax + dx * tc, ay + dy * tc
                r = r0 + (r1 - r0) * tc
                ddx, ddy = px - cx, py - cy
                d = math.sqrt(ddx * ddx + ddy * ddy)
                if d <= r:
                    nx, ny = (ddx / r, ddy / r) if r > 0 else (0.0, 0.0)
                    self._put(x, y, mat, self.level_from_normal(nx, ny, mat, dim, bias), group, z)

    def ellipse(self, c, rx, ry, mat, group, z, dim=0.0, bias=0.0, angle=0.0):
        cx, cy = c
        ca, sa = math.cos(angle), math.sin(angle)
        R = max(rx, ry) + 1
        for y in range(int(math.floor(cy - R)), int(math.ceil(cy + R))):
            for x in range(int(math.floor(cx - R)), int(math.ceil(cx + R))):
                px, py = x + 0.5 - cx, y + 0.5 - cy
                lx = px * ca + py * sa
                ly = -px * sa + py * ca
                ex, ey = lx / rx, ly / ry
                if ex * ex + ey * ey <= 1.0:
                    nx = ex * ca - ey * sa
                    ny = ex * sa + ey * ca
                    self._put(x, y, mat, self.level_from_normal(nx * 0.95, ny * 0.95, mat, dim, bias), group, z)

    def poly(self, pts, mat, group, z, dim=0.0, bias=0.0, curve=0.8):
        """Filled polygon; shading treats it as a gently rounded slab across its width."""
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x0, x1 = int(math.floor(min(xs))), int(math.ceil(max(xs)))
        y0, y1 = int(math.floor(min(ys))), int(math.ceil(max(ys)))
        n = len(pts)
        for y in range(y0, y1 + 1):
            py = y + 0.5
            # scanline intersections
            xi = []
            for i in range(n):
                (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
                if (ay <= py < by) or (by <= py < ay):
                    xi.append(ax + (py - ay) * (bx - ax) / (by - ay))
            xi.sort()
            for k in range(0, len(xi) - 1, 2):
                left, right = xi[k], xi[k + 1]
                mid = (left + right) / 2
                half = max(0.5, (right - left) / 2)
                for x in range(int(math.floor(left)), int(math.ceil(right))):
                    px = x + 0.5
                    if left <= px < right:
                        nx = (px - mid) / half * curve
                        ny = ((py - y0) / max(1, (y1 - y0)) - 0.5) * 0.5
                        self._put(x, y, mat, self.level_from_normal(nx, ny, mat, dim, bias), group, z)

    def pixel(self, x, y, rgba_hex):
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < self.w and 0 <= yi < self.h:
            self.over[(xi, yi)] = hexrgb(rgba_hex) if isinstance(rgba_hex, str) else rgba_hex

    def tone(self, x, y, mat, level):
        """Set an existing pixel's shade (for folds, studs, rims) without changing depth."""
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < self.w and 0 <= yi < self.h and self.buf[yi][xi] is not None:
            m, l, g, z = self.buf[yi][xi]
            self.buf[yi][xi] = (mat, level, g, z)

    # ------------------------------------------------------------------ output
    def render(self, interior=True, outline=True):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        W, H = self.w, self.h
        col = [[None] * W for _ in range(H)]
        for y in range(H):
            for x in range(W):
                c = self.buf[y][x]
                if c is not None:
                    col[y][x] = hexrgb(self.mat[c[0]][c[1]])
        if interior:
            for y in range(H):
                for x in range(W):
                    c = self.buf[y][x]
                    if c is None:
                        continue
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < W and 0 <= ny < H:
                            o = self.buf[ny][nx]
                            if o is not None and o[2] != c[2] and o[3] > c[3] + 0.5:
                                col[y][x] = hexrgb(self.mat[c[0]][0]) if c[1] > 0 else self.outline
                                break
        for (x, y), v in self.over.items():
            if self.buf[y][x] is not None or True:
                col[y][x] = v
        if outline:
            out = []
            for y in range(H):
                for x in range(W):
                    if col[y][x] is None:
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < W and 0 <= ny < H and col[ny][nx] is not None and col[ny][nx] != self.outline:
                                out.append((x, y))
                                break
            for x, y in out:
                col[y][x] = self.outline
        for y in range(H):
            for x in range(W):
                if col[y][x] is not None:
                    img.putpixel((x, y), col[y][x])
        return img


def clean_orphans(img, outline_rgba):
    """Remove single interior pixels whose 4 neighbours all share one other colour."""
    W, H = img.size
    px = img.load()
    fixes = []
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            c = px[x, y]
            if c[3] == 0:
                continue
            ns = [px[x + 1, y], px[x - 1, y], px[x, y + 1], px[x, y - 1]]
            if all(n == ns[0] for n in ns) and ns[0] != c and ns[0][3] != 0 and c != outline_rgba:
                fixes.append((x, y, ns[0]))
    for x, y, c in fixes:
        px[x, y] = c
    return img
