// Chrome APIs that Electron and electron-chrome-extensions do not provide,
// added to extension pages and extension service workers only:
//   chrome.identity.getRedirectURL / launchWebAuthFlow
//   chrome.tabs.captureVisibleTab
//   chrome.pageCapture.saveAsMHTML
//   chrome.userScripts.register / unregister / getScripts / update / configureWorld
//   chrome.sidePanel (docked beside the page), chrome.offscreen, chrome.debugger, chrome.alarms
//   chrome.tabGroups and chrome.tabs.group / ungroup, chrome.runtime.getContexts
//   chrome.declarativeNetRequest as an inert stand-in (rules accepted, not applied)
// The main process checks the extension's manifest permissions on every call.
const { contextBridge, ipcRenderer } = require('electron');

const isExtension = process.type === 'service-worker' || (typeof location !== 'undefined' && location.protocol === 'chrome-extension:');

function install(call, extErr, subscribe) {
  const chrome = globalThis.chrome || (globalThis.chrome = {});
  if (extErr) globalThis.__lintasShimError = extErr;
  const extId = chrome.runtime && chrome.runtime.id;
  // Chrome's callback style: last argument may be a callback; otherwise return a Promise.
  const api = (name, post = (x) => x) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const p = Promise.resolve(call(name, args)).then(post);
    if (!cb) return p;
    p.then((r) => cb(r), (e) => {
      try { Object.defineProperty(chrome.runtime, 'lastError', { value: { message: String((e && e.message) || e) }, configurable: true }); } catch {}
      try { cb(); } finally { try { delete chrome.runtime.lastError; } catch {} }
    });
  };
  const define = (ns, props) => {
    let target = chrome[ns];
    if (!target) { target = {}; try { Object.defineProperty(chrome, ns, { value: target, enumerable: true, configurable: true }); } catch { return; } }
    for (const [k, v] of Object.entries(props)) if (!(k in target)) { try { target[k] = v; } catch {} }
  };
  define('identity', {
    getRedirectURL: (path) => new URL(path || '', `https://${extId}.chromiumapp.org/`).toString(),
    launchWebAuthFlow: api('identity.launchWebAuthFlow'),
  });
  define('tabs', { captureVisibleTab: api('tabs.captureVisibleTab') });
  define('pageCapture', { saveAsMHTML: api('pageCapture.saveAsMHTML', (s) => new Blob([s], { type: 'multipart/related' })) });
  define('userScripts', {
    register: api('userScripts.register'),
    unregister: api('userScripts.unregister'),
    getScripts: api('userScripts.getScripts'),
    update: api('userScripts.update'),
    configureWorld: api('userScripts.configureWorld'),
  });

  // window.close() from an extension page in a side panel or a tab: Lintas closes the panel or tab, as Chrome does.
  if (typeof window !== 'undefined' && window === window.top && typeof window.close === 'function') {
    const close = window.close.bind(window);
    try { window.close = () => { Promise.resolve(call('window.close', [])).then((done) => { if (!done) close(); }, () => close()); }; } catch {}
  }

  // --- events delivered from the main process ---
  const event = () => {
    const ls = new Set();
    return { addListener: (f) => { if (typeof f === 'function') ls.add(f); }, removeListener: (f) => { ls.delete(f); }, hasListener: (f) => ls.has(f), hasListeners: () => ls.size > 0,
      _fire: (...a) => { for (const f of [...ls]) { try { f(...a); } catch (e) { console.error(e); } } } };
  };
  const events = {};
  const ev = (name) => (events[name] ||= event());
  if (subscribe) {
    subscribe((name, args) => { if (events[name]) events[name]._fire(...(args || [])); });
    // Register for events nobody asked for, such as tab groups changing.
    Promise.resolve(call('events.hello', [])).catch(() => {});
  }
  const ok = (v) => (...args) => { const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null; const r = typeof v === 'function' ? v(...args) : v; if (cb) { cb(r); return; } return Promise.resolve(r); };
  const fail = (msg) => (...args) => { const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null; if (!cb) return Promise.reject(new Error(msg));
    try { Object.defineProperty(chrome.runtime, 'lastError', { value: { message: msg }, configurable: true }); } catch {} try { cb(); } finally { try { delete chrome.runtime.lastError; } catch {} } };

  define('sidePanel', {
    setOptions: api('sidePanel.setOptions'), getOptions: api('sidePanel.getOptions'), open: api('sidePanel.open'), close: api('sidePanel.close'),
    setPanelBehavior: api('sidePanel.setPanelBehavior'), getPanelBehavior: api('sidePanel.getPanelBehavior'),
  });
  define('offscreen', {
    createDocument: api('offscreen.createDocument'), hasDocument: api('offscreen.hasDocument'), closeDocument: api('offscreen.closeDocument'),
    Reason: Object.fromEntries(['TESTING', 'AUDIO_PLAYBACK', 'IFRAME_SCRIPTING', 'DOM_SCRAPING', 'BLOBS', 'DOM_PARSER', 'USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC', 'CLIPBOARD', 'LOCAL_STORAGE', 'WORKERS', 'BATTERY_STATUS', 'MATCH_MEDIA', 'GEOLOCATION'].map((k) => [k, k])),
  });
  define('debugger', {
    attach: api('debugger.attach'), detach: api('debugger.detach'), sendCommand: api('debugger.sendCommand'), getTargets: api('debugger.getTargets'),
    onEvent: ev('debugger.onEvent'), onDetach: ev('debugger.onDetach'),
  });

  define('tabGroups', {
    TAB_GROUP_ID_NONE: -1,
    Color: { GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange' },
    query: api('tabGroups.query'), get: api('tabGroups.get'), update: api('tabGroups.update'), move: api('tabGroups.move'),
    onCreated: ev('tabGroups.onCreated'), onUpdated: ev('tabGroups.onUpdated'), onRemoved: ev('tabGroups.onRemoved'), onMoved: ev('tabGroups.onMoved'),
  });
  define('tabs', { group: api('tabs.group'), ungroup: api('tabs.ungroup'), TAB_ID_NONE: -1 });

  // chrome.alarms, kept by timers in this page or worker.
  const alarms = new Map();
  const onAlarm = event();
  const publicAlarm = (a) => ({ name: a.name, scheduledTime: a.scheduledTime, ...(a.periodInMinutes ? { periodInMinutes: a.periodInMinutes } : {}) });
  const clearAlarm = (name) => { const a = alarms.get(name); if (!a) return false; clearTimeout(a.timer); alarms.delete(name); return true; };
  const arm = (a) => { a.timer = setTimeout(() => {
    if (a.periodInMinutes) { a.scheduledTime = Date.now() + a.periodInMinutes * 60000; arm(a); } else alarms.delete(a.name);
    onAlarm._fire(publicAlarm(a));
  }, Math.max(0, a.scheduledTime - Date.now())); };
  define('alarms', {
    create: ok((name, info) => {
      if (name && typeof name === 'object') { info = name; name = ''; }
      name = String(name ?? ''); info = info || {};
      clearAlarm(name);
      const delay = info.when ? info.when - Date.now() : (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
      const a = { name, scheduledTime: Date.now() + Math.max(0, delay), periodInMinutes: info.periodInMinutes };
      alarms.set(name, a); arm(a);
    }),
    get: ok((name) => { const a = alarms.get(String(name ?? '')); return a ? publicAlarm(a) : undefined; }),
    getAll: ok(() => [...alarms.values()].map(publicAlarm)),
    clear: ok((name) => clearAlarm(String(name ?? ''))),
    clearAll: ok(() => { const had = alarms.size > 0; for (const n of [...alarms.keys()]) clearAlarm(n); return had; }),
    onAlarm,
  });

  // Network rule sets are accepted but not applied.
  const dnrEnum = (...k) => Object.fromEntries(k.map((x) => [x.toUpperCase(), x]));
  define('declarativeNetRequest', {
    ResourceType: dnrEnum('main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'),
    RuleActionType: dnrEnum('block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests'),
    HeaderOperation: dnrEnum('append', 'set', 'remove'),
    RequestMethod: dnrEnum('connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other'),
    DomainType: { FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' },
    updateSessionRules: ok(undefined), updateDynamicRules: ok(undefined), updateEnabledRulesets: ok(undefined),
    getSessionRules: ok([]), getDynamicRules: ok([]), getEnabledRulesets: ok([]), getMatchedRules: ok({ rulesMatchedInfo: [] }),
  });

  define('action', { getUserSettings: ok({ isOnToolbar: true }) });
  if (chrome.runtime) {
    for (const [k, v] of Object.entries({
      ContextType: { TAB: 'TAB', POPUP: 'POPUP', BACKGROUND: 'BACKGROUND', OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT', SIDE_PANEL: 'SIDE_PANEL', DEVELOPER_TOOLS: 'DEVELOPER_TOOLS' },
    })) if (!(k in chrome.runtime)) { try { chrome.runtime[k] = v; } catch {} }
    // Electron's own getContexts does not know Lintas's side panels, offscreen pages or tabs, so this one replaces it.
    try { Object.defineProperty(chrome.runtime, 'getContexts', { value: api('runtime.getContexts'), configurable: true, writable: true, enumerable: true }); }
    catch { try { chrome.runtime.getContexts = api('runtime.getContexts'); } catch {} }
  }
}

if (isExtension && contextBridge.executeInMainWorld) {
  const subs = [];
  ipcRenderer.on('lintas-ext-event', (e, name, args) => { for (const f of subs) { try { f(name, args); } catch {} } });
  const call = (name, args) => ipcRenderer.invoke('lintas-ext', name, args);
  const subscribe = (f) => { subs.push(f); };
  try {
    contextBridge.executeInMainWorld({ func: install, args: [call, null, subscribe] });
  } catch (e) {
    try { contextBridge.executeInMainWorld({ func: install, args: [() => Promise.reject(new Error('Not available.')), String(e && e.message), null] }); } catch {}
  }
}
