// Crowmere Hill, browser build: boot, scene flow (title -> intro -> play -> ending),
// input, save/restore, and the glue between the pure core and the presentation.

import { Game } from './core.js';
import { Screen, Font, PIC_Y, PIC_W, PIC_H, SCREEN_W } from './gfx.js';
import { loadAll } from './assets.js';
import { UI } from './ui.js';
import { World } from './world.js';
import { Sound } from './audio.js';
import { deathOptions } from './death.js';
import { musicFor } from './music.js';

const TICK_MS = 40;
const SAVE_KEY = 'crowmere-hill.save.v1';
const HISTORY_MAX = 100;

// Sound and music on/off survive a reload: a per-viewer convenience, so any storage
// failure just means the defaults (both on).
const PREFS_KEY = 'crowmere-hill.prefs.v1';
function loadPrefs() {
  try { return JSON.parse(window.localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; }
}
function savePrefs(sound) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify({ sound: sound.enabled, music: sound.musicOn })); } catch (e) { /* not kept */ }
}

function storage(op, value) {
  try {
    if (op === 'get') return window.localStorage.getItem(SAVE_KEY);
    if (op === 'set') { window.localStorage.setItem(SAVE_KEY, value); return true; }
  } catch (e) { return op === 'get' ? null : false; }
  return null;
}

