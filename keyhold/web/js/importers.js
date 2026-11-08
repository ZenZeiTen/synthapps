// Bring entries in from Password Safe (XML or text export) and from CSV files
// written by other password managers and browsers; write CSV back out.
import { newItem, cleanFolder, TYPES } from './model.js';

// ---------- a small, strict XML reader (no DTDs, no external entities) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
}

/** Parse XML text into { name, attrs, children, text } nodes. */
export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0) throw new Error('Unclosed CDATA');
      top().text += src.slice(i + 9, j); i = j + 3;
    } else if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i); if (j < 0) throw new Error('Unclosed comment'); i = j + 3;
    } else if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i); if (j < 0) throw new Error('Bad XML'); i = j + 2;
    } else if (src.startsWith('<!', i)) {
      throw new Error('XML files with a DOCTYPE are not accepted');
    } else if (src[i] === '<') {
      const j = src.indexOf('>', i);
      if (j < 0) throw new Error('Bad XML');
      let tag = src.slice(i + 1, j);
      i = j + 1;
      if (tag[0] === '/') {
        const name = tag.slice(1).trim();
        const n = stack.pop();
        if (!n || n.name !== name) throw new Error('Mismatched tag </' + name + '>');
        continue;
      }
      const selfClose = tag.endsWith('/');
      if (selfClose) tag = tag.slice(0, -1);
      const m = tag.match(/^([^\s]+)/);
      const node = { name: m[1], attrs: {}, children: [], text: '' };
      for (const a of tag.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4]);
      top().children.push(node);
      if (!selfClose) stack.push(node);
    } else {
      const j = src.indexOf('<', i);
      const end = j < 0 ? src.length : j;
      top().text += decodeEntities(src.slice(i, end));
      i = end;
    }
  }
  if (stack.length !== 1) throw new Error('The XML file is incomplete');
  return root;
}
const child = (n, name) => n.children.find((c) => c.name === name);
const textOf = (n, name) => { const c = child(n, name); return c ? c.text.trim() : ''; };
const rawText = (n, name) => { const c = child(n, name); return c ? c.text : ''; };

