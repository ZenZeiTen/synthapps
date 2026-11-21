// Native messaging hosts as Chrome finds and talks to them, free of Electron so it can be unit tested.
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const HOST_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i;
export const MAX_FROM_HOST = 1024 * 1024;          // Chrome's limit for a message from the host
export const MAX_TO_HOST = 64 * 1024 * 1024;       // and for a message to the host

/** One message as Chrome sends it on the host's stdin: 32-bit length (native byte order) + UTF-8 JSON. */
export function encodeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  if (json.length > MAX_TO_HOST) throw new Error('Message too large for the native messaging host.');
  const head = Buffer.alloc(4);
  os.endianness() === 'LE' ? head.writeUInt32LE(json.length, 0) : head.writeUInt32BE(json.length, 0);
  return Buffer.concat([head, json]);
}

/** Reads messages from the host's stdout, which may arrive split or several at once. */
export function createFrameReader(onMessage, onError) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 4) {
      const len = os.endianness() === 'LE' ? buf.readUInt32LE(0) : buf.readUInt32BE(0);
      if (len > MAX_FROM_HOST) { buf = Buffer.alloc(0); onError(new Error('The native messaging host sent a message over 1 MB.')); return; }
      if (buf.length < 4 + len) return;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      let msg;
      try { msg = JSON.parse(body.toString('utf8')); } catch { onError(new Error('The native messaging host sent text that is not JSON.')); return; }
      onMessage(msg);
    }
  };
}

const BROWSERS = {
  win32: ['Google\\Chrome', 'Microsoft\\Edge', 'Chromium', 'BraveSoftware\\Brave-Browser'],
  darwin: ['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser'],
  linux: [['google-chrome', '/etc/opt/chrome'], ['microsoft-edge', '/etc/opt/edge'], ['chromium', '/etc/chromium'], ['BraveSoftware/Brave-Browser', '/etc/opt/brave.com/brave']],
};

/** Files that may register `name`, most specific first. Lintas's own folder comes first. */
export function hostManifestPaths(name, { platform = process.platform, home = os.homedir(), userData } = {}) {
  const file = name + '.json';
  const own = userData ? [path.join(userData, 'NativeMessagingHosts', file)] : [];
  if (platform === 'darwin') {
    return [...own,
      ...BROWSERS.darwin.map(b => path.join(home, 'Library', 'Application Support', b, 'NativeMessagingHosts', file)),
      ...BROWSERS.darwin.map(b => path.join('/Library', b, 'NativeMessagingHosts', file))];
  }
  if (platform === 'linux') {
    return [...own,
      ...BROWSERS.linux.map(([b]) => path.join(home, '.config', b, 'NativeMessagingHosts', file)),
      ...BROWSERS.linux.map(([, etc]) => path.join(etc, 'native-messaging-hosts', file))];
  }
  return own;
}

/** Windows: the registry names the JSON file, per user first, then for the whole machine. */
export function registryKeys(name) {
  const keys = [];
  for (const hive of ['HKCU', 'HKLM']) for (const b of BROWSERS.win32) {
    keys.push(`${hive}\\Software\\${b}\\NativeMessagingHosts\\${name}`);
    if (hive === 'HKLM') keys.push(`${hive}\\Software\\WOW6432Node\\${b}\\NativeMessagingHosts\\${name}`);
  }
  return keys;
}
export function readRegistryDefault(key) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/ve'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      const line = String(out).split(/\r?\n/).find(l => /\bREG_(EXPAND_)?SZ\b/.test(l));
      const v = line && line.split(/\s+REG_(?:EXPAND_)?SZ\s+/)[1];
      resolve(v ? v.trim().replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m) : null);
    });
  });
}

export function validHostManifest(m, name, extensionOrigin) {
  return !!m && typeof m === 'object' && m.name === name && m.type === 'stdio' && typeof m.path === 'string' && m.path &&
    Array.isArray(m.allowed_origins) && m.allowed_origins.includes(extensionOrigin);
}

