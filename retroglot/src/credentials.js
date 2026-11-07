// Where a Claude API key typed into Settings is kept.
//
// The command-line server stores it in a file only the current user can read.
// The desktop app passes its own store that encrypts the key with the operating
// system (Windows DPAPI through Electron's safeStorage). The key never goes back
// to the browser: the API only reports its last four characters.

import fs from 'node:fs';
import path from 'node:path';

export class FileSecrets {
  constructor(file) {
    this.file = file;
  }

  get() {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8')).anthropicApiKey;
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  }

  set(key) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ anthropicApiKey: key }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* Windows: file permissions follow the user profile */ }
  }

  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

/** Loose shape check, to catch pasting the wrong thing; the API has the final word. */
export function looksLikeApiKey(key) {
  return typeof key === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key.trim());
}

export function keyHint(key) {
  return key ? `…${key.slice(-4)}` : null;
}
