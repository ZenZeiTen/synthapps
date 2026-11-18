// Mutation check for tests/bundle.test.mjs: plant one fault at a time in a copy of
// tools/bundle_web.mjs and confirm the suite goes red. Run manually:
//   node tests/mutation_bundle.mjs
// An unmutated copy must pass first -- otherwise "caught" would only mean "broken setup".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './harness.mjs';

const TOOL = path.join(ROOT, 'tools', 'bundle_web.mjs');
const SUITE = path.join(ROOT, 'tests', 'bundle.test.mjs');
const src = fs.readFileSync(TOOL, 'utf8');

const MUTANTS = [
  ['only the first declarator of `export const A, B` counts',
    "else if (depth === 0 && (c === ',' || c === ';')) {", "else if (depth === 0 && c === ';') {"],
  ['line comments are scanned as code',
    "if (c === '/' && src[i + 1] === '/') {", 'if (false) {'],
  ['module wrappers hand back nothing',
    'return { ${names} };', 'return {};'],
  ['dependents are emitted before their dependencies',
    '    for (const im of imports) visit(im.from, [...trail, file]);\n    order.push(file);',
    '    order.push(file);\n    for (const im of imports) visit(im.from, [...trail, file]);'],
  ['"<" is not escaped in the embedded JSON',
    'return JSON.stringify(bundle).replace(', 'return JSON.stringify(bundle); void ('],
  ['unsupported import/export forms are let through',
    'for (const [re, what] of bad) if', 'for (const [re, what] of []) if'],
  ['a missing export goes unnoticed',
    'if (!have.has(n.orig)) throw', 'if (false) throw'],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crowmere-bundle-mut-'));
const run = (file) => spawnSync(process.execPath, ['--test', SUITE],
  { env: { ...process.env, CROWMERE_BUNDLER: file }, encoding: 'utf8' });

const clean = path.join(tmp, 'clean.mjs');
fs.writeFileSync(clean, src);
const base = run(clean);
if (base.status !== 0) {
  console.error('the unmutated copy fails the suite; fix that before trusting any result\n' + base.stdout.slice(-2000));
  process.exit(2);
}

let survivors = 0;
MUTANTS.forEach(([name, find, rep], i) => {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`mutant "${name}": find text occurs ${n} times, expected 1`);
  const file = path.join(tmp, `mutant${i}.mjs`);
  fs.writeFileSync(file, src.replace(find, () => rep));
  const caught = run(file).status !== 0;
  if (!caught) survivors++;
  console.log(`${caught ? 'caught  ' : 'SURVIVED'}  ${name}`);
});
console.log(`${MUTANTS.length - survivors}/${MUTANTS.length} mutants caught`);
process.exit(survivors ? 1 : 0);
