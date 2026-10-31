// Box art, title screens and in-game snaps from the libretro thumbnail collection
// (https://github.com/libretro-thumbnails), the same pictures RetroArch shows.
// Pictures are matched by No-Intro style game name and kept in the data folder,
// so each one is downloaded once.

import fs from 'node:fs';
import path from 'node:path';
import { extOf, regionFromFile } from './systems.js';

export const ART_KINDS = { boxart: 'Named_Boxarts', snap: 'Named_Snaps', title: 'Named_Titles' };

/** libretro playlist names per system; some depend on the file extension. */
export function libretroSystem(system, fileName = '') {
  const ext = extOf(fileName);
  const table = {
    dos: 'DOS',
    nes: 'Nintendo - Nintendo Entertainment System',
    snes: 'Nintendo - Super Nintendo Entertainment System',
    n64: 'Nintendo - Nintendo 64',
    gb: ext === 'gbc' ? 'Nintendo - Game Boy Color' : 'Nintendo - Game Boy',
    gba: 'Nintendo - Game Boy Advance',
    vb: 'Nintendo - Virtual Boy',
    segaMS: 'Sega - Master System - Mark III',
    segaMD: 'Sega - Mega Drive - Genesis',
    segaGG: 'Sega - Game Gear',
    segaCD: 'Sega - Mega-CD - Sega CD',
    sega32x: 'Sega - 32X',
    segaSaturn: 'Sega - Saturn',
    pce: 'NEC - PC Engine - TurboGrafx 16',
    ngp: ext === 'ngc' ? 'SNK - Neo Geo Pocket Color' : 'SNK - Neo Geo Pocket',
    ws: ext === 'wsc' ? 'Bandai - WonderSwan Color' : 'Bandai - WonderSwan',
    lynx: 'Atari - Lynx',
    jaguar: 'Atari - Jaguar',
    '3do': 'The 3DO Company - 3DO',
    psx: 'Sony - PlayStation',
    arcade: 'FBNeo - Arcade Games',
    amiga: 'Commodore - Amiga',
    c64: 'Commodore - 64',
    atari2600: 'Atari - 2600',
    atari7800: 'Atari - 7800',
  };
  return table[system] || null;
}

