// Headless-browser checks for hd2d-forge/assets/hd2d-threejs.js.
//
//   node hd2d-threejs.check.mjs <fixtures-dir>
//
// <fixtures-dir> must hold sprite.png (colour) and sprite_n.png (normal map made by
// scripts/sprite_normalmap.py). tests/test_hd2d_threejs.py builds both and runs this file.
// Prints one JSON object: { ok, checks: [{ name, ok, detail }], errors: [...] }.
// Exit code 0 only when every check passes and the page logged no errors.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleFile = path.resolve(
  here,
  '../../plugins/gamedev-forge/skills/hd2d-forge/assets/hd2d-threejs.js',
);
const fixtures = path.resolve(process.argv[2] ?? '.');
const threeDir = path.join(here, 'node_modules/three');

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>
</head><body style="margin:0"><script type="module" src="/page.js"></script></body></html>`;

// Everything below runs in the browser.
const PAGE_JS = String.raw`
import * as THREE from 'three';
import * as HD2D from '/hd2d-threejs.js';

const W = 480, H = 320;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const loader = new THREE.TextureLoader();
const [colorTex, normalTex] = await Promise.all([
  loader.loadAsync('/fixtures/sprite.png'),
  loader.loadAsync('/fixtures/sprite_n.png'),
]);

function checker() {
  const n = 64, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = ((x >> 1) + (y >> 1)) % 2 ? 200 : 90;
    d.set([v, v, v, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(d, n, n);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const flatGround = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 1 });
const checkerGround = new THREE.MeshStandardMaterial({ map: checker(), roughness: 1 });

const ctx2d = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');

function build(o = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x203040);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), o.checker ? checkerGround : flatGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, o.ambient ?? 0.6));
  const key = HD2D.createKeyLight({ elevationDeg: 40, azimuthDeg: 135, intensity: o.keyIntensity ?? 3, extent: 8 });
  key.castShadow = o.shadows !== false;
  scene.add(key, key.target);
  const hero = HD2D.createSprite({
    map: colorTex, normalMap: o.normal === false ? null : normalTex,
    frameWidth: 32, frameHeight: 48, texel: 1 / 32,
    shadowProxy: o.proxy !== false, blob: o.blob === true,
    normalScale: o.normalScale ?? 1,
  });
  hero.group.visible = o.sprite !== false;
  scene.add(hero.group);
  if (o.pointAbove) {
    const p = new THREE.PointLight(0xffffff, 6, 0, 2);
    p.position.set(0, 3.2, 0.3);
    scene.add(p);
  }
  if (o.emissive) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8),
      new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffaa55, emissiveIntensity: 12 }));
    ball.position.set(1.2, 0.6, 0);
    scene.add(ball);
  }
  const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
  const rig = HD2D.createCameraRig(camera, { pitchDeg: 32, yawDeg: o.yaw ?? 45, distance: 8,
    target: new THREE.Vector3(0, 0.75, 0) });
  hero.update(camera, key);
  return { scene, camera, key, hero, rig };
}

function render(o = {}, postOptions = null) {
  const w = build(o);
  if (postOptions) {
    const post = HD2D.createDioramaPost(renderer, postOptions);
    post.render(w.scene, w.camera);
    post.dispose();
  } else {
    renderer.setRenderTarget(null);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(w.scene, w.camera);
  }
  ctx2d.clearRect(0, 0, W, H);
  ctx2d.drawImage(renderer.domElement, 0, 0);
  const img = ctx2d.getImageData(0, 0, W, H).data;
  return { img, camera: w.camera, key: w.key, hero: w.hero };
}

function toScreen(camera, v) {
  const p = v.clone().project(camera);
  return [Math.round((p.x * 0.5 + 0.5) * W), Math.round((1 - (p.y * 0.5 + 0.5)) * H)];
}
function lum(img, x, y, r = 1) {
  let s = 0, n = 0;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    const k = ((y + j) * W + (x + i)) * 4;
    s += 0.2126 * img[k] + 0.7152 * img[k + 1] + 0.0722 * img[k + 2]; n++;
  }
  return s / n;
}
function variance(img, x, y, r = 6) {
  const v = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) v.push(lum(img, x + i, y + j, 0));
  const m = v.reduce((a, b) => a + b) / v.length;
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
}
// Where the key light throws the shadow of the sprite's middle onto the ground.
function shadowPoint(key) {
  const dir = key.position.clone().sub(key.target.position).normalize();
  const mid = new THREE.Vector3(0, 0.6, 0);
  return mid.sub(dir.multiplyScalar(0.6 / dir.y));
}

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

