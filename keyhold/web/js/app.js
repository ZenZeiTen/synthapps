// Keyhold app: start screens, unlock, and the main three-pane window.
import { h, icon, iconBtn, clear, fill, toast, modal, confirmBox, askPassword, pickFile, timeAgo } from './ui.js';
import {
  createVault, openVault, openVaultDerived, openVaultWithRecovery, deriveFromPassword, deriveFromRecovery,
  decryptPayload, WrongPasswordError,
} from './crypto.js';
import { TYPES, emptyPayload, newItem, subtitle, search, sortItems, folderTree, safeUrl, primaryKey, hostOf, cleanFolder, mergePayloads, healthReport } from './model.js';
import { DesktopStore, BrowserStore, RemoteClient, OfflineError, RemoteError } from './storage.js';
import { Session, NeedsPasswordError } from './session.js';
import { estimateStrength, loadWords } from './generator.js';
import { parseTotp, totpCode } from './totp.js';
import { openSettings, openGenerator, renderHealth, showRecoveryCode, chooseNewPassword } from './views.js';

const state = {
  mode: null, token: null, store: null, session: null, signup: 'closed',
  filter: { kind: 'all' }, selected: null, editing: null, query: '', sort: 'title', pane: 'list',
  revealed: new Set(), dict: null, totp: [], lastActive: Date.now(),
};
const root = () => document.getElementById('root');
export const app = { state, renderAll, select, copy, lock, strength, startEdit, setFilter, currentHealth, checkNewPassword };

// ---------- theme ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('keyhold.theme', t || 'system'); } catch { /* private mode */ }
}
app.applyTheme = applyTheme;

export function strength(pw) { return estimateStrength(pw, state.dict); }

// ---------- boot ----------
async function boot() {
  try { applyTheme(localStorage.getItem('keyhold.theme')); } catch { /* ignore */ }
  const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/);
  if (m) { sessionStorage.setItem('keyhold.token', m[1]); history.replaceState(null, '', location.pathname); }
  state.token = sessionStorage.getItem('keyhold.token');
  loadWords().then((w) => { state.dict = new Set(w); }).catch(() => {});
  let mode;
  try { mode = await fetch('/api/mode', { cache: 'no-store' }).then((r) => r.json()); }
  catch { mode = { mode: 'server', offline: true }; }
  state.mode = mode.mode;
  state.signup = mode.signup || 'closed';
  if (state.mode === 'desktop') {
    if (!state.token) return gateMessage('Open Keyhold from its shortcut', 'This page was opened without the key the Keyhold app gives its own window. Close it and start Keyhold again.');
    state.store = new DesktopStore(state.token);
    setInterval(() => { state.store.heartbeat().catch((e) => { if (e instanceof RemoteError && e.status === 401) disconnected(); }); }, 30000);
    state.store.heartbeat().catch(() => {});
    return desktopGate();
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    return gateMessage('A secure connection is needed', 'Browsers only allow encryption on HTTPS pages. Open this server with https://.');
  }
  gateSignIn();
}

async function desktopGate() {
  let rec;
  try { rec = await state.store.load(); }
  catch (e) { if (e instanceof RemoteError && e.status === 401) return disconnected(); return gateMessage('Could not read your vault', e.message); }
  rec ? gateUnlock(rec) : gateSetup();
}

function disconnected() {
  if (state.session) lock('', true);
  gateMessage('This window is no longer connected', 'Keyhold was closed or restarted. Start Keyhold again to continue. Your vault is saved.');
}

// ---------- start screens ----------
function gate(children, wide = false) {
  document.title = 'Keyhold';
  const r = clear(root());
  r.className = '';
  r.append(h('main', { class: 'gate' }, h('div', { class: 'gate-card' + (wide ? ' wide' : '') },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '' }), 'Keyhold'), children)));
  const f = r.querySelector('input'); if (f) f.focus();
}

function gateMessage(title, text) { gate([h('h1', { text: title }), h('p', { class: 'lead', text })]); }

function where() {
  return state.mode === 'desktop'
    ? h('div', { class: 'where' }, icon('device'), 'Stored encrypted on this computer')
    : h('div', { class: 'where' }, icon('cloud'), 'Encrypted on this device before it reaches ', location.host);
}

function pwField(label, opts = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: opts.autocomplete || 'current-password', required: true, 'aria-label': label, name: opts.name });
  const toggle = iconBtn('eye', 'Show password', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.replaceChildren(icon(show ? 'eye-off' : 'eye'));
  });
  const meter = opts.meter ? h('div', { class: 'meter', dataset: { score: '0' } }, h('i'), h('i'), h('i'), h('i'), h('i')) : null;
  const mlabel = opts.meter ? h('div', { class: 'meter-label', text: ' ' }) : null;
  if (meter) input.addEventListener('input', () => {
    const s = strength(input.value);
    meter.dataset.score = input.value ? s.score : '-1';
    mlabel.textContent = input.value ? `${s.label}${s.warnings[0] ? ' · ' + s.warnings[0] : ''}` : ' ';
  });
  return { input, el: h('label', { class: 'field' }, h('span', { text: label }), h('div', { class: 'input-row' }, input, toggle), meter, mlabel) };
}

function errBox() { return h('div', { class: 'error', role: 'alert' }); }

