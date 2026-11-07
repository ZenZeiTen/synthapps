// The Claude API key typed into Settings, encrypted by the operating system
// (Windows: DPAPI, tied to the signed-in user) through Electron's safeStorage.
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

export class SafeSecrets {
  constructor(file) {
    this.file = file;
  }

  get() {
    try {
      return safeStorage.decryptString(fs.readFileSync(this.file)) || null;
    } catch {
      return null;
    }
  }

  set(key) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, safeStorage.encryptString(key), { mode: 0o600 });
  }

  clear() {
    fs.rmSync(this.file, { force: true });
  }
}

export function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
