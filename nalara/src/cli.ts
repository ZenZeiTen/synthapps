/**
 * Nalara command line (ARCHITECTURE.md "CLI").
 *
 *   nalara serve   [--root DIR] [--port N] [--host H] [--offline] [--policy ask|auto|readonly] [--no-watch] [--no-triggers]
 *   nalara intent  "<text>" [--wait] [--root DIR] [--offline] [--policy MODE]
 *   nalara search  "<query>" [--limit N]
 *   nalara status | agents
 *   nalara halt [reason] | approvals | approve <id> | deny <id>      (talk to a running server)
 *   nalara tree <workspaceId> | observatory | queue
 *   nalara secret set <NAME> | secret list | secret delete <NAME>    (value read from stdin, never from argv)
 *
 * status, agents and search ask a running server first and fall back to a local kernel on the root.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, type ConfigOverrides } from "./kernel/config";
import { createKernel, type NeuralKernel, type Observatory, type WorkQueue } from "./kernel/kernel";
import { createSecretStore, type SecretInfo } from "./kernel/secrets";
import type { FleetTree } from "./fleet/store";
import type { AgentDefinition, ApprovalRequest, FleetNode, KernelStatus, SearchHit, StepReview, ToolPolicy, Workspace } from "./kernel/types";
import { createHttpServer } from "./server/http";

const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

const HELP = `Nalara: an AI-native operating system. Intent in, agent swarm and workspace out.

Usage: nalara <command> [options]

Commands:
  serve                   Start the kernel and the Nalara UI at http://127.0.0.1:7437
  intent "<text>"         Turn an intent into a workspace and print the execution template
                            --wait     run the plan and print the Commander summary and top findings
  search "<query>"        Find project files by meaning (--limit N)
  status                  Kernel status
  agents                  The agent catalog
  halt [reason]           Kill switch on a running server: stop all agents, deny all non-read tools
  resume                  Lift the kill switch on a running server
  approvals               List pending tool approvals on a running server
  approve <id>            Approve a pending tool call on a running server
  deny <id>               Deny a pending tool call on a running server
  tree <workspaceId>      The workspace's process tree: builders, critics, rounds and verdicts
  observatory             Usage and burn per fleet, per agent and in total
  queue                   What is waiting (approvals, admissions), what is running, and who owns it
  secret set <NAME>       Store a credential (value read from stdin); reference it as \${secret:NAME}
  secret list             Secret names (values are never shown)
  secret delete <NAME>    Remove a secret

Options:
  --root DIR              Directory Nalara manages (default: current directory, or NALARA_ROOT)
  --port N                HTTP port (default 7437, or NALARA_PORT)
  --host HOST             Bind address (loopback only unless NALARA_ALLOW_REMOTE=1)
  --offline               Do not use Claude even when credentials exist
  --policy MODE           Tool policy: ask (default), auto or readonly
  --no-watch              Do not watch the root for file changes
  --no-triggers           Disable the File Changed -> Review -> QA -> Docs trigger chain
  --url URL               Server URL for halt/approvals/approve/deny (default from --host/--port)
  -h, --help              Show this help
`;

class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}

interface Parsed {
  command?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set(["root", "port", "host", "policy", "limit", "url"]);

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { args: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.flags.help = true;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).trim();
      if (eq >= 0) out.flags[name] = a.slice(eq + 1);
      else if (VALUE_FLAGS.has(name)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith("--")) throw new CliError(`--${name} needs a value`, 2);
        out.flags[name] = v;
        i++;
      } else out.flags[name] = true;
    } else if (!out.command) out.command = a;
    else out.args.push(a);
  }
  return out;
}

function overridesFrom(flags: Parsed["flags"]): ConfigOverrides {
  const o: ConfigOverrides = {};
  if (typeof flags.root === "string") o.root = flags.root;
  if (typeof flags.port === "string") {
    const port = Number(flags.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`--port must be an integer between 0 and 65535`, 2);
    o.port = port;
  }
  if (typeof flags.host === "string") o.host = flags.host;
  if (flags.offline) o.useClaude = false;
  if (typeof flags.policy === "string") {
    if (!["ask", "auto", "readonly"].includes(flags.policy)) throw new CliError(`--policy must be ask, auto or readonly`, 2);
    o.toolPolicy = { mode: flags.policy as ToolPolicy["mode"] };
  }
  if (flags.watch === false || flags["no-watch"]) o.watch = false;
  if (flags["no-triggers"]) o.triggers = false;
  return o;
}

function serverUrl(flags: Parsed["flags"]): string {
  if (typeof flags.url === "string") return flags.url.replace(/\/+$/, "");
  const cfg = loadConfig(overridesFrom(flags));
  const host = cfg.host.includes(":") ? `[${cfg.host}]` : cfg.host;
  return `http://${host}:${cfg.port}`;
}

async function callServer<T>(base: string, method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: "application/json", ...(method !== "GET" ? { "X-Nalara-Client": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CliError(`No Nalara server at ${base} (start one with: nalara serve)`, 3);
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) throw new CliError(`${res.status}: ${(parsed as { error?: string } | undefined)?.error ?? text.slice(0, 200)}`);
  return parsed as T;
}

/** Tries a running server; returns undefined when none answers. */
async function tryServer<T>(flags: Parsed["flags"], path: string): Promise<T | undefined> {
  try {
    return await callServer<T>(serverUrl(flags), "GET", path, undefined, 1500);
  } catch (err) {
    if (err instanceof CliError && err.code === 3) return undefined;
    throw err;
  }
}