async function busy(btn, label, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

/** Shared rules for a new master password. Returns an error message or ''. */
async function checkNewPassword(pw, again) {
  if (pw !== again) return 'The two passwords are not the same.';
  if (pw.length < 10) return 'Use at least 10 characters. A few random words work well.';
  const s = strength(pw);
  if (s.score < 2) {
    const ok = await confirmBox('This master password is easy to guess', `${s.label}: ${s.warnings[0] || 'add more words or characters'}. Anyone who gets a copy of your vault file could try guesses offline. Use it anyway?`, { ok: 'Use it anyway', danger: true });
    if (!ok) return 'Choose a longer master password.';
  }
  return '';
}

function gateSetup() {
  const p1 = pwField('Master password', { autocomplete: 'new-password', meter: true });
  const p2 = pwField('Type it again', { autocomplete: 'new-password' });
  const rec = h('input', { type: 'checkbox', checked: true });
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Create vault');
  gate([
    h('h1', { text: 'Create your vault' }),
    h('p', { class: 'lead', text: 'One master password protects everything. Nobody, including Keyhold, can reset it, so pick one you will remember.' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        const msg = await checkNewPassword(p1.input.value, p2.input.value);
        if (msg) { err.textContent = msg; return; }
        await busy(btn, 'Creating…', async () => {
          const created = await createVault(p1.input.value, emptyPayload(), { recovery: rec.checked });
          const s = new Session({ envelope: created.envelope, keys: created.keys, payload: emptyPayload(), local: state.store });
          await s.saveLocal();
          if (created.recovery) await showRecoveryCode(created.recovery.code, true);
          enterApp(s);
          toast('Vault created. Moving from Password Safe? Settings › Import.', { ms: 7000 });
        }).catch((x) => { err.textContent = x.message; });
      },
    }, p1.el, p2.el,
    h('label', { class: 'check' }, rec, 'Create a recovery code in case I forget the master password'),
    err, btn),
    h('div', { class: 'links' }, h('button', { class: 'link', type: 'button', onclick: restoreBackupFile }, 'Open a backup file instead')),
    where(),
  ]);
}

async function restoreBackupFile() {
  const f = await pickFile('.keyhold,.json,application/json');
  if (!f) return;
  let env;
  try { const j = JSON.parse(f.text); env = j.vault || j; if (env.format !== 'keyhold-vault') throw new Error(); }
  catch { toast('That is not a Keyhold vault file.', { error: true }); return; }
  const opened = await askPassword('Open backup', `Enter the master password of ${f.name}.`, (pw) => openVault(env, pw));
  if (!opened) return;
  const cur = await state.store.load().catch(() => null);
  const s = new Session({ envelope: env, keys: opened.keys, payload: opened.payload, local: state.store, localRev: cur ? cur.rev : 0, meta: {} });
  if (opened.payload.settings && opened.payload.settings.sync) { s.remote = new RemoteClient(opened.payload.settings.sync.url); s.username = opened.payload.settings.sync.username; }
  await s.saveLocal();
  enterApp(s);
  toast('Backup opened and saved as your vault.');
}

function gateUnlock(rec) {
  const p = pwField('Master password');
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Unlock');
  gate([
    h('h1', { text: 'Unlock your vault' }),
    h('p', { class: 'lead', text: rec.savedAt ? 'Last saved ' + timeAgo(rec.savedAt) + '.' : '' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        await busy(btn, 'Unlocking…', async () => {
          const fresh = await state.store.load();
          const { payload, keys } = await openVault(fresh.vault, p.input.value);
          const s = new Session({ envelope: fresh.vault, keys, payload, local: state.store, localRev: fresh.rev, meta: fresh.meta });
          const sync = s.settings.sync;
          if (sync) { s.remote = new RemoteClient(sync.url); s.username = sync.username; }
          enterApp(s);
          if (s.remote) s.sync().catch(() => {});
        }).catch((x) => { err.textContent = x instanceof WrongPasswordError ? 'That master password is not correct.' : x.message; p.input.select(); });
      },
    }, p.el, err, btn),
    h('div', { class: 'links' }, rec.vault.keys.recovery ? h('button', { class: 'link', type: 'button', onclick: () => gateRecovery(rec) }, 'Forgot it? Use your recovery code') : null),
    where(),
  ]);
}

function recoveryField() {
  const input = h('input', { class: 'input mono', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', required: true });
  return { input, el: h('label', { class: 'field' }, h('span', { text: 'Recovery code' }), input) };
}

function gateRecovery(rec) {
  const c = recoveryField();
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Unlock with code');
  gate([
    h('h1', { text: 'Use your recovery code' }),
    h('p', { class: 'lead', text: 'After unlocking you will choose a new master password.' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        await busy(btn, 'Unlocking…', async () => {
          const { payload, keys } = await openVaultWithRecovery(rec.vault, c.input.value);
          const s = new Session({ envelope: rec.vault, keys, payload, local: state.store, localRev: rec.rev, meta: rec.meta, authKind: 'recovery' });
          const sync = s.settings.sync;
          if (sync) { s.remote = new RemoteClient(sync.url); s.username = sync.username; }
          await chooseNewPassword(s, true, app);
          enterApp(s);
        }).catch((x) => { err.textContent = x.message; });
      },
    }, c.el, err, btn),
    h('div', { class: 'links' }, h('button', { class: 'link', type: 'button', onclick: () => gateUnlock(rec) }, 'Back')),
  ]);
}

// ---------- hosted web app ----------
function lastUser() { try { return localStorage.getItem('keyhold.user') || ''; } catch { return ''; } }
function rememberUser(u) { try { localStorage.setItem('keyhold.user', u); } catch { /* ignore */ } }

function userField() {
  const input = h('input', { class: 'input', autocomplete: 'username', required: true, value: lastUser(), autocapitalize: 'none', spellcheck: 'false' });
  return { input, el: h('label', { class: 'field' }, h('span', { text: 'Username or email' }), input) };
}

function gateSignIn(msg) {
  const u = userField();
  const p = pwField('Master password');
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Unlock');
  gate([
    h('h1', { text: 'Sign in to your vault' }),
    msg ? h('p', { class: 'notice', text: msg }) : h('p', { class: 'lead', text: 'Works offline too, once this browser has opened your vault.' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        await busy(btn, 'Unlocking…', () => serverSignIn(u.input.value.trim().toLowerCase(), p.input.value))
          .catch((x) => { err.textContent = x instanceof WrongPasswordError ? 'Wrong username or master password.' : x.message; });
      },
    }, u.el, p.el, err, btn),
    h('div', { class: 'links' },
      state.signup !== 'closed' ? h('button', { class: 'link', type: 'button', onclick: gateRegister }, 'Create an account') : null,
      h('button', { class: 'link', type: 'button', onclick: gateServerRecovery }, 'Use a recovery code')),
    where(),
  ]);
  if (lastUser()) p.input.focus();
}

