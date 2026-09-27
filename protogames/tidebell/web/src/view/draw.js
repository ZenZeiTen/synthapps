// The 2D layer of the browser build, drawn on a 320x224 canvas that three.js then shows on a
// quad: the stage's tiles, every object, the hero, and all the screens' windows and text.
// It mirrors godot/scripts/view/world.gd and ui.gd, so both builds look the same.
const T = 16;
const CW = 6;

export class Draw {
  constructor(assets, canvas) {
    this.A = assets;
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.x.imageSmoothingEnabled = false;
    this.overflows = new Set();
    this.frame = 0;
  }

  clear() {
    this.x.setTransform(1, 0, 0, 1, 0, 0);
    this.x.clearRect(0, 0, 320, 224);
  }

  // ---------------------------------------------------------------- sprites
  drawFrame(name, i, px, py, flip = false, alpha = 1, bright = false) {
    const im = this.A.img['sprites/' + name];
    const m = this.A.meta(name);
    if (!im || !m) return;
    const x = this.x;
    x.save();
    x.globalAlpha = alpha;
    px = Math.round(px);
    py = Math.round(py);
    if (flip) {
      x.translate(px + m.w, py);
      x.scale(-1, 1);
      x.drawImage(im, i * m.w, 0, m.w, m.h, 0, 0, m.w, m.h);
    } else {
      x.drawImage(im, i * m.w, 0, m.w, m.h, px, py, m.w, m.h);
    }
    if (bright) {
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = 0.6;
      if (flip) x.drawImage(im, i * m.w, 0, m.w, m.h, 0, 0, m.w, m.h);
      else x.drawImage(im, i * m.w, 0, m.w, m.h, px, py, m.w, m.h);
    }
    x.restore();
  }

  drawAt(name, i, ax, ay, flip = false, alpha = 1, bright = false) {
    const m = this.A.meta(name);
    if (!m) return;
    const ox = flip ? m.w - m.origin[0] : m.origin[0];
    this.drawFrame(name, i, ax - ox, ay - m.origin[1], flip, alpha, bright);
  }

  // ---------------------------------------------------------------- text
  // The font sheet tinted by a colour (multiplied, keeping the glyphs' own shading), cached.
  font(col) {
    const im = this.A.img['sprites/font'];
    if (!im || !col) return im;
    this.fonts = this.fonts ?? {};
    if (this.fonts[col]) return this.fonts[col];
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = col;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(im, 0, 0);
    this.fonts[col] = c;
    return c;
  }

  text(px, py, s, col = null) {
    const im = this.font(col);
    if (!im) return;
    let cx = Math.round(px);
    const cy = Math.round(py);
    for (let i = 0; i < s.length; i++) {
      let code = s.charCodeAt(i);
      if (code < 32 || code > 127) code = 63;
      if (code !== 32) this.x.drawImage(im, (code - 32) * CW, 0, CW, 8, cx, cy, CW, 8);
      cx += CW;
    }
  }

  width(s) { return s.length * CW; }

  // Text that must stay inside `frame` [x, y, w, h]; anything outside is recorded (the fit audit).
  textIn(fr, px, py, s, col = null) {
    const w = this.width(s);
    if (px < fr[0] || px + w > fr[0] + fr[2] + 0.5 || py < fr[1] || py + 8 > fr[1] + fr[3] + 0.5) {
      this.overflows.add('over: ' + s.trim().slice(0, 40));
    }
    this.text(px, py, s, col);
  }

  textCenter(fr, cx, py, s, col = null) {
    this.textIn(fr, Math.trunc(cx - this.width(s) / 2), py, s, col);
  }

  window(rx, ry, w, h) {
    const im = this.A.img['sprites/panel'];
    const x = this.x;
    if (!im) {
      x.fillStyle = '#001040';
      x.fillRect(rx, ry, w, h);
      return;
    }
    const s = 8;
    const d = (sx, sy, sw, sh, dx, dy, dw, dh) => x.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
    d(0, 0, s, s, rx, ry, s, s);
    d(16, 0, s, s, rx + w - s, ry, s, s);
    d(0, 16, s, s, rx, ry + h - s, s, s);
    d(16, 16, s, s, rx + w - s, ry + h - s, s, s);
    d(8, 0, 8, s, rx + s, ry, w - 2 * s, s);
    d(8, 16, 8, s, rx + s, ry + h - s, w - 2 * s, s);
    d(0, 8, s, 8, rx, ry + s, s, h - 2 * s);
    d(16, 8, s, 8, rx + w - s, ry + s, s, h - 2 * s);
    d(8, 8, 8, 8, rx + s, ry + s, w - 2 * s, h - 2 * s);
  }

