// Bounding volume hierarchy over triangles, built with the surface area
// heuristic (binned), flattened for the GPU.
//
// Node layout, 8 floats (two RGBA texels):
//   [minX, minY, minZ, a,  maxX, maxY, maxZ, count]
//   count > 0: leaf; triangles a .. a+count-1 (in the reordered list)
//   count = 0: interior; children are nodes a and a+1
//
// The shader in render/shaders.js walks exactly this layout, and
// tests/bvh.test.js walks it on the CPU to check it.

const BINS = 12;
const LEAF_SIZE = 4;
const MAX_DEPTH = 48;

export function buildBVH(positions) {
  const n = positions.length / 9;
  const cent = new Float32Array(n * 3);
  const bmin = new Float32Array(n * 3);
  const bmax = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v0 = positions[i * 9 + a], v1 = positions[i * 9 + 3 + a], v2 = positions[i * 9 + 6 + a];
      const lo = Math.min(v0, v1, v2), hi = Math.max(v0, v1, v2);
      bmin[i * 3 + a] = lo; bmax[i * 3 + a] = hi;
      cent[i * 3 + a] = (lo + hi) * 0.5;
    }
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  const nodes = []; // flat numbers, 8 per node
  const pushNode = () => { nodes.push(0, 0, 0, 0, 0, 0, 0, 0); return nodes.length / 8 - 1; };

  const bounds = (start, end) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = start; k < end; k++) {
      const i = order[k];
      for (let a = 0; a < 3; a++) {
        b[a] = Math.min(b[a], bmin[i * 3 + a]); b[3 + a] = Math.max(b[3 + a], bmax[i * 3 + a]);
        c[a] = Math.min(c[a], cent[i * 3 + a]); c[3 + a] = Math.max(c[3 + a], cent[i * 3 + a]);
      }
    }
    return { b, c };
  };
  const area = (b) => {
    const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
    return dx < 0 ? 0 : 2 * (dx * dy + dy * dz + dz * dx);
  };

  const root = pushNode();
  const stack = [[root, 0, n, 0]];
  while (stack.length) {
    const [node, start, end, depth] = stack.pop();
    const { b, c } = bounds(start, end);
    const o = node * 8;
    nodes[o] = b[0]; nodes[o + 1] = b[1]; nodes[o + 2] = b[2];
    nodes[o + 4] = b[3]; nodes[o + 5] = b[4]; nodes[o + 6] = b[5];
    const count = end - start;

    let split = -1, axis = -1;
    if (count > LEAF_SIZE && depth < MAX_DEPTH) {
      let bestCost = area(b) * count; // cost of not splitting
      for (let a = 0; a < 3; a++) {
        const lo = c[a], hi = c[3 + a];
        if (hi - lo < 1e-12) continue;
        const binB = Array.from({ length: BINS }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        const binN = new Int32Array(BINS);
        const k = BINS / (hi - lo);
        for (let s = start; s < end; s++) {
          const i = order[s];
          const bi = Math.min(BINS - 1, Math.floor((cent[i * 3 + a] - lo) * k));
          binN[bi]++;
          const bb = binB[bi];
          for (let q = 0; q < 3; q++) {
            bb[q] = Math.min(bb[q], bmin[i * 3 + q]); bb[3 + q] = Math.max(bb[3 + q], bmax[i * 3 + q]);
          }
        }
        // Sweep from both sides to get the cost of each split plane.
        const leftA = new Float64Array(BINS), leftN = new Int32Array(BINS);
        let acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], accN = 0;
        for (let i = 0; i < BINS - 1; i++) {
          acc = merge(acc, binB[i]); accN += binN[i];
          leftA[i] = area(acc); leftN[i] = accN;
        }
        acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; accN = 0;
        for (let i = BINS - 1; i > 0; i--) {
          acc = merge(acc, binB[i]); accN += binN[i];
          const cost = leftA[i - 1] * leftN[i - 1] + area(acc) * accN;
          if (leftN[i - 1] > 0 && accN > 0 && cost < bestCost) {
            bestCost = cost; axis = a; split = lo + i / k;
          }
        }
      }
    }

    let mid = -1;
    if (axis >= 0) {
      // Partition order[start..end) around the split plane.
      let i = start, j = end - 1;
      while (i <= j) {
        if (cent[order[i] * 3 + axis] < split) i++;
        else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
      }
      mid = i;
      if (mid === start || mid === end) mid = -1;
    }
    if (mid < 0 && count > LEAF_SIZE * 8 && depth < MAX_DEPTH) {
      // SAH found nothing useful but the leaf would be huge (many identical
      // centroids): split in the middle of the list.
      mid = (start + end) >> 1;
    }

    if (mid < 0) {
      nodes[o + 3] = start;
      nodes[o + 7] = count;
    } else {
      const left = pushNode();
      pushNode();
      nodes[o + 3] = left;
      nodes[o + 7] = 0;
      stack.push([left, start, mid, depth + 1], [left + 1, mid, end, depth + 1]);
    }
  }
  return { nodes: new Float32Array(nodes), order };
}

function merge(a, b) {
  return [
    Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]),
    Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]),
  ];
}

// CPU reference traversal, used by tests to check the flattened layout.
// Returns { t, tri } for the closest hit, tri indexing the reordered list.
export function intersectBVH(bvh, triPositions, ro, rd, tMax = Infinity) {
  const { nodes } = bvh;
  const inv = rd.map((d) => 1 / d);
  let best = { t: tMax, tri: -1 };
  const stack = [0];
  while (stack.length) {
    const ni = stack.pop();
    const o = ni * 8;
    let t0 = 0, t1 = best.t;
    for (let a = 0; a < 3; a++) {
      let ta = (nodes[o + a] - ro[a]) * inv[a], tb = (nodes[o + 4 + a] - ro[a]) * inv[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 > t1) continue;
    const count = nodes[o + 7], a = nodes[o + 3];
    if (count > 0) {
      for (let k = a; k < a + count; k++) {
        const t = intersectTri(triPositions, k, ro, rd);
        if (t > 1e-7 && t < best.t) best = { t, tri: k };
      }
    } else {
      stack.push(a, a + 1);
    }
  }
  return best;
}

export function intersectTri(p, k, ro, rd) {
  const o = k * 9;
  const e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]];
  const e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
  const pv = [rd[1] * e2[2] - rd[2] * e2[1], rd[2] * e2[0] - rd[0] * e2[2], rd[0] * e2[1] - rd[1] * e2[0]];
  const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
  if (Math.abs(det) < 1e-12) return -1;
  const id = 1 / det;
  const tv = [ro[0] - p[o], ro[1] - p[o + 1], ro[2] - p[o + 2]];
  const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * id;
  if (u < 0 || u > 1) return -1;
  const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
  const v = (rd[0] * q[0] + rd[1] * q[1] + rd[2] * q[2]) * id;
  if (v < 0 || u + v > 1) return -1;
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
}
