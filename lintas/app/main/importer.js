// Import bookmarks, history and a few settings from other browsers installed on this
// computer (Chrome, Edge, Brave, Vivaldi, Opera, Chromium and Firefox), or from a bookmarks
// HTML file that any browser can export.
//
// Nothing is written to the other browser's profile: databases are copied to a temporary
// folder and read there, so this also works while that browser is open.
// Passwords, cookies and open tabs are not imported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { markupTokens, tagAttr, decodeEntities } from '../../core/formats.js';

const HISTORY_LIMIT = 5000;
const CHROME_EPOCH_MS = 11644473600000; // 1601-01-01 to 1970-01-01

const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', win: ['LOCALAPPDATA', 'Google/Chrome/User Data'], mac: 'Google/Chrome', linux: '.config/google-chrome' },
  { id: 'edge', name: 'Microsoft Edge', win: ['LOCALAPPDATA', 'Microsoft/Edge/User Data'], mac: 'Microsoft Edge', linux: '.config/microsoft-edge' },
  { id: 'brave', name: 'Brave', win: ['LOCALAPPDATA', 'BraveSoftware/Brave-Browser/User Data'], mac: 'BraveSoftware/Brave-Browser', linux: '.config/BraveSoftware/Brave-Browser' },
  { id: 'vivaldi', name: 'Vivaldi', win: ['LOCALAPPDATA', 'Vivaldi/User Data'], mac: 'Vivaldi', linux: '.config/vivaldi' },
  { id: 'opera', name: 'Opera', win: ['APPDATA', 'Opera Software/Opera Stable'], mac: 'com.operasoftware.Opera', linux: '.config/opera', single: true },
  { id: 'chromium', name: 'Chromium', win: ['LOCALAPPDATA', 'Chromium/User Data'], mac: 'Chromium', linux: '.config/chromium' },
];

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const webUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 4096;

function roots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const appSupport = path.join(home, 'Library', 'Application Support');
  const chromium = CHROMIUM.map(b => {
    let dir = null;
    if (platform === 'win32') dir = env[b.win[0]] ? path.join(env[b.win[0]], ...b.win[1].split('/')) : null;
    else if (platform === 'darwin') dir = path.join(appSupport, ...b.mac.split('/'));
    else dir = path.join(home, ...b.linux.split('/'));
    return { ...b, dir };
  });
  const firefox = platform === 'win32' ? [env.APPDATA && path.join(env.APPDATA, 'Mozilla', 'Firefox')]
    : platform === 'darwin' ? [path.join(appSupport, 'Firefox')]
    : [path.join(home, '.mozilla', 'firefox'), path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')];
  return { chromium, firefox: firefox.filter(Boolean) };
}

function chromiumProfiles(b) {
  if (!b.dir || !isDir(b.dir)) return [];
  if (b.single) return exists(path.join(b.dir, 'Bookmarks')) || exists(path.join(b.dir, 'History')) ? [{ id: '.', name: 'Default', path: b.dir }] : [];
  const names = readJson(path.join(b.dir, 'Local State'))?.profile?.info_cache || {};
  const dirs = new Set(Object.keys(names));
  try { for (const d of fs.readdirSync(b.dir)) if (d === 'Default' || /^Profile \d+$/.test(d)) dirs.add(d); } catch {}
  return [...dirs].filter(d => !d.includes('..') && (exists(path.join(b.dir, d, 'Bookmarks')) || exists(path.join(b.dir, d, 'History'))))
    .map(d => ({ id: d, name: String(names[d]?.name || d), path: path.join(b.dir, d) }));
}

/** Firefox profiles from profiles.ini; the one Firefox starts with comes first. */
export function firefoxProfiles(dir) {
  let ini; try { ini = fs.readFileSync(path.join(dir, 'profiles.ini'), 'utf8'); } catch { return []; }
  const sections = []; let cur = null;
  for (const line of ini.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) { cur = { _name: t.slice(1, -1) }; sections.push(cur); }
    else if (cur && t.includes('=')) { const i = t.indexOf('='); cur[t.slice(0, i)] = t.slice(i + 1); }
  }
  const installDefault = sections.find(s => s._name.startsWith('Install') && s.Default)?.Default;
  const out = [];
  for (const s of sections.filter(x => x._name.startsWith('Profile') && x.Path)) {
    const p = s.IsRelative === '0' ? s.Path : path.join(dir, ...s.Path.split('/'));
    if (!exists(path.join(p, 'places.sqlite'))) continue;
    const first = s.Path === installDefault || (!installDefault && s.Default === '1');
    out[first ? 'unshift' : 'push']({ id: s.Path, name: s.Name || path.basename(p), path: p });
  }
  return out;
}

