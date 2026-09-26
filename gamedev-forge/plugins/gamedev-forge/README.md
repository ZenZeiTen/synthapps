# gamedev-forge

Plan, build, test, localize and ship small games with Claude Code.

Start with `/gamedev-forge:new-game <your idea>`, or just describe the game you want: the
`game-director` skill writes a one-page brief, picks a build track and hands each job to
the specialist skill that owns it. Before a build goes to players, run
`/gamedev-forge:release-check`.

| Component | Name |
|---|---|
| Entry point | `game-director` |
| Commands | `new-game`, `release-check` |
| Build tracks | `browser-arcade-game-forge`, `game-creator-2d`, `dos-game-forge`, `threejs-retro-forge`, `hd2d-forge`, `godot-forge` |
| Assets and audio | `aseprite-pixel-forge`, `blender-game-asset-forge`, `blender-2d-forge`, `game-music-forge` |
| Localization | `game-loc-ops`, `game-liveops-linguist` |
| Agent | `playtest-auditor` (read-only review) |

This plugin starts no MCP servers and needs no API keys. Skills use Godot, Blender,
Aseprite, `ffmpeg` or a headless browser when they are installed, and fall back when they
are not. For Blender, Godot and Context7 servers, also install
`gamedev-forge-connectors@synthapps`.

Full documentation: <https://github.com/ZenZeiTen/synthapps/tree/main/gamedev-forge>
