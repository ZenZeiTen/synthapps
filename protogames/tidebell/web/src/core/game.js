// Tidebell's rules: one stage in play, stepped at 60 Hz. Pure data; no DOM, no three.js.
// A line-for-line port of godot/scripts/core/game.gd: positions and speeds are 16.16 fixed
// point integers, so both builds compute the very same numbers. Keep the two in step: the
// parity check (tests/parity.sh) runs both on the same inputs and compares state hashes.
//
// Rule IDs (M1, A3, H6, ...) refer to the tables in docs/DESIGN.md.
import * as Level from './level.js';
import * as Kinds from './kinds.js';

export const FX = 65536;
const T = 16;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function newProgress(defs, difficulty) {
  const items = {};
  for (const k of defs.items) items[k] = 0;
  return {
    lives: defs.player.lives | 0, maxhp: defs.player.hp_start | 0, items, score: 0, done: 0,
    continues: defs.player.continues | 0, difficulty, sel: 'tonic',
  };
}

export class Game {
  constructor(defs) {
    this.D = defs;
    this.P = defs.player;
    this.H = {};
    this.stage = '';
    this.head = {};
    this.rows = [];
    this.lw = 0;
    this.lh = 0;
    this.hero = 'kess';
    this.diff = 1;
    this.prog = {};
    this.p = {};
    this.objs = [];
    this.next_id = 1;
    this.tick = 0;
    this.rng = 0x2545F491;
    this.mode = 'play';
    this.mode_t = 0;
    this.talk_id = '';
    this.talk_then = '';
    this.events = [];
    this.prev = {};
    this.cam_x = 0;
    this.cam_y = 0;
    this.arena_left = -1;
    this.arena_x = -1;
    this.guardian_id = 0;
    this.check_x = 0;
    this.check_y = 0;
    this.chests = [];
    this.npcs = [];
  }

  // ---------------------------------------------------------------- setup
  start(id, text, progress, heroId) {
    const P = this.P;
    this.stage = id;
    this.prog = progress;
    this.diff = progress.difficulty | 0;
    this.hero = heroId;
    this.H = this.D.heroes[heroId];
    const lv = Level.parse(text);
    this.head = lv.head;
    this.rows = lv.rows;
    this.lw = lv.w;
    this.lh = lv.h;
    this.chests = Level.list(this.head, 'chests');
    this.npcs = Level.list(this.head, 'npcs');
    this.objs = [];
    this.next_id = 1;
    this.tick = 0;
    this.rng = 0x2545F491;
    this.mode = 'play';
    this.events = [];
    this.prev = {};
    this.arena_left = -1;
    this.arena_x = -1;
    this.guardian_id = 0;
    let ci = 0;
    let ni = 0;
    let sx = 2 * T;
    let sy = 10 * T;
    for (const [c, mx, my] of lv.marks) {
      const x = mx * T + 8;
      const y = my * T + T;
      if (c === 'S') { sx = x; sy = y; }
      else if (c === 'P') this.addObj('post', x, y);
      else if (c === 'C') {
        const o = this.addObj('chest', x, y);
        o.holds = ci < this.chests.length ? this.chests[ci] : 'coin';
        ci += 1;
      } else if (c === 'N') {
        const o = this.addObj('captive', x, y);
        o.talk = ni < this.npcs.length ? this.npcs[ni] : '';
        ni += 1;
      } else if (c === 'A') this.arena_x = mx * T;
      else if (c === 'G') {
        const o = this.addObj(this.head.guardian ?? 'vell', x, y);
        o.asleep = 1;
        this.guardian_id = o.id;
      } else if (c in Level.ENEMY_MARKERS) this.addObj(Level.ENEMY_MARKERS[c], x, y);
      else if (c in Level.PICKUP_MARKERS) this.addObj('pickup', x, y).what = Level.PICKUP_MARKERS[c];
    }
    const maxhp = progress.maxhp | 0;
    this.p = {
      x: sx * FX, y: sy * FX, vx: 0, vy: 0, face: 1, ground: true, st: 'stand', t: 0,
      hp: maxhp, shown: maxhp, inv: 0, coyote: 0, jbuf: 0, abuf: 0,
      atk: 0, alen: 0, akind: '', combo: 0, chain: 0, hits: [], drop: 0, slow: 0,
      buff: '', buff_t: 0, safe_x: sx * FX, safe_y: sy * FX, crouch: false,
    };
    this.check_x = sx * FX;
    this.check_y = sy * FX;
    this.snapCamera();
    this.emit({ t: 'music', id: this.head.music ?? id });
    void P;
  }

