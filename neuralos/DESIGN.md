# NeuralOS design

NeuralOS is an AI-native operating system built as a Claude Code project. Claude
plays five roles in it:

- operating system kernel
- agent orchestrator
- intent router
- workspace generator
- knowledge graph manager

The desktop becomes a visual layer over Claude's reasoning. It combines ideas
from a file explorer, Obsidian's graph view, Cursor, Figma's canvas, Raycast-style
command palettes, MCP orchestration and multi-agent execution into one
intent-driven environment.

This document is the technical specification. The kernel prompt itself is in
[CLAUDE.md](CLAUDE.md).

## 1. System philosophy

A traditional operating system works like this:

```
User → Application → File → Action
```

NeuralOS works like this:

```
User → Intent → Claude Orchestrator → Agent Swarm → Workspace → Outcome
```

- Applications become temporary forms of intent.
- Files become nodes.
- Agents become the main userspace processes.
- Claude becomes the operating system kernel.

## 2. High-level architecture

```
┌─────────────────────────────────┐
│ Neural Canvas UI                │
└─────────────┬───────────────────┘
              ▼
┌─────────────────────────────────┐
│ Intent Processing Layer         │
└─────────────┬───────────────────┘
              ▼
┌─────────────────────────────────┐
│ Cognitive Operating Layer       │
│ (Claude Orchestrator)           │
└─────────────┬───────────────────┘
     ┌────────┼────────┐
     ▼        ▼        ▼
   Agent    Memory    Tools
   Swarm    Graph     Layer
     └────────┼────────┘
              ▼
      Workspace Engine
              ▼
        Neural Canvas
```

The canvas that shows a result is also where the next intent starts, so the
flow is a loop.

## 3. Core services

### 3.1 Intent Engine

Turns natural language into an executable plan.

Input:

```
Review inventory module
```

Output (schema: [`schemas/intent.schema.json`](schemas/intent.schema.json)):

```json
{
  "intent": "engineering_review",
  "required_agents": ["architect", "reviewer", "qa"],
  "required_tools": ["git", "filesystem"]
}
```

Components:

- Intent Classifier
- Intent Enricher
- Planner
- Priority Engine
- Context Loader

### 3.2 Agent Orchestrator

The equivalent of the kernel scheduler. It is responsible for:

- spawning agents
- terminating agents
- assigning tasks
- monitoring progress
- aggregating results
- resolving conflicts

Agent lifecycle:

```
Dormant → Summoned → Active → Collaborating → Completed → Archived
```

### 3.3 Workspace Generator

Creates temporary workspaces from intent, without user configuration.

Example intent: `Translate contract`. Generated workspace:

- Legal Agent
- Translation Agent
- Glossary
- Source File
- QA Reviewer
- Output Folder

### 3.4 Knowledge Graph Engine

Every resource is a node: file, folder, agent, MCP server, repository,
database, meeting, prompt, task.

```json
{
  "id": "node_551",
  "type": "agent",
  "name": "Code Reviewer",
  "relations": []
}
```

Schema: [`schemas/node.schema.json`](schemas/node.schema.json).

Storage options: Neo4j (preferred), ArangoDB, an RDF triple store, or a custom
graph database.

### 3.5 Memory Service

A persistent memory layer that Claude keeps updating. It stores:

- user preferences
- project history
- architecture decisions
- coding standards
- translation guides
- file relationships
- agent performance

## 4. Neural Canvas UI

Everything lives on one infinite, zoomable surface, in the spirit of Figma,
Obsidian's graph view, Miro and Vision Pro.

| Node type | Shape | Example |
|---|---|---|
| Project | ○ circle | Breath of Fire IV Remake |
| File | □ square | `battle_system.ts` |
| Agent | ◇ diamond | Lead Architect |
| MCP server | ⬢ hexagon | GitHub, PostgreSQL, Notion |
| Workflow | ⬣ flat hexagon | Build Pipeline |

## 5. Radial operating system

A single click anywhere opens a radial menu. Its options depend on what is
under the pointer.

| Radial | Opens on | Options |
|---|---|---|
| Root | empty canvas | Search, Files, Agents, Projects, Apps, Memory, Settings |
| Agent | an agent node (for example Code Reviewer) | Review, Explain, Compare, Improve, Test, Collaborate, Replace |
| File | a file node | Open, Summarize, Translate, Refactor, Analyze, Attach Agent |
| Project | a project node | Open Workspace, Launch Swarm, Review Status, Memory, Deploy, Archive |

## 6. Agent operating model

All agents share one interface (schema:
[`schemas/agent.schema.json`](schemas/agent.schema.json)):

```yaml
agent:
  id:
  name:
  role:
  goals:
  tools:
  memory:
  constraints:
```

| Group | Agents |
|---|---|
| System (always available) | Commander Agent, Memory Agent, Security Agent, Scheduler Agent, UX Agent |
| Engineering | Systems Architect, Gameplay Architect, Fullstack Engineer, QA Engineer, Code Reviewer, DevOps Engineer |
| Creative | Writer, Designer, Researcher, Localization Expert, Narrative Designer |
| Business | Finance, Legal, Marketing, Operations |

## 7. Intent-based execution

There are no apps to open. The user states an intent and the Intent Engine
builds the workspace.

```
Build inventory feature
└── Workspace
    ├── Planner
    ├── Architect
    ├── Engineer
    ├── QA
    └── Documentation
```

```
Localize this website to Indonesian
└── Workspace
    ├── Brand Analyst
    ├── Translator
    ├── Localization QA
    ├── SEO Reviewer
    └── Style Guide
```

## 8. MCP architecture

Everything external is a tool node: GitHub, Postgres, Supabase, Jira, Notion,
Slack, Discord, Docker, Blender, Figma, Google Drive.

Each MCP server exposes four kinds of action:

```yaml
actions:
  read
  write
  search
  execute
```

Claude discovers the available capabilities at run time.

## 9. Filesystem replacement

A path such as `C:\Projects\Game\Combat\` becomes a node called **Combat
System**, found by meaning. Supported searches include:

- `combat code`
- `latest damage calculations`
- `files related to inventory`
- `design docs referencing merchants`

Folders become optional. Graph relationships come first.

## 10. Event-driven operating model

Everything emits events, for example:

- Node Created
- File Updated
- Agent Finished
- MCP Connected
- Workspace Generated
- Deployment Succeeded

Event bus options: NATS (recommended), Kafka, Redis Streams, Temporal.

Example chain:

```
File Changed
 ↓
Review Agent Triggered
 ↓
QA Agent Triggered
 ↓
Documentation Agent Updated
```

## 11. Suggested technology stack

| Layer | Choices |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind, Framer Motion, Three.js, React Flow, Tauri |
| UI rendering | WebGL, Three.js, D3, PixiJS |
| AI layer | Claude Code, Claude Opus, Claude Sonnet, OpenRouter fallback |
| Graph | Neo4j (preferred) |
| Search | Qdrant, Weaviate, LanceDB |
| Local storage | SQLite, DuckDB |
| Event bus | NATS (recommended) |
