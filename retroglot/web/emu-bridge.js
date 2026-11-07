// Runs inside the emulator frame, next to EmulatorJS. Gives the player page a
// small, stable interface to the running game: screenshots, save states,
// pause, fast-forward and where on screen the picture is drawn.
(function () {
  'use strict';
  var HOTKEYS = { F1: 1, F2: 1, F3: 1, F4: 1, F6: 1, F7: 1, F8: 1, Backquote: 1, F9: 1 };
  var CONFIG = window.RETROGLOT || {};
  var SHADERS = CONFIG.displayShaders || { crt: 'crt-easymode.glslp', sharp: 'disabled', smooth: 'sabr' };
  var startedAt = 0;

  // EmulatorJS writes the core options file from the options it saved for this game in
  // localStorage, and only falls back to EJS_defaultOptions when nothing is saved. Picture
  // enhancements are chosen in retroglot, so write them there before the core starts.
  (function seedCoreOptions(seed) {
    if (!seed || !seed.key || !seed.options) return;
    try {
      var saved = null;
      try { saved = JSON.parse(window.localStorage.getItem(seed.key)); } catch (e) { saved = null; }
      if (!saved || typeof saved !== 'object') saved = {};
      var settings = saved.settings && typeof saved.settings === 'object' ? saved.settings : {};
      for (var k in seed.options) settings[k] = seed.options[k];
      saved.settings = settings;
      window.localStorage.setItem(seed.key, JSON.stringify(saved));
    } catch (e) { /* storage blocked: EJS_defaultOptions still apply after start */ }
  })(CONFIG.coreOptions);

  function emu() { return window.EJS_emulator; }
  function gm() { return emu() && emu().gameManager; }

  // ---------- in-game saves ----------
  // The game's own saves (battery saves, memory cards, the PSP memory stick) live in the
  // emulator's save folder (/data/saves, kept in the browser). EmulatorJS writes them there only
  // every few minutes and as the page closes, which can be lost when the player leaves the game.
  // retroglot keeps the real copy on disk: the server puts it in this page (CONFIG.ingame.files),
  // it is written into the save folder before the game boots, and changes go back every few
  // seconds and whenever the player page asks (flushSaves).
  var SAVE_ROOT = '/data/saves/';
  var ING = CONFIG.ingame || null;
  var baseline = {}; // save path -> hash of the copy on disk
  var restoredSaves = 0;

  function hashBytes(u8) {
    var h = 0x811c9dc5;
    for (var i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ':' + u8.length;
  }
  function b64decode(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64encode(u8) {
    var parts = [];
    for (var i = 0; i < u8.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)));
    return btoa(parts.join(''));
  }
  function mkdirs(FS, dir) {
    var cur = '';
    dir.split('/').forEach(function (p) {
      if (!p) return;
      cur += '/' + p;
      try { FS.mkdir(cur); } catch (e) { /* exists */ }
    });
  }

  /** Write the saves from disk into the emulator's save folder, before the game boots. */
  function restoreSaves(FS) {
    if (!ING || !ING.files) return;
    ING.files.forEach(function (f) {
      try {
        var data = b64decode(f.data);
        var full = SAVE_ROOT + f.path;
        mkdirs(FS, full.slice(0, full.lastIndexOf('/')));
        FS.writeFile(full, data);
        baseline[f.path] = hashBytes(data);
        restoredSaves++;
      } catch (e) { console.warn('retroglot: could not restore ' + f.path, e); }
    });
    ING.files = null; // free the copy
  }

  // EmulatorJS raises "saveDatabaseLoaded" after it has mounted the save folder and before it
  // downloads and starts the game. Catch the emulator object as the loader creates it.
  (function watchEmulator() {
    var instance;
    try {
      Object.defineProperty(window, 'EJS_emulator', {
        configurable: true,
        get: function () { return instance; },
        set: function (v) {
          instance = v;
          if (v && typeof v.on === 'function') v.on('saveDatabaseLoaded', function (FS) { restoreSaves(FS); });
        },
      });
    } catch (e) { /* cannot happen in a fresh frame */ }
  })();

  /** The save files that belong to this game, read from the emulator's save folder. */
  function collectSaves() {
    var g = gm();
    if (!g || !g.FS) return [];
    var FS = g.FS, out = [], seen = {};
    function add(full) {
      if (seen[full]) return;
      seen[full] = 1;
      try { out.push({ path: full.slice(SAVE_ROOT.length), data: FS.readFile(full) }); } catch (e) { /* vanished */ }
    }
    // Make the core write its save memory to the save file now.
    try { g.functions.saveSaveFiles(); } catch (e) { /* core without save memory */ }
    var savePath = '';
    try { savePath = g.getSaveFilePath() || ''; } catch (e) { savePath = ''; }
    if (savePath.indexOf(SAVE_ROOT) === 0) {
      // Files next to the save file with the same name: Zelda.srm, HOSHIFUR.pure.zip, Game.sav...
      var dir = savePath.slice(0, savePath.lastIndexOf('/'));
      var name = savePath.slice(dir.length + 1);
      var stem = name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name;
      try {
        FS.readdir(dir).forEach(function (n) {
          if (n !== name && n.indexOf(stem + '.') !== 0) return;
          var full = dir + '/' + n;
          if (FS.isFile(FS.stat(full).mode)) add(full);
        });
      } catch (e) { /* no save folder yet */ }
    }
    if (ING && ING.shared) {
      (function walk(dir, depth) {
        var names = [];
        try { names = FS.readdir(dir); } catch (e) { return; }
        names.forEach(function (n) {
          if (n === '.' || n === '..') return;
          var full = dir + '/' + n, st = FS.stat(full);
          if (FS.isDir(st.mode)) { if (depth < 6) walk(full, depth + 1); } else add(full);
        });
      })(SAVE_ROOT + ING.shared, 0);
    }
    return out;
  }

  var syncing = null;
  var lastSync = { at: 0, error: null, files: 0 };
  /** Send changed save files to disk. Resolves to the number of files written. */
  function syncSaves(opts) {
    opts = opts || {};
    if (!ING || !startedAt) return Promise.resolve(0);
    if (syncing) return syncing.then(function () { return syncSaves(opts); });
    var changed = collectSaves().filter(function (f) { return baseline[f.path] !== hashBytes(f.data); });
    if (!changed.length) return Promise.resolve(0);
    var body = JSON.stringify({ files: changed.map(function (f) { return { path: f.path, data: b64encode(f.data) }; }) });
    var req = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body };
    if (opts.keepalive && body.length < 60000) req.keepalive = true;
    syncing = realFetch(ING.url, req).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      changed.forEach(function (f) { baseline[f.path] = hashBytes(f.data); });
      lastSync = { at: Date.now(), error: null, files: changed.length };
      post({ type: 'retroglot:saves', files: changed.map(function (f) { return f.path; }) });
      return changed.length;
    }, function (err) { throw err; }).catch(function (err) {
      lastSync = { at: lastSync.at, error: String(err && err.message || err), files: 0 };
      throw err;
    }).finally(function () { syncing = null; });
    return syncing;
  }

  // ---------- screen shape ----------
  // 'original' keeps the game's own shape; 'wide' stretches it to 16:9; 'fill' to the whole
  // window. The canvas is scaled with CSS, so it works the same for every core and the
  // translation overlay can follow it (gameRect).
  var screenMode = CONFIG.screen || 'original';
  function gameAspect() {
    var a = 0;
    try { a = gm().getVideoDimensions('aspect'); } catch (e) { a = 0; }
    return a > 0.2 && a < 5 ? a : 4 / 3;
  }
  function fit(W, H, aspect) { return W / H > aspect ? { w: H * aspect, h: H } : { w: W, h: W / aspect }; }
  function shapeScale(W, H) {
    var a = gameAspect(), lb = fit(W, H, a), t = null;
    if (screenMode === 'fill') t = { w: W, h: H };
    else if (screenMode === 'wide' && a < 16 / 9) t = fit(W, H, 16 / 9);
    return { lb: lb, sx: t ? t.w / lb.w : 1, sy: t ? t.h / lb.h : 1 };
  }
  function applyShape() {
    var e = emu();
    if (!e || !e.canvas) return;
    var c = e.canvas, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    var s = shapeScale(W, H);
    var tr = s.sx === 1 && s.sy === 1 ? '' : 'scale(' + s.sx.toFixed(5) + ',' + s.sy.toFixed(5) + ')';
    if (c.style.transform !== tr) {
      c.style.transformOrigin = '50% 50%';
      c.style.transform = tr;
    }
  }
  function post(msg) { try { window.parent.postMessage(msg, window.location.origin); } catch (e) { /* not framed */ } }

  function withTimeout(promise, ms, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(what + ' timed out')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // Keep the game frame offline: EmulatorJS checks its website for updates when
  // it runs on localhost. retroglot pins its version, so answer that check locally.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/^https?:\/\/cdn\.emulatorjs\.org\//.test(url)) {
      return Promise.resolve(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };

  var shotChain = Promise.resolve();

  window.retroglotBridge = {
    get started() { return !!startedAt; },
    get paused() { return !!(emu() && emu().paused); },
    get failed() { return !!(emu() && emu().failedToStart); },

    /** Picture mode: one of the keys of SHADERS ('crt', 'sharp', 'smooth', 'xbr', 'scalefx'). */
    setDisplay: function (mode) {
      var e = emu();
      var shader = SHADERS[mode] || 'disabled';
      if (!e || typeof e.enableShader !== 'function') return;
      try { if (e.changeSettingOption) e.changeSettingOption('shader', shader); e.enableShader(shader); } catch (err) { /* core without shader support */ }
    },
    core: function () { return emu() ? emu().getCore() : null; },

    /** PNG bytes of the current frame at the game's own resolution. */
    screenshot: function () {
      var run = function () {
        var g = gm();
        if (!g) return Promise.reject(new Error('The game is not running yet'));
        // RetroArch writes the picture from its main loop, so a paused game is resumed for a moment.
        var wasPaused = emu().paused;
        if (wasPaused) emu().play(true);
        return withTimeout(g.screenshot(), 4000, 'Screenshot').then(function (png) {
          if (wasPaused) emu().pause(true);
          return png;
        }, function (err) {
          if (wasPaused) emu().pause(true);
          throw err;
        });
      };
      // One screenshot at a time: they share a file name inside the emulator.
      var p = shotChain.then(run, run);
      shotChain = p.catch(function () {});
      return p;
    },

    /** Screen shape: 'original', 'wide' (16:9) or 'fill' (the whole window). */
    setScreen: function (mode) { screenMode = mode; applyShape(); },

    /** Write the game's own saves to disk now (also done every few seconds). */
    flushSaves: function (opts) { return syncSaves(opts); },
    saveStatus: function () { return { at: lastSync.at, error: lastSync.error, restored: restoredSaves }; },
    /** Replace the game's save file with `bytes` (an imported .srm/.sav) and restart the game. */
    importSave: function (bytes) {
      var g = gm();
      var p = g.getSaveFilePath();
      if (!p) throw new Error('This game has no save file');
      mkdirs(g.FS, p.slice(0, p.lastIndexOf('/')));
      g.FS.writeFile(p, bytes);
      g.loadSaveFiles();
      g.restart();
      return syncSaves();
    },

    getState: function () { return gm().getState(); },
    loadState: function (bytes) { gm().loadState(bytes); },
    supportsStates: function () { try { return gm().supportsStates(); } catch (e) { return false; } },
    pause: function () { if (emu() && !emu().paused) { emu().pause(); return true; } return false; },
    play: function () { if (emu() && emu().paused) emu().play(); },
    togglePause: function () { if (!emu()) return; if (emu().paused) emu().play(); else emu().pause(); },
    restart: function () { gm().restart(); },
    fastForward: function (on) { try { gm().toggleFastForward(on ? 1 : 0); } catch (e) { /* core without it */ } },
    focus: function () { window.focus(); var e = emu(); if (e && e.elements && e.elements.parent) e.elements.parent.focus(); },

    /** The rectangle (in frame pixels) where the game picture is drawn, after the screen shape. */
    gameRect: function () {
      var e = emu();
      if (!e || !e.canvas) return null;
      var c = e.canvas, r = c.getBoundingClientRect();
      var W = c.clientWidth || r.width, H = c.clientHeight || r.height;
      var s = shapeScale(W, H);
      var w = s.lb.w * s.sx, h = s.lb.h * s.sy;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2; // a scale about the centre keeps it
      return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    },
  };

  window.EJS_onGameStart = function () {
    startedAt = Date.now();
    applyShape();
    setInterval(applyShape, 500);
    window.addEventListener('resize', applyShape);
    // Saves from the browser that are not on disk yet (made before retroglot kept them) go there now.
    setTimeout(function () { syncSaves().catch(function () {}); }, 1500);
    setInterval(function () { syncSaves().catch(function () {}); }, 4000);
    post({ type: 'retroglot:start', core: emu().getCore() });
  };
  window.addEventListener('pagehide', function () { syncSaves({ keepalive: true }).catch(function () {}); });
  window.EJS_ready = function () { post({ type: 'retroglot:ready' }); };

  // Hand retroglot's shortcut keys to the player page instead of the game.
  function onKey(ev) {
    if (!HOTKEYS[ev.code]) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (ev.repeat && ev.type === 'keydown') return;
    post({ type: 'retroglot:key', code: ev.code, down: ev.type === 'keydown' });
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  // Tell the player page about mouse use, so it can show its controls.
  var lastPing = 0;
  function activity() {
    var now = Date.now();
    if (now - lastPing < 250) return;
    lastPing = now;
    post({ type: 'retroglot:activity' });
  }
  window.addEventListener('mousemove', activity, true);
  window.addEventListener('pointerdown', activity, true);

  window.addEventListener('error', function (ev) { post({ type: 'retroglot:error', message: String(ev.message || ev.error) }); });
})();
