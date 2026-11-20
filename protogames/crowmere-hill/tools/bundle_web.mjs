// Builds the single-file web edition: every module, style and asset in one HTML file.
//   node tools/bundle_web.mjs
// Writes
//   dist/crowmere-hill.html           a complete page -- double-click it to play offline
//   dist/crowmere-hill.fragment.html  the same page minus <!doctype>/<html>/<head>/<body>,
//                                     for hosts that wrap pages in their own skeleton
// The content package becomes window.__BUNDLE__ (JSON parsed; PNG and WAV as data:
// URIs), which web/src/assets.js and audio.js read instead of fetching. The ES modules
// are linked into one module script: each dependency runs in its own function scope and
// hands back exactly the names its importers ask for. The linker only understands the
// import/export forms this codebase uses and refuses anything else rather than guess.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const SRC = path.join(WEB, 'src');
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const ENTRY = 'main.js';

// ------------------------------------------------------------ content -> window.__BUNDLE__

const MIME = { '.png': 'image/png', '.wav': 'audio/wav' };

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out.sort();
}

export function buildBundle(contentDir = CONTENT) {
  const bundle = {};
  for (const rel of listFiles(contentDir)) {
    const abs = path.join(contentDir, rel);
    const ext = path.extname(rel).toLowerCase();
    if (ext === '.json') bundle[rel] = JSON.parse(fs.readFileSync(abs, 'utf8'));
    else if (MIME[ext]) bundle[rel] = `data:${MIME[ext]};base64,${fs.readFileSync(abs).toString('base64')}`;
    else throw new Error(`bundle: no rule for content/${rel}`);
  }
  // JSON-escape every '<' so a "</script>" or "<!--" in game text cannot end the script early
  return JSON.stringify(bundle).replace(/</g, '\\u003c');
}

// ------------------------------------------------------------ ES modules -> one script

const IMPORT_RE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+\.js)['"];?[ \t]*$/gm;

function parseImports(src) {
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [orig, local = orig] = s.split(/\s+as\s+/);
      return { orig, local };
    });
    out.push({ from: m[2], names, text: m[0] });
  }
  return out;
}

// Names declared by `export function|class|const|let|var`, including every declarator of
// a multi-name `export const A = 1, B = 2;` (split at top-level commas).
export function exportedNames(src) {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(function\*?|class|const|let|var)\s+/gm;
  let m;
  while ((m = re.exec(src))) {
    if (!['const', 'let', 'var'].includes(m[1])) { names.add(/^[A-Za-z_$][\w$]*/.exec(src.slice(re.lastIndex))[0]); continue; }
    let depth = 0, quote = null, start = re.lastIndex;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
      if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (depth === 0 && (c === ',' || c === ';')) {
        names.add(/^\s*([A-Za-z_$][\w$]*)/.exec(src.slice(start, i))[1]);
        start = i + 1;
        if (c === ';') break;
      }
    }
  }
  return names;
}

function refuseUnsupported(file, src) {
  const bad = [
    [/^[ \t]*import\b(?!\s*\{)/m, 'default, namespace or side-effect import'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\bimport\.meta\b/, 'import.meta'],
    [/^[ \t]*export\s+(default\b|\{|\*)/m, 'export default / export { } / export *'],
    [/<\/script|<!--/i, 'a "</script" or "<!--" sequence'],
  ];
  for (const [re, what] of bad) if (re.test(src)) throw new Error(`bundle: ${file} uses ${what}; extend tools/bundle_web.mjs first`);
}

export function linkModules(srcDir = SRC, entry = ENTRY) {
  const mods = new Map();                       // file -> { src, imports }
  const order = [];
  (function visit(file, trail) {
    if (trail.includes(file)) throw new Error(`bundle: import cycle ${[...trail, file].join(' -> ')}`);
    if (mods.has(file)) return;
    const src = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const imports = parseImports(src);
    let rest = src;
    for (const im of imports) rest = rest.replace(im.text, '');
    refuseUnsupported(file, rest);
    mods.set(file, { src, imports });
    for (const im of imports) visit(im.from, [...trail, file]);
    order.push(file);                            // post-order: dependencies first
  })(entry, []);

  // what each module must hand back = the union of what its importers ask for
  const wanted = new Map();
  for (const [file, { imports }] of mods) {
    for (const im of imports) {
      const have = exportedNames(mods.get(im.from).src);
      for (const n of im.names) {
        if (!have.has(n.orig)) throw new Error(`bundle: ${file} imports ${n.orig}, which ${im.from} does not export`);
        if (!wanted.has(im.from)) wanted.set(im.from, new Set());
        wanted.get(im.from).add(n.orig);
      }
    }
  }

  const parts = ['const __mod = Object.create(null);'];
  for (const file of order) {
    const { imports } = mods.get(file);
    let body = mods.get(file).src;
    for (const im of imports) {
      const bind = im.names.map((n) => (n.orig === n.local ? n.orig : `${n.orig}: ${n.local}`)).join(', ');
      body = body.replace(im.text, `const { ${bind} } = __mod['${im.from}'];`);
    }
    body = body.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
    if (file === entry) { parts.push(`// ---- ${file}\n${body}`); continue; }   // top level: may await
    const names = [...(wanted.get(file) || [])].join(', ');
    parts.push(`// ---- ${file}\n__mod['${file}'] = (() => {\n${body}\nreturn { ${names} };\n})();`);
  }
  return { js: parts.join('\n\n'), order };
}

// ------------------------------------------------------------ page

function between(html, open, close) {
  const a = html.indexOf(open), b = html.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error(`bundle: index.html lacks ${open}...${close}`);
  return html.slice(a + open.length, b);
}

function main() {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const head = between(html, '<head>', '</head>');
  const body = between(html, '<body>', '</body>');
  const TAG = '<script type="module" src="src/main.js"></script>';
  if (body.split(TAG).length !== 2) throw new Error('bundle: expected exactly one entry <script> in index.html');

  const data = buildBundle();
  const { js, order } = linkModules();
  const scripts = `<script>window.__BUNDLE__ = ${data};</script>\n<script type="module">\n${js}\n</script>`;
  const bodyOut = body.replace(TAG, () => scripts);

  const full = `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>${bodyOut}</body>\n</html>\n`;
  // the host skeleton supplies charset + viewport; keep title, font links and styles first
  const fragment = head.replace(/^[ \t]*<meta\b[^>]*>\r?\n?/gm, '').trim() + '\n' + bodyOut.trim() + '\n';

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'crowmere-hill.html'), full);
  fs.writeFileSync(path.join(DIST, 'crowmere-hill.fragment.html'), fragment);
  const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
  console.log(`modules: ${order.join(' ')}`);
  console.log(`assets:  ${Object.keys(JSON.parse(data)).length} files, ${kb(data)} embedded`);
  console.log(`wrote dist/crowmere-hill.html (${kb(full)}) and dist/crowmere-hill.fragment.html (${kb(fragment)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
