// Picture enhancements per game: higher internal resolution, edge smoothing,
// texture upscaling and HD texture packs for Nintendo 64, and an HD renderer
// (Beetle PSX HW) for PlayStation.
//
// The player chooses from a few named levels; this module turns those choices
// into the libretro core options EmulatorJS writes before the core starts.
// Every option a feature manages is always written, so turning a feature off
// really resets it. Pure apart from `romInternalName`/`zipNamesFromFile`, which
// read small parts of files.
import fs from 'node:fs';

const OFF_ON = [{ id: 'off', label: 'Off' }, { id: 'on', label: 'On' }];

/**
 * What can be changed per system. `when` hides a setting until another one has
 * the given value. The first choice is the default.
 */
export const ENHANCEMENTS = {
  n64: {
    resolution: {
      label: 'Rendering resolution',
      choices: [
        { id: '1', label: 'Standard (640×480)' },
        { id: '2', label: '2× (1280×960)' },
        { id: '3', label: '3× (1920×1440)' },
        { id: '4', label: '4× (2560×1920)' },
      ],
      hint: 'Draws the 3D scenes at a higher resolution. 3× and 4× need a fast graphics card.',
    },
    smoothing: {
      label: 'Edge smoothing',
      choices: [{ id: 'off', label: 'Off' }, { id: 'fxaa', label: 'FXAA (light)' }, { id: 'msaa', label: 'MSAA 4× (sharper, slower)' }],
    },
    textures: {
      label: 'Texture upscaling',
      choices: [{ id: 'off', label: 'Off' }, { id: 'xbrz', label: 'xBRZ 4×' }, { id: 'hq4x', label: 'HQ4x' }],
      hint: 'Smooths the game\'s own low-resolution textures.',
    },
    widescreen: {
      label: 'Widescreen',
      choices: OFF_ON,
      hint: 'Shows more of the 3D world at 16:9. Menus and 2D pictures may look stretched.',
    },
    texturePack: {
      label: 'HD texture pack',
      choices: OFF_ON,
      experimental: true,
      hint: 'Replaces textures with a fan-made HD pack you add below (a .zip of PNG files, or a .hts/.htc file).',
    },
  },
  psx: {
    renderer: {
      label: 'Renderer',
      choices: [{ id: 'standard', label: 'Standard' }, { id: 'hd', label: 'HD (Beetle PSX HW)' }],
      hint: 'HD draws 3D at a higher resolution. It needs the PlayStation BIOS for the game\'s region and a one-time download of about 5 MB.',
    },
    resolution: {
      label: 'Rendering resolution',
      when: { renderer: 'hd' },
      choices: [
        { id: '2', label: '2×' },
        { id: '1', label: 'Native' },
        { id: '3', label: '4×' },
        { id: '4', label: '8× (very slow)' },
      ],
    },
    steady: {
      label: 'Steady 3D (PGXP)',
      when: { renderer: 'hd' },
      choices: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }],
      hint: 'Stops polygons from wobbling and textures from warping.',
    },
    widescreen: {
      label: 'Widescreen',
      when: { renderer: 'hd' },
      choices: OFF_ON,
      hint: 'Shows more of the 3D world at 16:9. Menus and 2D pictures may look stretched.',
    },
  },
};

/** The core used for PlayStation's HD renderer. */
export const PSX_HD_CORE = 'mednafen_psx_hw';

/** BIOS files Beetle PSX accepts, by disc region (it picks the file itself). */
export const PSX_HD_BIOS = {
  JP: ['scph5500.bin', 'SCPH-5500.bin'],
  US: ['scph5501.bin', 'SCPH-5501.bin', 'scph7003.bin', 'SCPH-7003.bin'],
  EU: ['scph5502.bin', 'SCPH-5502.bin', 'scph5552.bin', 'SCPH-5552.bin'],
};

/** Keep only known settings with allowed values, and drop the ones at their default. */
export function normalizeEnhance(system, input) {
  const spec = ENHANCEMENTS[system];
  const out = {};
  if (!spec || !input || typeof input !== 'object') return out;
  for (const [key, def] of Object.entries(spec)) {
    const v = input[key] == null ? null : String(input[key]);
    if (v === null) continue;
    if (!def.choices.some((c) => c.id === v)) throw new Error(`${def.label}: unknown choice ${v}`);
    if (v !== def.choices[0].id) out[key] = v;
  }
  return out;
}

