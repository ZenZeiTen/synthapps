# Nalara platform safety design

Nalara runs many agents side by side, so the rules that keep it safe must
live in the platform, not in prompts. This document applies the
agent-os-architect checklist (13 primitives, tool register) and the
delegation gate from autonomy-delegation-patterns. Contracts are in
[`src/kernel/types.ts`](src/kernel/types.ts).

Labels: **Fact** = stated by the spec or the code contract. **Inference** =
concluded from those. **Assumption** = chosen here, to revisit.

The agent-os-architect skill ships a spec checker (`agentos_check.py`) that was
not present in the installed copy of the skill, so that step was not run.

## 1. Tenants

| Tenant | Model | Tools | Data | Acts for |
|---|---|---|---|---|
| 27 catalog agents (5 system, 8 engineering, 9 creative, 4 business, plus Planner and Documentation) | Claude (`claude-opus-5` default) or offline skills | per-agent tool globs | project files under the root, memory, graph | the local user (**Fact**: single-user kernel) |
| Trigger engine | none | spawns agents | events | the user, via configured rules |
| MCP servers | n/a | their own tools | external systems | the user (credentials from the secret store, filled in at connect time) |
| Human user | n/a | HTTP API / CLI / UI | everything | self |

**Assumption:** one human user per kernel. Multi-user tenancy is out of scope.

## 2. Enforcement point

```
 agent loop (Claude or offline skill)
      │  model call                     │  tool call                       │ memory write
      ▼                                 ▼                                  ▼
 ┌──────────────┐               ┌──────────────────────────────┐    memory.remember tool
 │   Governor   │◀── charge ────│  ToolRegistry (gateway)      │──▶ (status "proposed")
 │ lanes, AIMD, │               │ halted? disabled? principal? │
 │ budgets,     │               │ scope? deny/allow? policy &  │
 │ loop detect  │               │ reversibility → approval?    │
 └──────┬───────┘               │ schema? replay fence?        │
        │                       └───────┬───────────┬──────────┘
        ▼                               ▼           ▼
   LLM provider                    handlers    AuditLog (append-only, hash chain)
                                   (fs, git,   ActionJournal (before-images)
                                    proc, MCP)
 Kill switch: Kernel.halt() ── HTTP /api/kernel/halt, CLI `nalara halt` (human only; no agent tool reaches it).
 Halting denies new non-read calls, denies pending approvals, and aborts non-read calls already running, whoever
 started them: process tools kill their process group, MCP calls cancel the request.
```

**Fact:** agents get no handle to the kernel, bus, graph or registry; they
receive a `callTool` function bound to their own `Principal`, and model calls go
through a metered provider bound to their instance. **Inference:** every model
call, tool call and memory write passes one of two gates.

## 3. The 13 primitives

| # | Primitive | Mechanism in Nalara | Enforced by | Status |
|---|---|---|---|---|
| 1 | Agent lifecycle | Instance = definition + principal + budget + scope; states dormant → summoned → active → collaborating → completed/failed/terminated → archived | platform (orchestrator) | built |
| 2 | Orchestrator | Priority admission (urgent > high > normal > low, FIFO within), lane cap, AIMD on 429/529, circuit breaker, multi-dimensional budget per agent and per fleet (agents, tokens, tool calls, relay messages for one workspace run), repeat-call loop detection, zombie reaping on maxWallMs | platform (Governor) | built |
| 3 | Skills registry | Catalog is code (frozen at runtime); user agent files in `.nalara/agents/*.json` are schema-validated and hashed at load | platform | built (no signing: **Assumption** acceptable for a single-user kernel) |
| 4 | Tool mediation | ToolRegistry on every call; reversibility class and scope per tool (register below) | platform | built |
| 5 | Context management | Minimum-fidelity set pinned in the system prompt (task, constraints, file list, plan step); tool results capped at 20 000 chars; bounded turns | platform (agent loop) | partial: no paging |
| 6 | Agent-to-agent comms | No direct channel and no messaging tool. The orchestrator relays spawn, handoff, challenge, verdict and result messages through one audited, size-capped, budget-charged relay; challenges reach a builder as data, wrapped as untrusted. Outputs reach the Commander and trigger rules the same way; trigger task text comes from rule templates | platform (relay) | built |
| 7 | Agent memory | Records carry source and timestamps; agent writes are `proposed` until a human confirms; the Memory Agent stores only platform facts (status, agents, finding counts), never agent-authored text, as active memory | platform | built (no record-level ACL: single user) |
| 8 | Identity and authZ | `Principal` with delegation chain on every call; per-instance tool scope set at spawn, never inherited; depth limit `maxDelegationDepth` (default 3) | platform | built (no OAuth token exchange: all tools are local or use server-held credentials) |
| 9 | Guardrails | Deterministic rules only: deny > allow > mode × reversibility; path confinement (realpath) to the root; secrets never passed to child processes. MCP credentials live in a 0600 secret store and are written into a server's env, headers, URL or arguments only at connect time (`${secret:NAME}`); stored values are removed from tool results, events, the audit ledger and every HTTP and SSE response | platform (gateway) | built |
| 10 | Failure detection | Agent output validated against a schema; empty or zero-confidence outputs flagged by Commander; builder steps attacked by critic agents, with only evidence-checked challenges (cited file and line exist in the project) able to block; unresolved steps reported as high findings; audit ledger agents cannot write | platform | built |
| 11 | Saga and checkpoint | Workspace checkpoint after each plan step; resume skips finished steps; irreversible calls fenced by an idempotency key naming the operation (workspace, step, tool, input hash, occurrence), so a resumed step cannot repeat a deploy even if it makes other calls first; compensable writes undoable from the journal | platform | built |
| 12 | Trajectory observability | Every event carries workspace and instance ids; tool events carry the principal chain; full event history in SQLite; process tree per workspace (parent, role, step, round); Observatory (usage per fleet and agent) and work queue over HTTP, CLI and UI | platform | built |
| 13 | AI-aware proxy | MCP tools pass through the registry; tool definition hashes (name, description, schema and the derived action, reversibility and scope) recorded at connect; a changed definition, including a flipped readOnlyHint, is disabled until re-approved | platform | built |

