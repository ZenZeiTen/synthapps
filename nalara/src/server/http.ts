/**
 * HTTP + SSE server for the Nalara UI and the CLI (routes: src/server/api-contract.ts). node:http only.
 *
 * Security (the API has no authentication, SAFETY.md 1):
 *   - the bind address comes from config, which refuses non-loopback hosts unless NALARA_ALLOW_REMOTE=1;
 *   - a request whose Origin header is present and is not this server's own origin gets 403 (cross-site pages);
 *   - on a loopback bind, a Host header that is not a loopback name gets 403 (DNS rebinding);
 *   - POST/PUT/DELETE need `X-Nalara-Client: 1` (a header cross-site forms cannot set);
 *   - JSON bodies are capped at 1 MB; static files are confined to the static directory.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { canonicalJson } from "../kernel/audit";
import { isLoopbackHost } from "../kernel/config";
import { KERNEL_VERSION, type NeuralKernel } from "../kernel/kernel";
import { detectKind } from "../search/index";
import {
  MEMORY_CATEGORIES,
  NODE_TYPES,
  type RelayKind,
  type KernelEvent,
  type McpServerConfig,
  type MemoryCategory,
  type NodeType,
  type ToolAction,
  type ToolPolicy,
} from "../kernel/types";
import type { GraphSlice, NodeDetail, RadialMenu, WorkspaceDetail } from "./api-contract";

export const MAX_BODY_BYTES = 1024 * 1024;
/** Major version of the HTTP API. Clients may send X-Nalara-Api-Version; versions in SUPPORTED_API_VERSIONS are accepted. */
export const API_VERSION = 2;
export const SUPPORTED_API_VERSIONS = [1, 2];
export const API_FEATURES = [
  "intents",
  "workspaces",
  "agents",
  "radial",
  "search",
  "memory",
  "tools",
  "mcp",
  "approvals",
  "policy",
  "triggers",
  "workflows",
  "kill-switch",
  "audit",
  "journal",
  "events-stream",
  "process-tree",
  "relay",
  "adversarial-review",
  "fleet-memory",
  "fleet-budgets",
  "observatory",
  "work-queue",
  "secrets",
  "idempotency-keys",
  "structured-errors",
];
/** How long a response is kept for replay under its Idempotency-Key. */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const IDEMPOTENCY_MAX_ENTRIES = 1000;
const RELAY_KINDS: RelayKind[] = ["spawn", "handoff", "challenge", "verdict", "result"];
export const SSE_HEARTBEAT_MS = 15_000;
const SSE_DEFAULT_REPLAY = 200;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Stable machine-readable error code; defaults from the status (see codeFor). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const STATUS_CODES: Record<number, string> = {
  400: "invalid_request",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  422: "unprocessable",
  500: "internal_error",
};

/** Structured errors: every error body is { error, code }; codes are stable, messages are for people. */
export function codeFor(err: unknown, status: number): string {
  const own = (err as { code?: unknown })?.code;
  if (typeof own === "string" && /^[a-z][a-z0-9_]*$/.test(own)) return own;
  const name = (err as { name?: unknown })?.name;
  if (name === "KernelHaltedError") return "kernel_halted";
  if (name === "SecretError") return "invalid_secret";
  if (name === "ConfigError") return "invalid_config";
  return STATUS_CODES[status] ?? (status >= 500 ? "internal_error" : "request_failed");
}

export interface NeuralHttpServer {
  readonly server: Server;
  /** Listens on the given port/host (defaults: the kernel config). Port 0 picks a free port. */
  listen(port?: number, host?: string): Promise<{ url: string; port: number; host: string }>;
  /** Ends SSE streams and closes the server. Does not stop the kernel. */
  close(): Promise<void>;
  url(): string | undefined;
}

type Query = URLSearchParams;
type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Nalara-Api-Version": String(API_VERSION),
    ...headers,
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, `Request body is larger than ${MAX_BODY_BYTES} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, `Request body is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(buf);
  }
  if (!size) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Request body must be a JSON object");
  return parsed as Json;
}

const text = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${name} is required`);
  return v;
};
const optInt = (q: Query, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined => {
  const raw = q.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be an integer between ${min} and ${max}`);
  return n;
};
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

function statusOf(err: unknown): number {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" && s >= 400 && s < 600 ? s : 500;
}