// 1. Alpha test: the quad's empty corner shows the ground; the body does not.
{
  const a = render({}), b = render({ sprite: false });
  const body = toScreen(a.camera, new THREE.Vector3(0, 0.75, 0));
  const corner = toScreen(a.camera, new THREE.Vector3(0, 1.45, 0)); // above the head, inside the quad
  const dBody = Math.abs(lum(a.img, ...body) - lum(b.img, ...body));
  const dCorner = Math.abs(lum(a.img, ...corner) - lum(b.img, ...corner));
  check('alpha test cuts the sprite', dBody > 20 && dCorner < 2, { dBody, dCorner });
}

// 2. The sprite casts a shadow onto the ground. Camera yaw 45 and light azimuth 135 put the
//    shadow beside the sprite as seen from the camera, so the body does not hide it.
let shadowFacing;
{
  const a = render({}), b = render({ sprite: false });
  const sp = toScreen(a.camera, shadowPoint(a.key));
  shadowFacing = lum(b.img, ...sp, 2) - lum(a.img, ...sp, 2);
  check('sprite casts a shadow', shadowFacing > 15, { darkening: shadowFacing, at: sp });
}

// 3. Rotation gate: at camera yaw 45 the sprite (which faces the camera) is edge-on to a
//    light at azimuth 135. A sprite that casts its own shadow loses it; the proxy keeps it.
{
  const yaw = 45;
  const withProxy = render({ yaw }), plain = render({ yaw, proxy: false }), none = render({ yaw, sprite: false });
  const sp = toScreen(withProxy.camera, shadowPoint(withProxy.key));
  const dProxy = lum(none.img, ...sp, 2) - lum(withProxy.img, ...sp, 2);
  const dPlain = lum(none.img, ...sp, 2) - lum(plain.img, ...sp, 2);
  check('shadow proxy keeps shadow width under rotation', dProxy > 15 && dPlain < dProxy * 0.5,
    { dProxy, dPlain });
}

// 4. The blob decal darkens the ground under the feet with shadow maps off.
{
  const a = render({ blob: true, shadows: false }), b = render({ blob: false, shadows: false });
  const feet = toScreen(a.camera, new THREE.Vector3(0.08, 0.001, 0.08)); // just in front of the feet
  const d = lum(b.img, ...feet, 1) - lum(a.img, ...feet, 1);
  check('blob decal darkens the contact point', d > 8, { darkening: d, at: feet });
}

// 5. Normal map convention: with one light above, the top rim (normals up) is brighter than
//    the bottom rim; flipping green reverses that. Proves the script's OpenGL output matches.
{
  const o = { pointAbove: true, ambient: 0, keyIntensity: 0, shadows: false };
  const gl = render(o), flipped = render({ ...o, normalScale: -1 });
  // The fixture's body spans image rows 6-47 of 48; probe 1.5 rows inside each rim.
  const top = toScreen(gl.camera, new THREE.Vector3(0, (48 - 7.5) / 32, 0));
  const bottom = toScreen(gl.camera, new THREE.Vector3(0, (48 - 45.5) / 32, 0));
  const t = lum(gl.img, ...top, 1), b = lum(gl.img, ...bottom, 1);
  const tf = lum(flipped.img, ...top, 1), bf = lum(flipped.img, ...bottom, 1);
  check('normal map lights the top rim from above (green up)', t > b + 10 && tf < t, { top: t, bottom: b, topFlipped: tf, bottomFlipped: bf });
}

