// Larger views: settings, password generator, health report, recovery code.
import { h, icon, iconBtn, clear, fill, toast, modal, confirmBox, askPassword, download, pickFile, timeAgo } from './ui.js';
import { deriveFromPassword, openVault, decryptPayload, sha1Hex, WrongPasswordError } from './crypto.js';
import { TYPES, mergePayloads, primaryKey, normalizePayload, DEFAULT_POLICY, MAX_HISTORY } from './model.js';
import { policiesSection, policyForm } from './workbench.js';
import { importAny, exportCSV, exportPasswordSafeXML, importReport } from './importers.js';
import { generatePassword, generatePassphrase, loadWords } from './generator.js';
import { RemoteClient } from './storage.js';

// ---------- recovery code ----------
export function showRecoveryCode(code, first = false) {
  return modal((close) => {
    const ok = h('input', { type: 'checkbox' });
    const btn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => close(true) }, 'Continue');
    ok.addEventListener('change', () => { btn.disabled = !ok.checked; });
    return {
      title: first ? 'Save your recovery code' : 'Your new recovery code',
      body: [
        h('p', { text: 'If you forget your master password, this code is the only other way into your vault. Print it or write it down and keep it somewhere safe, away from this computer.' }),
        h('div', { class: 'code-box', text: code }),
        h('div', { class: 'btn-row', style: 'margin-bottom:12px' },
          h('button', { class: 'btn', type: 'button', onclick: () => navigator.clipboard.writeText(code).then(() => toast('Copied. Paste it somewhere safe, then clear your clipboard.')) }, icon('copy'), 'Copy'),
          h('button', { class: 'btn', type: 'button', onclick: () => download('keyhold-recovery-code.txt', `Keyhold recovery code\r\n\r\n${code}\r\n\r\nCreated ${new Date().toLocaleString()}.\r\nAnyone with this code can open your vault. Keep it offline.\r\n`, 'text/plain') }, icon('download'), 'Save as file')),
        first ? null : h('p', { class: 'notice', text: 'Your previous recovery code no longer works.' }),
        h('label', { class: 'check' }, ok, 'I have stored this code safely'),
      ],
      foot: btn,
    };
  });
}

