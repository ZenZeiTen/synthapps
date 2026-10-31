// Shared helpers for the library and the player pages.

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof File) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, opts);
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.hint = data?.hint || '';
    err.code = data?.code || '';
    throw err;
  }
  return data;
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

export function toast(message, kind = '', ms = 3800) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) { stack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' }); document.body.append(stack); }
  const t = el('div', { class: `toast ${kind}` }, message);
  stack.append(t);
  setTimeout(() => t.remove(), ms);
}

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  heart: P('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  dots: P('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
  back: P('<path d="M15 18l-6-6 6-6"/>'),
  lang: P('<path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>'),
  auto: P('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  layers: P('<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'),
  save: P('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
  load: P('<path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  pause: P('<path d="M10 4H6v16h4zM18 4h-4v16h4z"/>'),
  ff: P('<path d="m13 19 9-7-9-7v14zM2 19l9-7-9-7v14z"/>'),
  camera: P('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  full: P('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>'),
  panel: P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  restart: P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  folder: P('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
};
export function icon(name) {
  const s = document.createElement('span');
  s.style.display = 'contents';
  s.innerHTML = ICONS[name] || '';
  return s.firstChild;
}

/** A colour per hardware maker, for system tags and placeholder covers. */
export const MAKER_COLORS = {
  Nintendo: ['#ff5d6c', '#8a1f33'], Sega: ['#4ea8ff', '#123a7a'], Sony: ['#b9c3d8', '#2e3448'], NEC: ['#ff9e45', '#6b3510'],
  Atari: ['#ffcf6e', '#6b4a10'], SNK: ['#61e3ff', '#0e4b5a'], Bandai: ['#c792ff', '#3c1a6b'], Panasonic: ['#5fe39a', '#11502d'],
  'IBM PC': ['#9be564', '#244d12'], Commodore: ['#7fa8ff', '#1d2c66'], Arcade: ['#ff7ad9', '#5e1350'],
};
export function makerColors(maker) {
  return MAKER_COLORS[maker] || ['#aab', '#334'];
}

export const LANGUAGES = ['English', 'Indonesian', 'Japanese', 'Spanish', 'Portuguese', 'Brazilian Portuguese', 'French', 'German', 'Italian', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Korean', 'Thai', 'Vietnamese', 'Malay', 'Tagalog', 'Russian', 'Polish', 'Turkish', 'Arabic', 'Hindi', 'Dutch', 'Swedish', 'Ukrainian', 'Javanese'];

export function fmtDuration(sec) {
  if (!sec) return 'Not played';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}

export const BRAND_SVG = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffcf6e"/><stop offset=".55" stop-color="#ff9e45"/><stop offset="1" stop-color="#ff6f91"/></linearGradient></defs><rect x="2" y="5" width="28" height="20" rx="5" fill="url(#bg)"/><rect x="6" y="9" width="20" height="12" rx="2" fill="#0b0c14"/><path d="M9 13h6M9 17h4" stroke="#61e3ff" stroke-width="2" stroke-linecap="round"/><path d="M18 13h5M20 17h3" stroke="#ffcf6e" stroke-width="2" stroke-linecap="round"/><path d="M11 25l-2 4 6-4z" fill="#ff9e45"/></svg>`;
