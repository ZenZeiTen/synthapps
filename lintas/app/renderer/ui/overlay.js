// Menus, popovers, dialogs and toasts. Anything here may sit above the web page, so each open overlay
// "holds" the native view hidden (lintas.view.setVisible(false)) and releases it when it closes.
import { h, append, trapFocus } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { L, emit } from '../lib/store.js';

let holds = 0;
function sync() { try { L().view.setVisible(holds === 0); } catch { /* not ready */ } emit('view-hold', holds); }
export function holdView() {
  holds++; sync();
  let done = false;
  return () => { if (done) return; done = true; holds = Math.max(0, holds - 1); sync(); };
}
export const viewHeld = () => holds > 0;

const layer = () => document.getElementById('overlays');
const open = [];           // stack of { el, close }

function place(el, anchor, { align = 'left', gap = 6, matchWidth = false } = {}) {
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor; // DOMRect-like
  if (matchWidth) el.style.width = r.width + 'px';
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = el.offsetWidth, hh = el.offsetHeight;
  let x = align === 'right' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
  let y = r.bottom + gap;
  if (y + hh > vh - 8 && r.top - gap - hh > 8) y = r.top - gap - hh;
  x = Math.max(8, Math.min(x, vw - w - 8));
  y = Math.max(8, Math.min(y, vh - hh - 8));
  el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
}

/** Generic anchored popover. Returns { el, close }. */
export function openPopover(anchor, content, opts = {}) {
  const { dismissable = true, onClose, className = '', role = 'dialog', focus = true } = opts;
  const release = holdView();
  const el = h('div.popover', { class: className, role, tabIndex: -1 }, content);
  layer().appendChild(el);
  place(el, anchor, opts);
  const prevFocus = document.activeElement;
  let closed = false;
  const entry = { el, close };
  function close(reason) {
    if (closed) return; closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onBlur);
    el.remove(); release();
    const i = open.indexOf(entry); if (i >= 0) open.splice(i, 1);
    if (reason !== 'outside' && prevFocus && document.contains(prevFocus) && opts.restoreFocus !== false) prevFocus.focus?.();
    onClose && onClose(reason);
  }
  function onDown(e) {
    if (el.contains(e.target)) return;
    if (anchor instanceof Element && anchor.contains(e.target)) {
      if (!dismissable) return;
      // clicking the anchor again closes the popover; swallow the click so the anchor does not reopen it
      const stop = (ev) => { document.removeEventListener('click', stop, true); if (anchor.contains(ev.target)) { ev.stopPropagation(); ev.preventDefault(); } };
      document.addEventListener('click', stop, true); setTimeout(() => document.removeEventListener('click', stop, true), 700);
      close('anchor'); return;
    }
    // a nested popover (submenu / dialog) above this one keeps it open
    if (open.indexOf(entry) < open.length - 1 && open.slice(open.indexOf(entry) + 1).some((o) => o.el.contains(e.target))) return;
    if (dismissable) close('outside');
  }
  function onKey(e) {
    if (open[open.length - 1] !== entry) return;
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); close('escape'); }
    else trapFocus(el, e);
  }
  function onBlur() { if (dismissable && opts.closeOnBlur !== false) close('blur'); }
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
  }, 0);
  open.push(entry);
  if (focus) (el.querySelector('[autofocus]') || el).focus({ preventScroll: true });
  return entry;
}

export function closeAllPopovers() { for (const o of [...open]) o.close('programmatic'); }

/**
 * Menu. items: { label, icon, shortcut, onClick, checked, disabled, danger } | { sep: true } | { header } | { custom: Node }
 */
export function openMenu(anchor, items, opts = {}) {
  const menu = h('div.menu', { role: 'menu' });
  let pop;
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.appendChild(h('div.menu-sep', { role: 'separator' })); continue; }
    if (it.header) { menu.appendChild(h('div.menu-header', it.header)); continue; }
    if (it.custom) { menu.appendChild(it.custom); continue; }
    menu.appendChild(h('button.menu-item', {
      type: 'button', role: it.checked != null ? 'menuitemradio' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null,
      class: it.danger ? 'danger' : '', disabled: !!it.disabled, title: it.title,
      onClick: () => { pop.close('select'); it.onClick && it.onClick(); },
    },
      it.checked != null ? (it.checked ? icon('check') : h('span', { style: { width: '16px', flex: 'none' } })) : (it.icon ? (typeof it.icon === 'string' ? icon(it.icon) : it.icon) : (opts.iconGutter ? h('span', { style: { width: '16px', flex: 'none' } }) : null)),
      h('span.grow', it.label), it.shortcut ? h('kbd', it.shortcut) : null));
  }
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('button.menu-item:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0])?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1])?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); btns[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1]?.focus(); }
  });
  pop = openPopover(anchor, menu, { role: 'presentation', ...opts });
  if (opts.width) pop.el.style.width = opts.width + 'px';
  return pop;
}

export function menuAt(x, y, items, opts) { return openMenu({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }, items, { gap: 2, ...opts }); }

