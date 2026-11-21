// lintas://settings + the "Clear browsing data" dialog.
import { h, mount, LANGS, fmtNum, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, on, call, setSettings, refreshStatus } from '../lib/store.js';
import { openDialog, toast, confirmDialog } from '../ui/overlay.js';
import { withBusy } from '../ui/widgets.js';

export async function clearDataDialog() {
  const boxes = { history: h('input.check', { type: 'checkbox', checked: true }), cookies: h('input.check', { type: 'checkbox', checked: true }), cache: h('input.check', { type: 'checkbox', checked: true }), offline: h('input.check', { type: 'checkbox' }) };
  const row = (k, title, sub) => h('label.check-row', { style: { alignItems: 'flex-start' } }, boxes[k], h('span', { style: { display: 'grid', gap: '2px' } }, h('b', { style: { fontWeight: 550 } }, title), h('small', sub)));
  return openDialog({ title: 'Clear browsing data', width: 480, content: [
    row('history', 'Browsing history', 'The list of pages you visited and address-bar suggestions from it.'),
    row('cookies', 'Cookies and site data', 'Signs you out of most websites.'),
    row('cache', 'Cached images and files', 'Frees disk space. Pages may load a little slower next time.'),
    row('offline', 'Offline library', 'Deletes every page saved for offline reading.'),
    h('div.sp-note', 'Bookmarks, translation projects, translation memories and termbases are never touched.'),
  ], actions: [{ label: 'Cancel', value: false }, { label: 'Clear data', kind: 'primary', primary: true, onClick: async () => {
    const sel = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.checked]));
    if (!Object.values(sel).some(Boolean)) return false;
    try { await L().privacy.clearData(sel); } catch (e) { toast('error', e?.message || 'Could not clear the data.'); return false; }
    toast('success', 'Browsing data cleared'); return true;
  } }] });
}

const SECTIONS = [['general', 'General', 'settings'], ['appearance', 'Appearance', 'sun'], ['privacy', 'Privacy & security', 'shieldCheck'], ['offline', 'Offline', 'saveOffline'], ['languages', 'Languages', 'translate'], ['ai', 'AI — Claude', 'sparkle'], ['about', 'About', 'info']];
const ENGINES = [['duckduckgo', 'DuckDuckGo'], ['startpage', 'Startpage'], ['brave', 'Brave Search'], ['google', 'Google'], ['bing', 'Bing']];