/** Ask for a new master password and apply it. `forced` after a recovery unlock. */
export async function chooseNewPassword(session, forced = false, app) {
  for (;;) {
    const result = await modal((close) => {
      const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', autofocus: true });
      const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
      const diff = numSelect(Math.max(600000, session.envelope.kdf.iterations), DIFFICULTY, () => {});
      diff.setAttribute('aria-label', 'Unlock difficulty');
      const err = h('div', { class: 'error' });
      const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Set new password');
      return {
        title: forced ? 'Choose a new master password' : 'Change master password',
        body: h('form', {
          onsubmit: async (e) => {
            e.preventDefault(); err.textContent = '';
            const msg = app ? await app.checkNewPassword(p1.value, p2.value) : (p1.value !== p2.value ? 'The two passwords are not the same.' : p1.value.length < 10 ? 'Use at least 10 characters.' : '');
            if (msg) { err.textContent = msg; return; }
            btn.disabled = true; btn.textContent = 'Saving…';
            try { await session.changePassword(p1.value, { iterations: +diff.value }); close(true); }
            catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Set new password'; }
          },
        }, forced ? h('p', { class: 'notice', text: 'You unlocked with your recovery code. Set a new master password to finish.' }) : null,
        session.remote ? h('p', { class: 'muted small', text: 'Your other devices will ask for the new password the next time they sync.' }) : null,
        h('label', { class: 'field' }, h('span', { text: 'New master password' }), p1),
        h('label', { class: 'field' }, h('span', { text: 'Type it again' }), p2),
        h('label', { class: 'field' }, h('span', { text: 'Unlock difficulty' }), diff),
        h('p', { class: 'hint', text: 'Higher makes guessing your master password slower for an attacker, and unlocking a little slower for you.' }), err,
        h('div', { class: 'dlg-foot', style: 'padding:6px 0 10px' }, forced ? null : h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'), btn)),
      };
    });
    if (result || !forced) return !!result;
  }
}

// Password Safe's "Unlock Difficulty" slider, as key-stretching rounds.
const DIFFICULTY = [[600000, 'Standard (600,000 rounds)'], [1000000, 'Stronger (1,000,000 rounds)'], [2000000, 'Maximum (2,000,000 rounds, slower to unlock)']];

/** Re-ask the master password before sensitive actions. */
export async function confirmMaster(session, text) {
  if (session.authKind !== 'password') return true;
  return askPassword('Confirm it is you', text, async (pw) => {
    const d = await deriveFromPassword(pw, session.envelope.kdf);
    if (d.authKey !== session.keys.authKey) throw new Error('That master password is not correct.');
  });
}

// ---------- generator ----------
const genPrefs = { mode: 'password', policyId: 'default', custom: null, words: 5, sep: '-' };

/** Generator with Password Safe-style named policies. `policyId` preselects the item's policy. */
export async function openGenerator(app, { pick = true, policyId = null } = {}) {
  let words = null;
  try { words = await loadWords(); } catch { genPrefs.mode = 'password'; }
  const s = app.state.session;
  const policies = s.settings.policies;
  if (policyId && policies.find((p) => p.id === policyId)) { genPrefs.policyId = policyId; genPrefs.mode = 'password'; }
  if (!policies.find((p) => p.id === genPrefs.policyId) && genPrefs.policyId !== 'custom') genPrefs.policyId = 'default';
  return modal((close) => {
    const out = h('div', { class: 'gen-out', 'aria-live': 'polite' });
    const meter = h('div', { class: 'meter-label' });
    const opts = h('div');
    let value = '';
    const current = () => (genPrefs.policyId === 'custom' ? (genPrefs.custom || { ...DEFAULT_POLICY }) : policies.find((p) => p.id === genPrefs.policyId) || DEFAULT_POLICY);
    const gen = () => {
      try {
        value = genPrefs.mode === 'password' ? generatePassword(current())
          : generatePassphrase(words, { count: genPrefs.words, separator: genPrefs.sep, capitalize: true, number: true });
        out.textContent = value;
        const st = app.strength(value);
        meter.textContent = `${st.label} · about ${st.bits} bits`;
      } catch (e) { value = ''; out.textContent = ''; meter.textContent = e.message; }
    };
    const seg = h('div', { class: 'seg' });
    const draw = () => {
      fill(seg, ['password', 'passphrase'].map((m) => h('button', {
        type: 'button', class: genPrefs.mode === m ? 'on' : '', disabled: m === 'passphrase' && !words,
        onclick: () => { genPrefs.mode = m; draw(); gen(); },
      }, m === 'password' ? 'Random characters' : 'Words')));
      if (genPrefs.mode === 'password') {
        const sel = h('select', { class: 'input', 'aria-label': 'Password policy', onchange: (e) => { genPrefs.policyId = e.target.value; if (e.target.value === 'custom' && !genPrefs.custom) genPrefs.custom = { ...current(), id: null }; draw(); gen(); } },
          policies.map((p) => h('option', { value: p.id }, p.name)), h('option', { value: 'custom' }, 'Custom for now…'));
        sel.value = genPrefs.policyId;
        const p = current();
        const desc = p.hex ? `${p.length} hexadecimal digits` : `${p.length} characters: ` + [p.lower && 'a–z', p.upper && 'A–Z', p.digits && '0–9', p.symbols && (p.symbolSet || 'symbols')].filter(Boolean).join(', ')
          + (p.pronounceable ? ', pronounceable' : '') + (p.avoidAmbiguous ? ', easy to read' : '');
        fill(opts, h('label', { class: 'field' }, h('span', { text: 'Policy' }), sel), h('p', { class: 'hint', text: desc }),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', type: 'button', onclick: () => policyForm(p, { title: 'Custom rules', onSave: (np) => { genPrefs.custom = { ...np, id: null }; genPrefs.policyId = 'custom'; draw(); gen(); } }) }, icon('edit'), 'Change rules…'),
            genPrefs.policyId === 'custom' && !s.readOnly ? h('button', { class: 'btn', type: 'button', onclick: () => policyForm({ ...current(), name: 'My policy' }, { title: 'Save as a named policy',
              onSave: (np) => s.updateSettings({ policies: [...policies, np] }).then(() => { genPrefs.policyId = np.id; toast('Policy saved'); close(undefined); }).catch(app.fail) }) }, icon('plus'), 'Save as policy…') : null));
      } else {
        const n = h('input', { type: 'range', min: 3, max: 10, value: genPrefs.words, 'aria-label': 'Words' });
        const lab = h('span', { text: 'Words: ' + genPrefs.words });
        n.addEventListener('input', () => { genPrefs.words = +n.value; lab.textContent = 'Words: ' + n.value; gen(); });
        const sep = h('select', { class: 'input', onchange: (e) => { genPrefs.sep = e.target.value; gen(); } },
          [['-', 'Hyphen'], [' ', 'Space'], ['.', 'Dot'], ['_', 'Underscore']].map(([v, l]) => h('option', { value: v }, l)));
        sep.value = genPrefs.sep;
        fill(opts, h('label', { class: 'field' }, lab, n), h('label', { class: 'field' }, h('span', { text: 'Between words' }), sep),
          h('p', { class: 'hint', text: 'Words from the EFF list of 7,776. Easy to type and remember.' }));
      }
    };
    draw(); gen();
    return {
      title: 'Generate',
      body: [seg, out, meter, opts],
      foot: [h('button', { class: 'btn', type: 'button', onclick: gen }, icon('refresh'), 'New'),
        h('button', { class: 'btn', type: 'button', onclick: () => app.copy(value, 'Generated value') }, icon('copy'), 'Copy'),
        pick ? h('button', { class: 'btn primary', type: 'button', onclick: () => close(value) }, 'Use this') : null],
    };
  });
}

/** Export some items, as Keyhold CSV or Password Safe XML (both unencrypted). */
export async function exportItems(app, items, label = 'items') {
  const s = app.state.session;
  const live = items.filter((i) => !i.deletedAt);
  if (!live.length) return toast('Nothing to export.', { error: true });
  const fmt = await modal((close) => ({
    title: live.length === 1 ? `Export "${live[0].title}"` : `Export ${live.length} items`,
    body: [h('p', { class: 'muted', text: 'Both formats are plain text that anyone can read. Delete the file once you are done with it.' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => close('csv') }, icon('download'), 'CSV (spreadsheets, other managers)'),
        h('button', { class: 'btn', type: 'button', onclick: () => close('pws') }, icon('download'), 'Password Safe XML'))],
  }));
  if (!fmt) return;
  if (!(await confirmMaster(s, 'Exporting writes passwords in readable form. Enter your master password to continue.'))) return;
  const day = new Date().toISOString().slice(0, 10);
  const base = ('keyhold-' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + day).replace(/-+/g, '-');
  if (fmt === 'csv') download(base + '.csv', exportCSV(live), 'text/csv');
  else download(base + '.xml', exportPasswordSafeXML(live, { databaseName: s.settings.vault.name || 'Keyhold' }), 'application/xml');
  toast('Exported. Delete the file when you are done with it.', { ms: 7000 });
}

