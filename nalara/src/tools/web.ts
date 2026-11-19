/**
 * web.fetch: reads one public web page or text document over http(s) for agents. It is a pure read (GET only, no
 * cookies, no credentials, nothing stored), so it also runs in the readonly ("safe") tool policy.
 *
 * Guards:
 * - http and https only; no user:password in the URL; no URL that carries a saved secret or secret-looking text.
 * - Less room to carry data out: at most 512 characters, no long encoded-looking runs (base64, hex, tokens) in the
 *   path or query, and the #fragment is dropped. This narrows, but cannot rule out, a prompt-injected agent putting
 *   what it read into a URL; agent tool budgets bound how often it can try.
 * - No local or private network: every address a host resolves to must be public, the connection goes to the
 *   checked address (no DNS rebinding), and each redirect (at most 5) is checked the same way.
 * - Text only (HTML, plain text, JSON, XML, Markdown); at most 2 MB read; 15 s timeout.
 * The page is untrusted data: the gateway wraps it as tool output for the model.
 */
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";

export const WEB_FETCH_TIMEOUT_MS = 15_000;
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const WEB_FETCH_MAX_REDIRECTS = 5;
export const WEB_FETCH_DEFAULT_CHARS = 20_000;
export const WEB_FETCH_MAX_CHARS = 100_000;
/** Longest URL fetched. Ordinary page addresses fit easily; long ones are a way to carry data out. */
export const WEB_FETCH_MAX_URL = 512;
/** Longest unbroken run of letters, digits and +/=% (base64, hex, tokens) allowed in one path segment or query value. */
export const WEB_FETCH_MAX_OPAQUE = 48;

/** Key and token shapes; the same families the assistant masks. */
const SECRET_SHAPES =
  /\b(sk-[A-Za-z0-9_-]{12,}|sk_(live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/;
const SECRET_PARAMS = /[?&;](password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|auth)=/i;

const TEXT_TYPES = /^(text\/[a-z0-9.+-]+|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json|javascript|x-ndjson)|[a-z]+\/[a-z0-9.-]*\+(json|xml))$/i;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64],
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** IPv4 address embedded in an IPv6 one (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96), if any. */
function embeddedV4(ip: string): string | undefined {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return undefined;
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast, documentation and reserved addresses. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true; // not an address at all
}

export class WebFetchError extends Error {}

export interface WebFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  /** Masks saved secrets; a URL it changes is refused. */
  redact?: (text: string) => string;
  /** Host -> addresses. Default: the system resolver. */
  resolve?: (host: string) => Promise<string[]>;
  /** Default: isBlockedAddress. Tests may loosen it to reach a local server. */
  isBlocked?: (ip: string) => boolean;
}

export interface WebPage {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  bytes: number;
  truncatedBytes: boolean;
}

