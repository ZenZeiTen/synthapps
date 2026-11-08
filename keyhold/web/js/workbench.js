// Main-window tools modelled on Password Safe's interface: the entry context
// menu, the status bar, the flat table view ("Flattened List"), "Display subset
// of password", folder actions and the password policy editor.
import { h, icon, iconBtn, fill, toast, modal, confirmBox } from './ui.js';
import { TYPES, primaryKey, hostOf, safeUrl, parsePositions, cleanFolder, newItem, DEFAULT_POLICY, subtitle } from './model.js';
import { generatePassword } from './generator.js';
import { parseTotp, totpCode } from './totp.js';
import { uuid } from './crypto.js';

// ---------- popup menu ----------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (openMenu && e.key === 'Escape') { e.preventDefault(); closeMenu(); } }, true);
addEventListener('resize', closeMenu);

/** entries: [{ label, icon, run, disabled, danger }] or '-' for a separator. */
export function popupMenu(x, y, entries, label = 'Actions') {
  closeMenu();
  const btns = [];
  const m = h('div', { class: 'menu', role: 'menu', 'aria-label': label },
    entries.filter(Boolean).map((e) => {
      if (e === '-') return h('div', { class: 'menu-sep', role: 'separator' });
      const b = h('button', { type: 'button', role: 'menuitem', class: e.danger ? 'danger' : '', disabled: e.disabled,
        onclick: () => { closeMenu(); e.run(); } }, icon(e.icon || 'dot'), h('span', { text: e.label }), e.hint ? h('kbd', { text: e.hint }) : null);
      btns.push(b);
      return b;
    }));
  m.addEventListener('keydown', (e) => {
    const live = btns.filter((b) => !b.disabled);
    const i = live.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); live[(i + 1) % live.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); live[(i - 1 + live.length) % live.length].focus(); }
    if (e.key === 'Tab') closeMenu();
  });
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  openMenu = m;
  const first = btns.find((b) => !b.disabled);
  if (first) first.focus();
}

export function menuAt(ev, anchor) {
  if (ev && ev.clientX) return [ev.clientX, ev.clientY];
  const r = anchor.getBoundingClientRect();
  return [r.left, r.bottom + 4];
}

// ---------- entry actions ----------
function secretOf(it) {
  const pk = primaryKey(it.type);
  return pk ? { key: pk, value: it.fields[pk] || '', label: TYPES[it.type].fields.find((f) => f.key === pk).label } : null;
}

