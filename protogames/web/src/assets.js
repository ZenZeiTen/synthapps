// Loads the engine-agnostic content package (content/) either over HTTP (dev) or
// from window.__BUNDLE__ (the single-file build made by tools/bundle_web.mjs).

import { toPixels } from './gfx.js';

const BASE = '../content/';

function bundled(path) {
  const b = window.__BUNDLE__;
  return b && Object.prototype.hasOwnProperty.call(b, path) ? b[path] : undefined;
}

async function getJSON(path, optional = false) {
  const b = bundled(path);
  if (b !== undefined) return b;
  if (window.__BUNDLE__) { if (optional) return null; throw new Error('missing ' + path); }
  const res = await fetch(BASE + path);
  if (!res.ok) { if (optional) return null; throw new Error(`load ${path}: HTTP ${res.status}`); }
  return res.json();
}

function getImage(path, optional = false) {
  return new Promise((resolve, reject) => {
    const b = bundled(path);
    if (b === null || (b === undefined && window.__BUNDLE__)) { if (optional) return resolve(null); return reject(new Error('missing ' + path)); }
    const img = new Image();
    img.onload = () => resolve(toPixels(img));
    img.onerror = () => (optional ? resolve(null) : reject(new Error('load ' + path)));
    img.src = b !== undefined ? b : BASE + path;
  });
}

export async function loadAll(onProgress = () => {}) {
  const game = await getJSON('game.json');
  const anims = await getJSON('sprites/anims.json');
  const fontMeta = await getJSON('font/font.json');
  const font = await getImage('font/font.png');
  onProgress('sprites');
  const sprites = {};
  for (const name of Object.keys(anims)) {
    const sheet = await getImage(`sprites/${name}.png`);
    const side = await getJSON(`sprites/${name}.json`);
    const frames = Array.isArray(side.frames) ? side.frames : Object.values(side.frames);
    sprites[name] = { ...anims[name], sheet, rects: frames.map((f) => f.frame) };
  }
  onProgress('rooms');
  const rooms = {};
  const roomData = {};
  for (const id of Object.keys(game.rooms)) {
    const r = await getJSON(`rooms/${id}/room.json`, true);
    roomData[id] = r;
    if (!r || r.provisional) { rooms[id] = { id, data: r, bg: null }; continue; }
    const bg = await getImage(`rooms/${id}/${r.bg}`, true);
    const depth = await getImage(`rooms/${id}/${r.depth}`, true);
    const n = r.size[0] * r.size[1];
    const scene = new Uint8Array(n), floor = new Uint8Array(n);
    if (depth) for (let i = 0; i < n; i++) { scene[i] = depth.rgba[i * 4]; floor[i] = depth.rgba[i * 4 + 1]; }
    const overlays = {};
    for (const [oid, o] of Object.entries(r.overlays || {})) {
      if (o.img) overlays[oid] = { ...o, pix: await getImage(`rooms/${id}/${o.img}`, true) };
      else overlays[oid] = o;
    }
    const extra = {};
    for (const name of r.extra || []) extra[name] = await getImage(`rooms/${id}/${name}.png`, true);
    rooms[id] = { id, data: r, bg, sceneDepth: depth ? scene : null, floorDepth: depth ? floor : null, overlays, extra };
  }
  const sfx = await getJSON('sfx/sfx.json', true);
  const music = await getJSON('music/music.json', true);
  return { game, sprites, font, fontMeta, rooms, roomData, sfx: sfx || {}, music };
}
