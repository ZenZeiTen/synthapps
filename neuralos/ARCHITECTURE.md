# NeuralOS runtime architecture

How the specification in [DESIGN.md](DESIGN.md) maps to code. The contracts
every module implements are in [`src/kernel/types.ts`](src/kernel/types.ts);
the HTTP API is in [`src/server/api-contract.ts`](src/server/api-contract.ts).

## Stack

- Node.js 22.13+ and TypeScript, run with `tsx` (no build step for the server).
- Storage: SQLite through the built-in `node:sqlite` module, one file at
  `<dataDir>/neuralos.db`. No external database, graph server or broker.
- Claude: `@anthropic-ai/sdk`. Without credentials the kernel runs in
  **offline mode**: a heuristic Intent Engine and rule-based agent skills.
  Offline agents say plainly what they could not do (for example, translation).
- MCP: `@modelcontextprotocol/sdk` client, stdio and Streamable HTTP servers.
- UI: React 19 + `@xyflow/react` (React Flow), built with Vite into `web/dist`.
- Tests: Vitest (unit and integration), Playwright Core against the
  pre-installed Chromium (end to end).

Platform safety (the enforcement point, reversibility classes, identity,
budgets, kill switch, checkpoints) is designed in [SAFETY.md](SAFETY.md).

The spec's suggested infrastructure (Neo4j, NATS, Qdrant) is replaced by
in-process equivalents behind the same interfaces, so the whole OS runs from one
`npm start`. Each interface can later get a networked implementation.

## Module map

| Spec component | Module | Factory |
|---|---|---|
| Event bus (10) | `src/events/bus.ts` | `createEventBus({ db?, maxHistory? })` |
| Event triggers (10) | `src/events/triggers.ts` | `createTriggerEngine({ bus, executor, rules? })`, `DEFAULT_TRIGGER_RULES` |
| Knowledge Graph Engine (3.4) | `src/graph/store.ts` | `createKnowledgeGraph({ db, bus? })` |
| Memory Service (3.5) | `src/memory/service.ts` | `createMemoryService({ db, bus? })` |
| Memory Agent | `src/memory/agent.ts` | `attachMemoryAgent({ bus, memory, graph })`, `seedMemoryFromRoot({ root, memory })` |
| Semantic filesystem (9) | `src/search/index.ts` | `createSemanticIndex({ root, graph, bus? })` |
| File watcher | `src/search/watcher.ts` | `createFileWatcher({ root, index, bus, debounceMs? })` |
| Governor: admission, budgets, AIMD, loop detection | `src/agents/governor.ts` | `createGovernor({ maxLanes, bus?, audit? })` |
| Audit ledger | `src/kernel/audit.ts` | `createAuditLog({ db })` |
| Action journal (undo) | `src/kernel/journal.ts` | `createActionJournal({ db, root, bus? })` |
| Tools layer + policy (8) | `src/tools/registry.ts` | `createToolRegistry({ bus, audit, governor?, policy?, maxDelegationDepth? })` |
| Built-in tools | `src/tools/builtin.ts` | `registerBuiltinTools({ registry, root, index, memory, journal, outputDirFor, testCommand?, deployCommand? })` |
| MCP client (8) | `src/tools/mcp.ts` | `createMcpManager({ registry, graph, bus })` |
| Claude provider | `src/llm/anthropic.ts` | `createAnthropicProvider({ model, effort, client? })`, `hasClaudeCredentials(env?)` |
| Test double for Claude | `src/llm/scripted.ts` | `createScriptedProvider(options)` |
| Intent Engine (3.1) | `src/intent/engine.ts`, `src/intent/catalog.ts` | `createIntentEngine({ llm, index, memory, tools, bus, agents })` |
| Agent catalog (6) | `src/agents/catalog.ts` | `AGENT_CATALOG`, `AGENT_ALIASES`, `findAgent()` |
| Offline agent skills | `src/agents/skills/*.ts` | `runOfflineSkill(name, ctx)` in `src/agents/skills/index.ts` |
| Agent Orchestrator + Scheduler + Commander (3.2) | `src/agents/orchestrator.ts`, `src/agents/commander.ts` | `createOrchestrator({ bus, graph, memory, tools, llm, index, root, maxConcurrent, getWorkspace })` |
| Workspace Generator (3.3) | `src/workspace/generator.ts` | `createWorkspaceGenerator({ db, graph, bus, root, dataDir, index, memory })` |
| Radial OS (5) | `src/kernel/radial.ts` | used by the kernel |
| Workflows | `src/kernel/workflows.ts` | loads `<root>/.neuralos/workflows/*.json` plus built-ins |
| Config | `src/kernel/config.ts` | `loadConfig(overrides)` |
| Kernel (composition root) | `src/kernel/kernel.ts` | `createKernel(config, deps?)` |
| HTTP + SSE server | `src/server/http.ts` | `createHttpServer(kernel, { staticDir? })` |
| CLI | `src/cli.ts` | `neuralos serve \| intent \| search \| status \| agents` |
| Neural Canvas UI (4, 5) | `web/` | Vite app |

## Conventions

- ESM TypeScript, extensionless relative imports (`import { x } from "../kernel/types"`).
- Every SQLite-backed module creates its own tables (`CREATE TABLE IF NOT EXISTS`)
  with a module prefix (`graph_nodes`, `memory_records`, `events`, `workspaces`).
- Paths passed between modules are relative to the kernel root with forward
  slashes. Any path from a user or model is resolved and rejected if it leaves
  the root.
- Graph node ids: `file:<path>`, `folder:<path>`, `concept:<slug>`,
  `agent:<agentId>`, `mcp:<server>` (servers; built-in tool groups are
  `mcp:builtin-fs`, `mcp:builtin-git`, ...), `workspace:<id>`, `project:<slug>`,
  `workflow:<id>`, `output:<path>`, `memory:<id>`.
- Timestamps are ISO strings from `nowIso()`; ids from `newId(prefix)`
  (`src/kernel/ids.ts`).
- Components publish events through the bus and never import each other's
  internals: only the kernel wires modules together.
- Tests live in `test/<module>.test.ts` and use `:memory:` databases and
  temporary directories.