function validatePolicy(body: Json): ToolPolicy {
  if (!["auto", "ask", "readonly"].includes(String(body.mode))) throw new HttpError(400, "mode must be auto, ask or readonly");
  const list = (v: unknown, name: string): string[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, `${name} must be an array of strings`);
    return v as string[];
  };
  const policy: ToolPolicy = { mode: body.mode as ToolPolicy["mode"] };
  const allow = list(body.allow, "allow");
  const deny = list(body.deny, "deny");
  if (allow) policy.allow = allow;
  if (deny) policy.deny = deny;
  if (body.approvalTimeoutMs !== undefined) {
    const n = Number(body.approvalTimeoutMs);
    if (!Number.isInteger(n) || n < 1000) throw new HttpError(400, "approvalTimeoutMs must be an integer >= 1000");
    policy.approvalTimeoutMs = n;
  }
  return policy;
}

function validateMcpConfig(v: unknown): McpServerConfig {
  if (!isObj(v)) throw new HttpError(400, "config must be an object");
  const cfg: McpServerConfig = {};
  const strs = (x: unknown, name: string) => {
    if (!Array.isArray(x) || x.some((s) => typeof s !== "string")) throw new HttpError(400, `config.${name} must be an array of strings`);
    return x as string[];
  };
  const map = (x: unknown, name: string) => {
    if (!isObj(x) || Object.values(x).some((s) => typeof s !== "string")) throw new HttpError(400, `config.${name} must be an object of strings`);
    return x as Record<string, string>;
  };
  if (v.command !== undefined) cfg.command = text(v.command, "config.command");
  if (v.args !== undefined) cfg.args = strs(v.args, "args");
  if (v.env !== undefined) cfg.env = map(v.env, "env");
  if (v.cwd !== undefined) cfg.cwd = text(v.cwd, "config.cwd");
  if (v.url !== undefined) cfg.url = text(v.url, "config.url");
  if (v.headers !== undefined) cfg.headers = map(v.headers, "headers");
  if (!cfg.command === !cfg.url) throw new HttpError(400, "config needs exactly one of command (stdio) or url (HTTP)");
  return cfg;
}

interface IdempotentEntry {
  hash: string;
  expires: number;
  result: Promise<{ status: number; body: unknown } | undefined>;
}

