import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { detectBrowsers, readProfile, parseBookmarksHtml, decodeMozLz4 } from '../app/main/importer.js';
import { BrowserData } from '../app/main/browserdata.js';
import { JsonStore } from '../core/store.js';

const CHROME_EPOCH_MS = 11644473600000;
const chromeTime = (iso) => (Date.parse(iso) + CHROME_EPOCH_MS) * 1000;
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };

/** mozLz4 with literals only, which is valid LZ4. */
function mozLz4(text) {
  const data = Buffer.from(text, 'utf8');
  const len = [];
  if (data.length < 15) len.push(data.length << 4);
  else { len.push(0xf0); let n = data.length - 15; while (n >= 255) { len.push(255); n -= 255; } len.push(n); }
  const head = Buffer.alloc(12); head.write('mozLz40\0', 0, 'latin1'); head.writeUInt32LE(data.length, 8);
  return Buffer.concat([head, Buffer.from(len), data]);
}

function fakeChrome(dir) {
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' } } } }));
  const prof = mk(dir, 'Default');
  const node = (name, url) => ({ type: 'url', name, url, date_added: String(chromeTime('2025-03-01T10:00:00Z')) });
  fs.writeFileSync(path.join(prof, 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', children: [node('KBBI', 'https://kbbi.kemdikbud.go.id/'), { type: 'folder', name: 'Dev', children: [node('MDN', 'https://developer.mozilla.org/'), { type: 'folder', name: 'Tools', children: [node('Regex', 'https://regex101.com/')] }] }, node('Script', 'javascript:alert(1)')] },
    other: { type: 'folder', children: [node('Weekly', 'https://localization.example/weekly')] },
    synced: { type: 'folder', children: [] },
  } }));
  fs.writeFileSync(path.join(prof, 'Preferences'), JSON.stringify({ default_search_provider_data: { template_url_data: { keyword: 'duckduckgo.com', short_name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={searchTerms}' } }, homepage: 'https://start.example/', homepage_is_newtabpage: false }));
  const db = new DatabaseSync(path.join(prof, 'History'));
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)');
  const ins = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, 0, ?, ?)');
  ins.run('https://kbbi.kemdikbud.go.id/entri/tautan', 'KBBI: tautan', 5, chromeTime('2026-11-20T08:00:00Z'), 0);
  ins.run('https://developer.mozilla.org/', 'MDN', 2, chromeTime('2026-11-19T08:00:00Z'), 0);
  ins.run('https://hidden.example/', 'Hidden', 1, chromeTime('2026-11-18T08:00:00Z'), 1);
  ins.run('chrome://settings/', 'Settings', 1, chromeTime('2026-11-18T08:00:00Z'), 0);
  db.close();
}

function fakeFirefox(dir) {
  fs.writeFileSync(path.join(dir, 'profiles.ini'), '[Install4F96D1932A9F858E]\nDefault=Profiles/abc.default-release\nLocked=1\n\n[Profile1]\nName=old\nIsRelative=1\nPath=Profiles/old.default\nDefault=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n');
  mk(dir, 'Profiles', 'old.default'); // no places.sqlite: skipped
  const prof = mk(dir, 'Profiles', 'abc.default-release');
  const db = new DatabaseSync(path.join(prof, 'places.sqlite'));
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER);`);
  const us = Date.parse('2026-11-10T09:00:00Z') * 1000;
  db.exec(`INSERT INTO moz_places VALUES (1, 'https://www.deepl.com/', 'DeepL', 7, ${us}, 0), (2, 'https://sub.example/', 'Sub', 1, ${us - 1000}, 0), (3, 'place:sort=8', 'Recent', 0, NULL, 0), (4, 'https://tagged.example/', 'Tagged', 1, NULL, 0);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________', ${us}), (2, 2, NULL, 1, 0, 'menu', 'menu________', ${us}), (3, 2, NULL, 1, 1, 'toolbar', 'toolbar_____', ${us}),
      (4, 2, NULL, 1, 2, 'tags', 'tags________', ${us}), (5, 2, NULL, 1, 3, 'unfiled', 'unfiled_____', ${us}),
      (10, 1, 1, 3, 0, 'DeepL', 'aaaaaaaaaaaa', ${us}), (11, 2, NULL, 3, 1, 'Clients', 'bbbbbbbbbbbb', ${us}), (12, 1, 2, 11, 0, 'Sub', 'cccccccccccc', ${us}),
      (13, 1, 3, 2, 0, 'Recent', 'dddddddddddd', ${us}), (14, 2, NULL, 4, 0, 'work', 'eeeeeeeeeeee', ${us}), (15, 1, 4, 14, 0, NULL, 'ffffffffffff', ${us});`);
  db.close();
  fs.writeFileSync(path.join(prof, 'prefs.js'), '// Mozilla User Preferences\nuser_pref("browser.startup.homepage", "https://home.example/|https://second.example/");\n');
  fs.writeFileSync(path.join(prof, 'search.json.mozlz4'), mozLz4(JSON.stringify({ version: 9, engines: [], metaData: { defaultEngineId: 'ddg' } })));
}

test('detects Chrome and Firefox on Linux and reads bookmarks, history and settings', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-imp-'));
  fakeChrome(mk(home, '.config', 'google-chrome'));
  fakeFirefox(mk(home, '.mozilla', 'firefox'));
  const found = detectBrowsers({ platform: 'linux', home, env: {} });
  assert.deepEqual(found.map(b => b.id), ['chrome', 'firefox']);
  assert.equal(found[0].profiles[0].name, 'Work');
  assert.deepEqual(found[1].profiles.map(p => p.name), ['default-release']);

  const c = readProfile(found[0], found[0].profiles[0]);
  assert.deepEqual(c.bookmarks.map(b => [b.title, b.folder]), [['KBBI', null], ['MDN', 'Dev'], ['Regex', 'Dev / Tools'], ['Weekly', 'Other bookmarks']]);
  assert.equal(c.bookmarks[0].createdAt, '2025-03-01T10:00:00.000Z');
  assert.deepEqual(c.history.map(h => h.url), ['https://kbbi.kemdikbud.go.id/entri/tautan', 'https://developer.mozilla.org/']);
  assert.equal(c.history[0].visitedAt, '2026-11-20T08:00:00.000Z');
  assert.equal(c.history[0].visits, 5);
  assert.deepEqual(c.settings, { searchEngine: 'duckduckgo', homepage: 'https://start.example/' });

  const f = readProfile(found[1], found[1].profiles[0]);
  assert.deepEqual(f.bookmarks.map(b => [b.title, b.folder]), [['DeepL', null], ['Sub', 'Clients']]);
  assert.deepEqual(f.history.map(h => h.url), ['https://www.deepl.com/', 'https://sub.example/']);
  assert.equal(f.history[0].visitedAt, '2026-11-10T09:00:00.000Z');
  assert.deepEqual(f.settings, { homepage: 'https://home.example/', searchEngine: 'duckduckgo' });
});

test('unreadable databases: Chrome still gives bookmarks, Firefox explains the problem', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-imp-'));
  const chrome = mk(home, '.config', 'google-chrome');
  fakeChrome(chrome);
  fs.writeFileSync(path.join(chrome, 'Default', 'History'), 'not a database');
  const ff = mk(home, '.mozilla', 'firefox');
  fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Profile0]\nName=x\nIsRelative=1\nPath=p\n');
  fs.writeFileSync(path.join(mk(ff, 'p'), 'places.sqlite'), '');
  const [c, f] = detectBrowsers({ platform: 'linux', home, env: {} });
  const r = readProfile(c, c.profiles[0]);
  assert.equal(r.bookmarks.length, 4);
  assert.deepEqual(r.history, []);
  assert.throws(() => readProfile(f, f.profiles[0]), /places\.sqlite\) could not be read/);
});

test('detects Edge on Windows from LOCALAPPDATA', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-imp-'));
  const local = mk(root, 'Local');
  fakeChrome(mk(local, 'Microsoft', 'Edge', 'User Data'));
  const found = detectBrowsers({ platform: 'win32', home: root, env: { LOCALAPPDATA: local, APPDATA: mk(root, 'Roaming') } });
  assert.deepEqual(found.map(b => b.name), ['Microsoft Edge']);
  assert.equal(readProfile(found[0], found[0].profiles[0]).bookmarks.length, 4);
});

test('parses a bookmarks HTML export', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://kbbi.kemdikbud.go.id/" ADD_DATE="1735689600">KBBI &amp; EYD</A>
    <DT><H3>Klien</H3>
    <DL><p><DT><A HREF="https://client.example/a?x=1&amp;y=2">Client &lt;A&gt;</A></DL><p>
  </DL><p>
  <DT><H3>Other bookmarks</H3>
  <DL><p><DT><A HREF="https://other.example/">Other</A><DT><A HREF="javascript:void(0)">JS</A></DL><p>
</DL><p>`;
  const b = parseBookmarksHtml(html);
  assert.deepEqual(b.map(x => [x.title, x.url, x.folder]), [
    ['KBBI & EYD', 'https://kbbi.kemdikbud.go.id/', null],
    ['Client <A>', 'https://client.example/a?x=1&y=2', 'Klien'],
    ['Other', 'https://other.example/', 'Other bookmarks'],
  ]);
  assert.equal(b[0].createdAt, '2025-01-01T00:00:00.000Z');
});

