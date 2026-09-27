/**
 * Nalara command line (ARCHITECTURE.md "CLI").
 *
 *   nalara serve   [--root DIR] [--port N] [--host H] [--offline] [--policy ask|auto|readonly] [--no-watch] [--no-triggers]
 *   nalara intent  "<text>" [--wait] [--root DIR] [--offline] [--policy MODE]
 *   nalara search  "<query>" [--limit N]
 *   nalara status | agents
 *   nalara halt [reason] | approvals | approve <id> | deny <id>      (talk to a running server)
 *
 * status, agents and search ask a running server first and fall back to a local kernel on the root.
 */
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, type ConfigOverrides } from "./kernel/config";
import { createKernel, type NeuralKernel } from "./kernel/kernel";
import type { AgentDefinition, ApprovalRequest, KernelStatus, SearchHit, ToolPolicy, Workspace } from "./kernel/types";
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
