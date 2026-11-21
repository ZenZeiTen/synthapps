// lintas://newtab — search, shortcuts, active TMS projects, recent offline pages, status.
import { h, mount, favLetter, hostOf, relTime, dueInfo, fmtNum } from '../lib/dom.js';
import { icon, logoMark } from '../lib/icons.js';
import { S, L, on, call } from '../lib/store.js';
import { ring, langPair, favicon } from '../ui/widgets.js';

export default function newtab(el, ctx) {
  const priv = !!ctx.tab.private;
  const search = h('input', { type: 'text', placeholder: priv ? 'Search privately or enter address' : 'Search the web or enter address', 'aria-label': 'Search the web or enter address', spellcheck: false, autocomplete: 'off', dir: 'auto' });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) call(L().nav.go(ctx.tabId, search.value.trim())); });
  const searchBox = h('div.nt-search', icon('search'), search);

  if (priv) {
    mount(el, h('div.nt', h('div.nt-private', h('div.mask', icon('private')), h('h1', 'Private tab'),
      h('p', 'Lintas will not keep what you do in this tab.'),
      h('ul', h('li', 'Pages you visit are not added to history or saved for offline.'), h('li', 'Cookies and site data are deleted when you close the tab.'), h('li', 'Downloads and bookmarks you create are kept.')),
      h('p.muted', 'Websites, your employer or your internet provider can still see your activity.')), searchBox));
    return;
  }

  const tiles = h('div.nt-tiles'), tms = h('div'), off = h('div'), status = h('div.nt-status');
  const tile = (label, ico, onClick, title) => h('button.nt-tile', { type: 'button', title: title || label, onClick }, h('span.ico', ico), h('span.t', { dir: 'auto' }, label));

  function drawTiles() {
    const marks = S.bookmarks.filter((b) => !b.folder).slice(0, 5);
    mount(tiles,
      tile('Translation', icon('tms'), () => ctx.navigate('lintas://tms'), 'Translation management system'),
      tile('Offline library', icon('saveOffline'), () => ctx.navigate('lintas://offline')),
      marks.map((b) => tile(b.title, favLetter(b.url), () => ctx.navigate(b.url), b.url)),
      marks.length < 5 ? tile('History', icon('history'), () => ctx.navigate('lintas://history')) : null,
      tile('Bookmarks', icon('star'), () => ctx.navigate('lintas://bookmarks')));
  }
  function drawStatus() {
    const s = S.settings;
    mount(status,
      h('span.chip', { class: S.online ? 'ok' : 'warn' }, icon(S.online ? 'wifi' : 'wifiOff'), S.online ? 'Online' : 'Offline — saved pages and TMS available'),
      h('span.chip', { class: s.blockTrackers ? 'ok' : 'warn' }, icon('shieldCheck'), s.blockTrackers ? 'Trackers blocked' : 'Tracker blocking off'),
      h('span.chip', { class: s.httpsOnly ? 'ok' : 'warn' }, icon('lock'), s.httpsOnly ? 'HTTPS-only' : 'HTTPS-only off'),
      h('span.chip', { class: S.status.hasApiKey ? 'ok' : 'warn' }, icon('sparkle'), S.status.hasApiKey ? 'AI ready' : 'AI: add an API key'));
  }
  async function drawData() {
    const [dash, pages] = await Promise.all([call(L().tms.dashboard(), { silent: true }), call(L().offline.list({}), { silent: true })]);
    const projects = (dash?.projects || []).filter((p) => p.stats.progress < 1 || true).sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity)).slice(0, 4);
    mount(tms, projects.length ? projects.map((p) => {
      const due = dueInfo(p.dueDate);
      return h('button.nt-proj', { type: 'button', onClick: () => ctx.navigate(`lintas://tms/project/${encodeURIComponent(p.id)}`) },
        ring(p.stats.progress, { size: 40 }), h('span.name', { dir: 'auto' }, p.name),
        h('span.meta', langPair(p.sourceLang, p.targetLang), h('span.ellipsis', `${fmtNum(p.stats.words)} words · ${p.fileCount} file${p.fileCount === 1 ? '' : 's'}`)),
        due ? h('span.chip.due', { class: due.tone }, icon('calendar'), due.text) : null);
    }) : h('div.empty', { style: { padding: '24px' } }, icon('tms'), h('h3', 'No projects yet'), h('p', 'Create a project to translate files, text or web pages.'), h('button.btn.primary', { type: 'button', onClick: () => ctx.navigate('lintas://tms') }, 'Open TMS')));
    mount(off, (pages || []).length ? pages.slice(0, 4).map((p) => h('button.list-row', { type: 'button', title: p.url, onClick: () => call(L().offline.open(p.id, { newTab: false })) },
      favicon(null, p.url), h('span.lr-main', h('span.lr-title', { dir: 'auto' }, p.title), h('span.lr-sub', `${hostOf(p.url)} · saved ${relTime(p.savedAt)}`))))
      : h('div.empty', { style: { padding: '24px' } }, icon('saveOffline'), h('h3', 'Nothing saved yet'), h('p', 'Save pages to read and translate them without a connection.')));
  }

  mount(el, h('div.nt',
    h('div.nt-brand', h('div.word', logoMark(40), 'Lintas'), h('div.tag', 'Browse, translate and keep working — online or off.')),
    searchBox, tiles,
    h('div.nt-cards',
      h('section.card.nt-card', h('header', h('h2', icon('tms'), 'Translation projects'), h('button.btn.sm.ghost', { type: 'button', onClick: () => ctx.navigate('lintas://tms') }, 'Open TMS')), tms),
      h('section.card.nt-card', h('header', h('h2', icon('saveOffline'), 'Saved for offline'), h('button.btn.sm.ghost', { type: 'button', onClick: () => ctx.navigate('lintas://offline') }, 'Library')), off)),
    status));
  drawTiles(); drawStatus(); drawData();
  const offs = [on('bookmarks', drawTiles), on('settings', drawStatus), on('online', drawStatus), on('status', drawStatus), on('offline-changed', drawData)];
  return () => offs.forEach((f) => f());
}
