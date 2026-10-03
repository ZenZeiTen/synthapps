import { matchGlob } from "../kernel/glob";
import type { EventBus, KernelEvent, TriggerAction, TriggerEngine, TriggerExecutor, TriggerRule, Unsubscribe } from "../kernel/types";

const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,cs,rb,php}";
const DEFAULT_FILE_DEBOUNCE_MS = 1500;
const SUMMARY_MAX = 500;

/** File Changed -> Review -> QA -> Documentation (DESIGN.md 10). */
export const DEFAULT_TRIGGER_RULES: TriggerRule[] = [
  {
    id: "review-on-change",
    name: "Review code on change",
    on: "file.updated",
    when: { pathGlob: CODE_GLOB },
    then: { kind: "run_agent", agentId: "code_reviewer", task: "Review the change to {{path}}" },
    enabled: true,
  },
  {
    id: "review-on-create",
    name: "Review new code files",
    on: "file.created",
    when: { pathGlob: CODE_GLOB },
    then: { kind: "run_agent", agentId: "code_reviewer", task: "Review the change to {{path}}" },
    enabled: true,
  },
  {
    id: "qa-after-review",
    name: "QA after a triggered review",
    on: "agent.finished",
    when: { agentId: "code_reviewer", triggeredBy: "rule:" },
    then: { kind: "run_agent", agentId: "qa_engineer", task: "Check test coverage for {{path}} after review: {{summary}}" },
    enabled: true,
  },
  {
    id: "docs-after-qa",
    name: "Update documentation after triggered QA",
    on: "agent.finished",
    when: { agentId: "qa_engineer", triggeredBy: "rule:" },
    then: { kind: "run_agent", agentId: "documentation", task: "Update documentation for {{path}}" },
    enabled: true,
  },
];

