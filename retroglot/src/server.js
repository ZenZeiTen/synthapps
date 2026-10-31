// The retroglot web server: serves the app, the emulator runtime and the game
// files, keeps the library and save states, and talks to Claude for translation.
// It listens on this computer only (127.0.0.1) unless told otherwise.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { TranslationMemory, exportScript } from './memory.js';
import { FileSecrets, looksLikeApiKey } from './credentials.js';
import { EMULATORJS_VERSION, PACKAGE_ROOT, emulatorjsDataDir, installRuntime, installedCores, runtimePlan, resolveRuntimePath, runtimeDir } from './runtime.js';
import { Store } from './store.js';
import { SYSTEMS, extOf } from './systems.js';
import { EFFORTS, MODELS, STYLES, TranslationError, credentialStatus, estimateCost, requestTranslation, resetClient, testCredentials, useSecrets } from './translate.js';

export const VERSION = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
const WEB_ROOT = path.join(PACKAGE_ROOT, 'web');

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', ico: 'image/x-icon', wasm: 'application/wasm', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function baseHeaders(res) {
  // Cross-origin isolation lets cores that need threads (DOSBox Pure) use SharedArrayBuffer.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': TYPES.json, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(req, res, file, { type, cache = 'no-cache', downloadName } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { throw new HttpError(404, 'Not found'); }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  const headers = {
    'Content-Type': type || TYPES[extOf(file)] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start); end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, `Request body larger than ${Math.round(limit / 1048576)} MB`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req, limit = 1048576) {
  const buf = await readBody(req, limit);
  try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, 'Body is not valid JSON'); }
}

/** JSON for embedding inside a <script> element. */
function scriptJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The file name the emulator sees. DOS cannot start programs with long names,
 * spaces or brackets, so a DOS program is offered under a short 8.3 name.
 */
export function romUrlName(game) {
  const ext = extOf(game.fileName);
  if (game.system === 'dos' && ['com', 'exe', 'bat'].includes(ext)) {
    const stem = game.fileName.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'GAME';
    return `${stem}.${ext.toUpperCase()}`;
  }
  return game.fileName;
}