export function createHttpServer(kernel: NeuralKernel, opts: { staticDir?: string; now?: () => number } = {}): NeuralHttpServer {
  const staticRoot = opts.staticDir && existsSync(opts.staticDir) ? realpathSync(opts.staticDir) : undefined;
  const sseClients = new Set<ServerResponse>();
  let boundHost = kernel.config.host;
  const now = opts.now ?? Date.now;
  const idempotent = new Map<string, IdempotentEntry>();

  /** Every JSON response passes the secret redactor: a credential never reaches a shell, whatever produced it. */
  const reply = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => send(res, status, kernel.secrets.redactValue(body), headers);

  function pruneIdempotent() {
    const t = now();
    for (const [k, e] of idempotent) if (e.expires <= t) idempotent.delete(k);
    while (idempotent.size > IDEMPOTENCY_MAX_ENTRIES) idempotent.delete(idempotent.keys().next().value!);
  }

  function checkApiVersion(req: IncomingMessage) {
    const raw = req.headers["x-nalara-api-version"];
    if (raw === undefined) return;
    const major = Number(String(raw).split(".")[0]);
    if (!SUPPORTED_API_VERSIONS.includes(major)) {
      throw new HttpError(400, `API version ${String(raw)} is not supported (supported: ${SUPPORTED_API_VERSIONS.join(", ")})`, "unsupported_version");
    }
  }

  function boundPort(): number | undefined {
    const addr = server.address();
    return addr && typeof addr === "object" ? (addr as AddressInfo).port : undefined;
  }

  /** The server's own origins: the configured host plus loopback aliases when it is loopback. */
  function allowedOrigins(): Set<string> {
    const port = boundPort() ?? kernel.config.port;
    const hosts = new Set<string>([boundHost.includes(":") && !boundHost.startsWith("[") ? `[${boundHost}]` : boundHost]);
    if (isLoopbackHost(boundHost)) for (const h of ["127.0.0.1", "localhost", "[::1]"]) hosts.add(h);
    const out = new Set<string>();
    for (const h of hosts) for (const scheme of ["http", "https"]) out.add(`${scheme}://${h}:${port}`);
    return out;
  }

  function checkRequest(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins().has(origin.toLowerCase())) throw new HttpError(403, `Origin ${origin} is not allowed`);
    if (isLoopbackHost(boundHost)) {
      const host = String(req.headers.host ?? "").toLowerCase();
      const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
      if (host && !isLoopbackHost(hostname)) throw new HttpError(403, `Host ${host} is not allowed`);
    }
    const method = req.method ?? "GET";
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && req.headers["x-nalara-client"] !== "1") {
      throw new HttpError(403, "Missing X-Nalara-Client: 1 header (required on every mutating request)");
    }
  }

  // --- static files -------------------------------------------------------------------------------

  function serveStatic(req: IncomingMessage, res: ServerResponse, rawPath: string): void {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
    if (!staticRoot) throw new HttpError(404, "No UI build is being served (run npm run build)");
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      throw new HttpError(400, "Malformed URL");
    }
    if (decoded.includes("\0")) throw new HttpError(400, "Malformed URL");
    const target = resolve(staticRoot, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
    const rel = relative(staticRoot, target);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new HttpError(404, "Not found");
    let file = target;
    let ok = false;
    try {
      const st = statSync(file);
      if (st.isDirectory()) file = join(file, "index.html");
      ok = statSync(file).isFile();
      if (ok) {
        const real = realpathSync(file);
        const r = relative(staticRoot, real);
        if (r.startsWith(`..${sep}`) || r === ".." || isAbsolute(r)) ok = false;
        else file = real;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // SPA fallback: unknown paths get the app, but missing assets (with an extension) stay 404.
      const index = join(staticRoot, "index.html");
      if (extname(decoded) && extname(decoded) !== ".html") throw new HttpError(404, "Not found");
      if (!existsSync(index)) throw new HttpError(404, "Not found");
      file = index;
    }
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const size = statSync(file).size;
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": size,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  // --- SSE ------------------------------------------------------------------------------------------

  function stream(req: IncomingMessage, res: ServerResponse, q: Query): void {
    const sinceRaw = q.get("since") ?? (typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null);
    let since: number | undefined;
    if (sinceRaw !== null && sinceRaw !== "") {
      const n = Number(sinceRaw);
      if (!Number.isInteger(n) || n < 0) throw new HttpError(400, "since must be a non-negative integer");
      since = n;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    let lastSent = since ?? 0;
    const write = (ev: KernelEvent) => {
      if (ev.seq <= lastSent || res.writableEnded) return;
      lastSent = ev.seq;
      res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(kernel.secrets.redactValue(ev))}\n\n`);
    };
    // Subscribe first: bus handlers run in a microtask, so nothing published during the replay is lost or doubled.
    const unsubscribe = kernel.bus.subscribe("*", write);
    res.write("retry: 2000\n: connected\n\n");
    const replay = since !== undefined ? kernel.bus.history({ sinceSeq: since }) : kernel.bus.history({ limit: SSE_DEFAULT_REPLAY });
    for (const ev of replay) write(ev);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, SSE_HEARTBEAT_MS);
    heartbeat.unref?.();
    sseClients.add(res);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      sseClients.delete(res);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  }

  // --- API routes -------------------------------------------------------------------------------------

  async function api(req: IncomingMessage, res: ServerResponse, seg: string[], q: Query, body: Json, record?: (status: number, value: unknown) => void): Promise<void> {
    const method = req.method ?? "GET";
    const [a, b, c, d] = seg;
    const ok = (value: unknown) => {
      record?.(200, value);
      reply(res, 200, value);
    };
    const is = (m: string, n: number) => method === m && seg.length === n;

    switch (a) {
      case "version":
        if (is("GET", 1)) return ok({ name: "nalara", version: KERNEL_VERSION, apiVersion: API_VERSION, supportedApiVersions: SUPPORTED_API_VERSIONS, features: API_FEATURES });
        break;

      case "status":
        if (is("GET", 1)) return ok(kernel.status());
        break;

      case "observatory":
        if (is("GET", 1)) return ok(kernel.observatory());
        break;

      case "queue":
        if (is("GET", 1)) return ok(kernel.workQueue());
        break;

      case "relay":
        if (is("GET", 1)) {
          const kinds = q.get("kind") ? q.get("kind")!.split(",").map((k) => k.trim()).filter(Boolean) : [];
          for (const k of kinds) if (!(RELAY_KINDS as string[]).includes(k)) throw new HttpError(400, `Unknown relay kind "${k}"`);
          const since = optInt(q, "since", 0);
          return ok(
            kernel.relay.list({
              ...(q.get("workspaceId") ? { workspaceId: q.get("workspaceId")! } : {}),
              ...(q.get("instanceId") ? { instanceId: q.get("instanceId")! } : {}),
              ...(kinds.length ? { kind: kinds as RelayKind[] } : {}),
              ...(since !== undefined ? { sinceSeq: since } : {}),
              limit: optInt(q, "limit", 1, 5000) ?? 500,
            }),
          );
        }
        break;

      case "fleet":
        if (is("GET", 2) && b === "records") {
          const files = q.getAll("file").filter(Boolean);
          return ok(
            kernel.fleet.records({
              ...(files.length ? { files } : {}),
              ...(q.get("workspaceId") ? { workspaceId: q.get("workspaceId")! } : {}),
              limit: optInt(q, "limit", 1, 1000) ?? 50,
            }),
          );
        }
        break;

      case "secrets":
        if (is("GET", 1)) return ok(kernel.secrets.list());
        if (is("PUT", 2)) {
          if (typeof body.value !== "string" || !body.value) throw new HttpError(400, "value must be a non-empty string", "invalid_secret");
          return ok(kernel.setSecret(b, body.value));
        }
        if (is("DELETE", 2)) {
          if (!kernel.secrets.has(b)) throw new HttpError(404, `No secret "${b}"`);
          return ok({ ok: kernel.deleteSecret(b) });
        }
        break;

      case "graph":
        if (is("GET", 1)) {
          const types = q.get("types") ? q.get("types")!.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
          for (const t of types ?? []) if (!(NODE_TYPES as readonly string[]).includes(t)) throw new HttpError(400, `Unknown node type "${t}"`);
          const slice: GraphSlice = kernel.graph.subgraph({
            ...(q.get("rootId") ? { rootId: q.get("rootId")! } : {}),
            ...(optInt(q, "depth", 0, 10) !== undefined ? { depth: optInt(q, "depth", 0, 10) } : {}),
            ...(types?.length ? { types: types as NodeType[] } : {}),
            ...(optInt(q, "limit", 1, 5000) !== undefined ? { limit: optInt(q, "limit", 1, 5000) } : {}),
          });
          return ok(slice);
        }
        break;

      case "nodes":
        if (is("GET", 2)) {
          const node = kernel.graph.getNode(b);
          if (!node) throw new HttpError(404, `No node "${b}"`);
          const detail: NodeDetail = { node, edges: kernel.graph.edges({ nodeId: b, direction: "both" }), neighbors: kernel.graph.neighbors(b, { direction: "both" }) };
          return ok(detail);
        }
        break;

      case "intents":
        if (is("POST", 1)) {
          const { workspace } = await kernel.submitIntent(text(body.text, "text"), { run: body.run !== false });
          return ok({ workspace });
        }
        if (is("POST", 2) && b === "classify") return ok(await kernel.intents.classify(text(body.text, "text")));
        break;

      case "workspaces": {
        if (is("GET", 1)) return ok(kernel.workspaces.list());
        if (seg.length < 2) break;
        const ws = kernel.workspaces.get(b);
        if (!ws) throw new HttpError(404, `No workspace "${b}"`);
        if (is("GET", 2)) {
          const detail: WorkspaceDetail = { workspace: ws, instances: kernel.orchestrator.instances({ workspaceId: b }) };
          return ok(detail);
        }
        if (is("GET", 3) && c === "tree") return ok(kernel.fleetTree(b));
        if (is("POST", 3) && c === "run") return ok({ workspace: kernel.startWorkspace(b).workspace });
        if (is("POST", 3) && c === "archive") return ok({ workspace: kernel.archiveWorkspace(b) });
        if (is("POST", 3) && c === "undo") return ok(await kernel.undoWorkspace(b));
        break;
      }

      case "agents":
        if (is("GET", 1)) return ok(kernel.orchestrator.catalog());
        if (is("GET", 2) && b === "instances") return ok(kernel.orchestrator.instances(q.get("workspaceId") ? { workspaceId: q.get("workspaceId")! } : {}));
        if (is("GET", 2) && b === "performance") return ok(kernel.memory.performance());
        if (is("POST", 4) && b === "instances" && d === "terminate") {
          if (!kernel.orchestrator.instance(c)) throw new HttpError(404, `No agent instance "${c}"`);
          return ok({ ok: kernel.orchestrator.terminate(c, "terminated by the user") });
        }
        if (is("POST", 3) && c === "run" && b !== "instances") {
          const files = body.files === undefined ? undefined : Array.isArray(body.files) && body.files.every((f) => typeof f === "string") ? (body.files as string[]) : null;
          if (files === null) throw new HttpError(400, "files must be an array of strings");
          const workspaceId = body.workspaceId === undefined ? undefined : text(body.workspaceId, "workspaceId");
          const { instance, done } = kernel.startAgent(b, text(body.task, "task"), { ...(files ? { files } : {}), ...(workspaceId ? { workspaceId } : {}) });
          done.catch(() => undefined);
          return ok({ instance });
        }
        break;

      case "radial":
        if (is("GET", 2)) {
          const menu = kernel.radialActions(b);
          const out: RadialMenu = { nodeId: b, kind: menu.kind, actions: menu.actions };
          return ok(out);
        }
        if (is("POST", 3)) {
          const input = body.input === undefined ? {} : isObj(body.input) ? body.input : null;
          if (input === null) throw new HttpError(400, "input must be an object");
          return ok(await kernel.radialAction(b, c, input));
        }
        break;

      case "search":
        if (is("GET", 1)) {
          const query = q.get("q") ?? "";
          if (!query.trim()) return ok([]);
          const kind = q.get("kind");
          if (kind && !["code", "doc", "test", "config", "data", "other"].includes(kind)) throw new HttpError(400, `Unknown kind "${kind}"`);
          return ok(kernel.index.search(query, { limit: optInt(q, "limit", 1, 200) ?? 20, ...(kind ? { kind: kind as never } : {}) }));
        }
        break;

      case "concepts":
        if (is("GET", 1)) return ok(kernel.index.concepts());
        break;

      case "files":
        if (is("GET", 2) && b === "content") {
          const path = text(q.get("path"), "path");
          // Through the gateway as the human: root-confined, audited, and able to read workspace outputs.
          const result = await kernel.tools.call("fs.read_file", { path }, { principal: kernel.human() });
          if (!result.ok) {
            const msg = result.error ?? result.content;
            throw new HttpError(/not found|not a file/i.test(msg) ? 404 : /rejected|escapes|outside|must not/i.test(msg) ? 403 : 400, msg);
          }
          const rel = String((result.data as { path?: unknown } | undefined)?.path ?? path);
          return ok({ path: rel, content: result.content, kind: kernel.index.kindOf(rel) ?? detectKind(rel) });
        }
        break;

      case "memory":
        if (is("GET", 1)) {
          const category = q.get("category");
          if (category && !(MEMORY_CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, `Unknown category "${category}"`);
          const includeProposed = q.get("includeProposed") === "true" || q.get("includeProposed") === "1";
          return ok(
            kernel.memory.recall({
              ...(category ? { category: category as MemoryCategory } : {}),
              ...(q.get("q") ? { text: q.get("q")! } : {}),
              limit: optInt(q, "limit", 1, 1000) ?? 100,
              includeProposed,
            }),
          );
        }
        if (is("POST", 1)) {
          const category = text(body.category, "category");
          if (!(MEMORY_CATEGORIES as readonly string[]).includes(category)) throw new HttpError(400, `Unknown category "${category}"`);
          const tags = body.tags === undefined ? [] : Array.isArray(body.tags) && body.tags.every((t) => typeof t === "string") ? (body.tags as string[]) : null;
          if (tags === null) throw new HttpError(400, "tags must be an array of strings");
          return ok(kernel.memory.remember({ category: category as MemoryCategory, key: text(body.key, "key"), content: text(body.content, "content"), tags, source: "user" }));
        }
        if (is("DELETE", 2)) return ok({ ok: kernel.memory.forget(b) });
        if (is("POST", 3) && c === "confirm") {
          if (!kernel.memory.get(b)) throw new HttpError(404, `No memory record "${b}"`);
          const record = kernel.confirmMemory(b);
          if (!record) throw new HttpError(409, `Memory record "${b}" could not be confirmed`);
          return ok(record);
        }
        break;

      case "tools":
        if (is("GET", 1)) {
          const action = q.get("action");
          if (action && !["read", "write", "search", "execute"].includes(action)) throw new HttpError(400, `Unknown action "${action}"`);
          return ok(kernel.tools.list({ ...(q.get("server") ? { server: q.get("server")! } : {}), ...(action ? { action: action as ToolAction } : {}) }));
        }
        if (is("POST", 3) && c === "call") {
          if (!kernel.tools.get(b)) throw new HttpError(404, `No tool "${b}"`);
          const input = body.input === undefined ? {} : isObj(body.input) ? body.input : null;
          if (input === null) throw new HttpError(400, "input must be an object");
          const key = req.headers["idempotency-key"];
          return ok(await kernel.tools.call(b, input, { principal: kernel.human(), ...(typeof key === "string" && key ? { idempotencyKey: key } : {}) }));
        }
        break;

      case "mcp":
        if (is("GET", 1)) return ok(kernel.mcp.status());
        if (is("POST", 1)) {
          const name = text(body.name, "name");
          if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new HttpError(400, "name may only use letters, digits, '_' and '-'");
          return ok(await kernel.connectMcp(name, validateMcpConfig(body.config)));
        }
        if (is("DELETE", 2)) return ok({ ok: await kernel.disconnectMcp(b) });
        if (is("POST", 4) && b === "tools" && d === "reapprove") {
          if (!kernel.tools.get(c)) throw new HttpError(404, `No tool "${c}"`);
          return ok({ ok: kernel.reapproveMcpTool(c) });
        }
        break;

      case "approvals":
        if (is("GET", 1)) {
          const status = q.get("status");
          if (status && !["pending", "approved", "denied", "expired"].includes(status)) throw new HttpError(400, `Unknown status "${status}"`);
          return ok(kernel.tools.approvals((status ?? undefined) as never));
        }
        if (is("POST", 2)) {
          if (typeof body.approved !== "boolean") throw new HttpError(400, "approved must be true or false");
          const existing = kernel.tools.approvals().find((x) => x.id === b);
          if (!existing) throw new HttpError(404, `No approval "${b}"`);
          if (existing.status !== "pending") throw new HttpError(409, `Approval ${b} is already ${existing.status}`);
          return ok(kernel.resolveApproval(b, body.approved));
        }
        break;

      case "policy":
        if (is("GET", 1)) return ok(kernel.tools.policy());
        if (is("PUT", 1)) return ok(kernel.setPolicy(validatePolicy(body)));
        break;

      case "triggers":
        if (is("GET", 1)) return ok(kernel.triggers.rules());
        if (is("PUT", 2)) {
          if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false");
          const rule = kernel.setTriggerEnabled(b, body.enabled);
          if (!rule) throw new HttpError(404, `No trigger "${b}"`);
          return ok(rule);
        }
        break;

      case "workflows":
        if (is("GET", 1)) return ok(kernel.workflows());
        if (is("POST", 3) && c === "run") {
          kernel.startWorkflow(b).catch(() => undefined);
          return ok({ started: true });
        }
        break;

      case "kernel":
        if (is("POST", 2) && b === "halt") {
          kernel.halt(typeof body.reason === "string" ? body.reason : "");
          return ok(kernel.status());
        }
        if (is("POST", 2) && b === "resume") {
          kernel.resume();
          return ok(kernel.status());
        }
        break;

      case "audit":
        if (is("GET", 1)) {
          const since = optInt(q, "since", 0);
          const entries = kernel.audit.list({ ...(since !== undefined ? { sinceSeq: since } : {}), limit: optInt(q, "limit", 1, 5000) ?? 200 });
          return ok({ entries, chainBrokenAt: kernel.audit.verify() });
        }
        break;

      case "journal":
        if (is("GET", 1)) return ok(kernel.journal.list({ ...(q.get("workspaceId") ? { workspaceId: q.get("workspaceId")! } : {}), includeUndone: true }));
        break;

      case "governor":
        if (is("GET", 1)) return ok(kernel.governor.snapshot());
        break;

      case "events":
        if (is("GET", 1)) {
          const since = optInt(q, "since", 0);
          return ok(
            kernel.bus.history({
              ...(since !== undefined ? { sinceSeq: since } : {}),
              limit: optInt(q, "limit", 1, 5000) ?? 500,
              ...(q.get("correlationId") ? { correlationId: q.get("correlationId")! } : {}),
            }),
          );
        }
        if (is("GET", 2) && b === "stream") return stream(req, res, q);
        break;
    }
    throw new HttpError(404, `No route ${method} /api/${seg.map(encodeURIComponent).join("/")}`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? "/";
    const qi = rawUrl.indexOf("?");
    const rawPath = qi >= 0 ? rawUrl.slice(0, qi) : rawUrl;
    const q = new URLSearchParams(qi >= 0 ? rawUrl.slice(qi + 1) : "");
    checkRequest(req);
    if (req.method === "OPTIONS") {
      res.writeHead(204, { Allow: "GET, POST, PUT, DELETE, OPTIONS" });
      res.end();
      return;
    }
    if (rawPath === "/api" || rawPath.startsWith("/api/")) {
      // Split the raw path first: node ids contain "/" and ":" and arrive URL-encoded inside one segment.
      let seg: string[];
      try {
        seg = rawPath.split("/").slice(2).filter((s, i, all) => s !== "" || i < all.length - 1).map((s) => decodeURIComponent(s));
      } catch {
        throw new HttpError(400, "Malformed URL encoding");
      }
      if (!seg.length) throw new HttpError(404, "No route");
      checkApiVersion(req);
      const method = req.method ?? "GET";
      const mutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
      const body = method === "POST" || method === "PUT" || method === "PATCH" ? await readJson(req) : {};
      const rawKey = req.headers["idempotency-key"];
      const key = typeof rawKey === "string" ? rawKey.trim() : "";
      if (!mutating || !key) return api(req, res, seg, q, body);
      if (key.length > 200) throw new HttpError(400, "Idempotency-Key must be at most 200 characters");
      // Idempotency: the same key on the same route replays the first response (2xx and 4xx; 5xx may be retried).
      pruneIdempotent();
      const cacheKey = `${method} ${rawPath}\u0000${key}`;
      const hash = createHash("sha256").update(canonicalJson(body)).digest("hex");
      const hit = idempotent.get(cacheKey);
      if (hit) {
        if (hit.hash !== hash) throw new HttpError(422, `Idempotency-Key "${key}" was already used with a different request body`, "idempotency_conflict");
        const first = await hit.result;
        if (first) return reply(res, first.status, first.body, { "Idempotent-Replayed": "true" });
      }
      let settle!: (v: { status: number; body: unknown } | undefined) => void;
      const entry: IdempotentEntry = { hash, expires: now() + IDEMPOTENCY_TTL_MS, result: new Promise((r) => (settle = r)) };
      idempotent.set(cacheKey, entry);
      let recorded: { status: number; body: unknown } | undefined;
      try {
        await api(req, res, seg, q, body, (status, value) => (recorded = { status, body: value }));
        settle(recorded);
      } catch (err) {
        const status = statusOf(err);
        if (status < 500) settle({ status, body: { error: err instanceof Error ? err.message : String(err), code: codeFor(err, status) } });
        else {
          idempotent.delete(cacheKey);
          settle(undefined);
        }
        throw err;
      }
      return;
    }
    return serveStatic(req, res, rawPath);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const status = statusOf(err);
      if (status >= 500) {
        try {
          kernel.bus.publish("kernel.log", { level: "error", message: `HTTP ${req.method} ${req.url}: ${err instanceof Error ? err.message : String(err)}` }, { source: "http" });
        } catch {
          // bus closed
        }
      }
      reply(res, status, { error: err instanceof Error ? err.message : String(err), code: codeFor(err, status) });
    });
  });

  return {
    server,
    listen(port = kernel.config.port, host = kernel.config.host) {
      boundHost = host;
      return new Promise((resolvePromise, reject) => {
        const onError = (err: Error) => reject(err);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          const actual = boundPort() ?? port;
          const h = host.includes(":") ? `[${host}]` : host;
          resolvePromise({ url: `http://${h}:${actual}`, port: actual, host });
        });
      });
    },
    close() {
      for (const res of sseClients) res.end();
      sseClients.clear();
      return new Promise((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections?.();
      });
    },
    url() {
      const p = boundPort();
      if (p === undefined) return undefined;
      return `http://${boundHost.includes(":") ? `[${boundHost}]` : boundHost}:${p}`;
    },
  };
}
