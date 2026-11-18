import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { groupRepeats } from "../src/agents/commander";
import { findIntentClass, INTENT_CATALOG } from "../src/intent/catalog";
import { classifyHeuristic } from "../src/intent/engine";
import { CLAUDE_KEY_SECRET, createKernel, type NeuralKernel } from "../src/kernel/kernel";
import { ClaudeKeyError } from "../src/llm/anthropic";
import { createHttpServer, type NeuralHttpServer } from "../src/server/http";
import type { Finding } from "../src/kernel/types";

const DEMO = path.resolve(__dirname, "../demo/breath-of-fire-iv-remake");
const temps: string[] = [];
const kernels: NeuralKernel[] = [];
const servers: NeuralHttpServer[] = [];

afterAll(async () => {
  for (const s of servers) await s.close().catch(() => undefined);
  for (const k of kernels) await k.stop().catch(() => undefined);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function demoCopy(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nos-claude-"));
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes(".nalara") });
  temps.push(dir);
  return dir;
}

const GOOD_KEY = "sk-ant-test-good-0123456789";
/** A stand-in for the Models API check: one key is accepted, "bad" keys are rejected, "offline" cannot be reached. */
const fakeCheck = async (key: string) => {
  if (key === GOOD_KEY) return;
  if (key.includes("offline")) throw new ClaudeKeyError("Could not reach Anthropic to check the key.", "unreachable");
  throw new ClaudeKeyError("Anthropic did not accept this API key.", "invalid");
};

async function boot(root: string, opts: { onRestart?: () => void } = {}) {
  const kernel = createKernel({ root, watch: false, triggers: false, port: 0 }, { env: {}, checkClaudeKey: fakeCheck });
  kernels.push(kernel);
  await kernel.start();
  const http = createHttpServer(kernel, opts);
  servers.push(http);
  const { url } = await http.listen(0, "127.0.0.1");
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${url}${p}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Nalara-Client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { kernel, http, call };
}

describe("intent classes that need Claude", () => {
  it("marks writing, translation, feature, fix, docs, summary and general tasks; review, tests, security, search and design run offline", () => {
    const needs = INTENT_CATALOG.filter((c) => c.needsClaude).map((c) => c.intent).sort();
    expect(needs).toEqual(["bug_fix", "document_translation", "documentation", "feature_build", "general_task", "legal_translation", "summarize", "website_localization", "writing"]);
    for (const offline of ["engineering_review", "research", "test_run", "security_audit", "deployment", "design_review"]) expect(findIntentClass(offline)?.needsClaude).toBeUndefined();
  });

  it.each([
    ["Write a marketing email for my translation agency", "writing"],
    ["Draft a cover letter for a translator job", "writing"],
    ["Write a short poem about the sea", "writing"],
    ["Translate this email into Indonesian", "document_translation"],
    ["Write documentation for the inventory module", "documentation"],
    ["Review inventory module", "engineering_review"],
    ["Translate contract", "legal_translation"],
  ])("classifies %j as %s", (text, intent) => {
    expect(classifyHeuristic(text).intent).toBe(intent);
  });
});

describe("repeated findings", () => {
  const f = (file: string, line: number, title = 'Glossary term written as "fire"'): Finding => ({ severity: "low", title, detail: "Use the glossary form.", file, line });

  it("groups one title at three or more places into a single finding with the count and locations", () => {
    const many = Array.from({ length: 12 }, (_, i) => f(`docs/a${i % 3}.md`, i + 1));
    const out = groupRepeats([...many, f("src/x.ts", 4, "Use of any")]);
    expect(out).toHaveLength(2);
    const grouped = out.find((x) => x.title.startsWith("Glossary"))!;
    expect(grouped.title).toBe('Glossary term written as "fire" (12 places in 3 file(s))');
    expect(grouped).toMatchObject({ file: "docs/a0.md", line: 1 });
    expect(grouped.detail).toMatch(/Also at docs\/a1\.md:2, .* and 5 more\./);
  });

  it("leaves two occurrences, different severities and unlocated findings alone", () => {
    const out = groupRepeats([f("a.md", 1), f("b.md", 2), { ...f("c.md", 3), severity: "medium" }, { severity: "info", title: "General note", detail: "" }]);
    expect(out).toHaveLength(4);
  });
});

