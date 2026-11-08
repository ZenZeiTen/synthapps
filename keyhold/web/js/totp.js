// Time-based one-time passwords (RFC 6238), from a base32 secret or an
// otpauth:// URI.
import { base32Decode } from './crypto.js';

const ALGS = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

/** Parse a stored value into { secret: Uint8Array, digits, period, algorithm, issuer, label }. */
export function parseTotp(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  let secret = v, digits = 6, period = 30, algorithm = 'SHA1', issuer = '', label = '';
  if (/^otpauth:\/\//i.test(v)) {
    const u = new URL(v);
    if (u.host.toLowerCase() !== 'totp') throw new Error('Only time-based codes (TOTP) are supported');
    label = decodeURIComponent(u.pathname.replace(/^\//, ''));
    secret = u.searchParams.get('secret') || '';
    digits = parseInt(u.searchParams.get('digits') || '6', 10);
    period = parseInt(u.searchParams.get('period') || '30', 10);
    algorithm = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    issuer = u.searchParams.get('issuer') || '';
  }
  if (!ALGS[algorithm]) throw new Error('Unsupported algorithm ' + algorithm);
  if (!(digits >= 6 && digits <= 10) || !(period >= 10 && period <= 300)) throw new Error('Unsupported code settings');
  const bytes = base32Decode(secret);
  if (bytes.length < 10) throw new Error('The two-factor secret is too short');
  return { secret: bytes, digits, period, algorithm, issuer, label };
}

/** Generate the code for time (ms). */
export async function totpCode(cfg, now = Date.now()) {
  const counter = Math.floor(now / 1000 / cfg.period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const key = await globalThis.crypto.subtle.importKey('raw', cfg.secret, { name: 'HMAC', hash: ALGS[cfg.algorithm] }, false, ['sign']);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  const code = String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0');
  const remaining = cfg.period - (Math.floor(now / 1000) % cfg.period);
  return { code, remaining, period: cfg.period };
}
