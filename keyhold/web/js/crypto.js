// Keyhold vault encryption. Runs in the browser (and in Node 20+ for tests),
// using only the Web Crypto API.
//
//   master password --PBKDF2-SHA256 (600,000 rounds, 16-byte salt)--> master key
//   master key --HKDF "kek"--> key-encryption key (never leaves this device)
//   master key --HKDF "auth"--> sign-in key (sent to a sync server, which hashes it again)
//   random 256-bit data key --AES-256-GCM--> the vault contents
//   data key is stored wrapped by the key-encryption key, and optionally by a
//   recovery code (160 random bits, HKDF "recovery-kek").
//
// Nothing about the contents is stored in clear: titles, folders and counts are
// all inside the encrypted data. The vault id is bound into every GCM tag as
// associated data, so pieces cannot be swapped between vaults.

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_NAME = 'PBKDF2-SHA256';
export const DEFAULT_ITERATIONS = 600000;
export const MIN_ITERATIONS = 100000;

export function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

export const b64 = {
  enc(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(u8) {
  let bits = 0, value = 0, out = '';
  for (const byte of u8) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Invalid character in code');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function uuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class WrongPasswordError extends Error {
  constructor(msg = 'Wrong master password') { super(msg); this.name = 'WrongPasswordError'; }
}

async function splitKey(raw, kekInfo, authInfo) {
  const hk = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const salt = new Uint8Array(0);
  const kek = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(kekInfo) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const auth = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(authInfo) }, hk, 256));
  raw.fill(0);
  return { kek, authKey: b64.enc(auth) };
}

/** Derive the key-encryption key and sign-in key from a master password. */
export async function deriveFromPassword(password, kdf, { minIterations = MIN_ITERATIONS } = {}) {
  if (!kdf || kdf.name !== KDF_NAME) throw new Error('Unsupported key derivation: ' + (kdf && kdf.name));
  if (!(kdf.iterations >= minIterations) || kdf.iterations > 10000000) throw new Error('Unsafe key derivation settings in this vault');
  const base = await subtle.importKey('raw', te.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const master = new Uint8Array(await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64.dec(kdf.salt), iterations: kdf.iterations }, base, 256));
  return splitKey(master, 'keyhold/v1/kek', 'keyhold/v1/auth');
}

/** Derive keys from a recovery code ("ABCD-EFGH-..."). */
export async function deriveFromRecovery(code) {
  const raw = base32Decode(code);
  if (raw.length !== 20) throw new WrongPasswordError('That recovery code is not complete. It has 32 letters and digits.');
  return splitKey(raw, 'keyhold/v1/recovery-kek', 'keyhold/v1/recovery-auth');
}

export function formatRecoveryCode(raw) {
  return base32Encode(raw).match(/.{1,4}/g).join('-');
}

async function seal(key, plain, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, plain));
  return { iv: b64.enc(iv), ct: b64.enc(ct) };
}

async function unseal(key, box, aad) {
  return new Uint8Array(await subtle.decrypt(
    { name: 'AES-GCM', iv: b64.dec(box.iv), additionalData: te.encode(aad) }, key, b64.dec(box.ct)));
}

const aadData = (id) => `keyhold-vault/1/data/${id}`;
const aadKey = (id, kind) => `keyhold-vault/1/key/${kind}/${id}`;