// 6. Depth of field blurs the far ground and leaves the focal plane sharp.
{
  const base = { checker: true };
  const sharp = render(base, { dof: false, bloom: false });
  const dof = render(base, { dof: true, bloom: false, focusDistance: 8, focusScale: 10, maxBlur: 10 });
  const far = toScreen(sharp.camera, new THREE.Vector3(-3, 0, -3)); // beyond the sprite
  const vSharp = variance(sharp.img, ...far), vDof = variance(dof.img, ...far);
  const body = toScreen(sharp.camera, new THREE.Vector3(0, 0.75, 0));
  const dBody = Math.abs(lum(sharp.img, ...body) - lum(dof.img, ...body));
  check('depth of field blurs the background, keeps focus sharp', vDof < vSharp * 0.5 && dBody < 12,
    { varianceSharp: vSharp, varianceDof: vDof, focusDelta: dBody });
}

// 7. Tilt-shift blurs the top of the frame even with depth blur off.
{
  const base = { checker: true };
  const flat = render(base, { dof: true, bloom: false, focusScale: 0, tiltShift: 0 });
  const tilt = render(base, { dof: true, bloom: false, focusScale: 0, tiltShift: 1, maxBlur: 10 });
  const x = W / 2, y = Math.round(H * 0.08);
  const vFlat = variance(flat.img, x, y), vTilt = variance(tilt.img, x, y);
  check('tilt-shift blurs the frame edge', vTilt < vFlat * 0.5, { varianceFlat: vFlat, varianceTilt: vTilt });
}

// 8. Bloom: an HDR emissive ball glows past its edge only with bloom on.
{
  const off = render({ emissive: true }, { dof: false, bloom: false });
  const on = render({ emissive: true }, { dof: false, bloom: true, bloomStrength: 1.2 });
  const c = toScreen(off.camera, new THREE.Vector3(1.2, 0.6, 0));
  const ring = [c[0] + 14, c[1]];
  const d = lum(on.img, ...ring, 1) - lum(off.img, ...ring, 1);
  check('bloom glows around HDR highlights', d > 6, { glow: d, at: ring });
}

// 9. Reduced-effects path (dof and bloom off) still produces a complete, opaque frame.
{
  const plain = render({}, { dof: false, bloom: false });
  let max = 0;
  for (let i = 0; i < plain.img.length; i += 4) max = Math.max(max, plain.img[i + 3]);
  check('post chain writes an opaque frame', max === 255, { maxAlpha: max });
}

// Leave a full-chain frame on the canvas for an optional screenshot (HD2D_SHOT=path).
render({ checker: true, blob: true, emissive: true },
  { focusDistance: 8, focusScale: 6, maxBlur: 8, tiltShift: 0.6, bloomStrength: 0.8 });
renderer.domElement.style.display = 'block';

window.__result = { checks, renderer: renderer.getContext().getParameter(renderer.getContext().VERSION) };
`;

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body = null;
  let file = null;
  if (url === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (url === '/' || url === '/index.html') body = PAGE;
  else if (url === '/page.js') body = PAGE_JS;
  else if (url === '/hd2d-threejs.js') file = moduleFile;
  else if (url.startsWith('/three/')) file = path.join(threeDir, url.slice('/three/'.length));
  else if (url.startsWith('/fixtures/')) file = path.join(fixtures, path.basename(url));
  if (file && fs.existsSync(file)) body = fs.readFileSync(file);
  if (body === null) {
    res.writeHead(404).end();
    return;
  }
  const type = url === '/' ? 'text/html' : types[path.extname(url)] ?? 'text/html';
  res.writeHead(200, { 'content-type': type }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
let result = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /THREE|shader|hd2d/i.test(m.text()))) {
      errors.push(`console.${m.type()}: ${m.text().slice(0, 500)}`);
    }
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__result || window.__failed, null, { timeout: 180000 });
  result = await page.evaluate(() => window.__result);
  if (process.env.HD2D_SHOT) await page.locator('canvas').screenshot({ path: process.env.HD2D_SHOT });
} catch (e) {
  errors.push(`runner: ${e.message}`);
} finally {
  await browser.close();
  server.close();
}

const checks = result?.checks ?? [];
const ok = errors.length === 0 && checks.length > 0 && checks.every((c) => c.ok);
console.log(JSON.stringify({ ok, renderer: result?.renderer, checks, errors }, null, 2));
process.exit(ok ? 0 : 1);
