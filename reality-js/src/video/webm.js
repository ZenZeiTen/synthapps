// Minimal WebM (Matroska) writer for one video track.
//
// Frames come from WebCodecs (VP8 or VP9) with exact timestamps, so a video
// that took an hour to render still plays back at the right speed. That is
// the reason this exists instead of MediaRecorder, which stamps frames with
// wall-clock time.
//
// Layout: EBML header, Segment { Info, Tracks, Cluster* }. No Cues, so
// seeking in some players is slow, but every player tested plays it.

const enc = new TextEncoder();

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
}

function sizeBytes(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Array(len).fill(0);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('EBML element too large');
}

const concat = (parts) => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export const el = (id, ...payload) => {
  const body = concat(payload.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p))));
  return concat([Uint8Array.from(idBytes(id)), Uint8Array.from(sizeBytes(body.length)), body]);
};
export const uint = (id, n) => {
  const bytes = [];
  let v = n;
  do { bytes.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
  return el(id, bytes);
};
export const float = (id, x) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return el(id, b);
};
export const str = (id, s) => el(id, enc.encode(s));

export class WebMMuxer {
  constructor({ width, height, codec = 'V_VP9', fps = 24 }) {
    this.width = width;
    this.height = height;
    this.codec = codec;
    this.fps = fps;
    this.clusters = [];
    this.current = null; // { start, blocks: [] }
    this.lastTime = 0;
  }

  // data: encoded frame bytes, timeMs: presentation time in milliseconds.
  addFrame(data, timeMs, keyframe) {
    const t = Math.round(timeMs);
    if (!this.current || keyframe || t - this.current.start > 30000) {
      this.flushCluster();
      this.current = { start: t, blocks: [] };
    }
    const rel = t - this.current.start;
    const head = new Uint8Array(4);
    head[0] = 0x81; // track number 1 as a 1-byte vint
    new DataView(head.buffer).setInt16(1, rel);
    head[3] = keyframe ? 0x80 : 0;
    this.current.blocks.push(el(0xa3, head, data instanceof Uint8Array ? data : new Uint8Array(data)));
    this.lastTime = Math.max(this.lastTime, t);
  }

  flushCluster() {
    if (this.current && this.current.blocks.length) {
      this.clusters.push(el(0x1f43b675, uint(0xe7, this.current.start), ...this.current.blocks));
    }
    this.current = null;
  }

  // Returns the finished file as a Uint8Array.
  finish() {
    this.flushCluster();
    const header = el(0x1a45dfa3,
      uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8),
      str(0x4282, 'webm'), uint(0x4287, 2), uint(0x4285, 2));
    const info = el(0x1549a966,
      uint(0x2ad7b1, 1000000),
      str(0x4d80, 'reality.js'), str(0x5741, 'reality.js'),
      float(0x4489, this.lastTime + 1000 / this.fps));
    const tracks = el(0x1654ae6b, el(0xae,
      uint(0xd7, 1), uint(0x73c5, 1), uint(0x9c, 0), str(0x86, this.codec), uint(0x83, 1),
      uint(0x23e383, Math.round(1e9 / this.fps)),
      el(0xe0, uint(0xb0, this.width), uint(0xba, this.height))));
    const segment = el(0x18538067, info, tracks, ...this.clusters);
    return concat([header, segment]);
  }
}

// Read back the element tree (id, size, offset), for tests.
export function readEBML(bytes, start = 0, end = bytes.length, depth = 0, containers = new Set([0x1a45dfa3, 0x18538067, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675, 0x1549a966])) {
  const out = [];
  let p = start;
  while (p < end) {
    let len = 1;
    while (len <= 4 && !(bytes[p] & (0x80 >> (len - 1)))) len++;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + bytes[p + i];
    p += len;
    let sl = 1;
    while (sl <= 8 && !(bytes[p] & (0x80 >> (sl - 1)))) sl++;
    let size = bytes[p] & ((0xff >> sl));
    for (let i = 1; i < sl; i++) size = size * 256 + bytes[p + i];
    p += sl;
    const node = { id, size, offset: p };
    if (containers.has(id)) node.children = readEBML(bytes, p, p + size, depth + 1, containers);
    out.push(node);
    p += size;
  }
  return out;
}