async function serverSignIn(u, pw) {
  const remote = new RemoteClient(location.origin);
  const local = new BrowserStore(u);
  const cached = await local.load().catch(() => null);
  let s;
  try {
    const pre = await remote.prelogin(u);
    const derived = await deriveFromPassword(pw, pre.kdf);
    try { await remote.login(u, derived.authKey); }
    catch (e) { if (e instanceof RemoteError && e.status === 401) throw new WrongPasswordError(); throw e; }
    const r = await remote.getVault();
    const opened = await openVaultDerived(r.vault, derived);
    s = new Session({ envelope: r.vault, keys: opened.keys, payload: opened.payload, local, localRev: cached ? cached.rev : 0, meta: { remoteRev: r.rev }, remote, username: u, serverMode: true });
    if (cached) {
      // Changes made here while offline are merged, then sent.
      try {
        const mine = await decryptPayload(cached.vault, opened.keys.dataKey);
        s.payload = mergePayloads(mine, opened.payload);
        s.meta.remoteRev = (cached.meta && cached.meta.remoteRev) || 0;
      } catch { /* the cached copy belongs to an older key; the server copy wins */ }
    }
    await s.saveLocal();
  } catch (e) {
    if (!(e instanceof OfflineError) || !cached) throw e;
    const opened = await openVault(cached.vault, pw);
    s = new Session({ envelope: cached.vault, keys: opened.keys, payload: opened.payload, local, localRev: cached.rev, meta: cached.meta, remote, username: u, serverMode: true });
    s.setStatus('offline', 'Offline. Changes are saved in this browser and will sync later.');
  }
  rememberUser(u);
  enterApp(s);
  s.sync().catch(() => {});
}

function gateRegister() {
  const u = userField(); u.input.value = '';
  const p1 = pwField('Master password', { autocomplete: 'new-password', meter: true });
  const p2 = pwField('Type it again', { autocomplete: 'new-password' });
  const inv = h('input', { class: 'input', autocomplete: 'off' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Create account');
  gate([
    h('h1', { text: 'Create an account' }),
    h('p', { class: 'lead', text: 'Your vault is encrypted in this browser. The server only stores data it cannot read, and cannot reset your master password.' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        const msg = await checkNewPassword(p1.input.value, p2.input.value);
        if (msg) { err.textContent = msg; return; }
        await busy(btn, 'Creating…', async () => {
          const user = u.input.value.trim().toLowerCase();
          const created = await createVault(p1.input.value, emptyPayload());
          const remote = new RemoteClient(location.origin);
          const res = await remote.register({ username: user, authKey: created.keys.authKey, recoveryAuthKey: created.recovery.authKey, kdf: created.envelope.kdf, vault: created.envelope, invite: inv.value || undefined });
          const local = new BrowserStore(user);
          await local.remove().catch(() => {});
          const s = new Session({ envelope: created.envelope, keys: created.keys, payload: emptyPayload(), local, meta: { remoteRev: res.rev }, remote, username: user, serverMode: true });
          await s.saveLocal();
          rememberUser(user);
          await showRecoveryCode(created.recovery.code, true);
          enterApp(s);
          s.setStatus('synced');
        }).catch((x) => { err.textContent = x.message; });
      },
    }, u.el, p1.el, p2.el,
    state.signup === 'invite' ? h('label', { class: 'field' }, h('span', { text: 'Invite code' }), inv) : null,
    err, btn),
    h('div', { class: 'links' }, h('button', { class: 'link', type: 'button', onclick: () => gateSignIn() }, 'I already have an account')),
  ]);
}

function gateServerRecovery() {
  const u = userField();
  const c = recoveryField();
  const err = errBox();
  const btn = h('button', { class: 'btn primary wide', type: 'submit' }, 'Unlock with code');
  gate([
    h('h1', { text: 'Use your recovery code' }),
    h('p', { class: 'lead', text: 'After unlocking you will choose a new master password.' }),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        await busy(btn, 'Unlocking…', async () => {
          const user = u.input.value.trim().toLowerCase();
          const derived = await deriveFromRecovery(c.input.value);
          const remote = new RemoteClient(location.origin);
          try { await remote.login(user, derived.authKey, 'recovery'); }
          catch (x) { if (x instanceof RemoteError && x.status === 401) throw new Error('That username and recovery code do not match.'); throw x; }
          const r = await remote.getVault();
          const opened = await openVaultDerived(r.vault, derived, 'recovery');
          const local = new BrowserStore(user);
          const cached = await local.load().catch(() => null);
          const s = new Session({ envelope: r.vault, keys: opened.keys, payload: opened.payload, local, localRev: cached ? cached.rev : 0, meta: { remoteRev: r.rev }, remote, username: user, authKind: 'recovery', serverMode: true });
          await chooseNewPassword(s, true, app);
          rememberUser(user);
          enterApp(s);
        }).catch((x) => { err.textContent = x.message; });
      },
    }, u.el, c.el, err, btn),
    h('div', { class: 'links' }, h('button', { class: 'link', type: 'button', onclick: () => gateSignIn() }, 'Back')),
  ]);
}

// ---------- locking ----------
let clipTimer = null, clipPending = false, autoLockTimer = null, totpTimer = null;

function lock(reason = 'Locked', silent = false) {
  const s = state.session;
  if (!s) return;
  const user = s.username;
  s.lock();
  state.session = null; state.editing = null; state.selected = null; state.revealed.clear(); state.totp = [];
  clearInterval(autoLockTimer); clearInterval(totpTimer);
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  clearClipboard();
  if (silent) return;
  if (reason) toast(reason);
  if (state.mode === 'desktop') desktopGate();
  else { if (user) rememberUser(user); gateSignIn(); }
}

