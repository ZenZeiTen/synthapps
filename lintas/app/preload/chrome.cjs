// Preload for the browser chrome renderer only. Exposes a fixed, typed
// surface as window.lintas; the renderer never gets ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke('lintas:' + name, ...args);

const groups = {
  view: ['setBounds', 'setVisible'],
  tabs: ['list', 'create', 'close', 'activate', 'move', 'pin', 'mute', 'duplicate', 'reopenClosed'],
  nav: ['go', 'back', 'forward', 'reload', 'stop', 'zoom', 'find', 'stopFind', 'print', 'devtools', 'allowHttp'],
  permissions: ['answer'],
  omnibox: ['suggest'],
  bookmarks: ['list', 'toggle', 'remove'],
  history: ['list', 'clear'],
  downloads: ['list', 'open', 'show', 'cancel'],
  offline: ['save', 'list', 'open', 'remove'],
  app: ['status', 'defaultBrowser', 'makeDefault'],
  settings: ['get', 'set', 'setApiKey'],
  privacy: ['clearData'],
  tms: ['dashboard', 'createProject', 'updateProject', 'deleteProject', 'getProject', 'importFiles', 'importText', 'capturePage',
    'deleteFile', 'getFile', 'updateSegment', 'lookup', 'pretranslate', 'analyze', 'qa', 'export',
    'listTms', 'createTm', 'deleteTm', 'importTmx', 'exportTm', 'searchTm',
    'listTermbases', 'createTermbase', 'deleteTermbase', 'listTerms', 'addTerm', 'updateTerm', 'deleteTerm', 'importTermbase', 'exportTermbase'],
  extensions: ['list', 'installFromStore', 'loadUnpacked', 'remove', 'openOptions'],
  claude: ['status', 'connect'],
  importer: ['detect', 'run', 'fromFile'],
  webpanel: ['apps', 'show', 'reload', 'home', 'openInTab'],
  extpanel: ['close'],
  ai: ['suggest', 'review', 'extractTerms', 'translatePage', 'restorePage', 'translateText', 'ask', 'highlight', 'selection', 'usage'],
};

const api = {};
for (const [group, names] of Object.entries(groups)) {
  api[group] = {};
  for (const n of names) api[group][n] = call(`${group}.${n}`);
}

const listeners = new Map();
ipcRenderer.on('lintas:event', (e, event, payload) => {
  for (const fn of listeners.get(event) || []) { try { fn(payload); } catch (err) { console.error(err); } }
});

api.on = (event, fn) => {
  if (typeof fn !== 'function') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
};

contextBridge.exposeInMainWorld('lintas', Object.freeze(api));
