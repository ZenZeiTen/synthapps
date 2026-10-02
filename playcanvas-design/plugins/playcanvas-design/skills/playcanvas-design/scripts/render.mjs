#!/usr/bin/env node
// Deterministic offline renderer for PlayCanvas pages (zero dependencies).
//
// Serves a folder (an Editor static build or a code scene), injects a recorder
// into every HTML page, launches headless Chrome, steps the app clock by hand
// (exactly 1/fps per frame) and writes each frame as a PNG.
//
//   node render.mjs --root <dir> [--page index.html] --out <frames dir>
//                   [--width 1280] [--height 720] [--fps 30]
//                   [--frames N | --duration S|auto] [--extra 0] [--alpha] [--warmup 0]
//   --duration auto: frames = round(window.__duration * fps), read once the page is ready
//   --extra N: render N frames past the duration (--extra 1 proves a loop: frame N == frame 0)
//                   [--device webgl2] [--chrome <path>] [--engine <playcanvas.mjs>]
//                   [--hook hook.js] [--headed] [--timeout 300]
//   --hook: a classic script loaded right after the recorder; it may define
//           window.__renderHook = (k, seconds, app) => {...} (called before each tick)
//           and use window.__renderKey('down'|'up', key) for scripted keyboard input.
//   node render.mjs --root <dir> --serve [--port 8790]   (preview only, no capture)
//
// Output: <out>/frame_00000.png ... plus <out>/manifest.json, plus any files the page
// saves with window.__renderSave(name, ArrayBuffer|Blob|string) (e.g. a GLB export;
// await it inside the scene or a --hook so it lands before the last frame).
// Exit code 0 only when every frame arrived.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (!k.startsWith('--')) throw new Error(`unexpected argument: ${k}`);
        const key = k.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) a[key] = true;
        else { a[key] = next; i++; }
    }
    return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
    console.error('usage: node render.mjs --root <dir> --out <frames dir> [--width --height --fps --frames|--duration --alpha] | --serve');
    process.exit(2);
}

const root = path.resolve(args.root);
const page = args.page || 'index.html';
const serveOnly = !!args.serve;
const width = parseInt(args.width ?? 1280, 10);
const height = parseInt(args.height ?? 720, 10);
const fps = parseFloat(args.fps ?? 30);
const autoDuration = args.duration === 'auto';   // read window.__duration from the page
let frames = args.frames ? parseInt(args.frames, 10)
    : autoDuration ? -1 : Math.round(parseFloat(args.duration ?? 2) * fps);
const extra = parseInt(args.extra ?? 0, 10);      // extra frames after the duration (loop proof: --extra 1)
if (frames > 0) frames += extra;
const warmup = parseInt(args.warmup ?? 0, 10);
const alpha = !!args.alpha;
const device = args.device || 'webgl2';
const timeoutS = parseFloat(args.timeout ?? 300);
const outDir = args.out ? path.resolve(args.out) : null;
const hookPath = args.hook ? path.resolve(args.hook) : null;
if (hookPath && !fs.existsSync(hookPath)) { console.error(`hook not found: ${hookPath}`); process.exit(2); }

// node_modules/playcanvas/build/playcanvas.mjs in `dir` or any parent folder
function findEngineUp(dir) {
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        const f = path.join(d, 'node_modules', 'playcanvas', 'build', 'playcanvas.mjs');
        if (fs.existsSync(f)) return f;
        if (path.dirname(d) === d) return null;
    }
}
const ENGINE_CANDIDATES = [
    args.engine,
    process.env.PLAYCANVAS_ENGINE,
    findEngineUp(root),
    findEngineUp(process.cwd()),
    findEngineUp(path.join(HERE, '..'))
].filter(Boolean);
const enginePath = ENGINE_CANDIDATES.find(p => fs.existsSync(p));

const CHROME_CANDIDATES = [
    args.chrome,
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

if (!serveOnly) {
    if (!outDir) { console.error('--out is required unless --serve'); process.exit(2); }
    if (!(frames > 0) && !autoDuration) { console.error('--frames/--duration must give at least one frame'); process.exit(2); }
    if (fps < 10) { console.error('--fps below 10 is clamped by the engine (maxDeltaTime 0.1); raise app.maxDeltaTime in the scene or use fps >= 10'); }
    fs.mkdirSync(outDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) if (/^frame_\d+\.png$/.test(f)) fs.unlinkSync(path.join(outDir, f));
}

const config = { width, height, fps, frames, extra, warmup, alpha, device, capture: !serveOnly };
const recorderSrc = fs.readFileSync(path.join(HERE, 'recorder.js'), 'utf8')
    .replace('__RENDER_CONFIG__', JSON.stringify(config));

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
    '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.hdr': 'application/octet-stream',
    '.basis': 'application/octet-stream', '.dds': 'application/octet-stream', '.ktx2': 'application/octet-stream',
    '.txt': 'text/plain', '.ttf': 'font/ttf', '.woff2': 'font/woff2'
};

let received = 0;
let finished = false;
let chrome = null;
const logs = [];
const started = Date.now();

function finish(code, summary) {
    if (finished) return;
    finished = true;
    if (outDir && summary) {
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(summary, null, 2));
    }
    if (chrome) { try { chrome.kill(); } catch { /* already gone */ } }
    server.close();
    setTimeout(() => process.exit(code), 200);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// Editor builds read config.json; force the device and canvas alpha there so