/** Settings with defaults filled in. */
export function resolvedEnhance(system, enhance = {}) {
  const spec = ENHANCEMENTS[system] || {};
  return Object.fromEntries(Object.entries(spec).map(([k, def]) => [k, enhance[k] ?? def.choices[0].id]));
}

/** Options managed for each system with feature switched off, used to reset them. */
const N64_RES = { 1: '640x480', 2: '1280x960', 3: '1920x1440', 4: '2560x1920' };
const N64_RES_WIDE = { 1: '960x540', 2: '1920x1080', 3: '2560x1440', 4: '3840x2160' };
const PSX_RES = { 1: '1x(native)', 2: '2x', 3: '4x', 4: '8x' };

/**
 * Work out how a game should start.
 * @param {string} system
 * @param {object} enhance  stored choices (normalised)
 * @param {{coreInstalled?: (core:string)=>boolean, psxBios?: string|null, region?: string|null,
 *          texturePack?: {file:string, kind:'zip'|'hts'|'htc', names?:string[]}|null, romName?: string|null}} ctx
 * @returns {{core: string|null, options: Object<string,string>, packMount: {key:string, kind:string}|null, problems: string[], active: string[]}}
 */
export function enhancementPlan(system, enhance, ctx = {}) {
  const e = resolvedEnhance(system, enhance);
  const plan = { core: null, options: {}, packMount: null, problems: [], active: [] };
  if (system === 'n64') {
    const wide = e.widescreen === 'on';
    plan.options = {
      'mupen64plus-43screensize': N64_RES[e.resolution],
      'mupen64plus-169screensize': N64_RES_WIDE[e.resolution],
      'mupen64plus-aspect': wide ? '16:9 adjusted' : '4:3',
      'mupen64plus-FXAA': e.smoothing === 'fxaa' ? '1' : '0',
      'mupen64plus-MultiSampling': e.smoothing === 'msaa' ? '4' : '0',
      'mupen64plus-txFilterMode': 'None',
      'mupen64plus-txEnhancementMode': { off: 'None', xbrz: '4xBRZ', hq4x: 'HQ4X' }[e.textures],
      'mupen64plus-txHiresEnable': 'False',
      'mupen64plus-txHiresFullAlphaChannel': 'False',
    };
    if (e.resolution !== '1') plan.active.push(`${e.resolution}× resolution`);
    if (e.smoothing !== 'off') plan.active.push(e.smoothing.toUpperCase());
    if (e.textures !== 'off') plan.active.push(e.textures === 'xbrz' ? 'xBRZ textures' : 'HQ4x textures');
    if (wide) plan.active.push('widescreen');
    if (e.texturePack === 'on') {
      const mount = texturePackMount(ctx.texturePack, ctx.romName);
      if (mount.problem) plan.problems.push(mount.problem);
      else {
        plan.packMount = mount;
        plan.options['mupen64plus-txHiresEnable'] = 'True';
        plan.options['mupen64plus-txHiresFullAlphaChannel'] = 'True';
        plan.active.push('HD texture pack');
      }
    }
    return plan;
  }
  if (system === 'psx' && e.renderer === 'hd') {
    const installed = ctx.coreInstalled ? ctx.coreInstalled(PSX_HD_CORE) : true;
    if (!installed) plan.problems.push('The HD renderer is not downloaded yet.');
    if (!ctx.psxBios) plan.problems.push(psxBiosProblem(ctx.region));
    if (plan.problems.length) return plan;
    plan.core = PSX_HD_CORE;
    plan.options = {
      beetle_psx_hw_renderer: 'hardware_gl',
      beetle_psx_hw_internal_resolution: PSX_RES[e.resolution],
      beetle_psx_hw_pgxp_mode: e.steady === 'on' ? 'memory only' : 'disabled',
      beetle_psx_hw_pgxp_texture: e.steady === 'on' ? 'enabled' : 'disabled',
      beetle_psx_hw_widescreen_hack: e.widescreen === 'on' ? 'enabled' : 'disabled',
    };
    plan.active.push(`HD ${{ 1: 'native', 2: '2×', 3: '4×', 4: '8×' }[e.resolution]}`);
    if (e.steady === 'on') plan.active.push('PGXP');
    if (e.widescreen === 'on') plan.active.push('widescreen');
  }
  return plan;
}

