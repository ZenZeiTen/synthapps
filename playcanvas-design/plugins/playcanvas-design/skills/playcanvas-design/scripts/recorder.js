// Injected by render.mjs into every served HTML page, before any other script.
// It holds back the engine's own animation-frame loop, then steps app.tick()
// with fake timestamps exactly 1/fps apart and uploads each rendered frame.
(() => {
    const cfg = __RENDER_CONFIG__;
    window.__RENDER__ = cfg; // code scenes read this to size the canvas / enable alpha
    if (!cfg.capture) return;

    // Editor builds: __settings__.js assigns window.CONTEXT_OPTIONS, which __start__.js
    // passes to pc.createGraphicsDevice. Force a readable, fixed device here.
    let ctxOpts;
    Object.defineProperty(window, 'CONTEXT_OPTIONS', {
        configurable: true,
        get: () => ctxOpts,
        set: (v) => {
            ctxOpts = Object.assign({}, v, {
                deviceTypes: [cfg.device],
                preserveDrawingBuffer: true,
                alpha: !!cfg.alpha || !!(v && v.alpha)
            });
        }
    });

    const post = (url, body) => fetch(url, { method: 'POST', body });
    const log = m => post('/__log', String(m)).catch(() => {});
    window.__renderLog = log;
    // Save any data next to the frames: await __renderSave('model.glb', arrayBuffer)
    window.__renderSave = async (name, data) => {
        const res = await post(`/__file?name=${encodeURIComponent(name)}`, data);
        if (!res.ok) throw new Error(`save failed: ${name}`);
    };
    let failed = false;
    const fail = (msg) => {
        if (failed) return;
        failed = true;
        post('/__done', JSON.stringify({ error: msg }));
    };
    window.addEventListener('error', e => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', e => log(`rejection: ${e.reason && (e.reason.stack || e.reason)}`));
    const origError = console.error.bind(console);
    console.error = (...a) => { log(`console.error: ${a.map(String).join(' ')}`); origError(...a); };
    const origWarn = console.warn.bind(console);
    console.warn = (...a) => { log(`console.warn: ${a.map(String).join(' ')}`); origWarn(...a); };

    // Hold the engine's frame callback; pass every other rAF user through.
    const realRAF = window.requestAnimationFrame.bind(window);
    const realCAF = window.cancelAnimationFrame.bind(window);
    let appTick = null;
    let nextId = 1;
    const others = new Map();
    const isAppTick = (cb) => {
        if (!cb) return false;
        if (cb.name === 'tick') return true;
        const app = window.app || (window.pc && window.pc.app);
        return !!(app && app.tick === cb);
    };
    window.requestAnimationFrame = (cb) => {
        const id = nextId++;
        if (isAppTick(cb)) { appTick = cb; return id; }
        others.set(id, realRAF((t) => { others.delete(id); cb(t); }));
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        const r = others.get(id);
        if (r !== undefined) { realCAF(r); others.delete(id); }
    };

    // Scripted input for hooks: __renderKey('down'|'up', 'w' | 'ArrowUp' | 'Space' ...).
    // pc.Keyboard reads event.keyCode, which synthetic KeyboardEvents leave at 0.
    const KEYCODES = { Space: 32, Enter: 13, Escape: 27, Shift: 16, Control: 17, Alt: 18, Tab: 9,
        ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
    window.__renderKey = (type, key, target = window) => {
        const code = KEYCODES[key] ?? key.toUpperCase().charCodeAt(0);
        const ev = new KeyboardEvent(type === 'up' ? 'keyup' : 'keydown', { key, bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'keyCode', { get: () => code });
        Object.defineProperty(ev, 'which', { get: () => code });
        target.dispatchEvent(ev);
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function main() {
        const t0 = performance.now();
        while (!appTick) {
            if (performance.now() - t0 > 120000) return fail('app never started: no engine tick was requested within 120 s');
            await sleep(20);
        }
        const app = window.app || (window.pc && window.pc.app) || null;
        if (window.__renderReady) {
            try { await window.__renderReady; } catch (e) { return fail(`__renderReady rejected: ${e}`); }
        }
        const canvas = (app && app.graphicsDevice && app.graphicsDevice.canvas) || document.querySelector('canvas');
        if (!canvas) return fail('no canvas found');
        if (app) {
            app.setCanvasFillMode('NONE', cfg.width, cfg.height);      // pc.FILLMODE_NONE
            app.setCanvasResolution('FIXED', cfg.width, cfg.height);   // pc.RESOLUTION_FIXED
        } else {
            canvas.width = cfg.width;
            canvas.height = cfg.height;
        }
        if (!(cfg.frames > 0)) {
            const d = window.__duration;
            if (!(d > 0)) return fail('--duration auto: the page did not set window.__duration (seconds) before __renderReady resolved');
            cfg.frames = Math.round(d * cfg.fps) + (cfg.extra || 0);
            await post('/__meta', JSON.stringify({ frames: cfg.frames, duration: d }));
        }
        const step = 1000 / cfg.fps;
        let t = 1000;
        const total = cfg.warmup + cfg.frames;
        for (let k = 0; k < total; k++) {
            if (failed) return;
            // optional per-frame hook (render.mjs --hook): k counts warmup frames too,
            // seconds = k / fps is the scene time this tick will reach
            if (window.__renderHook) {
                try { await window.__renderHook(k, k / cfg.fps, app); } catch (e) { return fail(`hook threw at k=${k}: ${e}`); }
            }
            appTick(t);            // k = 0 runs with dt = 0 (engine's first-frame rule)
            t += step;
            if (k < cfg.warmup) continue;
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            if (!blob) return fail(`toBlob returned null at frame ${k - cfg.warmup}`);
            const res = await post(`/__frame?i=${k - cfg.warmup}`, blob);
            if (!res.ok) return fail(`frame upload failed at ${k - cfg.warmup}`);
        }
        // One more hook call after the last tick (k === total) so a hook can read
        // the state of the final frame (a hook at k otherwise sees the state before tick k).
        if (window.__renderHook) {
            try { await window.__renderHook(total, total / cfg.fps, app, { final: true }); } catch (e) { return fail(`hook threw after the last frame: ${e}`); }
        }
        post('/__done', JSON.stringify({
            width: canvas.width,
            height: canvas.height,
            deviceType: app && app.graphicsDevice ? app.graphicsDevice.deviceType : null
        }));
    }
    main().catch(e => fail(`recorder crashed: ${e && (e.stack || e)}`));
})();
