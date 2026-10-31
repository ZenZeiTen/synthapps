// Systems retroglot can play, and how to tell which one a game file belongs to.
//
// Detection looks at the file name first, then at the bytes: cartridge headers,
// disc sectors and the names inside a zip. Everything here is pure (no file
// system access) so it can be tested with small in-memory buffers.

/** One entry per playable system. `core` is the EmulatorJS core used to run it. */
export const SYSTEMS = {
  dos: { name: 'MS-DOS', short: 'DOS', core: 'dosbox_pure', era: 1981, maker: 'IBM PC', threads: true },
  atari2600: { name: 'Atari 2600', short: '2600', core: 'stella2014', era: 1977, maker: 'Atari' },
  atari7800: { name: 'Atari 7800', short: '7800', core: 'prosystem', era: 1986, maker: 'Atari' },
  nes: { name: 'Nintendo Entertainment System', short: 'NES', core: 'fceumm', era: 1983, maker: 'Nintendo' },
  snes: { name: 'Super Nintendo', short: 'SNES', core: 'snes9x', era: 1990, maker: 'Nintendo' },
  n64: { name: 'Nintendo 64', short: 'N64', core: 'mupen64plus_next', era: 1996, maker: 'Nintendo' },
  gb: { name: 'Game Boy / Color', short: 'GB', core: 'gambatte', era: 1989, maker: 'Nintendo' },
  gba: { name: 'Game Boy Advance', short: 'GBA', core: 'mgba', era: 2001, maker: 'Nintendo' },
  vb: { name: 'Virtual Boy', short: 'VB', core: 'beetle_vb', era: 1995, maker: 'Nintendo' },
  segaMS: { name: 'Sega Master System', short: 'SMS', core: 'smsplus', era: 1985, maker: 'Sega' },
  segaMD: { name: 'Sega Mega Drive / Genesis', short: 'MD', core: 'genesis_plus_gx', era: 1988, maker: 'Sega' },
  segaGG: { name: 'Sega Game Gear', short: 'GG', core: 'genesis_plus_gx', era: 1990, maker: 'Sega' },
  segaCD: { name: 'Sega CD / Mega-CD', short: 'MCD', core: 'genesis_plus_gx', era: 1991, maker: 'Sega' },
  sega32x: { name: 'Sega 32X', short: '32X', core: 'picodrive', era: 1994, maker: 'Sega' },
  segaSaturn: { name: 'Sega Saturn', short: 'SAT', core: 'yabause', era: 1994, maker: 'Sega', bios: true },
  pce: { name: 'PC Engine / TurboGrafx-16', short: 'PCE', core: 'mednafen_pce', era: 1987, maker: 'NEC' },
  ngp: { name: 'Neo Geo Pocket / Color', short: 'NGP', core: 'mednafen_ngp', era: 1998, maker: 'SNK' },
  ws: { name: 'WonderSwan / Color', short: 'WS', core: 'mednafen_wswan', era: 1999, maker: 'Bandai' },
  lynx: { name: 'Atari Lynx', short: 'LYNX', core: 'handy', era: 1989, maker: 'Atari' },
  jaguar: { name: 'Atari Jaguar', short: 'JAG', core: 'virtualjaguar', era: 1993, maker: 'Atari' },
  '3do': { name: '3DO', short: '3DO', core: 'opera', era: 1993, maker: 'Panasonic', bios: true },
  psx: { name: 'PlayStation', short: 'PS1', core: 'pcsx_rearmed', era: 1994, maker: 'Sony' },
  arcade: { name: 'Arcade (FinalBurn Neo)', short: 'ARC', core: 'fbneo', era: 1980, maker: 'Arcade' },
  amiga: { name: 'Commodore Amiga', short: 'AMI', core: 'puae', era: 1985, maker: 'Commodore' },
  c64: { name: 'Commodore 64', short: 'C64', core: 'vice_x64sc', era: 1982, maker: 'Commodore' },
};

