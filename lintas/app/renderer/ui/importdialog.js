// "Import from another browser": bookmarks, history and settings from Chrome, Edge, Brave,
// Vivaldi, Opera, Chromium or Firefox on this computer, or bookmarks from an HTML file.
import { h, mount, errText } from '../lib/dom.js';
import { L, call, refreshBookmarks } from '../lib/store.js';
import { openDialog, toast } from './overlay.js';

const summary = (r) => {
  const parts = [];
  if (r.bookmarks) parts.push(`${r.bookmarks} bookmark${r.bookmarks === 1 ? '' : 's'}`);
  if (r.history) parts.push(`${r.history} history entr${r.history === 1 ? 'y' : 'ies'}`);
  if (r.settings?.length) parts.push(r.settings.map(k => (k === 'searchEngine' ? 'search engine' : 'home page')).join(' and '));
  return parts.length ? `Imported ${parts.join(', ')} from ${r.source}.` : `Nothing new to import from ${r.source}.`;
};

async function done(r) {
  if (!r) return;
  await refreshBookmarks();
  toast('success', summary(r), 6000);
}

export async function importDialog() {
  const browsers = (await call(L().importer.detect(), { silent: true })) || [];
  const choices = browsers.flatMap(b => b.profiles.map(p => ({ b, p, label: b.profiles.length > 1 ? `${b.name} — ${p.name}` : b.name })));
  const sel = h('select.select', { 'aria-label': 'Browser', style: { width: '100%' } }, choices.map((c, i) => h('option', { value: String(i) }, c.label)));
  const box = (label, sub) => {
    const input = h('input', { type: 'checkbox', checked: true });
    return { input, el: h('label.check-row', { style: { alignItems: 'flex-start' } }, input, h('span', { style: { display: 'grid', gap: '2px' } }, h('b', { style: { fontWeight: 550 } }, label), h('small', sub))) };
  };
  const bm = box('Bookmarks', 'Folders are kept. Bookmarks you already have are skipped.');
  const hist = box('History', 'Up to the 5,000 most recent pages.');
  const set = box('Settings', 'Search engine and home page, when Lintas offers the same choice.');
  const err = h('div');
  const content = choices.length
    ? [h('div.field', h('label', 'Import from'), sel), h('div', { style: { display: 'grid', gap: '10px', margin: '14px 0' } }, bm.el, hist.el, set.el),
      h('p.muted', { style: { fontSize: 'var(--fs-12)', margin: 0 } }, 'Passwords, cookies and open tabs are not imported. The other browser and its data are not changed.'), err]
    : [h('p', 'No other browsers were found on this computer.'), h('p.muted', 'You can still import a bookmarks file: in your old browser, export bookmarks as HTML, then choose “From a bookmarks file…”.'), err];

  const fromFile = { label: 'From a bookmarks file…', onClick: async () => {
    try { const r = await L().importer.fromFile(); if (!r) return false; await done(r); return true; }
    catch (e) { mount(err, h('div.msg.err', errText(e, 'The file could not be imported.'))); return false; }
  } };
  const actions = choices.length
    ? [fromFile, { spacer: true }, { label: 'Cancel', value: null }, { label: 'Import', kind: 'primary', primary: true, onClick: async () => {
      const c = choices[Number(sel.value)];
      if (!bm.input.checked && !hist.input.checked && !set.input.checked) { mount(err, h('div.msg.err', 'Choose at least one thing to import.')); return false; }
      try {
        const r = await L().importer.run({ browserId: c.b.id, profileId: c.p.id, bookmarks: bm.input.checked, history: hist.input.checked, settings: set.input.checked });
        await done(r); return true;
      } catch (e) { mount(err, h('div.msg.err', errText(e, 'The import failed.'))); return false; }
    } }]
    : [fromFile, { spacer: true }, { label: 'Close', value: null }];
  return openDialog({ title: 'Import from another browser', content, actions, width: 520 });
}
