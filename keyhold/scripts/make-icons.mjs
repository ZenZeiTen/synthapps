// Renders web/icons/*.png from the SVG icons (needs Playwright; only for changing the icon).
// Usage: node scripts/make-icons.mjs web/icons
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2];
const jobs = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['maskable.svg', 'maskable-512.png', 512], ['maskable.svg', 'apple-touch-icon.png', 180]];
const b = await chromium.launch();
const p = await b.newPage();
for (const [src, out, size] of jobs) {
  await p.setViewportSize({ width: size, height: size });
  const svg = readFileSync(`${dir}/${src}`, 'utf8');
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `${dir}/${out}`, omitBackground: true });
}
await b.close();
