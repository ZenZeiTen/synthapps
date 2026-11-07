// Runs the test files in test/<suite>/ with node's built-in runner.
// (Node 20 does not expand glob patterns given to --test, so the files are listed here.)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const suite = process.argv[2] || 'unit';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), suite);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, f));
const args = ['--test', ...(suite === 'e2e' ? ['--test-concurrency=1'] : []), ...files];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