async function withLocalKernel<T>(flags: Parsed["flags"], fn: (k: NeuralKernel) => Promise<T>): Promise<T> {
  const kernel = createKernel({ ...overridesFrom(flags), watch: false, triggers: false }, { resume: false });
  await kernel.start();
  try {
    return await fn(kernel);
  } finally {
    await kernel.stop();
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function agentName(k: NeuralKernel | undefined, id: string): string {
  return k?.orchestrator.definition(id)?.name ?? id;
}

/** The execution template from CLAUDE.md for one workspace. */
export function executionTemplate(ws: Workspace, name: (id: string) => string = (id) => id, extra?: { confidence?: number; source?: string }): string {
  const files = ws.files.length ? `${ws.files.length} file(s): ${ws.files.slice(0, 6).join(", ")}${ws.files.length > 6 ? ", ..." : ""}` : "no files matched";
  const plan = ws.plan.map((s) => `${s.id} ${name(s.agent)}: ${s.task}${s.dependsOn.length ? ` (after ${s.dependsOn.join(", ")})` : ""}`);
  const lines = [
    `Intent:    ${ws.label} [${ws.intent}${extra?.confidence !== undefined ? `, confidence ${extra.confidence.toFixed(2)}` : ""}${extra?.source ? `, ${extra.source}` : ""}] "${ws.text}"`,
    `Workspace: ${ws.id}; ${files}${ws.resources.length ? `; ${ws.resources.join("; ")}` : ""}`,
    `Agents:    ${ws.agents.map(name).join(", ") || "(none)"}`,
    `Tools:     ${ws.tools.join(", ") || "(none)"}`,
    `Plan:      ${plan[0] ?? "(empty)"}`,
    ...plan.slice(1).map((p) => `           ${p}`),
    `Output:    ${ws.outputDir}/report.md (Commander report) in ${ws.outputDir}`,
  ];
  return lines.join("\n");
}

function printStatus(s: KernelStatus): void {
  console.log(`Nalara ${s.version} (${s.mode}${s.mode === "claude" ? `, ${s.model}` : ""})${s.halted ? "  HALTED" : ""}`);
  console.log(`Root:        ${s.root}${s.projectName ? ` (${s.projectName})` : ""}`);
  console.log(`Graph:       ${s.graph.nodes} nodes, ${s.graph.edges} edges; ${s.files} files indexed`);
  console.log(`Agents:      ${s.agents.catalog} in catalog, ${s.agents.running} running`);
  console.log(`Workspaces:  ${s.workspaces.total} total, ${s.workspaces.running} running`);
  console.log(`MCP:         ${s.mcp.length ? s.mcp.map((m) => `${m.name} (${m.status})`).join(", ") : "none"}`);
  console.log(`Policy:      ${s.toolPolicy}; ${s.pendingApprovals} approval(s) pending`);
  console.log(`Governor:    ${s.governor.running}/${s.governor.lanes} lanes busy, ${s.governor.queued} queued, circuit ${s.governor.circuit}`);
  console.log(`Audit:       ${s.audit.entries} entries, chain ${s.audit.chainOk ? "intact" : "BROKEN"}`);
}

function printApproval(a: ApprovalRequest): void {
  console.log(`${a.id}  ${a.tool}  ${a.action}/${a.reversibility}/${a.scope}  by ${a.principal.chain.join(" > ")}  ${a.createdAt}`);
  const input = JSON.stringify(a.input);
  if (input && input !== "{}") console.log(`    input: ${input.length > 200 ? `${input.slice(0, 200)}...` : input}`);
}

// ---------------------------------------------------------------------------
// Fleet output
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function renderTree(tree: FleetTree & { reviews?: StepReview[] }): string {
  const byParent = new Map<string, FleetNode[]>();
  for (const e of tree.edges) {
    const child = tree.nodes.find((n) => n.instanceId === e.child);
    if (child) byParent.set(e.parent, [...(byParent.get(e.parent) ?? []), child]);
  }
  const lines: string[] = [`Process tree of ${tree.workspaceId}: ${tree.nodes.length} agent(s)`];
  const label = (n: FleetNode) =>
    `${n.name} [${n.role}${n.stepId ? ` ${n.stepId}` : ""}${n.round ? ` r${n.round}` : ""}] ${n.state}  ${n.instanceId}  ${n.usage.toolCalls} tool call(s)${n.summary ? `  - ${n.summary.slice(0, 80)}` : ""}`;
  const walk = (n: FleetNode, prefix: string, last: boolean, root: boolean) => {
    lines.push(`${root ? "" : `${prefix}${last ? "└─ " : "├─ "}`}${label(n)}`);
    const kids = byParent.get(n.instanceId) ?? [];
    kids.forEach((k, i) => walk(k, root ? "" : `${prefix}${last ? "   " : "│  "}`, i === kids.length - 1, false));
  };
  for (const id of tree.roots) {
    const n = tree.nodes.find((x) => x.instanceId === id);
    if (n) walk(n, "", true, true);
  }
  for (const r of tree.reviews ?? []) {
    lines.push(`Review ${r.stepId}: ${r.builderId} vs ${r.critics.join(", ")}: ${r.verdict} after ${r.rounds} round(s). ${r.reason}`);
    for (const c of r.open) lines.push(`  open: ${c.finding.severity} ${c.finding.title}${c.finding.file ? ` (${c.finding.file}${c.finding.line ? `:${c.finding.line}` : ""})` : ""} by ${c.criticId}`);
  }
  return lines.join("\n");
}

export function renderObservatory(o: Observatory): string {
  const t = o.totals;
  const lines = [
    `Observatory (${o.generatedAt})`,
    `Total: ${t.workspaces} fleet(s), ${t.agents} agent run(s), ${fmtTokens(t.inputTokens)} in / ${fmtTokens(t.outputTokens)} out tokens, ${t.toolCalls} tool calls, ${t.messages} relay messages`,
    `Fleet budget per run: ${o.fleetBudget.maxAgents} agents, ${fmtTokens(o.fleetBudget.maxInputTokens)} in / ${fmtTokens(o.fleetBudget.maxOutputTokens)} out tokens, ${o.fleetBudget.maxToolCalls} tool calls, ${o.fleetBudget.maxMessages} messages`,
    `Governor: ${o.governor.running}/${o.governor.lanes} lanes busy, ${o.governor.queued} queued, circuit ${o.governor.circuit}`,
    "",
    "Fleets:",
    ...o.workspaces.map(
      (w) =>
        `  ${w.workspaceId}  ${w.status.padEnd(9)} ${w.agents} agents, ${fmtTokens(w.usage.inputTokens + w.usage.outputTokens)} tokens, ${w.usage.toolCalls} calls, ${w.messages} msgs; reviews ${w.reviews.survived} survived / ${w.reviews.unresolved} unresolved${w.fleet?.exceeded ? `; BUDGET: ${w.fleet.exceeded}` : ""}  ${w.label}`,
    ),
    "",
    "Agents:",
    ...o.agents.slice(0, 15).map((a) => `  ${a.agentId.padEnd(22)} ${a.runs} run(s), ${a.failures} failed, ${fmtTokens(a.usage.inputTokens + a.usage.outputTokens)} tokens, ${a.usage.toolCalls} calls`),
  ];
  return lines.join("\n");
}

export function renderQueue(q: WorkQueue): string {
  return [
    `Approvals waiting: ${q.approvals.length}`,
    ...q.approvals.map((a) => `  ${a.id}  ${a.tool}  requested by ${a.requestedBy}${a.workspaceId ? ` in ${a.workspaceId}` : ""}`),
    `Running: ${q.running.length} (admission: ${q.admission.running}/${q.admission.lanes} lanes, ${q.admission.queued} queued)`,
    ...q.running.map((r) => `  ${r.instanceId}  ${r.name} [${r.role ?? "worker"}${r.stepId ? ` ${r.stepId}` : ""}${r.round ? ` r${r.round}` : ""}] ${r.state}  owner ${r.owner}${r.workspaceId ? `  ${r.workspaceId}` : ""}`),
    `Workspaces waiting or running: ${q.workspaces.length}`,
    ...q.workspaces.map((w) => `  ${w.id}  ${w.status}  ${w.completedSteps}/${w.steps} steps  ${w.label}`),
  ].join("\n");
}

async function readSecretValue(name: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`Value for ${name} (input is visible; pipe it in to hide it): `)).trim();
  } finally {
    rl.close();
  }
}