test('decodes mozLz4 with back-references and rejects corrupt data', () => {
  const head = Buffer.alloc(12); head.write('mozLz40\0', 0, 'latin1'); head.writeUInt32LE(12, 8);
  // literal "abc", then copy 9 bytes from 3 back: "abcabcabcabc"
  assert.equal(decodeMozLz4(Buffer.concat([head, Buffer.from([0x35, 0x61, 0x62, 0x63, 0x03, 0x00])])).toString(), 'abcabcabcabc');
  assert.throws(() => decodeMozLz4(Buffer.concat([head, Buffer.from([0x35, 0x61, 0x62, 0x63, 0x09, 0x00])])), /Corrupt/);
  assert.throws(() => decodeMozLz4(Buffer.from('not lz4 at all')), /mozLz4/);
});

test('merging an import skips known bookmarks and keeps the newest visit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintas-imp-'));
  const data = new BrowserData(new JsonStore(dir), dir);
  data.toggleBookmark({ url: 'https://kbbi.kemdikbud.go.id/', title: 'KBBI' });
  data.addHistory('https://a.example/', 'A');
  const added = data.importBookmarks([{ url: 'https://kbbi.kemdikbud.go.id/', title: 'dup' }, { url: 'https://new.example/', title: 'New', folder: 'Dev' }, { url: 'https://new.example/', title: 'again' }]);
  assert.equal(added, 1);
  assert.deepEqual(data.bookmarks().map(b => [b.title, b.folder]), [['KBBI', null], ['New', 'Dev']]);
  const h = data.importHistory([{ url: 'https://a.example/', title: 'Old A', visitedAt: '2001-01-01T00:00:00.000Z', visits: 9 }, { url: 'https://b.example/', title: 'B', visitedAt: '2026-01-01T00:00:00.000Z', visits: 2 }]);
  assert.equal(h, 1);
  const a = data.history({}).find(x => x.url === 'https://a.example/');
  assert.equal(a.title, 'A');
  assert.equal(a.visits, 9);
});