['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'].forEach((ev) =>
  addEventListener(ev, () => { state.lastActive = Date.now(); }, { passive: true, capture: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.session && state.session.settings.lockOnHide) lock('Locked when the window was hidden');
});
addEventListener('focus', () => { if (clipPending) clearClipboard(); });
addEventListener('online', () => { if (state.session) state.session.sync().catch(() => {}); });

async function copy(text, label = 'Copied') {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const secs = state.session ? state.session.settings.clipboardSeconds : 30;
  toast(secs ? `${label} copied · clipboard clears in ${secs} s` : `${label} copied`);
  clearTimeout(clipTimer);
  if (secs) clipTimer = setTimeout(clearClipboard, secs * 1000);
}
async function clearClipboard() {
  clearTimeout(clipTimer);
  try { await navigator.clipboard.writeText(' '); clipPending = false; } catch { clipPending = true; }
}

// ---------- main window ----------
function enterApp(s) {
  state.session = s;
  state.filter = { kind: 'all' }; state.selected = null; state.editing = null; state.query = '';
  state.pane = 'list';
  state.lastActive = Date.now();
  applyTheme(s.settings.theme);
  s.on((what) => {
    if (what === 'changed') renderAll();
    if (what === 'status') renderSync();
  });
  buildShell();
  renderAll();
  autoLockTimer = setInterval(() => {
    const m = state.session && state.session.settings.autoLockMinutes;
    if (m > 0 && Date.now() - state.lastActive > m * 60000) lock('Locked after ' + m + ' minutes without activity');
  }, 5000);
  totpTimer = setInterval(tickTotp, 1000);
  setInterval(() => { if (state.session && state.session.remote) state.session.sync().catch(() => {}); }, 5 * 60000);
}

let els = {};
function buildShell() {
  document.title = 'Keyhold';
  const q = h('input', { class: 'input', id: 'q', type: 'search', placeholder: 'Search', autocomplete: 'off', 'aria-label': 'Search the vault', value: state.query });
  q.addEventListener('input', () => { state.query = q.value; state.pane = 'list'; renderList(); renderPane(); });
  els = {
    q,
    sidebar: h('nav', { class: 'sidebar', 'aria-label': 'Sections' }),
    list: h('div', { class: 'list', role: 'listbox', 'aria-label': 'Items' }),
    listTitle: h('h2'),
    detail: h('section', { class: 'detail-pane', 'aria-live': 'polite' }),
    sync: h('button', { class: 'sync-pill', type: 'button', onclick: onSyncPill }),
  };
  const sortSel = h('select', { class: 'input', 'aria-label': 'Sort', onchange: (e) => { state.sort = e.target.value; renderList(); } },
    h('option', { value: 'title' }, 'Name'), h('option', { value: 'updated' }, 'Recently changed'));
  sortSel.value = state.sort;
  els.app = h('div', { class: 'app', dataset: { pane: state.pane } },
    h('header', { class: 'topbar' },
      iconBtn('menu', 'Sections', () => { state.pane = 'nav'; renderPane(); }, { class: 'mob' }),
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '' }), h('span', { text: 'Keyhold' })),
      h('div', { class: 'search' }, icon('search'), q, h('kbd', { text: '/' })),
      h('div', { class: 'spacer' }),
      els.sync,
      h('button', { class: 'btn primary', type: 'button', onclick: () => chooseType(), title: 'New item (N)', 'aria-label': 'New item' }, icon('plus'), h('span', { text: 'New' })),
      iconBtn('settings', 'Settings', () => openSettings(app)),
      iconBtn('lock', 'Lock (Ctrl+Shift+L)', () => lock())),
    els.sidebar,
    h('section', { class: 'list-pane' },
      h('div', { class: 'list-head' }, iconBtn('back', 'Sections', () => { state.pane = 'nav'; renderPane(); }, { class: 'mob' }), els.listTitle, sortSel),
      els.list),
    els.detail);
  fill(root(), els.app);
  root().className = '';
}

function renderPane() { if (els.app) els.app.dataset.pane = state.pane; }

function renderAll() {
  if (!state.session) return;
  renderSidebar(); renderList(); renderDetail(); renderSync(); renderPane();
}

function setFilter(f) {
  state.filter = f; state.editing = null;
  state.pane = 'list';
  const vis = visibleItems();
  if (!vis.find((i) => i.id === state.selected)) state.selected = null;
  renderAll();
}

function liveItems() { return state.session.items().filter((i) => !i.deletedAt); }

function visibleItems() {
  const f = state.filter;
  let items = f.kind === 'trash' ? state.session.items().filter((i) => i.deletedAt) : liveItems();
  if (f.kind === 'fav') items = items.filter((i) => i.favorite);
  if (f.kind === 'type') items = items.filter((i) => i.type === f.type);
  if (f.kind === 'folder') items = items.filter((i) => i.folder === f.path || i.folder.startsWith(f.path + '/'));
  if (f.kind === 'tag') items = items.filter((i) => i.tags.includes(f.tag));
  if (f.kind === 'health') items = [];
  items = search(items, state.query);
  const sorted = sortItems(items, state.sort);
  return state.sort === 'title' ? [...sorted.filter((i) => i.favorite), ...sorted.filter((i) => !i.favorite)] : sorted;
}

function filterTitle() {
  const f = state.filter;
  if (state.query) return 'Search results';
  return { all: 'All items', fav: 'Favorites', trash: 'Trash', health: 'Password health' }[f.kind]
    || (f.kind === 'type' ? TYPES[f.type].plural : f.kind === 'folder' ? f.path.split('/').pop() : '#' + f.tag);
}

function navLink(label, ic, filt, count, { badge, depth = 0 } = {}) {
  const f = state.filter;
  const active = f.kind === filt.kind && f.type === filt.type && f.path === filt.path && f.tag === filt.tag;
  return h('a', {
    class: active ? 'active' : '', href: '#', role: 'button', style: depth ? `padding-left:${10 + depth * 14}px` : null,
    'aria-current': active ? 'true' : null,
    onclick: (e) => { e.preventDefault(); state.query = ''; els.q.value = ''; setFilter(filt); },
  }, icon(ic), h('span', { class: 'name', text: label }),
  badge ? h('span', { class: 'badge', text: badge }) : count != null ? h('span', { class: 'n', text: count }) : null);
}

