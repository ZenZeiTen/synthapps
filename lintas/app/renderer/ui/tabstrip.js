// Title-bar tab strip: favicon, title, spinner, audio, close; pinned icon tabs; shrink-then-scroll overflow;
// pointer drag to reorder; middle-click to close; private tabs marked.
import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, call, parseInternal, modLabel } from '../lib/store.js';
import { favicon } from './widgets.js';
import { menuAt, openMenu } from './overlay.js';

const INTERNAL = {
  newtab: ['New tab', 'plus'], tms: ['Translation — TMS', 'tms'], 'tms-project': ['Project — TMS', 'tms'], 'tms-file': ['Editor — TMS', 'tms'],
  offline: ['Offline library', 'saveOffline'], history: ['History', 'history'], downloads: ['Downloads', 'download'], bookmarks: ['Bookmarks', 'star'], settings: ['Settings', 'settings'], extensions: ['Extensions', 'puzzle'],
};
export function tabTitle(t) {
  if (t.kind === 'internal') { const p = parseInternal(t.url); return S.titles.get(t.url) || t.title || (INTERNAL[p?.page] || ['Lintas'])[0]; }
  return t.title || t.url || 'New tab';
}
export function tabIconName(t) { const p = parseInternal(t.url); return (INTERNAL[p?.page] || ['', 'globe'])[1]; }

let root, scroller, dragging = null;

export function initTabstrip() {
  root = document.getElementById('tabstrip');
  scroller = h('div.tabs-scroll', { role: 'tablist', 'aria-label': 'Open tabs' });
  const newBtn = h('button.icon-btn.tab-new', { type: 'button', title: `New tab (${modLabel()}T)`, 'aria-label': 'New tab', onClick: () => call(L().tabs.create({})) }, icon('plus'));
  const listBtn = h('button.icon-btn.tab-list', { type: 'button', title: 'Search tabs', 'aria-label': 'List all tabs', onClick: (e) => listMenu(e.currentTarget) }, icon('chevDown'));
  const badge = h('span.private-badge', { hidden: true }, icon('private'), 'Private');
  mount(root, scroller, newBtn, h('div.drag-spacer'), badge, listBtn);
  if (S.preview && S.status.platform !== 'darwin') root.appendChild(h('div.fake-controls', { 'aria-hidden': 'true', title: 'Window controls are drawn by the OS in the real app' }, h('span', icon('winMin')), h('span', icon('winMax')), h('span', icon('close'))));
  scroller.addEventListener('wheel', (e) => { if (scroller.scrollWidth > scroller.clientWidth) { scroller.scrollLeft += e.deltaY || e.deltaX; e.preventDefault(); } }, { passive: false });
  root.addEventListener('dblclick', (e) => { if (e.target === root || e.target.classList.contains('drag-spacer')) e.preventDefault(); });
  new ResizeObserver(markNarrow).observe(scroller);
  on('tabs', render); on('titles', render);
  render();
  function listMenu(anchor) {
    openMenu(anchor, [{ header: `${S.tabs.length} open tabs` }, ...S.tabs.map((t) => ({ label: tabTitle(t), icon: t.private ? 'private' : (t.kind === 'internal' ? tabIconName(t) : 'globe'), checked: undefined, onClick: () => call(L().tabs.activate(t.id)) })),
      { sep: true }, { label: 'Reopen closed tab', icon: 'undo', shortcut: `${modLabel()}Shift+T`, onClick: () => call(L().tabs.reopenClosed()) }], { align: 'right', width: 320 });
  }
}

function render() {
  if (dragging) { dragging.stale = true; return; }
  const act = S.tabs.find((t) => t.active);
  document.documentElement.dataset.private = act?.private ? '1' : '0';
  root.querySelector('.private-badge').hidden = !act?.private;
  const focusedId = document.activeElement?.closest?.('.tab')?.dataset.id;
  mount(scroller, S.tabs.map(tabEl));
  markNarrow();
  const a = scroller.querySelector('.tab.active');
  if (a) { const r = a.getBoundingClientRect(), s = scroller.getBoundingClientRect(); if (r.left < s.left + 8 || r.right > s.right - 8) a.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
  if (focusedId) scroller.querySelector(`.tab[data-id="${CSS.escape(focusedId)}"]`)?.focus();
}

function markNarrow() { for (const el of scroller.children) if (!el.classList.contains('pinned')) el.classList.toggle('narrow', el.offsetWidth < 92); }

function tabEl(t) {
  const title = tabTitle(t);
  const ic = t.loading ? h('span.spinner') : t.private && t.kind === 'internal' ? icon('private') : t.kind === 'internal' ? icon(tabIconName(t)) : t.error ? icon('alert') : favicon(t.favicon, t.url, t.favicon ? null : 'globe');
  const el = h('div.tab', {
    class: [t.active && 'active', t.pinned && 'pinned', t.private && 'private'].filter(Boolean).join(' '), role: 'tab', 'aria-selected': String(!!t.active), tabIndex: t.active ? 0 : -1,
    title: title + (t.kind === 'web' ? '\n' + t.url : '') + (t.private ? '\nPrivate tab' : ''), dataset: { id: t.id },
  },
    t.active ? [h('i.curve.l'), h('i.curve.r')] : null,
    h('span.tab-icon', ic),
    h('span.tab-title', { dir: 'auto' }, title),
    (t.audible || t.muted) ? h('button.tab-audio', { type: 'button', tabIndex: -1, title: t.muted ? 'Unmute tab' : 'Mute tab', 'aria-label': t.muted ? 'Unmute tab' : 'Mute tab', onPointerdown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); call(L().tabs.mute(t.id, !t.muted)); } }, icon(t.muted ? 'volumeOff' : 'volume')) : null,
    h('button.tab-close', { type: 'button', tabIndex: -1, title: `Close tab (${modLabel()}W)`, 'aria-label': 'Close tab', onPointerdown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); call(L().tabs.close(t.id)); } }, icon('close')));
  el.addEventListener('pointerdown', (e) => startDrag(e, el, t));
  el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); call(L().tabs.close(t.id)); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(e, t); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); call(L().tabs.activate(t.id)); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const sib = e.key === 'ArrowRight' ? el.nextElementSibling : el.previousElementSibling; if (sib) { e.preventDefault(); sib.focus(); call(L().tabs.activate(Number(sib.dataset.id) || sib.dataset.id)); } }
    else if (e.key === 'Delete') call(L().tabs.close(t.id));
  });
  return el;
}

