// Evaluates a parsed .real program into a list of nodes.
//
// A node is what `name { ... }` builds: a camera, a sphere, a material and
// so on. The evaluator does not know what a sphere is; it only collects
// properties and child nodes. src/scene/scene.js checks them against the
// node schemas and turns them into a renderable scene.

import { RealityError, suggest } from './errors.js';
import { parseHex } from '../core/color.js';
import { CONSTANTS, FUNCTIONS, describe } from './builtins.js';
import { Signal, isTimeVarying, lift, resolve } from './signal.js';
import { sampleKeys, EASINGS } from '../scene/animation.js';

const MAX_ITERATIONS = 200000;

// A name that is not a variable, used as a whole property value, such as
// `pattern: checker` or `focus: auto`. The scene checks it against the
// property's allowed words and reports "not defined" otherwise.
export class BareWord {
  constructor(name, loc, hint) {
    this.name = name;
    this.loc = loc;
    this.hint = hint;
  }
}

export class NodeValue {
  constructor(kind, loc) {
    this.kind = kind;
    this.loc = loc;
    this.props = new Map(); // name -> { value, loc }
    this.children = [];
    this.base = null; // the node this one was derived from, if any
  }
  get(name) {
    return this.props.get(name)?.value;
  }
  clone() {
    const n = new NodeValue(this.kind, this.loc);
    for (const [k, v] of this.props) n.props.set(k, v);
    n.children = this.children.slice();
    n.base = this;
    return n;
  }
}

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.vars = new Map();
  }
  lookup(name) {
    for (let s = this; s; s = s.parent) if (s.vars.has(name)) return { found: true, value: s.vars.get(name) };
    return { found: false };
  }
  names() {
    const out = new Set();
    for (let s = this; s; s = s.parent) for (const k of s.vars.keys()) out.add(k);
    return out;
  }
}

// imports: Map of path -> parsed Program, prepared by the caller.
export function evaluate(program, { imports = new Map() } = {}) {
  const ev = new Evaluator(imports);
  const root = new Scope();
  for (const [k, v] of Object.entries(CONSTANTS)) root.vars.set(k, v);
  const scene = new Scope(root);
  const nodes = [];
  ev.statements(program.body, scene, {
    onNode: (n) => nodes.push(n),
    onProperty: (p) => {
      throw new RealityError(`"${p.name}:" is a property; put it inside a block such as camera { ... }`, p.loc);
    },
  });
  return { nodes, warnings: ev.warnings };
}

class Evaluator {
  constructor(imports) {
    this.imports = imports;
    this.iterations = 0;
    this.warnings = [];
    this.importing = new Set();
  }

  statements(list, scope, sink) {
    for (const st of list) this.statement(st, scope, sink);
  }

  statement(st, scope, sink) {
    switch (st.type) {
      case 'Property':
        return sink.onProperty(st);
      case 'Let':
        scope.vars.set(st.name, this.expr(st.value, scope));
        return;
      case 'Repeat': {
        const iter = this.expr(st.iter, scope);
        if (isTimeVarying(iter)) throw new RealityError('repeat needs a fixed range; it cannot change over time', st.iter.loc);
        const items = Array.isArray(iter) ? iter : typeof iter === 'number' ? range(0, iter, false) : null;
        if (!items) throw new RealityError(`repeat needs a range like 0..10 or a list, got ${describe(iter)}`, st.iter.loc);
        items.forEach((item) => {
          if (++this.iterations > MAX_ITERATIONS) throw new RealityError(`more than ${MAX_ITERATIONS} loop iterations; is a range too large?`, st.loc);
          const inner = new Scope(scope);
          inner.vars.set(st.name, item);
          this.statements(st.body, inner, sink);
        });
        return;
      }
      case 'If': {
        const cond = this.expr(st.cond, scope);
        if (isTimeVarying(cond)) {
          throw new RealityError('an if-statement cannot depend on time; use `cond ? a : b` for a value that changes', st.cond.loc);
        }
        const branch = truthy(cond) ? st.then : st.otherwise;
        if (branch) this.statements(branch, new Scope(scope), sink);
        return;
      }
      case 'Import': {
        const prog = this.imports.get(st.path);
        if (!prog) throw new RealityError(`could not import "${st.path}"`, st.loc);
        if (this.importing.has(st.path)) throw new RealityError(`"${st.path}" imports itself`, st.loc);
        this.importing.add(st.path);
        this.statements(prog.body, scope, sink);
        this.importing.delete(st.path);
        return;
      }
      case 'ExprStmt': {
        const v = this.expr(st.expr, scope);
        const list = Array.isArray(v) ? v : [v];
        for (const n of list) {
          if (!(n instanceof NodeValue)) {
            throw new RealityError(`this line computes ${describe(n)} but does nothing with it`, st.loc,
              'to keep a value, write `let name = ...`');
          }
          sink.onNode(n);
        }
        return;
      }
      default:
        throw new RealityError(`unexpected ${st.type}`, st.loc);
    }
  }

