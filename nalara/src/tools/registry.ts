/**
 * Tool registry: the platform's single enforcement point for tool use (DESIGN.md 8, SAFETY.md 2 and 4).
 *
 * Every tool call from every agent, trigger chain and the human passes through call(), which runs the
 * gates in a fixed order and never throws for tool failures.
 */
import { createHash } from "node:crypto";
import AjvModule from "ajv";
import type { ValidateFunction } from "ajv";
import { matchAny } from "../kernel/glob";
import { newId } from "../kernel/ids";
import type {
  ApprovalRequest,
  AuditEntry,
  AuditLog,
  EventBus,
  EventType,
  Governor,
  Principal,
  ToolContext,
  ToolDefinition,
  ToolHandler,
  ToolPolicy,
  ToolRegistry,
  ToolResult,
} from "../kernel/types";

// ajv is CommonJS; depending on the loader the class is the default export or its `.default`.
const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule) as typeof AjvModule;

export const DEFAULT_TOOL_POLICY: ToolPolicy = { mode: "ask", allow: [], deny: [], approvalTimeoutMs: 600_000 };
export const MAX_TOOL_CONTENT_CHARS = 20_000;
const DEFAULT_MAX_DELEGATION_DEPTH = 3;
const TOOL_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const INPUT_PREVIEW_CHARS = 200;

export interface ToolRegistryOptions {
  bus: EventBus;
  audit: AuditLog;
  governor?: Governor;
  policy?: ToolPolicy;
  maxDelegationDepth?: number;
  now?: () => Date;
}

/** JSON with sorted object keys, so equal values always serialize the same way (hashes, loop-detection keys). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * Identity of a tool definition for drift detection. It covers the classification (action, reversibility, scope),
 * so an MCP server that flips readOnlyHint on an unchanged tool is caught and the tool disabled until re-approved.
 */
export function toolHash(def: Pick<ToolDefinition, "name" | "description" | "inputSchema" | "action" | "reversibility" | "scope">): string {
  const classification = `${def.action}|${def.reversibility}|${def.scope}`;
  return createHash("sha256").update(def.name + def.description + stableStringify(def.inputSchema) + classification).digest("hex");
}

/** Read and search tools with no lasting effect: the only calls allowed while halted or in readonly mode. */
export function isPureRead(def: Pick<ToolDefinition, "action" | "reversibility">): boolean {
  return (def.action === "read" || def.action === "search") && def.reversibility === "reversible";
}