  addObj(kind, x, y) {
    const e = this.D.enemies[kind] ?? {};
    const o = {
      id: this.next_id, k: kind, x: x * FX, y: y * FX, vx: 0, vy: 0, face: -1, st: 'idle',
      t: 0, hp: (e.hp ?? 1) | 0, w: (e.w ?? 16) | 0, h: (e.h ?? 16) | 0, ground: false,
      active: false, flash: 0, dead: false, hit_by: -1, ox: x * FX, oy: y * FX,
    };
    this.next_id += 1;
    // things that stand still are live from the start; enemies wake near the screen
    o.active = kind === 'post' || kind === 'chest' || kind === 'captive' || kind === 'pickup';
    this.objs.push(o);
    return o;
  }

  emit(e) { this.events.push(e); }

  rand(n) {
    // xorshift32, the same in game.gd
    let x = this.rng;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.rng = x;
    return x % n;
  }

  // ---------------------------------------------------------------- tiles
  tile(tx, ty) {
    if (tx < 0 || tx >= this.lw) return 35;          // "#": the stage's sides are walls
    if (ty < 0 || ty >= this.lh) return 46;          // ".": open above and below (a pit)
    return this.rows[ty][tx];
  }

  solidAt(tx, ty) {
    const c = this.tile(tx, ty);
    return c === 35 || c === 88 || c === 76;
  }

  // Can something stand on the top edge of tile (tx, ty)? Solid tiles, thin ledges
  // and the top of a climb column (M12).
  floorAt(tx, ty) {
    const c = this.tile(tx, ty);
    if (c === 35 || c === 88 || c === 76 || c === 61) return true;
    return c === 72 && this.tile(tx, ty - 1) !== 72;
  }

  thinAt(tx, ty) {
    const c = this.tile(tx, ty);
    return c === 61 || (c === 72 && this.tile(tx, ty - 1) !== 72);
  }

  boxHitsSolid(x, y, hw, h) {
    const l = (x - hw) >> 4;
    const r = (x + hw - 1) >> 4;
    const tp = (y - h) >> 4;
    const b = (y - 1) >> 4;
    for (let ty = tp; ty <= b; ty++) {
      for (let tx = l; tx <= r; tx++) if (this.solidAt(tx, ty)) return true;
    }
    return false;
  }

  // Moves a body by its speed against the tiles; returns what it touched.
  moveBody(o, hw, h, thinOk) {
    const hit = { wall: false, floor: false, ceil: false };
    let nx = o.x + o.vx;
    const py = o.y >> 16;
    if (o.vx !== 0 && this.boxHitsSolid(nx >> 16, py, hw, h)) {
      let px = o.x >> 16;
      const step = o.vx > 0 ? 1 : -1;
      while (!this.boxHitsSolid(px + step, py, hw, h) && Math.abs((px + step) * FX - o.x) <= Math.abs(o.vx) + FX) {
        px += step;
      }
      nx = px * FX;
      o.vx = 0;
      hit.wall = true;
    }
    o.x = nx;
    let ny = o.y + o.vy;
    const x = o.x >> 16;
    const l = (x - hw) >> 4;
    const r = (x + hw - 1) >> 4;
    if (o.vy > 0) {
      const oldFeet = o.y >> 16;
      const newFeet = ny >> 16;
      let ty = (oldFeet + 15) >> 4;
      while (ty * T <= newFeet) {
        if (ty * T >= oldFeet) {
          for (let tx = l; tx <= r; tx++) {
            if (this.solidAt(tx, ty) || (thinOk && this.floorAt(tx, ty)) ||
                (!thinOk && this.floorAt(tx, ty) && !this.thinAt(tx, ty))) {
              ny = ty * T * FX;
              o.vy = 0;
              hit.floor = true;
              break;
            }
          }
        }
        if (hit.floor) break;
        ty += 1;
      }
    } else if (o.vy < 0) {
      const headNow = (ny >> 16) - h;
      const ty = headNow >> 4;
      for (let tx = l; tx <= r; tx++) {
        if (this.solidAt(tx, ty)) {
          ny = ((ty + 1) * T + h) * FX;
          o.vy = 0;
          hit.ceil = true;
          break;
        }
      }
    }
    o.y = ny;
    return hit;
  }

  grounded(o, hw, thinOk) {
    if ((o.y & 0xFFFF) !== 0) return false;
    const feet = o.y >> 16;
    if ((feet & 15) !== 0) return false;
    const x = o.x >> 16;
    const ty = feet >> 4;
    for (let tx = (x - hw) >> 4; tx <= ((x + hw - 1) >> 4); tx++) {
      if (this.solidAt(tx, ty) || (this.floorAt(tx, ty) && (thinOk || !this.thinAt(tx, ty)))) return true;
    }
    return false;
  }

