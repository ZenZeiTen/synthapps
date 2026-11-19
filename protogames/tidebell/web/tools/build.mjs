// Builds web/dist: the page, the sources, the content, and the parts of three.js it uses.
// The result is a static folder that runs from any web server.
//   node web/tools/build.mjs
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(WEB, 'dist');
const THREE = resolve(WEB, 'node_modules/three');
if (!existsSync(THREE)) throw new Error('run npm install in web/ first');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(resolve(WEB, 'index.html'), resolve(DIST, 'index.html'));
cpSync(resolve(WEB, 'src'), resolve(DIST, 'src'), { recursive: true });
cpSync(resolve(WEB, 'public/content'), resolve(DIST, 'content'), { recursive: true });
for (const f of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'LICENSE']) {
  const dst = resolve(DIST, 'vendor/three', f);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(resolve(THREE, f), dst);
}
console.log('built web/dist');
