// Everything retroglot keeps on disk: the game library, settings, save states,
// cover pictures and translation memory. One folder (RETROGLOT_HOME, default
// ~/.retroglot) holds it all, so a backup is a copy of that folder.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeEnhance, pickPsxHdBios, readHead } from './enhance.js';
import { GAME_EXTS, SYSTEMS, cueFiles, detectSystem, extOf, regionFromFile, titleFromFile } from './systems.js';

export const DEFAULT_SETTINGS = {
  targetLanguage: 'English',
  model: 'claude-opus-5-5',
  effort: 'low',
  overlay: 'boxes', // boxes | subtitles | off
  autoTranslate: false,
  pauseWhileTranslating: true,
  autoSensitivity: 0.6, // 0..1, how small a screen change starts a new translation
  style: 'natural', // natural | literal | localized
  libraryPaths: [],
  downloadArt: true, // box art from the libretro thumbnail collection
  uiSounds: true,
  display: 'crt', // crt | sharp | smooth | xbr | scalefx
};

const REGION_LANG = { JP: 'Japanese', KR: 'Korean', CN: 'Chinese', EU: null, US: null };

export function defaultHome() {
  return process.env.RETROGLOT_HOME ? path.resolve(process.env.RETROGLOT_HOME) : path.join(os.homedir(), '.retroglot');
}

