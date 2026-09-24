// Re-record a transcript's expected output from the current engine + content.
// Review `git diff` afterwards: recording blesses whatever the engine does now.
//   node tools/record.mjs tests/transcripts/walkthrough.txt [--print]

import fs from 'node:fs';
import { makeGame, runTranscript } from '../tests/harness.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/record.mjs <transcript.txt> [--print]'); process.exit(2); }
const { actual } = runTranscript(makeGame(), fs.readFileSync(file, 'utf8'));
if (process.argv.includes('--print')) process.stdout.write(actual);
else { fs.writeFileSync(file, actual); console.log('recorded', file); }
