// Where encrypted vaults are kept. Every adapter has the same shape:
//   load()                    -> { rev, vault, meta } | null
//   save(rev, vault, meta)    -> { rev }   (throws ConflictError if rev is stale)

export class ConflictError extends Error {
  constructor(rev) { super('Changed elsewhere'); this.name = 'ConflictError'; this.rev = rev; }
}
export class RemoteError extends Error {
  constructor(status, code, message) { super(message || code || 'Request failed (' + status + ')'); this.name = 'RemoteError'; this.status = status; this.code = code; }
}
export class OfflineError extends Error {
  constructor(msg = 'The server could not be reached') { super(msg); this.name = 'OfflineError'; }
}

async function request(url, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method, signal: ctl.signal, cache: 'no-store', credentials: 'omit',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new OfflineError(e.name === 'AbortError' ? 'The server took too long to answer' : undefined);
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 409) throw new ConflictError(data && data.rev);
  if (!res.ok) throw new RemoteError(res.status, data && data.error, data && data.message);
  return data;
}

/** The vault file on this computer, through the desktop app's local server. */
export class DesktopStore {
  constructor(token) { this.token = token; this.kind = 'desktop'; }
  async load() {
    try { return await request('/api/local/vault', { token: this.token }); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async save(rev, vault, meta) { return request('/api/local/vault', { method: 'PUT', token: this.token, body: { rev, vault, meta } }); }
  backups() { return request('/api/local/backups', { token: this.token }); }
  backup(name) { return request('/api/local/backups/' + encodeURIComponent(name), { token: this.token }); }
  heartbeat() { return request('/api/local/heartbeat', { method: 'POST', token: this.token, timeout: 5000 }); }
  quit() { return request('/api/local/quit', { method: 'POST', token: this.token, timeout: 3000 }); }
}

/** A copy kept in this browser (IndexedDB), so the web app opens without a connection. */
export class BrowserStore {
  constructor(username) { this.key = 'vault:' + username; this.kind = 'browser'; }
  static open() {
    if (BrowserStore._db) return BrowserStore._db;
    BrowserStore._db = new Promise((resolve, reject) => {
      const r = indexedDB.open('keyhold', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('vaults');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return BrowserStore._db;
  }
  async tx(mode, fn) {
    const db = await BrowserStore.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('vaults', mode);
      const st = t.objectStore('vaults');
      let out;
      Promise.resolve(fn(st)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
  async load() {
    return this.tx('readonly', (st) => new Promise((res) => { const g = st.get(this.key); g.onsuccess = () => res(g.result || null); }));
  }
  async save(rev, vault, meta) {
    const db = await BrowserStore.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('vaults', 'readwrite');
      const st = t.objectStore('vaults');
      let next;
      const g = st.get(this.key);
      g.onsuccess = () => {
        const cur = g.result;
        const curRev = cur ? cur.rev : 0;
        if (curRev !== rev) { t.abort(); reject(new ConflictError(curRev)); return; }
        next = { rev: curRev + 1, vault, meta, savedAt: new Date().toISOString() };
        st.put(next, this.key);
      };
      t.oncomplete = () => resolve({ rev: next.rev });
      t.onerror = () => reject(t.error);
    });
  }
  async remove() {
    const db = await BrowserStore.open();
    return new Promise((res) => { const t = db.transaction('vaults', 'readwrite'); t.objectStore('vaults').delete(this.key); t.oncomplete = res; });
  }
}

/** In memory only (tests). */
export class MemoryStore {
  constructor() { this.rec = null; this.kind = 'memory'; }
  async load() { return this.rec && structuredClone(this.rec); }
  async save(rev, vault, meta) {
    const cur = this.rec ? this.rec.rev : 0;
    if (cur !== rev) throw new ConflictError(cur);
    this.rec = { rev: cur + 1, vault: structuredClone(vault), meta: structuredClone(meta) };
    return { rev: this.rec.rev };
  }
}

/** A Keyhold sync server. */
export class RemoteClient {
  constructor(base) {
    this.base = String(base || '').replace(/\/+$/, '');
    this.token = null;
  }
  url(p) { return this.base + p; }
  static check(base) {
    let u;
    try { u = new URL(base); } catch { throw new Error('Enter the full server address, for example https://vault.example.com'); }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('The sync server must use https://');
    return u.origin + u.pathname.replace(/\/+$/, '');
  }
  mode() { return request(this.url('/api/mode')); }
  prelogin(username) { return request(this.url('/api/v1/prelogin'), { method: 'POST', body: { username } }); }
  async register(body) { const r = await request(this.url('/api/v1/register'), { method: 'POST', body }); this.token = r.token; return r; }
  async login(username, authKey, kind = 'password') {
    const body = kind === 'recovery' ? { username, recoveryAuthKey: authKey } : { username, authKey };
    const r = await request(this.url('/api/v1/login'), { method: 'POST', body });
    this.token = r.token; return r;
  }
  async logout() { if (this.token) { try { await request(this.url('/api/v1/logout'), { method: 'POST', token: this.token, timeout: 5000 }); } catch { /* ignore */ } } this.token = null; }
  getVault() { return request(this.url('/api/v1/vault'), { token: this.token }); }
  putVault(rev, vault) { return request(this.url('/api/v1/vault'), { method: 'PUT', token: this.token, body: { rev, vault } }); }
  setKeys(body) { return request(this.url('/api/v1/account/keys'), { method: 'POST', token: this.token, body }); }
  history() { return request(this.url('/api/v1/vault/history'), { token: this.token }); }
  historyItem(name) { return request(this.url('/api/v1/vault/history/' + encodeURIComponent(name)), { token: this.token }); }
  deleteAccount(authKey) { return request(this.url('/api/v1/account/delete'), { method: 'POST', token: this.token, body: { authKey } }); }
}