function tabMenu(e, t) {
  const i = S.tabs.indexOf(t);
  menuAt(e.clientX, e.clientY, [
    { label: 'Reload', icon: 'reload', onClick: () => call(L().nav.reload(t.id, { hard: false })) },
    { label: 'Duplicate', icon: 'copy', onClick: () => call(L().tabs.duplicate(t.id)) },
    { label: t.pinned ? 'Unpin tab' : 'Pin tab', icon: 'pin', onClick: () => call(L().tabs.pin(t.id, !t.pinned)) },
    t.kind === 'web' ? { label: t.muted ? 'Unmute tab' : 'Mute tab', icon: t.muted ? 'volume' : 'volumeOff', onClick: () => call(L().tabs.mute(t.id, !t.muted)) } : null,
    { sep: true },
    { label: 'Close tab', icon: 'close', shortcut: `${modLabel()}W`, onClick: () => call(L().tabs.close(t.id)) },
    { label: 'Close other tabs', disabled: S.tabs.filter((x) => !x.pinned).length <= 1, onClick: async () => { for (const x of S.tabs.filter((x) => x.id !== t.id && !x.pinned)) await call(L().tabs.close(x.id)); }, icon: null },
    { label: 'Close tabs to the right', disabled: i === S.tabs.length - 1, onClick: async () => { for (const x of S.tabs.slice(i + 1)) await call(L().tabs.close(x.id)); } },
    { sep: true },
    { label: 'Reopen closed tab', icon: 'undo', shortcut: `${modLabel()}Shift+T`, onClick: () => call(L().tabs.reopenClosed()) },
  ], { iconGutter: true });
}

function startDrag(e, el, t) {
  if (e.button !== 0) return;
  // block re-renders until the pointer is released so a drag keeps its element; show the activation at once
  dragging = { stale: false };
  if (!t.active) {
    for (const x of S.tabs) x.active = x.id === t.id;
    const prev = scroller.querySelector('.tab.active'); if (prev) { prev.classList.remove('active'); prev.querySelectorAll('.curve').forEach((c) => c.remove()); prev.setAttribute('aria-selected', 'false'); }
    el.classList.add('active'); el.setAttribute('aria-selected', 'true'); el.prepend(h('i.curve.l'), h('i.curve.r'));
    call(L().tabs.activate(t.id));
  }
  const startX = e.clientX, sibs = [...scroller.children], index = sibs.indexOf(el);
  const group = sibs.filter((s) => s.classList.contains('pinned') === el.classList.contains('pinned'));
  const rects = new Map(sibs.map((s) => [s, s.getBoundingClientRect()]));
  const mine = rects.get(el), first = rects.get(group[0]), last = rects.get(group[group.length - 1]);
  let moved = false, target = index;
  const move = (ev) => {
    const dx = ev.clientX - startX;
    if (!moved) { if (Math.abs(dx) < 5) return; moved = true; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } for (const s of group) if (s !== el) s.classList.add('shift'); }
    const clamped = Math.max(first.left - mine.left, Math.min(last.right - mine.right, dx));
    el.style.transform = `translateX(${clamped}px)`;
    const center = mine.left + mine.width / 2 + clamped;
    target = index;
    for (const s of group) {
      if (s === el) continue; const r = rects.get(s), si = sibs.indexOf(s); let tx = 0;
      if (si < index && center < r.left + r.width / 2) { tx = mine.width; target = Math.min(target, si); }
      else if (si > index && center > r.left + r.width / 2) { tx = -mine.width; target = Math.max(target, si); }
      s.style.transform = tx ? `translateX(${tx}px)` : '';
    }
  };
  const up = async () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!moved) { const stale = dragging?.stale; dragging = null; if (stale) render(); return; }
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; window.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', stop, true), 50);
    if (target !== index) {
      // optimistic local reorder so the strip does not snap back while main answers
      const moving = S.tabs.splice(index, 1)[0]; S.tabs.splice(target, 0, moving);
      dragging = null; render();
      await call(L().tabs.move(t.id, target));
    } else { dragging = null; render(); }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
