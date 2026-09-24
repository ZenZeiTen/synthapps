// Room runtime: walking, click/typed pathfinding, exit zones, depth-tested actors
// and the per-room effects (rain and lightning, candle light, the crow, Crumpet).

import { PIC_Y, PIC_W, PIC_H, BAYER, C32, SCREEN_W } from './gfx.js';

export const SPEED_X = 2, SPEED_Y = 1;   // pixels per 40 ms tick, AGI-like

export class World {
  constructor(assets, core) {
    this.a = assets;
    this.core = core;
    this.room = null;
    this.path = null;          // [{x,y}...]
    this.onArrive = null;      // callback when a path completes
    this.moving = false;
    this.step = 0;
    this.lastZone = null;
    this.trail = [];           // Gus's recent positions, for Crumpet
    this.dog = null;           // {x, y, face, moving}
    this.fx = { rain: [], flash: 0, nextFlash: 120, thunderAt: -1, crowFly: null, crowWasGone: false, flicker: 0 };
    for (let i = 0; i < 70; i++) this.fx.rain.push({ x: Math.random() * 360, y: Math.random() * PIC_H, v: 4 + Math.random() * 3 });
  }

  enter(state) {
    this.room = this.a.rooms[state.room];
    this.path = null; this.onArrive = null; this.moving = false;
    this.lastZone = this.core.zoneAt(state, state.pos.x, state.pos.y);
    // Exit-zone mask: auto-walk paths must never wander through an exit they were not
    // sent to (a path across the foot of the stairs would otherwise go upstairs).
    this.zoneMask = new Int16Array(PIC_W * PIC_H).fill(-1);
    this.zoneIds = Object.keys(this.a.game.rooms[state.room].exits || {});
    this.zoneIds.forEach((exitId, k) => {
      const z = this.core.zone(state.room, this.a.game.rooms[state.room].exits[exitId].zone);
      if (!z) return;
      for (let y = 0; y < PIC_H; y++) for (let x = 0; x < PIC_W; x++) {
        if (this.zoneMask[y * PIC_W + x] < 0 && this.core.zoneAt({ room: state.room }, x, y) === exitId) this.zoneMask[y * PIC_W + x] = k;
      }
    });
    this.trail = [];
    this.fx.crowWasGone = !!state.flags.crow_gone;
    this.fx.crowFly = null;
    if (state.flags.crumpet_follows) this.dog = { x: state.pos.x - 10, y: state.pos.y, face: 'right', moving: false };
  }

  walkable(state, x, y) { return this.core.walkable(state.room, x, y); }

  // ------------------------------------------------------------ movement

  move(state, dx, dy) {
    const p = state.pos;
    let nx = p.x + dx, ny = p.y + dy;
    if (!this.walkable(state, nx, ny)) {
      if (dx && this.walkable(state, p.x + dx, p.y)) { nx = p.x + dx; ny = p.y; }
      else if (dy && this.walkable(state, p.x, p.y + dy)) { nx = p.x; ny = p.y + dy; }
      else { this.moving = false; return { blocked: true, events: [] }; }
    }
    const prev = { x: p.x, y: p.y };
    p.x = nx; p.y = ny;
    const mx = nx - prev.x, my = ny - prev.y;
    if (Math.abs(mx) >= Math.abs(my) * 2 && mx !== 0) state.face = mx > 0 ? 'right' : 'left';
    else if (my !== 0) state.face = my > 0 ? 'down' : 'up';
    this.moving = true;
    this.step++;
    this.trail.push({ x: nx, y: ny });
    if (this.trail.length > 64) this.trail.shift();
    const zone = this.core.zoneAt(state, nx, ny);
    if (zone !== this.lastZone) {
      this.lastZone = zone;
      if (zone) {
        this.lastTrigger = zone;
        const res = this.core.enterZone(state, zone);
        if (res.blocked) { p.x = prev.x; p.y = prev.y; this.lastZone = null; this.path = null; this.onArrive = null; this.moving = false; }
        return { blocked: res.blocked, events: res.events };
      }
    }
    return { blocked: false, events: [] };
  }