  expr(e, scope) {
    try {
      return this.exprInner(e, scope);
    } catch (err) {
      if (err instanceof RealityError) throw err;
      throw new RealityError(err.message, e.loc);
    }
  }

  exprInner(e, scope) {
    switch (e.type) {
      case 'Number':
      case 'String':
      case 'Bool':
        return e.value;
      case 'Color': {
        const c = parseHex(e.value);
        if (!c) throw new RealityError(`"${e.value}" is not a colour`, e.loc);
        return c;
      }
      case 'Ident': {
        const r = scope.lookup(e.name);
        if (r.found) return r.value;
        if (e.name in FUNCTIONS) return { fn: e.name };
        const s = suggest(e.name, [...scope.names(), ...Object.keys(FUNCTIONS)]);
        throw new RealityError(`"${e.name}" is not defined`, e.loc, s ? `did you mean "${s}"?` : 'define it first with `let`');
      }
      case 'Vector':
        return e.items.map((it) => this.expr(it, scope));
      case 'Range': {
        const from = this.expr(e.from, scope), to = this.expr(e.to, scope);
        if (isTimeVarying(from) || isTimeVarying(to)) throw new RealityError('a range cannot change over time', e.loc);
        return range(from, to, e.inclusive);
      }
      case 'Unary': {
        const a = this.expr(e.arg, scope);
        return lift((x) => (e.op === '-' ? arith('-', 0, x) : !truthy(x)), [a]);
      }
      case 'Binary': {
        const a = this.expr(e.left, scope), b = this.expr(e.right, scope);
        return lift((x, y) => binary(e.op, x, y), [a, b]);
      }
      case 'Ternary': {
        const c = this.expr(e.cond, scope);
        const a = this.expr(e.a, scope), b = this.expr(e.b, scope);
        if (isTimeVarying(c)) return new Signal((time) => (truthy(resolve(c, time)) ? resolve(a, time) : resolve(b, time)));
        return truthy(c) ? a : b;
      }
      case 'Call': {
        const callee = this.expr(e.callee, scope);
        const args = e.args.map((a) => this.expr(a, scope));
        if (callee && callee.fn) return lift(FUNCTIONS[callee.fn], args);
        if (callee instanceof NodeValue) throw new RealityError(`${callee.kind} is not a function; to copy it with changes write ${e.callee.name ?? 'name'} { ... }`, e.loc);
        throw new RealityError(`${describe(callee)} is not a function`, e.loc);
      }
      case 'Index': {
        const obj = this.expr(e.obj, scope), idx = this.expr(e.index, scope);
        return lift((o, i) => {
          if (!Array.isArray(o)) throw new TypeError(`cannot index ${describe(o)}`);
          const k = Math.floor(i);
          const v = o[k < 0 ? o.length + k : k];
          if (v === undefined) throw new TypeError(`index ${i} is outside a list of ${o.length}`);
          return v;
        }, [obj, idx]);
      }
      case 'Member': {
        const obj = this.expr(e.obj, scope);
        if (obj instanceof NodeValue) {
          if (!obj.props.has(e.name)) throw new RealityError(`this ${obj.kind} has no "${e.name}" set`, e.loc);
          return obj.get(e.name);
        }
        const SWZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
        return lift((o) => {
          if (!Array.isArray(o)) throw new TypeError(`cannot read .${e.name} of ${describe(o)}`);
          const parts = e.name.split('').map((ch) => SWZ[ch]);
          if (parts.some((p) => p === undefined || p >= o.length)) throw new TypeError(`no .${e.name} on a list of ${o.length}`);
          return parts.length === 1 ? o[parts[0]] : parts.map((p) => o[p]);
        }, [obj]);
      }
      case 'Keys': {
        const entries = e.entries.map((en) => {
          const time = this.expr(en.time, scope);
          if (typeof time !== 'number') throw new RealityError('a key time must be a fixed number of seconds, like 1.5s', en.loc);
          if (en.ease && !EASINGS[en.ease]) {
            const s = suggest(en.ease, Object.keys(EASINGS));
            throw new RealityError(`unknown easing "${en.ease}"`, en.loc, s ? `did you mean "${s}"?` : null);
          }
          return { time, value: this.expr(en.value, scope), ease: en.ease };
        });
        entries.sort((a, b) => a.time - b.time);
        return new Signal((time) => sampleKeys(entries.map((en) => ({ ...en, value: resolve(en.value, time) })), time));
      }
      case 'Node':
        return this.node(e, scope);
      default:
        throw new RealityError(`unexpected ${e.type}`, e.loc);
    }
  }