let healthCache = { key: '', report: null };
export function currentHealth() {
  const items = liveItems();
  const key = items.length + ':' + items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), '') + ':' + !!state.dict;
  if (healthCache.key !== key) healthCache = { key, report: healthReport(items, strength) };
  return healthCache.report;
}

function renderSidebar() {
  const live = liveItems();
  const trash = state.session.items().length - live.length;
  const byType = {};
  for (const i of live) byType[i.type] = (byType[i.type] || 0) + 1;
  const folders = folderTree(live, state.session.settings.folders);
  const tags = [...new Set(live.flatMap((i) => i.tags))].sort();
  const hr = currentHealth();
  const problems = hr.weak.length + hr.reused.reduce((n, g) => n + g.length, 0) + hr.breached.length;
  fill(els.sidebar, h('div', { class: 'nav' },
    navLink('All items', 'all', { kind: 'all' }, live.length),
    navLink('Favorites', 'star', { kind: 'fav' }, live.filter((i) => i.favorite).length),
    h('div', { class: 'nav-h' }, 'Types'),
    Object.entries(TYPES).filter(([k]) => byType[k] || k === 'login' || k === 'note' || k === 'card')
      .map(([k, t]) => navLink(t.plural, t.icon, { kind: 'type', type: k }, byType[k] || 0)),
    h('div', { class: 'nav-h' }, 'Folders', iconBtn('plus', 'New folder', newFolder)),
    folders.length ? folders.map((f) => navLink(f.name, 'folder', { kind: 'folder', path: f.path }, f.count || null, { depth: f.depth }))
      : h('div', { class: 'small muted', style: 'padding:2px 10px', text: 'No folders yet' }),
    tags.length ? [h('div', { class: 'nav-h' }, 'Tags'), tags.map((t) => navLink(t, 'tag', { kind: 'tag', tag: t }))] : null,
    h('div', { class: 'nav-h' }, 'Security'),
    navLink('Password health', 'shield', { kind: 'health' }, null, { badge: problems || null }),
    navLink('Trash', 'trash', { kind: 'trash' }, trash || null),
  ));
}

async function newFolder() {
  const name = await modal((close) => {
    const input = h('input', { class: 'input', autofocus: true, placeholder: 'Work/Clients' });
    return {
      title: 'New folder',
      body: h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value); } },
        h('label', { class: 'field' }, h('span', { text: 'Name (use / for a folder inside another)' }), input)),
      foot: [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: () => close(input.value) }, 'Create')],
    };
  });
  const path = name && cleanFolder(name);
  if (!path) return;
  await state.session.updateSettings({ folders: [...new Set([...(state.session.settings.folders || []), path])] });
  setFilter({ kind: 'folder', path });
}

function tileFor(it) {
  const t = TYPES[it.type];
  const host = it.type === 'login' && hostOf(it.fields.url);
  return h('div', { class: 'tile', 'aria-hidden': 'true' }, host ? host.replace(/^www\./, '')[0].toUpperCase() : icon(t.icon));
}

function renderList() {
  els.listTitle.textContent = filterTitle();
  const items = visibleItems();
  const list = clear(els.list);
  if (state.filter.kind === 'health' && !state.query) {
    list.append(h('div', { class: 'empty' }, icon('shield'), h('div', { text: 'The report is on the right.' })));
    return;
  }
  if (!items.length) {
    const none = !liveItems().length && state.filter.kind === 'all' && !state.query;
    list.append(h('div', { class: 'empty' }, icon(state.filter.kind === 'trash' ? 'trash' : 'search'),
      h('div', { text: none ? 'Your vault is empty.' : state.filter.kind === 'trash' ? 'Trash is empty.' : 'Nothing here.' }),
      none ? h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'button', onclick: () => chooseType() }, icon('plus'), 'Add your first item'),
        ' ', h('button', { class: 'btn', type: 'button', onclick: () => openSettings(app, 'backup') }, icon('upload'), 'Import')) : null));
    return;
  }
  if (state.filter.kind === 'trash') {
    list.append(h('div', { style: 'padding:0 6px 8px' }, h('button', { class: 'btn danger', type: 'button', onclick: emptyTrash }, icon('trash'), 'Empty trash')));
  }
  for (const it of items) {
    list.append(h('div', {
      class: 'row' + (it.id === state.selected ? ' sel' : ''), role: 'option', tabindex: '0', 'aria-selected': String(it.id === state.selected),
      dataset: { id: it.id }, onclick: () => select(it.id), onkeydown: (e) => { if (e.key === 'Enter') select(it.id); },
    }, tileFor(it), h('div', { class: 'txt' }, h('div', { class: 't', text: it.title }), h('div', { class: 's', text: subtitle(it) || TYPES[it.type].label })),
    it.favorite ? h('span', { class: 'fav', title: 'Favorite' }, icon('star')) : null));
  }
}

