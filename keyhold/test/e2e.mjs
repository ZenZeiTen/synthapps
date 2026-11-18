// End-to-end test: the real keyhold binary in desktop mode plus a sync server,
// driven in headless Chromium. Usage: node test/e2e.mjs [screenshot-dir]
// Needs Go (to build) and Playwright with Chromium.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIP: playwright not installed'); process.exit(0); }

const here = dirname(fileURLToPath(import.meta.url));
const proj = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'keyhold-e2e-'));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const bin = join(tmp, process.platform === 'win32' ? 'keyhold.exe' : 'keyhold');
execFileSync('go', ['build', '-o', bin, '.'], { cwd: proj, stdio: 'inherit' });

const procs = [];
function start(args, match) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(p);
    let out = '';
    const on = (d) => { out += d; const m = out.match(match); if (m) resolve(m); };
    p.stdout.on('data', on); p.stderr.on('data', on);
    p.on('exit', (c) => reject(new Error('exited ' + c + ': ' + out)));
    setTimeout(() => reject(new Error('timeout: ' + out)), 20000);
  });
}
const cleanup = () => procs.forEach((p) => p.kill());
process.on('exit', cleanup);

const MASTER = 'Tidal-Orchid-Ferry-Quartz-83';
const step = (s) => console.log('  ✓ ' + s);
const errors = [];

const [, deskURL] = await start(['desktop', '--no-browser', '--data', join(tmp, 'desk'), '--port', '47911'], /(http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+)/);
await start(['serve', '--addr', '127.0.0.1:47912', '--data', join(tmp, 'srv'), '--open-signup'], /sync server on/);
const SERVER = 'http://127.0.0.1:47912';

// Any plain web host (here a tiny static server): no /api/mode, so the app runs in device mode.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const statik = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  const file = join(proj, 'web', path);
  if (!file.startsWith(join(proj, 'web')) || !existsSync(file) || path.endsWith('/')) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => statik.listen(47913, '127.0.0.1', r));
const STATIC = 'http://127.0.0.1:47913';
process.on('exit', () => statik.close());

/** Create a vault on the start screen and get past the recovery code. */
async function createVault(p, { expectWhere }) {
  await p.getByRole('heading', { name: 'Create your vault' }).waitFor();
  if (expectWhere) await p.getByText(expectWhere).waitFor();
  await p.getByLabel('Master password', { exact: true }).fill(MASTER);
  await p.getByLabel('Type it again', { exact: true }).fill(MASTER);
  await p.getByRole('button', { name: 'Create vault' }).click();
  await p.getByRole('heading', { name: 'Save your recovery code' }).waitFor({ timeout: 30000 });
  await p.getByLabel('I have stored this code safely', { exact: true }).check();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByText('Your vault is empty.').waitFor();
}
async function addNote(p, title) {
  await p.getByRole('button', { name: 'New item', exact: true }).click();
  await p.locator('dialog').getByRole('button', { name: 'Secure note', exact: true }).click();
  await p.getByLabel('Name', { exact: true }).fill(title);
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.getByRole('heading', { name: title }).waitFor();
}

const browser = await chromium.launch();
// East of UTC on purpose: dates must not slip a day there.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Jakarta' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: deskURL.split('/#')[0] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, name + '.png') }); };

