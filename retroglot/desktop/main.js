// Retroglot for the desktop: runs the retroglot server inside the app and shows
// it in its own window. No terminal, no Node.js install, no environment variables.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, app, dialog, net, shell } from 'electron';
import { SafeSecrets, encryptionAvailable } from './secrets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (p) => pathToFileURL(path.join(here, 'app', 'core', 'src', p)).href;
const smoke = process.argv.includes('--smoke') || process.env.RETROGLOT_SMOKE === '1';
// A fixed port keeps the page's origin the same between launches, so in-game saves
// that the emulator keeps in browser storage survive a restart.
const PREFERRED_PORT = 47923;

if (smoke) app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // WebGL on machines without a GPU (CI)
if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let server = null;

function listen(srv, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { srv.off('listening', onOk); reject(e); };
    const onOk = () => { srv.off('error', onError); resolve(srv.address().port); };
    srv.once('error', onError);
    srv.once('listening', onOk);
    srv.listen(port, '127.0.0.1');
  });
}

async function startServer() {
  const userData = app.getPath('userData');
  process.env.RETROGLOT_RUNTIME ||= path.join(userData, 'runtime');
  const home = process.env.RETROGLOT_HOME || path.join(app.getPath('home'), '.retroglot');
  const { createServer } = await import(core('server.js'));
  const { Store } = await import(core('store.js'));
  const { FileSecrets } = await import(core('credentials.js'));
  const store = new Store(home);
  store.scan();
  const secrets = encryptionAvailable() ? new SafeSecrets(path.join(userData, 'claude-key.bin')) : new FileSecrets(path.join(home, 'credentials.json'));
  server = createServer({ store, secrets, fetch: (url, opts) => net.fetch(url, opts), desktop: true });
  let port;
  try {
    port = await listen(server, PREFERRED_PORT);
  } catch {
    port = await listen(server, 0);
  }
  return { port, store };
}

function buildMenu() {
  const template = [
    {
      label: 'Retroglot',
      submenu: [
        { label: 'Library', accelerator: 'CmdOrCtrl+L', click: () => win?.loadURL(`${baseUrl}/`) },
        { type: 'separator' },
        { label: 'Open data folder', click: () => shell.openPath(process.env.RETROGLOT_HOME || path.join(app.getPath('home'), '.retroglot')) },
        { label: 'Open emulator folder', click: () => shell.openPath(process.env.RETROGLOT_RUNTIME) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Get a Claude API key', click: () => shell.openExternal('https://console.anthropic.com/settings/keys') },
        { label: 'retroglot on GitHub', click: () => shell.openExternal('https://github.com/ZenZeiTen/synthapps/tree/main/retroglot') },
        { type: 'separator' },
        { label: `About Retroglot ${app.getVersion()}`, click: () => dialog.showMessageBox(win, { type: 'info', title: 'Retroglot', message: `Retroglot ${app.getVersion()}`, detail: 'Play retro games from the DOS era to the PlayStation era, with live translation by Claude.\n\nEmulation by EmulatorJS (GPL-3.0) and libretro cores, downloaded on first use.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let baseUrl = '';

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Retroglot',
    backgroundColor: '#07080d',
    autoHideMenuBar: true,
    icon: path.join(here, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false },
  });
  const isLocal = (url) => url.startsWith(`${baseUrl}/`) || url === baseUrl;
  // Links to other sites open in the normal web browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isLocal(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  // Hold-to-peek and F-keys belong to the game page, not to the browser.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F5' && input.type === 'keyDown') e.preventDefault();
  });
  win.once('ready-to-show', () => { if (!smoke) win.show(); });
  win.on('closed', () => { win = null; });
  win.loadURL(`${baseUrl}/`);
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
  try {
    const { port } = await startServer();
    baseUrl = `http://localhost:${port}`;
    buildMenu();
    createWindow();
    if (smoke) (await import('./smoke.js')).runSmoke({ app, win, baseUrl });
  } catch (err) {
    dialog.showErrorBox('Retroglot could not start', String(err?.stack || err));
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});

// Keep a crash log next to the data, so problems can be reported.
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'error.log'), `${new Date().toISOString()} ${err?.stack || err}\n`);
  } catch { /* nothing more to do */ }
});