function select(id) {
  state.selected = id; state.editing = null; state.revealed.clear();
  if (state.filter.kind === 'health') state.filter = { kind: 'all' };
  state.pane = 'detail';
  renderList(); renderDetail(); renderPane(); renderSidebar();
  const row = els.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

async function emptyTrash() {
  const ids = state.session.items().filter((i) => i.deletedAt).map((i) => i.id);
  if (!ids.length) return;
  if (!(await confirmBox('Empty trash?', `${ids.length} item(s) will be deleted for good on every device. Earlier versions stay in the backups.`, { ok: 'Delete for good', danger: true }))) return;
  await state.session.purge(ids);
  state.selected = null;
  toast('Trash emptied');
}

// ---------- detail ----------
function renderDetail() {
  state.totp = [];
  const pane = clear(els.detail);
  if (state.editing) return pane.append(editForm());
  if (state.filter.kind === 'health' && !state.query) return pane.append(renderHealth(app));
  const it = state.selected && state.session.payload.items[state.selected];
  if (!it) {
    pane.append(h('div', { class: 'empty', style: 'padding-top:18vh' }, icon('lock'),
      h('div', { text: liveItems().length ? 'Select an item, or press / to search.' : 'Add a login, card, note or anything else you want to keep safe.' }),
      h('div', { class: 'small', style: 'margin-top:10px' }, h('kbd', { text: '/' }), ' search  ', h('kbd', { text: 'N' }), ' new  ', h('kbd', { text: 'Ctrl+Shift+L' }), ' lock')));
    return;
  }
  const t = TYPES[it.type];
  const trashMode = !!it.deletedAt;
  const fav = iconBtn('star', it.favorite ? 'Remove from favorites' : 'Add to favorites', () => state.session.patchItem(it.id, { favorite: !it.favorite }), { class: it.favorite ? 'on' : '' });
  const actions = trashMode
    ? [h('button', { class: 'btn', type: 'button', onclick: () => state.session.restore(it.id).then(() => toast('Restored')) }, icon('history'), 'Restore'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (await confirmBox('Delete for good?', `"${it.title}" will be removed from every device.`, { ok: 'Delete', danger: true })) { await state.session.purge(it.id); state.selected = null; renderAll(); }
      } }, icon('trash'), 'Delete for good')]
    : [fav, h('button', { class: 'btn', type: 'button', onclick: () => startEdit(it) }, icon('edit'), 'Edit'),
      iconBtn('copy', 'Duplicate', () => { const copyIt = newItem(it.type, { ...structuredClone(it), id: undefined, title: it.title + ' (copy)', history: [] }); startEdit(copyIt, true); }),
      iconBtn('trash', 'Move to trash', async () => { await state.session.trash(it.id); toast('Moved to trash', { action: { label: 'Undo', fn: () => state.session.restore(it.id) } }); state.selected = null; state.pane = 'list'; renderAll(); })];

  const rows = [];
  for (const f of t.fields) {
    const v = it.fields[f.key];
    if (!v) continue;
    rows.push(fieldRow(it, f, v));
  }
  for (const [i, c] of it.custom.entries()) {
    if (!c.name && !c.value) continue;
    rows.push(fieldRow(it, { key: 'custom:' + i, label: c.name || 'Field', kind: c.hidden ? 'secret' : 'text', copy: true }, c.value));
  }
  const expired = it.expiresAt && Date.parse(it.expiresAt) < Date.now();
  pane.append(h('article', { class: 'detail' },
    h('div', { class: 'd-head' },
      iconBtn('back', 'Back to list', () => { state.pane = 'list'; renderPane(); }, { class: 'mob' }),
      h('div', { class: 'tile' }, icon(t.icon)),
      h('div', { class: 'grow' }, h('h1', { text: it.title }),
        h('div', { class: 'meta' }, h('span', { text: t.label }),
          it.folder ? h('span', { class: 'chip' }, icon('folder'), it.folder) : null,
          it.tags.map((g) => h('span', { class: 'chip' }, icon('tag'), g)))),
      h('div', { class: 'd-actions' }, actions)),
    trashMode ? h('p', { class: 'notice', text: 'This item is in the trash.' }) : null,
    expired ? h('p', { class: 'notice', text: 'This item expired on ' + new Date(it.expiresAt).toLocaleDateString() + '. Time to change it.' }) : null,
    it.breach && it.breach.count ? h('p', { class: 'notice', text: `This password appears in ${it.breach.count.toLocaleString()} known data breaches. Change it.` }) : null,
    rows.length ? h('div', { class: 'card' }, rows) : null,
    it.notes ? h('div', { class: 'card' }, h('h3', { text: 'Notes' }), h('div', { class: 'notes', text: it.notes })) : null,
    it.history.length ? h('div', { class: 'card' }, h('details', { class: 'hist' }, h('summary', { text: `Previous values (${it.history.length})` }),
      it.history.map((hh, i) => fieldRow(it, { key: 'hist:' + i, label: new Date(hh.changedAt).toLocaleString() + (hh.note ? ' · ' + hh.note : ''), kind: 'secret', copy: true }, hh.value)))) : null,
    h('div', { class: 'foot-meta' }, h('span', { text: 'Created ' + new Date(it.createdAt).toLocaleString() }), h('span', { text: 'Changed ' + timeAgo(it.updatedAt) }),
      primaryKey(it.type) && it.fields[primaryKey(it.type)] ? h('span', { text: 'Secret set ' + timeAgo(it.passwordChangedAt) }) : null),
  ));
}

function fieldRow(it, f, v) {
  const id = it.id + ':' + f.key;
  if (f.kind === 'totp') {
    let cfg = null, bad = '';
    try { cfg = parseTotp(v); } catch (e) { bad = e.message; }
    const code = h('span', { class: 'code', text: bad ? '' : '······' });
    const ring = h('span', { class: 'ring' });
    if (cfg) state.totp.push({ cfg, code, ring });
    return h('div', { class: 'frow' }, h('div', { class: 'fl' }, h('div', { class: 'lab', text: f.label }),
      bad ? h('div', { class: 'val', text: bad }) : h('div', { class: 'totp' }, code, ring)),
    h('div', { class: 'tools' }, cfg ? iconBtn('copy', 'Copy code', async () => copy((await totpCode(cfg)).code, 'Code')) : null));
  }
  const secret = f.kind === 'secret';
  const shown = !secret || state.revealed.has(id);
  let val;
  if (f.kind === 'url' && safeUrl(v)) val = h('div', { class: 'val' }, h('a', { href: safeUrl(v), target: '_blank', rel: 'noopener noreferrer' }, v));
  else val = h('div', { class: 'val' + (secret ? ' secret' : '') + (f.multiline ? ' mono' : ''), text: shown ? v : '•'.repeat(Math.min(12, Math.max(8, v.length))) });
  let st = null;
  if (f.key === 'password' || (f.primary && f.generate)) {
    const s = strength(v);
    st = h('span', { class: 'strength-tag', style: `color:var(--s${s.score})`, text: ' · ' + s.label });
  }
  return h('div', { class: 'frow' },
    h('div', { class: 'fl' }, h('div', { class: 'lab' }, f.label, st), val),
    h('div', { class: 'tools' },
      secret ? iconBtn(shown ? 'eye-off' : 'eye', shown ? 'Hide' : 'Show', () => { shown ? state.revealed.delete(id) : state.revealed.add(id); renderDetail(); }) : null,
      f.kind === 'url' && safeUrl(v) ? iconBtn('external', 'Open website', () => window.open(safeUrl(v), '_blank', 'noopener,noreferrer')) : null,
      f.copy ? iconBtn('copy', 'Copy ' + f.label.toLowerCase(), () => copy(v, f.label)) : null));
}

