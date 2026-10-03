import { describe, expect, it } from "vitest";
import { createScriptedProvider, isScriptedProvider } from "../src/llm/scripted";
import { LLMError, type AgentLoopEvent, type ToolDefinition, type ToolResult } from "../src/kernel/types";

const tools: ToolDefinition[] = ["fs.read_file", "git.status"].map((name) => ({
  name,
  description: name,
  server: "builtin:fs",
  action: "read",
  reversibility: "reversible",
  scope: "tenant",
  inputSchema: { type: "object", properties: {} },
}));

const schema = {
  type: "object" as const,
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

describe("createScriptedProvider: complete and structured", () => {
  it("answers complete() from a queue whose last entry repeats, and records calls", async () => {
    const llm = createScriptedProvider({ complete: ["one", "two"] });
    expect(await llm.complete({ system: "s", prompt: "a" })).toBe("one");
    expect(await llm.complete({ system: "s", prompt: "b" })).toBe("two");
    expect(await llm.complete({ system: "s", prompt: "c" })).toBe("two");
    expect(llm.calls.map((c) => c.method)).toEqual(["complete", "complete", "complete"]);
    expect(isScriptedProvider(llm)).toBe(true);
  });

  it("answers from a handler and throws queued errors", async () => {
    const llm = createScriptedProvider({
      complete: (req, i) => `${i}:${req.prompt}`,
      structured: [new LLMError("nope", "refusal"), { answer: "yes" }],
    });
    expect(await llm.complete({ system: "s", prompt: "hi" })).toBe("0:hi");
    await expect(llm.structured({ system: "s", prompt: "p", schema })).rejects.toMatchObject({ kind: "refusal" });
    expect(await llm.structured({ system: "s", prompt: "p", schema })).toEqual({ answer: "yes" });
  });

  it("validates structured answers against the request schema like the real provider", async () => {
    const llm = createScriptedProvider({ structured: [{ wrong: true }, "garbage"] });
    await expect(llm.structured({ system: "s", prompt: "p", schema })).rejects.toMatchObject({ kind: "invalid_output" });
    await expect(llm.structured({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(LLMError);
    const lenient = createScriptedProvider({ structured: ["garbage"], validate: false });
    expect(await lenient.structured({ system: "s", prompt: "p", schema })).toBe("garbage");
  });
});

describe("createScriptedProvider: agent loop", () => {
  function loop(llm: ReturnType<typeof createScriptedProvider>, opts: { maxTurns?: number; signal?: AbortSignal; fail?: string } = {}) {
    const events: AgentLoopEvent[] = [];
    const called: string[] = [];
    const run = llm.runAgentLoop({
      system: "s",
      task: "t",
      tools,
      maxTurns: opts.maxTurns,
      signal: opts.signal,
      callTool: async (name, input): Promise<ToolResult> => {
        called.push(`${name}:${JSON.stringify(input)}`);
        if (name === opts.fail) throw new Error("disk on fire");
        return { ok: true, content: `${name} ok` };
      },
      onEvent: (e) => events.push(e),
    });
    return { run, events, called };
  }

  it("invokes callTool for each scripted call and emits the provider event sequence", async () => {
    const llm = createScriptedProvider({
      agent: [
        { text: "Looking", toolCalls: [{ name: "fs.read_file", input: { path: "a.ts" } }, { name: "git.status" }] },
        { text: "Finished review" },
      ],
    });
    const { run, events, called } = loop(llm, { fail: "git.status" });
    const result = await run;
    expect(called).toEqual(['fs.read_file:{"path":"a.ts"}', "git.status:{}"]);
    expect(result).toEqual({ text: "Finished review", turns: 2, toolCalls: 2, stopReason: "end_turn", usage: { inputTokens: 200, outputTokens: 100 } });
    expect(events.map((e) => e.type)).toEqual(["turn", "text", "tool_call", "tool_result", "tool_call", "tool_result", "turn", "text"]);
    expect(events[5].result).toMatchObject({ ok: false, content: "Tool failed: disk on fire" });
    expect(llm.toolLog.map((t) => t.name)).toEqual(["fs.read_file", "git.status"]);
  });

  it("reports unknown tools as failures without calling them", async () => {
    const llm = createScriptedProvider({ agent: [{ toolCalls: [{ name: "proc.deploy" }] }, { text: "ok" }] });
    const { run, called, events } = loop(llm);
    const result = await run;
    expect(called).toEqual([]);
    expect(result.toolCalls).toBe(0);
    expect(events.find((e) => e.type === "tool_result")?.result?.ok).toBe(false);
  });

  it("stops at maxTurns, throws on refusal and abort, and consumes a queue of scripts", async () => {
    const endless = Array.from({ length: 5 }, () => ({ toolCalls: [{ name: "fs.read_file" }] }));
    const llm = createScriptedProvider({ agent: [endless, [{ stopReason: "refusal" }], [{ text: "third" }]] });
    const first = await loop(llm, { maxTurns: 2 }).run;
    expect(first).toMatchObject({ stopReason: "max_turns", turns: 2, toolCalls: 2 });
    await expect(loop(llm).run).rejects.toMatchObject({ kind: "refusal" });
    expect((await loop(llm).run).text).toBe("third");

    const controller = new AbortController();
    controller.abort();
    await expect(loop(llm, { signal: controller.signal }).run).rejects.toMatchObject({ kind: "aborted" });
  });

  it("takes a script from a handler and defaults to a single 'Done.' turn", async () => {
    const llm = createScriptedProvider({ agent: (req) => [{ text: `task was ${req.task}` }] });
    expect((await loop(llm).run).text).toBe("task was t");
    expect((await loop(createScriptedProvider()).run)).toMatchObject({ text: "Done.", turns: 1, stopReason: "end_turn" });
  });
});
