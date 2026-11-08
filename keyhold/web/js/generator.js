// Password and passphrase generation with an unbiased random source, and a
// strength estimate that looks for the patterns attackers try first.

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = /[Il1O0o|`'"]/g;

/** Uniform integer in [0, n) by rejection sampling. */
export function randomInt(n) {
  if (!(n > 0 && n <= 2 ** 32)) throw new RangeError('n');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true, avoidAmbiguous = false } = {}) {
  length = Math.max(4, Math.min(128, length | 0));
  const sets = Object.entries({ lower, upper, digits, symbols })
    .filter(([, on]) => on)
    .map(([k]) => (avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (!sets.length) sets.push(SETS.lower);
  const all = sets.join('');
  const out = sets.map((s) => s[randomInt(s.length)]); // at least one of each chosen kind
  while (out.length < length) out.push(all[randomInt(all.length)]);
  return shuffle(out).join('');
}

let wordsCache = null;
/** Load the EFF large word list (7,776 words, 12.9 bits each). */
export async function loadWords(fetcher = (u) => fetch(u).then((r) => r.text())) {
  if (wordsCache) return wordsCache;
  const text = await fetcher('words/eff_large_wordlist.txt');
  wordsCache = text.split('\n').map((l) => l.split('\t')[1]).filter(Boolean).map((w) => w.trim());
  return wordsCache;
}
export function setWords(list) { wordsCache = list; }

export function generatePassphrase(words, { count = 5, separator = '-', capitalize = true, number = true } = {}) {
  count = Math.max(3, Math.min(12, count | 0));
  const parts = [];
  for (let i = 0; i < count; i++) {
    let w = words[randomInt(words.length)];
    if (capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  if (number) parts[randomInt(parts.length)] += String(randomInt(10));
  return parts.join(separator);
}

// The most common leaked passwords and keyboard runs; anything built on these
// falls in the first guesses of any cracking tool.
const COMMON = new Set(`123456 123456789 12345678 password qwerty 12345 qwerty123 1q2w3e 111111 1234567 dragon
123123 baseball abc123 football monkey letmein shadow master 666666 qwertyuiop 123321 mustang 1234567890 michael
654321 superman 1qaz2wsx 7777777 121212 000000 qazwsx 123qwe killer trustno1 jordan jennifer zxcvbnm asdfgh hunter
buster soccer harley batman andrew tigger sunshine iloveyou 2000 charlie robert thomas hockey ranger daniel starwars
klaster 112233 george computer michelle jessica pepper 1111 zxcvbn 555555 11111111 131313 freedom 777777 pass maggie
159753 aaaaaa ginger princess joshua cheese amanda summer love ashley nicole chelsea biteme matthew access yankees
987654321 dallas austin thunder taylor matrix welcome admin administrator passw0rd p@ssw0rd password1 password123
qwerty1 abc12345 secret login hello whatever`.split(/\s+/));
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function isSeqStep(a, b) {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y) return true;
  return SEQUENCES.some((s) => { const i = s.indexOf(x); return i >= 0 && (s[i + 1] === y || s[i - 1] === y); });
}

const LEET = { '@': 'a', 4: 'a', 3: 'e', 1: 'i', '!': 'i', 0: 'o', $: 's', 5: 's', 7: 't' };
const unleet = (s) => s.toLowerCase().replace(/[@43!10$57]/g, (c) => LEET[c] || c);

/**
 * Estimate strength. Returns { bits, score 0-4, label, warnings }.
 * `dictionary` is an optional Set of words (the passphrase list).
 */
export function estimateStrength(pw, dictionary) {
  const warnings = [];
  if (!pw) return { bits: 0, score: 0, label: 'Empty', warnings };
  const chars = [...pw];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  if (/[^\x00-\x7f]/.test(pw)) pool += 100;

  let eff = 1;
  for (let i = 1; i < chars.length; i++) eff += isSeqStep(chars[i - 1], chars[i]) ? 0.25 : 1;
  let bits = eff * Math.log2(pool || 1);
  if (eff < chars.length * 0.7) warnings.push('Avoid repeated characters and runs like "abc" or "123"');

  const core = unleet(pw).replace(/[^a-z]/g, '');
  // Drop the digits and symbols people tack on (years, "!") before undoing letter swaps.
  const stripped = unleet(pw.toLowerCase().replace(/[\d!?.#*@$_-]+$/, '').replace(/^\d+/, ''));
  if (COMMON.has(pw.toLowerCase()) || COMMON.has(unleet(pw)) || COMMON.has(stripped)) {
    bits = Math.min(bits, 8);
    warnings.push('This is one of the most common passwords');
  } else if (dictionary && core.length >= 3 && (dictionary.has(core) || dictionary.has(stripped))) {
    bits = Math.min(bits, Math.log2(dictionary.size) + 14);
    warnings.push('A single word with small changes is easy to guess');
  }

  // Passphrase made of list words: count words, not letters.
  const parts = pw.split(/[\s\-_.,+]+/).filter(Boolean);
  if (dictionary && parts.length >= 3) {
    const known = parts.filter((p) => dictionary.has(p.toLowerCase().replace(/\d+$/, '')));
    if (known.length === parts.length) bits = Math.min(bits, parts.length * Math.log2(dictionary.size) + 4);
  }
  if (/^(19|20)\d\d$/.test(pw.slice(-4)) && pw.length < 14) warnings.push('Years are easy to guess');
  if (chars.length < 12) warnings.push('Use at least 12 characters');

  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits: Math.round(bits), score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score], warnings };
}
