import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEventBus } from "../src/events/bus";
import { createAuditLog } from "../src/kernel/audit";
import { openDatabase } from "../src/kernel/db";
import { createSecretStore, SecretError } from "../src/kernel/secrets";
import { createToolRegistry } from "../src/tools/registry";
import type { KernelEvent, Principal } from "../src/kernel/types";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "nos-secrets-"));
  temps.push(d);
  return d;
};

describe("secret store", () => {
  it("stores values in a 0600 file, lists names only and survives a reload", () => {
    const dir = tmp();
    const store = createSecretStore({ dataDir: dir });
    const info = store.set("GITHUB_TOKEN", "ghp_abcdefghijklmnop");
    expect(info).toMatchObject({ name: "GITHUB_TOKEN", redacted: true });
    expect(JSON.stringify(store.list())).not.toContain("ghp_");
    const file = path.join(dir, "secrets.json");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("ghp_abcdefghijklmnop");
    const again = createSecretStore({ dataDir: dir });
    expect(again.has("GITHUB_TOKEN")).toBe(true);
    expect(again.delete("GITHUB_TOKEN")).toBe(true);
    expect(again.delete("GITHUB_TOKEN")).toBe(false);
    expect(createSecretStore({ dataDir: dir }).list()).toEqual([]);
  });

  it("creates a missing data dir on the first write", () => {
    const dir = path.join(tmp(), "fresh", ".nalara");
    const store = createSecretStore({ dataDir: dir });
    store.set("FIRST_TOKEN", "first-value-123");
    expect(createSecretStore({ dataDir: dir }).has("FIRST_TOKEN")).toBe(true);
  });

  it("rejects bad names and values", () => {
    const store = createSecretStore();
    expect(() => store.set("lower", "x")).toThrow(SecretError);
    expect(() => store.set("1BAD", "x")).toThrow(SecretError);
    expect(() => store.set("OK", "")).toThrow(SecretError);
    expect(() => store.set("OK", "x".repeat(9000))).toThrow(/larger than/);
  });

  it("resolves ${secret:NAME} placeholders and names every missing secret", () => {
    const store = createSecretStore();
    store.set("API_KEY", "sk-live-123456");
    expect(store.references("Bearer ${secret:API_KEY} ${secret:OTHER} ${secret:API_KEY}")).toEqual(["API_KEY", "OTHER"]);
    expect(store.resolve("Bearer ${secret:API_KEY}")).toBe("Bearer sk-live-123456");
    expect(store.resolveRecord({ Authorization: "Bearer ${secret:API_KEY}", Plain: "x" })).toEqual({ Authorization: "Bearer sk-live-123456", Plain: "x" });
    expect(() => store.resolve("${secret:OTHER} ${secret:MISSING}")).toThrow(/missing secret\(s\): OTHER, MISSING/);
    expect(store.resolveRecord(undefined)).toBeUndefined();
  });

  it("redacts stored values from text and nested values, longest first; short values are not redacted", () => {
    const store = createSecretStore();
    store.set("LONG", "token-abcdef-123");
    store.set("INNER", "abcdef-123");
    store.set("TINY", "abc");
    expect(store.redact("x token-abcdef-123 y abcdef-123 abc")).toBe("x [secret:LONG] y [secret:INNER] abc");
    expect(store.redactValue({ a: ["token-abcdef-123"], b: { c: "abcdef-123" }, n: 1, z: null })).toEqual({ a: ["[secret:LONG]"], b: { c: "[secret:INNER]" }, n: 1, z: null });
    expect(store.list().find((s) => s.name === "TINY")?.redacted).toBe(false);
    expect(createSecretStore().redactValue({ a: "x" })).toEqual({ a: "x" });
  });
});

describe("gateway redaction", () => {
  it("removes secret values from tool results, events and the audit ledger", async () => {
    const db = openDatabase(":memory:");
    const bus = createEventBus({ db });
    const audit = createAuditLog({ db });
    const secrets = createSecretStore();
    secrets.set("SERVICE_TOKEN", "tok_0123456789");
    const registry = createToolRegistry({ bus, audit, policy: { mode: "auto" }, redact: { text: (t) => secrets.redact(t), value: (v) => secrets.redactValue(v) } });
    registry.register(
      { name: "ext.echo", description: "echo", server: "mcp:ext", action: "read", reversibility: "reversible", scope: "external", inputSchema: { type: "object" } },
      async () => ({ ok: false, content: "server said tok_0123456789", data: { token: "tok_0123456789" }, error: "auth tok_0123456789 rejected" }),
    );
    const events: KernelEvent[] = [];
    bus.subscribe("tool.*", (e) => {
      events.push(e);
    });
    const human: Principal = { userId: "u", chain: ["user:u"], depth: 0 };
    const r = await registry.call("ext.echo", {}, { principal: human });
    await bus.drain();
    expect(r).toEqual({ ok: false, content: "server said [secret:SERVICE_TOKEN]", data: { token: "[secret:SERVICE_TOKEN]" }, error: "auth [secret:SERVICE_TOKEN] rejected" });
    expect(JSON.stringify(events)).not.toContain("tok_0123456789");
    expect(JSON.stringify(audit.list())).not.toContain("tok_0123456789");
  });
});
