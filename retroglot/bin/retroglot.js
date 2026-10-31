#!/usr/bin/env node
// retroglot command line: start the app, install the emulator runtime, add games, check the setup.

import fs from 'node:fs';
import path from 'node:path';
import { createServer, VERSION } from '../src/server.js';
import { emulatorjsDataDir, installRuntime, installedCores, runtimeDir } from '../src/runtime.js';
import { Store, defaultHome } from '../src/store.js';
import { ALL_CORES, SYSTEMS } from '../src/systems.js';
import { credentialStatus } from '../src/translate.js';

const HELP = `retroglot ${VERSION}: play retro games (DOS to PS1 era) with live translation by Claude.

Usage:
  retroglot install-runtime [--all] [--cores a,b] [--force]
                       Download EmulatorJS and emulator cores into ./runtime (once).
  retroglot start [--port 7777] [--host 127.0.0.1] [--home DIR] [--library DIR]... [--allow-host NAME]
                       Start the app and open http://localhost:7777
  retroglot add FILE...      Copy games into the library
  retroglot scan [--library DIR]...  Look for new games in the library folders
  retroglot doctor           Check what is installed and configured
  retroglot systems          List the systems and the core each one uses

Data folder: ${defaultHome()} (change with --home or RETROGLOT_HOME)
`;

function parse(argv) {
  const opts = { _: [], library: [], allowHost: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--port') opts.port = Number(val());
    else if (a === '--host') opts.host = val();
    else if (a === '--home') opts.home = path.resolve(val());
    else if (a === '--library') opts.library.push(path.resolve(val()));
    else if (a === '--allow-host') opts.allowHost.push(val());
    else if (a === '--cores') opts.cores = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') opts.all = true;
    else if (a === '--force') opts.force = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) fail(`Unknown option ${a}. Run: retroglot --help`);
    else opts._.push(a);
  }
  return opts;
}

function fail(msg) {
  console.error(`retroglot: ${msg}`);
  process.exit(1);
}

function openStore(opts) {
  const store = new Store(opts.home || defaultHome());
  if (opts.library.length) {
    const paths = [...new Set([...store.settings.libraryPaths, ...opts.library])];
    for (const p of opts.library) if (!fs.existsSync(p)) fail(`Library folder not found: ${p}`);
    store.updateSettings({ libraryPaths: paths });
  }
  return store;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const cmd = opts._.shift() || 'start';
  if (opts.help || cmd === 'help') return console.log(HELP);

  if (cmd === 'install-runtime') {
    try {
      const { dir, cores } = installRuntime({ cores: opts.cores, all: opts.all, force: opts.force });
      console.log(`Done. ${cores.length} cores in ${dir}`);
    } catch (e) {
      fail(e.message);
    }
    return;
  }

  if (cmd === 'systems') {
    const cores = new Set(installedCores());
    for (const [id, s] of Object.entries(SYSTEMS)) console.log(`${cores.has(s.core) ? '✓' : ' '} ${id.padEnd(11)} ${s.name.padEnd(32)} ${s.core}`);
    console.log(`\nInstall more cores: retroglot install-runtime --cores ${ALL_CORES.filter((c) => !cores.has(c)).slice(0, 3).join(',') || 'NAME'}  (or --all)`);
    return;
  }

  if (cmd === 'doctor') {
    const store = openStore(opts);
    const cred = credentialStatus();
    const cores = installedCores();
    console.log(`retroglot ${VERSION}, Node ${process.version}`);
    console.log(`${emulatorjsDataDir() ? 'ok  ' : 'MISSING'} emulator runtime in ${runtimeDir()}${emulatorjsDataDir() ? '' : '  -> run: npm run setup'}`);
    console.log(`${cores.length ? 'ok  ' : 'MISSING'} ${cores.length} emulator cores${cores.length ? `: ${cores.join(', ')}` : ''}`);
    console.log(`${cred.ok ? 'ok  ' : 'note'} Claude credentials: ${cred.source}`);
    console.log(`ok   data folder ${store.home} (${Object.keys(store.games).length} games)`);
    const bios = fs.readdirSync(store.dirs.bios);
    console.log(`${bios.length ? 'ok  ' : 'note'} BIOS files: ${bios.length ? bios.join(', ') : `none (optional; put them in ${store.dirs.bios})`}`);
    return;
  }

  if (cmd === 'add') {
    if (!opts._.length) fail('Name one or more game files: retroglot add game.sfc');
    const store = openStore(opts);
    for (const f of opts._) {
      if (!fs.existsSync(f)) { console.error(`  not found: ${f}`); continue; }
      try {
        const g = await store.importStream(path.basename(f), fs.createReadStream(f));
        console.log(`  added ${g.title} (${SYSTEMS[g.system]?.name || g.system}, ${g.detection.reason})`);
      } catch (e) {
        console.error(`  ${path.basename(f)}: ${e.message}`);
      }
    }
    return;
  }

  if (cmd === 'scan') {
    const r = openStore(opts).scan();
    console.log(`${r.total} games (${r.added} new or changed, ${r.removed} gone)`);
    return;
  }

  if (cmd === 'start') {
    const store = openStore(opts);
    store.scan();
    const host = opts.host || '127.0.0.1';
    const port = opts.port || Number(process.env.PORT) || 7777;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.warn(`Warning: listening on ${host} lets other computers reach your library and spend your Claude credits.`);
    }
    const server = createServer({ store, allowedHosts: opts.allowHost });
    server.on('error', (e) => fail(e.code === 'EADDRINUSE' ? `Port ${port} is in use. Try: retroglot start --port ${port + 1}` : e.message));
    server.listen(port, host, () => {
      console.log(`retroglot ${VERSION} is running: http://localhost:${port}`);
      if (!emulatorjsDataDir()) console.log('The emulator runtime is not installed yet. Stop with Ctrl+C and run: npm run setup');
      if (!credentialStatus().ok) console.log('No ANTHROPIC_API_KEY set: games play, translation needs a key (or `ant auth login`).');
      console.log(`Games: ${Object.keys(store.games).length} in ${store.dirs.library}`);
    });
    return;
  }

  fail(`Unknown command "${cmd}". Run: retroglot --help`);
}

main();
