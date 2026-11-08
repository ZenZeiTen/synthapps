// DOM helpers. Text is always set with textContent; nothing user-provided is
// ever parsed as HTML.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'i ' + cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

export function iconBtn(name, label, onclick, extra = {}) {
  return h('button', { class: 'icon-btn ' + (extra.class || ''), type: 'button', title: label, 'aria-label': label, onclick, ...extra.attrs }, icon(name));
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

/** Replace an element's children; arrays are flattened and null/false skipped. */
export function fill(el, ...kids) { clear(el); append(el, kids); return el; }

export function toast(msg, { error = false, ms = 3500, action } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (error ? ' err' : '') }, h('span', { text: msg }),
    action ? h('button', { type: 'button', onclick: () => { action.fn(); t.remove(); } }, action.label) : null);
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.remove(), error ? Math.max(ms, 6000) : ms);
  return t;
}

/**
 * A modal dialog. build(close) returns { title, body, foot } nodes.
 * Resolves with whatever close(value) is called with (undefined on Esc).
 */
export function modal(build, { large = false } = {}) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: large ? 'lg' : '' });
    let done = false;
    const close = (v) => { if (done) return; done = true; d.close(); d.remove(); resolve(v); };
    const parts = build(close);
    append(d, [
      h('div', { class: 'dlg-head' }, h('h2', { text: parts.title }), iconBtn('x', 'Close', () => close(undefined))),
      parts.tabs || null,
      h('div', { class: 'dlg-body' }, parts.body),
      parts.foot ? h('div', { class: 'dlg-foot' }, parts.foot) : null,
    ]);
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    document.body.append(d);
    d.showModal();
    const first = d.querySelector('[autofocus], input, select, textarea');
    if (first) first.focus();
  });
}

export function confirmBox(title, text, { ok = 'OK', danger = false } = {}) {
  return modal((close) => ({
    title,
    body: h('p', { text }),
    foot: [h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', autofocus: true, onclick: () => close(true) }, ok)],
  })).then((v) => !!v);
}

/** Ask for a password; check(pw) may throw to show an error and keep the box open. */
export function askPassword(title, text, check, { ok = 'Continue' } = {}) {
  return modal((close) => {
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', autofocus: true, 'aria-label': 'Master password' });
    const err = h('div', { class: 'error' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, ok);
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        try { const v = await check(input.value); close(v === undefined ? true : v); }
        catch (x) { err.textContent = x.message; btn.disabled = false; input.select(); }
      },
    }, text ? h('p', { class: 'muted', text }) : null, h('label', { class: 'field' }, h('span', { text: 'Master password' }), input), err,
    h('div', { class: 'dlg-foot', style: 'padding:6px 0 10px' }, h('button', { class: 'btn', type: 'button', onclick: () => close(undefined) }, 'Cancel'), btn));
    return { title, body: form };
  });
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: 'display:none' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; inp.remove();
      resolve(f ? { name: f.name, text: await f.text() } : null);
    });
    document.body.append(inp); inp.click();
  });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' days ago';
  return new Date(iso).toLocaleDateString();
}