  // Both edges of the feet stand on firm, harmless ground (H7).
  firm(o, hw) {
    const feet = o.y >> 16;
    if ((feet & 15) !== 0 || (o.y & 0xFFFF) !== 0) return false;
    const x = o.x >> 16;
    const ty = feet >> 4;
    for (const tx of [(x - hw) >> 4, (x + hw - 1) >> 4]) {
      if (!this.floorAt(tx, ty) || this.tile(tx, ty) === 94) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- step
  step(inp) {
    const held = { jump: !!inp.jump, attack: !!inp.attack, item: !!inp.item, special: !!inp.special };
    const press = {};
    for (const k of ['jump', 'attack', 'item', 'special']) press[k] = held[k] && !this.prev[k];
    const dx = inp.dx | 0;
    const dy = inp.dy | 0;
    this.prev = held;
    const sel = inp.sel ? String(inp.sel) : '';
    if (sel !== '' && sel in this.prog.items) this.prog.sel = sel;
    if (this.mode === 'talk' || this.mode === 'over' || this.mode === 'ending') return;
    this.tick += 1;
    if (this.mode === 'dead') {
      this.mode_t -= 1;
      if (this.mode_t <= 0) this.respawn();
      this.stepObjects();
      this.cleanup();
      this.followCamera();
      return;
    }
    if (this.mode === 'clear') {
      this.mode_t -= 1;
      this.stepPlayerPhysicsOnly();
      if (this.mode_t <= 0) {
        this.mode = 'over';
        this.emit({ t: 'clear', stage: this.stage });
      }
      this.followCamera();
      return;
    }
    this.stepPlayer(dx, dy, held, press);
    this.stepObjects();
    this.playerHits();
    this.cleanup();
    const p = this.p;
    if (p.shown < p.hp) p.shown += 1;
    else if (p.shown > p.hp) p.shown -= 1;
    this.followCamera();
    this.checkArena();
    if (this.talk_id !== '' && this.mode === 'play' && p.ground && p.st !== 'hurt') {
      this.mode = 'talk';
      this.emit({ t: 'talk', id: this.talk_id });
    }
  }

  closeTalk() {
    if (this.mode !== 'talk') return;
    this.mode = 'play';
    this.talk_id = '';
    const then = this.talk_then;
    this.talk_then = '';
    if (then.startsWith('wake:')) {
      const o = this.objById(parseInt(then.substring(5), 10));
      if (o) {
        o.asleep = 0;
        this.emit({ t: 'music', id: 'guardian' });
      }
    } else if (then.startsWith('give:')) {
      this.give(then.substring(5), 1);
    } else if (then === 'silt') {
      Kinds.siltRise(this);
    }
  }

  queueTalk(id, then = '') {
    this.talk_id = id;
    this.talk_then = then;
    this.p.inv = Math.max(this.p.inv, 30);
  }

  objById(id) {
    for (const o of this.objs) if (o.id === id) return o;
    return null;
  }

  // ---------------------------------------------------------------- the player
  stepPlayer(dx, dy, held, press) {
    const P = this.P;
    const p = this.p;
    const st = p.st;
    if (p.inv > 0) p.inv -= 1;
    if (p.drop > 0) p.drop -= 1;
    if (p.slow > 0) p.slow -= 1;
    if (p.buff_t > 0) {
      p.buff_t -= 1;
      if (p.buff_t === 0) p.buff = '';
    }
    if (p.chain > 0) p.chain -= 1;
    if (press.jump) p.jbuf = P.jump_buffer_f | 0;
    else if (p.jbuf > 0) p.jbuf -= 1;
    if (press.attack) p.abuf = P.attack_buffer_f | 0;
    else if (p.abuf > 0) p.abuf -= 1;
    if (this.talk_id !== '') {
      dx = 0;
      p.jbuf = 0;
      p.abuf = 0;
    }
    if (press.item && st !== 'hurt' && st !== 'climb' && this.talk_id === '') {
      if (dy < 0) this.cycleItem();
      else this.useItem();
    }
    let g = P.gravity | 0;
    if (p.buff === 'feather') g = Math.trunc(g / 2);
    if (st === 'hurt') {
      p.t -= 1;
      p.vy = Math.min(p.vy + g, P.max_fall);
      const hit = this.moveBody(p, P.hw, P.h, true);
      if (hit.floor) p.vx = 0;
      if (p.t <= 0 && this.grounded(p, P.hw, true)) p.st = 'stand';
    } else if (st === 'climb') {
      this.stepClimb(dx, dy, press);
    } else if (st === 'attack' || st === 'cattack' || st === 'jattack' || st === 'special') {
      this.stepAttack(dx, g);
    } else {
      this.stepMove(dx, dy, held, press, g);
    }
    // pits (H7)
    if ((p.y >> 16) > this.lh * T + P.pit_margin_px) {
      this.hurt(P.pit_damage, 0, true);
      if (p.hp > 0) {
        p.x = p.safe_x;
        p.y = p.safe_y;
        p.vx = 0;
        p.vy = 0;
        p.st = 'stand';
        p.inv = P.safe_f;
        this.emit({ t: 'sfx', id: 'splash' });
      }
    }
    // spikes and silt (H5)
    if (p.inv === 0 && p.buff !== 'stoneskin' && this.mode === 'play' && this.touchesHazard()) {
      this.hurt(this.D.difficulty.hazard[this.diff], p.vx !== 0 ? p.face : 0, false);
    }
    // walking into a locked gate with a key opens it (I8)
    if ((this.prog.items.key | 0) > 0 && this.touchesGate()) {
      if (this.openGate()) this.prog.items.key = (this.prog.items.key | 0) - 1;
    }
    if (p.ground && this.firm(p, P.hw)) {
      p.safe_x = p.x;
      p.safe_y = p.y;
    }
  }

  touchesHazard() {
    const P = this.P;
    const x = this.p.x >> 16;
    const feet = this.p.y >> 16;
    for (const ty of [(feet - 1) >> 4, (feet - 8) >> 4]) {
      for (const tx of [(x - P.hw + 2) >> 4, (x + P.hw - 3) >> 4]) if (this.tile(tx, ty) === 94) return true;
    }
    return false;
  }

  touchesGate() {
    const P = this.P;
    const x = this.p.x >> 16;
    const feet = this.p.y >> 16;
    for (const tx of [(x - P.hw - 2) >> 4, (x + P.hw + 1) >> 4]) {
      if (this.tile(tx, (feet - 8) >> 4) === 76 || this.tile(tx, (feet - 30) >> 4) === 76) return true;
    }
    return false;
  }

  walkMax() {
    let m = this.H.walk_max | 0;
    if (this.p.slow > 0) m = Math.trunc(m / 2);
    return m;
  }

  // Walking (M1 to M3)
  walk(dx) {
    const p = this.p;
    if (dx === 0) {
      p.vx = 0;
      return;
    }
    if (p.vx === 0 || (p.vx > 0) !== (dx > 0)) {
      p.vx = dx * this.P.walk_first;
    } else {
      const m = this.walkMax();
      p.vx = clamp(p.vx + dx * this.P.walk_accel, -m, m);
    }
    p.face = dx;
  }

  stepMove(dx, dy, held, press, g) {
    const P = this.P;
    const p = this.p;
    const hw = P.hw;
    let on = this.grounded(p, hw, p.drop === 0);
    p.ground = on;
    if (on) p.coyote = P.coyote_f;
    else if (p.coyote > 0) p.coyote -= 1;
    let crouch = on && dy > 0;
    // climb (M9)
    if (dy !== 0 && this.talk_id === '' && this.canClimb(dy)) {
      p.st = 'climb';
      p.vx = 0;
      p.vy = 0;
      p.x = ((((p.x >> 16) >> 4) * T) + 8) * FX;
      if (dy > 0 && on) p.y += 2 * FX;
      p.ground = false;
      return;
    }
    // drop through a thin ledge (M11)
    if (on && dy > 0 && p.jbuf > 0 && this.standingOnThinOnly()) {
      p.drop = P.drop_f;
      p.jbuf = 0;
      p.y += FX;
      p.ground = false;
      on = false;
      crouch = false;
    }
    // attack (A1, A4, A5), special (A6)
    if (press.special && this.talk_id === '') {
      if (this.startSpecial()) return;
    }
    if (p.abuf > 0 && this.talk_id === '') {
      p.abuf = 0;
      if (on && crouch) this.startAttack('cattack', P.crouch_swing_f);
      else if (on) this.startAttack('attack', this.H.swing);
      else this.startAttack('jattack', P.air_swing_f);
      if (p.st === 'attack') {
        p.vx = 0;
        return;
      }
      if (p.st === 'cattack') {
        p.vx = 0;
        p.crouch = true;
        return;
      }
    }
    // jump (M4 to M7): rises on the press step
    let launched = false;
    if (p.jbuf > 0 && (on || p.coyote > 0) && !(dy > 0 && on)) {
      launched = true;
      p.jbuf = 0;
      p.coyote = 0;
      p.vy = P.jump_v;
      p.ground = false;
      on = false;
      this.emit({ t: 'sfx', id: 'jump' });
    }
    if (!on && p.vy < P.jump_cut && !held.jump && p.st !== 'jattack') p.vy = P.jump_cut;
    p.crouch = crouch;
    if (crouch) {
      p.vx = 0;
      if (dx !== 0) p.face = dx;
    } else {
      this.walk(dx);
    }
    if (!on && !launched) p.vy = Math.min(p.vy + g, P.max_fall);
    const h = crouch ? P.h_crouch : P.h;
    const hit = this.moveBody(p, hw, h, p.drop === 0);
    if (hit.floor) {
      p.ground = true;
      this.emit({ t: 'sfx', id: 'land' });
    }
    if (p.st !== 'jattack') {
      if (!p.ground) p.st = p.vy < 0 ? 'jump' : 'fall';
      else if (crouch) p.st = 'crouch';
      else if (p.vx !== 0) p.st = 'walk';
      else p.st = 'stand';
    }
  }

  standingOnThinOnly() {
    const P = this.P;
    const x = this.p.x >> 16;
    const ty = (this.p.y >> 16) >> 4;
    for (let tx = (x - P.hw) >> 4; tx <= ((x + P.hw - 1) >> 4); tx++) if (this.solidAt(tx, ty)) return false;
    return true;
  }

  canClimb(dy) {
    const p = this.p;
    const x = p.x >> 16;
    const tx = x >> 4;
    const feet = p.y >> 16;
    if (Math.abs((x & 15) - 8) > 6) return false;
    if (dy < 0) return this.tile(tx, (feet - 20) >> 4) === 72 && p.vy >= -FX * 2;
    return p.ground && this.tile(tx, feet >> 4) === 72;
  }

  stepClimb(dx, dy, press) {
    const P = this.P;
    const p = this.p;
    const tx = (p.x >> 16) >> 4;
    p.ground = false;
    if (p.jbuf > 0) {
      p.jbuf = 0;
      p.st = 'jump';
      if (dx !== 0) {
        p.vx = dx * P.climb_push;
        p.face = dx;
        p.vy = P.jump_v;
        this.emit({ t: 'sfx', id: 'jump' });
      } else {
        p.vy = 0;
      }
      return;
    }
    const v = P.climb_v;
    p.vy = dy * v;
    const feetNow = p.y >> 16;
    const ny = p.y + p.vy;
    const feet = ny >> 16;
    if (dy < 0) {
      let top = feetNow >> 4;
      while (this.tile(tx, top - 1) === 72) top -= 1;
      if (feet <= top * T) {
        p.y = top * T * FX;
        p.vy = 0;
        p.st = 'stand';
        p.ground = true;
        return;
      }
      if (this.boxHitsSolid(p.x >> 16, feet, P.hw, P.h)) return;
    } else if (dy > 0) {
      if (this.floorAt(tx, feet >> 4) && this.tile(tx, feet >> 4) !== 72 && (feet & 15) < 8 && feet >= (feet >> 4) * T) {
        p.y = (feet >> 4) * T * FX;
        p.st = 'stand';
        p.ground = true;
        p.vy = 0;
        return;
      }
      if (this.tile(tx, (feet - 20) >> 4) !== 72) {
        p.st = 'fall';
        return;
      }
    }
    p.y = ny;
    p.t += dy !== 0 ? 1 : 0;
    void press;
  }

  startAttack(kind, length) {
    const p = this.p;
    p.st = kind;
    p.akind = kind;
    p.atk = 0;
    p.alen = length;
    p.hits = [];
    if (kind === 'attack') p.combo = p.chain > 0 ? (p.combo + 1) % 3 : 0;
    else p.combo = 0;
    this.emit({ t: 'sfx', id: p.combo === 2 && kind === 'attack' ? 'spin' : 'swing' });
  }

  startSpecial() {
    const p = this.p;
    const s = this.P.special;
    const free = p.buff === 'fury';
    if (!free && p.hp < s.needs) {
      this.emit({ t: 'sfx', id: 'deny' });
      return false;
    }
    if (!free) p.hp -= s.cost;
    p.st = 'special';
    p.akind = 'special';
    p.atk = 0;
    p.alen = s.len;
    p.hits = [];
    p.vx = 0;
    this.emit({ t: 'sfx', id: 'cleave' });
    return true;
  }

  stepAttack(dx, g) {
    const P = this.P;
    const p = this.p;
    const hw = P.hw;
    p.atk += 1;
    const kind = p.akind;
    const on = this.grounded(p, hw, p.drop === 0);
    p.ground = on;
    if (kind === 'jattack' || !on) {
      if (kind === 'jattack') this.walk(dx);
      p.vy = Math.min(p.vy + g, P.max_fall);
    } else {
      p.vx = 0;
    }
    const hit = this.moveBody(p, hw, kind === 'cattack' ? P.h_crouch : P.h, p.drop === 0);
    if (hit.floor) {
      p.ground = true;
      if (kind === 'jattack') p.atk = p.alen;
    }
    const repress = p.alen - (this.H.swing - this.H.repress);
    if (kind === 'attack' && p.abuf > 0 && p.atk >= repress) {
      p.abuf = 0;
      p.chain = 12;
      this.startAttack('attack', this.H.swing);
      return;
    }
    if (p.atk >= p.alen) {
      p.chain = kind === 'attack' ? 12 : 0;
      if (p.ground) p.st = kind === 'cattack' ? 'crouch' : 'stand';
      else p.st = 'fall';
      p.crouch = kind === 'cattack';
    }
  }

  // The hero's hit box this step, or null when the swing is not active. [x0, y0, x1, y1] in px.
  attackBox() {
    const p = this.p;
    const st = p.st;
    const x = p.x >> 16;
    const y = p.y >> 16;
    const f = p.face;
    const t = p.atk;
    const reach = this.H.reach;
    if (st === 'attack') {
      if (t < this.H.from || t > this.H.to) return null;
      if (p.combo === 2) return [x - reach - 4, y - 34, x + reach + 4, y - 8];
      return f > 0 ? [x + 4, y - 34, x + 4 + reach, y - 8] : [x - 4 - reach, y - 34, x - 4, y - 8];
    }
    if (st === 'cattack') {
      if (t < 3 || t > 10) return null;
      return f > 0 ? [x + 4, y - 18, x + 4 + reach, y - 1] : [x - 4 - reach, y - 18, x - 4, y - 1];
    }
    if (st === 'jattack') {
      if (t < 2 || t > 10) return null;
      return f > 0 ? [x + 2, y - 32, x + 2 + reach, y - 2] : [x - 2 - reach, y - 32, x - 2, y - 2];
    }
    if (st === 'special') {
      const s = this.P.special;
      if (t < s.from || t > s.to) return null;
      const r = reach + s.reach_add;
      return [x - r, y - 40, x + r, y - 2];
    }
    return null;
  }

  attackDamage() {
    const p = this.p;
    if (p.st === 'special') return this.P.special.damage;
    let d = this.H.damage;
    if (p.st === 'attack' && p.combo === 2) d *= 2;
    return d;
  }

  playerBox() {
    const P = this.P;
    const x = this.p.x >> 16;
    const y = this.p.y >> 16;
    const h = this.p.crouch ? P.h_crouch : P.h;
    return [x - P.hw, y - h, x + P.hw, y];
  }

  objBox(o) {
    const x = o.x >> 16;
    const y = o.y >> 16;
    const hw = o.w >> 1;
    return [x - hw, y - o.h, x + hw, y];
  }

  static overlap(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  }

  overlap(a, b) { return Game.overlap(a, b); }

  // Damage to the hero (H4 to H6).
  hurt(amount, fromDir, noKnock) {
    const P = this.P;
    const p = this.p;
    if (this.mode !== 'play') return;
    if (p.buff === 'stoneskin' && !noKnock) return;
    if (p.inv > 0 && !noKnock) return;
    p.hp = Math.max(0, p.hp - amount);
    this.emit({ t: 'sfx', id: 'hurt' });
    if (p.hp <= 0) {
      this.die();
      return;
    }
    if (noKnock) return;
    const away = fromDir !== 0 ? -fromDir : -p.face;
    p.vx = away * P.knock_vx;
    p.vy = P.knock_vy;
    p.st = 'hurt';
    p.t = P.hurt_f;
    p.inv = P.safe_f;
    p.ground = false;
    p.crouch = false;
  }

  enemyHit(o) {
    const dir = o.x < this.p.x ? 1 : -1;
    this.hurt(this.D.difficulty.enemy_hit[this.diff], -dir, false);
  }

  die() {
    this.mode = 'dead';
    this.mode_t = this.P.dead_f;
    this.p.st = 'dead';
    this.p.vx = 0;
    this.talk_id = '';
    this.emit({ t: 'sfx', id: 'die' });
  }

  respawn() {
    const p = this.p;
    this.prog.lives = (this.prog.lives | 0) - 1;
    if ((this.prog.lives | 0) <= 0) {
      this.mode = 'over';
      this.emit({ t: 'gameover' });
      return;
    }
    this.mode = 'play';
    p.x = this.check_x;
    p.y = this.check_y;
    p.vx = 0;
    p.vy = 0;
    p.hp = this.prog.maxhp | 0;
    p.shown = 0;
    p.st = 'stand';
    p.inv = this.P.safe_f;
    p.buff = '';
    p.buff_t = 0;
    p.slow = 0;
    if (this.arena_left >= 0 && this.guardian_id > 0) {
      const gd = this.objById(this.guardian_id);
      if (gd && !gd.dead) Kinds.resetGuardian(this, gd);
    }
    this.snapCamera();
  }

  // ---------------------------------------------------------------- items
  give(what, n) {
    const P = this.P;
    if (what === 'coin' || what === 'gem') {
      this.prog.score = (this.prog.score | 0) + this.D.score[what] * n;
      this.emit({ t: 'sfx', id: 'coin' });
      return;
    }
    if (what === 'life') {
      this.prog.lives = Math.min((this.prog.lives | 0) + n, 8);
      this.emit({ t: 'sfx', id: 'life' });
      return;
    }
    const items = this.prog.items;
    if (what in items) {
      items[what] = Math.min((items[what] | 0) + n, P.item_cap);
      if ((items[this.prog.sel] | 0) === 0) this.prog.sel = what;
      this.emit({ t: 'sfx', id: 'item' });
    }
  }

  cycleItem() {
    const order = this.D.items;
    const i = order.indexOf(this.prog.sel);
    for (let k = 1; k <= order.length; k++) {
      const nx = order[(i + k) % order.length];
      if ((this.prog.items[nx] | 0) > 0) {
        if (nx !== this.prog.sel) {
          this.prog.sel = nx;
          this.emit({ t: 'sfx', id: 'menu' });
        }
        return;
      }
    }
  }

  useItem() {
    const P = this.P;
    const p = this.p;
    const what = this.prog.sel;
    const items = this.prog.items;
    if ((items[what] | 0) <= 0) return;
    if (what === 'tonic') {
      if (p.hp >= (this.prog.maxhp | 0)) {
        this.emit({ t: 'sfx', id: 'deny' });
        return;
      }
      p.hp = this.prog.maxhp | 0;
    } else if (what === 'heartroot') {
      if ((this.prog.maxhp | 0) >= P.hp_cap && p.hp >= (this.prog.maxhp | 0)) {
        this.emit({ t: 'sfx', id: 'deny' });
        return;
      }
      this.prog.maxhp = Math.min((this.prog.maxhp | 0) + P.heartroot_add, P.hp_cap);
      p.hp = this.prog.maxhp;
    } else if (what === 'knives') {
      const k = this.addObj('knife', 0, 0);
      k.x = p.x + p.face * 8 * FX;
      k.y = p.y - 22 * FX;
      k.vx = p.face * P.knife_v;
      k.face = p.face;
      k.active = true;
      k.w = 12;
      k.h = 6;
    } else if (what === 'key') {
      if (!this.openGate()) {
        this.emit({ t: 'sfx', id: 'deny' });
        return;
      }
    } else if (what === 'feather' || what === 'squall' || what === 'stoneskin' || what === 'fury') {
      p.buff = what;
      p.buff_t = this.D.timed[what].f;
      if (what === 'squall') this.squallBurst();
    } else {
      return;
    }
    items[what] = (items[what] | 0) - 1;
    this.emit({ t: 'sfx', id: 'use' });
  }

  squallBurst() {
    for (const o of this.objs) {
      if (Kinds.isEnemy(o) && o.active && !o.dead && this.onScreen(o, 0)) {
        Kinds.damage(this, o, this.D.timed.squall.burst, 0);
      }
    }
  }

  openGate() {
    const x = (this.p.x >> 16) >> 4;
    const y = ((this.p.y >> 16) - 20) >> 4;
    for (let ty = y - 3; ty < y + 4; ty++) {
      for (let tx = x - 3; tx < x + 4; tx++) {
        if (this.tile(tx, ty) === 76) {
          for (let yy = 0; yy < this.lh; yy++) if (this.tile(tx, yy) === 76) this.rows[yy][tx] = 46;
          this.emit({ t: 'sfx', id: 'gate' });
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- objects
  onScreen(o, margin) {
    const x = o.x >> 16;
    const y = o.y >> 16;
    return x >= this.cam_x - margin && x <= this.cam_x + 320 + margin && y >= this.cam_y - margin &&
      y - o.h <= this.cam_y + 224 + margin;
  }

  stepObjects() {
    const n = this.objs.length;
    for (let i = 0; i < n; i++) {
      const o = this.objs[i];
      if (o.dead) continue;
      if (!o.active) {
        if (this.onScreen(o, 48)) o.active = true;
        else continue;
      }
      if (o.flash > 0) o.flash -= 1;
      Kinds.step(this, o);
    }
  }

  cleanup() {
    this.objs = this.objs.filter((o) => !o.dead);
  }

  playerHits() {
    const p = this.p;
    const ab = this.attackBox();
    const pb = this.playerBox();
    if (p.buff === 'squall' && this.tick % 20 === 0) {
      const x = p.x >> 16;
      const y = p.y >> 16;
      const gust = [x - 24, y - 44, x + 24, y + 4];
      for (const o of this.objs) {
        if (!o.dead && o.active && Kinds.isEnemy(o) && Kinds.hittable(o) && Game.overlap(gust, this.objBox(o))) {
          Kinds.damage(this, o, 1, o.x > p.x ? 1 : -1);
        }
      }
    }
    for (const o of this.objs) {
      if (o.dead || !o.active) continue;
      const ob = this.objBox(o);
      if (ab && Kinds.hittable(o) && Game.overlap(ab, ob) && !p.hits.includes(o.id)) {
        p.hits.push(o.id);
        const times = p.st === 'attack' ? this.H.hits : 1;
        for (let i = 0; i < times; i++) {
          const dir = p.st !== 'special' && !(p.st === 'attack' && p.combo === 2) ? p.face : (o.x > p.x ? 1 : -1);
          Kinds.damage(this, o, this.attackDamage(), dir);
        }
      }
      if (this.mode !== 'play') return;
      if (Game.overlap(pb, ob)) Kinds.touch(this, o);
    }
  }

  // ---------------------------------------------------------------- camera and arena
  snapCamera() {
    this.cam_x = this.camTargetX();
    this.cam_y = this.camTargetY();
  }

  camTargetX() {
    const x = (this.p.x >> 16) - 152;
    const lo = this.arena_left >= 0 ? this.arena_left : 0;
    return clamp(x, lo, Math.max(lo, this.lw * T - 320));
  }

  camTargetY() {
    return clamp((this.p.y >> 16) - 150, 0, Math.max(0, this.lh * T - 224));
  }

  followCamera() {
    const tx = this.camTargetX();
    const ty = this.camTargetY();
    this.cam_x += clamp(tx - this.cam_x, -6, 6);
    this.cam_y += clamp(ty - this.cam_y, -4, 4);
  }

  checkArena() {
    if (this.arena_x < 0 || this.arena_left >= 0) return;
    if ((this.p.x >> 16) - this.P.hw >= this.arena_x + T) {
      this.arena_left = this.arena_x;
      const col = this.arena_x >> 4;
      for (let ty = 0; ty < this.lh; ty++) if (this.rows[ty][col] === 46) this.rows[ty][col] = 88;
      const gd = this.objById(this.guardian_id);
      if (gd) {
        gd.active = true;
        this.queueTalk(this.head.talk ?? 'meet_' + gd.k, 'wake:' + this.guardian_id);
        this.emit({ t: 'music', id: 'none' });
      }
    }
  }

  guardianDown(o) {
    this.prog.score = (this.prog.score | 0) + this.D.enemies[o.k].score;
    if (o.k === 'grane') {
      this.queueTalk('grane_change', 'silt');
      return;
    }
    const b = this.addObj('bell', o.x >> 16, (o.y >> 16) - 8);
    b.active = true;
    b.vy = -3 * FX;
    this.emit({ t: 'sfx', id: 'bell' });
    this.emit({ t: 'music', id: 'none' });
  }

  takeBell(o) {
    o.dead = true;
    this.prog.score = (this.prog.score | 0) + this.D.score.bell;
    this.mode = 'clear';
    this.mode_t = 150;
    this.p.st = this.p.ground ? 'stand' : 'fall';
    this.emit({ t: 'bell', stage: this.stage });
    if (this.stage === 'brinecrow') this.emit({ t: 'ending' });
  }

  stepPlayerPhysicsOnly() {
    const P = this.P;
    const p = this.p;
    const hw = P.hw;
    p.vx = 0;
    if (!this.grounded(p, hw, true)) {
      p.vy = Math.min(p.vy + P.gravity, P.max_fall);
      const hit = this.moveBody(p, hw, P.h, true);
      p.ground = hit.floor;
      p.st = hit.floor ? 'stand' : 'fall';
    } else {
      p.ground = true;
      p.st = 'stand';
    }
  }

  // ---------------------------------------------------------------- checks
  // The same hash as game.gd state_hash(), for the parity check.
  stateHash() {
    let h = 17;
    const p = this.p;
    const parts = [this.tick, p.x, p.y, p.vx, p.vy, p.hp, p.shown, p.inv, p.atk, this.cam_x, this.cam_y,
      this.prog.score | 0, this.prog.lives | 0, this.rng & 0xFFFF, this.objs.length];
    for (const o of this.objs) parts.push(o.id, o.x, o.y, o.hp);
    for (const v of parts) h = Number((BigInt(h) * 31n + BigInt(v & 0xFFFFFFF)) & 0xFFFFFFFn);
    return h;
  }
}