/** Cores installed by `retroglot install-runtime` unless --all is given. */
export const DEFAULT_CORES = [
  'dosbox_pure', 'fceumm', 'snes9x', 'mupen64plus_next', 'gambatte', 'mgba', 'smsplus',
  'genesis_plus_gx', 'picodrive', 'mednafen_pce', 'pcsx_rearmed', 'stella2014', 'prosystem',
  'handy', 'mednafen_ngp', 'mednafen_wswan', 'beetle_vb',
];

/** Optional cores used by enhancements: Beetle PSX HW renders PlayStation games at higher resolution. */
export const EXTRA_CORES = ['mednafen_psx_hw'];

/** Every core any system above can use. */
export const ALL_CORES = [...new Set(Object.values(SYSTEMS).map((s) => s.core).concat(DEFAULT_CORES, EXTRA_CORES))];

// Extensions that name exactly one system.
const EXT = {
  com: 'dos', exe: 'dos', bat: 'dos', dosz: 'dos', jsdos: 'dos',
  a26: 'atari2600', a78: 'atari7800',
  nes: 'nes', fds: 'nes', unf: 'nes', unif: 'nes',
  sfc: 'snes', smc: 'snes', fig: 'snes', swc: 'snes', bs: 'snes',
  n64: 'n64', z64: 'n64', v64: 'n64',
  gb: 'gb', gbc: 'gb', sgb: 'gb', gba: 'gba', vb: 'vb', vboy: 'vb',
  sms: 'segaMS', md: 'segaMD', gen: 'segaMD', smd: 'segaMD', gg: 'segaGG', '32x': 'sega32x',
  pce: 'pce', sgx: 'pce', ngp: 'ngp', ngc: 'ngp', ws: 'ws', wsc: 'ws', lnx: 'lynx',
  j64: 'jaguar', jag: 'jaguar', pbp: 'psx', adf: 'amiga', hdf: 'amiga', d64: 'c64', t64: 'c64', prg: 'c64',
};

/** Extensions that are disc images: system decided by the disc's contents. */
export const DISC_EXTS = new Set(['cue', 'chd', 'iso', 'img', 'bin', 'ccd', 'm3u', 'toc', 'cdi']);

/** Every extension retroglot will put in the library. */
export const GAME_EXTS = new Set([...Object.keys(EXT), ...DISC_EXTS, 'zip', '7z']);

export function extOf(name) {
  const m = /\.([^./\\]+)$/.exec(String(name));
  return m ? m[1].toLowerCase() : '';
}

const ascii = (buf, start, len) => Buffer.from(buf.subarray(start, start + len)).toString('latin1');

/**
 * Identify the system from a disc's first sectors.
 * Works for raw (2352-byte) and cooked (2048-byte) images.
 */
export function sniffDisc(head) {
  if (!head || head.length < 64) return null;
  const text = Buffer.from(head).toString('latin1');
  if (text.includes('SEGA SEGASATURN')) return 'segaSaturn';
  if (text.includes('SEGADISCSYSTEM')) return 'segaCD';
  // 3DO Opera file system: record type 1, five 0x5A sync bytes, version 1.
  for (const off of [0, 16]) {
    if (head[off] === 1 && head[off + 1] === 0x5a && head[off + 5] === 0x5a && head[off + 6] === 1) return '3do';
  }
  if (text.includes('PLAYSTATION') || text.includes('Sony Computer Entertainment')) return 'psx';
  if (text.includes('PC Engine CD-ROM SYSTEM')) return 'pce';
  return null;
}

/** Names of the files stored in a zip, read from its central directory. */
export function zipEntries(buf) {
  const names = [];
  // End of central directory record: last 22..65557 bytes.
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 5 && buf[i + 3] === 6) { eocd = i; break; }
  }
  if (eocd < 0) return names;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** Guess the system of a zip from the names inside it. */
