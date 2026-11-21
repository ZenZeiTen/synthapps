// Small JSON persistence layer: one file per document, atomic writes
// (write to a temp file, then rename) and debounced saving.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(dir, { delay = 400 } = {}) {
    this.dir = dir;
    this.delay = delay;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  file(name) {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid store name: ' + name);
    return path.join(this.dir, name + '.json');
  }

  load(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file(name), 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep a copy of an unreadable file instead of silently overwriting it.
        try { fs.copyFileSync(this.file(name), this.file(name) + '.corrupt-' + Date.now()); } catch {}
      }
      data = typeof fallback === 'function' ? fallback() : structuredClone(fallback);
    }
    this.cache.set(name, data);
    return data;
  }

  exists(name) {
    return this.cache.has(name) || fs.existsSync(this.file(name));
  }

  save(name, data) {
    if (data !== undefined) this.cache.set(name, data);
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => this.flush(name), this.delay));
  }

  flush(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    if (!this.cache.has(name)) return;
    const target = this.file(name);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.cache.get(name)), { mode: 0o600 });
    fs.renameSync(tmp, target);
  }

  flushAll() {
    for (const name of [...this.timers.keys()]) this.flush(name);
  }

  remove(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    this.cache.delete(name);
    try { fs.unlinkSync(this.file(name)); } catch {}
  }
}
