// A small static server for web/dist (tests and local play).
//   node web/tools/serve.mjs [dir] [port]      then open http://127.0.0.1:8421/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };

export function serve(dir = resolve(WEB, 'dist'), port = 0) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : resolve(WEB, 'dist');
  const s = await serve(dir, parseInt(process.argv[3] ?? '8421', 10));
  console.log(`serving ${dir} at http://127.0.0.1:${s.address().port}/`);
}