class App {
  async boot(canvas) {
    this.canvas = canvas;
    this.screen = new Screen(canvas);
    this.screen.clear(1);
    this.screen.present();
    this.assets = await loadAll();
    const A = this.assets;
    this.core = new Game(A.game, A.roomData);
    this.font = new Font(A.font, A.fontMeta);
    this.ui = new UI(this.font);
    this.sound = new Sound(A.sfx, A.music);
    const prefs = loadPrefs();
    if (prefs.sound === false) this.sound.enabled = false;
    if (prefs.music === false) this.sound.musicOn = false;
    this.world = new World(A, this.core);
    this.world.onThunder = () => { if (this.mode !== 'play' || this.state.room === 'gate') this.sound.play('thunder'); };
    this.keys = {};
    this.mode = 'title';
    this.history = [];
    this.pendingDeath = false;
    this.pendingWin = false;
    this.bindInput();
    this.last = performance.now();
    this.acc = 0;
    window.__crowmere = this;          // handy for debugging and automated checks
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ flow

  newGame(withIntro = true) {
    this.state = this.core.newState();
    this.world.enter(this.state);
    this.world.dog = null;
    this.history = [];
    this.pendingDeath = this.pendingWin = false;
    this.ui.queue = []; this.ui.dialog = null; this.ui.input = '';
    this.mode = 'play';
    if (withIntro) for (const t of this.assets.game.intro) this.ui.say(t);
    this.process(this.core.start(this.state));
  }

  remember(reason) {
    this.history.push({ snap: this.core.snapshot(this.state), reason, room: this.state.room, turn: this.state.turns });
    if (this.history.length > HISTORY_MAX) this.history.shift();
  }

  submit() {
    const text = this.ui.input.trim();
    this.ui.input = '';
    if (!text || this.mode !== 'play') return;
    this.remember('command');
    this.process(this.core.command(this.state, text));
  }

  process(events) {
    for (const e of events) {
      switch (e.t) {
        case 'say': this.ui.say(e.text); break;
        case 'score': this.sound.play('score'); break;
        case 'sound': this.sound.play(e.name); break;
        case 'room': this.world.enter(this.state); this.remember('room'); break;
        case 'die': this.ui.say(e.text); this.pendingDeath = true; this.sound.play('death'); break;
        case 'win': this.pendingWin = true; this.sound.play('win'); break;
        case 'meta': this.meta(e.what); break;
        case 'walkto': this.walkTo(e); break;
        default: break;
      }
    }
  }

  walkTo(e) {
    const st = this.state, startRoom = st.room;
    if (e.exit) {
      const x = this.assets.game.rooms[st.room].exits[e.exit];
      const z = this.core.zone(st.room, x.zone);
      if (!z) return;
      this.world.lastTrigger = null;
      this.world.walkTo(st, z.target[0], z.target[1], () =>
        (st.room === startRoom && this.world.lastTrigger !== e.exit ? this.core.enterZone(st, e.exit).events : []), e.exit);
    } else if (e.point) {
      const p = this.core.point(st.room, e.point);
      if (p) this.world.walkTo(st, p[0], p[1]);
    }
  }

  meta(what) {
    if (what === 'save') this.save();
    else if (what === 'restore') this.restore();
    else if (what === 'restart') this.confirm('Restart the game from the beginning?', () => this.newGame(false));
    else if (what === 'quit') this.confirm('Quit to the title screen?', () => { this.mode = 'title'; });
  }

  confirm(question, yes) {
    this.ui.dialog = { title: null, lines: [question, '', '  Y - yes      N - no'], keys: { y: yes, n: () => {}, escape: () => {} } };
  }

  save() {
    const ok = storage('set', JSON.stringify({ v: 1, state: this.core.snapshot(this.state) }));
    this.ui.say(ok ? 'Game saved.' : 'Sorry, this browser would not let the game save.');
  }

  restore() {
    const raw = storage('get');
    if (!raw) { this.ui.say('There is no saved game to restore.'); return false; }
    try {
      const data = JSON.parse(raw);
      this.state = this.core.restore(data.state);
      this.world.enter(this.state);
      this.world.dog = null;
      this.pendingDeath = this.pendingWin = false;
      this.ui.queue = []; this.ui.dialog = null;
      this.mode = 'play';
      this.ui.say('Game restored.');
      return true;
    } catch (e) { this.ui.say('The saved game could not be read.'); return false; }
  }

  openDeathDialog() {
    this.pendingDeath = false;
    const hasSave = !!storage('get');
    const opts = deathOptions(this.history, hasSave) || {};
    const lines = [''];
    const keys = { s: () => this.newGame(false) };
    const i = opts.rewindTo;
    if (Number.isInteger(i) && i >= 0 && i < this.history.length) {
      lines.push('U - undo, and try something else');
      keys.u = () => {
        this.state = this.core.restore(this.history[i].snap);
        this.history = this.history.slice(0, i);
        this.world.enter(this.state);
        this.ui.say('Let\'s pretend that never happened.');
      };
    }
    if (hasSave) {
      lines.push('R - restore your saved game');
      keys.r = () => { if (!this.restore()) this.openDeathDialog(); };
    }
    lines.push('S - start over');
    this.ui.dialog = { title: 'You have died.', lines, keys, border: 4 };
  }

  // ------------------------------------------------------------ loop

  frame(t) {
    this.acc += Math.min(250, t - this.last);
    this.last = t;
    while (this.acc >= TICK_MS) { this.tick(); this.acc -= TICK_MS; }
    this.render(t);
    requestAnimationFrame((u) => this.frame(u));
  }

  tick() {
    this.sound.setMusic(musicFor(this.mode, this.state, this.assets.music));
    if (this.mode !== 'play') { this.world.tickFx(this.state || { flags: {} }); return; }
    if (!this.ui.modal) {
      const ev = this.world.tick(this.state, this.keys);
      if (ev.length) this.process(ev);
    } else {
      this.world.moving = false;
      this.world.tickFx(this.state);
    }
    if (!this.ui.modal && this.pendingDeath) this.openDeathDialog();
    if (!this.ui.modal && this.pendingWin) { this.pendingWin = false; this.mode = 'ending'; this.endT = performance.now(); }
  }

  render(t) {
    const s = this.screen;
    s.clear(0);
    if (this.mode === 'title') this.drawTitle(t);
    else if (this.mode === 'ending') this.drawEnding(t);
    else {
      this.ui.drawStatus(s, this.state.score, this.assets.game.meta.maxScore, this.sound.enabled, this.sound.musicOn);
      this.world.draw(s, this.state, t);
      this.ui.drawInput(s, !this.ui.modal && ((t / 400) | 0) % 2 === 0);
      this.ui.drawTop(s);
    }
    s.present();
  }

  backdrop(roomId) {
    const room = this.assets.rooms[roomId] && this.assets.rooms[roomId].bg ? this.assets.rooms[roomId] : this.assets.rooms.hall;
    if (room && room.bg) this.screen.blitOpaque(room.bg, 0, PIC_Y);
    return room;
  }

  drawTitle(t) {
    const s = this.screen, f = this.font;
    s.rect(0, 0, SCREEN_W, 200, 0);
    this.backdrop('gate');
    s.rect(0, PIC_Y + 4, SCREEN_W, 58, 0);
    const center = (text, y, c, big) => (big ? f.draw2x(s, text, Math.floor((SCREEN_W - text.length * 12) / 2), y, c)
      : f.draw(s, text, Math.floor((SCREEN_W - f.width(text)) / 2), y, c));
    center('THE HOUSE ON', PIC_Y + 8, 12, true);
    center('CROWMERE HILL', PIC_Y + 30, 14, true);
    center('A Gus Pickett Misadventure', PIC_Y + 52, 7, false);
    if (((t / 500) | 0) % 2 === 0) center('Press ENTER to begin', 186, 15, false);
    const g = this.assets.sprites.gus;
    this.world.room = this.assets.rooms.gate && this.assets.rooms.gate.bg ? this.assets.rooms.gate : this.world.room;
    s.blit(g.sheet, g.rects[3].x, g.rects[3].y, g.rects[3].w, g.rects[3].h, 152, PIC_Y + PIC_H - 38);
  }

  drawEnding(t) {
    const s = this.screen, f = this.font;
    const room = this.backdrop('gate');
    const e = (t - this.endT) / 1000;
    const g = this.assets.sprites.gus, d = this.assets.sprites.crumpet;
    const gx = 60 + Math.min(e * 22, 200), dx = gx - 18;
    const gi = g.anims.side.walk[((t / 120) | 0) % 4], di = d.anims.walk[((t / 160) | 0) % 2];
    if (room && room.bg) {
      s.blit(g.sheet, g.rects[gi].x, g.rects[gi].y, g.rects[gi].w, g.rects[gi].h, Math.round(gx) - 8, PIC_Y + 150 - 33);
      s.blit(d.sheet, d.rects[di].x, d.rects[di].y, d.rects[di].w, d.rects[di].h, Math.round(dx) - 8, PIC_Y + 150 - 11);
    }
    s.rect(40, PIC_Y + 14, 240, 62, 0);
    s.rect(42, PIC_Y + 16, 236, 58, 15);
    const center = (text, y, c) => f.draw(s, text, Math.floor((SCREEN_W - f.width(text)) / 2), y, c);
    f.draw2x(s, 'THE END', Math.floor((SCREEN_W - 7 * 12) / 2), PIC_Y + 22, 4);
    center(`You scored ${this.state.score} of ${this.assets.game.meta.maxScore} points.`, PIC_Y + 46, 0);
    center('Thanks for playing!', PIC_Y + 58, 8);
    if (((t / 500) | 0) % 2 === 0) center('Press ENTER to play again', 186, 15);
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const fkeys = { F2: () => { this.sound.toggle(); savePrefs(this.sound); },
      F3: () => { this.sound.toggleMusic(); savePrefs(this.sound); },
      F4: () => this.canvas.classList.toggle('square'),
      F5: () => this.mode === 'play' && !this.ui.dialog && this.save(),
      F7: () => this.mode === 'play' && !this.ui.dialog && this.restore(),
      F9: () => this.mode === 'play' && this.meta('restart') };
    window.addEventListener('keydown', (e) => {
      this.sound.unlock();
      if (e.target && e.target.id === 'cmd') return;       // the touch form handles its own keys
      const k = e.key;
      if (fkeys[k]) { e.preventDefault(); fkeys[k](); return; }
      if (k.startsWith('Arrow')) e.preventDefault();
      if (this.mode === 'title') { if (k === 'Enter' || k === ' ') { e.preventDefault(); this.newGame(true); } return; }
      if (this.mode === 'ending') { if (k === 'Enter') this.mode = 'title'; return; }
      if (k.startsWith('Arrow')) { this.keys[k] = true; return; }
      if (this.ui.dialog) { this.ui.choose(k === 'Escape' ? 'escape' : k); e.preventDefault(); return; }
      if (this.ui.queue.length) { if (k.length === 1 || k === 'Enter' || k === 'Escape') { e.preventDefault(); this.ui.dismiss(); } return; }
      if (k === 'Enter') { e.preventDefault(); this.submit(); }
      else if (k === 'Backspace') { e.preventDefault(); this.ui.input = this.ui.input.slice(0, -1); }
      else if (k === 'Escape') this.ui.input = '';
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && this.ui.input.length < 60) { e.preventDefault(); this.ui.input += k; }
    });
    window.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) this.keys[e.key] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      const r = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W);
      const y = Math.floor(((e.clientY - r.top) / r.height) * 200) - PIC_Y;
      if (this.mode === 'title') { this.newGame(true); return; }
      if (this.mode === 'ending') { this.mode = 'title'; return; }
      if (this.ui.dialog) return;
      if (this.ui.queue.length) { this.ui.dismiss(); return; }
      // clicking on a doorway means "leave through it"; anywhere else, paths avoid exits
      if (y >= 0 && y < PIC_H && x >= 0 && x < PIC_W) this.world.walkTo(this.state, x, y, null, this.world.exitAt(x, y));
    });
    // Embedded in a frame, keys only arrive once the page has focus: say so on the screen.
    const hint = document.getElementById('focus-hint');
    if (hint) {
      const sync = () => { hint.hidden = document.hasFocus(); };
      window.addEventListener('focus', sync);
      window.addEventListener('blur', sync);
      sync();
    }
    const form = document.getElementById('touch'), cmd = document.getElementById('cmd');
    if (form && cmd) {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) form.classList.add('show');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sound.unlock();
        if (this.mode === 'title') { this.newGame(true); return; }
        if (this.ui.dialog) { this.ui.choose((cmd.value.trim()[0] || '').toLowerCase()); cmd.value = ''; return; }
        if (this.ui.queue.length) { this.ui.dismiss(); if (!cmd.value.trim()) return; }
        this.ui.input = cmd.value; cmd.value = '';
        this.submit();
      });
    }
  }
}

new App().boot(document.getElementById('screen')).catch((err) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.className = 'err';
  pre.textContent = `Failed to start: ${String((err && err.message) || err)}`;
  document.body.appendChild(pre);
});
