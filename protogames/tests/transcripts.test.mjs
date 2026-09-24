// Golden transcripts: each tests/transcripts/*.txt is replayed and must regenerate
// byte-identically. To (re)record after a deliberate content change:
//   node tools/record.mjs tests/transcripts/<file>.txt     (then review the diff!)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeGame, runTranscript, ROOT } from './harness.mjs';

const dir = path.join(ROOT, 'tests', 'transcripts');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();

test('transcripts exist', () => assert.ok(files.length > 0));

for (const f of files) {
  test(`transcript ${f}`, () => {
    const game = makeGame();
    const { actual, expected } = runTranscript(game, fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(actual, expected);
  });
}
