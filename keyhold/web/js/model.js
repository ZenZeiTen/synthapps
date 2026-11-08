// What a vault holds, and the rules for changing and merging it.
import { uuid } from './crypto.js';

// kind: text | secret | url | email | multiline | totp | date | select
export const TYPES = {
  login: {
    label: 'Login', plural: 'Logins', icon: 'key',
    fields: [
      { key: 'username', label: 'Username', kind: 'text', copy: true },
      { key: 'password', label: 'Password', kind: 'secret', copy: true, generate: true, primary: true },
      { key: 'url', label: 'Website', kind: 'url', copy: true },
      { key: 'email', label: 'Email', kind: 'email', copy: true },
      { key: 'totp', label: 'Two-factor code (TOTP)', kind: 'totp', copy: true },
    ],
  },
  card: {
    label: 'Payment card', plural: 'Payment cards', icon: 'card',
    fields: [
      { key: 'cardholder', label: 'Name on card', kind: 'text', copy: true },
      { key: 'number', label: 'Card number', kind: 'secret', copy: true, primary: true },
      { key: 'expiry', label: 'Expiry (MM/YY)', kind: 'text', copy: true },
      { key: 'cvv', label: 'Security code', kind: 'secret', copy: true },
      { key: 'pin', label: 'PIN', kind: 'secret', copy: true },
      { key: 'brand', label: 'Brand', kind: 'text' },
    ],
  },
  identity: {
    label: 'Identity', plural: 'Identities', icon: 'person',
    fields: [
      { key: 'fullName', label: 'Full name', kind: 'text', copy: true },
      { key: 'email', label: 'Email', kind: 'email', copy: true },
      { key: 'phone', label: 'Phone', kind: 'text', copy: true },
      { key: 'address', label: 'Address', kind: 'multiline', copy: true },
      { key: 'birthday', label: 'Date of birth', kind: 'date' },
      { key: 'idNumber', label: 'ID or passport number', kind: 'secret', copy: true, primary: true },
    ],
  },
  bank: {
    label: 'Bank account', plural: 'Bank accounts', icon: 'bank',
    fields: [
      { key: 'bankName', label: 'Bank', kind: 'text' },
      { key: 'accountName', label: 'Account holder', kind: 'text', copy: true },
      { key: 'accountNumber', label: 'Account number / IBAN', kind: 'secret', copy: true, primary: true },
      { key: 'routing', label: 'Sort code / SWIFT / routing', kind: 'text', copy: true },
      { key: 'pin', label: 'PIN', kind: 'secret', copy: true },
    ],
  },
  wifi: {
    label: 'Wi-Fi', plural: 'Wi-Fi networks', icon: 'wifi',
    fields: [
      { key: 'ssid', label: 'Network name', kind: 'text', copy: true },
      { key: 'password', label: 'Password', kind: 'secret', copy: true, generate: true, primary: true },
      { key: 'security', label: 'Security', kind: 'select', options: ['WPA3', 'WPA2', 'WPA', 'WEP', 'Open'] },
    ],
  },
  apikey: {
    label: 'API key', plural: 'API keys', icon: 'code',
    fields: [
      { key: 'service', label: 'Service', kind: 'text' },
      { key: 'keyId', label: 'Key ID', kind: 'text', copy: true },
      { key: 'secret', label: 'Secret', kind: 'secret', copy: true, generate: true, primary: true },
      { key: 'endpoint', label: 'Endpoint', kind: 'url', copy: true },
    ],
  },
  ssh: {
    label: 'SSH key', plural: 'SSH keys', icon: 'terminal',
    fields: [
      { key: 'host', label: 'Host', kind: 'text', copy: true },
      { key: 'publicKey', label: 'Public key', kind: 'multiline', copy: true },
      { key: 'privateKey', label: 'Private key', kind: 'secret', multiline: true, copy: true, primary: true },
      { key: 'passphrase', label: 'Passphrase', kind: 'secret', copy: true, generate: true },
    ],
  },
  note: { label: 'Secure note', plural: 'Secure notes', icon: 'note', fields: [] },
};

export const now = () => new Date().toISOString();

export function emptyPayload() {
  return { schema: 1, items: {}, purged: {}, settings: defaultSettings() };
}

