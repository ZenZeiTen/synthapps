import { describe, expect, it } from "vitest";
import { canonicalJson, createAuditLog, GENESIS_HASH } from "../src/kernel/audit";
import { openDatabase } from "../src/kernel/db";
import type { Principal } from "../src/kernel/types";

const principal: Principal = { userId: "local", agentId: "qa_engineer", instanceId: "ai_1", workspaceId: "ws_1", chain: ["user:local", "agent:qa_engineer#ai_1"], depth: 1 };

function seeded() {
  const db = openDatabase(":memory:");
  const audit = createAuditLog({ db });
  audit.append({ kind: "tool_call", principal, subject: "fs.read_file", outcome: "ok", detail: { path: "a.ts" } });
  audit.append({ kind: "approval", principal, subject: "proc.run_tests", outcome: "denied", detail: { reason: "user said no" } });
  audit.append({ kind: "halt", principal: null, subject: "kernel", outcome: "info", detail: {} });
  return { db, audit };
}

describe("audit log", () => {
  it("chains entries from the genesis hash", () => {
    const { audit } = seeded();
    const all = audit.list();
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(all[0].prevHash).toBe(GENESIS_HASH);
    expect(all[1].prevHash).toBe(all[0].hash);
    expect(all[2].prevHash).toBe(all[1].hash);
    expect(all[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(all[0].principal).toEqual(principal);
    expect(audit.verify()).toBeNull();
  });

  it("has no update or delete API", () => {
    const { audit } = seeded();
    expect(Object.keys(audit).sort()).toEqual(["append", "list", "verify"]);
  });

  it("detects a tampered row", () => {
    const { db, audit } = seeded();
    db.prepare("UPDATE audit_log SET outcome = 'allowed' WHERE seq = 2").run();
    expect(audit.verify()).toBe(2);
  });

  it("detects a tampered detail even if the hash is recomputed without the chain", () => {
    const { db, audit } = seeded();
    db.prepare("UPDATE audit_log SET detail = ? WHERE seq = 1").run(JSON.stringify({ path: "secrets.env" }));
    expect(audit.verify()).toBe(1);
  });

  it("detects a deleted row in the middle", () => {
    const { db, audit } = seeded();
    db.prepare("DELETE FROM audit_log WHERE seq = 2").run();
    expect(audit.verify()).toBe(3);
  });

  it("detects a forged prevHash", () => {
    const { db, audit } = seeded();
    db.prepare("UPDATE audit_log SET prev_hash = ? WHERE seq = 3").run("f".repeat(64));
    expect(audit.verify()).toBe(3);
  });

  it("continues the chain across instances on the same database", () => {
    const { db } = seeded();
    const again = createAuditLog({ db });
    const e = again.append({ kind: "resume", principal: null, subject: "kernel", outcome: "info", detail: { note: undefined, n: 1 } });
    expect(e.seq).toBe(4);
    expect(again.verify()).toBeNull();
  });

  it("lists with since, subject and limit", () => {
    const { audit } = seeded();
    expect(audit.list({ sinceSeq: 1 }).map((e) => e.seq)).toEqual([2, 3]);
    expect(audit.list({ subject: "kernel" }).map((e) => e.seq)).toEqual([3]);
    expect(audit.list({ limit: 2 }).map((e) => e.seq)).toEqual([2, 3]);
    expect(audit.list({ sinceSeq: 0, limit: 2 }).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("canonical JSON is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });
});