export function systemFromZipNames(names) {
  const exts = names.filter((n) => !n.endsWith('/')).map(extOf);
  if (exts.some((e) => e === 'exe' || e === 'com' || e === 'bat')) return 'dos';
  for (const e of exts) if (EXT[e]) return EXT[e];
  if (exts.some((e) => DISC_EXTS.has(e))) return 'psx';
  // Arcade sets are zips of chip dumps with names like "pacman.6e" or "ep1.bin".
  return exts.length ? 'arcade' : null;
}

/**
 * Detect the system of a game.
 * @param {string} name file name
 * @param {{head?: Buffer, tail?: Buffer, size?: number}} bytes the first ~64 KB,
 *   the last ~64 KB (zip directory) and total size, when available
 * @returns {{system: string|null, confidence: 'high'|'medium'|'low', reason: string}}
 */
export function detectSystem(name, bytes = {}) {
  const ext = extOf(name);
  const { head, tail } = bytes;
  if (EXT[ext]) {
    // .bin/.md style headers can still overrule a misleading extension for SMD/GEN dumps.
    return { system: EXT[ext], confidence: 'high', reason: `.${ext} file` };
  }
  if (ext === 'zip') {
    const src = tail && tail.length ? tail : head;
    const names = src ? zipEntries(src) : [];
    const system = systemFromZipNames(names);
    if (system) return { system, confidence: system === 'arcade' ? 'low' : 'medium', reason: `zip containing ${names.slice(0, 3).join(', ')}` };
    return { system: 'dos', confidence: 'low', reason: 'zip with unreadable contents' };
  }
  if (ext === '7z') return { system: 'dos', confidence: 'low', reason: '7z archive' };
  if (DISC_EXTS.has(ext)) {
    if (head) {
      // A plain .bin may be a Mega Drive cartridge rather than a disc.
      if (ext === 'bin' && ascii(head, 0x100, 4) === 'SEGA') return { system: 'segaMD', confidence: 'high', reason: 'Mega Drive header' };
      if (ext === 'bin' && head.length >= 0x7ff0 + 8 && ascii(head, 0x7ff0, 8) === 'TMR SEGA') return { system: 'segaMS', confidence: 'high', reason: 'Master System header' };
      const fromDisc = sniffDisc(head);
      if (fromDisc) return { system: fromDisc, confidence: 'high', reason: 'disc header' };
    }
    if (ext === 'cue' || ext === 'm3u' || ext === 'ccd' || ext === 'toc') return { system: 'psx', confidence: 'low', reason: `.${ext} sheet (check its data track)` };
    return { system: 'psx', confidence: 'low', reason: `.${ext} disc image` };
  }
  return { system: null, confidence: 'low', reason: 'unknown file type' };
}

/** Files a cue sheet refers to, in order. */
export function cueFiles(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
    if (m) out.push(m[1] || m[2]);
  }
  return out;
}

/** Turn a file name into a readable title: "Some_Game (J) [!].sfc" -> "Some Game (J)". */
export function titleFromFile(name) {
  let t = String(name).replace(/\.[^.]+$/, '');
  t = t.replace(/\[[^\]]*\]/g, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t || String(name);
}

/** Region tags from No-Intro / GoodTools style names, e.g. (Japan) or (J). */
export function regionFromFile(name) {
  const s = String(name);
  if (/\((?:[^)]*\b)?(Japan|J|JP|JPN)\b/i.test(s)) return 'JP';
  if (/\((?:[^)]*\b)?(USA|U|US)\b/i.test(s)) return 'US';
  if (/\((?:[^)]*\b)?(Europe|E|EU|PAL)\b/i.test(s)) return 'EU';
  if (/\((?:[^)]*\b)?(Korea|K|KR)\b/i.test(s)) return 'KR';
  if (/\((?:[^)]*\b)?(China|Ch|CN)\b/i.test(s)) return 'CN';
  return null;
}
