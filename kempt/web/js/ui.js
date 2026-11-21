// DOM helpers and the API client. The page's Content-Security-Policy forbids
// inline script and HTML strings, so every element is built with h().

export function h(tag, attrs, ...kids) {
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected' || k === 'indeterminate') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export function fill(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}

export function icon(name) {
  const paths = {
    chevron: 'M6 3l5 5-5 5',
    leaf: 'M4 20c8 0 16-6 16-16C10 4 4 10 4 20zm0 0c3-6 7-9 12-11',
  };
  return h('svg:svg', { viewBox: name === 'chevron' ? '0 0 16 16' : '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'chevron' ? 1.8 : 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    h('svg:path', { d: paths[name] }));
}

// ---- language ----
// The catalog is the same flat JSON the Go side uses (internal/i18n/locales):
// {{name}} placeholders, plural forms as key_one / key_other (CLDR).
let lang = 'en';
let dict = {};
let fallback = {};

export function currentLang() { return lang; }

// The locale for numbers and dates: Indonesian, or the browser's English.
export function locale() {
  if (lang === 'id') return 'id-ID';
  const n = (navigator.language || 'en-US');
  return n.toLowerCase().startsWith('en') ? n : 'en-US';
}

export async function loadLang(l) {
  const get = async x => { const r = await fetch('/api/i18n/' + x); if (!r.ok) throw new Error('missing catalog ' + x); return r.json(); };
  fallback = await get('en');
  lang = l === 'id' ? 'id' : 'en';
  dict = lang === 'en' ? fallback : await get(lang);
  document.documentElement.lang = lang;
}

function fillVars(s, vars) {
  return vars ? s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// t returns the message for key in the chosen language.
export function t(key, vars) {
  const s = Object.hasOwn(dict, key) ? dict[key] : Object.hasOwn(fallback, key) ? fallback[key] : key;
  return fillVars(s, vars);
}

// tn is t for a count: it picks key_one, key_other ... and sets {{count}}.
export function tn(key, count, vars) {
  const cat = new Intl.PluralRules(locale()).select(count);
  const k = Object.hasOwn(dict, key + '_' + cat) || Object.hasOwn(fallback, key + '_' + cat) ? key + '_' + cat : key + '_other';
  return t(k, { ...vars, count: num(count) });
}

export function num(n) { return Number(n).toLocaleString(locale()); }

// bytes: whole KB and MB, one decimal for GB and TB, as the Go side does.
export function bytes(n) {
  if (!n) return '0 MB';
  const units = [['TB', 2 ** 40], ['GB', 2 ** 30], ['MB', 2 ** 20], ['KB', 2 ** 10]];
  for (const [u, v] of units) {
    if (n >= v) {
      const x = n / v;
      const s = u === 'GB' || u === 'TB'
        ? x.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : Math.round(x).toLocaleString(locale());
      return s + ' ' + u;
    }
  }
  return '1 KB';
}

export function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return t('date.today', { time });
  const date = d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return t('date.at', { date, time });
}

export function day(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- toasts ----
let toastBox;
export function toast(msg, kind) {
  if (!toastBox) document.body.append(toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : '') }, msg);
  toastBox.append(t);
  while (toastBox.children.length > 3) toastBox.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4000);
}

// ---- API ----
const TOKEN_KEY = 'kempt-token';
let token = '';
{
  const m = location.hash.match(/t=([A-Za-z0-9_-]+)/);
  try {
    if (m) { token = m[1]; sessionStorage.setItem(TOKEN_KEY, token); }
    else token = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch { if (m) token = m[1]; }
  if (m) history.replaceState(null, '', location.pathname + location.hash.replace(/t=[A-Za-z0-9_-]+&?/, '').replace(/^#$/, ''));
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(method, path, body) {
  const opt = { method, headers: { Authorization: 'Bearer ' + token, 'X-Kempt-Lang': lang } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch {
    throw new ApiError(0, 'offline', t('err.offline'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'error', data.message || t('err.requestFailed', { status: res.status }));
  return data;
}

// Starts a background job and resolves with its result. onProgress gets the
// job's progress while it runs. The returned promise has .cancel().
export function runJob(kind, body, onProgress) {
  let id = null, stopped = false;
  const p = (async () => {
    const started = await api('POST', '/api/local/jobs/' + kind, body || {});
    id = started.id;
    for (;;) {
      await new Promise(r => setTimeout(r, 350));
      const v = await api('GET', '/api/local/jobs/' + id);
      if (v.state === 'running') { onProgress && onProgress(v.progress || {}, v); continue; }
      if (v.state === 'failed') throw new ApiError(500, 'failed', v.error || t('err.taskFailed'));
      if (v.state === 'stopped' || stopped) throw new ApiError(499, 'stopped', t('err.stopped'));
      return v.result;
    }
  })();
  p.cancel = () => { stopped = true; if (id) api('DELETE', '/api/local/jobs/' + id).catch(() => {}); };
  return p;
}

export function working(text) {
  const label = h('span', null, text);
  const el = h('div', { class: 'working', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  el.set = t => { label.textContent = t; };
  return el;
}

export function errorBox(err, retry) {
  return h('div', { class: 'notice warn', role: 'alert' },
    h('p', null, err.message || String(err)),
    retry && h('button', { class: 'btn', onclick: retry }, t('ui.tryAgain')));
}