// ---------- health ----------
export function renderHealth(app) {
  const s = app.state.session;
  const r = app.currentHealth();
  const section = (title, hint, entries, line) => entries.length ? h('div', { class: 'card hlist' }, h('h3', { text: `${title} (${entries.length})` }),
    h('p', { class: 'small muted', style: 'margin:4px 16px 6px', text: hint }),
    entries.map((e) => { const it = e.item || e; return h('div', { class: 'frow', tabindex: '0', onclick: () => app.select(it.id), onkeydown: (ev) => { if (ev.key === 'Enter') app.select(it.id); } },
      h('div', { class: 'fl' }, h('div', { text: it.title, style: 'font-weight:600' }), h('div', { class: 'small muted', text: line(e) })), icon('back', 'flip')); })) : null;
  const status = h('span', { class: 'small muted' });
  const checkBtn = h('button', { class: 'btn', type: 'button', onclick: () => breachCheck(app, checkBtn, status) }, icon('shield'), 'Check for breached passwords');
  const color = r.score >= 90 ? 'var(--ok)' : r.score >= 60 ? 'var(--s2)' : 'var(--danger)';
  return h('article', { class: 'detail' },
    h('div', { class: 'd-head' }, iconBtn('back', 'Back', () => { app.state.pane = 'nav'; app.renderAll(); }, { class: 'mob' }),
      h('div', { class: 'tile' }, icon('shield')), h('div', { class: 'grow' }, h('h1', { text: 'Password health' }), h('div', { class: 'meta', text: `${r.total} secrets checked on this device` }))),
    h('div', { class: 'card health-score' }, h('div', { class: 'big', style: `color:${color}`, text: r.score }),
      h('div', {}, h('div', { style: 'font-weight:600', text: r.score >= 90 ? 'Looking good' : r.score >= 60 ? 'Some things to fix' : 'Several passwords need attention' }),
        h('div', { class: 'small muted', text: 'Share of your passwords that are strong, unique, recent and not breached.' }))),
    h('div', { class: 'card', style: 'padding:14px 16px' },
      h('p', { class: 'small', style: 'margin:0 0 10px', text: 'The breach check sends only the first 5 characters of each password\'s SHA-1 fingerprint to Have I Been Pwned (k-anonymity). Your passwords never leave this device.' }),
      h('div', { class: 'btn-row', style: 'align-items:center' }, checkBtn, status)),
    section('Found in data breaches', 'These passwords are known to attackers. Change them first.', r.breached, (e) => `Seen ${e.count.toLocaleString()} times`),
    section('Reused', 'One leak exposes every account that shares a password.', r.reused.flatMap((g) => g.map((it) => ({ item: it, n: g.length }))), (e) => `Same password on ${e.n} items`),
    section('Weak', 'Easy to guess. Use the generator to replace them.', r.weak, (e) => e.strength.label + (e.strength.warnings[0] ? ' · ' + e.strength.warnings[0] : '')),
    section('Not changed for over a year', 'Consider changing these, starting with important accounts.', r.old, (e) => 'Set ' + timeAgo(e.item.passwordChangedAt)),
    section('Due soon', 'You set a reminder to change these.', r.expiring, (e) => 'Due ' + new Date(e.item.expiresAt).toLocaleDateString()),
    section('No two-factor code stored', 'If the site offers two-step sign-in, turning it on protects you even if the password leaks.', r.noTotp.slice(0, 50), (e) => e.item.fields.url),
    !r.breached.length && !r.reused.length && !r.weak.length && !r.old.length ? h('p', { class: 'notice ok', text: 'No weak, reused or old passwords found.' }) : null);
}

