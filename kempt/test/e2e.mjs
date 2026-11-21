// End-to-end test: builds Kempt, runs it against a made-up home folder full
// of caches, large files, duplicates and autostart entries, and drives the
// window in Chromium. Usage: node test/e2e.mjs [screenshot-dir]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] || '';
if (shots) mkdirSync(shots, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'kempt-e2e-'));
const home = join(work, 'home');
const bin = join(work, 'kempt');
execFileSync('go', ['build', '-o', bin, '.'], { cwd: root, stdio: 'inherit' });

const old = new Date(Date.now() - 60 * 864e5);
function put(p, size, age = old, fillByte = 0) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(size, fillByte));
  utimesSync(p, age, age);
}
const MB = 1 << 20;
put(join(home, '.cache/google-chrome/Default/Cache/f_000001'), 30 * MB);
put(join(home, '.cache/google-chrome/Default/Cache/f_000002'), 12 * MB);
put(join(home, '.cache/google-chrome/Profile 1/Code Cache/js/a'), 5 * MB);
put(join(home, '.config/google-chrome/Default/Cookies'), 2 * MB);
put(join(home, '.cache/thumbnails/large/a.png'), 3 * MB);
put(join(home, '.cache/mozilla/firefox/x.default/cache2/entries/1'), 8 * MB);
put(join(home, '.local/share/Trash/files/old.txt'), 1 * MB);
put(join(home, 'Videos/holiday.mkv'), 140 * MB, old, 1);
put(join(home, 'Downloads/installer.iso'), 220 * MB, old, 2);
put(join(home, 'Pictures/beach.jpg'), 3 * MB, new Date(Date.now() - 400 * 864e5), 3);
put(join(home, 'Downloads/beach (1).jpg'), 3 * MB, new Date(), 3);
put(join(home, 'Documents/notes.txt'), 1000, old, 4);
mkdirSync(join(home, 'sys-autostart'), { recursive: true });
writeFileSync(join(home, 'sys-autostart/updater.desktop'), '[Desktop Entry]\nName=Update Notifier\nExec=/usr/bin/update-notifier\n');
mkdirSync(join(home, '.config/autostart'), { recursive: true });
writeFileSync(join(home, '.config/autostart/chat.desktop'), '[Desktop Entry]\nName=Chat\nExec=/opt/chat/chat --tray\n');

const env = { ...process.env, HOME: home, XDG_CACHE_HOME: '', XDG_CONFIG_HOME: '', XDG_DATA_HOME: '', XDG_CONFIG_DIRS: join(home, 'sys') };
mkdirSync(join(home, 'sys'), { recursive: true });
execFileSync('mv', [join(home, 'sys-autostart'), join(home, 'sys/autostart')]);
delete env.XDG_CACHE_HOME; delete env.XDG_CONFIG_HOME; delete env.XDG_DATA_HOME;

const proc = spawn(bin, ['desktop', '--no-browser', '--data', join(work, 'data'), '--port', '0'], { env });
const url = await new Promise((res, rej) => {
  let out = '';
  proc.stdout.on('data', d => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/#t=\S+/); if (m) res(m[0]); });
  proc.on('exit', c => rej(new Error('kempt exited ' + c)));
  setTimeout(() => rej(new Error('no address')), 15000);
});

const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const shot = async name => { if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: true }); };

