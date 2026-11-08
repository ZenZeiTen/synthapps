// End-to-end test: the real keyhold binary in desktop mode plus a sync server,
// driven in headless Chromium. Usage: node test/e2e.mjs [screenshot-dir]
// Needs Go (to build) and Playwright with Chromium.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('heading', { name: 'Example Mail' }).waitFor();
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
    await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('tab', { name: 'Backup & import' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await (await chooser).setFiles(xmlPath);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('option', { name: /Old Bank 2/ }).waitFor();
  step('Password Safe XML import');

  // ---- health report flags the weak, reused passwords
  await page.getByRole('button', { name: /Password health/ }).click();
  await page.getByRole('heading', { name: /Reused \(2\)/ }).waitFor();
  await page.getByRole('heading', { name: /Weak \(2\)/ }).waitFor();
  await shot(page, '04-health');
  step('health report finds weak and reused passwords');

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
  await web.getByRole('button', { name: 'Save' }).click();
  await web.getByRole('heading', { name: 'Home Wi-Fi' }).waitFor();
  await shot(web, '06-phone-detail');
  // The save is pushed after a short pause; wait for that push, not the earlier sign-in sync.
  const pushed = web.waitForResponse((r) => r.url().endsWith('/api/v1/vault') && r.request().method() === 'PUT' && r.ok(), { timeout: 15000 });
  await pushed;
  await web.waitForFunction(() => document.querySelector('.sync-pill')?.dataset.state === 'synced', null, { timeout: 15000 });
  step('second device signs in on the web, sees the items, adds one');

  // ---- desktop picks up the change
  await page.getByRole('button', { name: /Synced|Sync/ }).first().click();
  await page.getByRole('button', { name: /All items/ }).click();
  await page.getByRole('option', { name: /Home Wi-Fi/ }).waitFor({ timeout: 15000 });
  step('desktop syncs the item added on the phone');

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
}
