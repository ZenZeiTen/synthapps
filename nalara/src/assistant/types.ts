/** Assistant contracts, shared with the web UI (type-only: no runtime imports here). */

export interface AssistantToolUse {
  tool: string;
  ok?: boolean;
  /** Short description of the input, e.g. the path or query. */
  detail?: string;
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  ts: string;
  tools?: AssistantToolUse[];
  /** The answer came from the offline fallback, not Claude. */
  offline?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: number;
}

export type AssistantEvent =
  | { type: "start"; conversationId: string; userMessage: AssistantMessage }
  | { type: "delta"; text: string }
  /** The authoritative text of one model turn; replaces that turn's deltas. */
  | { type: "turn_text"; text: string }
  | { type: "tool"; tool: string; detail?: string }
  | { type: "tool_result"; tool: string; ok: boolean }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; error: string; code: string };