async function importDataKey(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Keys for an open vault. `dek` is kept only to re-wrap the data key when the
 * master password or recovery code changes; `lock()` wipes it.
 */
export class VaultKeys {
  constructor(dek, dataKey, authKey) { this.dek = dek; this.dataKey = dataKey; this.authKey = authKey; }
  lock() { if (this.dek) this.dek.fill(0); this.dek = null; this.dataKey = null; this.authKey = null; }
}

/** Create a new vault. Returns { envelope, keys, recovery: {code, authKey} | null }. */
export async function createVault(password, payload, { iterations = DEFAULT_ITERATIONS, recovery = true, minIterations } = {}) {
  const id = uuid();
  const kdf = { name: KDF_NAME, iterations, salt: b64.enc(randomBytes(16)) };
  const { kek, authKey } = await deriveFromPassword(password, kdf, { minIterations: minIterations ?? Math.min(MIN_ITERATIONS, iterations) });
  const dek = randomBytes(32);
  const dataKey = await importDataKey(dek);
  const envelope = { format: 'keyhold-vault', v: 1, id, kdf, keys: { password: await seal(kek, dek, aadKey(id, 'password')) }, data: null };
  let rec = null;
  if (recovery) {
    const r = await addRecovery(envelope, dek);
    envelope.keys.recovery = r.box;
    rec = { code: r.code, authKey: r.authKey };
  }
  envelope.data = await seal(dataKey, te.encode(JSON.stringify(payload)), aadData(id));
  return { envelope, keys: new VaultKeys(dek, dataKey, authKey), recovery: rec };
}

async function addRecovery(envelope, dek) {
  const raw = randomBytes(20);
  const code = formatRecoveryCode(raw);
  const { kek, authKey } = await deriveFromRecovery(code);
  return { code, authKey, box: await seal(kek, dek, aadKey(envelope.id, 'recovery')) };
}

function checkEnvelope(env) {
  if (!env || env.format !== 'keyhold-vault' || env.v !== 1 || !env.id || !env.keys || !env.keys.password || !env.data) {
    throw new Error('This is not a Keyhold vault file');
  }
}

async function openWith(env, kek, kind, authKey) {
  let dek;
  try { dek = await unseal(kek, env.keys[kind], aadKey(env.id, kind)); }
  catch { throw new WrongPasswordError(kind === 'recovery' ? 'That recovery code does not open this vault' : undefined); }
  const dataKey = await importDataKey(dek);
  const payload = await decryptPayload(env, dataKey);
  return { payload, keys: new VaultKeys(dek, dataKey, authKey) };
}

/** Open with the master password. Throws WrongPasswordError. */
export async function openVault(env, password, opts) {
  checkEnvelope(env);
  const { kek, authKey } = await deriveFromPassword(password, env.kdf, opts);
  return openWith(env, kek, 'password', authKey);
}

/** Open with keys already derived by deriveFromPassword (avoids a second slow derivation). */
export async function openVaultDerived(env, derived, kind = 'password') {
  checkEnvelope(env);
  return openWith(env, derived.kek, kind, derived.authKey);
}

/** Open with a recovery code. keys.authKey is the recovery sign-in key. */
export async function openVaultWithRecovery(env, code) {
  checkEnvelope(env);
  if (!env.keys.recovery) throw new WrongPasswordError('This vault has no recovery code');
  const { kek, authKey } = await deriveFromRecovery(code);
  return openWith(env, kek, 'recovery', authKey);
}

/** Decrypt the contents with an already-known data key (used when syncing). */
export async function decryptPayload(env, dataKey) {
  checkEnvelope(env);
  let plain;
  try { plain = await unseal(dataKey, env.data, aadData(env.id)); }
  catch { throw new WrongPasswordError('The vault contents could not be decrypted (damaged, or encrypted with another key)'); }
  return JSON.parse(td.decode(plain));
}

/** Encrypt new contents into a copy of the envelope (fresh IV every time). */
export async function encryptPayload(env, dataKey, payload) {
  const next = structuredClone(env);
  next.data = await seal(dataKey, te.encode(JSON.stringify(payload)), aadData(env.id));
  return next;
}

/** New master password: new salt, new wrap of the same data key. */
export async function changePassword(env, keys, newPassword, { iterations = Math.max(env.kdf.iterations, DEFAULT_ITERATIONS), minIterations } = {}) {
  const kdf = { name: KDF_NAME, iterations, salt: b64.enc(randomBytes(16)) };
  const { kek, authKey } = await deriveFromPassword(newPassword, kdf, { minIterations: minIterations ?? Math.min(MIN_ITERATIONS, iterations) });
  const next = structuredClone(env);
  next.kdf = kdf;
  next.keys.password = await seal(kek, keys.dek, aadKey(env.id, 'password'));
  return { envelope: next, authKey };
}

/** Create or replace the recovery code. */
export async function resetRecovery(env, keys) {
  const next = structuredClone(env);
  const r = await addRecovery(next, keys.dek);
  next.keys.recovery = r.box;
  return { envelope: next, code: r.code, authKey: r.authKey };
}

export function removeRecovery(env) {
  const next = structuredClone(env);
  delete next.keys.recovery;
  return next;
}

/** SHA-1 hex, used only for the k-anonymity breach check. */
export async function sha1Hex(text) {
  const d = new Uint8Array(await subtle.digest('SHA-1', te.encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