/** Browsers with at least one profile on this computer. */
export function detectBrowsers(opts = {}) {
  const r = roots(opts);
  const list = [];
  for (const b of r.chromium) {
    const profiles = chromiumProfiles(b);
    if (profiles.length) list.push({ id: b.id, name: b.name, kind: 'chromium', profiles });
  }
  const seen = new Set();
  const ff = r.firefox.flatMap(d => firefoxProfiles(d)).filter(p => !seen.has(p.path) && seen.add(p.path));
  if (ff.length) list.push({ id: 'firefox', name: 'Mozilla Firefox', kind: 'firefox', profiles: ff });
  return list;
}

/** Reads a SQLite database through a temporary copy (the browser may hold a lock on it). */
function withDbCopy(file, fn) {
  if (!exists(file)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-import-'));
  try {
    const copy = path.join(tmp, path.basename(file));
    fs.copyFileSync(file, copy);
    for (const ext of ['-wal', '-journal']) if (exists(file + ext)) fs.copyFileSync(file + ext, copy + ext);
    const db = new DatabaseSync(copy);
    try { return fn(db); } finally { db.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const iso = (ms) => { const d = new Date(Number(ms)); return Number.isFinite(d.getTime()) && d.getFullYear() > 1990 ? d.toISOString() : new Date().toISOString(); };

function searchEngineFrom(text) {
  const s = String(text || '').toLowerCase();
  if (s.includes('duckduckgo') || s === 'ddg') return 'duckduckgo';
  if (s.includes('startpage')) return 'startpage';
  if (s.includes('brave')) return 'brave';
  if (s.includes('bing')) return 'bing';
  if (s.includes('google')) return 'google';
  return null;
}

// ---------- Chromium ----------

export function readChromium(profileDir) {
  const bookmarks = [];
  const tree = readJson(path.join(profileDir, 'Bookmarks'));
  const walk = (node, folder) => {
    for (const c of node?.children || []) {
      if (c.type === 'url' && webUrl(c.url)) bookmarks.push({ url: c.url, title: String(c.name || c.url), folder, createdAt: iso(Number(c.date_added || 0) / 1000 - CHROME_EPOCH_MS) });
      else if (c.type === 'folder') walk(c, folder ? `${folder} / ${c.name}` : String(c.name || 'Folder'));
    }
  };
  if (tree?.roots) {
    walk(tree.roots.bookmark_bar, null); // the bookmarks bar stays on the bar
    walk(tree.roots.other, 'Other bookmarks');
    walk(tree.roots.synced, 'Mobile bookmarks');
  }
  let history = [];
  try { history = withDbCopy(path.join(profileDir, 'History'), db =>
    db.prepare(`SELECT url, title, visit_count AS visits, (last_visit_time / 1000 - ${CHROME_EPOCH_MS}) AS ms FROM urls
      WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ${HISTORY_LIMIT}`).all()) || []; }
  catch { history = []; } // an unreadable history database does not block the bookmarks
  const prefs = readJson(path.join(profileDir, 'Preferences')) || {};
  const settings = {};
  const sp = prefs.default_search_provider_data?.template_url_data;
  const engine = sp && (searchEngineFrom(sp.keyword) || searchEngineFrom(sp.url) || searchEngineFrom(sp.short_name));
  if (engine) settings.searchEngine = engine;
  if (prefs.homepage_is_newtabpage === false && webUrl(prefs.homepage)) settings.homepage = prefs.homepage;
  return { bookmarks, history: history.filter(h => webUrl(h.url)).map(h => ({ url: h.url, title: h.title || h.url, visitedAt: iso(h.ms), visits: Math.max(1, Number(h.visits) || 1) })), settings };
}

// ---------- Firefox ----------

/** Decompresses Firefox's mozLz4 format (an LZ4 block with an 12-byte header). */
export function decodeMozLz4(buf) {
  if (buf.length < 12 || buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') throw new Error('Not a mozLz4 file');
  const size = buf.readUInt32LE(8);
  if (size > 64 * 1024 * 1024) throw new Error('mozLz4 file too large');
  const src = buf.subarray(12), out = Buffer.alloc(size);
  let i = 0, o = 0;
  const len = () => { let n = 0, b; do { if (i >= src.length) throw new Error('Truncated mozLz4 data'); b = src[i++]; n += b; } while (b === 255); return n; };
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4; if (lit === 15) lit += len();
    if (i + lit > src.length || o + lit > size) throw new Error('Corrupt mozLz4 data');
    src.copy(out, o, i, i + lit); i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let match = token & 15; if (match === 15) match += len(); match += 4;
    if (!off || off > o || o + match > size) throw new Error('Corrupt mozLz4 data');
    for (let k = 0; k < match; k++, o++) out[o] = out[o - off];
  }
  return out.subarray(0, o);
}

const FF_ROOTS = { toolbar_____: null, menu________: 'Bookmarks menu', unfiled_____: 'Other bookmarks', mobile______: 'Mobile bookmarks' };

export function readFirefox(profileDir) {
  const places = path.join(profileDir, 'places.sqlite');
  let data;
  try { data = withDbCopy(places, db => ({
    rows: db.prepare(`SELECT b.id, b.type, b.parent, b.title, b.guid, b.position, (b.dateAdded / 1000) AS ms, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all(),
    history: db.prepare(`SELECT url, title, visit_count AS visits, (last_visit_date / 1000) AS ms FROM moz_places
      WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ${HISTORY_LIMIT}`).all(),
  })) || { rows: [], history: [] }; }
  catch { throw new Error('Firefox’s bookmarks and history database (places.sqlite) could not be read. Try again with Firefox closed, or import a bookmarks HTML file instead.'); }
  const byId = new Map(data.rows.map(r => [r.id, r]));
  const folderOf = (id) => {
    const parts = [];
    for (let r = byId.get(id), n = 0; r && n < 50; r = byId.get(r.parent), n++) {
      if (r.guid in FF_ROOTS) { const root = FF_ROOTS[r.guid]; if (root) parts.unshift(root); return parts.length ? parts.join(' / ') : null; }
      if (r.guid === 'root________') return undefined; // tags and other special roots
      parts.unshift(r.title || 'Folder');
    }
    return undefined;
  };
  const bookmarks = [];
  for (const r of data.rows) {
    if (r.type !== 1 || !webUrl(r.url)) continue;
    const folder = folderOf(r.parent);
    if (folder === undefined) continue;
    bookmarks.push({ url: r.url, title: r.title || r.url, folder, createdAt: iso(r.ms) });
  }
  const settings = {};
  try {
    const prefs = fs.readFileSync(path.join(profileDir, 'prefs.js'), 'utf8');
    const line = prefs.split(/\r?\n/).find(l => l.startsWith('user_pref("browser.startup.homepage",'));
    const value = line && JSON.parse(line.slice(line.indexOf(',') + 1, line.lastIndexOf(')')).trim());
    const first = typeof value === 'string' ? value.split('|')[0] : null;
    if (webUrl(first)) settings.homepage = first;
  } catch {}
  try {
    const json = JSON.parse(decodeMozLz4(fs.readFileSync(path.join(profileDir, 'search.json.mozlz4'))).toString('utf8'));
    const engine = searchEngineFrom(json?.metaData?.defaultEngineId) || searchEngineFrom(json?.metaData?.current);
    if (engine) settings.searchEngine = engine;
  } catch {}
  return { bookmarks, history: data.history.filter(h => webUrl(h.url)).map(h => ({ url: h.url, title: h.title || h.url, visitedAt: iso(h.ms), visits: Math.max(1, Number(h.visits) || 1) })), settings };
}

// ---------- Bookmarks HTML (Netscape format, exported by every browser) ----------

export function parseBookmarksHtml(html) {
  const out = [];
  const stack = [];          // folder names of the open <DL> lists
  let pendingFolder = null;  // <H3> text waiting for its <DL>
  let inH3 = false, h3Text = '', link = null;
  let h3IsToolbar = false;
  for (const t of markupTokens(html)) {
    if (t.type === 'tag') {
      if (t.name === 'h3' && !t.closing) { inH3 = true; h3Text = ''; h3IsToolbar = tagAttr(t.raw, 'personal_toolbar_folder') === 'true'; }
      else if (t.name === 'h3' && t.closing) { inH3 = false; pendingFolder = { name: decodeEntities(h3Text).trim() || 'Folder', toolbar: h3IsToolbar }; }
      else if (t.name === 'dl' && !t.closing) { stack.push(pendingFolder); pendingFolder = null; }
      else if (t.name === 'dl' && t.closing) stack.pop();
      else if (t.name === 'a' && !t.closing) link = { url: tagAttr(t.raw, 'href'), title: '', added: Number(tagAttr(t.raw, 'add_date')) || 0 };
      else if (t.name === 'a' && t.closing && link) {
        if (webUrl(link.url)) {
          const names = [];
          for (const f of stack) { if (!f) continue; if (f.toolbar) { names.length = 0; continue; } names.push(f.name); }
          out.push({ url: link.url, title: decodeEntities(link.title).trim() || link.url, folder: names.length ? names.join(' / ') : null, createdAt: link.added ? iso(link.added * 1000) : new Date().toISOString() });
        }
        link = null;
      }
    } else if (t.type === 'text') {
      if (inH3) h3Text += t.value;
      else if (link) link.title += t.value;
    }
  }
  return out;
}

/** Reads one profile of a detected browser. */
export function readProfile(browser, profile) {
  return browser.kind === 'firefox' ? readFirefox(profile.path) : readChromium(profile.path);
}
