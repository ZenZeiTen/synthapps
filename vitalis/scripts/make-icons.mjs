// Renders the app icon and splash screens to PNG: the PWA icons, the iOS
// home-screen icon, and the Android launcher icons and splash images.
// Uses the Chromium that Playwright drives. Run with `npm run icons`.
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is installed globally in some environments and locally in others.
const { chromium } = createRequire(import.meta.url)('playwright');

const INK = '#14233C';
const PAPER = '#F1F5F3';
const TRACE = 'M14 51.5h15.5l6.8-17.6 10 32.4 7.7-24.2 4.6 9.3H86';

/** The heart-rhythm trace, drawn in a 100x100 box scaled to `scale` and centred. */
const trace = (scale) =>
  `<g transform="translate(${50 - 50 * scale} ${50 - 50 * scale}) scale(${scale})"><path d="${TRACE}" fill="none" stroke="${PAPER}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"/></g>`;

const svgBox = (w, h, body, vw = 100, vh = 100) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}">${body}</svg>`;

/** A rounded ink tile with the trace, on a transparent background. */
const tile = (size) => svgBox(size, size, `<rect x="8" y="8" width="84" height="84" rx="24" fill="${INK}"/>${trace(0.84)}`);
/** Full-bleed ink square: the platform applies its own mask. */
const fullBleed = (size, scale = 0.56) => svgBox(size, size, `<rect width="100" height="100" fill="${INK}"/>${trace(scale)}`);
const round = (size) => svgBox(size, size, `<circle cx="50" cy="50" r="48" fill="${INK}"/>${trace(0.7)}`);
/** Android adaptive-icon foreground: transparent, mark inside the 66/108 safe zone. */
const foreground = (size) => svgBox(size, size, trace(0.5));

function splash(w, h, bg) {
  // Centred ink tile, a fifth of the short side.
  const s = Math.min(w, h) * 0.2;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  const k = s / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <g transform="translate(${x} ${y}) scale(${k})"><rect x="0" y="0" width="100" height="100" rx="28" fill="${INK}"/>${trace(0.84)}</g>
</svg>`;
}

const jobs = [
  { file: 'public/icons/icon-192.png', w: 192, svg: tile(192), transparent: true },
  { file: 'public/icons/icon-512.png', w: 512, svg: tile(512), transparent: true },
  { file: 'public/icons/icon-maskable-512.png', w: 512, svg: fullBleed(512) },
  { file: 'public/apple-touch-icon.png', w: 180, svg: fullBleed(180, 0.7) }
];

const RES = 'android/app/src/main/res';
if (existsSync(RES)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const launcher = Math.round(48 * k);
    const fg = Math.round(108 * k);
    jobs.push({ file: `${RES}/mipmap-${d}/ic_launcher.png`, w: launcher, svg: tile(launcher), transparent: true });
    jobs.push({ file: `${RES}/mipmap-${d}/ic_launcher_round.png`, w: launcher, svg: round(launcher), transparent: true });
    jobs.push({ file: `${RES}/mipmap-${d}/ic_launcher_foreground.png`, w: fg, svg: foreground(fg), transparent: true });
  }
  const port = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  for (const [d, [w, h]] of Object.entries(port)) {
    jobs.push({ file: `${RES}/drawable-port-${d}/splash.png`, w, h, svg: splash(w, h, PAPER) });
    jobs.push({ file: `${RES}/drawable-land-${d}/splash.png`, w: h, h: w, svg: splash(h, w, PAPER) });
  }
  jobs.push({ file: `${RES}/drawable/splash.png`, w: 480, h: 320, svg: splash(480, 320, PAPER) });
}

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const j of jobs) {
  const h = j.h ?? j.w;
  await page.setViewportSize({ width: j.w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${j.svg}</body></html>`);
  await page.locator('svg').screenshot({ path: j.file, omitBackground: !!j.transparent });
}
console.log(`wrote ${jobs.length} images`);
await browser.close();
