# gamedev-forge-connectors

Optional MCP servers for the `gamedev-forge` skills. They start when this plugin is
enabled. None needs an API key.

| Server | What it lets Claude do | You need |
|---|---|---|
| `blender` (`uvx mcp-for-blender`) | Build, render and export in a running Blender | [uv](https://docs.astral.sh/uv/), Blender, and the add-on: run `uvx mcp-for-blender install-addon`, enable it in Blender, then start its server from the sidebar (press N, "MCP for Blender" tab) |
| `godot` (`npx -y @coding-solo/godot-mcp`) | Launch, run and inspect Godot projects | Node.js 18+ and Godot 4. Set `GODOT_PATH` in your environment if Godot is not found automatically |
| `context7` (`https://mcp.context7.com/mcp`) | Look up current docs for Godot, three.js, Blender and other libraries | Nothing. Works without a key at a lower rate limit |

Settings you can change through environment variables:

| Variable | Default | Used by |
|---|---|---|
| `BLENDER_HOST` | `localhost` | `blender` |
| `BLENDER_PORT` | `9876` | `blender` |
| `GODOT_PATH` | auto-detected | `godot` |

To turn one server off without removing the plugin, use `/mcp` in Claude Code.

## Security

- The Blender add-on runs Python it receives over a local socket. Keep `BLENDER_HOST` on
  `localhost` and stop the add-on's server when you are not using it.
- The servers are fetched at their current version each time they start. Pin a version
  in your own MCP configuration if you need reproducible sessions.
- Account services (Figma, ElevenLabs, music libraries, Sentry, issue trackers, web
  hosts) are not bundled. Connect them through your own account; this plugin never
  holds their keys.