async function breachCheck(app, btn, status) {
  const s = app.state.session;
  const targets = s.items().filter((i) => !i.deletedAt && ['login', 'wifi', 'apikey'].includes(i.type) && i.fields[primaryKey(i.type)]);
  if (!targets.length) { status.textContent = 'No passwords to check.'; return; }
  btn.disabled = true;
  const cache = new Map();
  const results = {};
  try {
    let n = 0;
    for (const it of targets) {
      const hash = await sha1Hex(it.fields[primaryKey(it.type)]);
      const pre = hash.slice(0, 5), rest = hash.slice(5);
      if (!cache.has(pre)) {
        const res = await fetch('https://api.pwnedpasswords.com/range/' + pre, { headers: { 'Add-Padding': 'true' }, referrerPolicy: 'no-referrer', credentials: 'omit' });
        if (!res.ok) throw new Error('The breach service answered ' + res.status);
        cache.set(pre, await res.text());
      }
      const line = cache.get(pre).split('\n').find((l) => l.startsWith(rest));
      const count = line ? parseInt(line.split(':')[1], 10) || 0 : 0;
      results[it.id] = { count, checkedAt: new Date().toISOString() };
      status.textContent = `Checked ${++n} of ${targets.length}…`;
    }
    await s.change((p) => { for (const [id, b] of Object.entries(results)) if (p.items[id]) p.items[id] = { ...p.items[id], breach: b }; });
    const bad = Object.values(results).filter((b) => b.count > 0).length;
    status.textContent = bad ? `${bad} breached password(s) found.` : 'None of your passwords appear in known breaches.';
  } catch (e) {
    status.textContent = 'Could not finish: ' + (e.message.includes('fetch') ? 'no connection to the breach service.' : e.message);
  } finally { btn.disabled = false; }
}

// ---------- settings ----------
export function openSettings(app, tab = 'security') {
  const s = app.state.session;
  const desktop = app.state.mode === 'desktop';
  // Arranged like Password Safe's Options, plus sync and the vault's properties.
  const tabs = [['security', 'Security'], ['display', 'Display'], ['entries', 'Entries'], ['policies', 'Policies'],
    ...(desktop ? [['sync', 'Sync']] : [['account', 'Account']]), ['backup', 'Backup'], ['vault', 'Vault'], ['about', 'About']];
  if (tab === 'look') tab = 'display';
  let current = tab;
  return modal((close) => {
    const body = h('div');
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    const draw = () => {
      fill(bar, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: current === k ? 'on' : '', 'aria-selected': String(current === k), onclick: () => { current = k; draw(); } }, l)));
      fill(body, s.readOnly && current !== 'about' ? h('p', { class: 'notice', text: 'The vault is open read-only, so settings cannot be changed. Switch to read-write in the status bar.' }) : null,
        ({ security: secSecurity, display: secDisplay, entries: secEntries, policies: secPolicies, sync: secSync, account: secAccount, backup: secBackup, vault: secVault, about: secAbout })[current](app, s, close, draw));
    };
    draw();
    return { title: 'Settings', tabs: bar, body };
  }, { large: true });
}

function sec(title, text, ...kids) { return h('div', { class: 'set-sec' }, h('h3', { text: title }), text ? h('p', { text }) : null, kids); }
function check(s, key, label, after) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.settings[key], disabled: s.readOnly,
    onchange: (e) => s.updateSettings({ [key]: e.target.checked }).then(after).catch((x) => toast(x.message, { error: true })) }), label);
}
const save = (s, patch, after) => s.updateSettings(patch).then(after).catch((x) => toast(x.message, { error: true }));
function numSelect(value, options, onchange) {
  const sel = h('select', { class: 'input', style: 'max-width:260px', onchange: (e) => onchange(+e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = String(value);
  return sel;
}

function secSecurity(app, s, close, redraw) {
  const st = s.settings;
  return [
    sec('Lock automatically', 'Locking forgets the keys; the master password is needed again.',
      numSelect(st.autoLockMinutes, [[1, 'After 1 minute without activity'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [60, 'After 1 hour'], [0, 'Never']], (v) => s.updateSettings({ autoLockMinutes: v })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.lockOnHide, onchange: (e) => s.updateSettings({ lockOnHide: e.target.checked }) }), 'Lock as soon as the window is minimised or hidden')),
    sec('Clipboard', 'Copied passwords are removed from the clipboard after:',
      numSelect(st.clipboardSeconds, [[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [0, 'Never clear']], (v) => s.updateSettings({ clipboardSeconds: v })),
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { class: 'btn', type: 'button', onclick: () => app.clearClipboard(true) }, icon('x'), 'Clear clipboard now'))),
    sec('Master password', `Unlock difficulty: PBKDF2-SHA256, ${s.envelope.kdf.iterations.toLocaleString()} rounds. Last changed ${st.vault.passwordChangedAt ? timeAgo(st.vault.passwordChangedAt) : 'unknown'}. Changing the password also lets you raise the difficulty.`,
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmMaster(s, 'Enter your current master password.'))) return;
        if (await chooseNewPassword(s, false, app)) toast('Master password changed');
      } }, icon('key'), 'Change master password')),
    sec('Recovery code', s.envelope.keys.recovery ? 'A recovery code is set. You can replace it (the old one stops working) or remove it.' : 'No recovery code is set. Without one, a forgotten master password means the vault cannot be opened.',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!(await confirmMaster(s, 'Enter your master password to create a new recovery code.'))) return;
          try { const code = await s.newRecoveryCode(); await showRecoveryCode(code); redraw(); } catch (e) { toast(e.message, { error: true }); }
        } }, icon('refresh'), s.envelope.keys.recovery ? 'New recovery code' : 'Create recovery code'),
        s.envelope.keys.recovery ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!(await confirmBox('Remove the recovery code?', 'Only the master password will open the vault.', { ok: 'Remove', danger: true }))) return;
          try { await s.removeRecoveryCode(); toast('Recovery code removed'); redraw(); } catch (e) { toast(e.message, { error: true }); }
        } }, 'Remove') : null)),
  ];
}

