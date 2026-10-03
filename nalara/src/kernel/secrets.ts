/**
 * Secret store: credentials live in the kernel and are injected at the gateway, never handed to agents or shells.
 *
 * - Values are kept in `<dataDir>/secrets.json` (file mode 0600) and are never returned by any API: list() gives
 *   names and timestamps only.
 * - MCP server configs reference them as `${secret:NAME}` in `env` and `headers`; the kernel resolves the
 *   placeholders only at connect time, so the stored config, the API and the UI never contain the value.
 * - redact() replaces any stored value that appears in text (tool results, events, HTTP responses) with
 *   `[secret:NAME]`, so a server that echoes a token cannot leak it into a transcript.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nowIso } from "./ids";
import type { SecretInfo } from "./types";

export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_PLACEHOLDER_RE = /\$\{secret:([A-Za-z0-9_]+)\}/g;
const MAX_SECRET_BYTES = 8192;
/** Shorter values are stored but not redacted: replacing every "abc" in every transcript would destroy the text. */
export const MIN_REDACT_LENGTH = 6;

export type { SecretInfo };

/** HTTP 400: an invalid name or value. 404-ish lookups are reported by the callers. */
export class SecretError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

export interface SecretStore {
  set(name: string, value: string): SecretInfo;
  delete(name: string): boolean;
  list(): SecretInfo[];
  has(name: string): boolean;
  /** Names referenced by `${secret:NAME}` placeholders in a string. */
  references(text: string): string[];
  /** Replaces placeholders with values; throws SecretError naming every missing secret. */
  resolve(text: string): string;
  resolveRecord(record: Record<string, string> | undefined): Record<string, string> | undefined;
  redact(text: string): string;
  /** Deep copy with every string redacted. */
  redactValue<T>(value: T): T;
}

interface StoredSecret {
  value: string;
  createdAt: string;
  updatedAt: string;
}

export function createSecretStore(opts: { dataDir?: string; file?: string } = {}): SecretStore {
  const file = opts.file ?? (opts.dataDir ? join(opts.dataDir, "secrets.json") : undefined);
  const secrets = new Map<string, StoredSecret>();
  if (file && existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredSecret>;
      for (const [name, s] of Object.entries(raw)) if (SECRET_NAME_RE.test(name) && typeof s?.value === "string") secrets.set(name, s);
    } catch {
      // A corrupt file loads as empty; the next set() rewrites it.
    }
  }
  let ordered: [string, string][] = [];
  const reindex = () => {
    // Longest values first, so a secret that contains another is replaced whole.
    ordered = [...secrets].filter(([, s]) => s.value.length >= MIN_REDACT_LENGTH).map(([n, s]) => [n, s.value] as [string, string]).sort((a, b) => b[1].length - a[1].length);
  };
  reindex();

  function persist() {
    if (!file) return;
    const tmp = `${file}.tmp`;
    // The data dir may not exist yet (a fresh project, or the CLI before the first serve).
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(secrets), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // best effort on platforms without POSIX modes
    }
    renameSync(tmp, file);
  }

  const info = (name: string, s: StoredSecret): SecretInfo => ({ name, createdAt: s.createdAt, updatedAt: s.updatedAt, redacted: s.value.length >= MIN_REDACT_LENGTH });

  function redact(text: string): string {
    if (!ordered.length || typeof text !== "string" || !text) return text;
    let out = text;
    for (const [name, value] of ordered) if (out.includes(value)) out = out.split(value).join(`[secret:${name}]`);
    return out;
  }

  function redactValue<T>(value: T): T {
    if (!ordered.length) return value;
    if (typeof value === "string") return redact(value) as T;
    if (Array.isArray(value)) return value.map((v) => redactValue(v)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v);
      return out as T;
    }
    return value;
  }

  function references(text: string): string[] {
    return [...new Set([...String(text ?? "").matchAll(SECRET_PLACEHOLDER_RE)].map((m) => m[1]))];
  }

  function resolve(text: string): string {
    const missing = references(text).filter((n) => !secrets.has(n));
    if (missing.length) throw new SecretError(`missing secret(s): ${missing.join(", ")} (set them with PUT /api/secrets/<name> or \`nalara secret set\`)`);
    return String(text).replace(SECRET_PLACEHOLDER_RE, (_, name: string) => secrets.get(name)!.value);
  }

  return {
    set(name, value) {
      if (!SECRET_NAME_RE.test(name)) throw new SecretError("secret names are upper case letters, digits and _ and start with a letter (max 64)");
      if (typeof value !== "string" || !value) throw new SecretError("secret value must be a non-empty string");
      if (Buffer.byteLength(value) > MAX_SECRET_BYTES) throw new SecretError(`secret value is larger than ${MAX_SECRET_BYTES} bytes`);
      const now = nowIso();
      const s: StoredSecret = { value, createdAt: secrets.get(name)?.createdAt ?? now, updatedAt: now };
      secrets.set(name, s);
      reindex();
      persist();
      return info(name, s);
    },
    delete(name) {
      const had = secrets.delete(name);
      if (had) {
        reindex();
        persist();
      }
      return had;
    },
    list: () => [...secrets].map(([n, s]) => info(n, s)).sort((a, b) => a.name.localeCompare(b.name)),
    has: (name) => secrets.has(name),
    references,
    resolve,
    resolveRecord(record) {
      if (!record) return record;
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, resolve(v)]));
    },
    redact,
    redactValue,
  };
}
