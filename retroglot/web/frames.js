// Turning emulator screenshots into what translation needs: pixels, a hash for
// the cache, an enlarged PNG for Claude, and a cheap way to tell whether the
// text on screen has changed.

/** Decode PNG bytes into ImageData. */
export async function decodePng(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** SHA-256 of the pixels (not the PNG bytes), as hex. */
export async function hashPixels(img) {
  const head = new Uint32Array([img.width, img.height]);
  const buf = new Uint8Array(8 + img.data.length);
  buf.set(new Uint8Array(head.buffer), 0);
  buf.set(img.data, 8);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

/** Integer scale so small retro frames reach about 1000 px on the long side (sharp pixels help reading). */
export function upscaleFactor(width, height, target = 1000) {
  return Math.max(1, Math.min(4, Math.floor(target / Math.max(width, height))));
}

/** Enlarge without smoothing and return base64 PNG (no data: prefix). */
export async function enlargedPngBase64(img) {
  const k = upscaleFactor(img.width, img.height);
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext('2d').putImageData(img, 0, 0);
  const out = new OffscreenCanvas(img.width * k, img.height * k);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  const blob = await out.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), width: out.width, height: out.height, scale: k };
}

/** Shrink to a fixed grid of brightness values (one byte per cell). */
export function signature(img, cols = 96, rows = 72) {
  const out = new Uint8Array(cols * rows);
  const { width: w, height: h, data } = img;
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / cols));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * w + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          n++;
        }
      }
      out[gy * cols + gx] = n ? sum / n : 0;
    }
  }
  return out;
}

/** Fraction of cells whose brightness changed noticeably between two signatures (0..1). */
export function changed(a, b, threshold = 18) {
  if (!a || !b || a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) n++;
  return n / a.length;
}

/**
 * Map the sensitivity setting (0..1) to the share of cells that must change
 * before a screen counts as new: 0 -> 6 %, 1 -> 0.3 %.
 */
export function changeThreshold(sensitivity) {
  const s = Math.min(1, Math.max(0, Number(sensitivity) || 0));
  return 0.06 * Math.pow(0.05, s);
}
