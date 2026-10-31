// Runs inside the emulator frame, next to EmulatorJS. Gives the player page a
// small, stable interface to the running game: screenshots, save states,
// pause, fast-forward and where on screen the picture is drawn.
(function () {
  'use strict';
  var HOTKEYS = { F1: 1, F2: 1, F3: 1, F4: 1, F6: 1, F7: 1, Backquote: 1, F9: 1 };
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

    getState: function () { return gm().getState(); },
    loadState: function (bytes) { gm().loadState(bytes); },
    supportsStates: function () { try { return gm().supportsStates(); } catch (e) { return false; } },
    pause: function () { if (emu() && !emu().paused) { emu().pause(); return true; } return false; },
    play: function () { if (emu() && emu().paused) emu().play(); },
    togglePause: function () { if (!emu()) return; if (emu().paused) emu().play(); else emu().pause(); },
    restart: function () { gm().restart(); },
    fastForward: function (on) { try { gm().toggleFastForward(on ? 1 : 0); } catch (e) { /* core without it */ } },
    focus: function () { window.focus(); var e = emu(); if (e && e.elements && e.elements.parent) e.elements.parent.focus(); },

    /** The rectangle (in frame pixels) where the game picture is drawn, letterboxing removed. */
    gameRect: function () {
      var e = emu();
      if (!e || !e.canvas) return null;
      var r = e.canvas.getBoundingClientRect();
      var aspect = 0;
      try { aspect = gm().getVideoDimensions('aspect'); } catch (err) { aspect = 0; }
      if (!(aspect > 0.2 && aspect < 5)) aspect = 4 / 3;
      var w = r.width, h = r.height;
      if (w / h > aspect) w = h * aspect; else h = w / aspect;
      return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, width: w, height: h };
    },
  };

  window.EJS_onGameStart = function () {
    startedAt = Date.now();
    post({ type: 'retroglot:start', core: emu().getCore() });
  };
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