try {
  await page.goto(url);
  // Overview: the measured amount = Chrome 47 MB + Firefox 8 MB + thumbnails 3 MB (bin excluded).
  await page.getByText('of caches and leftovers can go').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('.ribbon-head .big').textContent(), '58 MB');
  await page.getByText('2 programs start when you sign in').waitFor();
  await page.getByText('1 MB in the trash').waitFor();
  await shot('1-overview');

  // Clean up page lists categories with details.
  await page.click('a[href="#/clean"]');
  await page.getByRole('heading', { name: 'Clean up' }).waitFor();
  await page.getByText('Google Chrome cache').waitFor();
  await page.getByRole('button', { name: 'Details for Google Chrome cache' }).click();
  await page.getByText('History, passwords, cookies').first().waitFor();
  await shot('2-clean');

  // Tidy up from the overview.
  await page.click('a[href="#/overview"]');
  await page.getByRole('button', { name: 'Tidy up' }).click();
  await page.getByRole('heading', { name: 'Freed 58 MB' }).waitFor({ timeout: 20000 });
  assert.ok(!existsSync(join(home, '.cache/google-chrome/Default/Cache/f_000001')), 'cache file removed');
  assert.ok(existsSync(join(home, '.config/google-chrome/Default/Cookies')), 'cookies kept');
  assert.ok(existsSync(join(home, '.local/share/Trash/files/old.txt')), 'trash not emptied by tidy up');
  await shot('3-after-tidy');

  // Large files: find and move one to the trash.
  await page.click('a[href="#/large"]');
  await page.getByRole('button', { name: 'Find large files' }).click();
  await page.locator('td.path', { hasText: 'installer.iso' }).waitFor({ timeout: 20000 });
  assert.equal(await page.locator('td.path', { hasText: 'Cache' }).count(), 0, 'caches are not listed as your files');
  await page.getByRole('checkbox', { name: /installer\.iso/ }).check();
  await shot('4-large');
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByText(/Moved 1 file/).waitFor();
  assert.ok(!existsSync(join(home, 'Downloads/installer.iso')));
  assert.ok(existsSync(join(home, '.local/share/Trash/files/installer.iso')), 'restorable from the trash');

  // Duplicates: the newer copy is preselected, the oldest kept.
  await page.click('a[href="#/dupes"]');
  await page.getByRole('button', { name: 'Find duplicates' }).click();
  await page.getByText('2 copies of 3 MB').waitFor({ timeout: 20000 });
  assert.equal(await page.getByRole('checkbox', { name: /Pictures\/beach\.jpg/ }).isChecked(), false);
  assert.equal(await page.getByRole('checkbox', { name: /beach \(1\)\.jpg/ }).isChecked(), true);
  await page.getByRole('checkbox', { name: /Pictures\/beach\.jpg/ }).check();
  await page.getByRole('button', { name: /Move selected copies/ }).click();
  await page.getByText(/Keep at least one copy/).waitFor();
  assert.ok(existsSync(join(home, 'Pictures/beach.jpg')), 'refused to remove every copy');
  await page.getByRole('checkbox', { name: /Pictures\/beach\.jpg/ }).uncheck();
  await shot('5-dupes');

  // Startup: turn Chat off, then undo it from History.
  await page.click('a[href="#/startup"]');
  await page.getByRole('checkbox', { name: 'Turn off Chat' }).click();
  await page.getByText('Chat will no longer start when you sign in.').waitFor();
  assert.match(readFileSync(join(home, '.config/autostart/chat.desktop'), 'utf8'), /Hidden=true/);
  await shot('6-startup');
  await page.click('a[href="#/history"]');
  await page.getByText('Turned off Chat at startup').waitFor();
  await page.getByText('Freed 58 MB (5 files)').waitFor();
  await page.getByText('Moved 1 file (220 MB) to the trash', { exact: true }).waitFor();
  await shot('7-history');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByText('Undid: Turned off Chat at startup').waitFor();
  assert.match(readFileSync(join(home, '.config/autostart/chat.desktop'), 'utf8'), /Hidden=false/);

  // Settings: start when you sign in writes one autostart file; off removes it.
  await page.click('a[href="#/settings"]');
  assert.equal(await page.getByRole('checkbox', { name: 'Minimize to desktop and stick to taskbar' }).isDisabled(), true, 'minimize needs Windows');
  await page.getByRole('checkbox', { name: 'Start when you sign in' }).click();
  await page.getByText('Kempt will start when you sign in.').waitFor();
  assert.match(readFileSync(join(home, '.config/autostart/kempt.desktop'), 'utf8'), /Exec=".*" desktop --startup --data "/);
  await shot('7b-settings');
  await page.click('a[href="#/startup"]');
  await page.getByRole('heading', { name: 'Kempt', exact: true }).waitFor();
  await page.click('a[href="#/settings"]');
  await page.getByRole('checkbox', { name: 'Start when you sign in' }).click();
  await page.getByText('Kempt will no longer start when you sign in.').waitFor();
  assert.ok(!existsSync(join(home, '.config/autostart/kempt.desktop')), 'autostart file removed');

  // Health, automatic care (no Task Scheduler here), honest notes.
  await page.click('a[href="#/health"]');
  await page.getByText(/Free space on/).first().waitFor({ timeout: 20000 });
  await shot('8-health');
  await page.click('a[href="#/care"]');
  await page.getByText('0 11 * * 0 kempt care').waitFor();
  await page.click('a[href="#/why"]');
  await page.getByText('Clean the registry').waitFor();
  await shot('9-why');

  // Dark mode and a phone-sized window still work.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('a[href="#/overview"]');
  await page.getByText(/can go|Nothing to tidy/).first().waitFor({ timeout: 20000 });
  await shot('10-phone-dark');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'no sideways scrolling on a narrow window');

  // Indonesian: switch in the window; pages, sizes and earlier history follow.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.locator('.side-foot').getByRole('button', { name: 'Bahasa Indonesia' }).click();
  await page.waitForLoadState('load');
  await page.getByRole('heading', { name: 'PC Anda, apa adanya' }).waitFor({ timeout: 20000 });
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'id');
  await page.getByRole('link', { name: /Gambaran umum/ }).waitFor();
  await page.getByText(/program berjalan saat Anda masuk/).waitFor({ timeout: 20000 });
  const idShots = [
    ['overview', 'PC Anda, apa adanya'], ['clean', 'Bersihkan'], ['large', 'File besar'], ['dupes', 'Duplikat'],
    ['startup', 'Pengaktifan'], ['health', 'Kesehatan'], ['care', 'Perawatan otomatis'],
    ['history', 'Riwayat'], ['settings', 'Pengaturan'], ['why', 'Yang tidak dilakukan Kempt'],
  ];
  for (const [id, title] of idShots) {
    await page.click(`a[href="#/${id}"]`);
    await page.getByRole('heading', { level: 1, name: title }).waitFor();
    if (id === 'clean') await page.getByText('Cache Google Chrome').waitFor({ timeout: 20000 });
    if (id === 'health') await page.getByText(/Ruang kosong di/).first().waitFor({ timeout: 20000 });
    if (id === 'history') {
      await page.getByText('58 MB dikosongkan (5 file)', { exact: true }).waitFor();
      await page.getByText('1 file (220 MB) dipindahkan ke tempat sampah', { exact: true }).waitFor();
      await page.getByText('Dibatalkan: Chat dinonaktifkan di Pengaktifan', { exact: true }).waitFor();
      await page.getByText('Cache Firefox: 8 MB, 1 file', { exact: true }).waitFor();
    }
    if (id === 'care') await page.getByText(/crontab Anda/).waitFor();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(wide, false, `no sideways scrolling on ${id} in Indonesian`);
    const raw = await page.evaluate(() => document.body.innerText.match(/\{\{\w*\}\}|\b(?:[a-z]+\.){1,3}[a-z]+[A-Z]\w*\b/));
    assert.equal(raw, null, `no placeholder or untranslated key on ${id}: ${raw}`);
    await shot('id-' + id);
  }
  // A search in Indonesian, with sizes in Indonesian number format.
  await page.click('a[href="#/large"]');
  await page.getByRole('button', { name: 'Cari file besar' }).click();
  await page.getByText(/file ditampilkan, dimulai dari yang terbesar/).waitFor({ timeout: 20000 });
  await shot('id-large-results');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('a[href="#/overview"]');
  await page.getByRole('heading', { name: 'PC Anda, apa adanya' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'phone width in Indonesian');
  await shot('id-phone');

  assert.deepEqual(errors, [], 'no errors in the page');
  console.log('e2e passed');
} finally {
  await browser.close();
  proc.kill();
}
