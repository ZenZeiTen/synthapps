// The emulator runtime: EmulatorJS (GPL-3.0) and its libretro cores, downloaded
// from the npm registry into ./runtime (or RETROGLOT_RUNTIME). Nothing here is
// bundled in the repository; a pinned version is fetched on first use.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ALL_CORES, DEFAULT_CORES } from './systems.js';

export const EMULATORJS_VERSION = '4.2.3';
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runtimeDir() {
  return process.env.RETROGLOT_RUNTIME ? path.resolve(process.env.RETROGLOT_RUNTIME) : path.join(PACKAGE_ROOT, 'runtime');
}

/** Folder holding EmulatorJS's `data/` directory, or null if not installed. */
export function emulatorjsDataDir(dir = runtimeDir()) {
  const data = path.join(dir, 'emulatorjs', 'data');
  return fs.existsSync(path.join(data, 'loader.js')) ? data : null;
}

export function coreDir(core, dir = runtimeDir()) {
  return path.join(dir, 'cores', core);
}

export function installedCores(dir = runtimeDir()) {
  const root = path.join(dir, 'cores');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((c) => fs.existsSync(path.join(root, c, 'package.json'))).sort();
}

/**
 * Resolve a request under /ejs/ to a file on disk.
 * EmulatorJS asks for `cores/<core>[-thread][-legacy]-wasm.data` and `cores/reports/<core>.json`
 * relative to its data folder; those live in separate core packages.
 * @returns {string|null} absolute path, or null when outside the runtime
 */
export function resolveRuntimePath(rel, dir = runtimeDir()) {
  const data = emulatorjsDataDir(dir);
  if (!data) return null;
  const clean = path.posix.normalize('/' + rel).slice(1);
  if (clean.startsWith('..')) return null;
  const report = /^cores\/reports\/([a-z0-9_]+)\.json$/.exec(clean);
  if (report) return path.join(coreDir(report[1], dir), 'reports', `${report[1]}.json`);
  const core = /^cores\/([a-z0-9_]+?)(-thread)?(-legacy)?-wasm\.data$/.exec(clean);
  if (core) return path.join(coreDir(core[1], dir), path.basename(clean));
  const full = path.join(data, clean);
  return full.startsWith(data) ? full : null;
}

export const REGISTRY = (process.env.RETROGLOT_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');

/** Read a tar archive (already gunzipped) and call `onFile(name, data)` for every regular file. */
export function untar(buf, onFile) {
  let off = 0;
  let longName = null;
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    let name = longName || (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    longName = null;
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      // PAX header: "<len> path=<name>\n" records.
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m && type === 'x') longName = m[1];
      continue;
    }
    if (type === 'L') { longName = str(body); continue; }
    if (type === '0' || type === '\0' || type === '7') onFile(name, Buffer.from(body));
  }
}

/** Write the files of an npm tarball into `dest`, dropping the leading "package/" folder. */
function extractPackage(tgz, dest) {
  const files = [];
  untar(zlib.gunzipSync(tgz), (name, data) => {
    const rel = name.split('/').slice(1).join('/');
    const norm = path.posix.normalize(rel);
    if (!rel || norm.startsWith('..') || path.posix.isAbsolute(norm)) throw new Error(`Unsafe path in package: ${name}`);
    files.push([norm, data]);
  });
  const tmp = `${dest}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const f = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);
}

async function readAll(res, onBytes) {
  if (!res.body?.getReader) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    onBytes(value.length);
  }
  return Buffer.concat(chunks);
}

/**
 * Download one npm package (without its dependencies), check its integrity hash and unpack it into `dest`.
 * Needs no npm or tar program, so it works inside the desktop app too.
 */
export async function fetchPackage(name, version, dest, { fetch = globalThis.fetch, onBytes = () => {} } = {}) {
  const metaUrl = `${REGISTRY}/${name}/${version}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error(`${name}@${version}: the package registry answered ${metaRes.status}`);
  const meta = await metaRes.json();
  const { tarball, integrity } = meta.dist || {};
  if (!tarball) throw new Error(`${name}@${version}: no download link in the registry answer`);
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`${name}@${version}: download failed (${res.status})`);
  const tgz = await readAll(res, onBytes);
  const sri = /^sha512-(.+)$/.exec(integrity || '');
  if (sri) {
    const got = crypto.createHash('sha512').update(tgz).digest('base64');
    if (got !== sri[1]) throw new Error(`${name}@${version}: the download is damaged (checksum mismatch). Try again.`);
  }
  extractPackage(tgz, dest);
  return { bytes: tgz.length, unpackedSize: meta.dist.unpackedSize || 0 };
}

/** The packages a runtime install needs, with the folder each goes to. */
export function runtimePlan({ cores, all = false, force = false } = {}, dir = runtimeDir()) {
  const want = cores && cores.length ? cores : all ? ALL_CORES : DEFAULT_CORES;
  const unknown = want.filter((c) => !ALL_CORES.includes(c));
  if (unknown.length) throw new Error(`Unknown core: ${unknown.join(', ')}. Known cores: ${ALL_CORES.join(', ')}`);
  const isCurrent = (d) => {
    try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version === EMULATORJS_VERSION; } catch { return false; }
  };
  const all_ = [{ label: 'EmulatorJS', name: '@emulatorjs/emulatorjs', dest: path.join(dir, 'emulatorjs') },
    ...want.map((c) => ({ label: c, name: `@emulatorjs/core-${c}`, dest: coreDir(c, dir) }))];
  return all_.filter((p) => force || !isCurrent(p.dest));
}

/**
 * Install EmulatorJS and cores. Already-installed packages of the same version are kept.
 * @param {{cores?: string[], all?: boolean, force?: boolean, fetch?: Function,
 *   log?: Function, onProgress?: (p: {done: number, total: number, label: string, bytes: number}) => void}} opts
 */
export async function installRuntime({ cores, all = false, force = false, fetch = globalThis.fetch, log = console.log, onProgress = () => {} } = {}) {
  const dir = runtimeDir();
  const plan = runtimePlan({ cores, all, force }, dir);
  log(`Installing EmulatorJS ${EMULATORJS_VERSION} into ${dir}${plan.length ? '' : ' (everything is already installed)'}`);
  let bytes = 0;
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    onProgress({ done: i, total: plan.length, label: p.label, bytes });
    const r = await fetchPackage(p.name, EMULATORJS_VERSION, p.dest, {
      fetch,
      onBytes: (n) => { bytes += n; onProgress({ done: i, total: plan.length, label: p.label, bytes }); },
    });
    log(`  ${p.label} (${(r.unpackedSize / 1048576).toFixed(1)} MB)`);
  }
  onProgress({ done: plan.length, total: plan.length, label: '', bytes });
  return { dir, cores: installedCores(dir) };
}