function secSync(app, s, close, redraw) {
  const sync = s.settings.sync;
  if (sync && s.remote) {
    return [
      sec('Synced with a Keyhold server', null,
        h('table', { class: 'table' },
          h('tr', {}, h('th', { text: 'Server' }), h('td', { text: sync.url })),
          h('tr', {}, h('th', { text: 'Account' }), h('td', { text: sync.username })),
          h('tr', {}, h('th', { text: 'Status' }), h('td', { text: s.status.message || s.status.state })),
          h('tr', {}, h('th', { text: 'Last sync' }), h('td', { text: s.meta.lastSync ? timeAgo(s.meta.lastSync) : 'never' }))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => s.sync().then(() => { toast('Synced'); redraw(); }).catch((e) => toast(e.message, { error: true })) }, icon('refresh'), 'Sync now'),
          h('button', { class: 'btn', type: 'button', onclick: () => window.open(sync.url, '_blank', 'noopener,noreferrer') }, icon('external'), 'Open in browser'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!(await confirmBox('Stop syncing?', 'The vault stays on this computer. The copy on the server is not deleted.', { ok: 'Stop syncing' }))) return;
            await s.disconnect(); toast('Sync turned off'); redraw();
          } }, 'Stop syncing'))),
      sec('Versions on the server', 'The server keeps earlier versions. Opening one merges its items back in; nothing is lost.', serverHistory(app, s)),
    ];
  }
  const url = h('input', { class: 'input', placeholder: 'https://vault.example.com', value: (sync && sync.url) || '' });
  const user = h('input', { class: 'input', autocapitalize: 'none', value: (sync && sync.username) || '' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const inv = h('input', { class: 'input', autocomplete: 'off' });
  const err = h('div', { class: 'error' });
  const act = async (btn, fn) => { err.textContent = ''; btn.disabled = true; try { await fn(); redraw(); } catch (e) { err.textContent = e instanceof WrongPasswordError ? e.message : e.message; } finally { btn.disabled = false; } };
  const joinBtn = h('button', { class: 'btn primary', type: 'button' }, 'Sign in and merge');
  const createBtn = h('button', { class: 'btn', type: 'button' }, 'Create account with this vault');
  joinBtn.onclick = () => act(joinBtn, async () => {
    if (!pw.value) throw new Error('Enter the master password of the account on the server.');
    await s.signInToAccount(url.value, user.value, pw.value);
    toast('Signed in. Items from both sides are merged.');
  });
  createBtn.onclick = () => act(createBtn, async () => {
    const code = await s.createAccount(url.value, user.value, inv.value);
    toast('Account created. This vault now syncs.');
    if (code) await showRecoveryCode(code);
  });
  return [
    sec('Use this vault on other devices', 'Run "keyhold serve" on a computer or server you control. Everything is encrypted here before it is sent; the server cannot read your vault.',
      h('label', { class: 'field' }, h('span', { text: 'Server address' }), url),
      h('label', { class: 'field' }, h('span', { text: 'Username' }), user),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', { text: 'Master password of that account (to sign in)' }), pw),
        h('label', { class: 'field' }, h('span', { text: 'Invite code (to create, if the server needs one)' }), inv)),
      h('p', { class: 'hint', text: 'Signing in to an existing account merges both vaults; afterwards this computer uses that account\'s master password. Creating an account uploads this vault with your current master password.' }),
      err, h('div', { class: 'btn-row' }, joinBtn, createBtn)),
  ];
}

function secAccount(app, s) {
  return [
    sec('Signed in', null, h('table', { class: 'table' },
      h('tr', {}, h('th', { text: 'Account' }), h('td', { text: s.username })),
      h('tr', {}, h('th', { text: 'Server' }), h('td', { text: location.host })),
      h('tr', {}, h('th', { text: 'Status' }), h('td', { text: s.status.message || s.status.state })),
      h('tr', {}, h('th', { text: 'Last sync' }), h('td', { text: s.meta.lastSync ? timeAgo(s.meta.lastSync) : '—' })))),
    sec('Offline copy', 'This browser keeps an encrypted copy so the vault opens without a connection. Remove it on shared computers.',
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmBox('Remove the copy in this browser?', 'You will be signed out. The vault on the server is not touched.', { ok: 'Remove and sign out' }))) return;
        await s.local.remove(); await s.remote.logout(); app.lock('Signed out and removed from this browser');
      } }, 'Remove from this browser and sign out')),
    sec('Versions on the server', 'Earlier versions are kept. Opening one merges its items back in.', serverHistory(app, s)),
    sec('Delete account', 'Deletes the account and every version of the vault from the server.',
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const ok = await askPassword('Delete account for good', 'This cannot be undone. Export a backup first if you want to keep your data.', async (pw) => {
          const pre = await s.remote.prelogin(s.username);
          const d = await deriveFromPassword(pw, pre.kdf);
          await s.remote.deleteAccount(d.authKey).catch((e) => { throw new Error(e.status === 401 ? 'That master password is not correct.' : e.message); });
        }, { ok: 'Delete account' });
        if (ok) { await s.local.remove(); app.lock('Account deleted'); }
      } }, icon('trash'), 'Delete account')),
  ];
}

