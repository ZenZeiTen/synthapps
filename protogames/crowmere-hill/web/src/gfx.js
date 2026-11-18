// Software framebuffer: everything draws into one 320x200 buffer of EGA colours,
// which is scaled up crisply by CSS. Keeps the output pixel-exact on every browser.

export const SCREEN_W = 320, SCREEN_H = 200;
export const PIC_Y = 10, PIC_W = 320, PIC_H = 168;   // picture area (rooms)
export const INPUT_Y = 184;

export const EGA = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170], [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255], [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
];
// ImageData's Uint32 view is little-endian ABGR
export const C32 = EGA.map(([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
export const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));

// Decode an <img> into pixel arrays. Opaque pixels keep their exact RGB.
export function toPixels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const u32 = new Uint32Array(data.buffer.slice(0));
  const a = new Uint8Array(img.width * img.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
  return { w: img.width, h: img.height, u32, a, rgba: data };
}

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.px = new Uint32Array(this.img.data.buffer);
  }
  clear(c = 0) { this.px.fill(C32[c]); }
  rect(x, y, w, h, c) {
    const col = C32[c];
    for (let j = Math.max(0, y); j < Math.min(SCREEN_H, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(SCREEN_W, x + w); i++) this.px[j * SCREEN_W + i] = col;
    }
  }
  pset(x, y, c) { if (x >= 0 && y >= 0 && x < SCREEN_W && y < SCREEN_H) this.px[y * SCREEN_W + x] = C32[c]; }
  // opaque full image at (x, y); used for room backgrounds
  blitOpaque(p, x, y) {
    for (let j = 0; j < p.h; j++) {
      const sy = y + j;
      if (sy < 0 || sy >= SCREEN_H) continue;
      this.px.set(p.u32.subarray(j * p.w, j * p.w + Math.min(p.w, SCREEN_W - x)), sy * SCREEN_W + x);
    }
  }
  // alpha-keyed region blit; `test(px, py)` may veto individual pixels (depth)
  blit(p, sx, sy, w, h, dx, dy, flip = false, test = null) {
    for (let j = 0; j < h; j++) {
      const ty = dy + j;
      if (ty < 0 || ty >= SCREEN_H) continue;
      for (let i = 0; i < w; i++) {
        const tx = dx + i;
        if (tx < 0 || tx >= SCREEN_W) continue;
        const si = (sy + j) * p.w + sx + (flip ? w - 1 - i : i);
        if (p.a[si] < 128) continue;
        if (test && !test(tx, ty)) continue;
        this.px[ty * SCREEN_W + tx] = p.u32[si];
      }
    }
  }
  present() { this.ctx.putImageData(this.img, 0, 0); }
}

// Bitmap font from the Aseprite-built sheet (white glyphs on transparent).
export class Font {
  constructor(pix, meta) {
    this.cw = meta.cell[0]; this.ch = meta.cell[1];
    this.glyphs = {};
    for (let code = meta.first; code <= meta.last; code++) {
      const i = code - meta.first, gx = (i % meta.cols) * this.cw, gy = Math.floor(i / meta.cols) * this.ch;
      const pts = [];
      for (let y = 0; y < this.ch; y++) for (let x = 0; x < this.cw; x++) if (pix.a[(gy + y) * pix.w + gx + x] > 127) pts.push(x, y);
      this.glyphs[code] = pts;
    }
  }
  draw(screen, text, x, y, color) {
    const col = C32[color];
    for (let k = 0; k < text.length; k++) {
      const pts = this.glyphs[text.charCodeAt(k)] || this.glyphs[63];
      for (let p = 0; p < pts.length; p += 2) {
        const px = x + k * this.cw + pts[p], py = y + pts[p + 1];
        if (px >= 0 && py >= 0 && px < SCREEN_W && py < SCREEN_H) screen.px[py * SCREEN_W + px] = col;
      }
    }
  }
  // double-size text for titles
  draw2x(screen, text, x, y, color) {
    for (let k = 0; k < text.length; k++) {
      const pts = this.glyphs[text.charCodeAt(k)] || this.glyphs[63];
      for (let p = 0; p < pts.length; p += 2) screen.rect(x + (k * this.cw + pts[p]) * 2, y + pts[p + 1] * 2, 2, 2, color);
    }
  }
  width(text) { return text.length * this.cw; }
}

export function wrap(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length === 0) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
