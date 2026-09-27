import { describe, expect, it } from "vitest";
import { createAnthropicProvider, type AnthropicClientLike } from "../src/llm/anthropic";
import { BUDGET_EXCEEDED_PREFIX, isHookableProvider, meterProvider, type MeteredUsage } from "../src/llm/meter";
import { createScriptedProvider } from "../src/llm/scripted";
import { LLMError, type LLMProvider, type ToolDefinition } from "../src/kernel/types";

const readTool: ToolDefinition = {
  name: "fs.read_file",
  description: "read",
  server: "builtin:fs",
  action: "read",
  reversibility: "reversible",
  scope: "tenant",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

function recorder(limit = Infinity) {
  const log: string[] = [];
  const charged: MeteredUsage[] = [];
  let running = 0;
  let maxRunning = 0;
  let total = 0;
  const hooks = {
    beforeCall: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push("admit");
      return () => {
        running--;
        log.push("release");
      };
    },
    afterCall: (usage: MeteredUsage) => {
      charged.push(usage);
      log.push("charge");
      total += usage.inputTokens + usage.outputTokens;
      return total > limit ? { exceeded: true, reason: `tokens ${total} > ${limit}` } : { exceeded: false };
    },
  };
  return { hooks, log, charged, stats: () => ({ running, maxRunning }) };
}

describe("meterProvider with a hookable provider", () => {
  it("admits and charges every model turn of an agent loop", async () => {
    const scripted = createScriptedProvider({
      usagePerCall: { inputTokens: 10, outputTokens: 1 },
      agent: [{ toolCalls: [{ name: "fs.read_file", input: { path: "a" } }] }, { toolCalls: [{ name: "fs.read_file", input: { path: "b" } }] }, { text: "done" }],
    });
    expect(isHookableProvider(scripted)).toBe(true);
    const { hooks, log, charged, stats } = recorder();
    const llm = meterProvider(scripted, hooks);
    const result = await llm.runAgentLoop({ system: "s", task: "t", tools: [readTool], callTool: async () => ({ ok: true, content: "x" }) });

    expect(result.turns).toBe(3);
    expect(charged).toEqual([
      { inputTokens: 10, outputTokens: 1, turns: 1 },
      { inputTokens: 10, outputTokens: 1, turns: 1 },
      { inputTokens: 10, outputTokens: 1, turns: 1 },
    ]);
    expect(log).toEqual(["admit", "release", "charge", "admit", "release", "charge", "admit", "release", "charge"]);
    expect(stats().running).toBe(0);
    expect(llm.name).toBe("scripted");
  });

  it("aborts the loop with LLMError when a budget is exceeded, before the turn's tools run", async () => {
    const scripted = createScriptedProvider({
      usagePerCall: { inputTokens: 60, outputTokens: 0 },
      agent: [{ toolCalls: [{ name: "fs.read_file", input: { path: "a" } }] }, { toolCalls: [{ name: "fs.read_file", input: { path: "b" } }] }, { text: "done" }],
    });
    const { hooks } = recorder(100);
    const llm = meterProvider(scripted, hooks);
    const calledWith: unknown[] = [];
    const err = await llm
      .runAgentLoop({ system: "s", task: "t", tools: [readTool], callTool: async (_n, input) => (calledWith.push(input), { ok: true, content: "x" }) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe("budget");
    expect(err.message).toContain(BUDGET_EXCEEDED_PREFIX);
    expect(err.message).toContain("tokens 120 > 100");
    expect(calledWith).toEqual([{ path: "a" }]);
    // The budget stays exceeded for later calls on the same metered provider.
    await expect(llm.complete({ system: "s", prompt: "p" })).rejects.toMatchObject({ kind: "budget" });
  });

  it("meters each API request of the Claude provider, including loop turns", async () => {
    const responses = [
      { content: [{ type: "tool_use", id: "tu_1", name: "fs__read_file", input: { path: "a" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
    ];
    const make = (r: (typeof responses)[number]) => ({ ...r, usage: { input_tokens: 7, output_tokens: 3 } });
    const client: AnthropicClientLike = {
      beta: {
        messages: {
          create: async () => make(responses.shift()!) as never,
          stream: () => ({ finalMessage: async () => make(responses.shift()!) as never }),
        },
      },
    };
    const { hooks, charged, log } = recorder();
    const llm = meterProvider(createAnthropicProvider({ client }), hooks);
    await llm.runAgentLoop({ system: "s", task: "t", tools: [readTool], callTool: async () => ({ ok: true, content: "x" }) });
    expect(charged).toEqual([
      { inputTokens: 7, outputTokens: 3, turns: 1 },
      { inputTokens: 7, outputTokens: 3, turns: 1 },
    ]);
    expect(log.filter((l) => l === "admit")).toHaveLength(2);
  });

  it("releases admission when the model call fails", async () => {
    const scripted = createScriptedProvider({ complete: [new LLMError("boom", "api")] });
    const { hooks, log, stats } = recorder();
    await expect(meterProvider(scripted, hooks).complete({ system: "s", prompt: "p" })).rejects.toMatchObject({ kind: "api" });
    expect(log).toEqual(["admit", "release"]);
    expect(stats().running).toBe(0);
  });

  it("passes the abort signal to admission", async () => {
    const scripted = createScriptedProvider();
    const seen: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const llm = meterProvider(scripted, { beforeCall: async (signal) => (seen.push(signal), () => {}) });
    await llm.complete({ system: "s", prompt: "p", signal: controller.signal });
    expect(seen).toEqual([controller.signal]);
  });
});

describe("meterProvider with a plain provider (coarse mode)", () => {
  const plain: LLMProvider = {
    name: "plain",
    model: "m",
    complete: async () => "abcdefgh",
    structured: async <T>() => ({ ok: true }) as T,
    runAgentLoop: async () => ({ text: "t", turns: 3, toolCalls: 0, stopReason: "end_turn", usage: { inputTokens: 40, outputTokens: 4 } }),
  };

  it("meters each public call once, with estimated or reported usage", async () => {
    const { hooks, charged, log } = recorder();
    const llm = meterProvider(plain, hooks);
    expect(await llm.complete({ system: "ssss", prompt: "pppp" })).toBe("abcdefgh");
    await llm.runAgentLoop({ system: "s", task: "t", tools: [], callTool: async () => ({ ok: true, content: "" }) });
    expect(charged).toEqual([
      { inputTokens: 2, outputTokens: 2, turns: 1 },
      { inputTokens: 40, outputTokens: 4, turns: 1 },
    ]);
    expect(log).toEqual(["admit", "release", "charge", "admit", "release", "charge"]);
  });

  it("throws when the budget is exceeded", async () => {
    const { hooks } = recorder(10);
    const llm = meterProvider(plain, hooks);
    await expect(llm.runAgentLoop({ system: "s", task: "t", tools: [], callTool: async () => ({ ok: true, content: "" }) })).rejects.toMatchObject({
      kind: "budget",
    });
  });
});