function serverHistory(app, s) {
  const box = h('div', {}, h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      await s.ensureLogin();
      const { backups } = await s.remote.history();
      fill(box, historyTable(backups, async (b) => {
        const rec = await s.remote.historyItem(b.name);
        await mergeVersion(app, s, rec.vault);
      }));
    } catch (e) { toast(e.message, { error: true }); }
  } }, icon('history'), 'Show versions'));
  return box;
}

function historyTable(list, onOpen) {
  if (!list.length) return h('p', { class: 'muted', text: 'No earlier versions yet.' });
  return h('table', { class: 'table' }, h('tr', {}, h('th', { text: 'Version' }), h('th', { text: 'Saved' }), h('th')),
    list.slice(0, 30).map((b) => h('tr', {}, h('td', { text: '#' + b.rev }), h('td', { text: new Date(b.savedAt).toLocaleString() }),
      h('td', {}, h('button', { class: 'btn', type: 'button', onclick: () => onOpen(b).catch((e) => toast(e.message, { error: true })) }, 'Bring back items')))));
}

async function mergeVersion(app, s, vault) {
  let payload;
  try { payload = await decryptPayload(vault, s.keys.dataKey); }
  catch {
    const opened = await askPassword('Older master password', 'This version was saved with a different master password. Enter it to open the version.', (pw) => openVault(vault, pw));
    if (!opened) return;
    payload = opened.payload;
  }
  const p = normalizePayload(payload);
  // Bring back items that are missing or in the trash now; keep current edits.
  const restored = [];
  await s.change((cur) => {
    for (const [id, it] of Object.entries(p.items)) {
      const now = cur.items[id];
      if (!now || (now.deletedAt && !it.deletedAt)) { cur.items[id] = { ...it, deletedAt: null, updatedAt: new Date().toISOString() }; delete cur.purged[id]; restored.push(it.title); }
    }
  });
  toast(restored.length ? `Brought back ${restored.length} item(s)` : 'Nothing was missing; your vault already has everything from that version.');
}

function secBackup(app, s, close) {
  const desktop = app.state.mode === 'desktop';
  const local = desktop ? h('div', {}, h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      const { backups, folder } = await app.state.store.backups();
      fill(local, h('p', { class: 'small muted', text: 'Folder: ' + folder }), historyTable(backups, async (b) => {
        const rec = await app.state.store.backup(b.name);
        await mergeVersion(app, s, rec.vault);
      }));
    } catch (e) { toast(e.message, { error: true }); }
  } }, icon('history'), 'Show automatic backups')) : null;
  return [
    sec('Encrypted backup', 'A copy of the vault file, still locked with your master password. Safe to keep on a USB stick or in cloud storage.',
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const env = await s.sealChecked();
        download(`keyhold-backup-${new Date().toISOString().slice(0, 10)}.keyhold`, JSON.stringify(env));
        toast('Backup saved to your Downloads folder');
      } }, icon('download'), 'Download encrypted backup')),
    desktop ? sec('Automatic backups', 'Every save keeps the previous version (the last 30). Use these to undo a mistake.', local) : null,
    sec('Merge another vault', 'Adds the items of another Keyhold vault or backup file (for example one kept on another computer). Nothing here is overwritten; where the same item exists in both, the newer version wins and the older password goes to its history.',
      h('button', { class: 'btn', type: 'button', disabled: s.readOnly, onclick: () => mergeFile(app, s, close) }, icon('upload'), 'Merge a vault file…')),
    sec('Import', 'From Password Safe: use File › Export To › XML format, then import that file here. Also accepted: CSV from Bitwarden, 1Password, KeePass, LastPass, Chrome, Edge and Firefox, and Password Safe text exports.',
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const f = await pickFile('.xml,.csv,.txt,text/csv,text/xml,application/xml');
        if (!f) return;
        let res;
        try { res = importAny(f.name, f.text); } catch (e) { toast(e.message, { error: true }); return; }
        if (!res.items.length) { toast('No entries found in that file.', { error: true }); return; }
        const ok = await confirmBox('Import ' + res.items.length + ' items?', `From ${f.name} (${res.kind}). Items are added; nothing is overwritten. Delete the export file afterwards: it is not encrypted.`, { ok: 'Import' });
        if (!ok) return;
        try { await s.addItems(res.items); } catch (e) { return app.fail(e); }
        close(); app.setFilter({ kind: 'all' });
        await showImportReport(res, f.name);
      } }, icon('upload'), 'Import a file…')),
    sec('Export as plain text', 'CSV (spreadsheets, other password managers) or Password Safe XML (File › Import From › XML format in Password Safe). Anyone can read these files: use them only to move to another program, and delete them straight after.',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn danger', type: 'button', onclick: () => app.exportItems(s.items(), 'all') }, icon('download'), 'Export everything…'),
        h('button', { class: 'btn', type: 'button', onclick: () => app.exportItems(app.visibleItems(), 'view') }, icon('download'), `Export the current view (${app.visibleItems().filter((i) => !i.deletedAt).length})…`))),
  ];
}

