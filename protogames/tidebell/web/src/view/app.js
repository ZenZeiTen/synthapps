// Tidebell in the browser: the application. A port of godot/scripts/view/main.gd: it owns
// the core (../core/game.js), steps it at 60 Hz, draws it (draw.js on a canvas, shown by
// render3d.js through three.js), and runs the screens: title, opening, the Lantern-house,
// map, warden choice, pause and items, talks, game over, the ending and credits, tide-code
// entry and options. It also runs the same scripted harness as the Godot build
// (?script=a,b,c; see CLAUDE.md), which tests/run_web.sh drives through Playwright.
import { Game, newProgress } from '../core/game.js';
import * as Code from '../core/code.js';
import { unpack } from '../core/inputs.js';
import { Assets } from './assets.js';
import { Draw } from './draw.js';
import { Input, LAYOUT_NAMES, makeVirtualPad } from './input.js';
import { Audio } from './audio.js';
import { Render3D } from './render3d.js';

const PAGE_GUARD = 0.4;
const ALPHA = Code.ALPHA;
const SCREEN = [0, 0, 320, 224];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const posmod = (a, n) => ((a % n) + n) % n;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class App {
  constructor(root) {
    this.root = root;
    this.A = new Assets();
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 224;
    this.D2 = new Draw(this.A, this.canvas);
    this.input = new Input(window);
    this.audio = new Audio();
    this.mode = 'loading';
    this.cur = 0;
    this.g = null;
    this.prog = {};
    this.hero = 'kess';
    this.stageId = '';
    this.options = { difficulty: 1, layout: 0, music: 0.7, sfx: 0.9 };
    this.best = 0;
    this.lastCode = '';
    this.pages = [];
    this.page = 0;
    this.pageT = 0;
    this.pagesThen = '';
    this.pressedInWindow = new Set();
    this.swallow = new Set();
    this.latch = {};
    this.selNext = '';
    this.acc = 0;
    this.msg = '';
    this.msgT = 0;
    this.codeBuf = '';
    this.ending = {};
    this.repeatT = 0;
    this.frames = 0;
    this.theme = 'reach';
    // harness
    const q = new URLSearchParams(location.search);
    this.harness = q.has('script');
    this.cmds = this.harness ? q.get('script').split(',').filter((s) => s !== '') : [];
    this.fast = Math.max(1, parseInt(q.get('fast') ?? '1', 10) || 1);
    this.waitFrames = 0;
    this.replay = null;
    this.fitQueue = [];
    this.keyHeld = new Set();
    this.pad = null;
  }

  // ---------------------------------------------------------------- start
  async start() {
    this.drawLoading(0);
    await this.A.load((f) => this.drawLoading(f));
    this.D = this.A.defs;
    this.TX = this.A.text;
    const pal = await (await fetch('content/data/palette.json')).json();
    this.R = new Render3D(this.A, this.canvas, pal);
    this.R.mount(this.root);
    const loading = document.getElementById('loading');
    if (loading) loading.remove();
    if (this.harness) {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('tidebell.harness.')) localStorage.removeItem(k);
      } catch { /* storage may be blocked */ }
      this.pad = makeVirtualPad();
      this.input.virtualPad = this.pad;
    }
    this.loadOptions();
    const wake = () => this.audio.start();
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('gamepadconnected', wake);
    this.toTitle();
    let last = performance.now();
    const loop = (now) => {
      let dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const n = this.harness ? this.fast : 1;
      for (let i = 0; i < n; i++) this.frame(this.harness ? 1 / 60 : dt);
      this.drawAll();
      const play = ['play', 'pause'].includes(this.mode) && this.g;
      this.R.render(play ? this.g.cam_x : 0, play ? this.g.cam_y : 0, !!play);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  drawLoading(f) {
    const el = document.getElementById('loading');
    if (el) el.textContent = `Loading Tidebell... ${Math.round(f * 100)}%`;
  }

  // ---------------------------------------------------------------- files
  key(name) { return (this.harness ? 'tidebell.harness.' : 'tidebell.') + name; }

  loadOptions() {
    try {
      const o = JSON.parse(localStorage.getItem(this.key('options')) ?? 'null');
      if (o) Object.assign(this.options, o);
      this.best = parseInt(localStorage.getItem(this.key('best')) ?? '0', 10) || 0;
      this.lastCode = localStorage.getItem(this.key('code')) ?? '';
    } catch { /* private window or blocked storage: defaults */ }
    this.applyOptions();
  }

  saveOptions() {
    try {
      localStorage.setItem(this.key('options'), JSON.stringify(this.options));
      localStorage.setItem(this.key('best'), String(this.best));
      localStorage.setItem(this.key('code'), this.lastCode);
    } catch { /* ignore */ }
  }

  applyOptions() {
    this.input.layout = this.options.layout | 0;
    this.audio.setVolumes(this.options.music, this.options.sfx);
  }

  // ---------------------------------------------------------------- screens
  toTitle() {
    this.mode = 'title';
    this.cur = 0;
    this.g = null;
    this.audio.play_music('title');
  }

  titleItems() {
    const it = ['New Game', 'Enter Tide-Code'];
    if (this.lastCode) it.push('Continue ' + this.lastCode);
    it.push('Options', 'Controls');
    return it;
  }

  showPages(list, then) {
    this.pages = list;
    this.page = 0;
    this.pageT = 0;
    this.pagesThen = then;
    this.pressedInWindow = new Set();
    this.mode = 'pages';
  }

  newGame() {
    this.prog = newProgress(this.D, this.options.difficulty | 0);
    this.hero = 'kess';
    this.showPages(this.TX.opening, 'hub');
    this.audio.play_music('house');
  }

  toHub(keep = 0) {
    this.mode = 'hub';
    this.cur = keep;
    this.g = null;
    if ((this.prog.done | 0) < 6) {
      this.lastCode = Code.encode(this.prog);
      this.saveOptions();
    }
    this.audio.play_music('house');
  }

  hubItems() {
    return ['Set Out: ' + this.A.stageName(this.prog.done | 0), 'Talk to Pell', 'Map of the Saltmarch', 'Choose Warden',
      'Title Screen'];
  }

  startStage(id) {
    this.stageId = id;
    this.g = new Game(this.D);
    this.g.start(id, this.A.levels[id], this.prog, this.hero);
    this.theme = this.g.head.theme ?? id;
    this.R.setTheme(this.theme);
    this.mode = 'play';
    this.acc = 0;
    this.latch = {};
    this.swallowHeld();
    this.drainEvents();
  }

  // ---------------------------------------------------------------- frame
  frame(dt) {
    this.frames += 1;
    this.D2.frame = this.frames;
    this.input.update();
    if (this.harness) this.runHarness();
    if (this.msgT > 0) this.msgT -= dt;
    switch (this.mode) {
      case 'play': this.runPlay(dt); break;
      case 'pages': case 'talk': this.runPages(dt); break;
      case 'ending': this.runEnding(dt); break;
      default: this.menus(dt);
    }
  }

  just(a) { return this.input.just(a); }
  held(a) { return this.input.held(a); }

  runPlay(dt) {
    for (const a of [...this.swallow]) if (!this.held(a)) this.swallow.delete(a);
    for (const a of ['jump', 'attack', 'item', 'special']) if (this.just(a) && !this.swallow.has(a)) this.latch[a] = true;
    if (this.just('pause') && !this.swallow.has('pause') && !this.replay) {
      this.mode = 'pause';
      this.cur = 0;
      this.audio.sfx('page');
      return;
    }
    this.acc += dt;
    const step = 1 / 60;
    let n = 0;
    while (this.acc >= step - 0.0001 && n < 4) {
      this.acc -= step;
      n += 1;
      let inp = this.input.core();
      if (this.replay) {
        if (this.replay.done) return;
        inp = this.replayInput();
        if (this.replay.done) return;
      }
      for (const a of ['jump', 'attack', 'item', 'special']) {
        if (this.swallow.has(a)) inp[a] = false;
        if (this.latch[a]) inp[a] = true;
      }
      this.latch = {};
      if (this.selNext) {
        inp.sel = this.selNext;
        this.selNext = '';
      }
      this.g.step(inp);
      this.drainEvents();
      if (this.mode !== 'play') break;
    }
    if (this.acc > step) this.acc = step;
  }

  drainEvents() {
    if (!this.g) return;
    const evs = this.g.events;
    this.g.events = [];
    for (const e of evs) {
      if (e.t === 'sfx') this.audio.sfx(e.id);
      else if (e.t === 'music') this.audio.play_music(e.id === 'none' ? '' : e.id);
      else if (e.t === 'talk') this.openTalk(e.id);
      else if (e.t === 'bell') this.audio.play_music('clear');
      else if (e.t === 'clear') this.stageCleared();
      else if (e.t === 'gameover') this.gameOver();
    }
  }

  openTalk(id) {
    if (this.replay && !this.replay.talk) {
      this.g.closeTalk();
      return;
    }
    this.showPages(this.TX[id] ?? [{ who: '', lines: ['...'] }], 'talk');
    this.mode = 'talk';
  }

  stageCleared() {
    if (this.replay) {
      this.replay.done = true;
      this.replay.ok = true;
      if (!this.replay.end) return;
    }
    this.prog.done = (this.prog.done | 0) + 1;
    this.best = Math.max(this.best, this.prog.score | 0);
    if (this.stageId === 'brinecrow') {
      this.startEnding();
    } else {
      this.lastCode = Code.encode(this.prog);
      this.saveOptions();
      this.toHub();
      this.msg = `The bell of ${this.A.stageName((this.prog.done | 0) - 1)} is home.`;
      this.msgT = 3;
    }
  }

  gameOver() {
    if (this.replay) {
      this.replay.done = true;
      this.replay.ok = false;
      return;
    }
    this.mode = 'over';
    this.cur = 0;
    this.audio.play_music('over');
  }

  // The buttons that closed a window (and are still held) are ignored by the game until
  // released, so they cannot jump or strike on the next screen.
  swallowHeld() {
    for (const a of ['jump', 'attack', 'item', 'special', 'pause', 'accept']) {
      if (this.held(a) && (this.pressedInWindow.has(a) || this.mode !== 'play')) this.swallow.add(a);
    }
    this.pressedInWindow = new Set();
  }

  runPages(dt) {
    this.pageT += dt;
    let any = false;
    for (const a of ['accept', 'jump', 'attack', 'item', 'pause']) {
      if (this.just(a)) {
        this.pressedInWindow.add(a);
        if (this.pageT > PAGE_GUARD) any = true;
      }
    }
    if (!any) return;
    this.audio.sfx('page');
    this.page += 1;
    this.pageT = 0;
    if (this.page < this.pages.length) return;
    const then = this.pagesThen;
    if (then === 'talk') {
      this.mode = 'play';
      this.swallowHeld();
      this.g.closeTalk();
      this.drainEvents();
    } else if (then === 'hub') {
      this.toHub(this.pages !== this.TX.opening ? 1 : 0);
      this.swallowHeld();
    } else if (then === 'title') {
      this.toTitle();
    } else if (then === 'ending_pages') {
      this.ending = { phase: 'credits', t: 0 };
      this.mode = 'ending';
    }
  }

  nav(n, dt) {
    const dir = (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
    if (this.just('up') || this.just('down')) {
      this.repeatT = 0.35;
      this.audio.sfx('menu');
      return posmod(this.cur + dir, n);
    }
    if (dir !== 0) {
      this.repeatT -= dt;
      if (this.repeatT <= 0) {
        this.repeatT = 0.12;
        this.audio.sfx('menu');
        return posmod(this.cur + dir, n);
      }
    }
    return this.cur;
  }

  accept() { return this.just('accept') || this.just('jump'); }
  back() { return this.just('back') || this.just('item'); }

  menus(dt) {
    switch (this.mode) {
      case 'title': {
        const it = this.titleItems();
        this.cur = this.nav(it.length, dt);
        if (this.accept()) {
          this.audio.sfx('select');
          const c = it[this.cur];
          if (c === 'New Game') this.newGame();
          else if (c === 'Enter Tide-Code') { this.mode = 'code'; this.codeBuf = ''; this.cur = 0; }
          else if (c.startsWith('Continue')) this.useCode(this.lastCode);
          else if (c === 'Options') { this.mode = 'options'; this.cur = 0; }
          else if (c === 'Controls') this.mode = 'help';
        }
        break;
      }
      case 'hub': {
        const it = this.hubItems();
        this.cur = this.nav(it.length, dt);
        if (this.accept()) {
          this.audio.sfx('select');
          if (this.cur === 0) this.startStage(this.D.stages[this.prog.done | 0]);
          else if (this.cur === 1) {
            const d = this.prog.done | 0;
            this.showPages(this.TX[d >= 6 ? 'pell_done' : 'pell_' + this.D.stages[d]], 'hub');
          } else if (this.cur === 2) this.mode = 'map';
          else if (this.cur === 3) { this.mode = 'heroes'; this.cur = this.D.hero_order.indexOf(this.hero); }
          else if (this.cur === 4) this.toTitle();
        }
        break;
      }
      case 'map':
        if (this.accept() || this.back()) {
          this.audio.sfx('select');
          this.mode = 'hub';
          this.cur = 2;
        }
        break;
      case 'heroes': {
        const order = this.D.hero_order;
        if (this.just('left') || this.just('up')) { this.cur = posmod(this.cur - 1, order.length); this.audio.sfx('menu'); }
        else if (this.just('right') || this.just('down')) { this.cur = posmod(this.cur + 1, order.length); this.audio.sfx('menu'); }
        if (this.accept()) {
          this.hero = order[this.cur];
          this.audio.sfx('select');
          this.mode = 'hub';
          this.cur = 3;
        } else if (this.back()) {
          this.mode = 'hub';
          this.cur = 3;
        }
        break;
      }
      case 'pause': {
        const it = this.pauseItems();
        this.cur = this.nav(it.length, dt);
        // Enter is both "accept" and "pause": here it chooses; Esc, Back or Start closes
        if ((this.just('pause') && !this.just('accept')) || this.just('back')) {
          this.mode = 'play';
          this.swallowHeld();
        } else if (this.accept()) {
          this.audio.sfx('select');
          const c = it[this.cur];
          if (c === 'Resume') { this.mode = 'play'; this.swallowHeld(); }
          else if (c === 'Controls') this.mode = 'help_pause';
          else if (c === 'Quit to Title') {
            this.best = Math.max(this.best, this.prog.score | 0);
            this.saveOptions();
            this.toTitle();
          } else {
            this.selNext = c.split(' ')[0].toLowerCase();
            this.mode = 'play';
            this.swallowHeld();
          }
        }
        break;
      }
      case 'help': case 'help_pause':
        if (this.accept() || this.back() || this.just('pause')) {
          this.mode = this.mode === 'help' ? 'title' : 'pause';
          this.swallowHeld();
        }
        break;
      case 'options': this.optionMenu(dt); break;
      case 'code': this.codeMenu(); break;
      case 'over': {
        const it = this.overItems();
        this.cur = this.nav(it.length, dt);
        if (this.accept()) {
          this.audio.sfx('select');
          if (it[this.cur].startsWith('Continue')) {
            this.prog.continues = (this.prog.continues | 0) - 1;
            this.prog.lives = this.D.player.lives;
            this.startStage(this.stageId);
          } else {
            this.best = Math.max(this.best, this.prog.score | 0);
            this.saveOptions();
            this.toTitle();
          }
        }
        break;
      }
      default:
        break;
    }
  }

  pauseItems() {
    const it = ['Resume'];
    for (const k of this.D.items) {
      const n = this.prog.items[k] | 0;
      if (n > 0) it.push(`${cap(k)} x${n}${this.prog.sel === k ? ' <' : ''}`);
    }
    it.push('Controls', 'Quit to Title');
    return it;
  }

  overItems() {
    const it = [];
    if ((this.prog.continues | 0) > 0) it.push(`Continue (${this.prog.continues | 0} left)`);
    it.push('End the Game');
    return it;
  }

  optionRows() {
    const names = this.D.difficulty.names;
    return ['Difficulty: ' + names[this.options.difficulty | 0], 'Buttons: ' + LAYOUT_NAMES[this.options.layout | 0],
      `Music: ${Math.round(this.options.music * 100)}%`, `Effects: ${Math.round(this.options.sfx * 100)}%`, 'Back'];
  }

  optionMenu(dt) {
    const rows = this.optionRows();
    this.cur = this.nav(rows.length, dt);
    let d = 0;
    if (this.just('left')) d = -1;
    else if (this.just('right') || (this.accept() && this.cur < rows.length - 1)) d = 1;
    if (d !== 0) {
      this.audio.sfx('menu');
      const o = this.options;
      if (this.cur === 0) o.difficulty = posmod((o.difficulty | 0) + d, 3);
      else if (this.cur === 1) o.layout = posmod((o.layout | 0) + d, 3);
      else if (this.cur === 2) o.music = clamp(Math.round((o.music + d * 0.1) * 10) / 10, 0, 1);
      else if (this.cur === 3) o.sfx = clamp(Math.round((o.sfx + d * 0.1) * 10) / 10, 0, 1);
      this.applyOptions();
      this.saveOptions();
    }
    if ((this.accept() && this.cur === rows.length - 1) || this.back()) {
      this.mode = 'title';
      this.cur = 3;
    }
  }

  codeMenu() {
    const n = ALPHA.length + 2;
    if (this.just('right')) this.cur = (this.cur + 1) % n;
    else if (this.just('left')) this.cur = posmod(this.cur - 1, n);
    else if (this.just('down')) this.cur = Math.min(this.cur + 4, n - 1);
    else if (this.just('up')) this.cur = Math.max(this.cur - 4, 0);
    if (this.accept()) {
      this.audio.sfx('select');
      if (this.cur < ALPHA.length) {
        if (this.codeBuf.length < 6) this.codeBuf += ALPHA[this.cur];
        if (this.codeBuf.length === 6) this.cur = n - 1;
      } else if (this.cur === ALPHA.length) {
        this.codeBuf = this.codeBuf.slice(0, -1);
      } else {
        this.useCode(this.codeBuf);
      }
    } else if (this.back()) {
      if (this.codeBuf === '') this.toTitle();
      else this.codeBuf = this.codeBuf.slice(0, -1);
    }
  }

  useCode(c) {
    const d = Code.decode(c);
    if (!d) {
      this.msg = 'That tide-code is not right.';
      this.msgT = 2.5;
      this.audio.sfx('deny');
      return;
    }
    this.prog = newProgress(this.D, d.difficulty);
    this.prog.done = d.done;
    this.prog.lives = d.lives;
    this.prog.maxhp = d.maxhp;
    this.prog.items.knives = d.items.knives;
    this.prog.items.tonic = d.items.tonic;
    if (this.prog.done >= 6) {
      this.startEnding();
      return;
    }
    this.toHub();
  }

  // ---------------------------------------------------------------- ending
  startEnding() {
    this.mode = 'ending';
    this.ending = { phase: 'bells', t: 0 };
    this.g = null;
    this.best = Math.max(this.best, this.prog.score | 0);
    this.lastCode = '';
    this.saveOptions();
    this.audio.play_music('ending');
  }

  runEnding(dt) {
    this.ending.t += dt;
    if (this.ending.phase === 'bells') {
      if (this.ending.t > 4) this.showPages(this.TX.ending, 'ending_pages');
    } else if (this.ending.phase === 'credits') {
      const any = this.just('accept') || this.just('jump') || this.just('pause');
      if (this.ending.t > this.creditsLen() || (any && this.ending.t > 1)) this.ending = { phase: 'end', t: 0 };
    } else if (this.ending.phase === 'end') {
      if (this.ending.t > 3 || ((this.just('accept') || this.just('jump')) && this.ending.t > PAGE_GUARD)) {
        this.swallowHeld();
        this.toTitle();
      }
    }
  }

  creditsLen() { return 4 + this.TX.credits.length * 1.1; }

  // ---------------------------------------------------------------- drawing
  drawAll() {
    const d = this.D2;
    d.clear();
    switch (this.mode) {
      case 'title': {
        d.still('title');
        d.drawFrame('logo', 0, 32, 18);
        const it = this.titleItems();
        d.menu(92, 104, 136, 20 + it.length * 11, it, this.cur);
        d.textCenter(SCREEN, 160, 212, `Best ${this.best}`, '#ccd8ff');
        break;
      }
      case 'pages': case 'talk':
        if (this.mode === 'talk' || this.pagesThen === 'talk') d.world(this.g, this.theme);
        else if (this.pagesThen === 'ending_pages') d.still('dawn');
        else d.still('title');
        if (this.mode === 'talk' || this.pagesThen === 'talk') this.drawHud(d);
        this.drawPage(d);
        break;
      case 'hub': {
        d.still('map');
        d.x.fillStyle = 'rgba(0,0,26,0.45)';
        d.x.fillRect(0, 0, 320, 224);
        const inner = [16, 16, 288, 24];
        d.window(8, 8, 304, 40);
        d.textIn(inner, 20, 17, 'THE LANTERN-HOUSE', '#ffe680');
        d.textIn(inner, 20, 29, `Score ${this.prog.score | 0}   Bells ${this.prog.done | 0}/6`);
        d.textIn(inner, 214, 17, 'Tide-code');
        d.textIn(inner, 214, 29, this.lastCode, '#99ffe6');
        d.menu(40, 60, 240, 80, this.hubItems(), this.cur);
        this.drawHeroLine(d, 40, 146, 240, 40);
        if (this.msgT > 0) {
          d.window(20, 192, 280, 24);
          d.textCenter([28, 196, 264, 16], 160, 200, this.msg, '#ffe680');
        }
        break;
      }
      case 'map': this.drawMap(d); break;
      case 'heroes': this.drawHeroes(d); break;
      case 'play':
        d.world(this.g, this.theme);
        this.drawHud(d);
        break;
      case 'pause': {
        d.world(this.g, this.theme);
        this.drawHud(d);
        const it = this.pauseItems();
        d.menu(70, 30, 180, 22 + it.length * 11, it, this.cur, 'PAUSED');
        const hint = this.TX.items[this.prog.sel] ?? '';
        if (hint) {
          d.window(10, 188, 300, 26);
          d.textCenter([18, 194, 284, 12], 160, 197, hint);
        }
        break;
      }
      case 'help': case 'help_pause':
        if (this.mode === 'help') d.still('title');
        else { d.world(this.g, this.theme); this.drawHud(d); }
        this.drawLines(d, 'CONTROLS', this.TX.help, '');
        break;
      case 'options':
        d.still('title');
        d.menu(40, 50, 240, 79, this.optionRows(), this.cur, 'OPTIONS');
        break;
      case 'code': this.drawCode(d); break;
      case 'over':
        d.x.fillStyle = '#000010';
        d.x.fillRect(0, 0, 320, 224);
        this.drawLines(d, '', this.TX.over, '', 40);
        d.menu(90, 130, 140, 50, this.overItems(), this.cur);
        break;
      case 'ending': this.drawEnding(d); break;
      default: break;
    }
    if (this.msgT > 0 && (this.mode === 'title' || this.mode === 'code')) {
      d.window(40, 190, 240, 24);
      d.textCenter([48, 194, 224, 16], 160, 198, this.msg, '#ffccaa');
    }
    if (this.fitQueue.length > 0) {
      const [title, lines, who] = this.fitQueue.shift();
      this.drawLines(d, title, lines, who);
    }
  }

  drawHeroLine(d, x, y, w, h) {
    d.window(x, y, w, h);
    d.drawFrame('hud', this.A.frame('hud', this.hero), x + 10, y + 12);
    const prof = this.TX.profiles[this.hero];
    const inner = [x + 8, y + 8, w - 16, h - 16];
    d.textIn(inner, x + 32, y + 10, prof[0], '#ffe680');
    d.textIn(inner, x + 32, y + 22, prof[2]);
  }

  drawPage(d) {
    if (this.page >= this.pages.length) return;
    const pg = this.pages[this.page];
    this.drawLines(d, '', pg.lines ?? [], pg.who ?? '');
    if (this.pageT > PAGE_GUARD && ((this.frames >> 5) % 2) === 0) d.drawFrame('cursor', 0, 292, 205);
  }

  drawLines(d, title, lines, who, top = -1) {
    const h = 22 + lines.length * 10 + (title ? 12 : 0);
    const y = top < 0 ? 216 - h : top;
    d.window(8, y, 304, h);
    let inner = [16, y + 8, 288, h - 16];
    let x = 18;
    if (who) {
      d.portrait(who, 14, y + 8);
      x = 70;
      inner = [66, y + 8, 312 - 8 - 66, h - 16];
    }
    let ty = y + 11;
    if (title) {
      d.textIn(inner, x, ty, title, '#ffe680');
      ty += 12;
    }
    for (const l of lines) {
      d.textIn(inner, x, ty, String(l));
      ty += 10;
    }
  }

  drawHud(d) {
    const g = this.g;
    if (!g) return;
    const p = g.p;
    const A = this.A;
    d.drawFrame('hud', A.frame('hud', this.hero), 8, 6);
    d.textIn(SCREEN, 26, 10, `x${this.prog.lives | 0}`);
    d.textCenter(SCREEN, 160, 8, String(this.prog.score | 0).padStart(7, '0'), '#fff2b3');
    d.drawFrame('hud', A.frame('hud', 'box'), 294, 4);
    const selk = this.prog.sel;
    const cnt = this.prog.items[selk] | 0;
    if (cnt > 0) {
      d.drawFrame('items', A.frame('items', selk), 294, 4);
      d.textIn(SCREEN, 284, 22, `x${cnt}`);
    }
    if (p.buff) {
      d.drawFrame('items', A.frame('items', p.buff), 274, 4);
      d.textIn(SCREEN, 250, 8, String(Math.ceil(p.buff_t / 60)).padStart(2, ' '), '#b3e6ff');
    }
    // the health bar: 1 px per point, framed at the maximum (H2, H3)
    const maxhp = this.prog.maxhp | 0;
    const x0 = 92;
    const y0 = 206;
    const x = d.x;
    x.fillStyle = '#e6e6ff';
    x.fillRect(x0 - 1, y0 - 1, maxhp + 2, 5);
    x.fillStyle = '#0d0d26';
    x.fillRect(x0, y0, maxhp, 3);
    const shown = clamp(p.shown | 0, 0, maxhp);
    x.fillStyle = shown > 24 ? '#ffd933' : '#ff5a33';
    x.fillRect(x0, y0, shown, 3);
    d.drawFrame('hud', A.frame('hud', 'heart'), x0 - 18, y0 - 7);
    if (g.arena_left >= 0 && g.guardian_id > 0) {
      const gd = g.objById(g.guardian_id);
      if (gd && (gd.asleep ?? 0) === 0) {
        const full = this.D.enemies[gd.k].hp;
        x.fillStyle = '#1a0000';
        x.fillRect(110, 22, 100, 4);
        x.fillStyle = '#e6334d';
        x.fillRect(110, 22, Math.trunc(100 * Math.max(0, gd.hp) / full), 4);
      }
    }
    if (g.mode === 'clear') {
      d.window(70, 90, 180, 28);
      d.textCenter([78, 96, 164, 16], 160, 100, 'THE BELL IS FOUND!', '#ffe666');
    }
  }

  drawMap(d) {
    d.still('map');
    const spots = [[52, 150], [96, 70], [160, 46], [236, 62], [272, 138], [170, 176]];
    const done = this.prog.done | 0;
    for (let i = 0; i < spots.length; i++) {
      const [sx, sy] = spots[i];
      d.drawFrame('mapmark', this.A.frame('mapmark', i < done ? 'done' : 'island'), sx - 8, sy - 8);
      if (i === done) d.drawFrame('mapmark', this.A.frame('mapmark', 'here', this.frames >> 4), sx - 8, sy - 8);
      d.textCenter(SCREEN, sx, sy + 9, this.A.stageName(i), i === done ? null : '#c0ccdd');
    }
    d.window(60, 4, 200, 22);
    d.textCenter([68, 8, 184, 14], 160, 11, 'THE SALTMARCH', '#ffe680');
  }

  drawHeroes(d) {
    d.still('title');
    const order = this.D.hero_order;
    d.window(8, 8, 304, 30);
    d.textCenter([16, 14, 288, 18], 160, 19, 'CHOOSE A WARDEN', '#ffe680');
    for (let i = 0; i < order.length; i++) {
      const x = 50 + i * 110;
      d.window(x - 40, 46, 80, 80);
      if (i === this.cur) {
        d.x.fillStyle = 'rgba(255,230,100,0.15)';
        d.x.fillRect(x - 34, 52, 68, 68);
      }
      d.drawAt(order[i], this.A.frame(order[i], i !== this.cur ? 'stand' : 'walk', this.frames >> 3), x, 116);
    }
    const prof = this.TX.profiles[order[this.cur]];
    d.window(8, 134, 304, 62);
    const inner = [16, 142, 288, 46];
    for (let k = 0; k < prof.length; k++) d.textIn(inner, 18, 143 + k * 11, prof[k], k === 0 ? '#ffe680' : null);
    d.textCenter(SCREEN, 160, 206, `left/right to look, ${this.input.label('accept')} to choose`, '#ccd8ff');
  }

  drawCode(d) {
    d.still('title');
    d.window(60, 30, 200, 150);
    const inner = [68, 38, 184, 134];
    d.textCenter(inner, 160, 40, 'ENTER TIDE-CODE', '#ffe680');
    const shown = this.codeBuf + '______'.slice(this.codeBuf.length);
    d.textCenter(inner, 160, 58, shown.split('').join(' '), '#99ffe6');
    for (let i = 0; i < ALPHA.length; i++) {
      const x = 104 + (i % 4) * 30;
      const y = 78 + Math.floor(i / 4) * 16;
      d.textIn(inner, x, y, ALPHA[i], i === this.cur ? null : '#8090b0');
      if (i === this.cur) d.drawFrame('cursor', 0, x - 10, y);
    }
    const dl = ALPHA.length;
    d.textIn(inner, 104, 146, 'DEL', this.cur === dl ? null : '#8090b0');
    d.textIn(inner, 170, 146, 'OK', this.cur === dl + 1 ? null : '#8090b0');
    if (this.cur >= dl) d.drawFrame('cursor', 0, this.cur === dl ? 94 : 160, 146);
    for (let k = 0; k < this.TX.code_help.length; k++) d.textCenter(SCREEN, 160, 190 + k * 10, this.TX.code_help[k], '#ccd8ff');
  }

  drawEnding(d) {
    const e = this.ending;
    if (e.phase === 'bells') {
      d.still('dawn');
      for (let i = 0; i < 6; i++) {
        if (e.t > 0.5 + i * 0.5) d.drawFrame('bell', this.A.frame('bell', 'shine', Math.trunc(e.t * 6) + i), 30 + i * 52, 30 + (i % 2) * 8);
      }
      d.x.fillStyle = `rgba(255,255,255,${clamp(1 - e.t, 0, 1)})`;
      d.x.fillRect(0, 0, 320, 224);
    } else if (e.phase === 'credits') {
      d.x.fillStyle = '#05080f';
      d.x.fillRect(0, 0, 320, 224);
      const y = 224 - e.t * 24;
      const lines = this.TX.credits;
      for (let k = 0; k < lines.length; k++) {
        const ly = y + k * 12;
        if (ly > -10 && ly < 230) d.textCenter([0, -20, 320, 264], 160, ly, lines[k], k === 0 ? '#ffe680' : null);
      }
    } else {
      d.still('dawn');
      d.window(60, 90, 200, 44);
      d.textCenter([68, 96, 184, 32], 160, 100, 'THE END', '#ffe680');
      d.textCenter([68, 96, 184, 32], 160, 114, `Final score ${this.prog.score | 0}`);
    }
  }

  // ---------------------------------------------------------------- harness
  runHarness() {
    if (this.waitFrames > 0) {
      this.waitFrames -= 1;
      return;
    }
    if (this.replay) {
      if (this.replay.done) {
        console.log(`REPLAY ${this.replay.stage} ${this.replay.ok ? 'ok' : 'FAIL'} steps=${this.replay.i}`);
        this.releaseAll();
        const ended = this.replay.end;
        this.replay = null;
        if (this.cmds.length === 0 && !ended) console.log('HARNESS done');
        return;
      }
      if (!(this.replay.talk && this.mode === 'talk')) return;
    }
    if (this.cmds.length === 0) {
      if (!this.harnessDone) {
        this.harnessDone = true;
        console.log('HARNESS done');
      }
      return;
    }
    if (this.frames % 6 !== 0) return;
    const cmd = this.cmds.shift();
    const a = cmd.split(':');
    switch (a[0]) {
      case 'newgame': this.newGame(); break;
      case 'stage':
        this.prog = newProgress(this.D, 1);
        this.hero = a[2] ?? 'kess';
        this.startStage(a[1]);
        break;
      case 'key': case 'keyup': this.sendKey(a[1], a[0] === 'key'); break;
      case 'pad': case 'padup': this.sendPad(a[1], a[0] === 'pad'); break;
      case 'axis': this.pad.axes[a[1] === 'lx' ? 0 : 1] = parseFloat(a[2]); break;
      case 'tap': this.sendKey(a[1], true); this.cmds.unshift('keyup:' + a[1]); break;
      case 'ptap': this.sendPad(a[1], true); this.cmds.unshift('padup:' + a[1]); break;
      case 'wait': this.waitFrames = a.length > 1 ? parseInt(a[1], 10) : 6; break;
      case 'replay': this.beginReplay(a[1], a[2] ?? 'kb', a.includes('talk'), a.includes('end')); break;
      case 'waittalk':
        if (this.mode !== 'talk' && this.replay && !this.replay.done) this.cmds.unshift(cmd);
        else if (this.mode !== 'talk') console.log('HARNESS waittalk: the replay ended without another talk');
        break;
      case 'dump': this.dump(); break;
      case 'set':
        if (a[1] === 'score') this.prog.score = parseInt(a[2], 10);
        else if (a[1] === 'done') this.prog.done = parseInt(a[2], 10);
        else console.log('HARNESS unknown command: ' + cmd);
        break;
      case 'fitall':
        for (const k of Object.keys(this.TX)) {
          const v = this.TX[k];
          if (Array.isArray(v) && v.length && typeof v[0] === 'object') for (const pg of v) this.fitQueue.push(['', pg.lines, pg.who ?? '']);
        }
        this.fitQueue.push(['CONTROLS', this.TX.help, '']);
        this.cmds.unshift('fitwait');
        break;
      case 'fitwait': if (this.fitQueue.length) this.cmds.unshift(cmd); break;
      case 'fit': {
        const over = [...this.D2.overflows].sort();
        console.log(over.length === 0 ? 'FIT ok' : `FIT ${over.length}: ${over.join(' / ')}`);
        this.D2.overflows.clear();
        break;
      }
      case 'quit': console.log('HARNESS done'); this.cmds = []; this.harnessDone = true; break;
      default: console.log('HARNESS unknown command: ' + cmd);
    }
  }

  dump() {
    let extra = '';
    if (this.mode === 'pages' || this.mode === 'talk') {
      const pg = this.pages[Math.min(this.page, this.pages.length - 1)] ?? {};
      extra = ` page=${this.page}/${this.pages.length} who=${pg.who ?? ''}`;
    } else if (['hub', 'title', 'pause', 'over', 'options'].includes(this.mode)) extra = ` cur=${this.cur}`;
    else if (this.mode === 'ending') extra = ` phase=${this.ending.phase}`;
    else if (this.mode === 'code') extra = ` code=${this.codeBuf}`;
    if (this.g && ['play', 'pause', 'talk'].includes(this.mode)) {
      const p = this.g.p;
      extra += ` stage=${this.g.stage} pos=${p.x >> 16},${p.y >> 16} st=${p.st} hp=${p.hp} lives=${this.prog.lives} score=${this.prog.score} core=${this.g.mode}`;
    } else if (this.prog.done !== undefined) {
      extra += ` done=${this.prog.done} score=${this.prog.score} hero=${this.hero} code=${this.lastCode}`;
    }
    console.log(`DUMP mode=${this.mode}${extra}`);
  }

  // key names as in the Godot harness
  static KEYMAP = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', z: 'KeyZ', x: 'KeyX',
    c: 'KeyC', v: 'KeyV', enter: 'Enter', esc: 'Escape', space: 'Space' };

  static PADMAP = { a: 0, b: 1, x: 2, y: 3, start: 9, up: 12, down: 13, left: 14, right: 15 };

  // Synthesized keyboard events go through the same listeners as real keys.
  sendKey(name, down) {
    const code = App.KEYMAP[name];
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  }

  // The harness pad is read through navigator.getGamepads(), like a real one.
  sendPad(name, down) {
    const b = this.pad.buttons[App.PADMAP[name]];
    b.pressed = down;
    b.value = down ? 1 : 0;
  }

  beginReplay(stage, device, talk, end = false) {
    const r = this.A.routes[stage];
    this.prog = newProgress(this.D, 1);
    this.hero = r.hero ?? 'kess';
    this.startStage(stage);
    this.replay = { stage, device, inputs: r.inputs, i: 0, done: false, ok: false, held: {}, talk, end };
  }

  replayInput() {
    const r = this.replay;
    if (r.i >= r.inputs.length) {
      r.done = true;
      r.ok = false;
      return {};
    }
    const want = unpack(r.inputs[r.i]);
    r.i += 1;
    const set = (k, down, fn) => {
      if ((r.held[k] ?? false) !== down) {
        r.held[k] = down;
        fn(down);
      }
    };
    if (r.device === 'kb') {
      set('right', want.dx > 0, (d) => this.sendKey('right', d));
      set('left', want.dx < 0, (d) => this.sendKey('left', d));
      set('down', want.dy > 0, (d) => this.sendKey('down', d));
      set('up', want.dy < 0, (d) => this.sendKey('up', d));
      set('z', want.jump, (d) => this.sendKey('z', d));
      set('x', want.attack, (d) => this.sendKey('x', d));
      set('c', want.item, (d) => this.sendKey('c', d));
      set('v', want.special, (d) => this.sendKey('v', d));
    } else {
      this.pad.axes[0] = want.dx;
      set('pdown', want.dy > 0, (d) => this.sendPad('down', d));
      set('pup', want.dy < 0, (d) => this.sendPad('up', d));
      set('pa', want.jump, (d) => this.sendPad('a', d));
      set('px', want.attack, (d) => this.sendPad('x', d));
      set('pb', want.item, (d) => this.sendPad('b', d));
      set('py', want.special, (d) => this.sendPad('y', d));
    }
    // the replayed device events are read this very step, as a player's would be
    this.input.update();
    return this.input.core();
  }

  releaseAll() {
    for (const k of Object.keys(App.KEYMAP)) this.sendKey(k, false);
    for (const b of this.pad.buttons) { b.pressed = false; b.value = 0; }
    this.pad.axes[0] = 0;
    this.pad.axes[1] = 0;
  }
}