function psxBiosProblem(region) {
  const want = { JP: 'scph5500.bin (Japan)', EU: 'scph5502.bin (Europe)' }[region] || 'scph5501.bin (USA)';
  return `The HD renderer needs the PlayStation BIOS ${want} in the BIOS folder.`;
}

/** Pick the BIOS file for Beetle PSX from the files in the BIOS folder. */
export function pickPsxHdBios(fileNames, region) {
  const lower = new Map(fileNames.map((f) => [f.toLowerCase(), f]));
  const order = region && PSX_HD_BIOS[region] ? [region] : ['US', 'JP', 'EU'];
  for (const r of order) for (const n of PSX_HD_BIOS[r]) if (lower.has(n.toLowerCase())) return lower.get(n.toLowerCase());
  return null;
}

/**
 * Where an HD texture pack goes inside the emulator. GLideN64 looks in
 * `<system>/Mupen64plus/hires_texture/<ROM name>/` for PNG packs and in
 * `<system>/Mupen64plus/cache/<ROM name>_HIRESTEXTURES.hts` for packed ones.
 * The emulator's system folder is the file system root.
 */
export function texturePackMount(pack, romName) {
  if (!pack) return { problem: 'No HD texture pack added for this game yet.' };
  if (pack.kind === 'hts' || pack.kind === 'htc') {
    if (!romName) return { problem: 'Could not read the game\'s internal name, so the texture pack cannot be placed.' };
    const suffix = pack.kind === 'hts' ? '_HIRESTEXTURES.hts' : '_HIRESTEXTURES.htc';
    return { key: `/Mupen64plus/cache/${safeDirName(romName)}${suffix}`, kind: pack.kind };
  }
  // A zip: if its single top folder already is the game's folder, unpack it as it is;
  // otherwise unpack it inside the game's folder (GLideN64 also searches subfolders).
  const files = (pack.names || []).filter((n) => !n.startsWith('__MACOSX/') && /\.(png|dds)$/i.test(n));
  if (!files.length) return { problem: 'The texture pack zip has no PNG files in it.' };
  const tops = new Set(files.map((n) => (n.includes('/') ? n.split('/')[0] : '')));
  const top = tops.size === 1 ? [...tops][0] : '';
  if (top && (!romName || top.toUpperCase() === romName.toUpperCase())) {
    return { key: '/Mupen64plus/hires_texture/', kind: 'zip' };
  }
  if (!romName) return { problem: 'Could not read the game\'s internal name, so the texture pack cannot be placed.' };
  return { key: `/Mupen64plus/hires_texture/${safeDirName(romName)}/`, kind: 'zip' };
}

function safeDirName(s) {
  return String(s).replace(/[/\\:*?"<>|\0]/g, '_');
}

/**
 * The internal name in an N64 ROM header (bytes 0x20..0x33), read in any of the
 * three byte orders (.z64 big-endian, .v64 byte-swapped, .n64 little-endian).
 */
export function romInternalName(head) {
  if (!head || head.length < 0x34) return null;
  const magic = head.readUInt32BE(0);
  let h = Buffer.from(head.subarray(0, 0x40));
  if (magic === 0x37804012) { // v64: swap each pair of bytes
    for (let i = 0; i + 1 < h.length; i += 2) { const t = h[i]; h[i] = h[i + 1]; h[i + 1] = t; }
  } else if (magic === 0x40123780) { // n64: reverse each 4-byte word
    for (let i = 0; i + 3 < h.length; i += 4) h.writeUInt32BE(h.readUInt32LE(i), i);
  } else if (magic !== 0x80371240) return null;
  const name = h.subarray(0x20, 0x34).toString('latin1').replace(/\0.*$/, '').trim();
  return /^[\x20-\x7e]+$/.test(name) ? name : null;
}

/** Read the first bytes of a file. */
export function readHead(file, n = 0x40) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally { fs.closeSync(fd); }
}

/** Names inside a zip file, reading only its central directory (packs can be large). */
export function zipNamesFromFile(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || cdOffset + cdSize > size || cdSize > 64 * 1048576) return null; // zip64 or damaged
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const names = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      names.push(cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } finally { fs.closeSync(fd); }
}
