/**
 * The Neural Core's state model: one mood for the whole screen, derived from live kernel data.
 * Pure functions, so the rules are easy to read in one place.
 */
import type { AgentInstance, AgentState, GovernorSnapshot, KernelStatus } from "../types";

export type Mood = "idle" | "thinking" | "active" | "approval" | "settled" | "halted" | "offline";

export const RUNNING_STATES: AgentState[] = ["summoned", "active", "collaborating"];
export const FINISHED_STATES: AgentState[] = ["completed", "failed", "terminated", "archived"];

export interface MoodInput {
  unreachable: boolean;
  halted: boolean;
  pendingApprovals: number;
  submitting: boolean;
  runningAgents: number;
  /** Status of the workspace the core is focused on, if any. */
  focusStatus: string | null;
  sheetOpen: boolean;
}

export function deriveMood(i: MoodInput): Mood {
  if (i.unreachable) return "offline";
  if (i.halted) return "halted";
  if (i.pendingApprovals > 0) return "approval";
  if (i.submitting) return "thinking";
  if (i.runningAgents > 0) return "active";
  if (i.focusStatus === "ready" || i.focusStatus === "running") return "thinking";
  if (i.sheetOpen) return "settled";
  return "idle";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The letter-spaced line under "Neural Core". */
export function coreStatusLine(mood: Mood, i: MoodInput): string {
  switch (mood) {
    case "offline":
      return "CORE OFFLINE · RECONNECTING";
    case "halted":
      return "HALTED · ALL AGENTS STOPPED";
    case "approval":
      return i.pendingApprovals > 1 ? `HOLDING · ${i.pendingApprovals} APPROVALS NEEDED` : "HOLDING · APPROVAL NEEDED";
    case "thinking":
      return i.submitting ? "THINKING · CLASSIFYING INTENT" : "THINKING · SUMMONING AGENTS";
    case "active":
      return `ACTIVE · ${plural(i.runningAgents, "AGENT", "AGENTS")} WORKING`;
    case "settled":
      return i.focusStatus === "failed" ? "SETTLED · WORKSPACE FAILED" : "SETTLED · WORKSPACE COMPLETE";
    default:
      return "BREATHING · AWAITING INTENT";
  }
}

/** One word for the core in the top-left line. */
export function coreWord(mood: Mood): string {
  switch (mood) {
    case "offline":
      return "OFFLINE";
    case "halted":
      return "HALTED";
    case "approval":
      return "HOLDING";
    case "thinking":
      return "THINKING";
    case "active":
      return "ACTIVE";
    default:
      return "IDLE";
  }
}

export type FieldState = "STABLE" | "BUSY" | "STRAINED" | "HALTED" | "OFFLINE";

/**
 * The field is the kernel's load, read from the governor: HALTED (kill switch), STRAINED (circuit breaker open or
 * half open, or AIMD has cut the concurrency lanes below their maximum), BUSY (agents running or queued), else STABLE.
 */
export function fieldState(status: KernelStatus | null, unreachable: boolean, runningAgents: number): FieldState {
  if (unreachable || !status) return "OFFLINE";
  if (status.halted) return "HALTED";
  const g: GovernorSnapshot = status.governor;
  if (g && (g.circuit !== "closed" || g.lanes < g.maxLanes)) return "STRAINED";
  if (runningAgents > 0 || (g && (g.running > 0 || g.queued > 0))) return "BUSY";
  return "STABLE";
}

/** "N AGENTS RESTING": system agents (catalog group "system") with no running instance. */
export function restingSystemAgents(systemAgentIds: string[], instances: Pick<AgentInstance, "agentId" | "state">[]): number {
  const busy = new Set(instances.filter((i) => RUNNING_STATES.includes(i.state)).map((i) => i.agentId));
  return systemAgentIds.filter((id) => !busy.has(id)).length;
}

export function agentsWord(n: number): string {
  return plural(n, "AGENT", "AGENTS");
}
