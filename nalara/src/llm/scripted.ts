/**
 * Scripted LLMProvider: a deterministic stand-in for Claude in tests and offline demos.
 *
 * Usage:
 *
 *   const llm = createScriptedProvider({
 *     // complete(): a queue (consumed in order; the last entry repeats) or a handler
 *     complete: ["first answer", "second answer"],
 *     // structured(): same; answers are validated against req.schema like the real provider,
 *     // so returning garbage makes structured() throw LLMError("invalid_output")
 *     structured: (req) => ({ intent: "engineering_review", required_agents: [], required_tools: [], confidence: 0.9 }),
 *     // runAgentLoop(): one script of turns for every loop, a queue of scripts, or a handler
 *     agent: [
 *       { text: "Reading the file", toolCalls: [{ name: "fs.read_file", input: { path: "a.ts" } }] },
 *       { text: "Done: no defects found" },
 *     ],
 *   });
 *
 * Any queue entry or handler result may be an Error (it is thrown), e.g. `new LLMError("no", "refusal")`.
 * A scripted turn may also set `stopReason: "refusal"` (throws LLMError refusal), or `throws`.
 *
 * `runAgentLoop` really calls `req.callTool` for every scripted tool call and emits the same event
 * sequence as the Claude provider: per turn `turn`, then `text` (if any), then for each tool call
 * `tool_call` and `tool_result`. The loop ends after a turn without tool calls ("end_turn"), when the
 * script runs out ("end_turn"), at maxTurns ("max_turns"), or throws LLMError("aborted") on abort.
 *
 * Every call is recorded in `provider.calls` for assertions. `withHooks` is supported, so the provider
 * works under `meterProvider` exactly like the real one (one hook round per scripted model response).
 */
import AjvModule from "ajv";
import {
  LLMError,
  type AgentLoopEvent,
  type AgentLoopResult,
  type Effort,
  type JsonSchemaObject,
  type LLMProvider,
  type ToolDefinition,
  type ToolResult,
} from "../kernel/types";
import { acquireAll, reportUsage, type HookableProvider, type ModelCallHooks, type ModelCallUsage } from "./meter";

// ajv is CommonJS; depending on the loader the class is the default export or its `.default`.
const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule) as typeof AjvModule;

export interface CompleteRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface StructuredRequest {
  system: string;
  prompt: string;
  schema: JsonSchemaObject;
  effort?: Effort;
  signal?: AbortSignal;
}

export interface AgentLoopRequest {
  system: string;
  task: string;
  tools: ToolDefinition[];
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  maxTurns?: number;
  effort?: Effort;
  signal?: AbortSignal;
  onEvent?: (event: AgentLoopEvent) => void;
}

export interface ScriptedToolCall {
  /** Nalara tool name, e.g. "fs.read_file". */
  name: string;
  input?: Record<string, unknown>;
}

export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  /** "refusal" throws LLMError(refusal) before anything in this turn runs. Default "tool_use" or "end_turn". */
  stopReason?: string;
  /** Thrown when this turn is reached (simulates an API error mid-loop). */
  throws?: Error;
  /** Usage reported for this turn. Defaults to the provider's `usagePerCall`. */
  usage?: ModelCallUsage;
}

type Answer<Req, T> = T | Error | ((req: Req, callIndex: number) => T | Error | Promise<T | Error>);

export interface ScriptedProviderOptions {
  name?: string;
  model?: string;
  /** Answers for complete(): a queue (last entry repeats), or a handler. Default: echoes the prompt. */
  complete?: Answer<CompleteRequest, string> | Array<string | Error>;
  /** Answers for structured(): a queue (last entry repeats), or a handler. Validated against the request schema. */
  structured?: Answer<StructuredRequest, unknown> | unknown[];
  /**
   * Scripts for runAgentLoop(): one script used for every loop (ScriptedTurn[]), a queue of scripts
   * (ScriptedTurn[][], last one repeats), or a handler returning a script. Default: one turn with "Done.".
   */
  agent?: ScriptedTurn[] | ScriptedTurn[][] | ((req: AgentLoopRequest, callIndex: number) => ScriptedTurn[] | Promise<ScriptedTurn[]>);
  /** Usage reported per scripted model response. Default { inputTokens: 100, outputTokens: 50 }. */
  usagePerCall?: ModelCallUsage;
  /** Validate structured() answers against the request schema (default true). */
  validate?: boolean;
}

export type ScriptedCall =
  | { method: "complete"; req: CompleteRequest }
  | { method: "structured"; req: StructuredRequest }
  | { method: "runAgentLoop"; req: AgentLoopRequest };

export interface ScriptedProvider extends HookableProvider {
  readonly calls: ScriptedCall[];
  /** Tool calls made by agent loops, in order, with their results. */
  readonly toolLog: { name: string; input: Record<string, unknown>; result: ToolResult }[];
}

const DEFAULT_USAGE: ModelCallUsage = { inputTokens: 100, outputTokens: 50 };

function fromQueue<T>(queue: T[], index: number): T {
  return queue[Math.min(index, queue.length - 1)];
}