async function tickTotp() {
  for (const t of state.totp) {
    if (!t.code.isConnected) continue;
    const r = await totpCode(t.cfg);
    t.code.textContent = r.code.replace(/^(\d{3})(\d+)$/, '$1 $2');
    t.ring.style.setProperty('--p', String(r.remaining / r.period));
    t.ring.classList.toggle('low', r.remaining <= 5);
  }
}

// ---------- create / edit ----------
async function chooseType(type) {
  if (!type) {
    type = await modal((close) => ({
      title: 'New item',
      body: h('div', { class: 'nav', style: 'display:grid;grid-template-columns:1fr 1fr;gap:4px;padding-bottom:12px' },
        Object.entries(TYPES).map(([k, t]) => h('a', { href: '#', role: 'button', onclick: (e) => { e.preventDefault(); close(k); } }, icon(t.icon), t.label))),
    }));
    if (!type) return;
  }
  const f = state.filter;
  const it = newItem(type, { folder: f.kind === 'folder' ? f.path : '', favorite: f.kind === 'fav', tags: f.kind === 'tag' ? [f.tag] : [] });
  startEdit(it, true);
}

function startEdit(item, isNew = false) {
  state.editing = { draft: structuredClone(item), isNew };
  state.pane = 'detail';
  renderDetail(); renderPane();
  const first = els.detail.querySelector('input');
  if (first) first.focus();
}

function editForm() {
  const { draft, isNew } = state.editing;
  const t = TYPES[draft.type];
  const err = errBox();
  const title = h('input', { class: 'input', value: draft.title, placeholder: t.label + ' name', 'aria-label': 'Name' });
  const inputs = {};
  const fieldEls = t.fields.map((f) => {
    const v = draft.fields[f.key] || '';
    let input;
    if (f.kind === 'select') {
      input = h('select', { class: 'input' }, h('option', { value: '' }, '—'), f.options.map((o) => h('option', { value: o }, o)));
      input.value = v;
    } else if (f.kind === 'multiline' || f.multiline) {
      input = h('textarea', { class: 'input mono', spellcheck: 'false' }); input.value = v;
    } else {
      input = h('input', {
        class: 'input' + (f.kind === 'secret' || f.kind === 'totp' ? ' mono' : ''), value: v, spellcheck: 'false',
        type: f.kind === 'secret' ? 'password' : f.kind === 'date' ? 'date' : 'text',
        inputmode: f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : null,
        autocomplete: f.kind === 'secret' ? 'new-password' : 'off',
        placeholder: f.kind === 'totp' ? 'Secret key or otpauth:// link' : f.kind === 'url' ? 'https://' : null,
      });
    }
    input.setAttribute('aria-label', f.label);
    inputs[f.key] = input;
    const tools = [];
    if (f.kind === 'secret' && !f.multiline) {
      const eye = iconBtn('eye', 'Show', () => { const s = input.type === 'password'; input.type = s ? 'text' : 'password'; eye.replaceChildren(icon(s ? 'eye-off' : 'eye')); });
      tools.push(eye);
    }
    if (f.generate) tools.push(iconBtn('dice', 'Generate', async () => {
      const v2 = await openGenerator(app);
      if (v2) { input.value = v2; input.type = 'text'; input.dispatchEvent(new Event('input')); }
    }));
    let meter = null, mlabel = null;
    if (f.generate && f.primary) {
      meter = h('div', { class: 'meter', dataset: { score: '-1' } }, h('i'), h('i'), h('i'), h('i'), h('i'));
      mlabel = h('div', { class: 'meter-label', text: ' ' });
      const upd = () => { const s = strength(input.value); meter.dataset.score = input.value ? s.score : '-1'; mlabel.textContent = input.value ? s.label + (s.warnings[0] ? ' · ' + s.warnings[0] : '') : ' '; };
      input.addEventListener('input', upd); upd();
    }
    return h('label', { class: 'field' }, h('span', { text: f.label }), tools.length ? h('div', { class: 'input-row' }, input, tools) : input, meter, mlabel);
  });

  const folders = folderTree(liveItems(), state.session.settings.folders).map((f) => f.path);
  const folder = h('input', { class: 'input', value: draft.folder, list: 'folders-dl', placeholder: 'None', 'aria-label': 'Folder' });
  const tags = h('input', { class: 'input', value: draft.tags.join(', '), placeholder: 'Comma separated', 'aria-label': 'Tags' });
  const notes = h('textarea', { class: 'input', 'aria-label': 'Notes' }); notes.value = draft.notes;
  const expires = h('input', { class: 'input', type: 'date', value: draft.expiresAt ? draft.expiresAt.slice(0, 10) : '' });
  const favorite = h('input', { type: 'checkbox', checked: draft.favorite });
  const customBox = h('div');
  const custom = draft.custom.map((c) => ({ ...c }));
  const drawCustom = () => {
    fill(customBox, custom.map((c, i) => {
      const n = h('input', { class: 'input', value: c.name, placeholder: 'Name', oninput: (e) => { c.name = e.target.value; } });
      const v = h('input', { class: 'input' + (c.hidden ? ' mono' : ''), value: c.value, placeholder: 'Value', type: c.hidden ? 'password' : 'text', autocomplete: 'off', oninput: (e) => { c.value = e.target.value; } });
      return h('div', { class: 'custom-row' }, n, v,
        iconBtn(c.hidden ? 'eye-off' : 'eye', c.hidden ? 'Hidden field (click to make visible)' : 'Visible field (click to hide)', () => { c.hidden = !c.hidden; drawCustom(); }),
        iconBtn('x', 'Remove field', () => { custom.splice(i, 1); drawCustom(); }));
    }), h('button', { class: 'btn ghost', type: 'button', onclick: () => { custom.push({ name: '', value: '', hidden: false }); drawCustom(); } }, icon('plus'), 'Add field'));
  };
  drawCustom();

  const save = async (e) => {
    e && e.preventDefault();
    err.textContent = '';
    const fields = {};
    for (const [k, inp] of Object.entries(inputs)) if (inp.value.trim() !== '') fields[k] = inp.value.trim() === inp.value || TYPES[draft.type].fields.find((x) => x.key === k).kind === 'secret' ? inp.value : inp.value.trim();
    if (fields.totp) { try { parseTotp(fields.totp); } catch (x) { err.textContent = 'Two-factor code: ' + x.message; return; } }
    const name = title.value.trim() || (draft.type === 'login' && hostOf(fields.url || '')) || (draft.type === 'wifi' && fields.ssid) || '';
    if (!name) { err.textContent = 'Give it a name.'; title.focus(); return; }
    const item = {
      ...draft, title: name, fields, folder: cleanFolder(folder.value), favorite: favorite.checked,
      tags: tags.value.split(',').map((x) => x.trim()).filter(Boolean), notes: notes.value,
      custom: custom.filter((c) => c.name || c.value), expiresAt: expires.value ? new Date(expires.value + 'T00:00:00').toISOString() : null,
    };
    try {
      await state.session.upsert(item);
      state.editing = null; state.selected = item.id;
      if (state.filter.kind === 'trash' || state.filter.kind === 'health') state.filter = { kind: 'all' };
      renderAll();
      toast(isNew ? 'Added' : 'Saved');
    } catch (x) { err.textContent = x.message; }
  };
  const cancel = () => { state.editing = null; if (!state.selected) state.pane = 'list'; renderDetail(); renderPane(); };

  return h('form', { class: 'form', onsubmit: save, onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } if ((e.ctrlKey || e.metaKey) && e.key === 's') save(e); } },
    h('h1', { text: (isNew ? 'New ' : 'Edit ') + t.label.toLowerCase() }),
    h('div', { class: 'card' }, h('label', { class: 'field' }, h('span', { text: 'Name' }), title), fieldEls),
    h('div', { class: 'card' },
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { text: 'Folder' }), folder, h('datalist', { id: 'folders-dl' }, folders.map((f) => h('option', { value: f })))),
        h('label', { class: 'field' }, h('span', { text: 'Tags' }), tags)),
      h('label', { class: 'field' }, h('span', { text: 'Notes' }), notes),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { text: 'Reminder to change it on' }), expires),
        h('label', { class: 'check', style: 'margin-top:22px' }, favorite, 'Favorite'))),
    h('div', { class: 'card' }, h('h3', { text: 'More fields', style: 'padding:0 0 10px' }), customBox),
    err,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, icon('check'), 'Save')));
}

