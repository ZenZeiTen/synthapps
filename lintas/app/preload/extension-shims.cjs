// Chrome APIs that Electron and electron-chrome-extensions do not provide,
// added to extension pages and extension service workers only:
//   chrome.identity.getRedirectURL / launchWebAuthFlow
//   chrome.tabs.captureVisibleTab
//   chrome.pageCapture.saveAsMHTML
//   chrome.userScripts.register / unregister / getScripts / update / configureWorld
// The main process checks the extension's manifest permissions on every call.
const { contextBridge, ipcRenderer } = require('electron');

const isExtension = process.type === 'service-worker' || (typeof location !== 'undefined' && location.protocol === 'chrome-extension:');

function install(call, extErr) {
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
}

if (isExtension && contextBridge.executeInMainWorld) {
  try {
    contextBridge.executeInMainWorld({ func: install, args: [(name, args) => ipcRenderer.invoke('lintas-ext', name, args)] });
  } catch (e) {
    try { contextBridge.executeInMainWorld({ func: install, args: [() => Promise.reject(new Error('Not available.')), String(e && e.message)] }); } catch {}
  }
}
