# Driving the PlayCanvas Editor MCP for design work

The PlayCanvas Editor MCP server (`@playcanvas/editor-mcp-server`; its tools are named
`list_entities`, `launch_start` and so on, under whatever server name the host gives it) talks to a live
Editor browser tab, not to project files. Every edit lands in the user's real project at once.

## Prerequisites (user-side; ask once, don't guess)

- "Editor not connected": the user opens the Editor and clicks the **MCP** button at the bottom
  of the toolbar, then CONNECT. If it is stuck on "Connecting", the user may need to allow local
  access for the editor origin. A newly registered MCP server usually loads only in a new
  host session, so the Editor shows "Connecting" until then (measured with 0.7.1).
- "popup blocked" from `launch_start`: the user allows popups for the editor origin.
- Calls time out (60 s) mid-session: the tab was closed, backgrounded too long, or
  disconnected. Stop, tell the user, and list any cleanup you still owe.

## Design-relevant tool map

| Goal | Tools |
|---|---|
| See what's there | `vcs_status`, `list_scenes`, `list_entities` (compact), `get_entity`, `list_assets type=...` |
| Build a set | `create_entities` (nested hierarchies, components inline), `duplicate_entities`, `reparent_entity` |
| Materials | `create_assets` type material with `data`, then `set_material_properties` (diffuse, emissive, metalness, gloss, opacity, maps) |
| Bring in models | `upload_assets` type `scene` for GLB/FBX (creates container/render/material assets), `sketchfab_search`/`sketchfab_import`, `store_search`/`store_download` (check licenses: `list_store_licenses`) |
| Animate | upload `editor-scripts/keyframe-animator.js` (`create_assets` script), `script_parse`, `attach_script` with `attributes.timeline` JSON. Anim state graphs: `get_anim_state_graph`/`modify_anim_state_graph` |
| Look | `modify_scene_settings` (ambient, skybox, fog, tonemap/exposure), camera component `toneMapping`, `gammaCorrection`, `clearColor` |
| Preview at runtime | `launch_start` → `capture_runtime` (downscaled WebP; good for "does it look right", not for delivery) → `launch_stop` |
| Ground truth | `query_runtime_state` (position/velocity per entity), `read_runtime_logs` |
| Hand off to the renderer | `download_build` format `static`, then unzip, then `render.mjs --root <unzipped>`. Then `delete_build` the job |
| Safety net | `create_checkpoint` before a big design pass; `restore_checkpoint` to roll back |

## Habits that held up

- **Checkpoint before large edits.** `create_checkpoint` with a description, so the user can roll back.
- **Prefer a new scene for design work** in an existing game project (`create_scene`, then `load_scene`),
  unless the user asked to change their game scene. Never delete scenes you didn't create.
- **Read before you write.** Entities may have changed since you last looked. `get_entity`
  first, and rely on GUIDs (entity-type script attributes store GUIDs, so renames are safe).
- **Verify with runtime state, not viewport captures.** `capture_viewport` after
  `focus_viewport` returned empty or cropped frames before. `capture_runtime` works. Run
  `query_runtime_state` one call per turn, because parallel calls return out of order.
- **Temporary scripts:**
  1. `create_assets` + `script_parse` + `add_entity_scripts`
  2. run and read
  3. `remove_entity_scripts` + `delete_assets`
  4. confirm the entity has its original scripts again
- **For a final render you don't need the Editor's launch window at all.** The static build
  plus render.mjs is deterministic and full resolution. Launch is for quick checks.
- **Physics needs Ammo imported** in the project. A static build carries it in `__modules__.js`,
  and it simulated fine headless.

## Download build specifics

- `download_build {name, sceneIds:[id], format:'static', outputPath:'<scratch>/x.zip'}` waits
  for the artifact and returns `buildId`. Unzip it (`unzip` or Python `zipfile`).
- Contents: `index.html`, `__settings__.js` (CONTEXT_OPTIONS, SCENE_PATH), `__start__.js`,
  `__modules__.js` (ammo etc.), `config.json`, `<sceneId>.json`, `files/`, `playcanvas-stable.min.js`.
- `--engineVersion` pins the engine. `list_engine_versions` shows what is available.
- Delete the job afterwards (`delete_build buildId`): it is a record in the user's project.