describe("offline Nalara is honest about intents that need Claude", () => {
  it("refuses them over HTTP with needs_claude and no workspace, runs them when asked, and runs offline-capable intents", async () => {
    const { kernel, call } = await boot(demoCopy());
    const preview = await call("POST", "/api/intents/classify", { text: "Write a marketing email for my translation agency" });
    expect(preview.json).toMatchObject({ intent: "writing", label: "Writing", needsClaude: true });
    expect((await call("POST", "/api/intents/classify", { text: "Review inventory module" })).json).toMatchObject({ needsClaude: false });

    const refused = await call("POST", "/api/intents", { text: "Write a marketing email for my translation agency" });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "needs_claude" });
    expect(String(refused.json.error)).toMatch(/"Writing" needs Claude.*Settings > Claude/);
    expect(kernel.workspaces.list()).toHaveLength(0);

    const anyway = await call("POST", "/api/intents", { text: "Write a marketing email for my translation agency", offlineAnyway: true, run: false });
    expect(anyway.status).toBe(200);
    const review = await call("POST", "/api/intents", { text: "Review inventory module", run: false });
    expect(review.status).toBe(200);
    expect(kernel.workspaces.list()).toHaveLength(2);
  });
});

describe("Claude key from Settings", () => {
  it("checks the key, stores it as a secret, and the next kernel on that root uses Claude with it", async () => {
    const root = demoCopy();
    const { kernel, http, call } = await boot(root);
    expect((await call("GET", "/api/claude")).json).toEqual({ mode: "offline", model: "claude-opus-5-5", credentials: "none", canRestart: false });

    const bad = await call("PUT", "/api/claude/key", { key: "sk-ant-wrong" });
    expect(bad).toMatchObject({ status: 400, json: { code: "claude_key_rejected" } });
    const unreachable = await call("PUT", "/api/claude/key", { key: "sk-ant-offline-x" });
    expect(unreachable).toMatchObject({ status: 502, json: { code: "claude_unreachable" } });
    expect(kernel.secrets.has(CLAUDE_KEY_SECRET)).toBe(false);

    const saved = await call("PUT", "/api/claude/key", { key: GOOD_KEY });
    expect(saved).toMatchObject({ status: 200, json: { saved: true, replaced: false, canRestart: false } });
    expect(kernel.secrets.has(CLAUDE_KEY_SECRET)).toBe(true);
    // The value never comes back out: secrets list, audit and events carry the name only.
    const leaks = JSON.stringify([(await call("GET", "/api/secrets")).json, kernel.audit.list({ limit: 5000 }), kernel.bus.history({ limit: 5000 })]);
    expect(leaks).not.toContain(GOOD_KEY);
    expect((await call("POST", "/api/kernel/restart")).json).toMatchObject({ code: "restart_unavailable" });

    // A restart is a new kernel on the same root.
    await http.close();
    await kernel.stop();
    const next = await boot(root);
    expect(next.kernel.status()).toMatchObject({ mode: "claude", credentials: "settings", model: "claude-opus-5-5" });
    expect((await next.call("DELETE", "/api/claude/key")).json).toMatchObject({ ok: true });
    expect(next.kernel.secrets.has(CLAUDE_KEY_SECRET)).toBe(false);
  });

  it("restarts through the supervisor's hook after answering", async () => {
    let restarts = 0;
    const { call } = await boot(demoCopy(), { onRestart: () => void restarts++ });
    expect((await call("GET", "/api/claude")).json).toMatchObject({ canRestart: true });
    expect((await call("POST", "/api/kernel/restart")).json).toEqual({ restarting: true });
    await new Promise((r) => setTimeout(r, 150));
    expect(restarts).toBe(1);
  });

  it("does not use a saved key when the environment already has credentials", async () => {
    const root = demoCopy();
    const first = await boot(root);
    await first.call("PUT", "/api/claude/key", { key: GOOD_KEY });
    const k = createKernel({ root, watch: false, triggers: false, port: 0 }, { env: { ANTHROPIC_API_KEY: "sk-ant-from-env" } });
    kernels.push(k);
    expect(k.status()).toMatchObject({ mode: "claude", credentials: "environment" });
  });
});
