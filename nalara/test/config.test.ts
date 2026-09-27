import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigError, DEFAULT_BUDGET, isLoopbackHost, loadConfig, validateConfigFile } from "../src/kernel/config";

const dirs: string[] = [];
function tempRoot(config?: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nos-config-"));
  dirs.push(dir);
  if (config !== undefined) writeFileSync(path.join(dir, "nalara.config.json"), typeof config === "string" ? config : JSON.stringify(config));
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("fills every default", () => {
    const root = tempRoot();
    const c = loadConfig({ root }, {});
    expect(c.root).toBe(root);
    expect(c.dataDir).toBe(path.join(root, ".nalara"));
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(7437);
    expect(c.model).toBe("claude-opus-5");
    expect(c.effort).toBe("high");
    expect(c.useClaude).toBe(true);
    expect(c.toolPolicy).toEqual({ mode: "ask" });
    expect(c.mcpServers).toEqual({});
    expect(c.triggers).toBe(true);
    expect(c.watch).toBe(true);
    expect(c.maxConcurrentAgents).toBe(4);
    expect(c.maxDelegationDepth).toBe(3);
    expect(c.userId.length).toBeGreaterThan(0);
    expect(c.budget).toEqual({ maxInputTokens: 400000, maxOutputTokens: 64000, maxToolCalls: 60, maxTurns: 24, maxWallMs: 15 * 60_000, maxRepeatCalls: 3 });
    expect(c.budget).toEqual(DEFAULT_BUDGET);
  });

  it("uses NALARA_ROOT, then the working directory", () => {
    const root = tempRoot();
    expect(loadConfig({}, { NALARA_ROOT: root }).root).toBe(root);
    expect(loadConfig({}, {}).root).toBe(process.cwd());
  });

  it("merges file, then env, then overrides", () => {
    const root = tempRoot({ port: 8000, model: "file-model", budget: { maxTurns: 5 }, toolPolicy: { mode: "auto", deny: ["proc.*"] }, watch: false });
    const fromFile = loadConfig({ root }, {});
    expect(fromFile.port).toBe(8000);
    expect(fromFile.model).toBe("file-model");
    expect(fromFile.budget.maxTurns).toBe(5);
    expect(fromFile.budget.maxToolCalls).toBe(60);
    expect(fromFile.toolPolicy).toEqual({ mode: "auto", deny: ["proc.*"] });
    expect(fromFile.watch).toBe(false);

    const env = { NALARA_PORT: "9000", NALARA_MODEL: "env-model", NALARA_OFFLINE: "1", NALARA_POLICY: "readonly", NALARA_HOST: "localhost" };
    const fromEnv = loadConfig({ root }, env);
    expect(fromEnv.port).toBe(9000);
    expect(fromEnv.model).toBe("env-model");
    expect(fromEnv.useClaude).toBe(false);
    expect(fromEnv.host).toBe("localhost");
    expect(fromEnv.toolPolicy).toEqual({ mode: "readonly", deny: ["proc.*"] });

    const fromOverrides = loadConfig({ root, port: 0, model: "override", budget: { maxWallMs: 1000 } }, env);
    expect(fromOverrides.port).toBe(0);
    expect(fromOverrides.model).toBe("override");
    expect(fromOverrides.budget.maxWallMs).toBe(1000);
    expect(fromOverrides.budget.maxTurns).toBe(5);
  });

  it("resolves a relative dataDir against the root", () => {
    const root = tempRoot({ dataDir: "state" });
    expect(loadConfig({ root }, {}).dataDir).toBe(path.join(root, "state"));
  });

  it("rejects unknown keys and bad values in the config file with a clear error", () => {
    expect(() => loadConfig({ root: tempRoot({ prot: 1 }) }, {})).toThrow(/unknown key "prot"/);
    expect(() => loadConfig({ root: tempRoot({ port: "80" }) }, {})).toThrow(/port must be an integer/);
    expect(() => loadConfig({ root: tempRoot({ toolPolicy: { mode: "yolo" } }) }, {})).toThrow(/mode must be one of/);
    expect(() => loadConfig({ root: tempRoot({ budget: { maxTurn: 3 } }) }, {})).toThrow(/unknown key "maxTurn"/);
    expect(() => loadConfig({ root: tempRoot({ root: "/" }) }, {})).toThrow(/"root" cannot be set/);
    expect(() => loadConfig({ root: tempRoot("{not json") }, {})).toThrow(ConfigError);
    expect(() => loadConfig({ root: tempRoot({ mcpServers: { gh: { command: "x", url: "http://y" } } }) }, {})).toThrow(/exactly one of/);
    expect(() => validateConfigFile([])).toThrow(/JSON object/);
  });

  it("accepts MCP server configs", () => {
    const root = tempRoot({ mcpServers: { notes: { command: "node", args: ["server.js"], env: { A: "1" } } } });
    expect(loadConfig({ root }, {}).mcpServers.notes).toEqual({ command: "node", args: ["server.js"], env: { A: "1" } });
  });

  it("rejects bad environment values", () => {
    const root = tempRoot();
    expect(() => loadConfig({ root }, { NALARA_PORT: "abc" })).toThrow(/NALARA_PORT/);
    expect(() => loadConfig({ root }, { NALARA_POLICY: "maybe" })).toThrow(/NALARA_POLICY/);
  });

  it("refuses a non-loopback host unless NALARA_ALLOW_REMOTE=1, and says why", () => {
    const root = tempRoot();
    expect(() => loadConfig({ root, host: "0.0.0.0" }, {})).toThrow(/no authentication/);
    expect(() => loadConfig({ root }, { NALARA_HOST: "192.168.1.5" })).toThrow(/NALARA_ALLOW_REMOTE=1/);
    expect(loadConfig({ root, host: "0.0.0.0" }, { NALARA_ALLOW_REMOTE: "1" }).host).toBe("0.0.0.0");
    for (const h of ["127.0.0.1", "localhost", "::1", "127.0.0.2"]) expect(loadConfig({ root, host: h }, {}).host).toBe(h);
  });

  it("recognises loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("fails for a root that does not exist", () => {
    expect(() => loadConfig({ root: path.join(os.tmpdir(), "nos-does-not-exist-xyz") }, {})).toThrow(/root does not exist/);
  });
});
