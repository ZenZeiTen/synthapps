// Recursive-descent parser for the .real scene language.
//
// Program   := Statement*
// Statement := 'let' IDENT '=' Expr
//            | 'repeat' IDENT 'in' Expr Block
//            | 'if' Expr Block ('else' (Block | IfStmt))?
//            | 'import' STRING
//            | Expr                       (normally a node: `sphere { ... }`)
// Block     := '{' (Property | Statement)* '}'
// Property  := IDENT ':' Expr
// Expr      := Ternary, with the usual precedence below it:
//              || && == != < > <= >= .. + - * / % ^ unary postfix primary
// Primary   := NUM | STR | COLOR | FSTOP | true | false | IDENT | IDENT Block
//            | '[' Expr,* ']' | '(' Expr ')' | 'keys' KeysBlock
// KeysBlock := '{' (Expr ':' Expr ('ease' IDENT)?)* '}'
//
// Commas and semicolons between properties or statements are optional.

import { tokenize } from './lexer.js';
import { RealityError } from './errors.js';

export function parse(src) {
  return new Parser(tokenize(src)).program();
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
    this.noNode = false;
  }

  get tok() { return this.t[this.i]; }
  peek(n = 1) { return this.t[this.i + n]; }
  loc(tok = this.tok) { return { line: tok.line, col: tok.col }; }

  is(type, value) {
    const k = this.tok;
    return k.type === type && (value === undefined || k.value === value);
  }
  isOp(v) { return this.is('op', v); }

  next() { return this.t[this.i++]; }

  expect(type, value, what) {
    if (!this.is(type, value)) {
      const k = this.tok;
      const found = k.type === 'eof' ? 'end of file' : `"${k.value}"`;
      throw new RealityError(`expected ${what ?? (value ?? type)} but found ${found}`, this.loc());
    }
    return this.next();
  }

  skipSeparators() {
    while (this.isOp(',') || this.isOp(';')) this.next();
  }

  program() {
    const body = [];
    this.skipSeparators();
    while (!this.is('eof')) {
      body.push(this.statement());
      this.skipSeparators();
    }
    return { type: 'Program', body };
  }

  statement() {
    const loc = this.loc();
    if (this.is('kw', 'let')) {
      this.next();
      const name = this.expect('ident', undefined, 'a name after "let"').value;
      this.expect('op', '=', '"="');
      return { type: 'Let', name, value: this.expr(), loc };
    }
    if (this.is('kw', 'repeat')) {
      this.next();
      const name = this.expect('ident', undefined, 'a loop variable name').value;
      this.expect('kw', 'in', '"in"');
      const iter = this.headExpr();
      return { type: 'Repeat', name, iter, body: this.block(), loc };
    }
    if (this.is('kw', 'if')) return this.ifStatement();
    if (this.is('kw', 'import')) {
      this.next();
      const path = this.expect('str', undefined, 'a file path in quotes').value;
      return { type: 'Import', path, loc };
    }
    return { type: 'ExprStmt', expr: this.expr(), loc };
  }

  ifStatement() {
    const loc = this.loc();
    this.expect('kw', 'if');
    const cond = this.headExpr();
    const then = this.block();
    let otherwise = null;
    if (this.is('kw', 'else')) {
      this.next();
      otherwise = this.is('kw', 'if') ? [this.ifStatement()] : this.block();
    }
    return { type: 'If', cond, then, otherwise, loc };
  }

  // Block contents: properties (`name: value`) and statements, mixed.
  block() {
    this.expect('op', '{', '"{"');
    const items = [];
    this.skipSeparators();
    while (!this.isOp('}')) {
      if (this.is('eof')) throw new RealityError('missing "}" to close this block', this.loc());
      if (this.is('ident') && this.peek().type === 'op' && this.peek().value === ':') {
        const loc = this.loc();
        const name = this.next().value;
        this.next();
        items.push({ type: 'Property', name, value: this.expr(), loc });
      } else {
        items.push(this.statement());
      }
      this.skipSeparators();
    }
    this.next();
    return items;
  }

  expr() { return this.ternary(); }

  // The expression after `if` or `repeat ... in` is followed by the body's
  // `{`, so `name {` there must not be read as a node constructor.
  headExpr() {
    const saved = this.noNode;
    this.noNode = true;
    try { return this.expr(); } finally { this.noNode = saved; }
  }

  nested(fn) {
    const saved = this.noNode;
    this.noNode = false;
    try { return fn(); } finally { this.noNode = saved; }
  }

  ternary() {
    const cond = this.binary(0);
    if (this.isOp('?')) {
      const loc = this.loc();
      this.next();
      const a = this.expr();
      this.expect('op', ':', '":" in a ? : expression');
      const b = this.expr();
      return { type: 'Ternary', cond, a, b, loc };
    }
    return cond;
  }

  binary(level) {
    const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['..', '..='], ['+', '-'], ['*', '/', '%']];
    if (level === LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.tok.type === 'op' && LEVELS[level].includes(this.tok.value)) {
      const loc = this.loc();
      const op = this.next().value;
      const right = this.binary(level + 1);
      left = op === '..' || op === '..='
        ? { type: 'Range', from: left, to: right, inclusive: op === '..=', loc }
        : { type: 'Binary', op, left, right, loc };
    }
    return left;
  }

  unary() {
    if (this.isOp('-') || this.isOp('!') || this.isOp('+')) {
      const loc = this.loc();
      const op = this.next().value;
      const arg = this.unary();
      return op === '+' ? arg : { type: 'Unary', op, arg, loc };
    }
    return this.power();
  }

  power() {
    const base = this.postfix();
    if (this.isOp('^')) {
      const loc = this.loc();
      this.next();
      return { type: 'Binary', op: '^', left: base, right: this.unary(), loc };
    }
    return base;
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(') && !this.tok.nl) {
        const loc = this.loc();
        this.next();
        const args = this.nested(() => this.list(')'));
        e = { type: 'Call', callee: e, args, loc };
      } else if (this.isOp('[') && !this.tok.nl) {
        const loc = this.loc();
        this.next();
        const index = this.nested(() => this.expr());
        this.expect('op', ']', '"]"');
        e = { type: 'Index', obj: e, index, loc };
      } else if (this.isOp('.') && this.peek().type === 'ident') {
        const loc = this.loc();
        this.next();
        e = { type: 'Member', obj: e, name: this.next().value, loc };
      } else {
        return e;
      }
    }
  }

  list(close) {
    const items = [];
    while (!this.isOp(close)) {
      if (this.is('eof')) throw new RealityError(`missing "${close}"`, this.loc());
      items.push(this.expr());
      if (this.isOp(',')) this.next();
      else if (!this.isOp(close)) {
        throw new RealityError(`expected "," or "${close}" but found "${this.tok.value}"`, this.loc());
      }
    }
    this.next();
    return items;
  }

  primary() {
    const k = this.tok;
    const loc = this.loc();
    switch (k.type) {
      case 'num':
        this.next();
        return { type: 'Number', value: k.value, unit: k.unit, loc };
      case 'str':
        this.next();
        return { type: 'String', value: k.value, loc };
      case 'color':
        this.next();
        return { type: 'Color', value: k.value, loc };
      case 'fstop':
        this.next();
        return { type: 'Number', value: k.value, unit: 'fstop', loc };
      case 'kw':
        if (k.value === 'true' || k.value === 'false') {
          this.next();
          return { type: 'Bool', value: k.value === 'true', loc };
        }
        if (k.value === 'keys') {
          this.next();
          return this.keys(loc);
        }
        break;
      case 'ident': {
        this.next();
        // `name { ... }` constructs a node (object, material, camera ...).
        if (this.isOp('{') && !this.noNode) {
          return { type: 'Node', kind: k.value, body: this.nested(() => this.block()), loc };
        }
        return { type: 'Ident', name: k.value, loc };
      }
      case 'op':
        if (k.value === '[') {
          this.next();
          return { type: 'Vector', items: this.nested(() => this.list(']')), loc };
        }
        if (k.value === '(') {
          this.next();
          const e = this.nested(() => this.expr());
          this.expect('op', ')', '")"');
          return e;
        }
        break;
    }
    const found = k.type === 'eof' ? 'end of file' : `"${k.value}"`;
    throw new RealityError(`expected a value but found ${found}`, loc);
  }

  // keys { 0s: [0,1,0]  1.5s: [2,1,0] ease out  3s: [2,3,0] ease in_out }
  keys(loc) {
    this.expect('op', '{', '"{" after keys');
    const entries = [];
    this.skipSeparators();
    while (!this.isOp('}')) {
      if (this.is('eof')) throw new RealityError('missing "}" to close keys', this.loc());
      const eloc = this.loc();
      const time = this.binary(0);
      this.expect('op', ':', '":" after a key time');
      const value = this.expr();
      let ease = null;
      if (this.is('ident', 'ease')) {
        this.next();
        ease = this.expect('ident', undefined, 'an easing name, like in_out').value;
      }
      entries.push({ time, value, ease, loc: eloc });
      this.skipSeparators();
    }
    this.next();
    if (entries.length === 0) throw new RealityError('keys needs at least one entry', loc);
    return { type: 'Keys', entries, loc };
  }
}
