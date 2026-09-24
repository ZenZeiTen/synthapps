// Mutation check for the transcript suite: inject targeted faults into core.js and
// confirm each one turns at least one transcript red. A suite that survives a mutant
// is not evidence of anything. Run manually:  node tests/mutation.mjs
//
// Each mutant is a literal find/replace; the script asserts the find text occurs
// exactly once so a refactor cannot silently turn a mutant into a no-op.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, loadContent, runTranscript } from './harness.mjs';

const CORE = path.join(ROOT, 'web', 'src', 'core.js');
const src = fs.readFileSync(CORE, 'utf8');

const MUTANTS = [
  ['reach check always passes', 'return dx * dx + dy * dy <= 1.0;', 'return true;'],
  ['take prefers carried objects', "if (verb === 'take' && here.length > 0) return { id: here[0] };", ''],
  ['fillers not removed', 'if (fillers && fillers[t]) continue;', ''],
  ['dead player keeps acting', 'if (state.dead || state.won) return events;', ''],
  ['@enter rules skipped', "if (asList(rule.verb).indexOf('@enter') < 0) continue;", 'continue;'],
  ['score awarded repeatedly', 'if (state.awarded[id]) return;', ''],
  ['exit condition ignored', 'if (!this.check(state, x.when)) {\n      if (x.silent)', 'if (false) {\n      if (x.silent)'],
];

const transcripts = fs.readdirSync(path.join(ROOT, 'tests', 'transcripts')).filter((f) => f.endsWith('.txt')).sort();
const { data, rooms } = loadContent();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crowmere-mut-'));
let survivors = 0;

async function suiteFails(coreSource, tag) {
  const file = path.join(tmp, `core_${tag}.mjs`);
  fs.writeFileSync(file, coreSource);
  const { Game } = await import(pathToFileURL(file).href);
  const failed = [];
  for (const t of transcripts) {
    let ok;
    try {
      const { actual, expected } = runTranscript(new Game(data, rooms), fs.readFileSync(path.join(ROOT, 'tests', 'transcripts', t), 'utf8'));
      ok = actual === expected;
    } catch (e) { ok = false; }
    if (!ok) failed.push(t);
  }
  return failed;
}

const baseline = await suiteFails(src, 'baseline');
if (baseline.length) { console.error('baseline already failing:', baseline); process.exit(1); }
console.log('baseline: all', transcripts.length, 'transcripts pass\n');

for (const [i, [name, find, repl]] of MUTANTS.entries()) {
  const count = src.split(find).length - 1;
  if (count !== 1) { console.log(`?? ${name}: anchor found ${count}x -- mutant invalid, fix this script`); survivors++; continue; }
  const failed = await suiteFails(src.replace(find, repl), `m${i}`);
  if (failed.length) console.log(`caught   ${name.padEnd(32)} by ${failed.join(', ')}`);
  else { console.log(`SURVIVED ${name}`); survivors++; }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${MUTANTS.length - survivors}/${MUTANTS.length} mutants caught`);
process.exit(survivors ? 1 : 0);
