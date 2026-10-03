# Orc agentic OS: what Nalara had, what it has now, what is still missing

Source: the public page <https://orc.ai/agentic-os> ("Orc — The agentic
operating system"), read on 2026-10-03. Only what the page states is used
below. The page is a pitch deck, so it describes intent and architecture, not
code; where it gives no detail, this document does not guess.

Labels: **Built** = implemented and covered by tests in this repository.
**Partial** = some of it exists. **Gap** = not implemented.

## 1. Process tree and adversarial fleets (Orc section 1)

| Orc element | Before | Now | Status |
|---|---|---|---|
| Process tree: "every agent a node, every handoff an edge, the whole tree owned and audited by the kernel" | Instances had a delegation chain, but no stored parent link or tree view | Every instance stores its parent, role (`worker`, `builder`, `critic`, `commander`, `triggered`), plan step and round in `fleet_nodes`. `GET /api/workspaces/:id/tree`, `nalara tree <id>`, and the UI's Fleet panel (Results → *Process tree*) | Built |
| Spawn → Build → Attack → Converge → one result, looping "between build and attack until the work survives its critics" | Plan steps ran once; the Commander merged outputs | Builder steps are attacked by critic agents spawned as their children. Blocking challenges send the builder into a new round, up to `maxRounds` (default 3). Each step ends `survived`, `unresolved` or `unreviewed`; unresolved work becomes a high finding in the report | Built |
| "Disagreements are resolved through evidence and review gates, and every challenge and resolution lands in the audit log" | No evidence check | A critic finding blocks only if its severity is at or above the threshold, it cites this step's own artifact, and the cited file and line exist inside the project. Every challenge is a relay message (audited); every verdict is an audit entry (`kind: "verdict"`) | Built. The evidence check is structural: it proves the citation exists, not that the claim is true |
| Inter-agent messaging as a kernel primitive: "spawns, handoffs, challenges, and verdicts travel as first-class messages with identity attached, and agents cannot bypass it. Every hop is scheduled, budgeted, and audited" | Agents had no channel at all (outputs reached the Commander as data) | `src/fleet/relay.ts`: one SQLite-backed relay. Five message kinds (spawn, handoff, challenge, verdict, result), sender and receiver identity, size caps, an audit entry and a `relay.message` event per hop, charged to the fleet message budget. Agents still have no tool to send one; only the orchestrator does | Built. Deliberately narrower than Orc: agents cannot message each other directly |
| "Compiled messaging layer: milliseconds" | n/a | In-process TypeScript and SQLite | Gap (by choice: there is no compiled core, see section 5) |
| Fleet memory: "Spawn a fleet tomorrow and it starts from what the last one proved" | Memory service with proposed/active records; the Memory Agent stored platform facts | After each reviewed step a fleet record (verdict, rounds, open challenges, files) is stored. Later agents working on those files get the open records in a pinned "Fleet memory" block. `GET /api/fleet/records?file=` | Built |
| "Budgets per fleet" | Budgets per agent instance | Per-run fleet budget (agents, input and output tokens, tool calls, relay messages), reset on each workspace run; overrun stops the run with a `fleet budget: ...` reason and an audit entry | Built. Set in `nalara.config.json` (`fleetBudget`), not yet in the Settings panel |

## 2. Kernel, system interface, universal surfaces (Orc section 2)

| Orc element | Nalara now | Status |
|---|---|---|
| Kernel: identity, task results and cancellation, governance, relay, durable memory, process supervision, provider and tool gateway, event and audit records | Principals and delegation chains, terminate and halt, tool policy and approvals, the relay, the memory service, the Governor, the tool registry, the event bus and hash-chained audit ledger | Built |
| Artifact storage and lineage | Workspace output folders, the action journal (before-images), fleet records linking verdicts to files | Partial: no general artifact store with lineage graph |
| Recovery, replay and migrations | Checkpoints per plan step, resume after restart, replay fences on irreversible calls; tables created with `IF NOT EXISTS` | Partial: no schema migrations |
| Configuration and secrets | `nalara.config.json`, environment; **new** secret store (`src/kernel/secrets.ts`) | Built |
| Version and feature negotiation | **New** `GET /api/version` (API version, supported versions, feature list); every response carries `X-Nalara-Api-Version`; a request with an unsupported version gets 400 | Built |
| Structured errors | **New**: every error is `{ error, code }` with a stable code (`not_found`, `kernel_halted`, `idempotency_conflict`, ...) | Built |
| Idempotency and pagination | **New** `Idempotency-Key` on mutating requests: same key and body replays the first response; same key, different body gets 422. Lists take `limit` and `since` | Idempotency built; pagination partial (no cursors) |
| Snapshot, backfill and reconnect | SSE stream replays from `since` or `Last-Event-ID` | Built |
| Authentication and client identity | Binds to 127.0.0.1; mutating requests need `X-Nalara-Client: 1`; no authentication | Gap (single-user local kernel) |
| Transport-neutral, local and over the network | HTTP on localhost only | Gap |
| Universal surfaces: work queue and tasks | **New** `GET /api/queue`, `nalara queue`, and the work queue section of the Observatory: approvals waiting, agents running with owner, workspaces waiting, lane admission | Built |
| Agents and activity; audit and history; runtime health and settings; search; memory | Agents panel, event log, audit table, governor, Settings, search, Memory panel | Built |
| Integrations and credentials | MCP panel plus **new** Secrets section | Built |
| Evidence and review | **New** adversarial review in the results sheet and the Fleet panel | Built |
| Inbox, approvals and decisions | Approval card | Partial: no inbox of past decisions |
| Application catalog | Workflows and radial actions | Gap: no installable applications |

