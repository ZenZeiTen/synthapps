import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInput, isTracker, siteOf, isThirdParty, urlsFromArgs } from '../app/main/security.js';

test('omnibox input: HTTPS first, search otherwise, dangerous schemes never navigate', () => {
  assert.equal(resolveInput('kbbi.kemdikbud.go.id'), 'https://kbbi.kemdikbud.go.id');
  assert.equal(resolveInput('localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(resolveInput('http://example.com'), 'http://example.com');
  assert.equal(resolveInput('terjemahan hukum'), 'https://duckduckgo.com/?q=terjemahan%20hukum');
  assert.equal(resolveInput('javascript:alert(1)', 'google'), 'https://www.google.com/search?q=javascript%3Aalert(1)');
  assert.equal(resolveInput('lintas://tms'), 'lintas://tms');
});

test('tracker matching and site boundaries', () => {
  assert.ok(isTracker('https://www.google-analytics.com/analytics.js'));
  assert.ok(isTracker('https://connect.facebook.net/en_US/fbevents.js'));
  assert.ok(isTracker('https://www.facebook.com/tr?id=1'));
  assert.ok(!isTracker('https://www.facebook.com/profile'));
  assert.ok(!isTracker('https://kbbi.kemdikbud.go.id/'));
  assert.equal(siteOf('news.detik.com'), 'detik.com');
  assert.equal(siteOf('kbbi.kemdikbud.go.id'), 'kemdikbud.go.id');
  assert.ok(isThirdParty('https://cdn.example.net/x.js', 'https://example.com/'));
  assert.ok(!isThirdParty('https://static.detik.com/x.js', 'https://news.detik.com/'));
});

test('urlsFromArgs: URLs and files Windows, macOS or Linux pass on the command line', () => {
  const exists = (p) => p.endsWith('page.html') || p.endsWith('saved.mhtml');
  const cwd = process.platform === 'win32' ? 'C:\\Users\\me' : '/home/me';
  // Installer form: Lintas.exe -- "%1"; everything after -- is data, even if it looks like a switch
  assert.deepEqual(urlsFromArgs(['Lintas.exe', '--', 'https://example.com/a b'], { cwd, exists }), ['https://example.com/a%20b']);
  assert.deepEqual(urlsFromArgs(['Lintas.exe', '--', '--gpu-launcher=calc.exe'], { cwd, exists }), []);
  // Switches are skipped without --; other schemes are refused
  assert.deepEqual(urlsFromArgs(['Lintas.exe', '--no-sandbox', 'http://x.test/', 'javascript:alert(1)', 'ftp://x'], { cwd, exists }), ['http://x.test/']);
  // Local pages open as file URLs only when they exist and have a page-like extension
  const files = urlsFromArgs(['lintas', 'page.html', 'missing.html', 'saved.mhtml', 'tool.exe'], { cwd, exists });
  assert.equal(files.length, 2);
  assert.ok(files.every(u => u.startsWith('file://')), files.join(' '));
  // Development: electron . <url>
  assert.deepEqual(urlsFromArgs(['electron', '.', 'https://a.test/'], { skip: 1, exists }), ['https://a.test/']);
});