## 4. Tool register

| Tool | Action | Reversibility | Scope | Runs without approval in `ask` (default) | in `auto` |
|---|---|---|---|---|---|
| `fs.list_files`, `fs.read_file`, `fs.search_text`, `search.semantic`, `memory.recall`, `git.status`, `git.log`, `git.diff` | read/search | reversible | tenant | yes | yes |
| `fs.write_output` (workspace output folder only) | write | reversible | sandbox | yes | yes |
| `memory.remember` (creates a proposed record) | write | reversible | tenant | yes | yes |
| `fs.write_file` (project files; never `.git`, `.nalara` or `nalara.config.json`, also through symlinks) | write | compensable (journaled) | tenant | **approval** | yes |
| `proc.run_tests` (runs project code) | execute | irreversible | tenant | **approval** | **approval** |
| `proc.deploy` | execute | irreversible | external | **approval** | **approval** |
| MCP tool with `readOnlyHint: true` | read | reversible | external | yes | yes |
| any other MCP tool | write/execute | irreversible | external | **approval** | **approval** |

Every approval shows the tool's own description of the concrete call where its
input alone would not say what happens: `proc.run_tests` and `proc.deploy` show
the exact command, working directory, environment rule and time limit.

`readonly` mode runs only the reversible read/search rows. Deny globs beat
everything; allow globs can pre-approve a tool (for example
`proc.run_tests` in a trusted repo) and that choice is written to the audit
ledger.

## 5. Delegation gate

| Question | `fs.write_file` | `proc.run_tests` / `proc.deploy` / MCP writes | Trigger chains (File Changed → Review → QA → Docs) | Memory writes by agents |
|---|---|---|---|---|
| Reversibility | Journal before-image; undo refuses if the file changed since | None: approval required in every mode | Agents in the chain are read-only plus `fs.write_output` | Proposed until confirmed |
| Interruption | `halt()` outside the agent action space | same | `halt()` pauses triggers | n/a |
| Scope | Only agents whose definition lists it (Fullstack Engineer) | Only QA / DevOps / Fullstack definitions | Each hop gets its own definition's scope; depth ≤ 3; outputs never become new intents | Tool scope per definition |
| Provenance | Catalog in code; user agents hashed | MCP tool hashes | Rules are config, audited on change | Source recorded per record |
| Budget | Governor per instance | Test/deploy timeout (default 10 min), output capped | Debounce per path (1.5 s) and depth limit bound the fan-out | n/a |
| Detection | Audit ledger + journal | Audit ledger | trigger.fired events with chain | memory.updated events |

**Patterns in play:** 1 (frozen weights: proposed memory), 2 (halt outside
the action space), 5 (budgets), 8 (no scope inheritance, depth limit),
10 (tool output and file contents are data), 11 (prompts give the reason for
each constraint, but the registry enforces it).

**Cost accepted:** approvals add friction on every test run and deploy, and
agents cannot learn across runs until a human confirms their memory.

## 6. Known gaps

- **No OS-level isolation.** Agents run in the kernel's Node.js process;
  `proc.*` tools run child processes with a scrubbed environment, a timeout and
  the root as cwd, but without namespaces or cgroups. Do not point Nalara at
  code you would not run yourself.
- **Secrets are stored in plain text** in `<dataDir>/secrets.json` (mode
  0600), not in an OS keychain. Values shorter than 6 characters are not
  redacted from output. An MCP server receives the resolved value; what it
  does with it is up to that server.
- **Evidence checks are structural.** A critic's finding counts as verified
  when the cited file and line exist, not when the claim is true. A wrong but
  well-cited high finding can still send a builder back for another round, at
  most `maxRounds` times.
- **No context paging.** Long agent runs are bounded by turns and result caps
  instead.
- **Chaos tests** (stale memory, tool failure, crash and resume, injected
  instructions in a file) are in the test suite; there is no continuous
  drift monitoring.
