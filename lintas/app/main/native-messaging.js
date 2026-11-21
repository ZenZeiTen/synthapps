// chrome.runtime.connectNative / sendNativeMessage for extensions, the way Chrome does it.
// This replaces electron-chrome-extensions' version, which lost messages that arrive in
// several pieces or together (large messages, fast replies), miscounted the length of
// non-ASCII text, and only looked for hosts registered for Chrome.
// A native messaging host is a program the user installed (for example Claude Desktop), registered
// with a small JSON file; Lintas finds the file where Chrome, Edge, Chromium or Brave would.
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { HOST_NAME, createFrameReader, encodeMessage, hostManifestPaths, registryKeys, readRegistryDefault, validHostManifest } from './native-host.js';

async function findHost(name, extensionOrigin) {
  let files = hostManifestPaths(name, { userData: app.getPath('userData') });
  if (process.platform === 'win32') files = [...files, ...(await Promise.all(registryKeys(name).map(readRegistryDefault))).filter(Boolean)];
  for (const file of files) {
    let m;
    try { m = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { continue; }
    if (!validHostManifest(m, name, extensionOrigin)) continue;
    // Windows allows a path relative to the JSON file; elsewhere it must be absolute.
    const exe = path.isAbsolute(m.path) ? m.path : process.platform === 'win32' ? path.resolve(path.dirname(file), m.path) : null;
    if (!exe) continue;
    try { if (!(await fs.promises.stat(exe)).isFile()) continue; } catch { continue; }
    return exe;
  }
  return null;
}

function launch(exe, extensionOrigin) {
  if (process.platform === 'win32') {
    // As Chrome does: through cmd.exe, so .bat and .cmd hosts work too.
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${exe}" ${extensionOrigin} --parent-window=0"`],
      { windowsVerbatimArguments: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return spawn(exe, [extensionOrigin], { stdio: ['pipe', 'pipe', 'pipe'] });
}

class Host {
  constructor({ extensionId, name, onMessage, onClose }) {
    this.origin = `chrome-extension://${extensionId}/`;
    this.name = name;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.queue = [];
    this.closed = false;
    this.ready = this.start();
  }
  async start() {
    const exe = HOST_NAME.test(this.name) ? await findHost(this.name, this.origin) : null;
    if (this.closed) return;
    if (!exe) return this.close('Specified native messaging host not found.');
    try { this.proc = launch(exe, this.origin); } catch { return this.close('Failed to start native messaging host.'); }
    const read = createFrameReader((m) => this.onMessage(m), () => this.close('Error when communicating with the native messaging host.'));
    this.proc.stdout.on('data', read);
    this.proc.stderr.on('data', (d) => process.stderr.write(`[native host ${this.name}] ${d}`));
    this.proc.on('error', () => this.close('Failed to start native messaging host.'));
    this.proc.on('exit', () => this.close('Native host has exited.'));
    this.proc.stdin.on('error', () => this.close('Error when communicating with the native messaging host.'));
    for (const m of this.queue.splice(0)) this.write(m);
  }
  send(message) { if (this.closed) return; if (!this.proc) this.queue.push(message); else this.write(message); }
  write(message) {
    try { this.proc.stdin.write(encodeMessage(message)); } catch (e) { this.close(e.message); }
  }
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    try { this.proc?.stdin.end(); } catch {}
    const p = this.proc;
    if (p && p.exitCode == null) setTimeout(() => { try { p.kill(); } catch {} }, 2000).unref?.();
    this.onClose?.(reason);
  }
}

/** Takes over the runtime.*Native handlers of an ElectronChromeExtensions instance. */
export function installNativeMessaging(ece) {
  const router = ece?.ctx?.router;
  if (!router?.handle) return false;
  const ports = new Map();
  const opts = { permission: 'nativeMessaging' };
  router.handle('runtime.connectNative', (event, connectionId, name) => {
    const id = String(connectionId);
    const sender = event.sender;
    const channel = `crx-native-msg-${id}`;
    const fromExtension = (_e, message) => host.send(message);
    const host = new Host({
      extensionId: event.extension.id, name: String(name),
      onMessage: (m) => { try { sender.send(channel, m); } catch {} },
      onClose: () => {
        ports.delete(id);
        try { sender.ipc.off(channel, fromExtension); } catch {}
        // After the page has had a chance to start listening for the disconnect.
        setTimeout(() => { try { sender.send(channel + '-disconnect'); } catch {} }, 0);
      },
    });
    ports.set(id, host);
    sender.ipc.on(channel, fromExtension);
  }, opts);
  router.handle('runtime.disconnectNative', (_event, connectionId) => { ports.get(String(connectionId))?.close(); }, opts);
  router.handle('runtime.sendNativeMessage', (event, name, message) => new Promise((resolve, reject) => {
    let answered = false;
    const host = new Host({
      extensionId: event.extension.id, name: String(name),
      onMessage: (m) => { if (!answered) { answered = true; resolve(m); host.close(); } },
      onClose: (reason) => { if (!answered) { answered = true; reject(new Error(reason || 'Native host has exited.')); } },
    });
    host.send(message);
  }), opts);
  return true;
}

