# PlayCanvas Design plugin

A Claude Code skill that turns PlayCanvas scenes into finished media and game assets.

```
/plugin marketplace add ZenZeiTen/synthapps
/plugin install playcanvas-design@synthapps
```

It contains:

- `skills/playcanvas-design/SKILL.md`: the workflow (pick a route, author, render, check,
  deliver) and the rules that keep renders honest.
- `skills/playcanvas-design/scripts/render.mjs` + `recorder.js`: a zero-dependency
  renderer. It serves a code scene or an Editor static build, holds back the engine's frame
  loop in headless Chrome, and steps it exactly 1/fps per frame, so runs are byte-identical
  and keys land on exact frames.
- `scripts/review.py`: missing/blank/frozen-frame checks, loop-seam proof, contact sheets.
- `scripts/encode.py`: MP4/WebM through ffmpeg or Blender's built-in FFmpeg; GIF, WebP and
  APNG through Pillow, with exact frame timing read back.
- `scripts/spritesheet.py`: sprite atlases with generic and PlayCanvas frame data.
- `templates/`: a lit code scene with a keyframe timeline, and a turntable/sprite rig for
  any GLB (N directions × M animation samples, all clips).
- `editor-scripts/keyframe-animator.js`: the same timeline as an Editor script.
- `references/`: Editor MCP workflow, look and motion craft, game-asset recipes, and the
  measured facts the skill rests on.

Requirements: Node 22+, Chrome or Edge, Python 3 with Pillow, and the PlayCanvas engine
(`npm i playcanvas` in your scene folder). For MP4/WebM you also need ffmpeg, or Blender
(the fallback was measured with Blender 5.2).