// the recorder can read pixels back reliably.
function patchConfigJson(buf) {
    try {
        const json = JSON.parse(buf.toString('utf8'));
        const ap = json.application_properties;
        if (ap && !serveOnly) {
            ap.deviceTypes = [device];
            if (alpha) ap.transparentCanvas = true;
            ap.preserveDrawingBuffer = true;
            ap.useDevicePixelRatio = false;
        }
        return Buffer.from(JSON.stringify(json));
    } catch {
        return buf;
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    try {
        if (req.method === 'POST' && p === '/__frame') {
            const i = parseInt(url.searchParams.get('i'), 10);
            const body = await readBody(req);
            fs.writeFileSync(path.join(outDir, `frame_${String(i).padStart(5, '0')}.png`), body);
            received++;
            if (received % 30 === 0 || received === frames) process.stdout.write(`frames ${received}/${frames}\n`);
            res.end('ok');
            return;
        }
        if (req.method === 'POST' && p === '/__file') {
            // window.__renderSave(name, data) -> <out>/<name> (GLB exports, JSON, etc.)
            const name = path.basename(url.searchParams.get('name') || 'file.bin');
            const body = await readBody(req);
            fs.writeFileSync(path.join(outDir, name), body);
            console.log(`saved ${name} (${body.length} bytes)`);
            res.end('ok');
            return;
        }
        if (req.method === 'POST' && p === '/__meta') {
            const m = JSON.parse((await readBody(req)).toString('utf8'));
            if (m.frames > 0) { frames = m.frames; console.log(`duration auto: ${frames} frames (window.__duration = ${m.duration} s${extra ? ` + ${extra} extra` : ''})`); }
            res.end('ok');
            return;
        }
        if (req.method === 'POST' && p === '/__log') {
            const t = (await readBody(req)).toString('utf8');
            logs.push(t);
            console.log(`[page] ${t}`);
            res.end('ok');
            return;
        }
        if (req.method === 'POST' && p === '/__done') {
            const info = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            res.end('ok');
            const ok = received === frames && !info.error;
            const summary = {
                ok, fps, frames, extra, received, width: info.width ?? width, height: info.height ?? height,
                alpha, device: info.deviceType ?? device, seconds: (Date.now() - started) / 1000,
                error: info.error ?? null, pageLogs: logs.slice(-50)
            };
            console.log(ok ? `done: ${received} frames ${summary.width}x${summary.height} in ${summary.seconds.toFixed(1)} s`
                : `FAILED: ${info.error ?? `${received}/${frames} frames`}`);
            finish(ok ? 0 : 1, summary);
            return;
        }
        if (p === '/__recorder.js') {
            res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
            res.end(recorderSrc);
            return;
        }
        if (p === '/__hook.js') {
            res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
            res.end(hookPath ? fs.readFileSync(hookPath) : '');
            return;
        }
        if (p === '/__engine/playcanvas.mjs') {
            if (!enginePath) {
                const msg = 'PlayCanvas engine not found: run `npm i playcanvas` in the scene folder, or pass --engine <playcanvas.mjs>';
                console.error(msg);
                res.writeHead(404); res.end('engine not found');
                if (!serveOnly) finish(1, { ok: false, received, frames, error: msg });
                return;
            }
            res.writeHead(200, { 'content-type': 'text/javascript' });
            fs.createReadStream(enginePath).pipe(res);
            return;
        }
        let file = path.join(root, p === '/' ? page : p);
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
        const ext = path.extname(file).toLowerCase();
        let buf = fs.readFileSync(file);
        if (ext === '.html') {
            const tag = '<script src="/__recorder.js"></script>' + (hookPath ? '<script src="/__hook.js"></script>' : '');
            let html = buf.toString('utf8');
            html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => `${m}\n${tag}`) : tag + html;
            buf = Buffer.from(html);
        } else if (path.basename(file) === 'config.json') {
            buf = patchConfigJson(buf);
        }
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
    } catch (e) {
        res.writeHead(500);
        res.end(String(e));
    }
});

server.listen(parseInt(args.port ?? 0, 10), '127.0.0.1', () => {
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/${page}`;
    if (serveOnly) {
        console.log(`serving ${root} at ${url} (preview mode, Ctrl+C to stop)`);
        return;
    }
    const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
    if (!chromePath) { console.error('Chrome/Edge not found; pass --chrome'); finish(2); return; }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-render-'));
    const flags = [
        args.headed ? null : '--headless=new',
        `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', '--force-device-scale-factor=1',
        `--window-size=${width},${height}`, '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
        '--autoplay-policy=no-user-gesture-required', '--mute-audio', url
    ].filter(Boolean);
    chrome = spawn(chromePath, flags, { stdio: 'ignore' });
    chrome.on('exit', code => { if (!finished) { console.error(`Chrome exited early (code ${code})`); finish(1, { ok: false, received, frames, error: 'chrome exited' }); } });
    console.log(`rendering ${frames > 0 ? frames : 'auto'} frames @ ${fps} fps, ${width}x${height}${alpha ? ' alpha' : ''} from ${url}`);
});

setTimeout(() => {
    if (!serveOnly && !finished) {
        console.error(`timeout after ${timeoutS} s: ${received}/${frames} frames`);
        finish(1, { ok: false, received, frames, error: 'timeout', pageLogs: logs.slice(-50) });
    }
}, timeoutS * 1000);