## 3. SDK and shared primitives (Orc sections 2.4 and 3)

| Orc element | Nalara now | Status |
|---|---|---|
| Observatory: "every fleet, every agent, usage and burn" | **New** `GET /api/observatory`, `nalara observatory`, and an Observatory panel (Settings → *Open the Observatory*): totals, fleet budget, per-fleet usage, review outcomes, budget overruns, per-agent runs and failures | Built |
| System Settings: "budgets per fleet, permissions, policies, and integrations, set once" | Settings panel: tool policy, MCP servers, secrets, triggers, governor, audit | Partial: fleet budgets and adversarial settings are config-file only |
| Shared primitives: Requests, Work Queue, Evidence, Approval, Reporting | Intents, work queue, evidence checks, approvals, the Commander report | Built |
| Records (domain objects with schemas and lineage), Correspondence, Notifications | None | Gap |
| SDK packages with manifests: IDs, versions, record schemas, forms, workflows, roles, tools, review gates, views, migrations | Agent definitions (`schemas/agent.schema.json`) and workflow JSON | Gap: no application manifest or packaging |

## 4. Gateway (Orc section 4)

| Orc element | Nalara now | Status |
|---|---|---|
| "Credentials are injected at the moment of the call. They are never visible to an application, a client, or a transcript" | **New**: MCP server env, headers, URL and arguments may contain `${secret:NAME}`; the kernel fills them in at connect time. The stored values are removed from tool results, events, the audit ledger, HTTP responses and the SSE stream. The secrets API lists names only | Built, with two limits: values shorter than 6 characters are not redacted, and the MCP server process itself receives the value |
| "The Gateway is the only egress; an application cannot open a socket" | Agents reach the outside only through registered tools, but MCP servers and `proc.*` child processes are ordinary processes that can open their own connections | Gap: egress is not enforced at the OS level |

## 5. Security boundaries (Orc section 5)

| Orc element | Nalara now | Status |
|---|---|---|
| Authority gate: permissions, RBAC, project scope; every allow and deny recorded | Per-agent tool scopes, deny/allow globs, policy × reversibility, all recorded in the audit ledger | Partial: no RBAC, no multiple users or projects per kernel |
| Sandbox: untrusted applications isolated, out of process | Agents run in the kernel's Node.js process; test and deploy commands run as child processes with a scrubbed environment and timeout | Gap |
| Compiled core: "nothing readable ships" | Plain TypeScript | Gap, and not a goal for an open, local tool |
| Shells receive projections, never raw events or internal identifiers | The UI receives the event stream (redacted) and instance ids | Gap (by design for a single-user local UI) |
| Hostile shell, hostile application, tampering defences | Origin check and client header; agent definitions schema-validated and hashed; MCP tool definitions hashed and disabled on change | Partial |

## 6. Summary of what this change added

- Process tree, roles and rounds for every agent instance (`src/fleet/store.ts`).
- Adversarial review of builder steps with evidence-gated convergence (`src/agents/orchestrator.ts`, `src/fleet/evidence.ts`, `src/agents/commander.ts`).
- An audited, budgeted relay for spawn, handoff, challenge, verdict and result messages (`src/fleet/relay.ts`).
- Fleet memory pinned into later agents' context.
- Per-run fleet budgets in the Governor.
- A secret store with call-time injection for MCP servers and redaction at the gateway and the HTTP layer (`src/kernel/secrets.ts`).
- System interface: API versioning, feature list, structured error codes, idempotency keys (`src/server/http.ts`).
- Observatory and work queue over HTTP, CLI and UI.
- UI: Fleet panel, Observatory panel, Secrets section in Settings, adversarial review in the results sheet.

Tests: `test/adversarial.test.ts`, `test/fleet.test.ts`, `test/secrets.test.ts`,
new cases in `test/http.test.ts` and `test/config.test.ts`, and end-to-end
checks d2 and i2 in `test/e2e/run.ts`.

## 7. Still missing, in rough order of value

1. **Out-of-process isolation** for agents, test runs and MCP servers, with
   egress forced through one gateway. This is the largest safety gap, and it
   needs OS facilities (containers or namespaces), not more TypeScript.
2. **Authentication, users and RBAC**, before the server listens on anything
   but localhost.
3. **Fleet budget and adversarial settings in the Settings panel** (today they
   are config-file only).
4. **Records, notifications and correspondence** as shared primitives.
5. **Application manifests** (an SDK), so new workflows arrive as validated
   packages rather than code changes.
6. **Semantic evidence**: checking that a cited line supports the claim, not
   only that it exists.
