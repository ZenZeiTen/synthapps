// Single element helper: every piece of data reaches the DOM as a text node or an attribute. No innerHTML.

export function h(sel, props, ...kids) {
  const parts = sel.split(/(?=[.#])/);
  const tag = parts[0] && !/^[.#]/.test(parts[0]) ? parts.shift() : 'div';
  const el = document.createElement(tag);
  for (const p of parts) {
    if (p[0] === '#') el.id = p.slice(1); else el.classList.add(p.slice(1));
  }
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props); props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') { for (const c of String(v).split(/\s+/)) if (c) el.classList.add(c); }
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'tabIndex' || k === 'title' || k === 'type' || k === 'placeholder' || k === 'spellcheck' || k === 'draggable') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); return append(el, kids); }
export const cx = (...a) => a.filter(Boolean).join(' ');

export function debounce(fn, ms) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t); d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function hostOf(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } }

export function splitUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'lintas:') return { scheme: 'lintas://', host: u.host, rest: (u.pathname === '/' ? '' : u.pathname) };
    let rest = u.pathname + u.search + u.hash; if (rest === '/') rest = '';
    return { scheme: u.protocol === 'https:' ? '' : u.protocol + '//', host: u.host.replace(/^www\./, ''), rest };
  } catch { return { scheme: '', host: url || '', rest: '' }; }
}

const nf = new Intl.NumberFormat('en');
export const fmtNum = (n) => nf.format(n ?? 0);
export const fmtPct = (x) => Math.round((x ?? 0) * 100) + '%';
export function fmtBytes(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return (b >= 10 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i];
}
const dDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t) => (t ? dDate.format(new Date(t)) : '');
export const fmtTime = (t) => (t ? dTime.format(new Date(t)) : '');
export function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function dayLabel(t) {
  const diff = Math.round((dayStart(Date.now()) - dayStart(t)) / 864e5);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(t));
}
export function relTime(t) {
  if (!t) return '';
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return dShort.format(new Date(t));
}
/** Due-date wording + tone for project cards. */
export function dueInfo(t) {
  if (!t) return null;
  const days = Math.round((dayStart(t) - dayStart(Date.now())) / 864e5);
  if (days < 0) return { text: `Overdue by ${-days} d`, tone: 'danger' };
  if (days === 0) return { text: 'Due today', tone: 'warn' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'warn' };
  if (days <= 3) return { text: `Due in ${days} days`, tone: 'warn' };
  return { text: 'Due ' + dShort.format(new Date(t)), tone: '' };
}

export const LANGS = [
  ['id', 'Indonesian'], ['en', 'English'], ['ms', 'Malay'], ['jv', 'Javanese'], ['su', 'Sundanese'], ['zh', 'Chinese'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['ar', 'Arabic'], ['nl', 'Dutch'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['pt', 'Portuguese'],
  ['th', 'Thai'], ['vi', 'Vietnamese'], ['hi', 'Hindi'], ['ru', 'Russian'],
];
export const langName = (c) => (LANGS.find((l) => l[0] === c) || [c, (c || '').toUpperCase()])[1];

const HUES = [186, 212, 262, 338, 24, 142, 48, 290];
export function hueFor(str) { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return HUES[x % HUES.length]; }
/** Letter avatar used when a site has no favicon (and for bookmarks, which carry none in the contract). */
export function favLetter(urlOrName, cls) {
  const host = hostOf(urlOrName) || String(urlOrName || '?');
  return h('span.fav-letter', { class: cls, style: { background: `hsl(${hueFor(host)} 52% 42%)` } }, host[0] || '?');
}

export function trapFocus(root, e) {
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
export const isMod = (e) => e.ctrlKey || e.metaKey;