async function resolveAnswer<Req, T>(answer: Answer<Req, T> | Array<T | Error> | undefined, req: Req, index: number, fallback: (req: Req) => T): Promise<T> {
  let value: unknown;
  if (answer === undefined) value = fallback(req);
  else if (typeof answer === "function") value = await (answer as (r: Req, i: number) => unknown)(req, index);
  else if (Array.isArray(answer)) value = answer.length ? fromQueue(answer, index) : fallback(req);
  else value = answer;
  if (value instanceof Error) throw value;
  return value as T;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LLMError("Aborted", "aborted", signal.reason);
}

export function createScriptedProvider(options: ScriptedProviderOptions = {}): ScriptedProvider {
  const calls: ScriptedCall[] = [];
  const toolLog: ScriptedProvider["toolLog"] = [];
  const counters = { complete: 0, structured: 0, agent: 0 };
  const usagePerCall = options.usagePerCall ?? DEFAULT_USAGE;
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });

  async function scriptFor(req: AgentLoopRequest, index: number): Promise<ScriptedTurn[]> {
    const agent = options.agent;
    if (agent === undefined) return [{ text: "Done." }];
    if (typeof agent === "function") return agent(req, index);
    if (agent.length === 0) return [{ text: "Done." }];
    if (Array.isArray(agent[0])) return fromQueue(agent as ScriptedTurn[][], index);
    return agent as ScriptedTurn[];
  }

  function build(hooks: ModelCallHooks[]): ScriptedProvider {
    /** Simulates one model request: admission, then usage reporting. */
    async function modelCall<T>(signal: AbortSignal | undefined, usage: ModelCallUsage, produce: () => Promise<T>): Promise<T> {
      throwIfAborted(signal);
      const release = await acquireAll(hooks, signal);
      let value: T;
      try {
        value = await produce();
      } finally {
        release();
      }
      reportUsage(hooks, usage);
      return value;
    }

    const provider: ScriptedProvider = {
      name: options.name ?? "scripted",
      model: options.model ?? "scripted-model",
      calls,
      toolLog,

      withHooks: (extra) => build([...hooks, extra]),

      async complete(req) {
        calls.push({ method: "complete", req });
        const index = counters.complete++;
        return modelCall(req.signal, usagePerCall, () =>
          resolveAnswer<CompleteRequest, string>(options.complete, req, index, (r) => `(scripted) ${r.prompt.slice(0, 200)}`),
        );
      },

      async structured<T>(req: StructuredRequest): Promise<T> {
        calls.push({ method: "structured", req });
        const index = counters.structured++;
        const value = await modelCall(req.signal, usagePerCall, () =>
          resolveAnswer<StructuredRequest, unknown>(options.structured as Answer<StructuredRequest, unknown> | unknown[] | undefined, req, index, () => {
            throw new LLMError("No scripted structured answer", "invalid_output");
          }),
        );
        if (options.validate !== false) {
          const validate = ajv.compile(req.schema);
          if (!validate(value)) {
            throw new LLMError(`Scripted output does not match the schema: ${ajv.errorsText(validate.errors)}`, "invalid_output", validate.errors);
          }
        }
        return value as T;
      },

      async runAgentLoop(req): Promise<AgentLoopResult> {
        calls.push({ method: "runAgentLoop", req });
        const script = await scriptFor(req, counters.agent++);
        const maxTurns = req.maxTurns ?? 12;
        const known = new Set(req.tools.map((t) => t.name));
        const usage = { inputTokens: 0, outputTokens: 0 };
        let turns = 0;
        let toolCalls = 0;
        let lastText = "";
        const finish = (stopReason: string): AgentLoopResult => ({ text: lastText, turns, toolCalls, stopReason, usage: { ...usage } });

        for (const turn of script) {
          if (turns >= maxTurns) return finish("max_turns");
          const turnUsage = turn.usage ?? usagePerCall;
          await modelCall(req.signal, turnUsage, async () => {
            if (turn.throws) throw turn.throws;
          });
          turns++;
          usage.inputTokens += turnUsage.inputTokens;
          usage.outputTokens += turnUsage.outputTokens;
          req.onEvent?.({ type: "turn", turn: turns });
          if (turn.stopReason === "refusal") throw new LLMError("Scripted refusal", "refusal");
          if (turn.text) {
            lastText = turn.text;
            req.onEvent?.({ type: "text", text: turn.text });
          }
          const scriptedCalls = turn.toolCalls ?? [];
          if (scriptedCalls.length === 0) return finish(turn.stopReason ?? "end_turn");

          for (const call of scriptedCalls) {
            const input = call.input ?? {};
            req.onEvent?.({ type: "tool_call", tool: call.name, input });
            let result: ToolResult;
            if (!known.has(call.name)) {
              result = { ok: false, content: `Unknown tool: ${call.name}`, error: "unknown_tool" };
            } else {
              toolCalls++;
              try {
                result = await req.callTool(call.name, input);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                result = { ok: false, content: `Tool failed: ${message}`, error: message };
              }
            }
            throwIfAborted(req.signal);
            toolLog.push({ name: call.name, input, result });
            req.onEvent?.({ type: "tool_result", tool: call.name, input, result });
          }
        }
        return finish(turns >= maxTurns ? "max_turns" : "end_turn");
      },
    };
    return provider;
  }

  return build([]);
}

/** Type guard used by tests that accept any LLMProvider. */
export function isScriptedProvider(provider: LLMProvider): provider is ScriptedProvider {
  return Array.isArray((provider as Partial<ScriptedProvider>).calls);
}