/** The right-click menu of an item (Password Safe's entry context menu). */
export function itemMenu(app, it, x, y) {
  const s = app.state.session;
  const sec = secretOf(it);
  const url = it.type === 'login' && safeUrl(it.fields.url);
  if (it.deletedAt) {
    return popupMenu(x, y, [
      { label: 'Restore', icon: 'history', run: () => s.restore(it.id).then(() => toast('Restored')).catch(app.fail) },
      { label: 'Delete for good…', icon: 'trash', danger: true, run: () => app.purgeOne(it) },
    ], it.title);
  }
  const ro = s.readOnly;
  popupMenu(x, y, [
    it.fields.username ? { label: 'Copy username', icon: 'person', hint: 'U', run: () => app.copy(it.fields.username, 'Username', it) } : null,
    sec && sec.value ? { label: 'Copy ' + sec.label.toLowerCase(), icon: 'key', hint: 'C', run: () => app.copy(sec.value, sec.label, it) } : null,
    sec && sec.value ? { label: 'Show characters of ' + sec.label.toLowerCase() + '…', icon: 'eye', run: () => showSubset(app, it, sec) } : null,
    url ? { label: 'Copy website address', icon: 'copy', run: () => app.copy(it.fields.url, 'Website', it) } : null,
    it.fields.totp ? { label: 'Copy two-factor code', icon: 'clock', run: async () => { try { app.copy((await totpCode(parseTotp(it.fields.totp))).code, 'Code', it); } catch (e) { app.fail(e); } } } : null,
    url ? { label: 'Open website', icon: 'external', run: () => { window.open(url, '_blank', 'noopener,noreferrer'); s.touch(it.id).catch(() => {}); } } : null,
    url && sec && sec.value ? { label: 'Copy password and open website', icon: 'external', run: () => { app.copy(sec.value, sec.label, it); window.open(url, '_blank', 'noopener,noreferrer'); } } : null,
    '-',
    { label: 'Edit', icon: 'edit', hint: 'E', disabled: ro || it.protected, run: () => app.startEdit(it) },
    { label: 'Duplicate', icon: 'copy', disabled: ro, run: () => app.duplicate(it) },
    { label: it.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', disabled: ro, run: () => s.patchItem(it.id, { favorite: !it.favorite }).catch(app.fail) },
    { label: 'Move to folder…', icon: 'folder', disabled: ro || it.protected, run: () => moveToFolder(app, [it]) },
    { label: it.protected ? 'Unprotect' : 'Protect from changes', icon: 'lock', disabled: ro,
      run: () => s.patchItem(it.id, { protected: !it.protected }).then(() => toast(it.protected ? 'No longer protected' : 'Protected: it cannot be edited or deleted until you unprotect it')).catch(app.fail) },
    { label: 'Export this item…', icon: 'download', run: () => app.exportItems([it], it.title) },
    '-',
    { label: 'Move to trash', icon: 'trash', hint: 'Del', danger: true, disabled: ro || it.protected, run: () => app.trashItem(it) },
  ], it.title);
}

/** Password Safe's "Display subset of password": show only chosen character positions. */
export function showSubset(app, it, sec) {
  const v = sec.value;
  const chars = [...v];
  return modal((close) => {
    const input = h('input', { class: 'input mono', autofocus: true, placeholder: 'e.g. 1, 3, 8 or 2-4', 'aria-label': 'Positions' });
    const err = h('div', { class: 'error' });
    const out = h('div', { class: 'subset' });
    const draw = () => {
      err.textContent = '';
      fill(out);
      if (!input.value.trim()) return;
      try {
        const pos = parsePositions(input.value, chars.length);
        fill(out, pos.map((p) => h('div', { class: 'subset-cell' }, h('span', { class: 'pos', text: p }), h('span', { class: 'ch mono', text: chars[p - 1] === ' ' ? '␠' : chars[p - 1] }))));
        app.state.session.touch(it.id).catch(() => {});
      } catch (e) { err.textContent = e.message; }
    };
    input.addEventListener('input', draw);
    return {
      title: 'Characters of ' + sec.label.toLowerCase(),
      body: [h('p', { class: 'muted', text: `For sites that ask for "characters 2, 5 and 9". ${it.title} has ${chars.length} characters; positions start at 1 and -1 is the last one.` }),
        h('label', { class: 'field' }, h('span', { text: 'Positions' }), input), err, out],
      foot: h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Done'),
    };
  });
}

export async function moveToFolder(app, items) {
  const s = app.state.session;
  const folders = app.folderPaths();
  const path = await modal((close) => {
    const input = h('input', { class: 'input', autofocus: true, list: 'mv-folders', value: items.length === 1 ? items[0].folder : '', placeholder: 'No folder' });
    return {
      title: items.length === 1 ? `Move "${items[0].title}"` : `Move ${items.length} items`,
      body: h('form', { onsubmit: (e) => { e.preventDefault(); close({ v: input.value }); } },
        h('label', { class: 'field' }, h('span', { text: 'Folder (empty for none; use / for nested)' }), input),
        h('datalist', { id: 'mv-folders' }, folders.map((f) => h('option', { value: f })))),
      foot: [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: () => close({ v: input.value }) }, 'Move')],
    };
  });
  if (!path) return;
  const dest = cleanFolder(path.v);
  await s.change((p) => { for (const it of items) if (p.items[it.id]) p.items[it.id] = { ...p.items[it.id], folder: dest, updatedAt: new Date().toISOString() }; }).catch(app.fail);
  toast(dest ? 'Moved to ' + dest : 'Moved out of folders');
}

