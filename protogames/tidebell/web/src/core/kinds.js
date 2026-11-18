// What every object does each step: enemies, guardians, shots, chests, pickups, posts,
// captives and the bells. A line-for-line port of godot/scripts/core/kinds.gd; keep the
// two in step (tests/parity.sh compares them).
import { Game } from './game.js';

const FX = 65536;
const WAVE = [0, 2, 4, 6, 7, 8, 8, 8, 7, 6, 4, 2, 0, -2, -4, -6, -7, -8, -8, -8, -7, -6, -4, -2];
const ENEMIES = ['raider', 'thrower', 'mudskip', 'bat', 'crab', 'gull', 'wisp', 'golem',
  'vell', 'hullbreaker', 'tallyman', 'oldgrey', 'warden', 'grane', 'siltking'];
const GUARDIANS = ['vell', 'hullbreaker', 'tallyman', 'oldgrey', 'warden', 'grane', 'siltking'];
const HARMFUL = ['bottle', 'net', 'blast', 'feather', 'spark', 'shock', 'wave'];
const SIZE = { bottle: [8, 8], net: [16, 12], bomb: [10, 10], blast: [36, 30], feather: [8, 10],
  spark: [10, 10], shock: [14, 10], wave: [16, 26], fx: [8, 8], coinfx: [8, 8] };

export const isEnemy = (o) => ENEMIES.includes(o.k);
export const isGuardian = (o) => GUARDIANS.includes(o.k);

export function hittable(o) {
  if (o.k === 'chest') return true;
  if (!isEnemy(o)) return false;
  if ((o.asleep ?? 0) === 1) return false;
  if (o.k === 'warden' && (o.st === 'vanish' || o.st === 'idle')) return false;
  return o.st !== 'dying';
}

const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const idiv = (a, b) => Math.trunc(a / b);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const e = (g, o, key, fallback = 0) => (g.D.enemies[o.k][key] ?? fallback) | 0;
const px = (o) => o.x >> 16;
const py = (o) => o.y >> 16;

function fall(g, o, grav = 27648) {
  if (!o.ground) o.vy = Math.min(o.vy + grav, 8 * FX);
  const hit = g.moveBody(o, o.w >> 1, o.h, true);
  o.ground = hit.floor || g.grounded(o, o.w >> 1, true);
  return hit;
}

function floorAhead(g, o, dir) {
  const x = px(o) + dir * ((o.w >> 1) + 2);
  return g.floorAt(x >> 4, py(o) >> 4);
}

function spawn(g, kind, x, y, vx, vy) {
  const s = g.addObj(kind, 0, 0);
  s.x = x;
  s.y = y;
  s.vx = vx;
  s.vy = vy;
  s.active = true;
  s.face = vx !== 0 ? sgn(vx) : 1;
  if (kind in SIZE) {
    s.w = SIZE[kind][0];
    s.h = SIZE[kind][1];
  }
  return s;
}

const dxToPlayer = (g, o) => (g.p.x >> 16) - px(o);
const dyToPlayer = (g, o) => (g.p.y >> 16) - py(o);

