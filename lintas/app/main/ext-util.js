// Small Chrome-compatible helpers for extension support, kept free of Electron so they can be unit tested.

// Chrome's tab group colours, in the order Chrome hands them out
export const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/** chrome.runtime.getContexts filter (every given list must contain the context's value). */
export function filterContexts(list, f = {}) {
  const has = (k, v) => !Array.isArray(f[k]) || f[k].includes(v);
  return list.filter(c => has('contextTypes', c.contextType) && has('contextIds', c.contextId) && has('tabIds', c.tabId) && has('windowIds', c.windowId) &&
    has('documentIds', c.documentId) && has('frameIds', c.frameId) && has('documentUrls', c.documentUrl) && has('documentOrigins', c.documentOrigin) &&
    (typeof f.incognito !== 'boolean' || f.incognito === c.incognito));
}

/** The colour Chrome would give a new group: the first of the least used colours. */
export function nextGroupColor(used) {
  const n = (c) => used.filter(x => x === c).length;
  return GROUP_COLORS.reduce((best, c) => (n(c) < n(best) ? c : best), GROUP_COLORS[0]);
}

/** Chrome match patterns: <all_urls>, *://*.example.com/path*, https://host/* */
export function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(url);
  const m = /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  const scheme = u.protocol.slice(0, -1);
  if (m[1] === '*' ? !['http', 'https'].includes(scheme) : m[1] !== scheme) return false;
  const host = m[2];
  if (host !== '*' && !(host.startsWith('*.') ? (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))) : u.hostname === host)) return false;
  const re = new RegExp('^' + m[3].split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(u.pathname + u.search);
}

/** The manifest's suggested_key for this platform ("Ctrl+Shift+Y"), or null. */
export function shortcutFor(suggested, platform = process.platform) {
  if (!suggested) return null;
  if (typeof suggested === 'string') return suggested;
  const k = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform];
  return suggested[k] || suggested.default || null;
}

const KEY_CODES = { Comma: 'Comma', Period: 'Period', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Space: 'Space', Insert: 'Insert', Delete: 'Delete',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };

/** Whether a keyboard input (Electron's before-input-event) is this Chrome shortcut, modifiers exactly. */
export function shortcutMatches(shortcut, input, platform = process.platform) {
  const parts = String(shortcut).split('+').map(x => x.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const mac = platform === 'darwin';
  const want = { control: false, meta: false, alt: false, shift: false };
  for (const m of parts) {
    if (m === 'Ctrl') want[mac ? 'meta' : 'control'] = true;
    else if (m === 'Command') want.meta = true;
    else if (m === 'MacCtrl') want.control = true;
    else if (m === 'Alt') want.alt = true;
    else if (m === 'Shift') want.shift = true;
    else return false;
  }
  for (const m of Object.keys(want)) if (!!input[m] !== want[m]) return false;
  const code = /^[A-Z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^[0-9]$/.test(key) ? 'Digit' + key : KEY_CODES[key];
  if (!code) return false;
  return input.code ? input.code === code : String(input.key).toLowerCase() === key.toLowerCase();
}

/** chrome.tabs.query / tabGroups.query title patterns: * matches anything. */
export function matchesTitle(pattern, title) {
  return new RegExp('^' + pattern.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i').test(title);
}


/**
 * One Set-Cookie header line as the details for Electron's cookies.set(), or { remove, name } when the
 * line deletes the cookie, or null when it cannot be used.
 */
export function parseSetCookie(line, url, now = Date.now()) {
  const parts = String(line).split(';');
  const first = parts.shift() || '';
  const eq = first.indexOf('=');
  if (eq < 1) return null;
  const name = first.slice(0, eq).trim(), value = first.slice(eq + 1).trim();
  if (!name) return null;
  const c = { url, name, value, sameSite: 'unspecified' };
  let expires = null, maxAge = null;
  for (const part of parts) {
    const i = part.indexOf('=');
    const k = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? '' : part.slice(i + 1).trim();
    if (k === 'domain' && v) c.domain = v;
    else if (k === 'path' && v.startsWith('/')) c.path = v;
    else if (k === 'secure') c.secure = true;
    else if (k === 'httponly') c.httpOnly = true;
    else if (k === 'samesite') c.sameSite = { none: 'no_restriction', lax: 'lax', strict: 'strict' }[v.toLowerCase()] || 'unspecified';
    else if (k === 'max-age' && /^-?\d+$/.test(v)) maxAge = Number(v);
    else if (k === 'expires') { const t = Date.parse(v); if (!Number.isNaN(t)) expires = t; }
  }
  const end = maxAge != null ? now + maxAge * 1000 : expires;
  if (end != null) {
    if (end <= now) return { remove: true, name };
    c.expirationDate = end / 1000;
  }
  if (c.sameSite === 'no_restriction' && !c.secure) return null;
  return c;
}
