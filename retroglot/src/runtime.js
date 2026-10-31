// The emulator runtime: EmulatorJS (GPL-3.0) and its libretro cores, downloaded
// from the npm registry into ./runtime. Nothing here is bundled in the
// repository; `retroglot install-runtime` fetches a pinned version.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}

/** Download one npm package (without its dependencies) and unpack it into `dest`. */
export function fetchPackage(spec, dest, log = () => {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retroglot-'));
  try {
    const out = run(npmCommand(), ['pack', spec, '--json', '--pack-destination', tmp], { cwd: tmp });
    const info = JSON.parse(out.slice(out.indexOf('[')));
    const tarball = path.join(tmp, info[0].filename);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', dest, '--strip-components=1']);
    log(`  ${spec} (${(info[0].unpackedSize / 1048576).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Install EmulatorJS and cores. Already-installed packages of the same version are kept.
 * @param {{cores?: string[], all?: boolean, force?: boolean, log?: Function}} opts
 */
export function installRuntime({ cores, all = false, force = false, log = console.log } = {}) {
  const dir = runtimeDir();
  const want = cores && cores.length ? cores : all ? ALL_CORES : DEFAULT_CORES;
  const unknown = want.filter((c) => !ALL_CORES.includes(c));
  if (unknown.length) throw new Error(`Unknown core: ${unknown.join(', ')}. Known cores: ${ALL_CORES.join(', ')}`);
  log(`Installing EmulatorJS ${EMULATORJS_VERSION} into ${dir}`);
  const isCurrent = (d) => {
    try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version === EMULATORJS_VERSION; } catch { return false; }
  };
  const ejs = path.join(dir, 'emulatorjs');
  if (force || !isCurrent(ejs)) fetchPackage(`@emulatorjs/emulatorjs@${EMULATORJS_VERSION}`, ejs, log);
  else log('  @emulatorjs/emulatorjs already installed');
  for (const core of want) {
    const d = coreDir(core, dir);
    if (!force && isCurrent(d)) { log(`  ${core} already installed`); continue; }
    fetchPackage(`@emulatorjs/core-${core}@${EMULATORJS_VERSION}`, d, log);
  }
  return { dir, cores: installedCores(dir) };
}