/** libretro replaces these characters with "_" in thumbnail file names. */
export function thumbnailName(name) {
  return String(name).replace(/[&*/:`<>?\\|"]/g, '_');
}

const GOODTOOLS = { J: 'Japan', U: 'USA', E: 'Europe', UE: 'USA, Europe', JU: 'Japan, USA', W: 'World', K: 'Korea', F: 'France', G: 'Germany', S: 'Spain', B: 'Brazil' };
const REGION_TAGS = { JP: ['(Japan)', '(Japan, USA)'], US: ['(USA)', '(USA, Europe)', '(World)'], EU: ['(Europe)', '(USA, Europe)'], KR: ['(Korea)'], CN: ['(China)'] };

/** Names to try, most likely first: the file name as is, then cleaned-up variants with region tags. */
export function candidateNames(game) {
  const stem = game.fileName.replace(/\.[^.]+$/, '');
  const noBrackets = stem.replace(/\s*\[[^\]]*\]/g, '').trim();
  // GoodTools short tags (J), (U), (E) become No-Intro region names.
  const noIntro = noBrackets.replace(/\(([A-Z]{1,2})\)/g, (m, t) => (GOODTOOLS[t] ? `(${GOODTOOLS[t]})` : m)).replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const bare = noIntro.replace(/\s*\([^)]*\)/g, '').trim();
  const titleBare = String(game.title || '').replace(/\s*\([^)]*\)/g, '').trim();
  const region = game.region || regionFromFile(game.fileName);
  const tags = REGION_TAGS[region] || ['(USA)', '(Japan)', '(Europe)', '(World)', '(USA, Europe)'];
  const out = [stem, noBrackets, noIntro];
  // Keep only the region part of the tags: "(Japan) (Rev 1) (Demo)" -> "(Japan)".
  const firstTag = /\((Japan|USA|Europe|World|Korea|China)[^)]*\)/.exec(noIntro);
  if (firstTag) out.push(`${bare} ${firstTag[0]}`);
  for (const base of [bare, titleBare]) for (const t of tags) if (base) out.push(`${base} ${t}`);
  out.push(bare, titleBare);
  return [...new Set(out.filter(Boolean).map(thumbnailName))].slice(0, 10);
}

export function thumbnailUrls(system, kind, name) {
  const dir = ART_KINDS[kind];
  const enc = encodeURIComponent(name);
  return [
    `https://raw.githubusercontent.com/libretro-thumbnails/${system.replace(/ /g, '_')}/master/${dir}/${enc}.png`,
    `https://thumbnails.libretro.com/${encodeURIComponent(system)}/${dir}/${enc}.png`,
  ];
}

const isPng = (b) => b.length > 8 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const imageType = (b) => (isPng(b) ? 'image/png' : isJpeg(b) ? 'image/jpeg' : null);

const RETRY_AFTER_MS = 14 * 24 * 3600 * 1000;

export class ArtLibrary {
  constructor(dir, { fetch = globalThis.fetch } = {}) {
    this.dir = dir;
    this.fetch = fetch;
    this.indexFile = path.join(dir, 'index.json');
    fs.mkdirSync(dir, { recursive: true });
    try { this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { this.index = {}; }
    this.inflight = new Map();
    this.active = 0;
    this.queue = [];
  }

  /** At most four downloads at once, so a big library does not flood the network. */
  async slot(fn) {
    if (this.active >= 4) await new Promise((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }

  file(id, kind) {
    return path.join(this.dir, `${id}-${kind}`);
  }

  has(id, kind) {
    return fs.existsSync(this.file(id, kind));
  }

  available(id) {
    return Object.fromEntries(Object.keys(ART_KINDS).map((k) => [k, this.has(id, k)]));
  }

  saveIndex() {
    const tmp = `${this.indexFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.index));
    fs.renameSync(tmp, this.indexFile);
  }

  /** Store a picture the player chose. */
  put(id, kind, bytes) {
    if (!ART_KINDS[kind]) throw new Error(`Unknown picture kind: ${kind}`);
    if (!imageType(bytes)) throw new Error('The picture must be a PNG or JPEG file');
    fs.writeFileSync(this.file(id, kind), bytes);
    this.index[`${id}-${kind}`] = { source: 'user', at: Date.now() };
    this.saveIndex();
  }

  remove(id, kind) {
    fs.rmSync(this.file(id, kind), { force: true });
    delete this.index[`${id}-${kind}`];
    this.saveIndex();
  }

  /**
   * Find a picture for the game, downloading it once if needed.
   * @returns {Promise<string|null>} file path, or null when there is none
   */
  async get(game, kind, { download = true } = {}) {
    if (!ART_KINDS[kind]) return null;
    const f = this.file(game.id, kind);
    if (fs.existsSync(f)) return f;
    if (!download) return null;
    const key = `${game.id}-${kind}`;
    const miss = this.index[key];
    if (miss?.missing && Date.now() - miss.at < RETRY_AFTER_MS) return null;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const work = this.slot(() => this.download(game, kind)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }

  async download(game, kind) {
    const system = libretroSystem(game.system, game.fileName);
    const key = `${game.id}-${kind}`;
    if (!system) return null;
    let answered = false;
    for (const name of candidateNames(game)) {
      for (const url of thumbnailUrls(system, kind, name)) {
        let res;
        try {
          res = await this.fetch(url, { signal: AbortSignal.timeout(10000) });
        } catch {
          continue; // host unreachable or slow: try the mirror
        }
        answered = true;
        if (res.status === 404) break; // no picture under this name: the mirror has the same files
        if (!res.ok) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!imageType(bytes)) break;
        fs.writeFileSync(this.file(game.id, kind), bytes);
        this.index[key] = { source: 'libretro', name, at: Date.now() };
        this.saveIndex();
        return this.file(game.id, kind);
      }
    }
    // Offline: try again next time instead of remembering "no picture".
    if (!answered) return null;
    this.index[key] = { missing: true, at: Date.now() };
    this.saveIndex();
    return null;
  }
}