function secDisplay(app, s, close, redraw) {
  const st = s.settings;
  const theme = h('select', { class: 'input', style: 'max-width:260px', disabled: s.readOnly, onchange: (e) => { app.applyTheme(e.target.value); save(s, { theme: e.target.value }); } },
    h('option', { value: 'system' }, 'Same as the system'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'));
  theme.value = st.theme || 'system';
  const tree = numSelectStr(st.initialTree, [['expanded', 'Folders open'], ['collapsed', 'Folders closed']], (v) => save(s, { initialTree: v }));
  const warn = numSelect(st.expiryWarnDays, [[7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']], (v) => save(s, { expiryWarnDays: v }, app.renderAll));
  [tree, warn].forEach((x) => { x.disabled = s.readOnly; });
  return [
    sec('Theme', null, theme),
    sec('Item list', null,
      check(s, 'showUsername', 'Show the username (or card, account, network) under each name', app.renderAll),
      check(s, 'notesTooltip', 'Show notes as a tooltip when pointing at an item', app.renderAll),
      h('p', { class: 'hint', text: 'Switch between the list and a table with sortable columns with the button next to the list title.' })),
    sec('Folders when the vault opens', null, tree),
    sec('Expiry warnings', 'Password health lists items whose change reminder is due within:', warn),
    sec('Keyboard', null, h('table', { class: 'table' }, [['/', 'Search'], ['N', 'New item'], ['↑ ↓ or J K', 'Move through the list'], ['Enter', 'Open the selected item'], ['E', 'Edit selected item'],
      ['C', 'Copy password (or main secret)'], ['U', 'Copy username'], ['Delete', 'Move to trash'], ['Shift+F10 or Menu key', 'Actions for the selected item'], ['Ctrl+S', 'Save while editing'],
      ['Esc', 'Cancel editing, clear search'], ['Ctrl+Shift+L', 'Lock']].map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', { text: k })), h('td', { text: d }))))),
  ];
}

function numSelectStr(value, options, onchange) {
  const sel = h('select', { class: 'input', style: 'max-width:260px', onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = String(value);
  return sel;
}

function secEntries(app, s, close, redraw) {
  const st = s.settings;
  const keep = numSelect(st.historyKeep, [[0, 'Keep none'], [3, 'Keep the last 3'], [5, 'Keep the last 5'], [10, 'Keep the last 10'], [30, 'Keep the last 30'], [MAX_HISTORY, `Keep the last ${MAX_HISTORY}`]], (v) => save(s, { historyKeep: v }));
  const exp = numSelect(st.defaultExpiryDays, [[0, 'No reminder'], [30, 'After 30 days'], [90, 'After 90 days'], [180, 'After 180 days'], [365, 'After 1 year']], (v) => save(s, { defaultExpiryDays: v }));
  const dbl = numSelectStr(st.doubleClick, [['copyPassword', 'Copy the password'], ['copyUsername', 'Copy the username'], ['openUrl', 'Open the website'], ['edit', 'Edit the item'], ['view', 'Nothing extra (just open it)']], (v) => save(s, { doubleClick: v }));
  const user = h('input', { class: 'input', style: 'max-width:320px', value: st.defaultUsername, placeholder: 'None', 'aria-label': 'Default username' });
  user.addEventListener('change', () => save(s, { defaultUsername: user.value.trim(), askedDefaultUsername: true }));
  [keep, exp, dbl, user].forEach((x) => { x.disabled = s.readOnly; });
  return [
    sec('Password history', 'When a password (or card number, key...) changes, the old value is kept with the item:', keep,
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { class: 'btn danger', type: 'button', disabled: s.readOnly, onclick: async () => {
        const n = s.items().filter((i) => i.history.length).length;
        if (!n) return toast('No item has previous values.');
        if (!(await confirmBox('Clear all password history?', `Previous values are removed from ${n} item(s), on every device.`, { ok: 'Clear history', danger: true }))) return;
        s.change((p) => { for (const [id, it] of Object.entries(p.items)) if (it.history.length) p.items[id] = { ...it, history: [], updatedAt: new Date().toISOString() }; }).then(() => toast('History cleared')).catch(app.fail);
      } }, 'Clear the history of every item…'))),
    sec('Change reminders', 'When you set a new password, remind me to change it:', exp),
    sec('Default username', 'Filled in for new logins.', user),
    sec('Double-click on an item', null, dbl),
    sec('Safety', null,
      check(s, 'confirmTrash', 'Ask before moving an item to the trash'),
      check(s, 'trackAccess', 'Record when each password was last copied or used (shows a "Last used" column)', app.renderAll)),
  ];
}

function secPolicies(app, s, close, redraw) {
  return [sec('Password policies', 'Named rules for generated passwords, like "PIN: 6 digits" or "Bank: 12 characters, no symbols". Pick one per item in its edit form; the Generate button then follows it.',
    policiesSection(app, redraw))];
}

function secVault(app, s, close, redraw) {
  const st = s.settings, v = st.vault;
  const live = s.items().filter((i) => !i.deletedAt);
  const name = h('input', { class: 'input', value: v.name, placeholder: 'My vault', 'aria-label': 'Vault name', disabled: s.readOnly });
  const desc = h('textarea', { class: 'input', 'aria-label': 'Vault description', disabled: s.readOnly, style: 'min-height:60px' }); desc.value = v.description;
  const upd = () => save(s, { vault: { ...s.settings.vault, name: name.value.trim(), description: desc.value } }, () => toast('Saved'));
  name.addEventListener('change', upd); desc.addEventListener('change', upd);
  const folders = new Set(live.map((i) => i.folder).filter(Boolean)).size;
  const rows = [
    ['Items', `${live.length} (${s.items().length - live.length} in the trash)`],
    ['Folders', folders], ['With two-factor codes', live.filter((i) => i.fields.totp).length],
    ['Protected items', live.filter((i) => i.protected).length], ['Saved filters', st.savedFilters.length], ['Password policies', st.policies.length],
    ['Created', v.createdAt ? new Date(v.createdAt).toLocaleString() : 'before this information was recorded'],
    ['Master password last set', v.passwordChangedAt ? new Date(v.passwordChangedAt).toLocaleString() : 'unknown'],
    ['Last saved', s.lastSaved ? s.lastSaved.toLocaleString() : 'not in this session'],
    ['Stored', app.state.mode === 'desktop' ? 'On this computer' + (st.sync ? ', synced with ' + st.sync.url : '') : 'On ' + location.host + ', with a copy in this browser'],
    ['Format', `Keyhold vault v${s.envelope.v}; ${s.envelope.kdf.name}, ${s.envelope.kdf.iterations.toLocaleString()} rounds; AES-256-GCM`],
    ['Vault ID', s.envelope.id],
    ['Recovery code', s.envelope.keys.recovery ? 'Set' : 'Not set'],
  ];
  return [
    sec('Name and description', 'Shown here and in exports.', h('label', { class: 'field' }, h('span', { text: 'Name' }), name), h('label', { class: 'field' }, h('span', { text: 'Description' }), desc)),
    sec('Details', null, h('table', { class: 'table' }, rows.map(([k, val]) => h('tr', {}, h('th', { text: k }), h('td', { text: String(val) }))))),
  ];
}

async function mergeFile(app, s, close) {
  const f = await pickFile('.keyhold,.json,application/json');
  if (!f) return;
  let env;
  try { const j = JSON.parse(f.text); env = j.vault || j; if (env.format !== 'keyhold-vault') throw new Error(); }
  catch { return toast('That is not a Keyhold vault file.', { error: true }); }
  let payload;
  try { payload = await decryptPayload(env, s.keys.dataKey); }
  catch {
    const opened = await askPassword('Open the other vault', `Enter the master password of ${f.name}.`, (pw) => openVault(env, pw));
    if (!opened) return;
    payload = opened.payload; opened.keys.lock();
  }
  const before = new Set(Object.keys(s.payload.items));
  try { await s.change((p) => { const m = mergePayloads(p, payload); p.items = m.items; p.purged = m.purged; p.settings = { ...p.settings, folders: m.settings.folders, updatedAt: new Date().toISOString() }; }); }
  catch (e) { return app.fail(e); }
  const added = Object.keys(s.payload.items).filter((id) => !before.has(id)).length;
  close(); app.setFilter({ kind: 'all' });
  toast(`Merged ${f.name}: ${added} new item(s); items in both were brought up to date.`, { ms: 7000 });
}

/** Password Safe shows a report after an import; so does Keyhold. */
function showImportReport(res, name) {
  const r = importReport(res.items);
  return modal((close) => ({
    title: 'Import report',
    body: [h('p', { text: `${r.total} item(s) imported from ${name} (${res.kind}).` }),
      h('table', { class: 'table' },
        Object.entries(r.byType).map(([k, n]) => h('tr', {}, h('th', { text: TYPES[k].plural }), h('td', { text: n }))),
        h('tr', {}, h('th', { text: 'Folders' }), h('td', { text: r.folders })),
        h('tr', {}, h('th', { text: 'With two-factor keys' }), h('td', { text: r.withTotp })),
        h('tr', {}, h('th', { text: 'With password history' }), h('td', { text: r.withHistory })),
        h('tr', {}, h('th', { text: 'With extra fields' }), h('td', { text: r.withCustom })),
        r.withoutPassword ? h('tr', {}, h('th', { text: 'Logins without a password' }), h('td', { text: r.withoutPassword })) : null),
      h('p', { class: 'notice', text: `Delete ${name} now: it is not encrypted.` })],
    foot: h('button', { class: 'btn primary', type: 'button', onclick: () => close() }, 'Done'),
  }));
}

function secAbout(app, s) {
  const desktop = app.state.mode === 'desktop';
  return [
    sec('Keyhold', 'Everything is encrypted on this device with AES-256-GCM. The key comes from your master password through PBKDF2-SHA256 (600,000 rounds). Files and servers only ever hold encrypted data.'),
    sec('Items', null, h('table', { class: 'table' }, Object.entries(TYPES).map(([k, t]) => h('tr', {}, h('td', { text: t.plural }), h('td', { text: s.items().filter((i) => i.type === k && !i.deletedAt).length }))))),
    sec('Credits', 'Passphrase words: EFF Large Wordlist (CC BY 3.0 US). Breach check: Have I Been Pwned Pwned Passwords.'),
    desktop ? sec('Close Keyhold', 'Stops the Keyhold program on this computer. It also stops by itself a few minutes after its window closes.',
      h('button', { class: 'btn', type: 'button', onclick: async () => { app.lock('', true); await app.state.store.quit().catch(() => {}); document.body.textContent = 'Keyhold has stopped. You can close this window.'; } }, 'Quit Keyhold')) : null,
  ];
}
