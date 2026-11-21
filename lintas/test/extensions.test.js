// Chrome-compatible pieces of Lintas's extension support: tab groups, getContexts filters,
// keyboard shortcuts and native messaging (as used by Claude in Chrome and Claude Desktop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { filterContexts, nextGroupColor, shortcutFor, shortcutMatches, matchesTitle, matchesPattern, parseSetCookie, normalizeSite, narrowPattern, restrictManifest } from '../app/main/ext-util.js';
import { encodeMessage, createFrameReader, hostManifestPaths, registryKeys, validHostManifest, MAX_FROM_HOST } from '../app/main/native-host.js';

test('new tab groups get Chrome colours in order, least used first', () => {
  assert.equal(nextGroupColor([]), 'grey');
  assert.equal(nextGroupColor(['grey']), 'blue');
  assert.equal(nextGroupColor(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']), 'grey');
  assert.equal(nextGroupColor(['grey', 'grey', 'blue']), 'red');
});

test('getContexts filters by every given field', () => {
  const list = [
    { contextType: 'SIDE_PANEL', contextId: 'a', tabId: 5, windowId: 1, documentId: 'D1', frameId: 0, documentUrl: 'chrome-extension://x/sidepanel.html?tabId=5', documentOrigin: 'chrome-extension://x', incognito: false },
    { contextType: 'BACKGROUND', contextId: 'b', tabId: -1, windowId: -1, frameId: -1, documentUrl: 'chrome-extension://x/sw.js', documentOrigin: 'chrome-extension://x', incognito: false },
  ];
  assert.equal(filterContexts(list).length, 2);
  assert.deepEqual(filterContexts(list, { contextTypes: ['SIDE_PANEL'] }).map(c => c.contextId), ['a']);
  assert.deepEqual(filterContexts(list, { documentUrls: ['chrome-extension://x/sidepanel.html?tabId=5'] }).map(c => c.contextId), ['a']);
  assert.equal(filterContexts(list, { tabIds: [6] }).length, 0);
  assert.equal(filterContexts(list, { incognito: true }).length, 0);
});

test('manifest shortcuts: per platform, Ctrl means Command on a Mac, modifiers must match exactly', () => {
  assert.equal(shortcutFor({ default: 'Ctrl+E', mac: 'Command+E' }, 'win32'), 'Ctrl+E');
  assert.equal(shortcutFor({ default: 'Ctrl+E', mac: 'Command+E' }, 'darwin'), 'Command+E');
  assert.equal(shortcutFor('Alt+Shift+Y', 'linux'), 'Alt+Shift+Y');
  assert.equal(shortcutFor(undefined), null);
  const key = (k, mods = {}) => ({ type: 'keyDown', key: k.toLowerCase(), code: 'Key' + k, control: false, meta: false, alt: false, shift: false, ...mods });
  assert.ok(shortcutMatches('Ctrl+E', key('E', { control: true }), 'win32'));
  assert.ok(!shortcutMatches('Ctrl+E', key('E', { control: true, shift: true }), 'win32'));
  assert.ok(shortcutMatches('Ctrl+E', key('E', { meta: true }), 'darwin'));
  assert.ok(shortcutMatches('MacCtrl+E', key('E', { control: true }), 'darwin'));
  assert.ok(shortcutMatches('Alt+Shift+Y', key('Y', { alt: true, shift: true }), 'linux'));
  assert.ok(shortcutMatches('Ctrl+Shift+Up', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', control: true, shift: true }, 'linux'));
  assert.ok(!shortcutMatches('Ctrl+Foo+E', key('E', { control: true }), 'linux'));
});

test('title and URL patterns', () => {
  assert.ok(matchesTitle('Claude*', 'Claude (MCP)'));
  assert.ok(!matchesTitle('Claude', 'Claude (MCP)'));
  assert.ok(matchesPattern('https://*.claude.ai/*', 'https://www.claude.ai/new'));
  assert.ok(!matchesPattern('https://claude.ai/*', 'https://evil.example/claude.ai/'));
});

test('native messages: 32-bit length + UTF-8 JSON, byte length counts non-ASCII text', () => {
  const buf = encodeMessage({ text: 'Terjemahan “bagus” ✓' });
  const len = buf.readUInt32LE(0);
  assert.equal(len, buf.length - 4);
  assert.equal(len, Buffer.byteLength(JSON.stringify({ text: 'Terjemahan “bagus” ✓' })));
});

test('native messages are read back even when split or joined', () => {
  const got = [], errors = [];
  const read = createFrameReader(m => got.push(m), e => errors.push(e.message));
  const a = encodeMessage({ n: 1, big: 'x'.repeat(200000) }), b = encodeMessage({ n: 2, s: 'é' });
  const both = Buffer.concat([a, b]);
  // byte by byte across the first header, then in uneven pieces
  for (let i = 0; i < 6; i++) read(both.subarray(i, i + 1));
  read(both.subarray(6, 70000)); read(both.subarray(70000));
  assert.deepEqual(got.map(m => m.n), [1, 2]);
  assert.equal(got[0].big.length, 200000);
  assert.equal(got[1].s, 'é');
  // several messages in one piece
  read(Buffer.concat([encodeMessage({ n: 3 }), encodeMessage({ n: 4 })]));
  assert.deepEqual(got.map(m => m.n), [1, 2, 3, 4]);
  assert.deepEqual(errors, []);
});

test('a message over 1 MB from the host is refused', () => {
  const errors = [];
  const read = createFrameReader(() => assert.fail('should not deliver'), e => errors.push(e.message));
  const head = Buffer.alloc(4); head.writeUInt32LE(MAX_FROM_HOST + 1, 0);
  read(head);
  assert.equal(errors.length, 1);
});

test('native host registrations are looked up where Chrome, Edge, Chromium and Brave keep them', () => {
  const mac = hostManifestPaths('com.anthropic.claude_browser_extension', { platform: 'darwin', home: '/Users/u', userData: '/Users/u/Lintas' });
  assert.equal(mac[0], path.join('/Users/u/Lintas', 'NativeMessagingHosts', 'com.anthropic.claude_browser_extension.json'));
  assert.ok(mac.includes(path.join('/Users/u', 'Library', 'Application Support', 'Google/Chrome', 'NativeMessagingHosts', 'com.anthropic.claude_browser_extension.json')));
  assert.ok(mac.some(p => p.includes('Microsoft Edge')));
  const linux = hostManifestPaths('h', { platform: 'linux', home: '/home/u' });
  assert.ok(linux.includes(path.join('/home/u', '.config', 'google-chrome', 'NativeMessagingHosts', 'h.json')));
  assert.ok(linux.includes(path.join('/etc/opt/chrome', 'native-messaging-hosts', 'h.json')));
  const keys = registryKeys('com.anthropic.claude_browser_extension');
  assert.equal(keys[0], 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.anthropic.claude_browser_extension');
  assert.ok(keys.includes('HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.anthropic.claude_browser_extension'));
  assert.ok(keys.some(k => k.startsWith('HKLM\\Software\\WOW6432Node\\')));
});

test('a host must name itself, use stdio and allow the extension', () => {
  const origin = 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/';
  const m = { name: 'com.anthropic.claude_browser_extension', description: 'Claude', path: 'C:\\x\\host.exe', type: 'stdio', allowed_origins: [origin] };
  assert.ok(validHostManifest(m, m.name, origin));
  assert.ok(!validHostManifest({ ...m, allowed_origins: [] }, m.name, origin));
  assert.ok(!validHostManifest({ ...m, name: 'other' }, m.name, origin));
  assert.ok(!validHostManifest({ ...m, type: 'pipe' }, m.name, origin));
});

test('Set-Cookie lines become cookie details, deletions and refusals', () => {
  const now = Date.UTC(2026, 0, 1);
  const url = 'https://claude.ai/api/x';
  assert.deepEqual(parseSetCookie('sessionKey=abc=def; Domain=.claude.ai; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600', url, now),
    { url, name: 'sessionKey', value: 'abc=def', sameSite: 'lax', domain: '.claude.ai', path: '/', secure: true, httpOnly: true, expirationDate: now / 1000 + 3600 });
  assert.deepEqual(parseSetCookie('a=1', url, now), { url, name: 'a', value: '1', sameSite: 'unspecified' });
  assert.deepEqual(parseSetCookie('a=; Max-Age=0', url, now), { remove: true, name: 'a' });
  assert.deepEqual(parseSetCookie('a=1; Expires=Wed, 01 Jan 2020 00:00:00 GMT', url, now), { remove: true, name: 'a' });
  assert.equal(parseSetCookie('a=1; SameSite=None', url, now), null);
  assert.equal(parseSetCookie('novalue', url, now), null);
});

test('normalizeSite: hosts from what people type', () => {
  assert.equal(normalizeSite('https://Claude.ai/new?x=1'), 'claude.ai');
  assert.equal(normalizeSite('example.com:8080'), 'example.com');
  assert.equal(normalizeSite('*.example.com'), '*.example.com');
  assert.equal(normalizeSite(''), null);
  assert.equal(normalizeSite('not a site'), null);
  assert.equal(normalizeSite('ex_ample.com'), null);
});

test('narrowPattern: a pattern limited to one site', () => {
  assert.equal(narrowPattern('<all_urls>', 'claude.ai'), '*://claude.ai/*');
  assert.equal(narrowPattern('https://*/*', 'claude.ai'), 'https://claude.ai/*');
  assert.equal(narrowPattern('https://*.claude.ai/*', 'claude.ai'), 'https://claude.ai/*');
  assert.equal(narrowPattern('https://*.claude.ai/*', 'docs.claude.ai'), 'https://docs.claude.ai/*');
  assert.equal(narrowPattern('https://claude.ai/cic/*', 'claude.ai'), 'https://claude.ai/cic/*');
  assert.equal(narrowPattern('https://claude.ai/*', 'example.com'), null);
  assert.equal(narrowPattern('https://mail.example.com/*', '*.example.com'), 'https://mail.example.com/*');
  assert.equal(narrowPattern('https://mail.example.com/*', 'example.com'), null);
  assert.equal(narrowPattern('file:///*', 'example.com'), null);
});

test('restrictManifest: host permissions and content scripts only on the chosen sites', () => {
  const m3 = { manifest_version: 3, permissions: ['tabs', 'storage'], host_permissions: ['<all_urls>'],
    content_scripts: [{ js: ['a.js'], matches: ['https://claude.ai/*'] }, { js: ['b.js'], matches: ['<all_urls>'], all_frames: true }] };
  const r = restrictManifest(m3, ['example.com']);
  assert.deepEqual(r.permissions, ['tabs', 'storage']);
  assert.deepEqual(r.host_permissions, ['*://example.com/*']);
  assert.deepEqual(r.content_scripts, [{ js: ['b.js'], matches: ['*://example.com/*'], all_frames: true }]);
  assert.deepEqual(m3.host_permissions, ['<all_urls>'], 'the original is untouched');
  const m2 = { manifest_version: 2, permissions: ['storage', 'https://*/*', 'http://*/*'] };
  assert.deepEqual(restrictManifest(m2, ['claude.ai']).permissions, ['storage', 'https://claude.ai/*', 'http://claude.ai/*']);
  assert.deepEqual(restrictManifest(m3, []).host_permissions, []);
});