  tick(state, keys) {
    let dx = 0, dy = 0;
    if (keys.ArrowLeft) dx -= SPEED_X;
    if (keys.ArrowRight) dx += SPEED_X;
    if (keys.ArrowUp) dy -= SPEED_Y;
    if (keys.ArrowDown) dy += SPEED_Y;
    let events = [];
    const roomBefore = state.room;
    if (dx || dy) {
      this.path = null; this.onArrive = null;
      events = this.move(state, dx, dy).events;
    } else if (this.path && this.path.length) {
      const w = this.path[0];
      const sx = Math.max(-SPEED_X, Math.min(SPEED_X, w.x - state.pos.x));
      const sy = Math.max(-SPEED_Y, Math.min(SPEED_Y, w.y - state.pos.y));
      const r = this.move(state, sx, sy);
      events = r.events;
      if (r.blocked && !r.events.length) {
        // never strand a typed exit: if the walk jams, deliver the arrival anyway
        this.path = null;
        const cb = this.onArrive; this.onArrive = null;
        if (cb) events = events.concat(cb() || []);
      }
      else if (state.room === roomBefore && this.path && state.pos.x === w.x && state.pos.y === w.y) {
        this.path.shift();
        if (!this.path.length) {
          this.path = null;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) events = events.concat(cb() || []);
        }
      }
    } else {
      this.moving = false;
    }
    this.tickDog(state);
    this.tickFx(state);
    return events;
  }

  tickDog(state) {
    if (!state.flags.crumpet_follows || state.room !== 'cellar' && !this.dog) return;
    if (!this.dog) {
      const hide = this.core.point('cellar', 'crates') || [state.pos.x - 10, state.pos.y];
      this.dog = { x: hide[0], y: hide[1], face: 'right', moving: false };
    }
    const target = this.trail.length > 12 ? this.trail[this.trail.length - 12] : null;
    if (target) {
      const dx = Math.max(-3, Math.min(3, target.x - this.dog.x)), dy = Math.max(-2, Math.min(2, target.y - this.dog.y));
      this.dog.moving = dx !== 0 || dy !== 0;
      if (dx) this.dog.face = dx > 0 ? 'right' : 'left';
      this.dog.x += dx; this.dog.y += dy;
    } else this.dog.moving = false;
  }

  tickFx(state) {
    const fx = this.fx;
    for (const d of fx.rain) { d.y += d.v; d.x -= 1; if (d.y > PIC_H) { d.y = -4; d.x = Math.random() * 360; } }
    if (fx.flash > 0) fx.flash--;
    if (--fx.nextFlash <= 0) { fx.flash = 5; fx.nextFlash = 150 + Math.floor(Math.random() * 250); fx.thunderAt = 8 + Math.floor(Math.random() * 10); }
    if (fx.thunderAt > 0 && --fx.thunderAt === 0) { fx.thunderAt = -1; this.onThunder && this.onThunder(); }
    fx.flicker = (fx.flicker + 1) % 1000;
    if (state.flags.crow_gone && !fx.crowWasGone) { fx.crowWasGone = true; fx.crowFly = { t: 0 }; }
    if (fx.crowFly) { fx.crowFly.t++; if (fx.crowFly.t > 40) fx.crowFly = null; }
  }

  // ------------------------------------------------------------ pathfinding (A* on the walk mask)

  // walkable for auto-walk: floor, and not inside any exit zone except `allowExit`
  passable(state, x, y, allowExit) {
    if (!this.walkable(state, x, y)) return false;
    const k = this.zoneMask ? this.zoneMask[y * PIC_W + x] : -1;
    return k < 0 || this.zoneIds[k] === allowExit;
  }

  nearestWalkable(state, x, y, allowExit = null) {
    x = Math.round(x); y = Math.round(y);
    if (this.passable(state, x, y, allowExit)) return { x, y };
    for (let r = 1; r < 200; r++) {
      let best = null, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.passable(state, x + dx, y + dy, allowExit)) { const d = dx * dx + 4 * dy * dy; if (d < bd) { bd = d; best = { x: x + dx, y: y + dy }; } }
      }
      if (best) return best;
    }
    return null;
  }

  findPath(state, tx, ty, allowExit = null) {
    const W = PIC_W, H = PIC_H;
    const goal = this.nearestWalkable(state, tx, ty, allowExit);
    if (!goal) return null;
    const sx = state.pos.x, sy = state.pos.y;
    const idx = (x, y) => y * W + x;
    const g = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const heap = [];
    const push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (x, y) => Math.abs(x - goal.x) / SPEED_X + Math.abs(y - goal.y) / SPEED_Y;
    const s = idx(sx, sy);
    g[s] = 0; push(s, h(sx, sy));
    let found = -1, best = s, bestH = h(sx, sy);
    const dirs = [[1, 0, 0.5], [-1, 0, 0.5], [0, 1, 1], [0, -1, 1], [1, 1, 1.1], [1, -1, 1.1], [-1, 1, 1.1], [-1, -1, 1.1]];
    let guard = 0;
    while (heap.length && guard++ < 120000) {
      const [, n] = pop();
      if (closed[n]) continue;
      closed[n] = 1;
      const x = n % W, y = (n / W) | 0;
      if (x === goal.x && y === goal.y) { found = n; break; }
      const hh = h(x, y);
      if (hh < bestH) { bestH = hh; best = n; }
      for (const [dx, dy, c] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !this.passable(state, nx, ny, allowExit)) continue;
        const m = idx(nx, ny);
        const ng = g[n] + c;
        if (ng < g[m]) { g[m] = ng; came[m] = n; push(m, ng + h(nx, ny)); }
      }
    }
    let n = found >= 0 ? found : best;
    const pts = [];
    while (n !== -1 && n !== s) { pts.push({ x: n % W, y: (n / W) | 0 }); n = came[n]; }
    pts.reverse();
    return this.smooth(state, pts, allowExit);
  }

  smooth(state, pts, allowExit) {
    if (pts.length < 3) return pts;
    const out = [];
    let from = { x: state.pos.x, y: state.pos.y }, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(state, from, pts[j], allowExit)) j--;
      out.push(pts[j]); from = pts[j]; i = j + 1;
    }
    return out;
  }

  // The walker moves x and y at different speeds, so it does not follow the straight
  // segment -- it goes diagonally until one axis is done. Check THAT staircase path.
  clearLine(state, a, b, allowExit) {
    let x = a.x, y = a.y;
    while (x !== b.x || y !== b.y) {
      x += Math.max(-SPEED_X, Math.min(SPEED_X, b.x - x));
      y += Math.max(-SPEED_Y, Math.min(SPEED_Y, b.y - y));
      if (!this.passable(state, x, y, allowExit)) return false;
    }
    return true;
  }

  exitAt(x, y) {
    const k = this.zoneMask ? this.zoneMask[Math.round(y) * PIC_W + Math.round(x)] : -1;
    return k >= 0 ? this.zoneIds[k] : null;
  }

  walkTo(state, tx, ty, onArrive = null, allowExit = null) {
    const path = this.findPath(state, tx, ty, allowExit);
    this.path = path && path.length ? path : null;
    this.onArrive = onArrive;
    if (!this.path && onArrive) return onArrive() || [];
    return [];
  }

  // ------------------------------------------------------------ drawing

  frameIndex(sprite, name) { return sprite.frames.indexOf(name); }

  drawSprite(screen, sprite, fi, x, y, flip, depth) {
    const r = sprite.rects[fi];
    if (!r) return;
    const room = this.room;
    const [ax, ay] = sprite.anchor;
    const test = depth == null || !room.sceneDepth ? null : (tx, ty) => {
      const d = room.sceneDepth[(ty - PIC_Y) * PIC_W + tx];
      return d >= depth - 2;
    };
    const dx = Math.round(x) - (flip ? r.w - ax : ax), dy = Math.round(y) - ay + PIC_Y;
    screen.blit(sprite.sheet, r.x, r.y, r.w, r.h, dx, dy, flip, test && ((tx, ty) => ty >= PIC_Y && ty < PIC_Y + PIC_H && test(tx, ty)));
  }

  feetDepth(x, y) {
    const room = this.room;
    if (!room.floorDepth) return null;
    const i = Math.round(y) * PIC_W + Math.round(x);
    return room.floorDepth[i] || room.sceneDepth[i];
  }

  draw(screen, state, time) {
    const room = this.room, S = this.a.sprites, core = this.core;
    if (!room || !room.bg) {
      screen.rect(0, PIC_Y, PIC_W, PIC_H, 1);
      return;
    }
    screen.blitOpaque(room.bg, 0, PIC_Y);
    for (const id of core.overlays(state)) {
      const o = room.overlays[id];
      if (!o) continue;
      if (o.pix) screen.blit(o.pix, 0, 0, o.pix.w, o.pix.h, o.x, o.y + PIC_Y);
      else if (o.sprite) {
        const sp = S[o.sprite];
        const name = o.frame === 'candle' && state.flags.candle_lit ? 'candle_lit' : o.frame;
        this.drawSprite(screen, sp, this.frameIndex(sp, name), o.x, o.y, false, null);
      }
    }
    // lightning: only the sky (scene depth 255) flashes, so the house stands out black
    if (state.room === 'gate' && this.fx.flash > 0 && this.fx.flash !== 3 && room.sceneDepth) {
      for (let i = 0; i < PIC_W * PIC_H; i++) {
        if (room.sceneDepth[i] === 255) {
          const x = i % PIC_W, y = (i / PIC_W) | 0;
          screen.px[(y + PIC_Y) * SCREEN_W + x] = C32[BAYER[y & 3][x & 3] < 0.6 ? 15 : 11];
        }
      }
    }
    const actors = [];
    const mk = room.data.markers || {};
    // Gus
    const g = S.gus, face = state.face;
    const dir = face === 'left' || face === 'right' ? 'side' : face;
    const an = g.anims[dir];
    const gf = this.moving ? an.walk[Math.floor(this.step / 3) % an.walk.length] : an.stand;
    actors.push({ y: state.pos.y, draw: () => {
      this.drawSprite(screen, g, gf, state.pos.x, state.pos.y, face === 'left', this.feetDepth(state.pos.x, state.pos.y));
      if (state.flags.candle_lit && state.loc.candle === 'inv' && face !== 'up') {
        const it = S.items, fl = this.frameIndex(it, (time >> 7) & 1 ? 'flame_a' : 'flame_b');
        const hx = state.pos.x + (face === 'right' ? 6 : face === 'left' ? -6 : -6), hy = state.pos.y - 13;
        this.drawSprite(screen, it, fl, hx, hy, false, null);
      }
    } });
    // room actors
    if (state.room === 'hall' && mk.portrait_eyes) {
      const e = S.eyes, ex = mk.portrait_eyes[0];
      const fi = state.pos.x < ex - 25 ? 0 : state.pos.x > ex + 25 ? 2 : 1;
      actors.push({ y: -1, draw: () => this.drawSprite(screen, e, fi, ex, mk.portrait_eyes[1], false, null) });
    }
    if (state.room === 'kitchen' && mk.bubbles) {
      const b = S.bubbles;
      actors.push({ y: -1, draw: () => this.drawSprite(screen, b, (time / 260 | 0) % 3, mk.bubbles[0], mk.bubbles[1], false, null) });
    }
    if (state.room === 'bedroom' && mk.crow) {
      const c = S.crow;
      if (!state.flags.crow_gone) {
        const seq = c.anims.perch, fi = seq[(time / 400 | 0) % seq.length];
        actors.push({ y: -1, draw: () => this.drawSprite(screen, c, fi, mk.crow[0], mk.crow[1], false, null) });
      } else if (this.fx.crowFly) {
        const t = this.fx.crowFly.t, fi = this.frameIndex(c, (t >> 2) & 1 ? 'fly_up' : 'fly_down');
        actors.push({ y: -1, draw: () => this.drawSprite(screen, c, fi, mk.crow[0] + t * 4, mk.crow[1] - t * 2.5, true, null) });
      }
    }
    if (state.room === 'cellar') {
      const d = S.crumpet;
      if (!state.flags.crumpet_follows && mk.crumpet) {
        actors.push({ y: mk.crumpet[1], draw: () => this.drawSprite(screen, d, this.frameIndex(d, 'peek'), mk.crumpet[0], mk.crumpet[1], (time >> 10) & 1, null) });
      } else if (this.dog) {
        const dog = this.dog;
        const fi = dog.moving ? d.anims.walk[(this.step >> 1) % 2] : d.anims.idle[(time / 300 | 0) % d.anims.idle.length];
        actors.push({ y: dog.y, draw: () => this.drawSprite(screen, d, fi, dog.x, dog.y, dog.face === 'left', this.feetDepth(dog.x, dog.y)) });
      }
    }
    actors.sort((p, q) => p.y - q.y);
    for (const act of actors) act.draw();
    // rain over the exterior
    if (state.room === 'gate') {
      for (const d of this.fx.rain) {
        for (let k = 0; k < 3; k++) {
          const x = Math.round(d.x - k * 0.3) - 20, y = Math.round(d.y - k);
          if (x >= 0 && x < PIC_W && y >= 0 && y < PIC_H) screen.px[(y + PIC_Y) * SCREEN_W + x] = C32[k ? 9 : 11];
        }
      }
    }
    if (this.a.game.rooms[state.room].dark) this.darkness(screen, state, time);
  }

  darkness(screen, state, time) {
    const lit = state.flags.candle_lit && state.loc.candle === 'inv';
    const cx = state.pos.x, cy = state.pos.y - 16;
    const jit = lit ? ((time / 90 | 0) * 7919 % 5) - 2 : 0;
    const r0 = lit ? 36 + jit : 0, r1 = lit ? 66 + jit : 1;
    const black = C32[0];
    for (let y = 0; y < PIC_H; y++) {
      const dy = (y - cy) * 1.2, row = BAYER[y & 3];
      for (let x = 0; x < PIC_W; x++) {
        const dx = x - cx, d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r0) continue;
        if (d >= r1 || (d - r0) / (r1 - r0) > row[x & 3]) screen.px[(y + PIC_Y) * SCREEN_W + x] = black;
      }
    }
  }
}