/** Password Safe group paths use "." between levels and "\." for a literal dot. */
export function pwsGroupToFolder(g) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '\\' && g[i + 1] === '.') { cur += '.'; i++; }
    else if (g[i] === '.') { parts.push(cur); cur = ''; }
    else cur += g[i];
  }
  parts.push(cur);
  return cleanFolder(parts.map((p) => p.replace(/\//g, '-')).join('/'));
}

function toISO(s) { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; }

/** Import a Password Safe XML export (File > Export To > XML). */
export function importPasswordSafeXML(text) {
  const doc = parseXML(text);
  const db = child(doc, 'passwordsafe');
  if (!db) throw new Error('This is not a Password Safe XML export');
  const delim = db.attrs.delimiter;
  const items = [];
  for (const e of db.children.filter((c) => c.name === 'entry')) {
    let notes = rawText(e, 'notes');
    if (delim && !notes.includes('\n') && delim.length === 1 && !/[a-z0-9 ]/i.test(delim)) notes = notes.split(delim).join('\n');
    const url = textOf(e, 'url');
    const created = toISO(textOf(e, 'ctimex'));
    const changed = toISO(textOf(e, 'pmtimex')) || created;
    const custom = [];
    const cf = child(e, 'custom_fields');
    if (cf) for (const f of cf.children.filter((c) => c.name === 'custom_field')) {
      custom.push({ name: textOf(f, 'name'), value: rawText(f, 'value'), hidden: textOf(f, 'sensitive') === '1' });
    }
    for (const [tag, label] of [['autotype', 'Autotype'], ['runcommand', 'Run command']]) {
      const v = textOf(e, tag); if (v) custom.push({ name: label, value: v, hidden: false });
    }
    const history = [];
    const ph = child(e, 'pwhistory');
    const he = ph && child(ph, 'history_entries');
    if (he) for (const h of he.children.filter((c) => c.name === 'history_entry')) {
      const v = rawText(h, 'oldpassword'); if (v) history.push({ value: v, changedAt: toISO(textOf(h, 'changedx')) || created || new Date().toISOString() });
    }
    let totp = textOf(e, 'twofactorkey');
    const digits = parseInt(textOf(e, 'totplength'), 10), step = parseInt(textOf(e, 'totptimestep'), 10);
    if (totp && ((digits && digits !== 6) || (step && step !== 30))) {
      totp = `otpauth://totp/${encodeURIComponent(textOf(e, 'title'))}?secret=${totp.replace(/\s/g, '')}&digits=${digits || 6}&period=${step || 30}`;
    }
    const it = newItem('login', {
      title: textOf(e, 'title') || url || 'Untitled',
      folder: pwsGroupToFolder(textOf(e, 'group')),
      fields: { username: textOf(e, 'username'), password: rawText(e, 'password'), url, email: textOf(e, 'email'), totp },
      notes, custom, history,
      createdAt: created || undefined, updatedAt: toISO(textOf(e, 'rmtimex')) || changed || undefined,
      expiresAt: toISO(textOf(e, 'xtimex')),
    });
    it.passwordChangedAt = changed || it.createdAt;
    if (!it.fields.password && !it.fields.username && !url) it.type = 'note';
    items.push(it);
  }
  return items;
}

// ---------- CSV ----------
export function parseCSV(text, delim) {
  text = text.replace(/^﻿/, '');
  if (!delim) {
    const first = text.split(/\r?\n/, 1)[0];
    delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  }
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const COLS = {
  title: ['name', 'title', 'account', 'item', 'entry', 'description'],
  username: ['username', 'login_username', 'user', 'login', 'user name', 'login name'],
  password: ['password', 'login_password', 'pass'],
  url: ['url', 'login_uri', 'website', 'web site', 'uri', 'address', 'web address'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment'],
  folder: ['folder', 'grouping', 'group', 'category', 'path'],
  totp: ['totp', 'login_totp', 'otp', 'otpauth', 'one-time password', 'otp secret'],
  email: ['email', 'e-mail'],
  type: ['type'],
  tags: ['tags'],
  favorite: ['favorite', 'fav'],
};

/** Import CSV (Bitwarden, Chrome, Edge, Firefox, 1Password, KeePass, LastPass, Keyhold, Password Safe text export). */
export function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('The CSV file has no entries');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const pwsText = header[0] === 'group/title';
  const col = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = header.findIndex((h) => names.includes(h));
  if (pwsText) col.title = 0;
  if (col.title < 0 && col.url < 0 && col.password < 0) throw new Error('Could not find name, website or password columns in this CSV');
  const items = [];
  for (const r of rows.slice(1)) {
    const g = (k) => (col[k] >= 0 ? (r[col[k]] || '') : '');
    let title = g('title').trim(), folder = g('folder');
    if (pwsText) {
      const f = pwsGroupToFolder(title).split('/');
      title = f.pop(); folder = f.join('/');
    }
    let type = g('type').trim().toLowerCase();
    if (!TYPES[type]) type = g('password') || g('username') || g('url') ? 'login' : 'note';
    const it = newItem(type, {
      title: title || g('url') || 'Untitled', folder: folder.replace(/\\/g, '/'),
      tags: g('tags') ? g('tags').split(/[;,]/) : [], favorite: /^(1|true|yes)$/i.test(g('favorite').trim()),
      fields: type === 'login' ? { username: g('username'), password: g('password'), url: g('url'), email: g('email'), totp: g('totp') } : {},
      notes: pwsText ? g('notes').replace(/»/g, '\n') : g('notes'),
    });
    items.push(it);
  }
  return items;
}

/** Pick the importer from the file contents. */
export function importAny(name, text) {
  const t = text.trimStart();
  if (t.startsWith('<')) return { kind: 'Password Safe XML', items: importPasswordSafeXML(text) };
  if (t.startsWith('{')) throw new Error('This looks like a Keyhold vault file. Use "Open a backup" instead.');
  return { kind: 'CSV', items: importCSV(text) };
}

function csvCell(v, neutralise = true) {
  const s = String(v ?? '');
  const formula = neutralise && /^[=+\-@\t]/.test(s);
  return /[",\n\r]/.test(s) || formula ? '"' + (formula ? "'" : '') + s.replace(/"/g, '""') + '"' : s;
}
const EXACT = new Set([5, 6, 9]); // username, password, totp: never altered

/**
 * Plain-text CSV export (unencrypted). Descriptive cells that a spreadsheet
 * would run as formulas are neutralised; credentials are written exactly.
 */
export function exportCSV(items) {
  const head = ['type', 'name', 'folder', 'favorite', 'tags', 'username', 'password', 'url', 'email', 'totp', 'notes', 'fields'];
  const lines = [head.join(',')];
  for (const it of items) {
    const f = it.fields;
    const other = { ...f };
    ['username', 'password', 'url', 'email', 'totp'].forEach((k) => delete other[k]);
    const extra = [...Object.entries(other).filter(([, v]) => v), ...it.custom.map((c) => [c.name, c.value])];
    lines.push([it.type, it.title, it.folder, it.favorite ? 1 : '', it.tags.join(';'), f.username, f.password, f.url, f.email, f.totp,
      it.notes, extra.map(([k, v]) => `${k}: ${v}`).join('\n')].map((v, i) => csvCell(v, !EXACT.has(i))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
