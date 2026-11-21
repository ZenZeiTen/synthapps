// Bookmarks bar (toggleable): top-level bookmarks as chips, folders as menus, overflow menu.
import { h, mount, favLetter } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, call, go, refreshBookmarks } from '../lib/store.js';
import { openMenu, menuAt } from './overlay.js';

let bar;
export function initBookmarksBar() {
  bar = document.getElementById('bookmarksbar');
  on('bookmarks', render); on('settings', render);
  new ResizeObserver(fit).observe(bar);
  render();
}

function open(b, e) { go(b.url, { newTab: !!(e && (e.ctrlKey || e.metaKey || e.button === 1)) }); }
function ctx(e, b) {
  e.preventDefault();
  menuAt(e.clientX, e.clientY, [
    { label: 'Open in new tab', icon: 'external', onClick: () => go(b.url, { newTab: true }) },
    { label: 'Open in private tab', icon: 'private', onClick: () => call(L().tabs.create({ url: b.url, private: true })) },
    { sep: true },
    { label: 'Remove bookmark', icon: 'trash', danger: true, onClick: async () => { await call(L().bookmarks.remove(b.id)); refreshBookmarks(); } },
  ]);
}

function render() {
  bar.hidden = !S.settings.showBookmarksBar;
  if (bar.hidden) return;
  const top = S.bookmarks.filter((b) => !b.folder);
  const folders = [...new Set(S.bookmarks.filter((b) => b.folder).map((b) => b.folder))];
  const items = top.map((b) => h('button.bm', { type: 'button', title: `${b.title}\n${b.url}`, onClick: (e) => open(b, e), onAuxclick: (e) => { if (e.button === 1) open(b, e); }, onContextmenu: (e) => ctx(e, b) }, favLetter(b.url), h('span.t', { dir: 'auto' }, b.title)));
  const fl = folders.map((f) => h('button.bm', { type: 'button', title: f, 'aria-haspopup': 'menu', onClick: (e) => openMenu(e.currentTarget, S.bookmarks.filter((b) => b.folder === f).map((b) => ({ label: b.title, icon: favLetter(b.url), onClick: () => open(b) })), { width: 260 }) }, icon('folder'), h('span.t', f)));
  const more = h('button.bm.bm-more', { type: 'button', hidden: true, title: 'More bookmarks', 'aria-label': 'More bookmarks', onClick: (e) => openMenu(e.currentTarget, [...bar.querySelectorAll('.bm[data-over]')].map((x) => x._item), { align: 'right', width: 260 }) }, icon('chevRight'));
  items.forEach((el, i) => { el._item = { label: top[i].title, icon: favLetter(top[i].url), onClick: () => open(top[i]) }; });
  fl.forEach((el, i) => { el._item = { label: folders[i], icon: 'folder', onClick: () => el.click() }; });
  mount(bar, S.bookmarks.length ? [items, items.length && fl.length ? h('span.bm-sep') : null, fl, h('span.grow'), more] : h('span.bm-empty', 'Bookmark pages with the star in the address bar and they will appear here.'));
  fit();
}

function fit() {
  if (!bar || bar.hidden) return;
  const more = bar.querySelector('.bm-more'); if (!more) return;
  const els = [...bar.querySelectorAll('.bm:not(.bm-more)')];
  for (const e of els) { e.hidden = false; delete e.dataset.over; }
  more.hidden = true;
  const limit = bar.clientWidth - 16;
  let over = false;
  for (const e of els) { if (over || e.offsetLeft + e.offsetWidth > limit - 36) { over = true; e.hidden = true; e.dataset.over = '1'; } }
  more.hidden = !over;
}