try {
  // ---- create the vault
  await page.goto(deskURL);
  await page.getByRole('heading', { name: 'Create your vault' }).waitFor();
  assert.equal(new URL(page.url()).hash, '', 'token removed from the address bar');
  await shot(page, '01-create');
  await page.getByLabel('Master password', { exact: true }).fill('short');
  await page.getByLabel('Type it again', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByText('Use at least 10 characters').waitFor();
  await page.getByLabel('Master password', { exact: true }).fill(MASTER);
  await page.getByLabel('Type it again', { exact: true }).fill(MASTER);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByRole('heading', { name: 'Save your recovery code' }).waitFor({ timeout: 30000 });
  const code = await page.locator('.code-box').textContent();
  assert.match(code, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  await shot(page, '02-recovery');
  assert.ok(await page.getByRole('button', { name: 'Continue' }).isDisabled());
  await page.getByLabel('I have stored this code safely', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Your vault is empty.').waitFor();
  step('vault created with a recovery code');

  // ---- add a login with a generated password and a TOTP secret
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Example Mail');
  await page.getByLabel('Username', { exact: true }).fill('amy@example.com');
  await page.getByRole('button', { name: 'Generate' }).first().click();
  await page.getByRole('button', { name: 'Use this' }).click();
  const pw = await page.getByLabel('Password', { exact: true }).inputValue();
  assert.equal(pw.length, 20);
  await page.getByLabel('Website', { exact: true }).fill('mail.example.com');
  await page.getByLabel('Two-factor code (TOTP)', { exact: true }).fill('JBSWY3DPEHPK3PXP');
  await page.getByLabel('Folder', { exact: true }).fill('Personal/Email');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('heading', { name: 'Example Mail' }).waitFor();
  // Like Password Safe, the first username offered as the default for new logins.
  await page.getByRole('heading', { name: 'Use this username for new logins?' }).waitFor();
  await page.getByRole('button', { name: 'Use it' }).click();
  await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector('.totp .code')?.textContent || ''));
  step('login saved; generator and two-factor code work');
  await page.getByRole('button', { name: 'Copy password' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), pw);
  step('copy puts the password on the clipboard');
  await shot(page, '03-detail');

  // a card and a note, then search
  for (const [type, title] of [['Payment card', 'Visa'], ['Secure note', 'Alarm code']]) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New item', exact: true }).click();
    await page.locator('dialog').getByRole('button', { name: type, exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(title);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('heading', { name: title }).waitFor();
  }
  await page.locator('#q').fill('mail');
  assert.equal(await page.locator('.row').count(), 1);
  await page.locator('#q').fill('');
  step('cards, notes and search');

  // ---- the vault file holds no readable data
  const raw = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(tmp, 'desk', 'vault.keyhold'))},'utf8'))`]).toString();
  for (const leak of ['Example Mail', 'amy@example.com', pw, 'Visa']) assert.ok(!raw.includes(leak), 'vault file leaks ' + leak);
  step('vault file on disk contains no readable data');

  // ---- lock and unlock
  await page.getByRole('button', { name: /^Lock/ }).click();
  await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  await page.getByLabel('Master password', { exact: true }).fill('wrong password here');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('That master password is not correct.').waitFor({ timeout: 30000 });
  await page.getByLabel('Master password', { exact: true }).fill(MASTER);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('option', { name: /Example Mail/ }).waitFor({ timeout: 30000 });
  step('lock, wrong password refused, unlock');

  // ---- import a Password Safe XML export
  const xml = `<?xml version="1.0" encoding="UTF-8"?><passwordsafe delimiter="&#187;"><entry><group>Banking</group><title>Old Bank</title><username>amy</username><password>password1</password><url>https://bank.example</url></entry><entry><group>Banking</group><title>Old Bank 2</title><password>password1</password></entry></passwordsafe>`;
  const xmlPath = join(tmp, 'export.xml'); writeFileSync(xmlPath, xml);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await (await chooser).setFiles(xmlPath);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('heading', { name: 'Import report' }).waitFor();
  assert.match(await page.locator('dialog').textContent(), /2 item\(s\) imported/);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('option', { name: /Old Bank 2/ }).waitFor();
  step('Password Safe XML import with an import report');

  // ---- health report flags the weak, reused passwords
  await page.getByRole('button', { name: /Password health/ }).click();
  await page.getByRole('heading', { name: /Reused \(2\)/ }).waitFor();
  await page.getByRole('heading', { name: /Weak \(2\)/ }).waitFor();
  await shot(page, '04-health');
  step('health report finds weak and reused passwords');

  // ---- features modelled on Password Safe's main window
  await page.getByRole('button', { name: /^All items/ }).click();
  await page.getByRole('button', { name: 'Show as a table with columns' }).click();
  await page.locator('table.grid').waitFor();
  assert.ok((await page.locator('table.grid tbody tr').count()) >= 5);
  await page.locator('table.grid th').first().getByRole('button').click();
  assert.equal(await page.locator('th[aria-sort="descending"]').count(), 1, 'sorting by a column');
  await shot(page, '08-table');
  await page.getByRole('button', { name: 'Show as a list' }).click();
  step('table view with sortable columns (Flattened List)');

  await page.getByRole('option', { name: /Example Mail/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show characters of password…' }).click();
  await page.getByLabel('Positions', { exact: true }).fill('1, -1');
  assert.equal(await page.locator('.subset-cell').count(), 2);
  assert.equal(await page.locator('.subset-cell .ch').first().textContent(), pw[0]);
  await page.getByRole('button', { name: 'Done' }).click();
  step('right-click menu and "display subset of password"');

  await page.getByRole('option', { name: /Example Mail/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Protect from changes' }).click();
  await page.locator('.d-head .chip.warn').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Edit', exact: true }).isDisabled());
  await page.getByRole('option', { name: /Example Mail/ }).click({ button: 'right' });
  assert.ok(await page.getByRole('menuitem', { name: 'Move to trash' }).isDisabled(), 'protected items cannot be deleted');
  await page.getByRole('menuitem', { name: 'Unprotect' }).click();
  await page.locator('.d-head .chip.warn').waitFor({ state: 'detached' });
  step('protect and unprotect an item');

  await page.getByRole('button', { name: 'Read-write' }).click();
  await page.getByRole('button', { name: 'Read-only' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Edit', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByText('The vault is open read-only').first().waitFor();
  await page.getByRole('button', { name: 'Read-only' }).click();
  await page.getByRole('button', { name: 'Read-write' }).waitFor();
  step('read-only mode blocks changes');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Policies' }).click();
  await page.getByRole('button', { name: 'New policy' }).click();
  await page.getByLabel('Policy name', { exact: true }).fill('PIN');
  await page.getByLabel('length', { exact: true }).fill('6');
  for (const k of ['Lowercase a–z', 'Uppercase A–Z', 'Symbols']) await page.getByLabel(k, { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('cell', { name: 'PIN', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'amy@example.com', 'default username filled in');
  await page.getByLabel('Password policy', { exact: true }).selectOption({ label: 'PIN' });
  await page.getByRole('button', { name: 'Generate' }).first().click();
  assert.match(await page.locator('.gen-out').textContent(), /^\d{6}$/);
  await page.getByRole('button', { name: 'Use this' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  step('named password policy drives the generator; default username');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  await page.getByRole('button', { name: 'Export everything…' }).click();
  await page.getByRole('button', { name: 'Password Safe XML' }).click();
  await page.getByLabel('Master password', { exact: true }).fill(MASTER);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Continue' }).click();
  const xmlOut = await (await dl).path();
  const exported = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(xmlOut)},'utf8'))`]).toString();
  assert.match(exported, /<passwordsafe /);
  assert.match(exported, /<title><!\[CDATA\[Example Mail\]\]><\/title>/);
  await page.keyboard.press('Escape');
  step('export to Password Safe XML');

  // ---- 1.2: importing the same file again adds nothing
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await (await chooser2).setFiles(xmlPath);
  await page.getByText(/Nothing new: all 2 entries/).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^All items/ }).click();
  assert.equal(await page.locator('.row').count(), 5, 'no duplicates after a second import');
  step('a second import of the same file is skipped');

  // ---- search filters
  await page.locator('#q').fill('type:card');
  assert.deepEqual(await page.locator('.row .t').allTextContents(), ['Visa']);
  await page.locator('#q').fill('folder:banking -"bank 2"');
  assert.deepEqual(await page.locator('.row .t').allTextContents(), ['Old Bank']);
  await page.locator('#q').fill('has:totp');
  assert.deepEqual(await page.locator('.row .t').allTextContents(), ['Example Mail']);
  await page.locator('#q').fill('');
  step('search filters (type:, folder:, has:, phrases, exclusions)');

  // ---- Ctrl+C belongs to the browser; plain C copies the password
  await page.getByRole('option', { name: /Example Mail/ }).click();
  await page.evaluate(() => navigator.clipboard.writeText('keep me'));
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'keep me', 'Ctrl+C must not put the password on the clipboard');
  await page.keyboard.press('c');
  await page.waitForFunction((want) => navigator.clipboard.readText().then((t) => t === want), pw);
  step('Ctrl+C leaves the clipboard alone; C copies the password');

  // ---- the reminder date keeps its day (this browser is in UTC+7)
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Reminder to change it on', { exact: true }).fill('2031-05-20');
  await page.getByLabel('Password', { exact: true }).fill('Second-Passw0rd-For-Mail!');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Expires ' + new Date(2031, 4, 20).toLocaleDateString()).waitFor();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByLabel('Reminder to change it on', { exact: true }).inputValue(), '2031-05-20', 'date shown again as it was entered');
  await page.getByRole('button', { name: 'Cancel' }).click();
  step('change reminder keeps its date east of UTC');

  // ---- previous values: stay open while revealing, and can be used again
  await page.locator('details.hist summary').click();
  await page.locator('details.hist').getByRole('button', { name: 'Show' }).click();
  assert.equal(await page.locator('details.hist[open]').count(), 1, 'the list of previous values stays open');
  assert.equal(await page.locator('details.hist .val.secret').textContent(), pw);
  await page.locator('details.hist').getByRole('button', { name: 'Use this value again' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Use it' }).click();
  await page.getByText('Earlier value is in use again').waitFor();
  await page.keyboard.press('c');
  await page.waitForFunction((want) => navigator.clipboard.readText().then((t) => t === want), pw);
  assert.equal(await page.locator('details.hist .frow').count(), 1, 'the replaced password is the one previous value');
  step('an earlier password can be put back');

  // ---- select several items and act on them together
  await page.getByRole('option', { name: /Old Bank 2/ }).click();
  await page.getByRole('option', { name: /^Old Bank(?! 2)/ }).click({ modifiers: ['Control'] });
  await page.getByRole('heading', { name: '2 items selected' }).waitFor();
  assert.equal(await page.locator('.row.sel').count(), 2);
  await shot(page, '09-multi-select');
  await page.locator('.bulk-actions').getByRole('button', { name: 'Add a tag…' }).click();
  await page.getByLabel('Tag', { exact: true }).fill('legacy');
  await page.locator('dialog').getByRole('button', { name: 'OK' }).click();
  await page.getByText('Tagged 2 item(s)').waitFor();
  await page.locator('.bulk-actions').getByRole('button', { name: 'Move to trash' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await page.getByText('2 item(s) moved to trash').waitFor();
  assert.equal(await page.locator('.row').count(), 3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('option', { name: /Old Bank 2/ }).waitFor();
  await page.locator('#q').fill('tag:legacy');
  assert.equal(await page.locator('.row').count(), 2, 'both got the tag');
  await page.locator('#q').fill('');
  await page.locator('.list-head h2').click();
  await page.keyboard.press('Control+a');
  await page.getByRole('heading', { name: '5 items selected' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: '5 items selected' }).waitFor({ state: 'detached' });
  step('multi-select with Ctrl+click and Ctrl+A; tag, trash and undo for several items');

  // ---- connect to the sync server
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Sync' }).click();
  await page.getByLabel('Server address', { exact: true }).fill(SERVER);
  await page.getByLabel('Username', { exact: true }).fill('amy');
  await page.getByRole('button', { name: 'Create account with this vault' }).click();
  await page.getByRole('heading', { name: 'Your new recovery code' }).waitFor({ timeout: 30000 });
  await page.getByLabel('I have stored this code safely', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Synced with a Keyhold server').waitFor();
  await page.keyboard.press('Escape');
  step('desktop vault uploaded to the sync server');

  // ---- second device: the hosted web app
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const web = await ctx2.newPage();
  web.on('pageerror', (e) => errors.push('web: ' + e.message));
  await web.goto(SERVER);
  await web.getByRole('heading', { name: 'Sign in to your vault' }).waitFor();
  await web.getByLabel('Username or email', { exact: true }).fill('amy');
  await web.getByLabel('Master password', { exact: true }).fill(MASTER);
  await web.getByRole('button', { name: 'Unlock' }).click();
  await web.getByRole('option', { name: /Example Mail/ }).waitFor({ timeout: 30000 });
  await shot(web, '05-phone-list');
  await web.getByRole('button', { name: 'New item', exact: true }).click();
  await web.locator('dialog').getByRole('button', { name: 'Wi-Fi', exact: true }).click();
  await web.getByLabel('Name', { exact: true }).fill('Home Wi-Fi');
  await web.getByLabel('Network name', { exact: true }).fill('HomeNet');
  await web.getByRole('button', { name: 'Save', exact: true }).click();
  await web.getByRole('heading', { name: 'Home Wi-Fi' }).waitFor();
  await shot(web, '06-phone-detail');
  // The save is pushed after a short pause; wait for that push, not the earlier sign-in sync.
  const pushed = web.waitForResponse((r) => r.url().endsWith('/api/v1/vault') && r.request().method() === 'PUT' && r.ok(), { timeout: 15000 });
  await pushed;
  await web.waitForFunction(() => document.querySelector('.sync-pill')?.dataset.state === 'synced', null, { timeout: 15000 });
  step('second device signs in on the web, sees the items, adds one');

  // ---- desktop picks up the change, without disturbing an edit in progress
  await page.getByRole('button', { name: /All items/ }).click();
  await page.getByRole('option', { name: /Visa/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name on card', { exact: true }).fill('typed but not saved yet');
  await page.getByRole('button', { name: /Synced|Sync/ }).first().click();
  await page.getByRole('option', { name: /Home Wi-Fi/ }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByLabel('Name on card', { exact: true }).inputValue(), 'typed but not saved yet', 'a sync must not reset the edit form');
  await page.getByRole('button', { name: 'Cancel' }).click();
  step('desktop syncs the item added on the phone; the open edit form keeps its text');

  // ---- offline: the web app still opens from this browser's copy
  await web.reload();
  await web.getByLabel('Master password', { exact: true }).waitFor();
  await ctx2.setOffline(true);
  await web.getByLabel('Master password', { exact: true }).fill(MASTER);
  await web.getByRole('button', { name: 'Unlock' }).click();
  await web.getByRole('option', { name: /Home Wi-Fi/ }).waitFor({ timeout: 30000 });
  await ctx2.setOffline(false);
  step('web app unlocks offline from its encrypted copy');
  await shot(page, '07-desktop-synced');

  // ---- device mode: the web app on a plain web host, no Keyhold server behind it
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dev = await ctx3.newPage();
  dev.on('pageerror', (e) => errors.push('device: ' + e.message));
  dev.on('console', (m) => { if (m.type() === 'error') errors.push('device: ' + m.text()); });
  await dev.goto(STATIC + '/');
  await createVault(dev, { expectWhere: 'Stored encrypted in this browser' });
  await dev.getByText(/kept in this browser on this device/).waitFor({ state: 'detached' });
  await addNote(dev, 'Device note one');
  await addNote(dev, 'Device note two');
  await dev.reload();
  await dev.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
  await dev.getByLabel('Master password', { exact: true }).fill(MASTER);
  await dev.getByRole('button', { name: 'Unlock' }).click();
  await dev.getByRole('option', { name: /Device note two/ }).waitFor({ timeout: 30000 });
  step('device mode on a plain web host: vault kept in the browser, survives a reload');
  assert.ok(await dev.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r)), 'installable: service worker registered');
  const man = await dev.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  for (const ic of man.icons) assert.equal((await dev.request.get(STATIC + '/' + ic.src)).status(), 200, ic.src);
  assert.ok(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  step('installable web app: service worker, manifest with 192/512 and maskable icons');

  // Automatic backups in the browser: delete a note, bring it back from an earlier version.
  await dev.getByRole('option', { name: /Device note one/ }).click();
  await dev.keyboard.press('Delete');
  await dev.locator('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await dev.getByRole('button', { name: /^Trash/ }).click();
  await dev.getByRole('option', { name: /Device note one/ }).click();
  await dev.getByRole('button', { name: 'Delete for good' }).click();
  await dev.locator('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await dev.getByText('Trash is empty.').waitFor();
  await dev.getByRole('button', { name: 'Settings' }).click();
  await dev.getByRole('tab', { name: 'Backup' }).click();
  await dev.getByRole('button', { name: 'Show automatic backups' }).click();
  await dev.locator('dialog').getByRole('button', { name: 'Bring back items' }).first().waitFor();
  const versions = await dev.locator('dialog table.table tr').count();
  assert.ok(versions >= 4, 'earlier versions are listed: ' + versions);
  await dev.locator('dialog').getByRole('button', { name: 'Bring back items' }).first().click(); // newest first: just before the delete
  await dev.getByText(/Brought back 1 item/).waitFor();
  await dev.keyboard.press('Escape');
  await dev.getByRole('button', { name: /^All items/ }).click();
  await dev.getByRole('option', { name: /Device note one/ }).waitFor();
  step('automatic backups in the browser bring back an item deleted for good');

  // A device vault can join the sync server (loopback pages are allowed without settings).
  await dev.getByRole('button', { name: 'Settings' }).click();
  await dev.getByRole('tab', { name: 'Sync' }).click();
  await dev.getByLabel('Server address', { exact: true }).fill(SERVER);
  await dev.getByLabel('Username', { exact: true }).fill('dee');
  await dev.getByRole('button', { name: 'Create account with this vault' }).click();
  await dev.getByRole('heading', { name: 'Your new recovery code' }).waitFor({ timeout: 30000 });
  await dev.getByLabel('I have stored this code safely', { exact: true }).check();
  await dev.getByRole('button', { name: 'Continue' }).click();
  await dev.getByText('Synced with a Keyhold server').waitFor();
  await dev.keyboard.press('Escape');
  step('a device-mode vault syncs with a Keyhold server');
  await ctx3.close();

  // ---- the Android app's page, with a stand-in for the app's Java bridge
  const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx4.route('**/api/mode', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"mode":"device","platform":"android","version":"test"}' }));
  await ctx4.addInitScript(() => {
    const b = window.__bridge = { copies: [], saved: [], opened: [], clip: null, focus: true };
    window.KeyholdAndroid = {
      copy: (t) => { b.copies.push(t); b.clip = t; },
      clearClipboard: () => { if (!b.focus) return 'later'; if (b.clip == null) return 'other'; b.clip = null; return 'cleared'; },
      saveFile: (name, type, content) => b.saved.push({ name, type, content }),
      openUrl: (u) => b.opened.push(u),
    };
  });
  const app = await ctx4.newPage();
  app.on('pageerror', (e) => errors.push('android: ' + e.message));
  await app.goto(STATIC + '/');
  await app.getByRole('heading', { name: 'Create your vault' }).waitFor();
  await app.getByText('Stored encrypted on this phone').waitFor();
  await app.getByText(/Uninstalling the app deletes it/).waitFor();
  await app.getByLabel('Master password', { exact: true }).fill(MASTER);
  await app.getByLabel('Type it again', { exact: true }).fill(MASTER);
  await app.getByRole('button', { name: 'Create vault' }).click();
  await app.getByRole('heading', { name: 'Save your recovery code' }).waitFor({ timeout: 30000 });
  await app.getByRole('button', { name: 'Save as file' }).click();
  await app.getByRole('button', { name: 'Copy' }).click();
  const b1 = await app.evaluate(() => window.__bridge);
  assert.equal(b1.saved[0].name, 'keyhold-recovery-code.txt', 'files are saved through the app');
  assert.match(b1.copies[0], /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/, 'and copied through it');
  await app.getByLabel('I have stored this code safely', { exact: true }).check();
  await app.getByRole('button', { name: 'Continue' }).click();
  await app.getByText('Your vault is empty.').waitFor();
  assert.equal(await app.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r)), false, 'no service worker inside the app');

  await app.getByRole('button', { name: 'New item', exact: true }).click();
  await app.locator('dialog').getByRole('button', { name: 'Login', exact: true }).click();
  await app.getByLabel('Name', { exact: true }).fill('Bank');
  await app.getByLabel('Password', { exact: true }).fill('Phone-Passw0rd-123!');
  await app.getByLabel('Website', { exact: true }).fill('https://bank.example');
  await app.getByRole('button', { name: 'Save', exact: true }).click();
  await app.getByRole('heading', { name: 'Bank' }).waitFor();
  await app.getByRole('button', { name: 'Copy password' }).click();
  await app.getByRole('button', { name: 'Open website' }).click();
  const b2 = await app.evaluate(() => window.__bridge);
  assert.equal(b2.copies.at(-1), 'Phone-Passw0rd-123!');
  assert.deepEqual(b2.opened, ['https://bank.example/']);
  step('Android app page: files, clipboard and links go through the app');

  // The clipboard is cleared now, or when the app is back in front.
  await app.evaluate(() => { window.__bridge.focus = false; });
  await app.getByRole('button', { name: 'Clear clipboard' }).click();
  await app.getByText('The clipboard will be cleared when Keyhold is open again').waitFor();
  assert.equal(await app.evaluate(() => window.__bridge.clip), 'Phone-Passw0rd-123!');
  await app.evaluate(() => { window.__bridge.focus = true; window.keyholdResume(); });
  assert.equal(await app.evaluate(() => window.__bridge.clip), null, 'cleared on return');
  step('Android clipboard: cleared at once, or on return when the app was in the background');

  // The back button: from the item to the list, then out of the app.
  assert.equal(await app.evaluate(() => document.querySelector('.app').dataset.pane), 'detail');
  assert.equal(await app.evaluate(() => window.keyholdBack()), true);
  assert.equal(await app.evaluate(() => document.querySelector('.app').dataset.pane), 'list');
  await app.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await app.evaluate(() => window.keyholdBack()), true, 'closes a dialog');
  assert.equal(await app.locator('dialog').count(), 0);
  assert.equal(await app.evaluate(() => window.keyholdBack()), false, 'nothing left: Android may leave the app');
  step('Android back button closes dialogs and steps back before leaving');

  await app.getByRole('button', { name: 'Settings', exact: true }).click();
  await app.getByRole('tab', { name: 'Backup' }).click();
  await app.getByRole('button', { name: 'Download encrypted backup' }).click();
  const saved = (await app.evaluate(() => window.__bridge.saved)).at(-1);
  assert.match(saved.name, /^keyhold-backup-\d{4}-\d{2}-\d{2}\.keyhold$/);
  assert.equal(JSON.parse(saved.content).format, 'keyhold-vault');
  assert.ok(!saved.content.includes('Phone-Passw0rd'), 'the backup is encrypted');
  step('Android: encrypted backup saved through the system file picker');
  await ctx4.close();

  const relevant = errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(e));
  assert.deepEqual(relevant, [], 'no script errors or CSP violations');
  step('no script errors or CSP violations');
  console.log('E2E PASSED');
} catch (e) {
  await shot(page, 'failure').catch(() => {});
  console.error('E2E FAILED:', e.message, '\nconsole errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  cleanup();
  statik.close();
}