  menu(rx, ry, w, h, items, cur, title = '') {
    this.window(rx, ry, w, h);
    const inner = [rx + 9, ry + 9, w - 18, h - 18];
    let y = inner[1] + 2;
    if (title) {
      this.textCenter(inner, rx + w / 2, y, title, '#ffe680');
      y += 14;
    }
    for (let i = 0; i < items.length; i++) {
      this.textIn(inner, inner[0] + 10, y, String(items[i]), i === cur ? null : '#8090b0');
      if (i === cur) this.drawFrame('cursor', (this.frame >> 4) % 2, inner[0], y);
      y += 11;
    }
  }

  portrait(who, px, py) {
    const m = this.A.meta('portraits');
    if (!m || !(who in m.tags)) return;
    this.drawFrame('portraits', this.A.frame('portraits', who), px, py);
  }

  still(name) {
    const im = this.A.img['stills/' + name];
    if (im) this.x.drawImage(im, 0, 0);
    else {
      this.x.fillStyle = '#0c1430';
      this.x.fillRect(0, 0, 320, 224);
    }
  }

  // ---------------------------------------------------------------- the stage
  world(g, theme) {
    const x = this.x;
    x.save();
    x.translate(-g.cam_x, -g.cam_y);
    this.tiles(g, theme);
    for (const o of g.objs) this.obj(g, o);
    this.player(g);
    x.restore();
  }

