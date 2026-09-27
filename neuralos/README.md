# NeuralOS

An AI-native operating system design where Claude Code is the kernel. The user
states an intent; Claude classifies it, summons a swarm of specialist agents,
connects the tools they need, and builds a temporary workspace on an infinite
canvas. Apps become temporary forms of intent, files become graph nodes, and
agents become the main processes.

**Status:** design and specification. There is no runtime yet.

- **[DESIGN.md](DESIGN.md)**: the technical specification. Philosophy,
  architecture, core services, Neural Canvas, radial menus, agent model,
  intent-based execution, MCP, semantic filesystem, events and the suggested
  stack.
- **[CLAUDE.md](CLAUDE.md)**: the kernel prompt. Claude Code loads it
  automatically when you work inside this folder, so a session here follows
  the NeuralOS principles and execution template.
- **[`schemas/`](schemas/)**: draft JSON Schemas for the three data shapes the
  spec defines.
- **[`design/`](design/)**: UI design sources for the Neural Canvas.

## Try the kernel prompt

```bash
cd neuralos
claude
```

Then give it an intent, for example `Review inventory module`. Before
substantial work it answers with the execution template:

```
Intent:    engineering_review
Workspace: inventory module files, coding standards
Agents:    Systems Architect, Code Reviewer, QA Engineer
Tools:     git, filesystem
Plan:      ...
Output:    ...
```

## Schemas

| File | Shape | Spec section |
|---|---|---|
| `intent.schema.json` | Intent Engine output: `intent`, `required_agents`, `required_tools` | 3.1 |
| `node.schema.json` | Knowledge graph node: `id`, `type`, `name`, `relations` | 3.4 |
| `agent.schema.json` | Shared agent interface: `id`, `name`, `role`, `goals`, `tools`, `memory`, `constraints` | 6 |

The spec names the fields but not all of their types. Where it is silent (for
example the shape of a relation, or whether `goals` is a list), the schemas
make a reasonable first choice. Treat them as drafts to settle before building
the runtime.

## Design

`design/` holds four artboards made with the Claude Design canvas:

| Artboard | Content |
|---|---|
| `Main.dc.html` | Interactive Neural Canvas: intent bar, generated workspaces, radial menus, execution panel, swarm lifecycle, event bus |
| `Kernel.dc.html` | Traditional OS versus NeuralOS, the 10 principles, the execution template |
| `Architecture.dc.html` | Layer diagram, core services, event model, semantic filesystem, stack |
| `Agents.dc.html` | Agent interface and catalog, lifecycle, the four radial menus, MCP actions |

`canvas.json` records how the artboards are laid out. These files are Design
Component sources: they render inside the Claude Design canvas, which supplies
the `support.js` runtime they load. They do not open as standalone pages in a
browser.

In the interactive board, the intent bar matches keywords to one of four
example intents. In the real system that step belongs to the Intent Engine
(Claude). The plan steps and tool choices shown for each example are
illustrative.

## Roadmap

A possible build order, following DESIGN.md:

1. Intent Engine: classify a request into `intent.schema.json` output.
2. Agent Orchestrator: spawn, assign, monitor and merge agents through a
   Commander Agent, with the six-stage lifecycle.
3. Knowledge graph and Memory Service (Neo4j preferred).
4. Event bus (NATS recommended) and event-triggered agents.
5. Neural Canvas UI (React Flow or Three.js), then the radial menus.