// ---------- sync indicator ----------
function renderSync() {
  const s = state.session;
  if (!s || !els.sync) return;
  const st = s.remote ? s.status.state : 'local';
  const label = { local: 'On this device', idle: 'Sync', pending: 'Waiting to sync', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync problem', 'needs-password': 'Sign in again' }[st] || st;
  els.sync.dataset.state = st;
  els.sync.title = s.status.message || (st === 'local' ? 'Your vault is stored on this computer only. Add a sync server in Settings to use it on other devices.' : 'Click to sync now');
  els.sync.replaceChildren(icon(st === 'local' ? 'device' : st === 'offline' || st === 'error' ? 'cloud-off' : 'cloud'), h('span', { class: 'lbl', text: label }));
}

async function onSyncPill() {
  const s = state.session;
  if (!s.remote) return openSettings(app, 'sync');
  if (s.status.state === 'needs-password') {
    const ok = await askPassword('Sign in again', s.status.message, (pw) => s.relogin(pw).catch((e) => { if (e instanceof WrongPasswordError) throw new Error('That password is not correct.'); throw e; }));
    if (ok) toast('Synced');
    return;
  }
  s.sync().then(() => toast('Synced')).catch((e) => toast(e instanceof NeedsPasswordError ? e.message : e.message, { error: !(e instanceof OfflineError) }));
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!state.session) return;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); return; }
  if (document.querySelector('dialog[open]')) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape' && document.activeElement === els.q) { els.q.value = ''; state.query = ''; els.q.blur(); renderList(); renderDetail(); }
    if (e.key === 'ArrowDown' && document.activeElement === els.q) { e.preventDefault(); moveSel(1); }
    return;
  }
  if (state.editing) return;
  if (e.key === '/') { e.preventDefault(); els.q.focus(); els.q.select(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); chooseType(); }
  else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSel(1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveSel(-1); }
  else if (e.key === 'e' && state.selected) { const it = state.session.payload.items[state.selected]; if (it && !it.deletedAt) startEdit(it); }
  else if (e.key === 'c' && state.selected) { const it = state.session.payload.items[state.selected]; const pk = it && primaryKey(it.type); if (pk && it.fields[pk]) copy(it.fields[pk], TYPES[it.type].fields.find((f) => f.key === pk).label); }
  else if (e.key === 'u' && state.selected) { const it = state.session.payload.items[state.selected]; if (it && it.fields.username) copy(it.fields.username, 'Username'); }
});

function moveSel(d) {
  const items = visibleItems();
  if (!items.length) return;
  const i = items.findIndex((x) => x.id === state.selected);
  const next = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + d))];
  select(next.id);
  const row = els.list.querySelector(`[data-id="${CSS.escape(next.id)}"]`);
  if (row) row.focus();
}

boot();