/** Paths the platform itself writes (outputs, database) or that are vendored never trigger rules. */
function ignoredPath(path: string): boolean {
  const p = path.split("\\").join("/").replace(/^\.\//, "");
  return p === ".nalara" || p.startsWith(".nalara/") || /(^|\/)node_modules(\/|$)/.test(p);
}

/** Event data is untrusted (agent summaries may contain injected text): one line, no backticks, bounded. */
function clean(value: unknown, max = SUMMARY_MAX): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\r\n`]+/g, " ").trim().slice(0, max);
}

function fill(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(path|agentId|summary)\s*\}\}/g, (_, name: string) => clean(data[name]));
}

/**
 * Runs rule actions for matching events.
 *
 * Chain depth: an event's depth is `data.triggerDepth` (default 0). A rule does not fire when depth >= maxDepth.
 * When it fires, the executor receives a copy of the event whose data carries `triggerDepth: depth + 1` and
 * `triggeredBy: "rule:<id>"`. The executor must pass both (and `path`) on to the run it starts, so the run's
 * agent.finished / agent.failed event data contains `{ agentId, path, summary, triggeredBy, triggerDepth }`.
 * That is how the next hop is matched (`when.triggeredBy`) and bounded (maxDepth).
 *
 * `emit` actions are published by the engine itself; `run_agent` and `intent` go to the executor.
 */
export function createTriggerEngine(opts: {
  bus: EventBus;
  executor: TriggerExecutor;
  rules?: TriggerRule[];
  maxDepth?: number;
  /** Default debounce for file.* events when a rule sets none. */
  fileDebounceMs?: number;
}): TriggerEngine {
  const { bus, executor } = opts;
  const maxDepth = opts.maxDepth ?? 3;
  const fileDebounceMs = opts.fileDebounceMs ?? DEFAULT_FILE_DEBOUNCE_MS;
  const rules = new Map<string, TriggerRule>();
  for (const r of opts.rules ?? DEFAULT_TRIGGER_RULES) rules.set(r.id, structuredClone(r));
  const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; ruleId: string }>();
  let unsubscribe: Unsubscribe | undefined;

  function log(level: "info" | "warn" | "error", message: string, extra: Record<string, unknown> = {}) {
    bus.publish("kernel.log", { level, message, ...extra }, { source: "triggers" });
  }

  function matches(rule: TriggerRule, event: KernelEvent, data: Record<string, unknown>): boolean {
    if (!rule.enabled || rule.on !== event.type) return false;
    const path = typeof data.path === "string" ? data.path : undefined;
    if (path !== undefined && ignoredPath(path)) return false;
    const when = rule.when ?? {};
    if (when.pathGlob && (path === undefined || !matchGlob(path, when.pathGlob))) return false;
    if (when.agentId && data.agentId !== when.agentId) return false;
    if (when.triggeredBy && !(typeof data.triggeredBy === "string" && data.triggeredBy.startsWith(when.triggeredBy))) return false;
    return true;
  }

  async function fire(rule: TriggerRule, event: KernelEvent) {
    if (!unsubscribe || !rules.get(rule.id)?.enabled) return; // stopped or disabled while debouncing
    const data = (event.data ?? {}) as Record<string, unknown>;
    const depth = typeof data.triggerDepth === "number" ? data.triggerDepth : 0;
    const nextData = { ...data, triggerDepth: depth + 1, triggeredBy: `rule:${rule.id}` };
    const action = fillAction(rule.then, data);
    const path = typeof data.path === "string" ? data.path : undefined;
    bus.publish("trigger.fired", { ruleId: rule.id, action, path, depth: depth + 1 }, { source: `trigger:${rule.id}`, correlationId: event.correlationId });
    try {
      if (action.kind === "emit") {
        bus.publish(action.type, { ...action.data, path, triggerDepth: depth + 1, triggeredBy: `rule:${rule.id}` }, { source: `trigger:${rule.id}`, correlationId: event.correlationId });
      } else {
        await executor(action, { ...event, data: nextData }, rule);
      }
    } catch (err) {
      log("error", `trigger ${rule.id} failed: ${err instanceof Error ? err.message : String(err)}`, { ruleId: rule.id });
    }
  }

  function onEvent(event: KernelEvent) {
    const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
    for (const rule of rules.values()) {
      if (!matches(rule, event, data)) continue;
      const depth = typeof data.triggerDepth === "number" ? data.triggerDepth : 0;
      if (depth >= maxDepth) {
        log("warn", `trigger ${rule.id} not fired: chain depth ${depth} reached the limit ${maxDepth}`, { ruleId: rule.id, depth });
        continue;
      }
      const debounce = rule.debounceMs ?? (event.type.startsWith("file.") ? fileDebounceMs : 0);
      if (debounce <= 0) {
        void fire(rule, event);
        continue;
      }
      // Trailing debounce: a burst on the same (rule, path) fires once, with the last event.
      const key = `${rule.id}\u0000${String(data.path ?? "")}`;
      const prev = timers.get(key);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        timers.delete(key);
        void fire(rule, event);
      }, debounce);
      timers.set(key, { timer, ruleId: rule.id });
    }
  }

  function cancelTimers(ruleId?: string) {
    for (const [key, t] of timers) {
      if (ruleId === undefined || t.ruleId === ruleId) {
        clearTimeout(t.timer);
        timers.delete(key);
      }
    }
  }

  return {
    rules: () => [...rules.values()].map((r) => structuredClone(r)),
    upsert(rule) {
      if (!rule.id) throw new Error("trigger rule needs an id");
      rules.set(rule.id, structuredClone(rule));
      return structuredClone(rule);
    },
    setEnabled(id, enabled) {
      const rule = rules.get(id);
      if (!rule) return undefined;
      rule.enabled = enabled;
      if (!enabled) cancelTimers(id);
      return structuredClone(rule);
    },
    remove(id) {
      cancelTimers(id);
      return rules.delete(id);
    },
    start() {
      unsubscribe ??= bus.subscribe("*", onEvent);
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
      cancelTimers();
    },
  };
}

function fillAction(action: TriggerAction, data: Record<string, unknown>): TriggerAction {
  switch (action.kind) {
    case "run_agent":
      return { ...action, task: fill(action.task, data) };
    case "intent":
      return { ...action, text: fill(action.text, data) };
    case "emit":
      return { ...action, data: action.data ? structuredClone(action.data) : undefined };
  }
}
