# playcanvas-design

A Claude Code plugin for making visual deliverables with [PlayCanvas](https://playcanvas.com):
animated video, seamless loops, turntables, 8-direction animated sprite sheets, icons, GLB
exports and scripted gameplay captures. Scenes are authored either as code or in the
PlayCanvas Editor through its MCP server.

The core is a deterministic renderer. It injects a small recorder into the page, holds back
the engine's `requestAnimationFrame` loop in headless Chrome, and calls `app.tick()` with
timestamps exactly `1000/fps` ms apart. Every frame gets `dt = 1/fps`, two renders of the
same scene are byte-identical, and a key at 0.6 s lands on frame 18 at 30 fps.

```
author (Editor via MCP | code scene) → render.mjs → review.py → encode.py | spritesheet.py | GLB export
```

| Path | What it is |
|---|---|
| [plugins/playcanvas-design](plugins/playcanvas-design/) | The plugin (skill, scripts, templates, references) |
| [tests](tests/) | Offline tests for the Python tools (no browser needed) |

```bash
cd my-scene && npm i playcanvas
cp -r <plugin>/skills/playcanvas-design/templates/code-scene/* .
node <plugin>/skills/playcanvas-design/scripts/render.mjs --root . --out frames --duration auto --extra 1
python <plugin>/skills/playcanvas-design/scripts/review.py frames --loop --out contact.png
python <plugin>/skills/playcanvas-design/scripts/encode.py frames loop.mp4
```

Every claim in the skill was measured. See
[measured-facts.md](plugins/playcanvas-design/skills/playcanvas-design/references/measured-facts.md)
for versions and numbers.

Run the tests with `python -m unittest discover -s playcanvas-design/tests -t playcanvas-design`.