async function secretCommand(parsed: Parsed): Promise<void> {
  const [sub, name] = parsed.args;
  const local = () => createSecretStore({ dataDir: loadConfig(overridesFrom(parsed.flags)).dataDir });
  const viaServer = async <T>(method: string, path: string, body?: unknown): Promise<T | undefined> => {
    try {
      return await callServer<T>(serverUrl(parsed.flags), method, path, body, 3000);
    } catch (err) {
      if (err instanceof CliError && err.code === 3) return undefined;
      throw err;
    }
  };
  if (sub === "list") {
    const list = (await viaServer<SecretInfo[]>("GET", "/api/secrets")) ?? local().list();
    if (!list.length) console.log("No secrets.");
    for (const s of list) console.log(`${s.name}  updated ${s.updatedAt}${s.redacted ? "" : "  (short: not redacted from output)"}`);
    return;
  }
  if (!name) throw new CliError(`secret ${sub ?? ""} needs a NAME`.trim(), 2);
  if (sub === "set") {
    const value = await readSecretValue(name);
    if (!value) throw new CliError("no value given", 2);
    const info = (await viaServer<SecretInfo>("PUT", `/api/secrets/${encodeURIComponent(name)}`, { value })) ?? local().set(name, value);
    console.log(`Stored ${info.name}. Reference it as \${secret:${info.name}} in mcpServers env or headers.`);
    return;
  }
  if (sub === "delete") {
    const r = await viaServer<{ ok: boolean }>("DELETE", `/api/secrets/${encodeURIComponent(name)}`);
    const ok = r ? r.ok : local().delete(name);
    console.log(ok ? `Deleted ${name}.` : `No secret ${name}.`);
    return;
  }
  throw new CliError("usage: nalara secret set <NAME> | secret list | secret delete <NAME>", 2);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function serve(flags: Parsed["flags"]): Promise<void> {
  const kernel = createKernel(overridesFrom(flags));
  await kernel.start();
  const staticDir = existsSync(WEB_DIST) ? WEB_DIST : undefined;
  const http = createHttpServer(kernel, { ...(staticDir ? { staticDir } : {}) });
  let url: string;
  try {
    ({ url } = await http.listen());
  } catch (err) {
    await kernel.stop();
    throw new CliError(`Could not listen on ${kernel.config.host}:${kernel.config.port}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const s = kernel.status();
  console.log(`Nalara ${s.version} is running at ${url}`);
  console.log(`  root:   ${s.root}${s.projectName ? ` (${s.projectName})` : ""}`);
  console.log(`  mode:   ${s.mode === "claude" ? `Claude (${s.model})` : "offline (no Claude credentials or --offline): heuristic intents and rule-based agents"}`);
  console.log(`  model:  ${s.model}`);
  console.log(`  policy: ${s.toolPolicy}; watch ${kernel.config.watch ? "on" : "off"}; triggers ${kernel.config.triggers ? "on" : "off"}`);
  console.log(`  index:  ${s.files} files, ${s.graph.nodes} graph nodes`);
  if (!staticDir) console.log(`  ui:     not built (run npm run build); the API is available under ${url}/api`);
  if (flags.dev) console.log(`  dev:    run "npx vite --config web/vite.config.ts" for the UI with hot reload (proxied to ${url})`);
  for (const e of kernel.workflowErrors) console.log(`  warning: ${e}`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      console.log("Forced exit.");
      process.exit(1);
    }
    stopping = true;
    console.log(`\n${signal}: stopping Nalara (running plans resume on the next start)...`);
    try {
      await http.close();
      await kernel.stop();
      process.exit(0);
    } catch (err) {
      console.error(`shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await new Promise(() => undefined);
}

async function intent(parsed: Parsed): Promise<void> {
  const text = parsed.args.join(" ").trim();
  if (!text) throw new CliError('intent needs text, e.g. nalara intent "Review inventory module"', 2);
  const wait = Boolean(parsed.flags.wait);
  await withLocalKernel(parsed.flags, async (kernel) => {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const rl = interactive && wait ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
    let prompts: Promise<void> = Promise.resolve();
    const unsub = kernel.bus.subscribe("tool.approval_requested", (event) => {
      const a = (event.data as { approval?: ApprovalRequest }).approval;
      if (!a) return;
      if (!rl) {
        console.log(`  approval needed for ${a.tool} (${a.reversibility}): denied, no one to approve in this terminal. Use --policy or the server's approvals.`);
        kernel.resolveApproval(a.id, false);
        return;
      }
      // One question at a time.
      prompts = prompts.then(async () => {
        const answer = await rl.question(`  Approve ${a.tool} (${a.action}/${a.reversibility}) requested by ${a.principal.chain.join(" > ")}? [y/N] `);
        kernel.resolveApproval(a.id, /^y(es)?$/i.test(answer.trim()));
      });
    });
    try {
      const classification = await kernel.intents.classify(text);
      const { workspace, done } = await kernel.submitIntent(text, { run: wait });
      console.log(executionTemplate(workspace, (id) => agentName(kernel, id), { confidence: classification.confidence, source: classification.source }));
      if (kernel.llm === null) console.log("\n(offline mode: heuristic intent engine and rule-based agents)");
      if (!wait) {
        console.log(`\nWorkspace ${workspace.id} is ready. Run it with --wait, or from the canvas.`);
        return;
      }
      console.log("\nRunning...");
      const final = await done;
      const report = final.report;
      console.log(`\nStatus:    ${final.status}${final.error ? ` (${final.error})` : ""}`);
      if (report) {
        console.log(`\nCommander summary:\n${report.summary}`);
        if (report.findings.length) {
          console.log(`\nTop findings (${report.findings.length} total):`);
          for (const f of report.findings.slice(0, 10)) console.log(`  [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
        }
        if (report.conflicts.length) console.log(`\nConflicts resolved: ${report.conflicts.length}`);
        if (report.artifactPath) console.log(`\nReport: ${report.artifactPath}`);
      }
      if (final.status !== "completed") process.exitCode = 1;
    } finally {
      unsub();
      rl?.close();
    }
  });
}

async function search(parsed: Parsed): Promise<void> {
  const q = parsed.args.join(" ").trim();
  if (!q) throw new CliError('search needs a query, e.g. nalara search "combat code"', 2);
  const limit = typeof parsed.flags.limit === "string" ? Number(parsed.flags.limit) : 10;
  if (!Number.isInteger(limit) || limit < 1) throw new CliError("--limit must be a positive integer", 2);
  const hits =
    (await tryServer<SearchHit[]>(parsed.flags, `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`)) ??
    (await withLocalKernel(parsed.flags, async (k) => k.index.search(q, { limit })));
  if (!hits.length) {
    console.log("No results.");
    return;
  }
  for (const h of hits) {
    console.log(`${h.score.toFixed(2)}  ${h.path}${h.line ? `:${h.line}` : ""}  [${h.kind}]`);
    if (h.reasons.length) console.log(`      ${h.reasons.join("; ")}`);
    if (h.snippet) console.log(`      ${h.snippet.replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

async function status(parsed: Parsed): Promise<void> {
  const s = (await tryServer<KernelStatus>(parsed.flags, "/api/status")) ?? (await withLocalKernel(parsed.flags, async (k) => k.status()));
  printStatus(s);
}

async function agents(parsed: Parsed): Promise<void> {
  const list = (await tryServer<AgentDefinition[]>(parsed.flags, "/api/agents")) ?? (await withLocalKernel(parsed.flags, async (k) => k.orchestrator.catalog()));
  const groups = new Map<string, AgentDefinition[]>();
  for (const a of list) groups.set(a.group, [...(groups.get(a.group) ?? []), a]);
  for (const [group, defs] of groups) {
    console.log(`${group[0].toUpperCase()}${group.slice(1)}`);
    for (const d of defs) console.log(`  ${d.id.padEnd(22)} ${d.name.padEnd(22)} ${d.role}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (parsed.flags.help || !parsed.command || parsed.command === "help") {
    console.log(HELP);
    return parsed.command || parsed.flags.help ? 0 : 2;
  }
  try {
    switch (parsed.command) {
      case "serve":
        await serve(parsed.flags);
        return 0;
      case "intent":
        await intent(parsed);
        return typeof process.exitCode === "number" ? process.exitCode : 0;
      case "search":
        await search(parsed);
        return 0;
      case "status":
        await status(parsed);
        return 0;
      case "agents":
        await agents(parsed);
        return 0;
      case "halt": {
        const reason = parsed.args.join(" ").trim() || "halted from the CLI";
        const s = await callServer<KernelStatus>(serverUrl(parsed.flags), "POST", "/api/kernel/halt", { reason });
        console.log(`Halted: ${reason}. All agents stopped; only read tools run until "nalara resume".`);
        printStatus(s);
        return 0;
      }
      case "resume": {
        const s = await callServer<KernelStatus>(serverUrl(parsed.flags), "POST", "/api/kernel/resume", {});
        console.log("Resumed.");
        printStatus(s);
        return 0;
      }
      case "approvals": {
        const list = await callServer<ApprovalRequest[]>(serverUrl(parsed.flags), "GET", "/api/approvals?status=pending");
        if (!list.length) console.log("No pending approvals.");
        for (const a of list) printApproval(a);
        return 0;
      }
      case "approve":
      case "deny": {
        const id = parsed.args[0];
        if (!id) throw new CliError(`${parsed.command} needs an approval id (see: nalara approvals)`, 2);
        const a = await callServer<ApprovalRequest>(serverUrl(parsed.flags), "POST", `/api/approvals/${encodeURIComponent(id)}`, { approved: parsed.command === "approve" });
        console.log(`${a.id} ${a.status}: ${a.tool}`);
        return 0;
      }
      case "tree": {
        const id = parsed.args[0];
        if (!id) throw new CliError("tree needs a workspace id (see: nalara status, or the UI)", 2);
        const path = `/api/workspaces/${encodeURIComponent(id)}/tree`;
        const tree = (await tryServer<FleetTree & { reviews: StepReview[] }>(parsed.flags, path)) ?? (await withLocalKernel(parsed.flags, async (k) => k.fleetTree(id)));
        console.log(renderTree(tree));
        return 0;
      }
      case "observatory": {
        const o = (await tryServer<Observatory>(parsed.flags, "/api/observatory")) ?? (await withLocalKernel(parsed.flags, async (k) => k.observatory()));
        console.log(renderObservatory(o));
        return 0;
      }
      case "queue": {
        const q = (await tryServer<WorkQueue>(parsed.flags, "/api/queue")) ?? (await withLocalKernel(parsed.flags, async (k) => k.workQueue()));
        console.log(renderQueue(q));
        return 0;
      }
      case "secret":
        await secretCommand(parsed);
        return 0;
      default:
        console.error(`Unknown command "${parsed.command}".\n`);
        console.log(HELP);
        return 2;
    }
  } catch (err) {
    console.error(`nalara: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof CliError ? err.code : 1;
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
