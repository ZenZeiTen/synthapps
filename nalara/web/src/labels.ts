import type { AgentState, EventType, KernelEvent, MemoryCategory } from "./types";

/**
 * Mirrors EVENT_LABELS in src/kernel/types.ts. The UI imports kernel modules type-only, so the map is
 * repeated here; `satisfies` keeps the keys in step with the EventType union.
 */
export const EVENT_LABELS = {
  "node.created": "Node Created",
  "file.updated": "File Updated",
  "file.created": "File Created",
  "file.deleted": "File Deleted",
  "agent.finished": "Agent Finished",
  "mcp.connected": "MCP Connected",
  "workspace.generated": "Workspace Generated",
  "deployment.succeeded": "Deployment Succeeded",
  "intent.classified": "Intent Classified",
  "agent.summoned": "Agent Summoned",
  "trigger.fired": "Agent Triggered",
  "workspace.completed": "Workspace Completed",
  "tool.approval_requested": "Approval Requested",
  "memory.updated": "Memory Updated",
} satisfies Partial<Record<EventType, string>>;

/** "agent.state" -> "Agent State" for types without a spec label. */
export function eventLabel(type: string): string {
  const known = (EVENT_LABELS as Record<string, string>)[type];
  if (known) return known;
  return type
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** One short line describing an event's payload. */
export function eventDetail(ev: KernelEvent): string {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  const nested = (k: string) => (d[k] && typeof d[k] === "object" ? (d[k] as Record<string, unknown>) : undefined);
  const node = nested("node");
  const ws = nested("workspace");
  const inst = nested("instance");
  const parts: (string | undefined)[] = [];
  parts.push(
    str(d.label) ??
      str(ws?.label) ??
      str(d.name) ??
      str(node?.name) ??
      str(inst?.name) ??
      str(d.agentId) ??
      str(d.tool) ??
      str(d.path) ??
      str(d.intent) ??
      str(d.key) ??
      str(d.message) ??
      str(d.text),
  );
  const state = str(d.state) ?? str(inst?.state);
  if (state) parts.push(state);
  if (!parts[0] && ev.correlationId) parts.push(ev.correlationId);
  return parts.filter(Boolean).join(" · ");
}

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  dormant: "dormant",
  summoned: "summoned",
  active: "active",
  collaborating: "collaborating",
  completed: "completed",
  failed: "failed",
  terminated: "terminated",
  archived: "archived",
};

export const MEMORY_CATEGORY_LABEL: Record<MemoryCategory, string> = {
  preference: "Preferences",
  project_history: "Project history",
  architecture_decision: "Architecture decisions",
  coding_standard: "Coding standards",
  translation_guide: "Translation guides",
  file_relationship: "File relationships",
  agent_performance: "Agent performance",
};

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "preference",
  "project_history",
  "architecture_decision",
  "coding_standard",
  "translation_guide",
  "file_relationship",
  "agent_performance",
];

export const LIFECYCLE: AgentState[] = ["dormant", "summoned", "active", "collaborating", "completed", "archived"];
