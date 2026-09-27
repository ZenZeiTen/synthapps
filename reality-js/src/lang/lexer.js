// Turns .real source text into tokens.
//
// Token: { type, value, unit?, line, col, nl }
//   type: 'num' | 'str' | 'color' | 'ident' | 'kw' | 'fstop' | 'op' | 'eof'
//   nl:   true when a line break came before this token. The parser uses it
//         so that `(` or `[` at the start of a line never continues the
//         previous expression.

import { RealityError, suggest } from './errors.js';
import { UNITS, unitNames } from './units.js';

export const KEYWORDS = new Set(['let', 'repeat', 'in', 'if', 'else', 'true', 'false', 'keys', 'import']);

const OPERATORS = [
  '..=', '..', '==', '!=', '<=', '>=', '&&', '||', '->',
  '{', '}', '[', ']', '(', ')', ',', ':', '=', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', '.', ';',
];

const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentChar = (c) => isIdentStart(c) || isDigit(c);

export function tokenize(src) {
  const tokens = [];
  let i = 0, line = 1, col = 1, nl = true;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  };
  const push = (tok) => { tokens.push({ ...tok, nl }); nl = false; };

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') { advance(); nl = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { advance(); continue; }

    // Comments: `# ...` or `// ...` to end of line; `/* ... */` blocks.
    // A `#` followed by 3 or 6 hex digits and then a non-word char is a color.
    if (c === '#' && !/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])/.test(src.slice(i, i + 8))) {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = { line, col };
      advance(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance();
      if (i >= src.length) throw new RealityError('unclosed /* comment', start);
      advance(2);
      continue;
    }

    const loc = { line, col };

    if (c === '#') {
      const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/.exec(src.slice(i));
      push({ type: 'color', value: m[0], ...loc });
      advance(m[0].length);
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      // `0..10` is a range: don't swallow the first dot of `..`.
      let text = m[0];
      if (text.endsWith('.') && src[i + text.length] === '.') text = text.slice(0, -1);
      advance(text.length);
      let unit = null;
      if (src[i] === '%') {
        unit = '%';
        advance();
      } else if (isIdentStart(src[i] ?? '')) {
        let u = '';
        while (i < src.length && isIdentChar(src[i])) { u += src[i]; advance(); }
        if (!(u in UNITS)) {
          const s = suggest(u, unitNames());
          throw new RealityError(`unknown unit "${u}"`, loc, s ? `did you mean "${s}"?` : `known units: ${unitNames().join(', ')}`);
        }
        unit = u;
      }
      const raw = parseFloat(text);
      push({ type: 'num', value: unit ? raw * UNITS[unit] : raw, unit, raw, ...loc });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      advance();
      let s = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\n') throw new RealityError('unterminated string', loc);
        if (src[i] === '\\' && i + 1 < src.length) {
          advance();
          const esc = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" }[src[i]];
          s += esc ?? src[i];
          advance();
          continue;
        }
        s += src[i];
        advance();
      }
      if (i >= src.length) throw new RealityError('unterminated string', loc);
      advance();
      push({ type: 'str', value: s, ...loc });
      continue;
    }

    if (isIdentStart(c)) {
      let id = '';
      while (i < src.length && isIdentChar(src[i])) { id += src[i]; advance(); }
      // f-number literal: f/2.8 (no spaces), as printed on lenses.
      if (id === 'f' && src[i] === '/' && /[\d.]/.test(src[i + 1] ?? '')) {
        advance();
        const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
        advance(m[0].length);
        push({ type: 'fstop', value: parseFloat(m[0]), ...loc });
        continue;
      }
      push({ type: KEYWORDS.has(id) ? 'kw' : 'ident', value: id, ...loc });
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      push({ type: 'op', value: op, ...loc });
      advance(op.length);
      continue;
    }

    throw new RealityError(`unexpected character "${c}"`, loc);
  }
  tokens.push({ type: 'eof', value: null, line, col, nl: true });
  return tokens;
}