/** Folder right-click menu: new subfolder, rename (moves every item inside), delete when empty. */
export function folderMenu(app, path, x, y) {
  const s = app.state.session;
  const inside = s.items().filter((i) => !i.deletedAt && (i.folder === path || i.folder.startsWith(path + '/')));
  popupMenu(x, y, [
    { label: 'New folder inside…', icon: 'plus', disabled: s.readOnly, run: () => app.newFolder(path + '/') },
    { label: 'New item here', icon: 'plus', disabled: s.readOnly, run: () => { app.setFilter({ kind: 'folder', path }); app.chooseType(); } },
    { label: 'Rename…', icon: 'edit', disabled: s.readOnly, run: () => renameFolder(app, path) },
    { label: inside.length ? `Delete (move ${inside.length} item(s) to trash)…` : 'Delete folder', icon: 'trash', danger: true, disabled: s.readOnly,
      run: () => deleteFolder(app, path, inside) },
  ], path);
}

async function renameFolder(app, path) {
  const s = app.state.session;
  const name = await modal((close) => {
    const input = h('input', { class: 'input', autofocus: true, value: path });
    return {
      title: 'Rename folder',
      body: h('form', { onsubmit: (e) => { e.preventDefault(); close(input.value); } }, h('label', { class: 'field' }, h('span', { text: 'Full path' }), input)),
      foot: [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: () => close(input.value) }, 'Rename')],
    };
  });
  const to = name && cleanFolder(name);
  if (!to || to === path) return;
  const t = new Date().toISOString();
  const re = (f) => (f === path ? to : f.startsWith(path + '/') ? to + f.slice(path.length) : f);
  await s.change((p) => {
    for (const [id, it] of Object.entries(p.items)) if (re(it.folder) !== it.folder) p.items[id] = { ...it, folder: re(it.folder), updatedAt: t };
    p.settings = { ...p.settings, folders: [...new Set((p.settings.folders || []).map(re))], updatedAt: t };
  }).catch(app.fail);
  app.setFilter({ kind: 'folder', path: to });
  toast('Folder renamed');
}

async function deleteFolder(app, path, inside) {
  const s = app.state.session;
  if (inside.some((i) => i.protected)) { toast('This folder holds protected items. Unprotect them first.', { error: true }); return; }
  if (inside.length && !(await confirmBox('Delete folder?', `${inside.length} item(s) in "${path}" will move to the trash. You can restore them from there.`, { ok: 'Delete', danger: true }))) return;
  const t = new Date().toISOString();
  await s.change((p) => {
    for (const it of inside) p.items[it.id] = { ...p.items[it.id], deletedAt: t, updatedAt: t };
    p.settings = { ...p.settings, folders: (p.settings.folders || []).filter((f) => f !== path && !f.startsWith(path + '/')), updatedAt: t };
  }).catch(app.fail);
  app.setFilter({ kind: 'all' });
  toast('Folder deleted');
}

// ---------- table view (Password Safe's "Flattened List") ----------
export const COLUMNS = [
  { key: 'title', label: 'Name', get: (i) => i.title },
  { key: 'username', label: 'Username', get: (i) => i.fields.username || i.fields.cardholder || i.fields.accountName || i.fields.ssid || '' },
  { key: 'url', label: 'Website', get: (i) => hostOf(i.fields.url || i.fields.endpoint || '') },
  { key: 'folder', label: 'Folder', get: (i) => i.folder },
  { key: 'type', label: 'Type', get: (i) => TYPES[i.type].label },
  { key: 'createdAt', label: 'Created', date: true, get: (i) => i.createdAt },
  { key: 'passwordChangedAt', label: 'Secret changed', date: true, get: (i) => (primaryKey(i.type) && i.fields[primaryKey(i.type)] ? i.passwordChangedAt : '') },
  { key: 'updatedAt', label: 'Last changed', date: true, get: (i) => i.updatedAt },
  { key: 'expiresAt', label: 'Expires', date: true, get: (i) => i.expiresAt || '' },
  { key: 'accessedAt', label: 'Last used', date: true, access: true, get: (i) => i.accessedAt || '' },
];

export function sortByColumn(items, key, dir) {
  const col = COLUMNS.find((c) => c.key === key) || COLUMNS[0];
  return [...items].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (!x && y) return 1;
    if (x && !y) return -1;
    return (col.date ? (x < y ? -1 : x > y ? 1 : 0) : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true })) * dir;
  });
}

