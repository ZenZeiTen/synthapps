/** Type-only bridge to the kernel contracts. Nothing here reaches the bundle. */
export type {
  AgentDefinition,
  AgentInstance,
  AgentOutput,
  AgentPerformance,
  AgentState,
  ApprovalRequest,
  AuditEntry,
  Challenge,
  ConceptInfo,
  EvidenceStatus,
  FleetBudget,
  FleetNode,
  FleetRecord,
  FleetRole,
  FleetTree,
  Observatory,
  SecretInfo,
  WorkQueue,
  RelayKind,
  RelayMessage,
  StepReview,
  Verdict,
  EdgeKind,
  EventType,
  FileKind,
  Finding,
  GraphEdge,
  GraphNode,
  Governor,
  IntentClassification,
  JournalEntry,
  KernelEvent,
  KernelStatus,
  McpServerConfig,
  McpServerStatus,
  MemoryCategory,
  MemoryRecord,
  NodeType,
  PlanStep,
  RadialAction,
  RadialKind,
  RadialResult,
  Reversibility,
  SearchHit,
  ToolAction,
  ToolDefinition,
  ToolPolicy,
  ToolResult,
  TriggerRule,
  WorkflowDefinition,
  Workspace,
  WorkspaceStatus,
} from "../../src/kernel/types";
export type { GraphSlice, NodeDetail, RadialMenu, WorkspaceDetail } from "../../src/server/api-contract";

import type { Governor } from "../../src/kernel/types";
export type GovernorSnapshot = ReturnType<Governor["snapshot"]>;

/** POST /api/intents/classify: the classification, its label, and whether an offline kernel would refuse it. */
export type IntentPreview = import("../../src/kernel/types").IntentClassification & { label: string; needsClaude: boolean };

/** GET /api/claude. */
export interface ClaudeState {
  mode: "claude" | "offline";
  model: string;
  credentials: "environment" | "settings" | "none";
  canRestart: boolean;
}

export type { AssistantEvent, AssistantMessage, AssistantToolUse, Conversation } from "../../src/assistant/types";
export type { FileEntry, FileListing, Place, TextFile, TrashItem } from "../../src/files/types";
export type { InstalledApp, TerminalEvent } from "../../src/shell/types";
