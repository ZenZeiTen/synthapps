// Session hardening: tracker blocking, HTTPS-first/HTTPS-only, third-party
// cookie stripping, Do Not Track / Global Privacy Control, permission prompts
// and a clean user agent.

// Common advertising and tracking hosts. A request is blocked when its host
// equals one of these or is a subdomain, and it is third-party to the page.
export const TRACKERS = `doubleclick.net googlesyndication.com googleadservices.com google-analytics.com googletagmanager.com
googletagservices.com adservice.google.com pagead2.googlesyndication.com analytics.google.com stats.g.doubleclick.net
connect.facebook.net facebook.com/tr pixel.facebook.com an.facebook.com scorecardresearch.com quantserve.com quantcount.com
hotjar.com hotjar.io criteo.com criteo.net taboola.com outbrain.com adnxs.com rubiconproject.com pubmatic.com openx.net
casalemedia.com amazon-adsystem.com adsrvr.org bidswitch.net mathtag.com moatads.com doubleverify.com adsafeprotected.com
chartbeat.com chartbeat.net mixpanel.com cdn.segment.com api.segment.io amplitude.com cdn.amplitude.com fullstory.com
mouseflow.com crazyegg.com clarity.ms bat.bing.com ads-twitter.com analytics.twitter.com static.ads-twitter.com
ads.linkedin.com px.ads.linkedin.com snap.licdn.com analytics.tiktok.com ads.tiktok.com sc-static.net tr.snapchat.com
yandex.ru/metrika mc.yandex.ru top-fwz1.mail.ru counter.yadro.ru adform.net serving-sys.com smartadserver.com 3lift.com
sharethrough.com teads.tv yieldmo.com indexww.com contextweb.com lijit.com sovrn.com gumgum.com media.net revcontent.com
mgid.com zemanta.com advertising.com adtechus.com yahoo.com/pixel ads.yahoo.com analytics.yahoo.com demdex.net omtrdc.net
everesttech.net krxd.net bluekai.com exelator.com eyeota.net crwdcntrl.net tapad.com agkn.com rlcdn.com liadm.com
id5-sync.com adroll.com perfectaudience.com zedo.com popads.net popcash.net propellerads.com adcash.com exoclick.com
juicyads.com trafficjunky.net inmobi.com applovin.com unityads.unity3d.com vungle.com chartboost.com branch.io
app-measurement.com firebaselogging.googleapis.com newrelic.com nr-data.net bam.nr-data.net sentry-cdn.com
optimizely.com cdn.optimizely.com kissmetrics.com woopra.com statcounter.com histats.com hit.gemius.pl
onesignal.com pushcrew.com webengage.com clevertap.com moengage.com braze.com intercomcdn.com/tracking
heapanalytics.com cdn.heapanalytics.com piwik.pro matomo.cloud plausible.io/api/event`.split(/\s+/).filter(Boolean);

const HOSTS = new Set(TRACKERS.filter(t => !t.includes('/')));
const PATHS = TRACKERS.filter(t => t.includes('/')).map(t => { const i = t.indexOf('/'); return [t.slice(0, i), t.slice(i)]; });

export function isTracker(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const host = u.hostname;
  for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (HOSTS.has(h)) return true;
  return PATHS.some(([h, p]) => (host === h || host.endsWith('.' + h)) && u.pathname.startsWith(p));
}

const TWO_LEVEL = /^(co|com|net|org|gov|go|ac|or|web|my|sch|mil|biz|ne|gob|edu)\.[a-z]{2}$/;

/** Approximate registrable domain ("site"), e.g. news.detik.com → detik.com, a.b.co.id → b.co.id. */
export function siteOf(host) {
  if (!host) return '';
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.test(last2) ? parts.slice(-3).join('.') : last2;
}

export function isThirdParty(reqUrl, pageUrl) {
  try {
    return siteOf(new URL(reqUrl).hostname) !== siteOf(new URL(pageUrl).hostname);
  } catch { return false; }
}

const PROMPTABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'pointerLock', 'clipboard-read', 'idle-detection', 'window-management']);
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write']);

/**
 * Apply policies to a session. `ctx` provides:
 *   settings() → current settings
 *   tabForContents(webContents) → tab or null
 *   onBlocked(tab) → called when a tracker is blocked
 *   askPermission({ tab, origin, permission, detail }) → Promise<boolean>
 *   permissionStore: { get(origin, perm) → true|false|undefined }
 *   httpAllowed: Set of hosts the user chose to visit over plain HTTP
 */