export default function settingsPage(el) {
  const main = h('div');
  const nav = h('nav.settings-nav', { 'aria-label': 'Settings sections' }, h('h1', 'Settings'), SECTIONS.map(([id, label, ic], i) => h('button', { type: 'button', class: i === 0 ? 'on' : '', dataset: { sec: id }, onClick: () => { main.querySelector('#set-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon(ic), label)));
  const set = (k) => (v) => setSettings({ [k]: v });
  const row = (title, sub, ctl) => h('div.set-row', h('div.txt', h('b', title), sub ? h('span', sub) : null), ctl);
  const toggle = (k, title, sub) => row(title, sub, h('input.switch', { type: 'checkbox', checked: !!S.settings[k], 'aria-label': title, onChange: (e) => set(k)(e.target.checked) }));
  const select = (k, title, sub, options) => row(title, sub, h('select.select', { 'aria-label': title, onChange: (e) => set(k)(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: S.settings[k] === v }, l))));
  const group = (id, title, ...rows) => h('section.set-group', { id: 'set-' + id }, h('h2', title), h('div.card.set-card', rows));

  function draw() {
    const s = S.settings, st = S.status;
    const theme = h('div.theme-pick', { role: 'group', 'aria-label': 'Theme' }, [['system', 'System', 'settings'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String((s.theme || 'system') === v), onClick: () => set('theme')(v) }, icon(ic), l)));
    // AI
    const key = h('input.input', { type: 'password', placeholder: st.hasApiKey ? '•••••••••••••••• (saved)' : 'sk-ant-…', 'aria-label': 'Claude API key', autocomplete: 'off', spellcheck: false, style: { width: '260px' } });
    const saveKey = h('button.btn.primary', { type: 'button' }, 'Save key');
    saveKey.addEventListener('click', () => { const v = key.value.trim(); if (!v) return key.focus(); withBusy(saveKey, async () => { const r = await call(L().settings.setApiKey(v)); if (r) { key.value = ''; toast('success', 'API key saved in the system keychain'); await refreshStatus(); } }); });
    const removeKey = h('button.btn.danger', { type: 'button', onClick: async () => { if (await confirmDialog({ title: 'Remove API key?', message: 'AI suggestions, review, page translation and the assistant will stop working until you add a key again.', ok: 'Remove key', danger: true })) { await call(L().settings.setApiKey('')); toast('info', 'API key removed'); await refreshStatus(); } } }, 'Remove');
    const models = h('div.model-list', { role: 'radiogroup', 'aria-label': 'Model' }, (st.models || []).map((m) => h('label.model-opt', h('input', { type: 'radio', name: 'model', value: m.id, checked: (s.model || st.model) === m.id, onChange: () => set('model')(m.id) }), h('span.txt', h('b', m.label || m.id), m.note ? h('span', m.note) : null))), (st.models || []).length ? null : h('span.muted', 'No models available.'));
    const usage = h('div.usage', h('span.muted', 'Loading usage…'));
    call(L().ai.usage(), { silent: true }).then((u) => { if (u) mount(usage, h('div', h('b', fmtNum(u.requests)), 'requests'), h('div', h('b', fmtNum(u.inputTokens)), 'input tokens'), h('div', h('b', fmtNum(u.outputTokens)), 'output tokens'), h('div', { style: { alignSelf: 'end' } }, 'this session', u.since ? ` · since ${relTime(u.since)}` : '')); });

    mount(main,
      group('general', 'General',
        select('searchEngine', 'Search engine', 'Used by the address bar and the new tab page.', ENGINES),
        toggle('restoreSession', 'Restore tabs on startup', 'Reopen the tabs you had when you last closed Lintas.'),
        toggle('showBookmarksBar', 'Show bookmarks bar', 'A row of bookmarks under the address bar.')),
      group('appearance', 'Appearance', row('Theme', 'System follows your operating system’s light or dark mode.', theme)),
      group('privacy', 'Privacy & security',
        toggle('httpsOnly', 'HTTPS-only mode', 'Always use an encrypted connection and warn before opening a site that does not support one.'),
        toggle('blockTrackers', 'Block trackers and ads', 'Stops known tracking and advertising requests. The shield in the address bar shows the count per page.'),
        toggle('blockThirdPartyCookies', 'Block third-party cookies', 'Prevents sites from following you across other sites.'),
        toggle('sendDoNotTrack', 'Send “Do Not Track” and Global Privacy Control', 'Asks websites not to track or sell your data.'),
        row('Clear browsing data', 'History, cookies, cache and the offline library.', h('button.btn', { type: 'button', onClick: () => clearDataDialog() }, icon('trash'), 'Clear data…'))),
      group('offline', 'Offline',
        toggle('autoSaveOffline', 'Auto-save visited pages', 'Every page you finish loading is saved to the offline library. Private tabs are never saved.'),
        row('Data folder', st.dataDir || '—', null)),
      group('languages', 'Languages',
        select('defaultSourceLang', 'Default source language', 'Pre-selected when you create a project.', LANGS),
        select('defaultTargetLang', 'Default target language', 'Also the default for “Translate page”.', LANGS),
        row('Interface language', 'More languages are planned.', h('select.select', { disabled: true, 'aria-label': 'Interface language' }, h('option', 'English')))),
      group('ai', 'AI — Claude',
        row('API key', st.hasApiKey ? 'A key is saved in your system keychain. It is never shown again and never leaves this computer except to call Claude.' : 'Paste your own Claude API key. It is encrypted with your system keychain and never shown again.',
          h('div.ctl', st.hasApiKey ? h('span.chip.ok', icon('check'), 'Key saved') : h('span.chip.warn', 'No key'), key, saveKey, st.hasApiKey ? removeKey : null)),
        h('div', { style: { borderTop: '1px solid var(--border)' } }, h('div.set-row', { style: { paddingBottom: 0, minHeight: 0 } }, h('div.txt', h('b', 'Model'), h('span', 'Used for suggestions, review, page translation and the assistant.'))), models),
        select('effort', 'Effort', 'Higher effort gives more careful answers and uses more tokens.', [['low', 'Low — fastest'], ['medium', 'Medium'], ['high', 'High — most careful']]),
        h('div', { style: { borderTop: '1px solid var(--border)' } }, usage)),
      group('about', 'About', row('Lintas ' + (st.version || ''), 'A fast, private browser with a translation management system built in. Your projects, memories and termbases stay on this computer.', h('span.chip', st.platform || ''))));
    main.querySelectorAll('.set-row .ctl').forEach((c) => { if (c.children.length > 2) c.parentElement.style.flexWrap = 'wrap'; });
  }
  mount(el, h('div.settings', nav, main));
  draw();
  const host = el; const spy = () => { let cur = SECTIONS[0][0]; for (const [id] of SECTIONS) { const g = main.querySelector('#set-' + id); if (g && g.getBoundingClientRect().top - host.getBoundingClientRect().top < 120) cur = id; } nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sec === cur)); };
  host.addEventListener('scroll', spy, { passive: true });
  const offs = [on('settings', () => { const y = host.scrollTop; const f = document.activeElement?.getAttribute?.('aria-label'); draw(); host.scrollTop = y; if (f) main.querySelector(`[aria-label="${CSS.escape(f)}"]`)?.focus(); }), on('status', draw)];
  return () => offs.forEach((f) => f());
}