  tiles(g, theme) {
    const sheet = this.A.img['tiles/' + theme];
    if (!sheet) return;
    const cells = this.A.manifest.tiles.cells;
    const x0 = Math.max(0, g.cam_x >> 4);
    const x1 = Math.min(g.lw - 1, (g.cam_x + 320) >> 4);
    const y0 = Math.max(0, g.cam_y >> 4);
    const y1 = Math.min(g.lh - 1, (g.cam_y + 224) >> 4);
    const wallCol = g.arena_left >= 0 ? g.arena_left >> 4 : -1;
    const at = (tx, ty) => g.tile(tx, ty);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = g.rows[ty][tx];
        let name = '';
        if (c === 35) {
          const up = at(tx, ty - 1);
          if (up !== 35 && up !== 76) {
            const l = at(tx - 1, ty) === 35;
            const r = at(tx + 1, ty) === 35;
            name = !l && tx > 0 ? 'top_l' : (!r && tx < g.lw - 1 ? 'top_r' : ((tx * 7 + ty * 3) % 5 === 0 ? 'top_alt' : 'top'));
          } else if (at(tx, ty + 1) !== 35 && ty + 1 < g.lh) name = 'under';
          else name = (tx * 5 + ty * 11) % 7 === 0 ? 'inner_alt' : 'inner';
        } else if (c === 88) {
          if (tx === wallCol) continue;
          name = 'crate';
        } else if (c === 61) {
          const l = at(tx - 1, ty) === 61;
          const r = at(tx + 1, ty) === 61;
          name = !l ? 'ledge_l' : (!r ? 'ledge_r' : 'ledge');
        } else if (c === 72) name = at(tx, ty - 1) !== 72 ? 'climb_top' : 'climb';
        else if (c === 94) name = 'spikes';
        else if (c === 76) name = 'gate';
        else if (c === 126) name = at(tx, ty - 1) !== 126 ? 'water_top' : 'water';
        else if (at(tx, ty + 1) === 35 && (tx * 13 + ty * 7) % 9 === 0) name = 'deco' + ((tx + ty) % 4);
        else continue;
        const i = cells.indexOf(name);
        if (i < 0) continue;
        this.x.drawImage(sheet, (i % 8) * T, Math.floor(i / 8) * T, T, T, tx * T, ty * T, T, T);
      }
    }
  }

  obj(g, o) {
    const A = this.A;
    const ax = o.x >> 16;
    const ay = o.y >> 16;
    const t = o.t;
    const st = o.st;
    let flip = o.face < 0;
    const bright = (o.flash ?? 0) > 0 && ((o.flash >> 1) % 2 === 0);
    let alpha = 1;
    let spr = o.k;
    let tag = '';
    let n = 0;
    switch (o.k) {
      case 'raider': case 'grane':
        if (st === 'windup') tag = 'windup';
        else if (st === 'cut') { tag = 'cut'; n = Math.min(1, t >> 2); }
        else if (st === 'knock') tag = 'hurt';
        else if (st === 'back') tag = 'back';
        else { tag = o.vx !== 0 ? 'walk' : 'stand'; n = t >> 3; }
        if ((o.asleep ?? 0) === 1) tag = 'stand';
        break;
      case 'thrower':
        tag = t < 12 && st !== 'knock' ? 'throw' : (st === 'knock' ? 'hurt' : (o.vx !== 0 ? 'walk' : 'stand'));
        n = tag !== 'throw' ? t >> 3 : Math.min(1, t >> 2);
        break;
      case 'mudskip': tag = o.ground ? 'stand' : 'hop'; n = t >> 4; break;
      case 'bat': tag = st === 'idle' ? 'hang' : 'fly'; n = t >> 2; break;
      case 'crab': tag = 'walk'; n = t >> 3; break;
      case 'gull': tag = 'fly'; n = t >> 3; break;
      case 'wisp': tag = 'float'; n = t >> 3; break;
      case 'golem': tag = st === 'windup' ? 'windup' : (st === 'cool' && t < 14 ? 'slam' : 'walk'); n = t >> 4; break;
      case 'vell':
        tag = st === 'leap' ? 'leap' : st === 'throw' ? 'throw' : (o.vx !== 0 ? 'walk' : 'stand');
        n = tag !== 'throw' ? t >> 3 : Math.min(1, Math.trunc(t / 14));
        break;
      case 'hullbreaker':
        tag = st === 'charge' ? 'charge' : st === 'rest' ? 'rest' : 'walk';
        n = tag === 'charge' ? t >> 2 : t >> 4;
        break;
      case 'tallyman': tag = st === 'hop' ? 'hop' : st === 'lob' ? 'lob' : 'stand'; n = t >> 3; break;
      case 'oldgrey': tag = st === 'dive' ? 'dive' : 'fly'; n = t >> 3; break;
      case 'warden':
        if (st === 'vanish') {
          if (t > 6 && t < 34) return;
          alpha = 0.5;
        }
        tag = st === 'cast' && t > 35 && t < 60 ? 'cast' : 'float';
        n = t >> 3;
        break;
      case 'siltking':
        tag = st === 'slam' ? 'slam' : st === 'wave' ? 'wave' : 'stand';
        n = tag === 'slam' ? (t > 30 ? 1 : 0) : t >> 4;
        break;
      case 'chest': tag = 'shut'; break;
      case 'post': tag = (o.lit ?? 0) === 1 ? 'lit' : 'dark'; n = t >> 3; break;
      case 'captive': tag = st === 'free' ? 'wave' : 'stand'; n = t >> 3; flip = false; break;
      case 'pickup': spr = 'items'; tag = String(o.what); break;
      case 'bell': tag = 'shine'; n = this.frame >> 3; break;
      case 'knife': tag = 'fly'; break;
      case 'bottle': case 'bomb': tag = 'spin'; n = t >> 2; break;
      case 'net': tag = 'fly'; break;
      case 'blast': tag = 'burst'; n = Math.min(2, Math.trunc(t / 5)); break;
      case 'feather': tag = 'fall'; break;
      case 'spark': tag = 'glow'; n = t >> 2; break;
      case 'shock': tag = 'run'; n = t >> 2; break;
      case 'wave': tag = 'roll'; n = t >> 3; break;
      case 'fx': case 'coinfx': spr = 'fx'; tag = 'poof'; n = Math.min(3, Math.trunc(t / 4)); break;
      default: return;
    }
    this.drawAt(spr, A.frame(spr, tag, n), ax, ay, flip, alpha, bright);
  }

  player(g) {
    const A = this.A;
    const p = g.p;
    const hero = g.hero;
    let tag = p.st;
    let n = 0;
    switch (p.st) {
      case 'stand': n = g.tick >> 5; break;
      case 'walk': n = Math.trunc(g.tick / 5); break;
      case 'attack':
        tag = ['cut0', 'cut1', 'spin'][p.combo];
        n = Math.min(2, Math.trunc(p.atk * 3 / Math.max(1, p.alen)));
        break;
      case 'cattack': n = Math.min(2, Math.trunc(p.atk * 3 / Math.max(1, p.alen))); break;
      case 'jattack': n = Math.min(1, Math.trunc(p.atk * 2 / Math.max(1, p.alen))); break;
      case 'special': n = Math.min(3, Math.trunc(p.atk * 4 / Math.max(1, p.alen))); break;
      case 'climb': n = p.y >> 19; break;
      case 'dead': n = g.mode_t > 60 ? 0 : 1; break;
      case 'crouch': case 'jump': case 'fall': case 'hurt': break;
      default: tag = 'stand';
    }
    if (p.inv > 0 && p.st !== 'dead' && p.st !== 'hurt' && ((p.inv >> 2) % 2) === 1) return;
    const ax = p.x >> 16;
    const ay = p.y >> 16;
    this.drawAt(hero, A.frame(hero, tag, n), ax, ay, p.face < 0);
    if (p.buff === 'squall') this.drawAt('gust', A.frame('gust', 'spin', this.frame >> 2), ax, ay);
    else if (p.buff === 'stoneskin' && ((this.frame >> 3) % 2) === 0) {
      this.drawAt(hero, A.frame(hero, tag, n), ax, ay, p.face < 0, 0.5);
    }
  }
}