  // `kind { ... }` makes a new node. If `kind` names a variable that holds a
  // node, the new node is a copy of it with the block's changes applied:
  //   let ball = sphere { radius: 0.2 }
  //   ball { position: [1, 0.2, 0] }
  node(e, scope) {
    const r = scope.lookup(e.kind);
    let node;
    if (r.found) {
      if (!(r.value instanceof NodeValue)) {
        throw new RealityError(`"${e.kind}" holds ${describe(r.value)}, not something that can be copied with { ... }`, e.loc);
      }
      node = r.value.clone();
      node.loc = e.loc;
    } else {
      node = new NodeValue(e.kind, e.loc);
    }
    const inner = new Scope(scope);
    this.statements(e.body, inner, {
      onProperty: (p) => {
        let value;
        if (p.value.type === 'Ident' && !inner.lookup(p.value.name).found) {
          const s = suggest(p.value.name, [...inner.names()]);
          value = new BareWord(p.value.name, p.value.loc, s ? `did you mean "${s}"?` : 'define it first with `let`');
        } else {
          value = this.expr(p.value, inner);
        }
        node.props.set(p.name, { value, loc: p.loc });
      },
      onNode: (child) => node.children.push(child),
    });
    return node;
  }
}

function range(from, to, inclusive) {
  if (typeof from !== 'number' || typeof to !== 'number') throw new TypeError('a range needs numbers on both sides');
  const out = [];
  const end = inclusive ? to : to - 1e-9;
  if (Math.abs(to - from) > MAX_ITERATIONS) throw new TypeError(`range ${from}..${to} is too large`);
  for (let v = from; v <= end; v++) out.push(v);
  return out;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function arith(op, a, b) {
  const aa = Array.isArray(a), ba = Array.isArray(b);
  if (aa || ba) {
    const n = aa ? a.length : b.length;
    if (aa && ba && a.length !== b.length) throw new TypeError(`cannot ${opName(op)} lists of ${a.length} and ${b.length}`);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = arith(op, aa ? a[i] : a, ba ? b[i] : b);
    return out;
  }
  if (typeof a !== 'number' || typeof b !== 'number') {
    if (op === '+' && (typeof a === 'string' || typeof b === 'string')) return String(a) + String(b);
    throw new TypeError(`cannot ${opName(op)} ${describe(a)} and ${describe(b)}`);
  }
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return ((a % b) + b) % b;
    case '^': return Math.pow(a, b);
  }
  throw new TypeError(`unknown operator ${op}`);
}

const opName = (op) => ({ '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '%': 'take the remainder of', '^': 'raise' }[op]);

function equal(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return a === b;
}

function binary(op, a, b) {
  switch (op) {
    case '==': return equal(a, b);
    case '!=': return !equal(a, b);
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    case '&&': return truthy(a) && truthy(b);
    case '||': return truthy(a) || truthy(b);
    default: return arith(op, a, b);
  }
}
