// lintas://extensions — installed Chrome extensions, install from the Web Store, load unpacked.
import { h, mount, errText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { L, call, go } from '../lib/store.js';
import { btn, emptyState, withBusy } from '../ui/widgets.js';
import { confirmDialog, toast } from '../ui/overlay.js';

export default function extensionsPage(el) {
  const list = h('div');
  const input = h('input.input', { type: 'text', placeholder: 'Chrome Web Store link or extension ID', 'aria-label': 'Chrome Web Store link or extension ID', spellcheck: false, style: { flex: '1', minWidth: '260px' } });
  const install = h('button.btn.primary', { type: 'button' }, icon('plus'), 'Install');
  install.addEventListener('click', () => {
    if (!input.value.trim()) return input.focus();
    withBusy(install, async () => {
      try { const e = await L().extensions.installFromStore(input.value); input.value = ''; toast('success', `${e?.name || 'Extension'} installed`); load(); }
      catch (e) { toast('error', errText(e, 'The extension could not be installed.')); }
    });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') install.click(); });

  async function load() {
    const items = (await call(L().extensions.list(), { silent: true })) || [];
    if (!items.length) return mount(list, h('div.card', emptyState('puzzle', 'No extensions yet', 'Open the Chrome Web Store and choose “Add to Chrome”, or paste a store link above.')));
    mount(list, h('div.card.list-card', items.map((x) => h('div.list-row',
      h('span.lr-main',
        h('span.lr-title', { dir: 'auto' }, `${x.name} `, h('span.chip', 'v' + x.version), x.source === 'unpacked' ? h('span.chip', 'Unpacked') : null, x.manifestVersion === 2 ? h('span.chip', { title: 'Manifest V2 extensions may not work fully' }, 'MV2') : null),
        h('span.lr-sub', { dir: 'auto' }, x.description || x.id),
        x.permissions.length ? h('span.lr-sub', 'Can access: ' + x.permissions.slice(0, 8).join(', ') + (x.permissions.length > 8 ? '…' : '')) : null),
      x.optionsUrl ? btn('Options', { onClick: () => call(L().extensions.openOptions(x.id)) }) : null,
      btn('Remove', { ic: 'trash', onClick: async () => {
        if (!(await confirmDialog({ title: `Remove ${x.name}?`, message: 'The extension and its data are removed from Lintas.', ok: 'Remove', danger: true }))) return;
        await call(L().extensions.remove(x.id)); toast('info', `${x.name} removed`); load();
      } })))));
  }

  mount(el, h('div.page',
    h('div.page-head', h('div', h('h1', icon('puzzle'), 'Extensions'), h('div.sub', 'Chrome extensions run in normal tabs. Their buttons appear next to the address bar.')), h('span.grow'),
      btn('Open Chrome Web Store', { ic: 'globe', onClick: () => go('https://chromewebstore.google.com/', { newTab: true }) }),
      btn('Load unpacked…', { ic: 'folder', onClick: async () => {
        try { const r = await L().extensions.loadUnpacked(); if (r) { toast('success', `${r.name} loaded`); load(); } }
        catch (e) { toast('error', errText(e, 'The extension could not be loaded.')); }
      } })),
    h('div.card', { style: { display: 'flex', gap: '8px', padding: '12px', marginBottom: '16px', flexWrap: 'wrap' } }, input, install),
    list));
  load();
}