// ---------------------------------------------------------------- dispatch
export function step(g, o) {
  o.t += 1;
  if ((o.asleep ?? 0) === 1) {
    fall(g, o);
    o.face = dxToPlayer(g, o) !== 0 ? sgn(dxToPlayer(g, o)) : o.face;
    return;
  }
  switch (o.k) {
    case 'raider': raider(g, o); break;
    case 'thrower': thrower(g, o); break;
    case 'mudskip': mudskip(g, o); break;
    case 'bat': bat(g, o); break;
    case 'crab': crab(g, o); break;
    case 'gull': gull(g, o); break;
    case 'wisp': wisp(g, o); break;
    case 'golem': golem(g, o); break;
    case 'vell': vell(g, o); break;
    case 'hullbreaker': hullbreaker(g, o); break;
    case 'tallyman': tallyman(g, o); break;
    case 'oldgrey': oldgrey(g, o); break;
    case 'warden': warden(g, o); break;
    case 'grane': grane(g, o); break;
    case 'siltking': siltking(g, o); break;
    case 'knife': knife(g, o); break;
    case 'bottle': case 'bomb': {
      const hit = fall(g, o, o.k === 'bottle' ? 16384 : 19661);
      if (hit.floor || hit.wall || hit.ceil) {
        o.dead = true;
        if (o.k === 'bomb') {
          spawn(g, 'blast', o.x, o.y + 8 * FX, 0, 0);
          g.emit({ t: 'sfx', id: 'boom' });
        } else {
          g.emit({ t: 'sfx', id: 'break' });
        }
      }
      break;
    }
    case 'net':
      o.x += o.vx;
      o.y += o.vy;
      o.vy += 4096;
      if (o.t > 90 || g.solidAt(px(o) >> 4, (py(o) - 4) >> 4)) o.dead = true;
      break;
    case 'feather': case 'spark':
      o.x += o.vx;
      o.y += o.vy;
      if (o.t > 240) o.dead = true;
      break;
    case 'shock': case 'wave':
      o.x += o.vx;
      if (o.t > (o.life ?? 40) || g.solidAt((px(o) + sgn(o.vx) * 8) >> 4, (py(o) - 4) >> 4)) o.dead = true;
      break;
    case 'blast': case 'fx': case 'coinfx':
      if (o.t > 14) o.dead = true;
      break;
    case 'pickup':
      if ((o.fall ?? 0) === 1) {
        fall(g, o, 20000);
        if (o.ground) o.vx = 0;
      }
      break;
    case 'bell':
      fall(g, o, 16000);
      break;
    case 'captive':
      if (o.st === 'free') {
        o.x += FX;
        if (o.t > 60) o.dead = true;
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- enemies
function raider(g, o) {
  fall(g, o);
  const dx = dxToPlayer(g, o);
  const dy = dyToPlayer(g, o);
  const reach = e(g, o, 'reach');
  if (o.st === 'windup') {
    o.vx = 0;
    if (o.t >= e(g, o, 'windup')) {
      o.st = 'cut';
      o.t = 0;
      o.struck = 0;
      g.emit({ t: 'sfx', id: 'eswing' });
    }
  } else if (o.st === 'cut') {
    const x = px(o);
    const y = py(o);
    const box = o.face > 0 ? [x, y - 30, x + reach, y - 8] : [x - reach, y - 30, x, y - 8];
    if ((o.struck ?? 0) === 0 && Game.overlap(box, g.playerBox())) {
      o.struck = 1;
      g.enemyHit(o);
    }
    if (o.t >= e(g, o, 'cut')) {
      o.st = 'cool';
      o.t = 0;
    }
  } else if (o.st === 'cool' || o.st === 'knock') {
    if (o.st === 'knock') o.vx = o.vx - sgn(o.vx) * 16384;
    else o.vx = 0;
    if (o.t >= (o.st === 'knock' ? 8 : e(g, o, 'cool'))) {
      o.st = 'walk';
      o.t = 0;
      o.vx = 0;
    }
  } else {
    o.vx = 0;
    if (Math.abs(dx) < 200 && Math.abs(dy) < 48) {
      o.face = dx !== 0 ? sgn(dx) : o.face;
      if (Math.abs(dx) <= reach - 2 && Math.abs(dy) < 30) {
        o.st = 'windup';
        o.t = 0;
      } else if (floorAhead(g, o, o.face)) {
        o.vx = o.face * e(g, o, 'speed');
        o.st = 'walk';
      }
    }
  }
}

function thrower(g, o) {
  fall(g, o);
  const dx = dxToPlayer(g, o);
  o.face = dx !== 0 ? sgn(dx) : o.face;
  if (o.st === 'knock') {
    o.vx = o.vx - sgn(o.vx) * 16384;
    if (o.t >= 8) {
      o.st = 'walk';
      o.t = 0;
    }
    return;
  }
  o.vx = 0;
  const ad = Math.abs(dx);
  let want = 0;
  if (ad < 70) want = -o.face;
  else if (ad > 130 && ad < 240) want = o.face;
  if (want !== 0 && floorAhead(g, o, want)) o.vx = want * e(g, o, 'speed');
  if (o.t >= e(g, o, 'every') && ad < 260 && g.onScreen(o, 0)) {
    o.t = 0;
    const vx = clamp(idiv(dx * FX, 45), -229376, 229376);
    spawn(g, 'bottle', o.x, o.y - 30 * FX, vx, -5 * FX);
    g.emit({ t: 'sfx', id: 'throw' });
  }
}

function mudskip(g, o) {
  const hit = fall(g, o);
  if (hit.floor) o.vx = 0;
  const dx = dxToPlayer(g, o);
  if (o.ground && o.t >= e(g, o, 'every') && Math.abs(dx) < 180) {
    o.t = 0;
    o.face = dx !== 0 ? sgn(dx) : o.face;
    o.vy = -5 * FX;
    o.vx = o.face * 98304;
    o.ground = false;
  }
}

function bat(g, o) {
  const dx = dxToPlayer(g, o);
  const dy = dyToPlayer(g, o);
  if (o.st === 'swoop') {
    o.x += o.vx;
    o.y += o.vy;
    if (py(o) >= o.ty || o.t > 90) {
      o.st = 'rise';
      o.t = 0;
      o.vy = -98304;
      o.vx = sgn(o.vx) * FX;
    }
  } else if (o.st === 'rise') {
    o.x += o.vx;
    o.y += o.vy;
    if (o.y <= o.oy) {
      o.y = o.oy;
      o.st = 'idle';
      o.t = 0;
    }
  } else if (o.t > 30 && Math.abs(dx) < 90 && dy > 0 && dy < 150) {
    o.st = 'swoop';
    o.t = 0;
    o.ty = (g.p.y >> 16) - 16;
    o.face = dx !== 0 ? sgn(dx) : 1;
    o.vx = o.face * 2 * FX;
    o.vy = 163840;
  }
}

function crab(g, o) {
  const hit = fall(g, o);
  if (o.st === 'knock') {
    o.vx = 0;
    if (o.t >= 10) o.st = 'walk';
    return;
  }
  if (hit.wall || (o.ground && !floorAhead(g, o, o.face))) o.face = -o.face;
  o.vx = o.face * e(g, o, 'speed');
}

function gull(g, o) {
  if (o.st === 'idle') {
    o.st = 'fly';
    o.face = dxToPlayer(g, o) < 0 ? -1 : 1;
    if (o.face < 0 && px(o) < g.cam_x + 160) o.face = 1;
  }
  o.x += o.face * e(g, o, 'speed');
  o.y = o.oy + WAVE[(o.t >> 1) % WAVE.length] * 3 * FX;
  if (o.t > 90 && !g.onScreen(o, 64)) o.dead = true;
}

function wisp(g, o) {
  const dx = dxToPlayer(g, o);
  const dy = dyToPlayer(g, o) - 20;
  const v = e(g, o, 'speed');
  if (Math.abs(dx) > 2) o.x += sgn(dx) * v;
  if (Math.abs(dy) > 2) o.y += sgn(dy) * v;
  o.face = dx !== 0 ? sgn(dx) : o.face;
}

function golem(g, o) {
  fall(g, o);
  const dx = dxToPlayer(g, o);
  if (o.st === 'windup') {
    o.vx = 0;
    if (o.t >= 30) {
      o.st = 'cool';
      o.t = 0;
      slam(g, o, 100);
    }
  } else if (o.st === 'cool') {
    o.vx = 0;
    if (o.t >= e(g, o, 'cool')) {
      o.st = 'walk';
      o.t = 0;
    }
  } else {
    o.vx = 0;
    if (Math.abs(dx) < 220) {
      o.face = dx !== 0 ? sgn(dx) : o.face;
      if (Math.abs(dx) < 60 && Math.abs(dyToPlayer(g, o)) < 60) {
        o.st = 'windup';
        o.t = 0;
      } else if (floorAhead(g, o, o.face)) {
        o.vx = o.face * e(g, o, 'speed');
      }
    }
  }
}

function slam(g, o, reachPx) {
  g.emit({ t: 'sfx', id: 'slam' });
  for (const d of [-1, 1]) {
    const s = spawn(g, 'shock', o.x + d * 10 * FX, o.y, d * 163840, 0);
    s.life = idiv(reachPx * 2, 5);
  }
}

function knife(g, o) {
  o.x += o.vx;
  if (g.solidAt(px(o) >> 4, (py(o) - 3) >> 4) || o.t > 80) {
    o.dead = true;
    return;
  }
  const kb = g.objBox(o);
  for (const t of g.objs) {
    if (t.dead || !t.active || !hittable(t)) continue;
    if (Game.overlap(kb, g.objBox(t))) {
      damage(g, t, g.P.knife_damage, o.face);
      o.dead = true;
      return;
    }
  }
}

// ---------------------------------------------------------------- guardians
function vell(g, o) {
  const hit = fall(g, o);
  const dx = dxToPlayer(g, o);
  if (o.st === 'leap') {
    if (hit.floor) {
      o.vx = 0;
      o.st = 'throw';
      o.t = 0;
    }
  } else if (o.st === 'throw') {
    o.vx = 0;
    o.face = dx !== 0 ? sgn(dx) : o.face;
    if (o.t === 14) {
      spawn(g, 'net', o.x + o.face * 10 * FX, o.y - 26 * FX, o.face * 3 * FX, -FX);
      g.emit({ t: 'sfx', id: 'throw' });
    }
    if (o.t >= 34) {
      o.st = 'walk';
      o.t = 0;
    }
  } else {
    o.face = dx !== 0 ? sgn(dx) : o.face;
    o.vx = Math.abs(dx) > 24 ? o.face * 81920 : 0;
    if (o.t >= 50 && o.ground) {
      o.st = 'leap';
      o.t = 0;
      o.vy = -7 * FX;
      o.vx = clamp(idiv(dx * FX, 34), -3 * FX, 3 * FX);
      o.ground = false;
    }
  }
}

function hullbreaker(g, o) {
  const hit = fall(g, o);
  const dx = dxToPlayer(g, o);
  if (o.st === 'charge') {
    o.vx = o.face * 3 * FX;
    if (hit.wall) {
      o.st = 'rest';
      o.t = 0;
      o.vx = 0;
      g.emit({ t: 'sfx', id: 'slam' });
    }
  } else if (o.st === 'rest') {
    o.vx = 0;
    if (o.t >= 90) {
      o.st = 'wind';
      o.t = 0;
    }
  } else {
    o.vx = 0;
    o.face = dx !== 0 ? sgn(dx) : o.face;
    if (o.t >= 30) {
      o.st = 'charge';
      o.t = 0;
    }
  }
}

function tallyman(g, o) {
  const hit = fall(g, o, 27648);
  const dx = dxToPlayer(g, o);
  if (o.st === 'hop') {
    if (hit.floor || (o.ground && o.t > 4)) {
      o.vx = 0;
      o.st = 'lob';
      o.t = 0;
    }
  } else if (o.st === 'lob') {
    o.vx = 0;
    o.face = dx !== 0 ? sgn(dx) : o.face;
    if (o.t === 14 || o.t === 30 || o.t === 46) {
      const vx = clamp(idiv(dx * FX, 40) + (o.t - 30) * 4096, -4 * FX, 4 * FX);
      spawn(g, 'bomb', o.x, o.y - 34 * FX, vx, -6 * FX);
      g.emit({ t: 'sfx', id: 'throw' });
    }
    if (o.t >= 80) {
      o.st = 'idle';
      o.t = 0;
    }
  } else if (o.t >= 10 && o.ground) {
    const stalls = [g.arena_left + 72, g.arena_left + 168, g.arena_left + 264];
    let cur = 0;
    for (let i = 0; i < 3; i++) if (Math.abs(stalls[i] - px(o)) < Math.abs(stalls[cur] - px(o))) cur = i;
    const nxt = (cur + 1 + g.rand(2)) % 3;
    o.st = 'hop';
    o.t = 0;
    o.vy = -7 * FX;
    o.vx = idiv((stalls[nxt] - px(o)) * FX, 33);
    o.ground = false;
  }
}

function oldgrey(g, o) {
  const top = g.cam_y + 48;
  if (o.st === 'dive') {
    o.x += o.vx;
    o.y += o.vy;
    if (o.t >= 30) {
      o.st = 'climb';
      o.t = 0;
    }
  } else if (o.st === 'climb') {
    o.y -= 2 * FX;
    o.x += o.face * FX;
    if (py(o) <= top || o.t >= 60) {
      o.st = 'circle';
      o.t = 0;
    }
  } else {
    if (o.st !== 'circle') {
      o.st = 'circle';
      o.t = 0;
      o.face = -1;
    }
    o.x += o.face * 2 * FX;
    if (px(o) < g.arena_left + 40) o.face = 1;
    else if (px(o) > g.arena_left + 280) o.face = -1;
    o.y = (top + WAVE[(o.t >> 1) % WAVE.length]) * FX;
    if (o.t % 40 === 20) spawn(g, 'feather', o.x, o.y, 0, FX);
    if (o.t >= 120) {
      o.st = 'dive';
      o.t = 0;
      const tx = g.p.x >> 16;
      const ty = (g.p.y >> 16) - 10;
      o.vx = idiv((tx - px(o)) * FX, 30);
      o.vy = idiv((ty - py(o)) * FX, 30);
      o.face = o.vx !== 0 ? sgn(o.vx) : o.face;
      g.emit({ t: 'sfx', id: 'screech' });
    }
  }
}

function warden(g, o) {
  if (o.st === 'vanish') {
    if (o.t >= 40) {
      const spots = [[g.arena_left + 60, 0], [g.arena_left + 260, 0], [g.arena_left + 110, -56],
        [g.arena_left + 210, -56]];
      const s = spots[g.rand(4)];
      o.x = s[0] * FX;
      o.y = o.oy + s[1] * FX;
      o.st = 'cast';
      o.t = 0;
      g.emit({ t: 'sfx', id: 'appear' });
    }
  } else if (o.st === 'cast') {
    const dx = dxToPlayer(g, o);
    o.face = dx !== 0 ? sgn(dx) : o.face;
    if (o.t === 45) {
      for (let k = 0; k < 3; k++) {
        const dy = dyToPlayer(g, o) - 20;
        spawn(g, 'spark', o.x, o.y - 24 * FX, sgn(dx) * (FX + k * 24576), sgn(dy) * (16384 + k * 16384));
      }
      g.emit({ t: 'sfx', id: 'cast' });
    }
    if (o.t >= 100) {
      o.st = 'vanish';
      o.t = 0;
      g.emit({ t: 'sfx', id: 'vanish' });
    }
  } else {
    o.st = 'cast';
    o.t = 0;
  }
}

function grane(g, o) {
  const hit = fall(g, o);
  const dx = dxToPlayer(g, o);
  if (o.st === 'windup') {
    o.vx = 0;
    if (o.t >= 10) {
      o.st = 'cut';
      o.t = 0;
      o.struck = 0;
      g.emit({ t: 'sfx', id: 'eswing' });
    }
  } else if (o.st === 'cut') {
    const x = px(o);
    const y = py(o);
    const box = o.face > 0 ? [x, y - 32, x + 34, y - 8] : [x - 34, y - 32, x, y - 8];
    if ((o.struck ?? 0) === 0 && Game.overlap(box, g.playerBox())) {
      o.struck = 1;
      g.enemyHit(o);
    }
    if (o.t >= 8) {
      o.cuts = (o.cuts ?? 0) + 1;
      o.t = 0;
      if (o.cuts >= 2) {
        o.cuts = 0;
        o.st = 'back';
        o.vx = -o.face * 163840;
        o.vy = -5 * FX;
        o.ground = false;
      } else {
        o.st = 'windup';
      }
    }
  } else if (o.st === 'back') {
    if (hit.floor || (o.ground && o.t > 4)) {
      o.vx = 0;
      o.st = 'walk';
      o.t = 0;
    }
  } else {
    o.face = dx !== 0 ? sgn(dx) : o.face;
    if (Math.abs(dx) < 34 && o.t > 20) {
      o.st = 'windup';
      o.t = 0;
      o.vx = 0;
    } else {
      o.vx = Math.abs(dx) >= 30 ? o.face * 98304 : 0;
    }
  }
}

function siltking(g, o) {
  fall(g, o);
  o.vx = 0;
  const dx = dxToPlayer(g, o);
  o.face = dx !== 0 ? sgn(dx) : o.face;
  if ((o.called ?? 0) === 0 && o.hp <= idiv(e(g, o, 'hp'), 2)) {
    o.called = 1;
    for (const x of [g.arena_left + 24, g.arena_left + 296]) {
      const r = g.addObj('raider', x, o.y >> 16);
      r.active = true;
      r.y = o.y - 40 * FX;
    }
    g.emit({ t: 'sfx', id: 'roar' });
  }
  if (o.st === 'slam') {
    if (o.t >= 40) {
      slam(g, o, 150);
      o.st = 'rest';
      o.t = 0;
      o.n = (o.n ?? 0) + 1;
    }
  } else if (o.st === 'wave') {
    if (o.t === 30) {
      const w = spawn(g, 'wave', o.x + o.face * 30 * FX, o.y, o.face * 163840, 0);
      w.life = 150;
      g.emit({ t: 'sfx', id: 'wave' });
    }
    if (o.t >= 60) {
      o.st = 'rest';
      o.t = 0;
      o.n = (o.n ?? 0) + 1;
    }
  } else if (o.st === 'rest') {
    if (o.t >= 50) {
      o.st = (o.n ?? 0) % 3 === 0 ? 'slam' : 'wave';
      o.t = 0;
    }
  } else {
    o.st = 'rest';
    o.t = 0;
  }
}

// Grane's change (after his defeat talk): the Silt King rises where he fell.
export function siltRise(g) {
  const old = g.objById(g.guardian_id);
  const x = g.arena_left + 240;
  const y = old ? old.y >> 16 : g.p.y >> 16;
  if (old) old.dead = true;
  const k = g.addObj('siltking', x, y);
  k.active = true;
  k.oy = k.y;
  g.guardian_id = k.id;
  g.emit({ t: 'sfx', id: 'roar' });
  g.emit({ t: 'music', id: 'final' });
}

export function resetGuardian(g, o) {
  o.hp = e(g, o, 'hp');
  o.x = o.ox;
  o.y = o.oy;
  o.vx = 0;
  o.vy = 0;
  o.st = 'idle';
  o.t = 0;
  o.called = 0;
  for (const s of g.objs) if (HARMFUL.includes(s.k) || s.k === 'bomb') s.dead = true;
}

// ---------------------------------------------------------------- damage and touch
export function damage(g, o, amount, dir) {
  if (o.k === 'chest') {
    o.dead = true;
    const what = o.holds ?? 'coin';
    g.emit({ t: 'sfx', id: 'chest' });
    const n = what === 'coin' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const pk = g.addObj('pickup', 0, 0);
      pk.x = o.x + (i - (n >> 1)) * 10 * FX;
      pk.y = o.y - 4 * FX;
      pk.vy = -3 * FX;
      pk.what = what;
      pk.fall = 1;
      pk.active = true;
      pk.w = 10;
      pk.h = 10;
    }
    return;
  }
  const st = g.p.st;
  const front = sgn(dxToPlayer(g, o)) === o.face;
  let blocked = false;
  if (o.k === 'crab' && front && st !== 'jattack' && st !== 'special') blocked = true;
  else if (o.k === 'hullbreaker' && o.st !== 'rest') blocked = true;
  else if (o.k === 'grane' && front) {
    o.blocks = (o.blocks ?? 0) + 1;
    blocked = o.blocks % 3 === 0;
  }
  if (blocked) {
    g.emit({ t: 'sfx', id: 'clink' });
    return;
  }
  o.hp -= amount;
  o.flash = 10;
  g.emit({ t: 'sfx', id: 'hit' });
  if (o.hp <= 0) {
    o.dead = true;
    const fx = spawn(g, 'fx', o.x, o.y - (o.h >> 1) * FX, 0, 0);
    fx.w = o.w;
    if (isGuardian(o)) {
      g.guardianDown(o);
    } else {
      g.prog.score = (g.prog.score | 0) + e(g, o, 'score');
      if (g.rand(4) === 0) {
        const pk = g.addObj('pickup', 0, 0);
        pk.x = o.x;
        pk.y = o.y - 8 * FX;
        pk.vy = -3 * FX;
        pk.what = 'coin';
        pk.fall = 1;
        pk.active = true;
        pk.w = 10;
        pk.h = 10;
      }
    }
    return;
  }
  if (!isGuardian(o) && o.k !== 'golem' && (o.k === 'raider' || o.k === 'thrower' || o.k === 'crab')) {
    o.st = 'knock';
    o.t = 0;
    o.vx = dir * 2 * FX;
  }
}

// The hero's body touches o.
export function touch(g, o) {
  switch (o.k) {
    case 'pickup':
      o.dead = true;
      g.give(String(o.what), 1);
      break;
    case 'post':
      if ((o.lit ?? 0) === 0) {
        o.lit = 1;
        g.check_x = o.x;
        g.check_y = o.y;
        g.emit({ t: 'sfx', id: 'post' });
      }
      break;
    case 'captive':
      if (o.st !== 'free' && g.talk_id === '') {
        o.st = 'free';
        o.t = 0;
        const parts = String(o.talk ?? '').split(':');
        g.prog.score = (g.prog.score | 0) + g.D.score.captive;
        g.queueTalk(parts[0], parts.length > 1 ? 'give:' + parts[1] : '');
      }
      break;
    case 'bell':
      if (o.ground) g.takeBell(o);
      break;
    case 'raider': case 'thrower': case 'grane': case 'chest': case 'knife': case 'fx': case 'coinfx':
      break;
    case 'hullbreaker':
      if (o.st === 'charge') g.enemyHit(o);
      break;
    case 'warden':
      if (o.st === 'cast') g.enemyHit(o);
      break;
    case 'net':
      g.p.slow = 120;
      o.dead = true;
      g.emit({ t: 'sfx', id: 'net' });
      break;
    case 'bottle': case 'spark': case 'feather':
      o.dead = true;
      g.enemyHit(o);
      break;
    case 'blast': case 'shock': case 'wave':
      g.enemyHit(o);
      break;
    default:
      if (isEnemy(o) && (o.asleep ?? 0) === 0) g.enemyHit(o);
  }
}