export function renderTable(app, items, { onRow }) {
  const st = app.state;
  const cols = COLUMNS.filter((c) => !c.access || st.session.settings.trackAccess);
  const { key, dir } = st.tableSort;
  const fmt = (c, v) => (c.date && v ? new Date(v).toLocaleDateString() : v);
  const head = h('tr', {}, cols.map((c) => h('th', { scope: 'col', 'aria-sort': c.key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
    h('button', { type: 'button', onclick: () => { st.tableSort = { key: c.key, dir: c.key === key ? -dir : 1 }; app.renderList(); } },
      c.label, c.key === key ? h('span', { class: 'sort', text: dir > 0 ? ' ▲' : ' ▼' }) : null))));
  const body = sortByColumn(items, key, dir).map((it) => onRow(it, h('tr', {
    class: it.id === st.selected ? 'sel' : '', tabindex: '0', dataset: { id: it.id }, 'aria-selected': String(it.id === st.selected),
  }, cols.map((c, i) => h('td', { title: i === 0 && st.session.settings.notesTooltip && it.notes ? it.notes.slice(0, 300) : null },
    i === 0 ? [it.protected ? icon('lock', 'tiny') : null, it.favorite ? icon('star', 'tiny fav') : null, fmt(c, c.get(it))] : fmt(c, c.get(it)))))));
  return h('table', { class: 'grid', role: 'grid', 'aria-label': 'Items' }, h('thead', {}, head), h('tbody', {}, body));
}

// ---------- status bar ----------
export function renderStatus(app, el) {
  const st = app.state, s = st.session;
  if (!s || !el) return;
  const live = s.items().filter((i) => !i.deletedAt).length;
  const shown = app.visibleItems().length;
  const m = s.settings.autoLockMinutes;
  const left = m > 0 ? Math.max(0, m * 60 - Math.floor((Date.now() - st.lastActive) / 1000)) : null;
  fill(el,
    h('span', { text: st.filter.kind === 'health' ? `${live} items` : `${shown} of ${live} items` }),
    h('span', { class: 'sep' }),
    h('span', { text: s.lastSaved ? 'Saved ' + s.lastSaved.toLocaleTimeString() : 'Opened ' + new Date(st.openedAt).toLocaleTimeString() }),
    h('span', { class: 'grow' }),
    left != null ? h('span', { class: 'lock-in', title: 'Auto-lock', text: `Locks in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : null,
    h('button', { type: 'button', class: 'st-btn', title: 'Remove anything Keyhold copied from the clipboard', onclick: () => app.clearClipboard(true) }, icon('x'), 'Clear clipboard'),
    h('button', { type: 'button', class: 'st-btn rw' + (s.readOnly ? ' ro' : ''), 'aria-pressed': String(s.readOnly),
      title: s.readOnly ? 'Read-only: click to allow changes' : 'Read-write: click to prevent changes',
      onclick: () => { s.readOnly = !s.readOnly; app.state.editing = null; app.renderAll(); toast(s.readOnly ? 'Read-only: nothing can be changed until you switch back' : 'Changes allowed again'); } },
    icon(s.readOnly ? 'lock' : 'edit'), s.readOnly ? 'Read-only' : 'Read-write'));
}

/** Update only the auto-lock countdown, so clicks on the status bar are never lost to a redraw. */
export function tickStatus(app, el) {
  const st = app.state, s = st.session;
  const span = el && el.querySelector('.lock-in');
  if (!s || !span) return;
  const m = s.settings.autoLockMinutes;
  const left = Math.max(0, m * 60 - Math.floor((Date.now() - st.lastActive) / 1000));
  span.textContent = `Locks in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

// ---------- password policies ----------
export function policyForm(start, { title, onSave, preview = true }) {
  return modal((close) => {
    const p = { ...DEFAULT_POLICY, ...start };
    const err = h('div', { class: 'error' });
    const sample = h('div', { class: 'gen-out', 'aria-live': 'polite' });
    const upd = () => { err.textContent = ''; try { sample.textContent = generatePassword(p); } catch (e) { sample.textContent = ''; err.textContent = e.message; } };
    const num = (k, min, max) => { const i = h('input', { class: 'input num', type: 'number', min, max, value: p[k], 'aria-label': k }); i.addEventListener('input', () => { p[k] = parseInt(i.value, 10) || 0; upd(); }); return i; };
    const chk = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p[k], onchange: (e) => { p[k] = e.target.checked; upd(); } }), label);
    const name = h('input', { class: 'input', value: p.name, autofocus: true, 'aria-label': 'Policy name' });
    const sym = h('input', { class: 'input mono', value: p.symbolSet, placeholder: '!@#$%^&*()-_=+[]{};:,.?/~', 'aria-label': 'Symbols to use' });
    sym.addEventListener('input', () => { p.symbolSet = sym.value; upd(); });
    upd();
    return {
      title,
      body: [
        h('label', { class: 'field' }, h('span', { text: 'Name' }), name),
        h('label', { class: 'field' }, h('span', { text: 'Length' }), num('length', 4, 128)),
        h('div', { class: 'policy-grid' },
          chk('lower', 'Lowercase a–z'), h('span', { class: 'muted small' }, 'at least ', num('minLower', 0, 64)),
          chk('upper', 'Uppercase A–Z'), h('span', { class: 'muted small' }, 'at least ', num('minUpper', 0, 64)),
          chk('digits', 'Digits 0–9'), h('span', { class: 'muted small' }, 'at least ', num('minDigits', 0, 64)),
          chk('symbols', 'Symbols'), h('span', { class: 'muted small' }, 'at least ', num('minSymbols', 0, 64))),
        h('label', { class: 'field' }, h('span', { text: 'Symbols to use (empty for the standard set)' }), sym),
        chk('avoidAmbiguous', 'Only easy-to-read characters (no l, 1, O, 0…)'),
        chk('pronounceable', 'Pronounceable (syllables)'),
        chk('hex', 'Hexadecimal digits only (0–9, a–f)'),
        preview ? [h('div', { class: 'small muted', text: 'Example' }), sample] : null, err,
      ],
      foot: [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          p.name = name.value.trim() || 'Policy';
          try { generatePassword(p); } catch (e) { err.textContent = e.message; return; }
          close(true); onSave({ ...p, id: p.id || uuid() });
        } }, 'Save')],
    };
  });
}