/** Throws WebFetchError when a URL may not be fetched. Returns the parsed URL. */
export function checkUrl(raw: string, opts: Pick<WebFetchOptions, "redact" | "isBlocked"> = {}): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new WebFetchError("A URL is required");
  if (raw.trim().length > WEB_FETCH_MAX_URL) throw new WebFetchError(`The URL is too long (over ${WEB_FETCH_MAX_URL} characters); long URLs can carry data out, so they are not fetched`);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebFetchError(`Not a valid URL: ${raw.slice(0, 200)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebFetchError(`Only http and https URLs can be fetched, not ${url.protocol}`);
  if (url.username || url.password) throw new WebFetchError("URLs with a user name or password are not fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new WebFetchError("The URL has no host");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    throw new WebFetchError(`${host} is a local address; only public web addresses can be fetched`);
  }
  if (isIP(host) && (opts.isBlocked ?? isBlockedAddress)(host)) throw new WebFetchError(`${host} is a local or private address; only public web addresses can be fetched`);
  // The fragment never reaches the server; drop it so it cannot matter.
  url.hash = "";
  const decoded = safeDecode(url.href);
  if (SECRET_SHAPES.test(decoded) || SECRET_PARAMS.test(decoded) || (opts.redact && opts.redact(decoded) !== decoded)) {
    throw new WebFetchError("The URL contains a key, token or saved secret; it was not fetched");
  }
  const parts = [...url.pathname.split("/"), ...[...url.searchParams].flatMap(([k, v]) => [k, v])].map(safeDecode);
  // Unbroken runs only: slugs and titles ("how-to-…", "List_of_…") have separators, encoded data usually does not.
  const opaque = new RegExp(`[A-Za-z0-9+/=%]{${WEB_FETCH_MAX_OPAQUE + 1},}`);
  if (parts.some((p) => opaque.test(p))) {
    throw new WebFetchError(`The URL contains a long encoded-looking value (over ${WEB_FETCH_MAX_OPAQUE} characters); such values can carry data out, so it was not fetched`);
  }
  return url;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A lookup that only ever returns checked public addresses, so the socket connects to what was checked. */
function guardedLookup(resolve: (host: string) => Promise<string[]>, isBlocked: (ip: string) => boolean): LookupFunction {
  return ((hostname: string, options: { all?: boolean } | number, callback: (...args: unknown[]) => void) => {
    const cb = typeof options === "function" ? (options as (...args: unknown[]) => void) : callback;
    const all = typeof options === "object" && options !== null && options.all === true;
    resolve(hostname).then(
      (addresses) => {
        if (!addresses.length) return cb(new WebFetchError(`${hostname} could not be resolved`));
        const bad = addresses.find((a) => isBlocked(a));
        if (bad) return cb(new WebFetchError(`${hostname} resolves to a local or private address (${bad}); only public web addresses can be fetched`));
        const list = addresses.map((address) => ({ address, family: isIP(address) }));
        if (all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      },
      (err: unknown) => cb(new WebFetchError(`${hostname} could not be resolved: ${err instanceof Error ? err.message : String(err)}`)),
    );
  }) as LookupFunction;
}

const systemResolve = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
}

function requestOnce(url: URL, opts: Required<Pick<WebFetchOptions, "maxBytes">> & { lookup: LookupFunction; signal: AbortSignal }): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: opts.lookup,
        agent: false,
        signal: opts.signal,
        headers: {
          "user-agent": "Nalara/0.2 (web.fetch; +https://github.com/ZenZeiTen/synthapps)",
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json,application/xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolvePromise({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = opts.maxBytes - size;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, room));
            size += room;
            truncated = true;
            res.destroy();
            return resolvePromise({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        res.on("end", () => resolvePromise({ status, headers: res.headers, body: Buffer.concat(chunks), truncated }));
        res.on("error", (err) => (truncated ? undefined : reject(err)));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Fetches one URL with the guards above; follows redirects itself so every hop is checked. */
export async function fetchPage(raw: string, opts: WebFetchOptions = {}): Promise<WebPage> {
  const isBlocked = opts.isBlocked ?? isBlockedAddress;
  const lookup = guardedLookup(opts.resolve ?? systemResolve, isBlocked);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? WEB_FETCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const maxBytes = opts.maxBytes ?? WEB_FETCH_MAX_BYTES;

  let url = checkUrl(raw, { redact: opts.redact, isBlocked });
  for (let hop = 0; ; hop++) {
    let res: RawResponse;
    try {
      res = await requestOnce(url, { maxBytes, lookup, signal });
    } catch (err) {
      if (err instanceof WebFetchError) throw err;
      if (timeout.aborted) throw new WebFetchError(`Timed out after ${Math.round((opts.timeoutMs ?? WEB_FETCH_TIMEOUT_MS) / 1000)} s: ${url.href}`);
      if (opts.signal?.aborted) throw new WebFetchError("Stopped");
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof WebFetchError) throw cause;
      throw new WebFetchError(`Could not fetch ${url.href}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= WEB_FETCH_MAX_REDIRECTS) throw new WebFetchError(`Too many redirects (more than ${WEB_FETCH_MAX_REDIRECTS})`);
      url = checkUrl(new URL(res.headers.location, url).href, { redact: opts.redact, isBlocked });
      continue;
    }
    const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type && !TEXT_TYPES.test(type)) throw new WebFetchError(`${url.href} is ${type}, not a text page; only text, HTML, JSON and XML are read`);
    if (!type && res.body.subarray(0, 8000).includes(0)) throw new WebFetchError(`${url.href} looks like a binary file; only text pages are read`);
    const text = decodeBody(res.body, String(res.headers["content-type"] ?? ""));
    const html = type === "text/html" || type === "application/xhtml+xml" || (!type && /^\s*<(!doctype html|html)/i.test(text));
    const page = html ? htmlToText(text, url) : { text: text.trim() };
    return {
      url: url.href,
      status: res.status,
      contentType: type || "unknown",
      ...(page.title ? { title: page.title } : {}),
      text: page.text,
      bytes: res.body.length,
      truncatedBytes: res.truncated,
    };
  }
}

function decodeBody(body: Buffer, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, "") || "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text from HTML: no scripts or styles, block breaks kept, links as "text [url]". */
export function htmlToText(html: string, base?: URL): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, " ").trim()) || undefined : undefined;
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, d1, d2, d3, inner: string) => {
    const href = decodeEntities(String(d1 ?? d2 ?? d3 ?? "").trim());
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) return ` ${label} `;
    let abs = href;
    try {
      abs = base ? new URL(href, base).href : href;
    } catch {
      /* keep as written */
    }
    return label ? ` ${label} [${abs}] ` : ` [${abs}] `;
  });
  s = s
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|table|tr|h[1-6]|blockquote|pre|figure|dl|dt|dd)\s*>/gi, "\n")
    .replace(/<(p|div|section|article|tr|blockquote|pre|table|ul|ol|dl)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...(title ? { title } : {}), text };
}

/** What the model sees: where the page came from, then its text, bounded. */
export function formatPage(page: WebPage, maxChars = WEB_FETCH_DEFAULT_CHARS): string {
  const head = [`URL: ${page.url}`, `Status: ${page.status}`, `Type: ${page.contentType}`, ...(page.title ? [`Title: ${page.title}`] : [])];
  let body = page.text;
  const notes: string[] = [];
  if (body.length > maxChars) {
    notes.push(`[cut at ${maxChars} of ${body.length} characters; ask again with a larger max_chars to read more]`);
    body = body.slice(0, maxChars);
  }
  if (page.truncatedBytes) notes.push(`[only the first ${Math.round(WEB_FETCH_MAX_BYTES / 1024 / 1024)} MB of the page was read]`);
  return [...head, "", body || "(no text on this page)", ...(notes.length ? ["", ...notes] : [])].join("\n");
}
