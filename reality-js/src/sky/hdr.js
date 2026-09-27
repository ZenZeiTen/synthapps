// Radiance HDR (.hdr, RGBE) reader. Supports flat and new-style RLE
// scanlines with the standard "-Y H +X W" orientation.

// `buffer`: an ArrayBuffer or a Uint8Array (a Node Buffer works too).
export function parseHDR(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let pos = 0;
  const readLine = () => {
    let s = '';
    while (pos < bytes.length && bytes[pos] !== 0x0a) s += String.fromCharCode(bytes[pos++]);
    pos++;
    return s;
  };
  const magic = readLine();
  if (!magic.startsWith('#?')) throw new Error('not a Radiance .hdr file');
  let format = null;
  for (;;) {
    const line = readLine();
    if (line === '') break;
    if (line.startsWith('FORMAT=')) format = line.slice(7);
    if (pos >= bytes.length) throw new Error('.hdr header has no end');
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`unsupported .hdr format ${format}`);
  const res = readLine().trim().split(/\s+/);
  if (res[0] !== '-Y' || res[2] !== '+X') throw new Error(`unsupported .hdr orientation "${res.join(' ')}"`);
  const height = +res[1], width = +res[3];

  const data = new Float32Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    const rle = width >= 8 && width < 32768 && bytes[pos] === 2 && bytes[pos + 1] === 2 && ((bytes[pos + 2] << 8) | bytes[pos + 3]) === width && !(bytes[pos + 2] & 0x80);
    if (rle) {
      pos += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = bytes[pos++];
          if (n > 128) {
            n -= 128;
            const v = bytes[pos++];
            for (let k = 0; k < n; k++) scan[(x++) * 4 + c] = v;
          } else {
            for (let k = 0; k < n; k++) scan[(x++) * 4 + c] = bytes[pos++];
          }
        }
      }
    } else {
      for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) scan[x * 4 + c] = bytes[pos++];
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0; // 2^(e-128) / 256
      const o = (y * width + x) * 4;
      data[o] = scan[x * 4] * f;
      data[o + 1] = scan[x * 4 + 1] * f;
      data[o + 2] = scan[x * 4 + 2] * f;
      data[o + 3] = 1;
    }
  }
  return { width, height, data };
}

// Encode float RGBA pixels as a flat (non-RLE) RGBE file. Used by tests and
// handy for saving renders as HDR.
export function encodeHDR({ width, height, data }) {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const out = new Uint8Array(header.length + width * height * 4);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  let p = header.length;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const m = Math.max(r, g, b);
    if (m < 1e-32) { p += 4; continue; }
    const e = Math.ceil(Math.log2(m) + 1e-9);
    const s = 256 / Math.pow(2, e);
    out[p++] = Math.min(255, Math.floor(r * s));
    out[p++] = Math.min(255, Math.floor(g * s));
    out[p++] = Math.min(255, Math.floor(b * s));
    out[p++] = e + 128;
  }
  return out.buffer;
}
