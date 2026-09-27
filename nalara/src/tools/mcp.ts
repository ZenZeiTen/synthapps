/**
 * MCP client manager (DESIGN.md 8, SAFETY.md primitive 13). Every MCP tool is registered in the ToolRegistry
 * as `mcp.<server>.<tool>`, so it passes the same gates as the built-ins. Tool definition hashes are pinned
 * at first connect; a tool whose definition later changes is disabled until re-approved.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type {
  EventBus,
  JsonSchemaObject,
  KnowledgeGraph,
  McpManager,
  McpServerConfig,
  McpServerStatus,
  ToolAction,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from "../kernel/types";

export interface McpManagerOptions {
  registry: ToolRegistry;
  graph: KnowledgeGraph;
  bus: EventBus;
  /** Tool name (`mcp.<server>.<tool>`) -> hash approved earlier, e.g. persisted by the kernel. */
  approvedHashes?: Record<string, string>;
  /** Connect + first tool listing. Default 30 s. */
  connectTimeoutMs?: number;
}

export interface NeuralMcpManager extends McpManager {
  /** The pinned definition hashes (for persistence). */
  approvedHashes(): Record<string, string>;
  /** Human re-approval of a changed tool: pins its current hash and re-enables it. */
  reapprove(toolName: string): boolean;
}

interface Connection {
  name: string;
  client: Client;
  transport: Transport;
  status: McpServerStatus;
  /** registry name -> the server's own tool name */
  tools: Map<string, string>;
  closing: boolean;
  stderrTail: string;
}

const MAX_PAGES = 50;