function emulatorPage(store, game, { slot } = {}) {
  const sys = SYSTEMS[game.system];
  if (!sys) throw new HttpError(400, `Unknown system ${game.system}`);
  const cfg = {
    EJS_player: '#game',
    EJS_core: sys.core,
    EJS_gameUrl: `/rom/${game.id}/${encodeURIComponent(romUrlName(game))}`,
    EJS_gameName: game.title,
    EJS_pathtodata: '/ejs/',
    EJS_DEBUG_XX: true, // load the unminified sources shipped in the npm package
    EJS_startOnLoaded: true,
    EJS_threads: !!sys.threads,
    EJS_color: '#ff9e45',
    EJS_backgroundColor: '#05060a',
    EJS_language: 'en-US',
    EJS_disableAutoLang: true,
    EJS_noAutoFocus: false,
    EJS_Buttons: {
      saveState: false, loadState: false, quickSave: false, quickLoad: false, fullscreen: false,
      enterFullscreen: false, exitFullscreen: false, cacheManager: false, screenRecord: false, screenshot: false,
      saveSavFiles: true, loadSavFiles: true,
    },
    EJS_defaultOptions: { 'save-state-location': 'browser' },
  };
  const bios = store.biosFor(game.system);
  if (bios) cfg.EJS_biosUrl = `/bios/${encodeURIComponent(path.basename(bios))}`;
  if (game.extraFiles.length) {
    cfg.EJS_externalFiles = Object.fromEntries(game.extraFiles.map((f, i) => [`/${path.basename(f)}`, `/rom/${game.id}/extra/${i}/${encodeURIComponent(path.basename(f))}`]));
  }
  if (Number.isInteger(slot) && fs.existsSync(store.savePath(game.id, slot))) cfg.EJS_loadStateURL = `/api/games/${game.id}/saves/${slot}/state`;
  const assign = Object.entries(cfg).map(([k, v]) => `window.${k} = ${scriptJson(v)};`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${game.title.replace(/[<&>"]/g, '')}</title>
<style>html,body{margin:0;height:100%;background:#05060a;overflow:hidden}#game{width:100%;height:100%}</style>
</head><body><div id="game"></div>
<script>${assign}</script>
<script src="/assets/emu-bridge.js"></script>
<script src="/ejs/loader.js"></script>
</body></html>`;
}

/**
 * Create the HTTP server.
 * @param {{store?: Store, host?: string, translate?: Function, allowedHosts?: string[]}} opts
 */
export function createServer({
  store = new Store(), translate = requestTranslation, allowedHosts = [],
  secrets = new FileSecrets(path.join(store.home, 'credentials.json')), fetch = globalThis.fetch, desktop = false,
} = {}) {
  useSecrets(secrets);
  // One emulator download at a time; the library page polls its progress.
  const install = { running: false, done: 0, total: 0, label: '', bytes: 0, error: null, finishedAt: null };
  function startInstall(opts) {
    if (install.running) return;
    runtimePlan(opts); // throws on an unknown core name, before anything starts
    Object.assign(install, { running: true, done: 0, total: 0, label: '', bytes: 0, error: null, finishedAt: null });
    installRuntime({ ...opts, fetch, log: () => {}, onProgress: (p) => Object.assign(install, p) })
      .catch((e) => { install.error = e.message; })
      .finally(() => { install.running = false; install.finishedAt = new Date().toISOString(); });
  }
  const memories = new Map();
  const memoryFor = (id) => {
    if (!memories.has(id)) memories.set(id, new TranslationMemory(path.join(store.dirs.translations, `${id}.json`)));
    return memories.get(id);
  };
  const inFlight = new Map();

  const needGame = (id) => {
    const g = store.get(id);
    if (!g) throw new HttpError(404, 'No such game in the library');
    return g;
  };

  async function handleTranslate(req, res, game) {
    const body = await readJsonBody(req, 20 * 1048576);
    const { image, width, height, hash, force } = body;
    if (typeof image !== 'string' || !image.length) throw new HttpError(400, 'image (base64 PNG) is required');
    if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096)) throw new HttpError(400, 'width and height must be 1..4096');
    const memory = memoryFor(game.id);
    const settings = { ...store.settings, ...(body.settings || {}) };
    const cacheKey = hash ? `${hash}|${settings.targetLanguage}|${settings.style}` : null;
    if (!force) {
      const hit = memory.cachedScreen(cacheKey);
      if (hit) return sendJson(res, 200, { ...hit, cached: true, usage: memory.usage });
    }
    // Two identical requests at once (double press) share one Claude call.
    if (cacheKey && inFlight.has(cacheKey)) return sendJson(res, 200, { ...(await inFlight.get(cacheKey)), cached: true, usage: memory.usage });
    const work = (async () => {
      const started = Date.now();
      const { result, usage, model } = await translate({
        imageBase64: image.replace(/^data:image\/png;base64,/, ''),
        width, height,
        game: { ...store.publicGame(game), notes: game.notes },
        settings,
        glossary: memory.glossary,
        recent: memory.recentLines(10),
      });
      const cost = estimateCost(settings.model, usage);
      memory.addUsage(usage, cost);
      const termsAdded = memory.addTerms(result.newTerms, 'suggested');
      const added = memory.addLines(result.lines, settings.targetLanguage);
      const out = { ...result, model, ms: Date.now() - started, costUsd: cost, termsAdded, linesAdded: added.length };
      memory.rememberScreen(cacheKey, out);
      memory.save();
      return out;
    })();
    if (cacheKey) inFlight.set(cacheKey, work);
    try {
      const out = await work;
      sendJson(res, 200, { ...out, cached: false, usage: memory.usage });
    } finally {
      if (cacheKey) inFlight.delete(cacheKey);
    }
  }

  async function route(req, res, url) {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Malformed URL'); }
    const m = (re) => re.exec(p);
    const method = req.method;
    let r;

    // --- pages and static files ------------------------------------------------
    if ((method === 'GET' || method === 'HEAD') && (p === '/' || p === '/index.html')) return sendFile(req, res, path.join(WEB_ROOT, 'index.html'));
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/play\/([0-9a-f]{12})$/))) { needGame(r[1]); return sendFile(req, res, path.join(WEB_ROOT, 'player.html')); }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/assets\/(.+)$/))) {
      const f = path.join(WEB_ROOT, path.posix.normalize('/' + r[1]));
      if (!f.startsWith(WEB_ROOT + path.sep)) throw new HttpError(404, 'Not found');
      return sendFile(req, res, f);
    }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/emu\/([0-9a-f]{12})$/))) {
      const game = needGame(r[1]);
      if (!emulatorjsDataDir()) throw new HttpError(503, 'The emulator runtime is not installed. Run: npm run setup');
      const slot = url.searchParams.has('slot') ? Number(url.searchParams.get('slot')) : undefined;
      const html = emulatorPage(store, game, { slot });
      res.writeHead(200, { 'Content-Type': TYPES.html, 'Cache-Control': 'no-store' });
      return res.end(method === 'HEAD' ? undefined : html);
    }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/ejs\/(.+)$/))) {
      const f = resolveRuntimePath(r[1]);
      if (!f) throw new HttpError(404, 'Not found in the emulator runtime');
      return sendFile(req, res, f, { cache: r[1].startsWith('cores/') ? 'public, max-age=86400' : 'no-cache' });
    }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/rom\/([0-9a-f]{12})\/extra\/(\d+)\/[^/]+$/))) {
      const f = needGame(r[1]).extraFiles[Number(r[2])];
      if (!f) throw new HttpError(404, 'Not found');
      return sendFile(req, res, f, { type: 'application/octet-stream' });
    }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/rom\/([0-9a-f]{12})\/[^/]+$/))) {
      return sendFile(req, res, needGame(r[1]).file, { type: 'application/octet-stream' });
    }
    if ((method === 'GET' || method === 'HEAD') && (r = m(/^\/bios\/([^/]+)$/))) {
      const f = path.join(store.dirs.bios, path.basename(r[1]));
      return sendFile(req, res, f, { type: 'application/octet-stream' });
    }

    // --- API ---------------------------------------------------------------------
    if (method === 'GET' && p === '/api/status') {
      return sendJson(res, 200, {
        version: VERSION,
        home: store.home,
        desktop,
        runtime: { installed: !!emulatorjsDataDir(), dir: runtimeDir(), emulatorjs: EMULATORJS_VERSION, cores: installedCores(), installing: install.running },
        credentials: credentialStatus(),
        games: Object.keys(store.games).length,
      });
    }
    if (p === '/api/runtime/install') {
      if (method === 'GET') return sendJson(res, 200, install);
      if (method === 'POST') {
        const body = await readJsonBody(req);
        try {
          startInstall({ cores: Array.isArray(body.cores) ? body.cores : undefined, all: body.all === true });
        } catch (e) {
          throw new HttpError(400, e.message);
        }
        return sendJson(res, 202, install);
      }
    }
    if (p === '/api/credentials') {
      if (method === 'GET') return sendJson(res, 200, credentialStatus());
      if (method === 'PUT') {
        const { apiKey } = await readJsonBody(req);
        if (!looksLikeApiKey(apiKey)) throw new HttpError(400, 'That does not look like a Claude API key. It starts with sk-ant- (copy it from console.anthropic.com).');
        secrets.set(apiKey.trim());
        resetClient();
        return sendJson(res, 200, credentialStatus());
      }
      if (method === 'DELETE') {
        secrets.clear();
        resetClient();
        return sendJson(res, 200, credentialStatus());
      }
    }
    if (method === 'POST' && p === '/api/credentials/test') return sendJson(res, 200, await testCredentials());
    if (method === 'GET' && p === '/api/systems') {
      const cores = new Set(installedCores());
      return sendJson(res, 200, Object.entries(SYSTEMS).map(([id, s]) => ({ id, ...s, installed: cores.has(s.core) })));
    }
    if (method === 'GET' && p === '/api/options') {
      return sendJson(res, 200, { models: MODELS, efforts: EFFORTS, styles: STYLES });
    }
    if (method === 'GET' && p === '/api/settings') return sendJson(res, 200, store.settings);
    if (method === 'PATCH' && p === '/api/settings') {
      try { return sendJson(res, 200, store.updateSettings(await readJsonBody(req))); } catch (e) { throw new HttpError(400, e.message); }
    }
    if (method === 'GET' && p === '/api/games') return sendJson(res, 200, store.list());
    if (method === 'POST' && p === '/api/demo') {
      // The bundled demo: a short DOS scene with Japanese dialogue, made for trying translation.
      const dest = path.join(store.dirs.library, 'Hoshifuri (Japan) (Demo).com');
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(PACKAGE_ROOT, 'demo', 'HOSHI.COM'), dest);
      const g = store.get(Store.idFor(dest)) || store.addFile(dest);
      if (!g.notes) store.update(g.id, { notes: 'Demo scene: the village elder (村長) talks to the heroine Lina (リナ).' });
      return sendJson(res, 201, store.publicGame(g));
    }
    if (method === 'POST' && p === '/api/scan') return sendJson(res, 200, { ...store.scan(), games: store.list() });
    if (method === 'PUT' && p === '/api/upload') {
      const name = url.searchParams.get('name');
      if (!name) throw new HttpError(400, 'name is required');
      try {
        const g = await store.importStream(name, req);
        return sendJson(res, 201, store.publicGame(g));
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }
    if ((r = m(/^\/api\/games\/([0-9a-f]{12})$/))) {
      const game = needGame(r[1]);
      if (method === 'GET') return sendJson(res, 200, store.publicGame(game));
      if (method === 'PATCH') {
        try { return sendJson(res, 200, store.update(game.id, await readJsonBody(req))); } catch (e) { throw new HttpError(400, e.message); }
      }
      if (method === 'DELETE') {
        store.remove(game.id, { deleteFile: url.searchParams.get('deleteFile') === '1' });
        return sendJson(res, 200, { ok: true });
      }
    }
    if ((r = m(/^\/api\/games\/([0-9a-f]{12})\/cover$/))) {
      const game = needGame(r[1]);
      if (method === 'GET' || method === 'HEAD') return sendFile(req, res, store.coverPath(game.id), { type: TYPES.png });
      if (method === 'PUT') {
        const png = await readBody(req, 8 * 1048576);
        if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new HttpError(400, 'Cover must be a PNG');
        fs.writeFileSync(store.coverPath(game.id), png);
        return sendJson(res, 200, { ok: true });
      }
    }
    if (method === 'GET' && (r = m(/^\/api\/games\/([0-9a-f]{12})\/saves$/))) return sendJson(res, 200, store.listSaves(needGame(r[1]).id));
    if ((r = m(/^\/api\/games\/([0-9a-f]{12})\/saves\/(\d{1,2})(?:\/(state|png))?$/))) {
      const game = needGame(r[1]);
      const slot = Number(r[2]);
      if ((method === 'GET' || method === 'HEAD') && r[3]) return sendFile(req, res, store.savePath(game.id, slot, r[3]), { type: r[3] === 'png' ? TYPES.png : 'application/octet-stream' });
      if (method === 'PUT' && !r[3]) {
        // Body: picture bytes (length in X-Picture-Length, may be 0) followed by the state.
        const body = await readBody(req, 256 * 1048576);
        const picLen = Math.min(Number(req.headers['x-picture-length'] || 0), body.length);
        const meta = store.writeSave(game.id, slot, body.subarray(picLen), body.subarray(0, picLen));
        return sendJson(res, 200, meta);
      }
      if (method === 'DELETE' && !r[3]) { store.deleteSave(game.id, slot); return sendJson(res, 200, { ok: true }); }
    }
    if (method === 'POST' && (r = m(/^\/api\/games\/([0-9a-f]{12})\/translate$/))) return handleTranslate(req, res, needGame(r[1]));
    if ((r = m(/^\/api\/games\/([0-9a-f]{12})\/script$/))) {
      const mem = memoryFor(needGame(r[1]).id);
      if (method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit') || 300), 5000);
        return sendJson(res, 200, { lines: mem.lines.slice(-limit), total: mem.lines.length, glossary: mem.glossary, usage: mem.usage });
      }
      if (method === 'DELETE') { mem.clearScript(); mem.save(); return sendJson(res, 200, { ok: true }); }
    }
    if (method === 'PUT' && (r = m(/^\/api\/games\/([0-9a-f]{12})\/glossary$/))) {
      const mem = memoryFor(needGame(r[1]).id);
      const body = await readJsonBody(req);
      if (!Array.isArray(body.glossary)) throw new HttpError(400, 'glossary must be a list of {source, target, note}');
      mem.setGlossary(body.glossary);
      mem.save();
      return sendJson(res, 200, { glossary: mem.glossary });
    }
    if (method === 'GET' && (r = m(/^\/api\/games\/([0-9a-f]{12})\/export$/))) {
      const game = needGame(r[1]);
      const format = ['csv', 'tmx', 'txt'].includes(url.searchParams.get('format')) ? url.searchParams.get('format') : 'txt';
      const out = exportScript(memoryFor(game.id), format, { title: game.title, sourceLanguage: game.sourceLanguage, targetLanguage: store.settings.targetLanguage });
      res.writeHead(200, { 'Content-Type': out.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${game.title} script.${out.ext}`)}`, 'Cache-Control': 'no-store' });
      return res.end(out.body);
    }
    throw new HttpError(404, 'Not found');
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', ...allowedHosts]);
  const server = http.createServer(async (req, res) => {
    baseHeaders(res);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      // DNS-rebinding guard: only answer to names that point at this computer.
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!localHosts.has(host)) throw new HttpError(403, 'Unknown host name. Start retroglot with --allow-host to use it from another name.');
      // Changes may only come from retroglot's own pages.
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) throw new HttpError(403, 'Cross-site request refused');
      }
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof TranslationError) return sendJson(res, err.status, { error: err.message, code: err.code, hint: err.hint });
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      sendJson(res, status, { error: status === 500 ? `Internal error: ${err.message}` : err.message, ...(err.extra || {}) });
    }
  });
  server.store = store;
  return server;
}
