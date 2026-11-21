// Error page for a web tab whose navigation failed (tab.error). Offers the saved copy when one exists.
import { h, mount, hostOf, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { S, L, call } from '../lib/store.js';
import { openInternal } from '../ui/toolbar.js';

const NAMES = { '-105': 'DNS_NAME_NOT_RESOLVED', '-106': 'INTERNET_DISCONNECTED', '-102': 'CONNECTION_REFUSED', '-118': 'CONNECTION_TIMED_OUT', '-7': 'TIMED_OUT', '-101': 'CONNECTION_RESET', '-109': 'ADDRESS_UNREACHABLE', '-137': 'NAME_RESOLUTION_FAILED', '-21': 'NETWORK_CHANGED' };

export default function errorPage(el, ctx) {
  const t = ctx.tab, err = t.error || {}, url = err.url || t.url, host = hostOf(url) || url;
  const code = Number(err.code);
  const offline = code === -106 || S.online === false;
  const cert = code <= -200 && code >= -299;
  const dns = code === -105 || code === -137;
  const httpsFail = err.code === 'HTTPS_ONLY' || (!offline && !cert && !dns && !!S.settings.httpsOnly && /^https:\/\//i.test(url) && ((code <= -100 && code > -200) || code === -501 || code === -7));
  const retry = h('button.btn', { type: 'button', onClick: () => call(L().nav.reload(t.id, { hard: false })) }, icon('reload'), 'Try again');
  const copy = t.offlineCopy ? h('div.err-copy', icon('offlineDone'), h('span.grow', h('b', 'A saved copy is available'), h('br'), `Saved ${relTime(t.offlineCopy.savedAt)} — opens without a connection.`),
    h('button.btn.primary', { type: 'button', autofocus: true, onClick: () => call(L().offline.open(t.offlineCopy.id, { newTab: false })) }, 'Open saved copy')) : null;
  const lib = h('button.btn.ghost', { type: 'button', onClick: () => openInternal('lintas://offline') }, 'Offline library');
  const codeLine = h('div.err-code', err.code != null ? `Error ${NAMES[String(err.code)] ? 'ERR_' + NAMES[String(err.code)] : err.code}` : '');
  let box;
  if (offline) {
    box = h('div.err-box', h('div.err-art', icon('wifiOff')), h('h1', 'You’re offline'),
      h('p', h('b', host), ' can’t be reached because this computer isn’t connected to the internet. Your translation projects, termbases and saved pages still work.'),
      copy, h('div.acts', retry, lib, h('button.btn.ghost', { type: 'button', onClick: () => openInternal('lintas://tms') }, 'Open TMS')), codeLine);
  } else if (httpsFail) {
    box = h('div.err-box.warn', h('div.err-art', icon('unlock')), h('h1', 'This site doesn’t support a secure connection'),
      h('p', 'HTTPS-only mode is on, and ', h('b', host), ' could not be opened over an encrypted connection. If you continue, anything you send or read on this site could be seen or changed by others on the network.'),
      h('div.url', url), copy,
      h('div.acts', t.canGoBack ? h('button.btn.primary', { type: 'button', onClick: () => call(L().nav.back(t.id)) }, 'Go back') : retry,
        t.canGoBack ? retry : null, h('button.btn.danger', { type: 'button', onClick: () => call(L().nav.allowHttp(t.id)) }, 'Continue to the HTTP site')),
      h('p.err-code', 'The exception lasts until you close Lintas. ', err.description || ''));
  } else if (cert) {
    box = h('div.err-box.danger', h('div.err-art', icon('warning')), h('h1', 'Your connection isn’t private'),
      h('p', 'Lintas could not verify that this is really ', h('b', host), '. Its security certificate is not trusted, has expired, or belongs to a different site. Someone may be trying to intercept your connection.'),
      h('div.url', url), copy, h('div.acts', t.canGoBack ? h('button.btn.primary', { type: 'button', onClick: () => call(L().nav.back(t.id)) }, 'Go back to safety') : null, retry), codeLine, err.description ? h('p.err-code', err.description) : null);
  } else {
    box = h('div.err-box', h('div.err-art', icon(dns ? 'search' : 'alert')), h('h1', dns ? 'This site can’t be found' : 'This page isn’t working'),
      h('p', err.description || (dns ? 'The server address could not be found.' : 'The page could not be loaded.')), h('div.url', url), copy,
      h('ul.err-tips', dns ? [h('li', 'Check the address for typing mistakes.'), h('li', 'Search for the site instead.')] : [h('li', 'Try again in a moment.'), h('li', 'Check your network connection.')]),
      h('div.acts', retry, dns ? h('button.btn', { type: 'button', onClick: () => call(L().nav.go(t.id, host.replace(/\.[a-z]+$/i, '').replace(/[.-]/g, ' '))) }, icon('search'), 'Search instead') : null, lib), codeLine);
  }
  mount(el, h('div.err-page', box));
}