/** A path next to `p` that does not exist yet: name.ext, name-2.ext, name-3.ext... */
export function freePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${name}-${i}${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

/** Keep only characters that are safe in a file name on every system. */
export function safeFileName(name) {
  const base = path.basename(String(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return base.slice(0, 180) || 'game';
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readSlice(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/** First and last bytes of a game file, enough for header and zip-directory checks. */
export function sampleFile(file) {
  const size = fs.statSync(file).size;
  const head = readSlice(file, 0, Math.min(size, 98304));
  const tail = size > 98304 ? readSlice(file, Math.max(0, size - 70000), 70000) : head;
  return { head, tail, size };
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.isFile() && GAME_EXTS.has(extOf(e.name))) out.push(p);
  }
  return out;
}

/** Picture modes; src/server.js maps each to an EmulatorJS shader. */
export const DISPLAY_MODES = ['crt', 'sharp', 'smooth', 'xbr', 'scalefx'];

const TEXTURE_PACK_KINDS = ['zip', 'hts', 'htc'];
/** Packs are unpacked in the browser's memory, so very large ones cannot work. */
export const TEXTURE_PACK_MAX = 1536 * 1048576;

export class Store {
  constructor(home = defaultHome()) {
    this.home = home;
    this.dirs = {
      library: path.join(home, 'library'),
      bios: path.join(home, 'bios'),
      saves: path.join(home, 'saves'),
      covers: path.join(home, 'covers'),
      translations: path.join(home, 'translations'),
      textures: path.join(home, 'textures'),
    };
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    this.dbFile = path.join(home, 'db.json');
    const db = readJson(this.dbFile, {});
    this.games = db.games || {};
    this.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  }

  save() {
    writeJsonAtomic(this.dbFile, { version: 1, games: this.games, settings: this.settings });
  }

  static idFor(file) {
    return crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 12);
  }

  libraryRoots() {
    return [this.dirs.library, ...this.settings.libraryPaths.filter((p) => p && fs.existsSync(p))];
  }

  /** Look for new, moved and deleted games in every library folder. */
  scan() {
    const seen = new Set();
    const files = this.libraryRoots().flatMap((r) => walk(r));
    // Bins that belong to a cue sheet are part of that game, not games of their own.
    const owned = new Set();
    for (const f of files) {
      if (extOf(f) !== 'cue') continue;
      try {
        for (const ref of cueFiles(fs.readFileSync(f, 'latin1'))) owned.add(path.resolve(path.dirname(f), ref));
      } catch { /* unreadable cue: list it anyway */ }
    }
    let added = 0;
    for (const f of files) {
      if (owned.has(path.resolve(f))) continue;
      const id = Store.idFor(f);
      seen.add(id);
      if (this.games[id] && this.games[id].size === fs.statSync(f).size) continue;
      this.addFile(f, { persist: false });
      added++;
    }
    let removed = 0;
    for (const id of Object.keys(this.games)) {
      if (!seen.has(id)) { delete this.games[id]; removed++; }
    }
    this.save();
    return { added, removed, total: Object.keys(this.games).length };
  }

  /** Add (or refresh) one game file and detect its system. */
  addFile(file, { persist = true } = {}) {
    const id = Store.idFor(file);
    const name = path.basename(file);
    const ext = extOf(name);
    let extraFiles = [];
    let sample = sampleFile(file);
    if (ext === 'cue') {
      extraFiles = cueFiles(fs.readFileSync(file, 'latin1'))
        .map((ref) => path.resolve(path.dirname(file), ref))
        .filter((p) => fs.existsSync(p));
      if (extraFiles[0]) sample = sampleFile(extraFiles[0]);
    }
    const detected = detectSystem(name, sample);
    const old = this.games[id] || {};
    const region = regionFromFile(name);
    this.games[id] = {
      id,
      title: old.titleEdited ? old.title : titleFromFile(name),
      titleEdited: !!old.titleEdited,
      file: path.resolve(file),
      fileName: name,
      extraFiles,
      size: fs.statSync(file).size,
      system: old.systemEdited ? old.system : detected.system || 'dos',
      systemEdited: !!old.systemEdited,
      detection: detected,
      region,
      sourceLanguage: old.sourceLanguage || REGION_LANG[region] || 'auto',
      added: old.added || new Date().toISOString(),
      lastPlayed: old.lastPlayed || null,
      playSeconds: old.playSeconds || 0,
      favorite: !!old.favorite,
      notes: old.notes || '',
      enhance: old.enhance || {},
    };
    if (persist) this.save();
    return this.games[id];
  }

  /** Save an uploaded stream into the library folder. */
  async importStream(fileName, stream) {
    const dest = freePath(path.join(this.dirs.library, safeFileName(fileName)));
    if (!GAME_EXTS.has(extOf(dest))) throw new Error(`Not a game file type: .${extOf(dest) || '?'}`);
    const tmp = `${dest}.part`;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      stream.pipe(out);
    });
    fs.renameSync(tmp, dest);
    return this.addFile(dest);
  }

  list() {
    return Object.values(this.games).map((g) => this.publicGame(g));
  }

  publicGame(g) {
    const sys = SYSTEMS[g.system] || {};
    return {
      id: g.id, title: g.title, fileName: g.fileName, size: g.size, system: g.system,
      systemName: sys.name || g.system, systemShort: sys.short || g.system, era: sys.era || null,
      detection: g.detection, region: g.region, sourceLanguage: g.sourceLanguage,
      added: g.added, lastPlayed: g.lastPlayed, playSeconds: g.playSeconds, favorite: g.favorite,
      notes: g.notes, hasCover: fs.existsSync(this.coverPath(g.id)), extraFiles: g.extraFiles.map((f) => path.basename(f)),
      saves: this.listSaves(g.id).length,
      enhance: g.enhance || {}, texturePack: this.texturePackInfo(g.id),
    };
  }

  get(id) {
    return this.games[id] || null;
  }

  update(id, patch) {
    const g = this.games[id];
    if (!g) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) { g.title = patch.title.trim().slice(0, 200); g.titleEdited = true; }
    if (typeof patch.system === 'string') {
      if (!SYSTEMS[patch.system]) throw new Error(`Unknown system: ${patch.system}`);
      if (g.system !== patch.system) g.enhance = {};
      g.system = patch.system; g.systemEdited = true;
    }
    if (patch.enhance !== undefined) g.enhance = normalizeEnhance(g.system, patch.enhance);
    if (typeof patch.favorite === 'boolean') g.favorite = patch.favorite;
    if (typeof patch.sourceLanguage === 'string') g.sourceLanguage = patch.sourceLanguage.slice(0, 40) || 'auto';
    if (typeof patch.notes === 'string') g.notes = patch.notes.slice(0, 4000);
    if (typeof patch.addPlaySeconds === 'number' && patch.addPlaySeconds > 0 && patch.addPlaySeconds < 86400) {
      g.playSeconds += Math.round(patch.addPlaySeconds);
    }
    if (patch.played) g.lastPlayed = new Date().toISOString();
    this.save();
    return this.publicGame(g);
  }

  /** Remove a game from the library. Its file is deleted only when it was uploaded into the library folder. */
  remove(id, { deleteFile = false } = {}) {
    const g = this.games[id];
    if (!g) return false;
    if (deleteFile && g.file.startsWith(this.dirs.library + path.sep)) {
      for (const f of [g.file, ...g.extraFiles]) fs.rmSync(f, { force: true });
    }
    delete this.games[id];
    this.save();
    return true;
  }

  updateSettings(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${k}`);
      if (typeof v !== typeof DEFAULT_SETTINGS[k] && !(Array.isArray(DEFAULT_SETTINGS[k]) && Array.isArray(v))) {
        throw new Error(`Setting ${k} must be a ${Array.isArray(DEFAULT_SETTINGS[k]) ? 'list' : typeof DEFAULT_SETTINGS[k]}`);
      }
      if (k === 'display' && !DISPLAY_MODES.includes(v)) throw new Error(`Picture must be one of ${DISPLAY_MODES.join(', ')}`);
      this.settings[k] = v;
    }
    this.save();
    return this.settings;
  }

  // --- BIOS -----------------------------------------------------------------

  /** A BIOS file for this system, if the user put one in the bios folder. */
  biosFor(system) {
    const known = {
      psx: ['scph5501.bin', 'scph1001.bin', 'scph7001.bin', 'scph5500.bin', 'scph5502.bin', 'psxonpsp660.bin'],
      segaCD: ['bios_CD_U.bin', 'bios_CD_J.bin', 'bios_CD_E.bin'],
      segaSaturn: ['saturn_bios.bin', 'sega_101.bin', 'mpr-17933.bin'],
      '3do': ['panafz10.bin', 'panafz1.bin', 'goldstar.bin'],
      pce: ['syscard3.pce'],
      lynx: ['lynxboot.img'],
      atari7800: ['7800 BIOS (U).rom'],
      gba: ['gba_bios.bin'],
    }[system] || [];
    let files = [];
    try { files = fs.readdirSync(this.dirs.bios); } catch { return null; }
    const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
    for (const k of known) if (lower.has(k.toLowerCase())) return path.join(this.dirs.bios, lower.get(k.toLowerCase()));
    return null;
  }

  /** The BIOS file Beetle PSX (the PlayStation HD renderer) will accept for a disc region. */
  psxHdBiosFor(region) {
    let files = [];
    try { files = fs.readdirSync(this.dirs.bios); } catch { return null; }
    const f = pickPsxHdBios(files, region);
    return f ? path.join(this.dirs.bios, f) : null;
  }

  // --- HD texture packs (Nintendo 64) ---------------------------------------

  texturePackFile(id) {
    for (const kind of TEXTURE_PACK_KINDS) {
      const f = path.join(this.dirs.textures, `${id}.${kind}`);
      if (fs.existsSync(f)) return { file: f, kind };
    }
    return null;
  }

  texturePackInfo(id) {
    const p = this.texturePackFile(id);
    if (!p) return null;
    const meta = readJson(path.join(this.dirs.textures, `${id}.json`), {});
    return { kind: p.kind, size: fs.statSync(p.file).size, name: meta.name || `${id}.${p.kind}` };
  }

  /** Save an uploaded texture pack for one game, replacing the previous one. */
  async importTexturePack(id, fileName, stream, maxBytes = TEXTURE_PACK_MAX) {
    const kind = extOf(String(fileName));
    if (!TEXTURE_PACK_KINDS.includes(kind)) throw new Error('A texture pack must be a .zip, .hts or .htc file');
    const tmp = path.join(this.dirs.textures, `${id}.upload`);
    let bytes = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        stream.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) { stream.unpipe(out); out.destroy(); reject(new Error(`Texture packs larger than ${Math.round(maxBytes / 1048576)} MB do not fit in the browser's memory`)); }
        });
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        stream.pipe(out);
      });
      if (kind === 'zip') {
        const head = readHead(tmp, 4);
        if (head.length < 4 || head.readUInt32LE(0) !== 0x04034b50) throw new Error('This file is not a zip archive');
      }
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    this.removeTexturePack(id);
    fs.renameSync(tmp, path.join(this.dirs.textures, `${id}.${kind}`));
    writeJsonAtomic(path.join(this.dirs.textures, `${id}.json`), { name: path.basename(String(fileName)).slice(0, 200), addedAt: new Date().toISOString() });
    return this.texturePackInfo(id);
  }

  removeTexturePack(id) {
    for (const kind of [...TEXTURE_PACK_KINDS, 'json']) fs.rmSync(path.join(this.dirs.textures, `${id}.${kind}`), { force: true });
  }

  // --- save states ----------------------------------------------------------

  saveDir(id) {
    return path.join(this.dirs.saves, id);
  }

  listSaves(id) {
    const dir = this.saveDir(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^slot-\d+\.json$/.test(f))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => a.slot - b.slot);
  }

  writeSave(id, slot, state, png) {
    if (!Number.isInteger(slot) || slot < 0 || slot > 99) throw new Error('Save slot must be 0..99');
    const dir = this.saveDir(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `slot-${slot}.state`), state);
    if (png && png.length) fs.writeFileSync(path.join(dir, `slot-${slot}.png`), png);
    const meta = { slot, savedAt: new Date().toISOString(), bytes: state.length, hasPicture: !!(png && png.length) };
    writeJsonAtomic(path.join(dir, `slot-${slot}.json`), meta);
    return meta;
  }

  savePath(id, slot, kind = 'state') {
    return path.join(this.saveDir(id), `slot-${slot}.${kind}`);
  }

  deleteSave(id, slot) {
    for (const k of ['state', 'png', 'json']) fs.rmSync(this.savePath(id, slot, k), { force: true });
  }

  coverPath(id) {
    return path.join(this.dirs.covers, `${id}.png`);
  }
}