export function truncateContent(content: string, max = MAX_TOOL_CONTENT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n[truncated: ${content.length - max} more characters]`;
}

interface Entry {
  def: ToolDefinition;
  handler: ToolHandler;
  validate: ValidateFunction;
  preview?: (input: Record<string, unknown>) => string;
}

interface PendingApproval {
  request: ApprovalRequest;
  settle: (approved: boolean, via: string) => void;
}

type Outcome = AuditEntry["outcome"];

export function createToolRegistry(opts: ToolRegistryOptions): ToolRegistry {
  const { bus, audit, governor } = opts;
  const maxDepth = opts.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  const ajv = new Ajv({ strict: false, allErrors: true });

  const tools = new Map<string, Entry>();
  const scopes = new Map<string, string[]>();
  const approvals = new Map<string, ApprovalRequest>();
  const pending = new Map<string, PendingApproval>();
  // Replay fence: "<tool>\0<idempotencyKey>" -> the first run's result (a promise while it is still running).
  const executed = new Map<string, Promise<ToolResult>>();
  let policy: ToolPolicy = { ...DEFAULT_TOOL_POLICY, ...(opts.policy ?? {}) };
  let halted = false;
  const inflight = new Set<{ def: ToolDefinition; controller: AbortController }>();

  function publish(type: EventType, data: Record<string, unknown>, principal: Principal | null): void {
    try {
      bus.publish(type, data, { source: "tools", correlationId: principal?.workspaceId });
    } catch {
      // The bus must never break a tool call.
    }
  }

  function record(principal: Principal | null, subject: string, outcome: Outcome, detail: Record<string, unknown>, kind: AuditEntry["kind"] = "tool_call"): void {
    try {
      audit.append({ kind, principal, subject, outcome, detail });
    } catch {
      // An audit failure is reported by the audit module itself; the call result stays well-defined.
    }
  }

  function inputSummary(def: ToolDefinition | undefined, input: Record<string, unknown>): Record<string, unknown> {
    const json = safeJson(input);
    const preview = json.length > INPUT_PREVIEW_CHARS ? `${json.slice(0, INPUT_PREVIEW_CHARS)}…` : json;
    if (def && isPureRead(def) && json.length <= 2000) return { input };
    return { inputKeys: Object.keys(input ?? {}), inputPreview: preview };
  }

  function copy(def: ToolDefinition): ToolDefinition {
    return { ...def };
  }

  function waitForApproval(entry: Entry, input: Record<string, unknown>, principal: Principal, signal?: AbortSignal): Promise<ApprovalRequest> {
    const def = entry.def;
    let detail: string | undefined;
    try {
      detail = entry.preview?.(input);
    } catch (err) {
      detail = `(could not describe the call: ${err instanceof Error ? err.message : String(err)})`;
    }
    const request: ApprovalRequest = {
      id: newId("appr"),
      tool: def.name,
      action: def.action,
      reversibility: def.reversibility,
      scope: def.scope,
      input,
      principal,
      ...(detail ? { detail: detail.slice(0, 4000) } : {}),
      status: "pending",
      createdAt: nowIso(),
    };
    approvals.set(request.id, request);

    return new Promise<ApprovalRequest>((resolve) => {
      const timeoutMs = policy.approvalTimeoutMs ?? DEFAULT_TOOL_POLICY.approvalTimeoutMs!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => finish("denied", "aborted");

      function finish(status: ApprovalRequest["status"], via: string): void {
        if (request.status !== "pending") return;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        pending.delete(request.id);
        request.status = status;
        request.resolvedAt = nowIso();
        record(principal, def.name, status === "approved" ? "allowed" : "denied", { approvalId: request.id, status, via }, "approval");
        publish("tool.approval_resolved", { approval: { ...request }, via }, principal);
        resolve(request);
      }

      pending.set(request.id, { request, settle: (approved, via) => finish(approved ? "approved" : "denied", via) });
      publish("tool.approval_requested", { approval: { ...request, input: inputSummary(def, input) } }, principal);

      if (signal?.aborted) return finish("denied", "aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => finish("expired", "timeout"), timeoutMs);
    });
  }

  async function call(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const entry = tools.get(name);
    const def = entry?.def;
    const principal: Principal | null = ctx?.principal ?? null;
    const args: Record<string, unknown> = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const base = { name, chain: principal?.chain ?? [], instanceId: principal?.instanceId, action: def?.action, reversibility: def?.reversibility };

    publish("tool.called", { ...base, ...inputSummary(def, args) }, principal);

    const finish = (result: ToolResult, outcome: Outcome, detail: Record<string, unknown> = {}): ToolResult => {
      const durationMs = Date.now() - started;
      record(principal, name, outcome, { ...detail, durationMs, ...(outcome === "denied" ? {} : { idempotencyKey: ctx?.idempotencyKey }) });
      publish("tool.result", { ...base, ok: result.ok, outcome, durationMs, error: result.error, ...(outcome === "denied" ? { reason: result.error } : {}) }, principal);
      return result;
    };
    const deny = (reason: string, detail: Record<string, unknown> = {}): ToolResult =>
      finish({ ok: false, content: `Denied: ${reason}`, error: reason }, "denied", { reason, ...detail });

    // (a) kill switch
    if (halted && !(def && isPureRead(def))) return deny("kernel is halted: only read tools may run");
    // (b) unknown or disabled
    if (!entry || !def) return deny(`unknown tool "${name}"`);
    if (def.disabled) return deny(`tool "${name}" is disabled${def.disabledReason ? `: ${def.disabledReason}` : ""}`);
    // (c) identity and delegation depth
    if (!principal) return deny("no principal: every tool call must say who is acting");
    if (principal.depth > maxDepth) return deny(`delegation depth ${principal.depth} exceeds the limit of ${maxDepth}`);
    // (d) per-instance scope; the human (no instanceId) has no scope
    if (principal.instanceId) {
      const scope = scopes.get(principal.instanceId);
      if (!scope) return deny(`instance ${principal.instanceId} has no tool scope`);
      if (!matchAny(name, scope, { dots: true })) return deny(`tool "${name}" is outside the scope of instance ${principal.instanceId}`);
    }
    // (e) deny rules win, then allow rules pre-approve
    if (matchAny(name, policy.deny, { dots: true })) return deny(`tool "${name}" matches a deny rule`);
    let via: "policy" | "allow" | "approval" = "policy";
    if (matchAny(name, policy.allow, { dots: true })) {
      via = "allow";
      record(principal, name, "allowed", { via: "allow", reversibility: def.reversibility });
    }
    // (f) mode x reversibility
    let needsApproval = false;
    if (via !== "allow") {
      if (policy.mode === "readonly") {
        if (!isPureRead(def)) return deny(`readonly mode: "${name}" is ${def.action}/${def.reversibility}`);
      } else if (policy.mode === "ask") {
        needsApproval = def.reversibility !== "reversible";
      } else {
        needsApproval = def.reversibility === "irreversible";
      }
    }
    // (g) human approval
    if (needsApproval) {
      const request = await waitForApproval(entry, args, principal, ctx.signal);
      if (request.status !== "approved") return deny(`approval ${request.status}`, { approvalId: request.id });
      via = "approval";
      record(principal, name, "allowed", { via: "approval", approvalId: request.id });
    }
    // (h) input schema
    if (!entry.validate(args)) {
      const errors = ajv.errorsText(entry.validate.errors, { dataVar: "input" });
      return finish({ ok: false, content: `Invalid input for ${name}: ${errors}`, error: `invalid input: ${errors}` }, "denied", {
        reason: "invalid input",
        errors: entry.validate.errors,
      });
    }
    // (i) replay fence for irreversible calls
    const fenceKey = def.reversibility === "irreversible" && ctx.idempotencyKey ? `${name}\u0000${ctx.idempotencyKey}` : undefined;
    if (fenceKey) {
      const first = executed.get(fenceKey) ?? fromAudit(name, ctx.idempotencyKey!);
      if (first) {
        const firstResult = await first;
        return finish(
          { ok: false, content: `Refused: already executed with idempotency key "${ctx.idempotencyKey}". First result:\n${firstResult.content}`, data: { firstResult }, error: "already executed" },
          "denied",
          { reason: "already executed", idempotencyKey: ctx.idempotencyKey },
        );
      }
    }
    // (j) budget
    if (principal.instanceId && governor) {
      const charged = governor.charge(principal.instanceId, { toolCalls: 1, toolKey: `${name}:${stableStringify(args)}` });
      if (charged.exceeded) return deny(`budget exceeded: ${charged.reason}`);
    }
    // Halt may have happened while waiting for approval.
    if (halted && !isPureRead(def)) return deny("kernel is halted: only read tools may run");

    // (k) run
    const run = runHandler(entry, args, ctx);
    if (fenceKey) executed.set(fenceKey, run);
    const result = await run;
    return finish(result, result.ok ? "ok" : "error", {
      via,
      error: result.error,
      resultPreview: result.content.slice(0, 500),
    });
  }

  async function runHandler(entry: Entry, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    // Every call gets its own abort signal, linked to the caller's, so the kill switch can stop a call already running
    // no matter who started it (an agent, the UI, the API or a radial action).
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(ctx.signal?.reason);
    if (ctx.signal?.aborted) controller.abort(ctx.signal.reason);
    else ctx.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const flight = { def: entry.def, controller };
    inflight.add(flight);
    try {
      const raw = await entry.handler(args, { ...ctx, signal: controller.signal });
      if (!raw || typeof raw !== "object") return { ok: false, content: `Tool ${entry.def.name} returned no result`, error: "no result" };
      const content = typeof raw.content === "string" ? raw.content : safeJson(raw.content);
      return { ...raw, ok: raw.ok === true, content: truncateContent(content) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, content: `Tool ${entry.def.name} failed: ${message}`, error: message };
    } finally {
      inflight.delete(flight);
      ctx.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** A fence entry that survived a restart: the audit ledger remembers irreversible calls that ran. */
  function fromAudit(name: string, key: string): Promise<ToolResult> | undefined {
    let entries: AuditEntry[] = [];
    try {
      entries = audit.list({ subject: name });
    } catch {
      return undefined;
    }
    const hit = entries.find((e) => e.kind === "tool_call" && (e.outcome === "ok" || e.outcome === "error") && e.detail?.idempotencyKey === key);
    if (!hit) return undefined;
    const preview = typeof hit.detail.resultPreview === "string" ? hit.detail.resultPreview : "(result not recorded)";
    return Promise.resolve({ ok: hit.outcome === "ok", content: preview, error: typeof hit.detail.error === "string" ? hit.detail.error : undefined });
  }

  return {
    register(def, handler, registerOpts) {
      if (!def || typeof def.name !== "string" || !TOOL_NAME_RE.test(def.name)) throw new Error(`Invalid tool name "${def?.name}": only [a-zA-Z0-9_.-] allowed`);
      if (tools.has(def.name)) throw new Error(`Tool "${def.name}" is already registered`);
      if (!def.inputSchema || def.inputSchema.type !== "object") throw new Error(`Tool "${def.name}": inputSchema must have type "object"`);
      let validate: ValidateFunction;
      try {
        validate = ajv.compile(def.inputSchema);
      } catch (err) {
        throw new Error(`Tool "${def.name}": invalid inputSchema: ${err instanceof Error ? err.message : String(err)}`);
      }
      tools.set(def.name, { def: { ...def, hash: toolHash(def) }, handler, validate, ...(registerOpts?.preview ? { preview: registerOpts.preview } : {}) });
    },
    unregister(name) {
      return tools.delete(name);
    },
    get(name) {
      const entry = tools.get(name);
      return entry ? copy(entry.def) : undefined;
    },
    list(filter) {
      return [...tools.values()]
        .map((e) => e.def)
        .filter((d) => !filter?.server || d.server === filter.server)
        .filter((d) => !filter?.action || d.action === filter.action)
        .filter((d) => !filter?.names || matchAny(d.name, filter.names, { dots: true }))
        .map(copy);
    },
    call,
    setScope(instanceId, toolGlobs) {
      scopes.set(instanceId, [...toolGlobs]);
    },
    clearScope(instanceId) {
      scopes.delete(instanceId);
    },
    setHalted(value) {
      halted = value;
      if (!value) return;
      for (const p of [...pending.values()]) p.settle(false, "halt");
      // Stop calls already past approval: process tools kill their process group, MCP calls cancel the request.
      for (const f of [...inflight]) if (!isPureRead(f.def)) f.controller.abort(new Error("kernel halted"));
    },
    setDisabled(name, disabled, reason) {
      const entry = tools.get(name);
      if (!entry) return;
      entry.def = { ...entry.def, disabled, disabledReason: disabled ? reason : undefined };
    },
    policy() {
      return { ...policy, allow: [...(policy.allow ?? [])], deny: [...(policy.deny ?? [])] };
    },
    setPolicy(next) {
      const before = policy;
      policy = { ...DEFAULT_TOOL_POLICY, ...next };
      record(null, "tool_policy", "info", { before, after: policy }, "policy");
    },
    approvals(status) {
      return [...approvals.values()].filter((a) => !status || a.status === status).map((a) => ({ ...a }));
    },
    resolveApproval(id, approved) {
      const p = pending.get(id);
      if (p) p.settle(approved, "human");
      const request = approvals.get(id);
      return request ? { ...request } : undefined;
    },
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