export function policiesSection(app, redraw) {
  const s = app.state.session;
  const list = s.settings.policies;
  const save = (next) => s.updateSettings({ policies: next }).then(redraw).catch(app.fail);
  return h('div', {},
    h('table', { class: 'table' }, h('tr', {}, h('th', { text: 'Policy' }), h('th', { text: 'Rules' }), h('th', { text: 'Used by' }), h('th')),
      list.map((p) => {
        const used = s.items().filter((i) => i.policyId === p.id && !i.deletedAt).length;
        const rules = p.hex ? 'hex' : [p.length + ' chars', p.lower && 'a–z', p.upper && 'A–Z', p.digits && '0–9', p.symbols && 'symbols', p.pronounceable && 'pronounceable', p.avoidAmbiguous && 'easy to read'].filter(Boolean).join(', ');
        return h('tr', {}, h('td', { text: p.name }), h('td', { class: 'small', text: rules }), h('td', { text: used || '—' }),
          h('td', {}, h('div', { class: 'btn-row' },
            iconBtn('edit', 'Edit ' + p.name, () => policyForm(p, { title: 'Edit policy', onSave: (np) => save(list.map((x) => (x.id === p.id ? np : x))) })),
            p.id === 'default' ? null : iconBtn('trash', 'Delete ' + p.name, async () => {
              if (await confirmBox('Delete policy?', used ? `${used} item(s) use it; they will use the default policy.` : `Delete "${p.name}"?`, { ok: 'Delete', danger: true })) save(list.filter((x) => x.id !== p.id));
            }))));
      })),
    h('div', { class: 'btn-row', style: 'margin-top:10px' },
      h('button', { class: 'btn', type: 'button', disabled: s.readOnly, onclick: () => policyForm({ ...DEFAULT_POLICY, id: null, name: 'New policy' }, { title: 'New policy', onSave: (np) => save([...list, np]) }) }, icon('plus'), 'New policy')));
}

export { newItem, subtitle };