/** Modal dialog. Resolves with the action value (null when dismissed). */
export function openDialog({ title, content, actions = [], width, onMount, dismissable = true }) {
  return new Promise((resolve) => {
    const release = holdView();
    const prevFocus = document.activeElement;
    let closed = false;
    const body = h('div.dialog-body', content);
    const foot = h('div.dialog-foot');
    const dlg = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width: `min(${width}px, 100%)` } : null },
      h('div.dialog-head', h('h2', title), dismissable ? h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onClick: () => close(null) }, icon('close')) : null),
      body, actions.length ? foot : null);
    const back = h('div.backdrop', { onPointerdown: (e) => { if (e.target === back && dismissable) close(null); } }, dlg);
    const api = { close, body, dlg, setBusy(b) { foot.querySelectorAll('button').forEach((x) => (x.disabled = b)); } };
    for (const a of actions) {
      if (a.spacer) { foot.appendChild(h('span.spacer')); continue; }
      foot.appendChild(h('button.btn', { type: 'button', class: a.kind || '', dataset: a.primary ? { primary: '1' } : {}, onClick: async (e) => {
        if (a.onClick) {
          const btn = e.currentTarget; api.setBusy(true);
          let r; try { r = await a.onClick(api); } finally { if (!closed) api.setBusy(false); }
          if (r === false) return; close(r === undefined ? a.value ?? true : r);
        } else close(a.value ?? null);
      } }, a.icon ? icon(a.icon) : null, a.label));
    }
    function close(v) {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey, true);
      back.remove(); release();
      const i = open.indexOf(entry); if (i >= 0) open.splice(i, 1);
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
      resolve(v);
    }
    function onKey(e) {
      if (open[open.length - 1] !== entry) return;
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !e.shiftKey && !['TEXTAREA', 'BUTTON', 'SELECT'].includes(document.activeElement?.tagName)) {
        const p = foot.querySelector('button[data-primary]'); if (p && !p.disabled) { e.preventDefault(); p.click(); }
      } else trapFocus(dlg, e);
    }
    const entry = { el: back, close: () => close(null) };
    open.push(entry);
    layer().appendChild(back);
    document.addEventListener('keydown', onKey, true);
    onMount && onMount(api);
    const f = dlg.querySelector('[autofocus]') || body.querySelector('input, select, textarea') || foot.querySelector('button[data-primary]') || dlg.querySelector('button');
    f?.focus();
  });
}

export function confirmDialog({ title, message, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return openDialog({ title, content: h('p', message), width: 420, actions: [
    { label: cancel, value: false }, { label: ok, kind: danger ? 'danger' : 'primary', primary: true, value: true },
  ] });
}

/**
 * Form dialog. fields: { name, label, type: text|textarea|select|date|checkbox|password, value, options:[[v,label]], placeholder, required, hint, half }
 * Resolves with a values object or null.
 */
export function formDialog({ title, fields, submit = 'Save', width, intro, onSubmit }) {
  const inputs = {};
  const rows = []; let pending = null;
  for (const f of fields) {
    let input;
    if (f.type === 'select') input = h('select.select', { id: 'f-' + f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
    else if (f.type === 'textarea') input = h('textarea.textarea', { id: 'f-' + f.name, rows: f.rows || 6, placeholder: f.placeholder || '', dir: 'auto', spellcheck: false }, f.value || '');
    else if (f.type === 'checkbox') input = h('input.check', { id: 'f-' + f.name, type: 'checkbox', checked: !!f.value, disabled: !!f.disabled });
    else input = h('input.input', { id: 'f-' + f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', dir: f.type === 'date' ? null : 'auto', autocomplete: 'off', spellcheck: false });
    inputs[f.name] = input;
    const row = f.type === 'checkbox'
      ? h('label.check-row', input, h('span', f.label, f.hint ? h('small', ' — ' + f.hint) : null))
      : h('div.field', h('label', { for: 'f-' + f.name }, f.label), input, f.hint ? h('div.hint', f.hint) : null);
    if (f.half) { if (pending) { rows.push(h('div.form-row', pending, row)); pending = null; } else pending = row; }
    else { if (pending) { rows.push(pending); pending = null; } rows.push(row); }
  }
  if (pending) rows.push(pending);
  const err = h('div.chip.danger', { hidden: true, style: { height: 'auto', padding: '6px 10px', whiteSpace: 'normal', borderRadius: '8px' } });
  const read = () => Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value.trim()]));
  return openDialog({ title, width, content: [intro ? h('p', intro) : null, rows, err], actions: [
    { label: 'Cancel', value: null },
    { label: submit, kind: 'primary', primary: true, onClick: async () => {
      const v = read();
      const miss = fields.find((f) => f.required && !v[f.name]);
      if (miss) { err.hidden = false; err.textContent = `${miss.label} is required.`; inputs[miss.name].focus(); return false; }
      if (onSubmit) {
        try { const r = await onSubmit(v); return r === undefined ? v : r; }
        catch (e) { err.hidden = false; err.textContent = e?.message || 'Could not save.'; return false; }
      }
      return v;
    } },
  ] });
}

let toastBox;
export function toast(kind, message, ms = 4200) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); layer().appendChild(toastBox); }
  const t = h('div.toast', { class: kind }, icon(kind === 'error' ? 'alert' : kind === 'success' ? 'circleCheck' : 'info'), h('span', message));
  toastBox.appendChild(t);
  while (toastBox.children.length > 3) toastBox.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
}

export { append };