export function sanitizeToolSegment(s: string): string {
  const clean = s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean || "_";
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp.${sanitizeToolSegment(server)}.${sanitizeToolSegment(tool)}`;
}

/** SAFETY.md section 4: only tools the server marks read-only run without approval. */
export function classifyMcpTool(tool: Pick<McpTool, "name" | "annotations">): { action: ToolAction; reversibility: "reversible" | "irreversible" } {
  if (tool.annotations?.readOnlyHint === true) {
    return { action: /search|query|find/i.test(tool.name) ? "search" : "read", reversibility: "reversible" };
  }
  return { action: /run|exec|deploy/i.test(tool.name) ? "execute" : "write", reversibility: "irreversible" };
}

/** Minimal environment for stdio servers: never the parent's secrets. */
function serverEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME"]) if (process.env[key]) env[key] = process.env[key]!;
  for (const [key, value] of Object.entries(extra ?? {})) if (!/^ANTHROPIC_/i.test(key)) env[key] = value;
  return env;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createMcpManager(opts: McpManagerOptions): NeuralMcpManager {
  const { registry, graph, bus } = opts;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30_000;
  const approved = new Map<string, string>(Object.entries(opts.approvedHashes ?? {}));
  const connections = new Map<string, Connection>();
  const statuses = new Map<string, McpServerStatus>();

  function publish(type: "mcp.connected" | "mcp.disconnected" | "kernel.log", data: Record<string, unknown>): void {
    try {
      bus.publish(type, data, { source: "mcp" });
    } catch {
      // Never let the bus break the connection lifecycle.
    }
  }

  function updateGraph(status: McpServerStatus): void {
    try {
      graph.upsertNode({
        id: `mcp:${status.name}`,
        type: "mcp",
        name: status.name,
        props: { transport: status.transport, tools: status.tools, status: status.status, error: status.error, changedTools: status.changedTools ?? [] },
      });
    } catch {
      // The graph is a view; a failure here must not fail the connection.
    }
  }

  function setStatus(status: McpServerStatus): McpServerStatus {
    statuses.set(status.name, status);
    updateGraph(status);
    return { ...status };
  }

  function unregisterAll(conn: Connection): void {
    for (const name of conn.tools.keys()) registry.unregister(name);
    conn.tools.clear();
  }

  function handlerFor(conn: Connection, remoteName: string) {
    return async (input: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<ToolResult> => {
      if (connections.get(conn.name) !== conn || conn.status.status !== "connected") {
        return { ok: false, content: `MCP server ${conn.name} is not connected`, error: "not connected" };
      }
      const result = await conn.client.callTool({ name: remoteName, arguments: input }, undefined, { signal: ctx.signal });
      const blocks = Array.isArray(result.content) ? (result.content as { type: string; text?: string; uri?: string; resource?: { uri?: string } }[]) : [];
      const text = blocks
        .map((b) => (b.type === "text" ? (b.text ?? "") : b.type === "resource" ? `[resource ${b.resource?.uri ?? ""}]` : b.type === "resource_link" ? `[resource ${b.uri ?? ""}]` : `[${b.type}]`))
        .join("\n");
      const data = result.structuredContent ?? (blocks.length ? undefined : result.toolResult);
      if (result.isError) return { ok: false, content: text || "MCP tool reported an error", error: text || "MCP tool error", data };
      return { ok: true, content: text, data };
    };
  }

  async function listAllTools(client: Client): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...res.tools);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** (Re)registers the server's tools and applies the drift check against the pinned hashes. */
  function syncTools(conn: Connection, list: McpTool[]): string[] {
    unregisterAll(conn);
    const changed: string[] = [];
    for (const tool of list) {
      const name = mcpToolName(conn.name, tool.name);
      if (conn.tools.has(name)) continue; // two remote names sanitized to the same local name: keep the first
      const { action, reversibility } = classifyMcpTool(tool);
      const inputSchema = { ...(tool.inputSchema ?? {}), type: "object" } as JsonSchemaObject;
      const def: ToolDefinition = {
        name,
        description: tool.description ?? tool.title ?? tool.name,
        server: `mcp:${conn.name}`,
        action,
        reversibility,
        scope: "external",
        inputSchema,
      };
      try {
        registry.register(def, handlerFor(conn, tool.name));
      } catch (err) {
        publish("kernel.log", { level: "warn", message: `MCP ${conn.name}: could not register ${name}: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      conn.tools.set(name, tool.name);
      const hash = registry.get(name)?.hash ?? "";
      const pinned = approved.get(name);
      if (pinned === undefined) approved.set(name, hash);
      else if (pinned !== hash) {
        registry.setDisabled(name, true, "definition changed since approval");
        changed.push(name);
      }
    }
    return changed;
  }

  async function refresh(conn: Connection): Promise<void> {
    if (connections.get(conn.name) !== conn || conn.status.status !== "connected") return;
    try {
      const list = await listAllTools(conn.client);
      const changedTools = syncTools(conn, list);
      conn.status = { ...conn.status, tools: [...conn.tools.keys()], changedTools };
      setStatus(conn.status);
      publish("mcp.connected", { name: conn.name, transport: conn.status.transport, tools: conn.status.tools, changedTools, refreshed: true });
    } catch (err) {
      publish("kernel.log", { level: "warn", message: `MCP ${conn.name}: tool list refresh failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function onClosed(conn: Connection): void {
    if (conn.closing || connections.get(conn.name) !== conn) return;
    connections.delete(conn.name);
    unregisterAll(conn);
    conn.status = { ...conn.status, status: "disconnected", tools: [], error: conn.stderrTail ? `server exited: ${conn.stderrTail.trim().slice(-500)}` : "server closed the connection" };
    setStatus(conn.status);
    publish("mcp.disconnected", { name: conn.name, reason: conn.status.error });
  }

  async function disconnect(name: string): Promise<void> {
    const conn = connections.get(name);
    if (!conn) return;
    conn.closing = true;
    connections.delete(name);
    unregisterAll(conn);
    try {
      await conn.client.close();
    } catch {
      // Already closed.
    }
    conn.status = { ...conn.status, status: "disconnected", tools: [] };
    setStatus(conn.status);
    publish("mcp.disconnected", { name, reason: "disconnected" });
  }

  async function connect(name: string, config: McpServerConfig): Promise<McpServerStatus> {
    await disconnect(name);
    const transportKind: McpServerStatus["transport"] = config.command ? "stdio" : "http";
    const base: McpServerStatus = { name, status: "connecting", transport: transportKind, tools: [] };
    setStatus(base);

    const error = (message: string): McpServerStatus => {
      const status = setStatus({ ...base, status: "error", error: message });
      publish("kernel.log", { level: "warn", message: `MCP ${name}: ${message}` });
      return status;
    };

    if (!config.command && !config.url) return error("config needs either command (stdio) or url (http)");

    let transport: Transport;
    let stdio: StdioClientTransport | undefined;
    try {
      if (config.command) {
        stdio = new StdioClientTransport({ command: config.command, args: config.args ?? [], env: serverEnv(config.env), cwd: config.cwd, stderr: "pipe" });
        transport = stdio;
      } else {
        transport = new StreamableHTTPClientTransport(new URL(config.url!), { requestInit: { headers: config.headers ?? {} } });
      }
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }

    const client = new Client({ name: "nalara", version: "0.1.0" }, { capabilities: {} });
    const conn: Connection = { name, client, transport, status: base, tools: new Map(), closing: false, stderrTail: "" };
    stdio?.stderr?.on("data", (chunk: Buffer) => {
      conn.stderrTail = (conn.stderrTail + chunk.toString("utf8")).slice(-2000);
    });
    client.onclose = () => onClosed(conn);
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      void refresh(conn);
    });

    try {
      await withTimeout(client.connect(transport), connectTimeoutMs, "connect");
      connections.set(name, conn);
      const list = await withTimeout(listAllTools(client), connectTimeoutMs, "tools/list");
      const changedTools = syncTools(conn, list);
      conn.status = { name, status: "connected", transport: transportKind, tools: [...conn.tools.keys()], connectedAt: new Date().toISOString(), changedTools };
      setStatus(conn.status);
      publish("mcp.connected", { name, transport: transportKind, tools: conn.status.tools, changedTools });
      return { ...conn.status };
    } catch (err) {
      conn.closing = true;
      connections.delete(name);
      unregisterAll(conn);
      try {
        await client.close();
      } catch {
        // Nothing to close.
      }
      const message = err instanceof Error ? err.message : String(err);
      const stderr = conn.stderrTail.trim();
      return error(stderr ? `${message} (stderr: ${stderr.slice(-500)})` : message);
    }
  }

  return {
    connect,
    disconnect,
    status() {
      return [...statuses.values()].map((s) => ({ ...s, tools: [...s.tools], changedTools: s.changedTools ? [...s.changedTools] : undefined }));
    },
    async closeAll() {
      await Promise.all([...connections.keys()].map((name) => disconnect(name)));
    },
    approvedHashes() {
      return Object.fromEntries(approved);
    },
    reapprove(toolName) {
      const def = registry.get(toolName);
      if (!def?.hash || !def.server.startsWith("mcp:")) return false;
      approved.set(toolName, def.hash);
      registry.setDisabled(toolName, false);
      for (const status of statuses.values()) {
        if (status.changedTools?.includes(toolName)) setStatus({ ...status, changedTools: status.changedTools.filter((t) => t !== toolName) });
      }
      for (const conn of connections.values()) {
        if (conn.status.changedTools?.includes(toolName)) conn.status = statuses.get(conn.name)!;
      }
      return true;
    },
  };
}
