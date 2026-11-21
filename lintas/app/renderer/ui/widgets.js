// Small shared visual components.
import { h, favLetter, langName } from '../lib/dom.js';
import { icon, STATUS_ICON, STATUS_LABEL, STATUSES } from '../lib/icons.js';

const NS = 'http://www.w3.org/2000/svg';

/** Circular progress ring. value 0..1; value == null => indeterminate spinner look. */
export function ring(value, { size = 36, stroke = 3.5, label } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (cls, dash) => {
    const e = document.createElementNS(NS, 'circle');
    e.setAttribute('cx', size / 2); e.setAttribute('cy', size / 2); e.setAttribute('r', r); e.setAttribute('fill', 'none');
    e.setAttribute('stroke-width', stroke); e.setAttribute('class', cls);
    if (dash != null) { e.setAttribute('stroke-dasharray', c); e.setAttribute('stroke-dashoffset', c * (1 - Math.max(0, Math.min(1, dash)))); e.setAttribute('stroke-linecap', 'round'); }
    svg.appendChild(e);
  };
  mk('track'); mk('value', value ?? 0.28);
  const el = h('span.ring', { style: { width: size + 'px', height: size + 'px' }, role: 'img', 'aria-label': value == null ? 'In progress' : Math.round(value * 100) + ' percent' }, svg,
    label === false ? null : (label != null ? h('span.ring-label', label) : (size >= 34 && value != null ? h('span.ring-label', String(Math.round(value * 100))) : null)));
  if (value == null) svg.style.animation = 'spin 1s linear infinite';
  return el;
}

/** Status-split progress bar from Stats.byStatus. */
export function segBar(stats) {
  const by = stats?.byStatus || {}; const total = Math.max(1, stats?.segments || 0);
  const title = STATUSES.map((s) => `${STATUS_LABEL[s]} ${by[s] || 0}`).join(' · ');
  return h('div.seg-bar', { title, role: 'img', 'aria-label': title },
    ['approved', 'reviewed', 'translated', 'draft', 'new'].map((s) => h('i.b-' + s, { style: { flexGrow: String((by[s] || 0) / total) } })));
}

export function statusIcon(status) { return h('span.st.st-' + status, { title: STATUS_LABEL[status] || status }, icon(STATUS_ICON[status] || 'circle')); }
export function statusPill(status) { return h('span.st.st-pill.st-' + status, icon(STATUS_ICON[status] || 'circle'), STATUS_LABEL[status] || status); }

export function langPair(src, tgt) {
  return h('span.lang-pair', { title: `${langName(src)} → ${langName(tgt)}` }, (src || '').toUpperCase(), icon('arrowRight'), (tgt || '').toUpperCase());
}

/** Favicon <img> with graceful fallback to a letter avatar. */
export function favicon(src, url, fallbackIcon) {
  if (!src) return fallbackIcon ? icon(fallbackIcon, 16) : favLetter(url);
  const img = h('img.favicon', { src, alt: '', draggable: false, referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(favLetter(url)), { once: true });
  return img;
}

export function emptyState(ic, title, text, action) {
  return h('div.empty', icon(ic), h('h3', title), text ? h('p', text) : null, action || null);
}

export function searchField(placeholder, onInput, opts = {}) {
  const input = h('input.input', { type: 'search', placeholder, 'aria-label': placeholder, spellcheck: false, dir: 'auto', value: opts.value || '' });
  input.addEventListener('input', () => onInput(input.value));
  const el = h('div.search-field', { style: opts.width ? { width: opts.width + 'px' } : null }, icon('search'), input);
  el.input = input;
  return el;
}

export function btn(label, { kind = '', ic, onClick, title, sm } = {}) {
  return h('button.btn', { type: 'button', class: (kind + (sm ? ' sm' : '')).trim(), title, onClick }, ic ? icon(ic) : null, label);
}
export function iconBtn(ic, label, onClick, cls) {
  return h('button.icon-btn', { type: 'button', class: cls || '', title: label, 'aria-label': label, onClick }, icon(ic));
}

/** Runs an async action with the button showing a spinner. */
export async function withBusy(button, fn) {
  if (button.classList.contains('busy')) return;
  const first = button.firstChild; const sp = h('span.spinner');
  button.classList.add('busy');
  if (first && first.nodeType === 1) first.replaceWith(sp); else button.prepend(sp);
  try { return await fn(); }
  finally { button.classList.remove('busy'); if (first && first.nodeType === 1) sp.replaceWith(first); else sp.remove(); }
}

/** Colour-coded diff of TM source vs current source. */
export function diffView(diff) {
  return h('span.diff', { dir: 'auto' }, (diff || []).map((d) => d.op === 'eq' ? d.text : h(d.op === 'del' ? 'del' : 'ins', { title: d.op === 'del' ? 'Only in the TM source' : 'Only in this segment' }, d.text)));
}

export function matchBadge(score) {
  if (score == null) return null;
  const cls = score >= 100 ? 'm-exact' : score >= 85 ? 'm-high' : score >= 75 ? 'm-mid' : 'm-low';
  return h('span.match', { class: cls, title: 'Best translation-memory match' }, score > 100 ? '101%' : score + '%');
}
