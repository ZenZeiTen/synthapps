// Crowmere Hill engine core: parser, rule matcher, game state.
//
// Pure and deterministic -- no DOM, no timers, no randomness -- so the same
// transcript produces the same output in Node, the browser, and (via the GDScript
// port in godot/scripts/core.gd) Godot. docs/ENGINE_SPEC.md is the contract both
// implementations follow; tests/transcripts are the proof they agree.
//
// Written in a deliberately plain style (loops, dictionaries, no generators or
// clever regexes) so the port to GDScript stays line-for-line.

export const CORE_VERSION = 1;

// ---------------------------------------------------------------- normalization

export function normalizeTokens(text, fillers) {
  const s = String(text).toLowerCase();
  let clean = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const isAlnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    clean += isAlnum ? c : ' ';
  }
  const out = [];
  const parts = clean.split(' ');
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (t === '') continue;
    if (fillers && fillers[t]) continue;
    out.push(t);
  }
  return out;
}

function asList(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------- the game

export class Game {
  constructor(data, rooms) {
    this.data = data;
    this.rooms = rooms || {};
    const v = data.vocab;
    this.fillers = {};
    for (const f of v.fillers) this.fillers[f] = true;
    this.pronouns = {};
    for (const p of v.pronouns) this.pronouns[p] = true;
    this.preps = {};
    for (const p of v.preps) this.preps[p] = true;
    this.known = {};
    const addKnown = (tokens) => { for (const t of tokens) this.known[t] = true; };
    addKnown(v.fillers); addKnown(v.pronouns); addKnown(v.preps);

    this.dirWords = {};
    for (const dir of Object.keys(v.dirs)) {
      for (const w of v.dirs[dir]) {
        const toks = normalizeTokens(w, this.fillers);
        if (toks.length === 1) { this.dirWords[toks[0]] = dir; addKnown(toks); }
      }
    }

    this.verbPhrases = {};
    this.maxVerbLen = 1;
    this.conflicts = [];
    for (const verb of Object.keys(v.verbs)) {
      for (const w of v.verbs[verb].words) {
        const toks = normalizeTokens(w, this.fillers);
        if (toks.length === 0) continue;
        const phrase = toks.join(' ');
        const prev = this.verbPhrases[phrase];
        if (prev !== undefined && prev !== verb) this.conflicts.push(`verb phrase "${phrase}": ${prev} vs ${verb}`);
        if (prev === undefined) this.verbPhrases[phrase] = verb;
        if (toks.length > this.maxVerbLen) this.maxVerbLen = toks.length;
        addKnown(toks);
      }
    }

    // Entities: objects first, then scenery, in definition order.
    this.entities = {};
    this.entityOrder = [];
    for (const id of Object.keys(data.objects)) {
      this.entities[id] = { kind: 'object', id, def: data.objects[id] };
      this.entityOrder.push(id);
    }
    for (const id of Object.keys(data.scenery)) {
      this.entities[id] = { kind: 'scenery', id, def: data.scenery[id] };
      this.entityOrder.push(id);
    }
    this.nounPhrases = {};
    this.maxNounLen = 1;
    for (const id of this.entityOrder) {
      for (const w of this.entities[id].def.words) {
        const toks = normalizeTokens(w, this.fillers);
        if (toks.length === 0) continue;
        const phrase = toks.join(' ');
        if (!this.nounPhrases[phrase]) this.nounPhrases[phrase] = [];
        if (this.nounPhrases[phrase].indexOf(id) < 0) this.nounPhrases[phrase].push(id);
        if (toks.length > this.maxNounLen) this.maxNounLen = toks.length;
        addKnown(toks);
      }
    }
  }

  // ------------------------------------------------------------ state

  newState() {
    const st = this.data.start;
    const state = {
      room: st.room, pos: { x: 0, y: 0 }, face: st.face || 'down',
      flags: {}, loc: {}, score: 0, awarded: {}, turns: 0,
      dead: false, won: false, visited: {}, lastNoun: null,
    };
    for (const id of Object.keys(this.data.objects)) {
      const start = this.data.objects[id].start;
      state.loc[id] = start === undefined ? null : start;
    }
    for (const id of asList(st.inventory)) state.loc[id] = 'inv';
    const pt = this.point(st.room, st.point);
    if (pt) state.pos = { x: pt[0], y: pt[1] };
    state.visited[st.room] = true;
    return state;
  }

  start(state) {
    return [{ t: 'say', text: this.roomLook(state) }];
  }

  snapshot(state) { return JSON.stringify(state); }
  restore(json) { return JSON.parse(json); }

  // ------------------------------------------------------------ geometry helpers

  point(room, name) {
    const r = this.rooms[room];
    if (!r || !r.points) return null;
    const p = r.points[name];
    return p ? p : null;
  }

  zone(room, name) {
    const r = this.rooms[room];
    if (!r || !r.zones) return null;
    return r.zones[name] || null;
  }

  isNearPoint(state, pointName) {
    if (!pointName) return true;
    const p = this.point(state.room, pointName);
    if (!p) return true;
    const rx = this.data.reach.rx, ry = this.data.reach.ry;
    const dx = (state.pos.x - p[0]) / rx, dy = (state.pos.y - p[1]) / ry;
    return dx * dx + dy * dy <= 1.0;
  }

  isNear(state, entityId) {
    const e = this.entities[entityId];
    if (!e) return true;
    return this.isNearPoint(state, e.def.at);
  }

  walkable(room, x, y) {
    const r = this.rooms[room];
    if (!r || !r.walk) return false;
    const xi = Math.floor(x), yi = Math.floor(y);
    if (yi < 0 || yi >= r.walk.h || xi < 0 || xi >= r.walk.w) return false;
    const runs = r.walk.rows[yi];
    for (let i = 0; i < runs.length; i += 2) {
      if (xi >= runs[i] && xi < runs[i] + runs[i + 1]) return true;
    }
    return false;
  }

  // Exit whose zone polygon contains (x, y), or null.
  zoneAt(state, x, y) {
    const exits = this.data.rooms[state.room].exits || {};
    for (const exitId of Object.keys(exits)) {
      const z = this.zone(state.room, exits[exitId].zone);
      if (z && pointInPoly(z.poly, x, y)) return exitId;
    }
    return null;
  }

  // ------------------------------------------------------------ conditions

  check(state, conds) {
    for (const c of asList(conds)) {
      if (!this.checkOne(state, c)) return false;
    }
    return true;
  }

  checkOne(state, c) {
    if ('flag' in c) return !!state.flags[c.flag];
    if ('not' in c) return !state.flags[c.not];
    if ('has' in c) return state.loc[c.has] === 'inv';
    if ('hasnt' in c) return state.loc[c.hasnt] !== 'inv';
    if ('at' in c) return state.loc[c.at[0]] === c.at[1];
    if ('notat' in c) return state.loc[c.notat[0]] !== c.notat[1];
    if ('room' in c) return asList(c.room).indexOf(state.room) >= 0;
    if ('notroom' in c) return asList(c.notroom).indexOf(state.room) < 0;
    if ('near' in c) return this.isNear(state, c.near);
    throw new Error('unknown condition ' + JSON.stringify(c));
  }

  isPresent(state, id) {
    const e = this.entities[id];
    if (!e) return false;
    if (e.kind === 'object') return state.loc[id] === 'inv' || state.loc[id] === state.room;
    const room = e.def.room;
    const inRoom = room === '*' || asList(room).indexOf(state.room) >= 0;
    return inRoom && this.check(state, e.def.if);
  }

  overlays(state) {
    const ov = this.data.rooms[state.room].overlays || {};
    const out = [];
    for (const id of Object.keys(ov)) if (this.check(state, ov[id])) out.push(id);
    return out;
  }

  // ------------------------------------------------------------ text

  evalParts(state, parts) {
    const out = [];
    for (const p of asList(parts)) {
      if (typeof p === 'string') out.push(p);
      else if (this.check(state, p.if)) out.push(p.text);
    }
    return out.join(' ');
  }

  format(state, text) {
    return String(text).split('{score}').join(String(state.score))
      .split('{max}').join(String(this.data.meta.maxScore));
  }

  msg(key, vars) {
    let s = this.data.text[key];
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  roomLook(state) { return this.evalParts(state, this.data.rooms[state.room].look); }

  inventoryText(state) {
    const names = [];
    for (const id of Object.keys(this.data.objects)) if (state.loc[id] === 'inv') names.push(this.data.objects[id].name);
    if (names.length === 0) return this.msg('inventory_empty');
    let list = names[0];
    if (names.length > 1) list = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return this.msg('inventory', { items: list });
  }

  // ------------------------------------------------------------ parser

  findNouns(tokens, state) {
    const found = [];
    let unmatched = false;
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (this.pronouns[t]) {
        found.push({ pronoun: t });
        i += 1;
        continue;
      }
      let matched = false;
      for (let len = Math.min(this.maxNounLen, tokens.length - i); len >= 1; len--) {
        const phrase = tokens.slice(i, i + len).join(' ');
        const ids = this.nounPhrases[phrase];
        if (ids) {
          found.push({ phrase, ids });
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) { unmatched = true; i += 1; }
    }
    return { found, unmatched };
  }

  parse(input, state) {
    const toks = normalizeTokens(input, this.fillers);
    if (toks.length === 0) return { empty: true };
    for (const t of toks) if (!this.known[t]) return { error: 'unknown', word: t };

    let verb = null, vlen = 0;
    for (let len = Math.min(this.maxVerbLen, toks.length); len >= 1; len--) {
      const phrase = toks.slice(0, len).join(' ');
      if (this.verbPhrases[phrase] !== undefined) { verb = this.verbPhrases[phrase]; vlen = len; break; }
    }
    let rest = toks.slice(vlen);
    let dir = null;
    let verbWords = toks.slice(0, vlen).join(' ');
    if (verb === null) {
      if (this.dirWords[toks[0]] !== undefined) {
        verb = 'go'; dir = this.dirWords[toks[0]]; rest = toks.slice(1); verbWords = toks[0];
      } else {
        return { error: 'noverb', word: toks[0] };
      }
    } else if (MOVE_VERBS[verb] && rest.length > 0 && this.dirWords[rest[0]] !== undefined) {
      dir = this.dirWords[rest[0]];
      rest = rest.slice(1);
    }

    let p1 = rest, p2 = [];
    for (let i = 0; i < rest.length; i++) {
      if (this.preps[rest[i]]) { p1 = rest.slice(0, i); p2 = rest.slice(i + 1); break; }
    }
    const a = this.findNouns(p1, state);
    const b = this.findNouns(p2, state);
    let n1 = a.found.length > 0 ? a.found[0] : null;
    let n2 = b.found.length > 0 ? b.found[0] : null;
    if (!n1 && n2) { n1 = n2; n2 = b.found.length > 1 ? b.found[1] : null; }
    if (!n2 && a.found.length > 1) n2 = a.found[1];
    return { verb, verbWords, dir, n1, n2, unmatched: a.unmatched || b.unmatched };
  }

  resolve(state, np, verb) {
    if (!np) return null;
    if (np.pronoun) {
      if (!state.lastNoun) return { error: 'pronoun', word: np.pronoun };
      np = { ids: [state.lastNoun] };
    }
    const present = [];
    for (const id of np.ids) if (this.isPresent(state, id)) present.push(id);
    if (present.length === 0) return { id: np.ids[0], absent: true };
    if (present.length === 1) return { id: present[0] };
    const carried = [], here = [];
    for (const id of present) (state.loc[id] === 'inv' ? carried : here).push(id);
    if (verb === 'take' && here.length > 0) return { id: here[0] };
    if (carried.length > 0) return { id: carried[0] };
    return { id: present[0] };
  }

  // ------------------------------------------------------------ commands

  command(state, input) {
    const events = [];
    if (state.dead || state.won) return events;
    const p = this.parse(input, state);
    if (p.empty) return events;
    if (p.error === 'unknown') { events.push(say(this.msg('unknown_word', { word: p.word }))); return events; }
    if (p.error === 'noverb') { events.push(say(this.msg('no_verb'))); return events; }

    let verb = p.verb;
    const n1 = this.resolve(state, p.n1, verb);
    const n2 = this.resolve(state, p.n2, verb);
    for (const n of [n1, n2]) {
      if (n && n.error === 'pronoun') { events.push(say(this.msg('pronoun_unknown', { word: n.word }))); return events; }
    }
    if (verb === 'look' && n1) verb = 'examine';
    const vdef = this.data.vocab.verbs[verb];
    if (vdef.noun === 'required' && !n1 && !p.dir) {
      events.push(say(p.unmatched ? this.msg('not_here') : this.msg('what', { verb: p.verbWords })));
      return events;
    }
    state.turns += 1;
    if (n1 && !n1.absent) state.lastNoun = n1.id;
    this.run(state, verb, n1, n2, p.dir, events, 0);
    return events;
  }

  ruleMatches(state, rule, verb, n1, n2) {
    if (asList(rule.verb).indexOf(verb) < 0) return false;
    if (rule.room !== undefined && asList(rule.room).indexOf(state.room) < 0) return false;
    if (rule.pair !== undefined) {
      if (!n1 || !n2) return false;
      const a = rule.pair[0], b = rule.pair[1];
      if (!((n1.id === a && n2.id === b) || (n1.id === b && n2.id === a))) return false;
    } else {
      if (rule.noun !== undefined) {
        if (!n1) return false;
        if (rule.noun !== '*' && asList(rule.noun).indexOf(n1.id) < 0) return false;
      } else if (n1) {
        return false;
      }
      if (rule.noun2 !== undefined) {
        if (!n2) return false;
        if (rule.noun2 !== '*' && asList(rule.noun2).indexOf(n2.id) < 0) return false;
      }
    }
    return true;
  }

  // First rule (in authored order) that matches verb, nouns, room and conditions.
  firstRule(state, verb, n1, n2) {
    for (const rule of this.data.rules) {
      if (!this.ruleMatches(state, rule, verb, n1, n2)) continue;
      if (!rule.absentOK && ((n1 && n1.absent) || (n2 && n2.absent))) continue;
      if (!this.check(state, rule.if)) continue;
      return rule;
    }
    return null;
  }

  run(state, verb, n1, n2, dir, events, depth) {
    if (depth > 5) throw new Error('redirect loop at ' + verb);
    const rule = this.firstRule(state, verb, n1, n2);
    if (rule) {
      if (rule.near !== undefined && !this.isNear(state, rule.near)) {
        events.push(say(this.msg('not_close')));
        return 'done';
      }
      return this.applyEffects(state, rule.do, events, depth);
    }
    if ((n1 && n1.absent) || (n2 && n2.absent)) { events.push(say(this.msg('not_here'))); return 'done'; }
    if (n1) {
      const canned = this.entities[n1.id].def.verbs;
      if (canned && canned[verb] !== undefined) { events.push(say(canned[verb])); return 'done'; }
    }
    return this.defaults(state, verb, n1, n2, dir, events);
  }

  applyEffects(state, effects, events, depth) {
    for (const e of asList(effects)) {
      if (e.if !== undefined && !this.check(state, e.if)) continue;
      if ('say' in e) events.push(say(this.format(state, e.say)));
      else if ('set' in e) state.flags[e.set] = true;
      else if ('clear' in e) delete state.flags[e.clear];
      else if ('move' in e) state.loc[e.move[0]] = e.move[1];
      else if ('score' in e) this.award(state, e.score[0], e.score[1], events);
      else if ('sound' in e) events.push({ t: 'sound', name: e.sound });
      else if ('die' in e) { state.dead = true; events.push({ t: 'die', text: e.die }); return 'die'; }
      else if ('win' in e) { state.won = true; events.push({ t: 'win', text: e.win }); return 'win'; }
      else if ('goto' in e) { this.gotoRoom(state, e.goto[0], e.goto[1], e.goto[2], events); return 'goto'; }
      else if ('stop' in e) return 'stop';
      else if ('redirect' in e) {
        const r = e.redirect;
        const a = r[1] ? { id: r[1] } : null;
        const b = r[2] ? { id: r[2] } : null;
        const res = this.run(state, r[0], a, b, null, events, depth + 1);
        if (res === 'die' || res === 'win' || res === 'goto' || res === 'stop') return res;
      } else throw new Error('unknown effect ' + JSON.stringify(e));
    }
    return 'done';
  }

  award(state, points, id, events) {
    if (state.awarded[id]) return;
    state.awarded[id] = true;
    state.score += points;
    events.push({ t: 'score', delta: points, total: state.score });
  }

  findExit(state, dir, entityId) {
    const exits = this.data.rooms[state.room].exits || {};
    for (const id of Object.keys(exits)) {
      const x = exits[id];
      if (dir && asList(x.dir).indexOf(dir) >= 0) return id;
      if (entityId && asList(x.nouns).indexOf(entityId) >= 0) return id;
    }
    return null;
  }

  defaults(state, verb, n1, n2, dir, events) {
    const room = this.data.rooms[state.room];
    switch (verb) {
      case 'look': events.push(say(this.roomLook(state))); return 'done';
      case 'examine': {
        const text = this.evalParts(state, this.entities[n1.id].def.look);
        events.push(say(text || this.msg('examine_default')));
        return 'done';
      }
      case 'inventory': events.push(say(this.inventoryText(state))); return 'done';
      case 'score': events.push(say(this.format(state, this.msg('score')))); return 'done';
      case 'help': events.push(say(this.msg('help'))); return 'done';
      case 'wait': events.push(say(this.msg('wait'))); return 'done';
      case 'hint': {
        for (const h of this.data.hints) {
          if (this.check(state, h.if)) { events.push(say(h.text)); return 'done'; }
        }
        return 'done';
      }
      case 'save': case 'restore': case 'restart': case 'quit':
        events.push({ t: 'meta', what: verb }); return 'done';
      case 'take': {
        const e = this.entities[n1.id];
        if (e.kind !== 'object') { events.push(say(this.msg('cant_take'))); return 'done'; }
        if (state.loc[n1.id] === 'inv') { events.push(say(this.msg('already_have'))); return 'done'; }
        if (!this.isNearPoint(state, e.def.at)) { events.push(say(this.msg('not_close'))); return 'done'; }
        state.loc[n1.id] = 'inv';
        events.push(say(e.def.take || this.msg('taken')));
        if (e.def.score) this.award(state, e.def.score, 'take_' + n1.id, events);
        return 'done';
      }
      case 'drop': case 'throw': {
        if (state.loc[n1.id] !== 'inv') { events.push(say(this.msg('dont_have'))); return 'done'; }
        events.push(say(this.msg('cant_drop')));
        return 'done';
      }
      case 'smell': case 'listen':
        if (!n1) { events.push(say(room[verb] || this.msg('cant_do'))); return 'done'; }
        break;
      case 'go': case 'climb': case 'enter': case 'exit': case 'jump': {
        let exitId = null;
        if (dir) exitId = this.findExit(state, dir, null);
        else if (n1) exitId = this.findExit(state, null, n1.id);
        else if (verb === 'enter') exitId = this.findExit(state, 'in', null);
        else if (verb === 'exit') exitId = this.findExit(state, 'out', null);
        if (exitId) {
          const x = room.exits[exitId];
          if (this.check(state, x.when)) { events.push({ t: 'walkto', exit: exitId }); return 'done'; }
          // "go to the door" when it's shut means walk up to it, not bump into it
          if (verb === 'go' && !dir && n1 && this.entities[n1.id].def.at) {
            events.push({ t: 'walkto', point: this.entities[n1.id].def.at });
            return 'done';
          }
          events.push(say(x.blocked || this.msg('cant_go')));
          return 'done';
        }
        if (verb === 'go' && n1 && this.entities[n1.id].def.at) {
          events.push({ t: 'walkto', point: this.entities[n1.id].def.at });
          return 'done';
        }
        if (dir || verb === 'go' || verb === 'enter' || verb === 'exit') { events.push(say(this.msg('cant_go'))); return 'done'; }
        break;
      }
    }
    const vdef = this.data.vocab.verbs[verb];
    events.push(say(vdef && vdef.default ? vdef.default : this.msg('cant_do')));
    return 'done';
  }

  // ------------------------------------------------------------ rooms & exits

  gotoRoom(state, room, pointName, face, events) {
    state.room = room;
    const pt = this.point(room, pointName);
    if (pt) state.pos = { x: pt[0], y: pt[1] };
    state.face = face || state.face;
    events.push({ t: 'room', room, point: pointName });
    for (const rule of this.data.rules) {
      if (asList(rule.verb).indexOf('@enter') < 0) continue;
      if (rule.room !== undefined && asList(rule.room).indexOf(room) < 0) continue;
      if (!this.check(state, rule.if)) continue;
      this.applyEffects(state, rule.do, events, 0);
    }
    if (!state.visited[room]) {
      state.visited[room] = true;
      events.push(say(this.roomLook(state)));
    }
  }

  // Called when the player walks into an exit zone (or arrives after a walkto).
  // Returns { events, blocked, passable }.
  enterZone(state, exitId) {
    const events = [];
    const x = (this.data.rooms[state.room].exits || {})[exitId];
    if (!x || state.dead || state.won) return { events, blocked: false, passable: true };
    if (!this.check(state, x.when)) {
      if (x.silent) return { events, blocked: false, passable: true };
      events.push(say(x.blocked || this.msg('cant_go')));
      return { events, blocked: true, passable: false };
    }
    // _exit rules are hooks: they may add effects, veto (stop), kill or win; if none
    // matches, or the matching one just scores, the default transition happens.
    const hook = this.firstRule(state, '_exit', { id: exitId }, null);
    if (hook) {
      const res = this.applyEffects(state, hook.do, events, 0);
      if (res === 'die' || res === 'win' || res === 'goto' || res === 'stop') {
        return { events, blocked: res === 'stop', passable: false };
      }
    }
    this.gotoRoom(state, x.to, x.at, x.face, events);
    return { events, blocked: false, passable: false };
  }
}

const MOVE_VERBS = { go: true, climb: true, enter: true, exit: true, jump: true };

function say(text) { return { t: 'say', text }; }

export function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
