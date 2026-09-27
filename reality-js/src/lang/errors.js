// Errors that point at a place in the source text.

export class RealityError extends Error {
  constructor(message, loc = null, hint = null) {
    super(message);
    this.name = 'RealityError';
    this.loc = loc; // { line, col } (1-based)
    this.hint = hint;
  }

  // A readable report with the offending line and a caret under it.
  format(source) {
    let out = this.loc ? `line ${this.loc.line}, column ${this.loc.col}: ${this.message}` : this.message;
    if (this.loc && source != null) {
      const line = source.split('\n')[this.loc.line - 1];
      if (line !== undefined) {
        const gutter = String(this.loc.line).padStart(4) + ' | ';
        out += '\n' + gutter + line + '\n' + ' '.repeat(gutter.length + this.loc.col - 1) + '^';
      }
    }
    if (this.hint) out += '\n  hint: ' + this.hint;
    return out;
  }
}

// Closest candidate by edit distance, for "did you mean" hints.
export function suggest(word, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}