export function defaultSettings() {
  return {
    autoLockMinutes: 5, lockOnHide: false, clipboardSeconds: 30, theme: 'system',
    folders: [], sync: null, breachCheck: false, updatedAt: '1970-01-01T00:00:00.000Z',
  };
}

/** Fill in anything missing so older or imported data is always well formed. */
export function normalizePayload(p) {
  const out = { schema: 1, items: {}, purged: { ...(p && p.purged) }, settings: { ...defaultSettings(), ...(p && p.settings) } };
  for (const it of Object.values((p && p.items) || {})) {
    const n = normalizeItem(it);
    out.items[n.id] = n;
  }
  return out;
}

export function normalizeItem(it) {
  const type = TYPES[it.type] ? it.type : 'note';
  const t = it.createdAt || now();
  return {
    id: it.id || uuid(), type,
    title: String(it.title || 'Untitled').slice(0, 300),
    folder: cleanFolder(it.folder || ''),
    tags: [...new Set((it.tags || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 30),
    favorite: !!it.favorite,
    fields: { ...(it.fields || {}) },
    custom: (it.custom || []).map((c) => ({ name: String(c.name || ''), value: String(c.value ?? ''), hidden: !!c.hidden })),
    notes: String(it.notes || ''),
    history: (it.history || []).slice(0, 30),
    createdAt: t, updatedAt: it.updatedAt || t,
    passwordChangedAt: it.passwordChangedAt || it.createdAt || t,
    deletedAt: it.deletedAt || null,
    expiresAt: it.expiresAt || null,
    breach: it.breach || null,
  };
}

export function cleanFolder(f) {
  return String(f).split('/').map((s) => s.trim()).filter(Boolean).join('/').slice(0, 300);
}

export function newItem(type = 'login', extra = {}) {
  const t = now();
  return normalizeItem({ id: uuid(), type, title: '', createdAt: t, updatedAt: t, ...extra });
}

export function primaryKey(type) {
  const f = (TYPES[type] || TYPES.note).fields.find((x) => x.primary);
  return f ? f.key : null;
}

/** Apply an edit: bumps timestamps and keeps the replaced secret in history. */
export function applyEdit(before, after) {
  const next = normalizeItem({ ...after, id: before ? before.id : after.id, createdAt: before ? before.createdAt : after.createdAt });
  const t = now();
  next.updatedAt = t;
  const pk = primaryKey(next.type);
  if (before && pk) {
    const old = before.fields[pk] || '';
    if (old && old !== (next.fields[pk] || '')) {
      next.history = [{ value: old, changedAt: t }, ...before.history.filter((h) => h.value !== old)].slice(0, 30);
      next.passwordChangedAt = t;
      next.breach = null;
    } else {
      next.history = before.history;
      next.passwordChangedAt = before.passwordChangedAt;
    }
  }
  return next;
}

/** Subtitle shown in the list. */
export function subtitle(it) {
  const f = it.fields;
  switch (it.type) {
    case 'login': return f.username || f.email || hostOf(f.url) || '';
    case 'card': return f.number ? '•••• ' + String(f.number).replace(/\s/g, '').slice(-4) : f.cardholder || '';
    case 'identity': return f.fullName || f.email || '';
    case 'bank': return [f.bankName, f.accountNumber ? '•••• ' + String(f.accountNumber).slice(-4) : ''].filter(Boolean).join(' · ');
    case 'wifi': return f.ssid || '';
    case 'apikey': return f.service || f.keyId || '';
    case 'ssh': return f.host || '';
    default: return (it.notes || '').split('\n')[0].slice(0, 80);
  }
}

export function hostOf(url) {
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).host; } catch { return ''; }
}

export function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

/** Search titles, non-secret fields, folders, tags and notes. All words must match. */
export function search(items, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const def = TYPES[it.type];
    const hay = [it.title, it.folder, it.tags.join(' '), it.notes, def.label,
      ...def.fields.filter((f) => f.kind !== 'secret' && f.kind !== 'totp').map((f) => it.fields[f.key] || ''),
      ...it.custom.filter((c) => !c.hidden).map((c) => c.name + ' ' + c.value)].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function sortItems(items, by = 'title') {
  const arr = [...items];
  if (by === 'updated') arr.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  else arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  return arr;
}

/** Folder tree from item folders plus empty folders the user created. */
export function folderTree(items, extra = []) {
  const counts = new Map();
  const add = (path, n) => {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      counts.set(p, (counts.get(p) || 0) + (i === parts.length ? n : 0));
    }
  };
  for (const it of items) if (it.folder) add(it.folder, 1);
  for (const f of extra) if (f) add(cleanFolder(f), 0);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, count]) => ({
    path, count, depth: path.split('/').length - 1, name: path.split('/').pop(),
  }));
}

