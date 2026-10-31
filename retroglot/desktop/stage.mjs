// Copy the retroglot app (server, web pages, demo) into ./app/core so the desktop
// build packages exactly what the command-line version runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'app', 'core');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ['src', 'web', 'demo']) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true, filter: (p) => !p.includes(`${path.sep}build${path.sep}`) && !p.endsWith(`${path.sep}build`) });
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module' }, null, 2));
fs.copyFileSync(path.join(root, '..', 'LICENSE'), path.join(out, 'LICENSE'));
console.log(`staged retroglot ${pkg.version} into ${path.relative(here, out)}`);
