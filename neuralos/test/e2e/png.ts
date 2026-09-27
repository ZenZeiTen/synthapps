/**
 * Shrinks a screenshot PNG for the docs: decodes it (8-bit RGB or RGBA, not interlaced), reduces it to a 256-colour
 * palette by median cut over a 5-bit-per-channel histogram, dithers (Floyd-Steinberg) so the dark gradients do not band,
 * and writes an indexed PNG. Cuts the file to a fraction. Node built-ins only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function decode(file: Buffer): { w: number; h: number; rgb: Uint8Array } {
  if (!file.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let off = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (off < file.length) {
    const len = file.readUInt32BE(off);
    const type = file.toString("ascii", off + 4, off + 8);
    const data = file.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      rgb[(y * w + x) * 3] = cur[x * bpp];
      rgb[(y * w + x) * 3 + 1] = cur[x * bpp + 1];
      rgb[(y * w + x) * 3 + 2] = cur[x * bpp + 2];
    }
    prev.set(cur);
  }
  return { w, h, rgb };
}

/** Median cut over the 5-bit histogram; returns the palette and a bin -> palette index table. */
function palette(rgb: Uint8Array, colors: number): { pal: Uint8Array; lut: Uint8Array } {
  const hist = new Uint32Array(32768);
  /** Exact colour sums per bin, so palette entries are true averages rather than bin centres. */
  const sums = new Float64Array(32768 * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    const bin = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
    hist[bin]++;
    sums[bin * 3] += rgb[i];
    sums[bin * 3 + 1] += rgb[i + 1];
    sums[bin * 3 + 2] += rgb[i + 2];
  }
  const bins: number[] = [];
  for (let i = 0; i < 32768; i++) if (hist[i]) bins.push(i);
  const comp = (bin: number, ch: number) => (ch === 0 ? bin >> 10 : ch === 1 ? (bin >> 5) & 31 : bin & 31);
  let boxes: number[][] = [bins];
  while (boxes.length < colors) {
    // Split the box with the largest (range x population).
    let best = -1;
    let bestScore = 0;
    let bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      let pop = 0;
      const lo = [31, 31, 31];
      const hi = [0, 0, 0];
      for (const b of box) {
        pop += hist[b];
        for (let ch = 0; ch < 3; ch++) {
          const v = comp(b, ch);
          if (v < lo[ch]) lo[ch] = v;
          if (v > hi[ch]) hi[ch] = v;
        }
      }
      const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const ch = ranges.indexOf(Math.max(...ranges));
      const score = ranges[ch] * Math.sqrt(pop);
      if (score > bestScore) {
        bestScore = score;
        best = bi;
        bestCh = ch;
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => comp(a, bestCh) - comp(b, bestCh));
    let total = 0;
    for (const b of box) total += hist[b];
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += hist[box[i]];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  const pal = new Uint8Array(boxes.length * 3);
  const lut = new Uint8Array(32768);
  boxes.forEach((box, i) => {
    let n = 0;
    const sum = [0, 0, 0];
    for (const b of box) {
      const c = hist[b];
      n += c;
      for (let ch = 0; ch < 3; ch++) sum[ch] += sums[b * 3 + ch];
      lut[b] = i;
    }
    for (let ch = 0; ch < 3; ch++) pal[i * 3 + ch] = Math.round(sum[ch] / Math.max(1, n));
  });
  return { pal, lut };
}

function encode(w: number, h: number, pal: Uint8Array, idx: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w + 1);
    // Filter "up" suits large flat areas; fall back to none on the first row.
    raw[row] = y === 0 ? 0 : 2;
    for (let x = 0; x < w; x++) {
      const v = idx[y * w + x];
      raw[row + 1 + x] = y === 0 ? v : (v - idx[(y - 1) * w + x]) & 0xff;
    }
  }
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("PLTE", Buffer.from(pal)), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Nearest palette entry for every 5-bit bin (dithered colours land on bins the histogram never saw). */
function fullLut(pal: Uint8Array): Uint8Array {
  const n = pal.length / 3;
  const lut = new Uint8Array(32768);
  for (let bin = 0; bin < 32768; bin++) {
    const r = ((bin >> 10) << 3) + 4;
    const g = (((bin >> 5) & 31) << 3) + 4;
    const b = ((bin & 31) << 3) + 4;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dr = r - pal[i * 3];
      const dg = g - pal[i * 3 + 1];
      const db = b - pal[i * 3 + 2];
      const d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    lut[bin] = best;
  }
  return lut;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Rewrites `path` in place as a 256-colour PNG; returns the new size in bytes. An ordered (Bayer 4x4) dither of
 * `dither` levels hides banding in the gradients and, being periodic, still compresses well.
 */
export function shrinkPng(path: string, colors = 256, dither = 10): number {
  const { w, h, rgb } = decode(readFileSync(path));
  const { pal } = palette(rgb, colors);
  const lut = fullLut(pal);
  const idx = new Uint8Array(w * h);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const o = ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * dither;
      const r = clamp(rgb[p * 3] + o);
      const g = clamp(rgb[p * 3 + 1] + o);
      const b = clamp(rgb[p * 3 + 2] + o);
      idx[p] = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
    }
  }
  const out = encode(w, h, pal, idx);
  writeFileSync(path, out);
  return out.length;
}