/** Weak, reused, old, breached and expiring secrets. */
export function healthReport(items, strengthFn, { oldDays = 365, at = Date.now() } = {}) {
  const live = items.filter((i) => !i.deletedAt);
  const bySecret = new Map();
  const weak = [], old = [], breached = [], expiring = [], noTotp = [];
  for (const it of live) {
    const pk = primaryKey(it.type);
    const s = pk && it.fields[pk];
    if (!s) continue;
    if (it.type === 'login' || it.type === 'wifi' || it.type === 'apikey') {
      const st = strengthFn(s);
      if (st.score < 2) weak.push({ item: it, strength: st });
      if (at - Date.parse(it.passwordChangedAt) > oldDays * 864e5) old.push({ item: it });
      if (it.type === 'login' && !it.fields.totp && it.fields.url) noTotp.push({ item: it });
    }
    if (it.breach && it.breach.count > 0) breached.push({ item: it, count: it.breach.count });
    if (it.expiresAt && Date.parse(it.expiresAt) - at < 30 * 864e5) expiring.push({ item: it });
    if (!bySecret.has(s)) bySecret.set(s, []);
    bySecret.get(s).push(it);
  }
  const reused = [...bySecret.values()].filter((g) => g.length > 1);
  const total = live.filter((i) => primaryKey(i.type) && i.fields[primaryKey(i.type)]).length;
  const problems = new Set([...weak, ...old, ...breached].map((x) => x.item.id));
  reused.flat().forEach((i) => problems.add(i.id));
  const score = total ? Math.round(100 * (1 - problems.size / total)) : 100;
  return { weak, reused, old, breached, expiring, noTotp, total, score };
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const stableStringify = stable;

const PURGE_KEEP_DAYS = 180;

/**
 * Merge two copies of a vault (this device and the sync server).
 * Per item, the newer edit wins; a secret that loses is kept in the winner's
 * history so nothing typed on any device is lost. Items emptied from the
 * trash stay removed everywhere.
 */
export function mergePayloads(a, b) {
  a = normalizePayload(a); b = normalizePayload(b);
  const purged = { ...a.purged };
  for (const [id, t] of Object.entries(b.purged)) if (!purged[id] || purged[id] < t) purged[id] = t;
  const cutoff = new Date(Date.now() - PURGE_KEEP_DAYS * 864e5).toISOString();
  for (const [id, t] of Object.entries(purged)) if (t < cutoff) delete purged[id];

  const items = {};
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const x = a.items[id], y = b.items[id];
    let win, lose;
    if (!x || !y) win = x || y;
    else if (x.updatedAt !== y.updatedAt) [win, lose] = x.updatedAt > y.updatedAt ? [x, y] : [y, x];
    else [win, lose] = stable(x) >= stable(y) ? [x, y] : [y, x];
    if (purged[id] && purged[id] >= win.updatedAt) continue;
    if (lose && stable(win) !== stable(lose)) {
      const pk = primaryKey(lose.type);
      const lost = pk && lose.fields[pk];
      if (lost && lost !== win.fields[pk] && !win.history.some((h) => h.value === lost)) {
        win = { ...win, history: [...win.history, { value: lost, changedAt: lose.updatedAt, note: 'from another device' }]
          .sort((p, q) => (p.changedAt < q.changedAt ? 1 : -1)).slice(0, 30) };
      }
    }
    items[id] = win;
  }
  const settings = a.settings.updatedAt >= b.settings.updatedAt ? a.settings : b.settings;
  const other = settings === a.settings ? b.settings : a.settings;
  settings.folders = [...new Set([...(settings.folders || []), ...(other.folders || [])])];
  return { schema: 1, items, purged, settings };
}
