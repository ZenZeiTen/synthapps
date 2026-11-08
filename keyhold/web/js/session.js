// An open vault: its keys, its contents, where it is saved and how it syncs.
import {
  encryptPayload, decryptPayload, openVault, openVaultDerived, deriveFromPassword,
  changePassword as rewrapPassword, resetRecovery, removeRecovery, WrongPasswordError,
} from './crypto.js';
import { normalizePayload, mergePayloads, stableStringify, applyEdit, now } from './model.js';
import { ConflictError, RemoteError, OfflineError, RemoteClient } from './storage.js';

export class NeedsPasswordError extends Error {
  constructor(msg = 'Your master password was changed on another device. Enter the new one to keep syncing.') { super(msg); this.name = 'NeedsPasswordError'; }
}

export class Session {
  /**
   * @param o.envelope  encrypted vault (header used for every save)
   * @param o.keys      VaultKeys
   * @param o.payload   decrypted contents
   * @param o.local     storage adapter
   * @param o.localRev  revision of the local copy (0 if not saved yet)
   * @param o.meta      { remoteRev } bookkeeping saved next to the local copy
   * @param o.remote    RemoteClient or null
   * @param o.username  sync account name
   * @param o.authKind  'password' | 'recovery'
   */
  constructor(o) {
    this.envelope = o.envelope;
    this.keys = o.keys;
    this.payload = normalizePayload(o.payload);
    this.local = o.local;
    this.localRev = o.localRev || 0;
    this.meta = { remoteRev: 0, ...(o.meta || {}) };
    this.remote = o.remote || null;
    this.username = o.username || null;
    this.authKind = o.authKind || 'password';
    this.serverMode = !!o.serverMode;
    this.queue = Promise.resolve();
    this.listeners = new Set();
    this.status = { state: this.remote ? 'idle' : 'local', message: '' };
    this.syncTimer = null;
    this.lastSaved = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) fn(what, this); }
  setStatus(state, message = '') { this.status = { state, message, at: Date.now() }; this.emit('status'); }

  /** Run one change at a time, in order. */
  serial(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }

  items() { return Object.values(this.payload.items); }
  get settings() { return this.payload.settings; }

  // ---------- saving ----------
  async sealChecked(payload = this.payload) {
    const env = await encryptPayload(this.envelope, this.keys.dataKey, payload);
    const back = await decryptPayload(env, this.keys.dataKey);
    if (stableStringify(back) !== stableStringify(payload)) throw new Error('Encryption self-check failed. Nothing was saved.');
    return env;
  }

  async saveLocal() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const env = await this.sealChecked();
      try {
        const r = await this.local.save(this.localRev, env, this.meta);
        this.localRev = r.rev;
        this.envelope = env;
        this.lastSaved = new Date();
        this.emit('saved');
        return;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        // Saved from another window meanwhile: merge its contents and try again.
        const cur = await this.local.load();
        if (!cur) { this.localRev = 0; continue; }
        const theirs = await decryptPayload(cur.vault, this.keys.dataKey);
        this.payload = mergePayloads(this.payload, theirs);
        this.localRev = cur.rev;
        this.meta = { ...(cur.meta || {}), ...this.meta, remoteRev: Math.max(this.meta.remoteRev || 0, (cur.meta && cur.meta.remoteRev) || 0) };
        this.emit('changed');
      }
    }
    throw new Error('Could not save: the vault keeps changing in another window.');
  }

  /** Change contents with fn(payload), save, then sync. */
  change(fn) {
    return this.serial(async () => {
      const before = structuredClone(this.payload);
      fn(this.payload);
      try { await this.saveLocal(); }
      catch (e) { this.payload = before; this.emit('changed'); throw e; }
      this.emit('changed');
      if (this.remote) this.setStatus('pending', 'Saved on this device; sending to the server shortly.');
      this.syncSoon();
    });
  }

  upsert(item) {
    return this.change((p) => { p.items[item.id] = applyEdit(p.items[item.id], item); });
  }
  patchItem(id, patch) {
    return this.change((p) => { const it = p.items[id]; if (it) p.items[id] = { ...it, ...patch, updatedAt: now() }; });
  }
  trash(id) { return this.patchItem(id, { deletedAt: now() }); }
  restore(id) { return this.patchItem(id, { deletedAt: null }); }
  purge(ids) {
    return this.change((p) => { for (const id of [].concat(ids)) { delete p.items[id]; p.purged[id] = now(); } });
  }
  updateSettings(patch) {
    return this.change((p) => { p.settings = { ...p.settings, ...patch, updatedAt: now() }; });
  }
  addItems(items) {
    return this.change((p) => { for (const it of items) p.items[it.id] = it; });
  }

  // ---------- sync ----------
  syncSoon(ms = 1500) {
    if (!this.remote) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync().catch(() => {}), ms);
  }

  async ensureLogin() {
    if (this.remote.token) return;
    try { await this.remote.login(this.username, this.keys.authKey, this.authKind); }
    catch (e) {
      if (e instanceof RemoteError && e.status === 401) throw new NeedsPasswordError();
      throw e;
    }
  }

  /** Bring this copy and the server's copy together. Safe to call any time. */
  sync() {
    if (!this.remote) return Promise.resolve();
    return this.serial(async () => {
      this.setStatus('syncing');
      try {
        await this.syncOnce();
        this.setStatus('synced');
      } catch (e) {
        if (e instanceof OfflineError) this.setStatus('offline', 'Offline. Changes are saved on this device and will sync later.');
        else if (e instanceof NeedsPasswordError) this.setStatus('needs-password', e.message);
        else this.setStatus('error', e.message);
        throw e;
      }
    });
  }

  async syncOnce() {
    await this.ensureLogin();
    for (let attempt = 0; attempt < 4; attempt++) {
      let r;
      try { r = await this.remote.getVault(); }
      catch (e) {
        if (e instanceof RemoteError && e.status === 401) { this.remote.token = null; await this.ensureLogin(); r = await this.remote.getVault(); }
        else throw e;
      }
      let theirs;
      try { theirs = await decryptPayload(r.vault, this.keys.dataKey); }
      catch { throw new Error('The vault on the server uses a different key. Sign in to it again from Settings > Sync.'); }
      let changed = false;
      if (r.rev !== this.meta.remoteRev) {
        const merged = mergePayloads(this.payload, theirs);
        changed = stableStringify(merged) !== stableStringify(this.payload);
        this.payload = merged;
        // Same data key, possibly a new master password: use the server's header.
        this.envelope = { ...r.vault, data: this.envelope.data };
      }
      if (stableStringify(this.payload) !== stableStringify(normalizePayload(theirs))) {
        const env = await this.sealChecked();
        try {
          const res = await this.remote.putVault(r.rev, env);
          this.meta.remoteRev = res.rev;
        } catch (e) {
          if (e instanceof ConflictError) continue;
          throw e;
        }
      } else {
        this.meta.remoteRev = r.rev;
      }
      this.meta.lastSync = new Date().toISOString();
      await this.saveLocal();
      if (changed) this.emit('changed');
      return;
    }
    throw new Error('Sync kept colliding with another device. It will try again shortly.');
  }

  /** After a password change elsewhere: sign in again with the new password. */
  async relogin(password, opts) {
    const pre = await this.remote.prelogin(this.username);
    const derived = await deriveFromPassword(password, pre.kdf, opts);
    try { await this.remote.login(this.username, derived.authKey); }
    catch (e) { if (e instanceof RemoteError && e.status === 401) throw new WrongPasswordError(); throw e; }
    this.keys.authKey = derived.authKey;
    this.authKind = 'password';
    return this.sync();
  }

  // ---------- keys ----------
  /** New master password; on a sync server the change is made there in the same step. */
  changePassword(newPassword, opts) {
    return this.serial(async () => {
      const { envelope, authKey } = await rewrapPassword(this.envelope, this.keys, newPassword, opts);
      const sealed = await encryptPayload(envelope, this.keys.dataKey, this.payload);
      if (this.remote) {
        await this.ensureLogin();
        const cur = await this.remote.getVault();
        const theirs = await decryptPayload(cur.vault, this.keys.dataKey);
        this.payload = mergePayloads(this.payload, theirs);
        const env2 = await encryptPayload(envelope, this.keys.dataKey, this.payload);
        const res = await this.remote.setKeys({ authKey, kdf: envelope.kdf, rev: cur.rev, vault: env2 });
        this.meta.remoteRev = res.rev;
        this.envelope = env2;
      } else {
        this.envelope = sealed;
      }
      this.keys.authKey = authKey;
      this.authKind = 'password';
      await this.saveLocal();
      this.emit('changed');
    });
  }

  /** New recovery code (returned once). */
  newRecoveryCode() {
    return this.serial(async () => {
      const { envelope, code, authKey } = await resetRecovery(this.envelope, this.keys);
      await this.pushKeys(envelope, { recoveryAuthKey: authKey });
      return code;
    });
  }
  removeRecoveryCode() {
    return this.serial(async () => this.pushKeys(removeRecovery(this.envelope), { recoveryAuthKey: '' }));
  }
  async pushKeys(envelope, extra) {
    if (this.remote) {
      await this.ensureLogin();
      const cur = await this.remote.getVault();
      this.payload = mergePayloads(this.payload, await decryptPayload(cur.vault, this.keys.dataKey));
      const env = await encryptPayload(envelope, this.keys.dataKey, this.payload);
      const res = await this.remote.setKeys({ ...extra, rev: cur.rev, vault: env });
      this.meta.remoteRev = res.rev;
      this.envelope = env;
    } else {
      this.envelope = envelope;
    }
    await this.saveLocal();
  }

  // ---------- desktop: link to a sync server ----------
  /** Create an account on a server with this vault. Returns a new recovery code if the vault has one. */
  createAccount(url, username, invite) {
    return this.serial(async () => {
      if (this.authKind !== 'password') throw new Error('Set a new master password first.');
      const remote = new RemoteClient(RemoteClient.check(url));
      let envelope = this.envelope, recoveryAuthKey, code = null;
      if (envelope.keys.recovery) {
        const r = await resetRecovery(envelope, this.keys);
        envelope = r.envelope; recoveryAuthKey = r.authKey; code = r.code;
      }
      this.payload.settings = { ...this.payload.settings, sync: { url: remote.base, username: username.trim().toLowerCase() }, updatedAt: now() };
      const env = await encryptPayload(envelope, this.keys.dataKey, this.payload);
      const res = await remote.register({ username, authKey: this.keys.authKey, recoveryAuthKey, kdf: env.kdf, vault: env, invite: invite || undefined });
      this.envelope = env;
      this.remote = remote;
      this.username = username.trim().toLowerCase();
      this.meta.remoteRev = res.rev;
      await this.saveLocal();
      this.setStatus('synced');
      this.emit('changed');
      return code;
    });
  }

  /** Join an existing account: its master password and keys replace this vault's; contents are merged. */
  signInToAccount(url, username, password) {
    return this.serial(async () => {
      const remote = new RemoteClient(RemoteClient.check(url));
      const u = username.trim().toLowerCase();
      const pre = await remote.prelogin(u);
      const derived = await deriveFromPassword(password, pre.kdf);
      try { await remote.login(u, derived.authKey); }
      catch (e) { if (e instanceof RemoteError && e.status === 401) throw new WrongPasswordError('Wrong username or master password for that server'); throw e; }
      const r = await remote.getVault();
      const opened = await openVaultDerived(r.vault, derived);
      const merged = mergePayloads(this.payload, opened.payload);
      merged.settings = { ...merged.settings, sync: { url: remote.base, username: u }, updatedAt: now() };
      this.keys.lock();
      this.keys = opened.keys;
      this.authKind = 'password';
      this.envelope = r.vault;
      this.payload = merged;
      this.remote = remote;
      this.username = u;
      const env = await this.sealChecked();
      const res = await remote.putVault(r.rev, env);
      this.envelope = env;
      this.meta.remoteRev = res.rev;
      await this.saveLocal();
      this.setStatus('synced');
      this.emit('changed');
    });
  }

  disconnect() {
    return this.serial(async () => {
      if (this.remote) await this.remote.logout();
      this.remote = null;
      this.username = null;
      this.meta.remoteRev = 0;
      this.payload.settings = { ...this.payload.settings, sync: null, updatedAt: now() };
      await this.saveLocal();
      this.setStatus('local');
      this.emit('changed');
    });
  }

  lock() {
    clearTimeout(this.syncTimer);
    this.keys && this.keys.lock();
    this.payload = null;
    this.listeners.clear();
  }
}

/** Open a vault record from local storage. */
export async function openLocal(local, password, opts) {
  const rec = await local.load();
  if (!rec) return null;
  const { payload, keys } = await openVault(rec.vault, password, opts);
  return { rec, payload, keys };
}
