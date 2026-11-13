"""Small pixel-painting kit used by portraits.py.

Everything is flat colour and hard edges: a shape is rasterised at SS x size without
anti-aliasing, box-reduced, and thresholded at half coverage, so the result at 96x96
is a crisp 1-bit mask. Masks are numpy bool arrays; a Layer is an RGBA array that
masks are filled into. The working canvas has PAD pixels of margin on every side so
that a layer can be nudged (head bob per expression) without losing its edge; the
margin is cropped off when the layer is turned into an image.

Coordinates are in sprite pixels (floats). Pixel (x, y) covers [x, x+1) x [y, y+1).
"""
import math
import numpy as np
from PIL import Image, ImageDraw

W = H = 96
PAD = 12
WP, HP = W + 2 * PAD, H + 2 * PAD
SS = 6

# pixel-centre coordinates of the padded canvas, in sprite units
XX, YY = np.meshgrid(np.arange(WP) - PAD + 0.5, np.arange(HP) - PAD + 0.5)


def rgb(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def empty():
    return np.zeros((HP, WP), bool)


def _hi():
    im = Image.new("L", (WP * SS, HP * SS), 0)
    return im, ImageDraw.Draw(im)


def _lo(im):
    return np.asarray(im.reduce(SS)) >= 128


_XF = None     # (cos, sin, pivot x, pivot y, dx, dy): rotate about the pivot, then move


def set_xf(angle=0.0, pivot=(48.0, 60.0), dx=0.0, dy=0.0):
    """Rotate (degrees, clockwise on screen) and move everything drawn until reset_xf()."""
    global _XF
    a = math.radians(angle)
    _XF = (math.cos(a), math.sin(a), pivot[0], pivot[1], dx, dy)


def reset_xf():
    global _XF
    _XF = None


def xf(pts):
    if _XF is None:
        return [(float(x), float(y)) for x, y in pts]
    c, s, px, py, dx, dy = _XF
    return [(px + (x - px) * c - (y - py) * s + dx, py + (x - px) * s + (y - py) * c + dy) for x, y in pts]


def _h(pts):
    return [((x + PAD) * SS, (y + PAD) * SS) for x, y in xf(pts)]


def spline(pts, closed=True, n=10):
    """Catmull-Rom through pts."""
    out = []
    m = len(pts)
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        if closed:
            p0, p1, p2, p3 = pts[(i - 1) % m], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        else:
            p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, m - 1)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                       + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


def m_poly(pts):
    im, d = _hi()
    d.polygon(_h(pts), fill=255)
    return _lo(im)


def m_blob(pts, n=10):
    return m_poly(spline(pts, True, n))


def m_ellipse(cx, cy, rx, ry, rot=0.0):
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    pts = []
    for i in range(64):
        t = 2 * math.pi * i / 64
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * c - y * s, cy + x * s + y * c))
    return m_poly(pts)


def m_rect(x0, y0, x1, y1):
    return m_poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def m_stroke(pts, width, smooth=False):
    """Thick line (>= ~1.4 px) with round joints and caps."""
    if smooth:
        pts = spline(pts, False, 8)
    im, d = _hi()
    hp = _h(pts)
    d.line(hp, fill=255, width=max(1, int(round(width * SS))), joint="curve")
    r = width * SS / 2.0
    for x, y in (hp[0], hp[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return _lo(im)


def m_line(pts):
    """1 px line drawn straight on the pixel grid."""
    im = Image.new("L", (WP, HP), 0)
    d = ImageDraw.Draw(im)
    ip = [(int(math.floor(x)) + PAD, int(math.floor(y)) + PAD) for x, y in xf(pts)]
    if len(ip) == 1:
        d.point(ip, fill=255)
    else:
        d.line(ip, fill=255, width=1)
    return np.asarray(im) > 0


def m_curve(pts):
    return m_line(spline(pts, False, 8))


def m_px(*xy):
    m = empty()
    for x, y in xf(xy):
        xi, yi = int(math.floor(x)) + PAD, int(math.floor(y)) + PAD
        if 0 <= xi < WP and 0 <= yi < HP:
            m[yi, xi] = True
    return m


def m_superellipse(cx, cy, a, b, n=2.5):
    return (np.abs((XX - cx) / a) ** n + np.abs((YY - cy) / b) ** n) <= 1.0


def mirror(m):
    return m[:, ::-1].copy()


def mx(pts, cx=48.0):
    """Mirror a point list about the centre line (order reversed)."""
    return [(2 * cx - x, y) for x, y in reversed(pts)]


def sym(pts, cx=48.0):
    """Right-half outline (top to bottom) -> closed symmetric outline."""
    return list(pts) + mx(pts, cx)


def shift(m, dx, dy):
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    xs0, xs1 = max(0, -dx), min(w, w - dx)
    ys0, ys1 = max(0, -dy), min(h, h - dy)
    if xs0 < xs1 and ys0 < ys1:
        out[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx] = m[ys0:ys1, xs0:xs1]
    return out


def grow(m, diag=False):
    g = m | shift(m, 1, 0) | shift(m, -1, 0) | shift(m, 0, 1) | shift(m, 0, -1)
    if diag:
        g |= shift(m, 1, 1) | shift(m, -1, 1) | shift(m, 1, -1) | shift(m, -1, -1)
    return g


def shrink(m):
    return m & shift(m, 1, 0) & shift(m, -1, 0) & shift(m, 0, 1) & shift(m, 0, -1)


def rim(m, dx, dy):
    """Pixels of m on the side facing away from a light at (-dx, -dy)."""
    return m & ~shift(m, -dx, -dy)


def despeckle(m):
    """Drop pixels with no 4-neighbour, fill 1 px holes."""
    n = (shift(m, 1, 0).astype(int) + shift(m, -1, 0) + shift(m, 0, 1) + shift(m, 0, -1))
    m = m & (n > 0)
    return m | (~m & (n == 4))


class Layer:
    def __init__(self, name):
        self.name = name
        self.a = np.zeros((HP, WP, 4), np.uint8)

    def opaque(self):
        return self.a[..., 3] > 0

    def is_col(self, col):
        r, g, b = rgb(col)
        a = self.a
        return (a[..., 3] > 0) & (a[..., 0] == r) & (a[..., 1] == g) & (a[..., 2] == b)

    def fill(self, m, col, only=None):
        """only: None = anywhere, 'ink' = where already painted, or a colour / list of colours."""
        if only is not None:
            if only == "ink":
                m = m & self.opaque()
            else:
                cols = [only] if isinstance(only, str) else only
                k = empty()
                for c in cols:
                    k |= self.is_col(c)
                m = m & k
        self.a[m] = rgb(col) + (255,)
        return m

    def erase(self, m):
        self.a[m] = (0, 0, 0, 0)

    def outline(self, col, skip=None):
        m = self.opaque()
        e = grow(m) & ~m
        if skip is not None:
            e &= ~skip
        self.a[e] = rgb(col) + (255,)

    def clean(self):
        m = self.opaque()
        n = (shift(m, 1, 0).astype(int) + shift(m, -1, 0) + shift(m, 0, 1) + shift(m, 0, -1))
        self.a[m & (n == 0)] = (0, 0, 0, 0)

    def nudge(self, dx, dy):
        self.a = shift(self.a, dx, dy)

    def image(self):
        return Image.fromarray(self.a[PAD:PAD + H, PAD:PAD + W].copy(), "RGBA")
