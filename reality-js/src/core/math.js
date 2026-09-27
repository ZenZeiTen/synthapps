// Small vector and matrix helpers. Vectors are plain arrays [x, y, z].
// Affine matrices are 12-number arrays, row-major 3x4:
//   [m00 m01 m02 tx,  m10 m11 m12 ty,  m20 m21 m22 tz]
// Angles are in degrees everywhere in reality.js (see LANGUAGE.md).

export const DEG = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.sqrt(dot(a, a));
export const normalize = (a) => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

// Rotation matrix (3x3, row-major) for Euler angles in degrees.
// Order matches three.js 'XYZ': R = Rx * Ry * Rz.
export function eulerToMat3(rx, ry, rz) {
  const a = rx * DEG, b = ry * DEG, c = rz * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cc = Math.cos(c), sc = Math.sin(c);
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}

// Rotation (3x3, row-major) that turns local +Y toward `dir`.
export function aimYMat3(dir) {
  const y = normalize(dir);
  const helper = Math.abs(y[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  const x = normalize(cross(helper, y));
  const z = cross(x, y);
  // Columns are the local axes expressed in world space.
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

// Build an affine matrix from position, 3x3 rotation and scale (vec3).
export function compose(position, rot3, scl) {
  const [sx, sy, sz] = scl;
  const r = rot3;
  return [
    r[0] * sx, r[1] * sy, r[2] * sz, position[0],
    r[3] * sx, r[4] * sy, r[5] * sz, position[1],
    r[6] * sx, r[7] * sy, r[8] * sz, position[2],
  ];
}

// a * b for 3x4 affine matrices.
export function multiply(a, b) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
      if (c === 3) v += a[r * 4 + 3];
      out[r * 4 + c] = v;
    }
  }
  return out;
}

export function invert(m) {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-20) throw new Error('matrix is not invertible (a scale is zero)');
  const s = 1 / det;
  const r00 = A * s, r01 = -(b * i - c * h) * s, r02 = (b * f - c * e) * s;
  const r10 = B * s, r11 = (a * i - c * g) * s, r12 = -(a * f - c * d) * s;
  const r20 = C * s, r21 = -(a * h - b * g) * s, r22 = (a * e - b * d) * s;
  return [
    r00, r01, r02, -(r00 * tx + r01 * ty + r02 * tz),
    r10, r11, r12, -(r10 * tx + r11 * ty + r12 * tz),
    r20, r21, r22, -(r20 * tx + r21 * ty + r22 * tz),
  ];
}

export const transformPoint = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

export const transformDir = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
];

export const column = (m, c) => [m[c], m[4 + c], m[8 + c]];