export function hardenSession(ses, ctx) {
  const ua = ses.getUserAgent().replace(/\s(Electron|lintas|Lintas)\/[\w.-]+/g, '');
  ses.setUserAgent(ua);

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const s = ctx.settings();
    const url = details.url;
    if (details.resourceType === 'mainFrame') {
      if (url.startsWith('http://') && s.httpsOnly) {
        const host = new URL(url).hostname;
        if (!ctx.httpAllowed.has(host) && !isLocal(host)) return cb({ redirectURL: 'https://' + url.slice(7) });
      }
      return cb({});
    }
    if (s.blockTrackers && /^https?:/.test(url)) {
      const page = details.webContents?.getURL?.() || details.referrer || '';
      if (isTracker(url) && (!page || isThirdParty(url, page))) {
        const tab = details.webContents ? ctx.tabForContents(details.webContents) : null;
        if (tab) ctx.onBlocked(tab);
        return cb({ cancel: true });
      }
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const s = ctx.settings();
    const headers = details.requestHeaders;
    if (s.sendDoNotTrack) { headers.DNT = '1'; headers['Sec-GPC'] = '1'; }
    if (s.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
      const page = details.webContents?.getURL?.() || '';
      if (page && isThirdParty(details.url, page)) delete headers.Cookie;
    }
    cb({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
    const s = ctx.settings();
    if (s.blockThirdPartyCookies && details.resourceType !== 'mainFrame' && details.responseHeaders) {
      const page = details.webContents?.getURL?.() || '';
      if (page && isThirdParty(details.url, page)) {
        for (const k of Object.keys(details.responseHeaders)) if (k.toLowerCase() === 'set-cookie') delete details.responseHeaders[k];
      }
    }
    cb({ responseHeaders: details.responseHeaders });
  });

  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS.has(permission)) return callback(true);
    if (!PROMPTABLE.has(permission)) return callback(false);
    const origin = originOf(details.requestingUrl || wc.getURL());
    const stored = ctx.permissionStore.get(origin, permission);
    if (stored !== undefined) return callback(stored);
    const tab = ctx.tabForContents(wc);
    if (!tab) return callback(false);
    const detail = permission === 'media' ? (details.mediaTypes || []).join(' and ') : '';
    try { callback(await ctx.askPermission({ tab, origin, permission, detail })); } catch { callback(false); }
  });

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    if (ALWAYS.has(permission)) return true;
    const stored = ctx.permissionStore.get(originOf(requestingOrigin), permission);
    return stored === true;
  });

  // Never let pages pick devices silently.
  ses.setDevicePermissionHandler(() => false);
  ses.on('select-hid-device', (e, d, cb) => { e.preventDefault(); cb(); });
  ses.on('select-serial-port', (e, l, wc, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-usb-device', (e, d, cb) => { e.preventDefault(); cb(); });
}

export function originOf(u) {
  try { return new URL(u).origin; } catch { return String(u || ''); }
}

export function isLocal(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.local');
}

const SEARCH = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
  brave: 'https://search.brave.com/search?q=',
};

/** Turn omnibox input into a URL: URL-like input goes HTTPS-first, anything else is a search. */
export function resolveInput(input, engine = 'duckduckgo') {
  const t = String(input || '').trim();
  if (!t) return null;
  if (/^lintas:\/\//i.test(t)) return t.toLowerCase().startsWith('lintas://') ? t : 'lintas://' + t.slice(9);
  if (/^(https?|file):\/\//i.test(t)) return t;
  if (/^(javascript|data|vbscript|chrome|devtools|about):/i.test(t)) return (SEARCH[engine] || SEARCH.duckduckgo) + encodeURIComponent(t);
  const hostish = /^([\w-]+\.)+[a-z]{2,63}(:\d+)?(\/\S*)?$/i.test(t) || /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(t);
  if (!/\s/.test(t) && hostish) {
    const host = t.split(/[/:]/)[0];
    return (isLocal(host) || /^\d/.test(host) ? 'http://' : 'https://') + t;
  }
  return (SEARCH[engine] || SEARCH.duckduckgo) + encodeURIComponent(t);
}

export const SEARCH_ENGINES = Object.keys(SEARCH);
