---
name: "godot-forge"
description: "Build, test, ship and fix Godot 4.x games: TileMapLayer worlds, characters and AnimationTree, particles and shaders, game feel (platformer jump timing), keyboard and gamepad input, story scenes and endings, pixel-art settings, Blender/Aseprite import, headless checks, scripted-input tests, Windows/Linux exports sent to the user as small archives, and remakes of classic games from their source code. Use for any Godot work, including 'remake this old game in Godot', 'build me the exe', and bug reports from someone playing a Godot build."
---

# Godot Forge

Build Godot 4 games that open cleanly, run on the first try and survive an engine upgrade.
The output is working project files: GDScript, shaders, scenes built by script and project
settings. Every file is checked with the headless engine before handoff whenever an engine
binary is available.

## Neighbouring skills: who owns what

| Situation | Skill |
|---|---|
| Godot project, scenes, GDScript, shaders, import settings, export | **this skill** |
| Making 3D models, rigs, animations or pre-rendered sprites in Blender for a game | `blender-game-asset-forge` |
| Drawing or animating pixel art, tilesets or sprite sheets in Aseprite | `aseprite-pixel-forge` |
| Pixel sprites lit inside a 3D world (Octopath look), in any engine | `hd2d-forge`, which uses this skill for Godot specifics |
| A browser game in one HTML file, with no engine | `game-creator-2d` / `threejs-retro-forge` |
| Flat 2D animation or video rendered from Blender | `blender-2d-forge` |

## Facts checked on 2026-09-25 (re-check if more than about 3 months old)

- **Current stable: Godot 4.7.2 (18 Aug 2026).** 4.8 is in dev snapshots. Docs "stable" means 4.7.
- **4.3:** TileMap is deprecated. Use one `TileMapLayer` node per layer.
- **4.4:** added `.uid` sidecar files (`*.gd.uid`, `*.gdshader.uid`). Commit them and move them with their source file. Also added typed dictionaries (`Dictionary[String, int]`), `@export_tool_button` and ubershaders.
- **4.5:** added `@abstract` classes and methods, variadic functions (`func f(...args: Array)`), and TileMapLayer physics chunking on by default (`physics_quadrant_size = 16`).
- **4.6:**
  - Jolt is the default 3D physics engine for new projects only. The setting value "DEFAULT" still means GodotPhysics3D.
  - D3D12 is the default renderer on Windows for new projects.
  - Glow is applied before tonemapping and its default blend mode is Screen, so it is much brighter. Volumetric fog is also brighter.
- **4.7:** breaking changes.
  - `BlendSpace1D/2D` gained a `sync_mode` enum. The old boolean `sync` still exists, but check transitions carried over from older trees.
  - Mouse and keyboard device IDs are now `DEVICE_ID_MOUSE` / `DEVICE_ID_KEYBOARD` instead of 0.
  - The plane sign of Jolt's `WorldBoundaryShape3D` is flipped.
  - An override of a method with a typed return must now return explicitly.
  - The migration guide says new projects start with stretch mode `canvas_items` and aspect `expand`. Set both explicitly anyway.
- Physics interpolation is **off** by default (`physics/common/physics_interpolation`).
- Some features exist only on the **Forward+** renderer: SDFGI, VoxelGI, SSIL and volumetric fog. Particle trails and SDF particle collision need Forward+ or Mobile. The Compositor is unavailable on Compatibility. On other renderers these do nothing, and no error appears.

**Measured on Godot 4.7.1 in a Linux container (2026-09-26):**
- `var hp := d["hp"]` on a Dictionary (or JSON) value is a parse error: *Cannot infer the type of "hp" variable because the value doesn't have a set type.* Write `var hp: int = d["hp"]`, or leave it untyped.
- A variable inferred from a function that can return `null`, then indexed, fails at parse time: *Cannot use subscript operator on a base of type "null"*. Declare it `var target: Variant = f()`.
- When Godot prints a chain of errors, the first `SCRIPT ERROR` is the real one. "Failed to compile depended scripts", `Nonexistent function 'new' in base 'GDScript'` and calls on `Nil` all follow from it.
- `JSON.parse_string` returns every number as a float (`3` becomes `3.0`). `var_to_str`/`str_to_var` keeps ints as ints, so use it for save files.
- Injected input under `--headless`:
  - `Input.parse_input_event` delivers keys and mouse events to `_input`/`_unhandled_input`;
  - mouse clicks never press GUI `Control`s (Button and the like);
  - under `xvfb-run` with `--rendering-driver opengl3` they do. See `references/test-harness.md`.
- A script error in the running main scene does not end the process. Headless runs need `timeout` and `--quit-after`.
- `Image.load_from_file("res://…")` works in the editor but warns *"this will not work on export"*. Read the bytes with `FileAccess.get_file_as_bytes` and call `Image.load_png_from_buffer` instead.
- A `.import` sidecar that holds only `[remap]` and `importer="keep"` stops Godot from re-encoding that file. The export packs it byte for byte.
- A Windows exe exports from Linux with the 4.7.1 templates in `~/.local/share/godot/export_templates/4.7.1.stable/`. `godot --headless --main-pack game.exe` then runs the pack embedded in that exe on Linux, so the exact build can be tested before it is sent.

When a user's project is older, read `project.godot` (the `config/features` line shows the
version) and follow the migration guides between that version and 4.7 before editing.

## How to work

1. **Find out what is available.** Look for a Godot binary (`godot --version`, or `Godot_v4*` on the user's machine).
   - Read the version the project (or a sibling project in the repo) targets first: the `config/features` line in `project.godot`. Then fetch exactly that version; one session downloaded 4.5.1 before noticing the repo was on 4.7.
   - If there is none, ask the user to install that exact version, or ask before downloading it yourself. Get it only from the official release page, `github.com/godotengine/godot/releases/tag/<version>-stable` (the Linux editor is `Godot_v<version>-stable_linux.x86_64.zip`). Every release publishes `SHA512-SUMS.txt`: compare the archive's SHA-512 with its line there (`sha512sum`) before unzipping, and stop if they differ. Run it from the project's working folder rather than installing it system-wide.
   - Export templates are one large `.tpz`, 1.28 GB for 4.7.1, from the same release page and checked against the same `SHA512-SUMS.txt`. Start the download in the background early. Unzip only the templates you need, flat, into `~/.local/share/godot/export_templates/<version>.stable/`:
     `unzip -o -q -j tpl.tpz templates/version.txt templates/linux_release.x86_64 templates/windows_release_x86_64.exe -d ~/.local/share/godot/export_templates/4.7.1.stable`.
   - Otherwise, deliver unchecked files and say so plainly.
2. **Build scenes in code or in small `.tscn` files.** Hand-written `.tscn` is fragile: a wrong `ext_resource` id or UID silently breaks a scene. Prefer:
   - scripts that assemble node trees in `_ready()`, or
   - a `@tool` / `EditorScript` generator that builds the scene and calls `ResourceSaver.save()`.
3. **Type everything.** Use typed GDScript (`var speed: float`, `-> void`). It catches errors at parse time, which the headless check can see. Values read from a Dictionary, an Array or JSON are Variants, and `:=` cannot infer them. Give those an explicit type (`var hp: int = d["hp"]`) instead.
4. **Keep rules apart from the view.** Put game rules and state in plain scripts (`RefCounted`, no nodes) that a `SceneTree` test script can drive headless. The scene scripts draw that state and turn input into calls on it. The rules can then be tested by the hundred, without a window.
5. **Build a scripted-input harness on day one** (`references/test-harness.md`, tested code). It lets a shell command click, press keys, dump state and take screenshots. Give every flow a player can reach one check that drives it the way a player does. Then make sure the check fails without the fix.
6. **Check before you hand off** (commands below). Parse every script, import the project, run the main scene, run the harness checks, and look at screenshots of every screen you changed.
7. **Before a player gets a build, run the play-readiness pass** (below). Headless tests prove the rules; players meet the interface.
8. **Say what was not verified.** Rendering, feel and timing need eyes on a real screen. Name what the user should look at.

Remaking an old game from its source code (a DOS or 90s title, a released engine)? Read
`references/classic-remake.md`. It covers the mechanics/content line, reading the
source, the verification ladder, and what the first player found.

### Headless commands

```bash
godot --headless --path ./proj --import                       # import assets, then quit
godot --headless --path ./proj --check-only -s res://tools/x.gd   # parse one script (it must extend SceneTree or MainLoop)
godot --headless --path ./proj --quit-after 120               # run the main scene ~120 frames, then quit; read stderr
godot --headless --path ./proj --export-release "Windows Desktop" build/game.exe

# test runs: always under timeout (a script error does not end the process)
timeout 300 godot --headless --path ./proj --script res://tests/run_tests.gd   # SceneTree test script, no scene
timeout 300 godot --headless --path ./proj --quit-after 3000 -- --script=click:120:115,wait,dump   # harness; 3000 frames because headless frames are short and tweens wait
timeout 300 xvfb-run -a -s "-screen 0 1280x720x24" godot --path ./proj --rendering-driver opengl3 \
  --audio-driver Dummy --resolution 640x360 -- --script=... --shot=/abs/shot.png --frames=40      # screenshot; GUI clicks work here
timeout 300 godot --headless --main-pack build/game.exe --quit-after 3000 -- --script=...         # run the exported exe's data on Linux
```

`--export-release` needs three things:
- the preset name exactly as in `export_presets.cfg`;
- export templates for the **exact** engine version;
- an existing output folder.

Commit `export_presets.cfg`. Godot keeps sensitive export options in its own file inside `.godot/`; keep the whole `.godot/` folder out of version control (Godot's default `.gitignore` does).

## World design

**2D tile worlds (TileMapLayer)**
- Use one `TileMapLayer` per layer: ground, walls, decor, overhang. Save the `TileSet` as an external `.tres` so every level shares it.
- **Terrains** do autotiling. The terrain set mode must match how the art was drawn:

  | Terrain set mode | Tileset it fits |
  |---|---|
  | Match Corners and Sides | 47-tile blob (Godot 3's "3×3") |
  | Match Corners | 16-tile corner set ("2×2") |
  | Match Sides | 16-tile edge set ("3×3 minimal") |

  Paint the peering bits on each tile, then paint the level in Connect or Path mode.
- **Patterns** (the Patterns tab) store reusable stamps such as houses and trees in the TileSet.
- **Scene tiles** place interactive objects (chests, torches) on the grid. Since 4.6 they can be rotated.
- Keep **Use Texture Padding** on in the atlas. It stops neighbouring tiles bleeding into each other.
- Physics chunking (4.5+) makes `get_coords_for_body_rid()` approximate. Set `physics_quadrant_size = 1` when you need to know exactly which tile was hit.
- **Draw order:** enable `y_sort_enabled` on the parent and on each Y-sorted layer. Nodes sort against each other only when they share the same `z_index`. Put UI on a `CanvasLayer`.

**3D worlds**
- `GridMap` paints a `MeshLibrary` built from Blender kit pieces. Give each piece its collision in Blender with the `-convcolonly` or `-col` suffixes; see Scene setup. 4.7 added a dedicated MeshLibrary editor.
- **Lighting by target:**
  - Desktop: start with SDFGI for dynamic scenes, or LightmapGI plus ReflectionProbes for static scenes and best quality.
  - Mobile and Compatibility renderers: LightmapGI and probes only.
- LightmapGI needs a UV2. Let Godot make it: in the import dock set Meshes > Light Baking to **Static Lightmaps** and choose a texel size.
- `WorldEnvironment` holds the sky, ambient light, tonemap (AgX is the modern default choice), glow and fog. `FogVolume` and volumetric fog need Forward+.

**Navigation**
- 2D: bake with `NavigationRegion2D.bake_navigation_polygon()`, or put navigation layers on the TileSet.
- 3D: bake with `NavigationRegion3D.bake_navigation_mesh(true)`.
- Agents use `NavigationAgent2D/3D`: set `target_position`, then read `get_next_path_position()` in `_physics_process`.

**Streaming large worlds**

```gdscript
func request_area(path: String) -> void:
	ResourceLoader.load_threaded_request(path)

func poll_area(path: String) -> PackedScene:
	if ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_LOADED:
		return ResourceLoader.load_threaded_get(path) as PackedScene
	return null
```

## Characters

**Movement.** Set `velocity`, then call `move_and_slide()` with no arguments, inside `_physics_process`.

```gdscript
extends CharacterBody2D

@export var speed: float = 90.0
@export var accel: float = 900.0

func _physics_process(delta: float) -> void:
	var dir: Vector2 = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = velocity.move_toward(dir * speed, accel * delta)
	move_and_slide()
```

For a platformer, add gravity to `velocity.y` and gate jumping on `is_on_floor()`.
`up_direction` defaults to `(0, -1)`.

**Platformer jump feel.** A player's first complaint about a jump is usually "stiff" or
"delayed", even when the arc is right. That happened in a remake that ported the original's
numbers exactly (a remake of a mid-90s DOS platformer). Check these before the first build:
- **Latency from press to visible motion.** Count it. Wait for the next fixed step, add any
  launch delay, then the frame of interpolation lag. Aim for movement on the step the button
  is pressed. The source waited 2 steps (110 ms at 18.2 Hz) before the first rise, which
  felt like input lag. Start the rise on the press step and keep the same arc.
- **Landing lock.** A landing that blocks running (the source held 4 to 7 steps) reads as
  stiffness. Let a held direction run straight on. If you want a hard-landing crouch, keep
  it to a pose, or to 1 or 2 steps with the stick centred.
- **Jump buffer** (a press a few steps before landing is kept) and **ledge grace** (a press
  just after walking off an edge still jumps). Use about 3 steps, or about 100 ms, for each.
- **Poses for the phases:** takeoff, rise, apex, fall, landing. Pick the pose from the
  vertical speed. One frame for the whole rise looks stiff. Keep the facing direction on
  straight-up jumps: switching to a front-facing pose mid-jump reads as a glitch.
- **Record the adaptation** in the design table (kept, adapted or added, and why), and add a
  test for each change that fails on the old code. Example: "rises 14 px on the press step";
  "a press made while still falling jumps again after landing".

**Animation.** Choose the node by what the animation has to drive:

| Need | Use |
|---|---|
| Simple sprite loops | `AnimatedSprite2D` + `SpriteFrames` |
| Frames plus hitboxes, sounds, events or properties in sync | `AnimationPlayer` |
| Blending by direction or speed, states, one-shot attacks | `AnimationTree` over an AnimationPlayer |

```gdscript
@onready var tree: AnimationTree = $AnimationTree
@onready var playback: AnimationNodeStateMachinePlayback = tree["parameters/playback"]

func update_anim(dir: Vector2) -> void:
	if dir != Vector2.ZERO:
		tree.set("parameters/Walk/blend_position", dir)   # BlendSpace2D named "Walk"
		playback.travel("Walk")
	else:
		playback.travel("Idle")
```

The state machine must be active: `tree.active = true`, with a start state set.
Fire a one-shot with `tree.set("parameters/Attack/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)`.
Since 4.7, check `sync_mode` on BlendSpaces that came from older projects.

**3D rigs from Blender**
- In the Skeleton3D import settings, add a **BoneMap** with `SkeletonProfileHumanoid`. It auto-maps common English bone names such as Hips, Spine, LeftUpperArm. Enable **Rest Fixer > Overwrite Axis**. For an A-pose model, also enable **Fix Silhouette**.
- **Root motion:** set `root_motion_track` on the AnimationTree, then apply `get_root_motion_position()` to the body each physics frame.
- Procedural touches use `SkeletonModifier3D` children:
  - `LookAtModifier3D`;
  - `SpringBoneSimulator3D` for hair and cloth;
  - the IK nodes added in 4.6: `TwoBoneIK3D`, `FABRIK3D`, `CCDIK3D`.
- `SkeletonIK3D` is deprecated.

**Hitboxes and hurtboxes.** This is a common pattern, not an engine feature, and it is the one to reuse.
- Name the physics layers under Project Settings > Layer Names > 2D Physics: 1 world, 2 player, 3 enemy, 4 player_attack, 5 enemy_attack.
- A **Hitbox** sits on an attack layer with mask 0.
- A **Hurtbox** sits on nothing and masks the opposing attack layer.

```gdscript
class_name Hitbox extends Area2D
@export var damage: int = 1
```

```gdscript
class_name Hurtbox extends Area2D
signal hurt(damage: int, source: Hitbox)

func _ready() -> void:
	area_entered.connect(_on_area_entered)

func _on_area_entered(area: Area2D) -> void:
	if area is Hitbox:
		hurt.emit((area as Hitbox).damage, area)
```

Turn the hitbox's `CollisionShape2D.disabled` on and off from an AnimationPlayer track, so
the active frames match the art exactly.

## Visual effects

**Particles.** Use `GPUParticles2D/3D` with a `ParticleProcessMaterial`. `CPUParticles` gets no new features.
- The one exception: with 2D physics interpolation on, only `CPUParticles2D` are interpolated.
- **One-shot bursts** such as hits, dust and sparks: set `one_shot = true` and `explosiveness = 1.0` in the effect scene, then spawn it:

```gdscript
const HIT_FX: PackedScene = preload("res://fx/hit_spark.tscn")

func spawn_fx(at: Vector2) -> void:
	var fx: GPUParticles2D = HIT_FX.instantiate()
	get_tree().current_scene.add_child(fx)
	fx.global_position = at
	fx.finished.connect(fx.queue_free)
	fx.restart()
```

- **Sub-emitters** chain effects, for example sparks at the end of a spark trail. The modes are `CONSTANT`, `AT_END`, `AT_COLLISION` and `AT_START`.
- Trails and SDF collision need Forward+ or Mobile. For pixel art, use small integer-sized textures and the Nearest filter.

**Game feel: screen shake and hit-stop.** Put both on an autoload or on the camera.

```gdscript
extends Camera2D
@export var max_offset: Vector2 = Vector2(6, 4)
@export var decay: float = 1.6
var trauma: float = 0.0

func add_trauma(amount: float) -> void:
	trauma = minf(trauma + amount, 1.0)

func _process(delta: float) -> void:
	trauma = maxf(trauma - decay * delta, 0.0)
	var s: float = trauma * trauma   # squared: small hits stay subtle, big hits kick hard
	offset = Vector2(max_offset.x * s * randf_range(-1.0, 1.0),
			max_offset.y * s * randf_range(-1.0, 1.0)).round()  # round keeps pixel art crisp
```

Tested in 4.7.2: `add_trauma(1.0)` kicks up to 6 px and settles within about 0.4 s. Don't use
`FastNoiseLite` with its default settings here. Its default frequency of 0.01 produces almost no
movement at per-frame sampling, and the rounded offset stays at 0.

```gdscript
func hit_stop(duration: float = 0.06, time_scale: float = 0.05) -> void:
	Engine.time_scale = time_scale
	# 4th argument ignore_time_scale = true, so the timer runs while time is frozen
	await get_tree().create_timer(duration, true, false, true).timeout
	Engine.time_scale = 1.0
```

**Shaders.**
- Use `shader_type canvas_item` for 2D and `shader_type spatial` for 3D.
- Classic 2D effects:
  - hit flash: mix toward white with a `uniform float flash`;
  - dissolve: noise texture plus threshold;
  - outline: sample the four neighbouring texels of `TEXTURE_PIXEL_SIZE`;
  - palette swap: look up a LUT texture.
- A **global uniform** is declared as `global uniform vec4 x;`. It must first exist in Project Settings > Shader Globals, or the shader fails to compile.

```gdshader
shader_type canvas_item;
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec4 flash_color : source_color = vec4(1.0);

void fragment() {
	vec4 c = texture(TEXTURE, UV);
	COLOR = vec4(mix(c.rgb, flash_color.rgb, flash), c.a);
}
```

**Glow and post-processing**
- **2D glow**, route 1: enable `rendering/viewport/hdr_2d` (Forward+ or Mobile) and push the sprite's `modulate` above 1.
- **2D glow**, route 2: without HDR 2D, set the Environment background mode to Canvas and lower the Glow HDR Threshold. Keep UI on a CanvasLayer above the glow.
- Projects upgraded to 4.6+ need glow and fog re-tuned (see Facts).
- Custom full-screen passes use `Compositor` + `CompositorEffect`, on Forward+ or Mobile.
- For blend modes on sprites, use `CanvasItemMaterial.blend_mode`: ADD for fire, magic and light; MUL for shadows. Author additive art on a dark or transparent base.

## Scene setup

**Architecture**
- Build small scenes and instance them.
- Signals go up, calls go down.
- Groups handle broadcast: `get_tree().call_group("enemies", "alert")`.
- Autoloads hold only true globals: game state, audio, hit-stop, save.
- Custom `Resource` classes hold data such as stats, items and dialogue. A Resource is **shared** between every user of it. Call `duplicate()`, or set `resource_local_to_scene`, before mutating it per instance.

**Pixel-art project settings (exact names)**

| Setting | Value |
|---|---|
| `display/window/size/viewport_width` / `_height` | Base resolution, e.g. 640×360 (scales cleanly to 720p/1080p/1440p/4K) or 320×180 |
| `display/window/stretch/mode` | `viewport` |
| `display/window/stretch/aspect` | `keep`, or `expand` to allow extra view on wider screens |
| `display/window/stretch/scale_mode` | `integer` |
| `rendering/textures/canvas_textures/default_texture_filter` | `Nearest` |
| `rendering/2d/snap/snap_2d_transforms_to_pixel` | `true`, and leave `snap_2d_vertices_to_pixel` off |
| `application/boot_splash/use_filter` | `false` |

- Use exclusive fullscreen. Borderless fullscreen's 1-px gap can drop the integer scale.
- Import pixel textures with **Lossless** compression.

**Importing from Blender** (made with `blender-game-asset-forge`)
- Prefer `.glb`. Direct `.blend` import works only if every machine has Blender 3.5+ and Editor Settings > Filesystem > Import > Blender > Blender Path is set.
- **Object-name suffixes** in Blender turn into node types on import. The separator can be `-`, `$` or `_`, and suffixes are case-insensitive.

  | Suffix | Result |
  |---|---|
  | `-col` / `-convcol` | Mesh kept, plus a trimesh or convex static collider |
  | `-colonly` / `-convcolonly` | Mesh replaced by a StaticBody3D collider |
  | `-navmesh` | Becomes a navigation mesh |
  | `-occ` / `-occonly` | Occluder, with or without the mesh |
  | `-rigid` | RigidBody3D |
  | `-vehicle` / `-wheel` | VehicleBody3D / VehicleWheel3D |
  | `-noimp` | Skipped |

  An animation whose name starts or ends with `loop` or `cycle` imports looping.
  **The suffix is stripped from the node or animation name.** `Hero_Idle-loop` becomes a looping `Hero_Idle`, and `Crate-convcolonly` becomes a StaticBody3D named `Crate`. Tested in 4.7.2 with a Blender 5.0 GLB. Refer to the stripped names in code.
  Material suffixes: `-alpha` for transparency, `-vcol` for vertex colour as albedo.
- Empties as primitive colliders worked only through Collada, which Blender 5.0 removed. Use low-poly `-convcolonly` meshes instead.
- **Advanced Import Settings** per node or mesh: Generate Physics, Save to File, auto LODs and lightmap UV2.

**Importing from Aseprite** (made with `aseprite-pixel-forge`)
- **Aseprite Wizard 9.8.0** (Mar 2026, Godot ≥4.3; 4.7 compatibility not yet confirmed) imports `.aseprite` files directly as SpriteFrames, AnimationPlayer tracks or tileset textures. Tags become animations.
- Its **bake files** option lets CI build without Aseprite installed.
- Without the plugin, import the PNG sheet plus JSON with the builder in `aseprite-pixel-forge`.

**Loading content raw (data-driven games)**

When the game reads its content as data, let Godot carry those files unchanged. Examples
are JSON levels, or PNGs and WAVs picked by name at runtime.
- **Sidecars.** Give each content file a `.import` sidecar containing only
  `[remap]` and `importer="keep"`, and write them with a small script whenever files are
  added. Godot then skips re-encoding them.
- **Export filter.** Include the folder with `include_filter="content/*"` in the preset.
- **Loading.** Load images with `FileAccess.get_file_as_bytes` plus
  `Image.load_png_from_buffer`, and data with `FileAccess.get_file_as_string`. The editor,
  headless tests and the exported build then read identical bytes.
- **Don't use `.gdignore` for this.** It also stops imports, but it leaves the folder out
  of the export (measured in an earlier project).

## Shipping a build to a player

1. **Export one file, from the commit you will name.** Set `binary_format/embed_pck=true`
   in the preset. The Windows exe exports from Linux once the matching templates are
   installed. Build from a clean `git worktree` of that commit, so uncommitted work
   cannot leak into the release. Run `--import` before `--export-release`.
2. **Test that exact file.** Use `godot --headless --main-pack build/game.exe` with the
   harness flows you just fixed, plus a screenshot run. Testing the project is not
   enough: this proves the export carries the fix.
3. **Fit the delivery channel.** Chat file uploads are limited (often around 30 MiB
   per file; check the limit of the channel you use). An exe with embedded data compresses far better with an x86 BCJ
   filter. Measured on a 116 MB Godot 4.7.1 Windows exe: zip gave 42.3 MiB, and 7z with
   BCJ plus LZMA2 extreme gave 29.7 MiB.

   ```python
   import py7zr  # pip install py7zr
   f = [{"id": py7zr.FILTER_X86}, {"id": py7zr.FILTER_LZMA2, "preset": 9 | py7zr.PRESET_EXTREME}]
   with py7zr.SevenZipFile("Game-windows-v2.7z", "w", filters=f) as z:
       z.writeall("Game", "Game")   # folder with Game.exe + README.txt
   ```

   Unpack the archive into a temporary folder and compare SHA-256 hashes before sending.
4. **Add `README.txt`** (CRLF line endings). It should say how to run the game, give the
   full controls (keyboard and mouse) and the save folder
   (`%APPDATA%\Godot\app_userdata\<project name>`), and name the build's commit.
   Unsigned exes trigger SmartScreen, so add: "Windows protected your PC → More info →
   Run anyway". Windows 11 opens `.7z` natively; Windows 10 needs 7-Zip.
5. **Version the archive name** (`-v2`, `-v3`) and list what changed, so the player knows
   which build they are running.

## Play-readiness pass (before any build reaches a player)

These bugs were reported by the first person to play a build that had passed every
headless test. Walk the list, and add a harness check for each item that applies.

1. **Text fits its box with real data.** Test with the longest names, real dates and
   times, full inventories, and labels written by older versions. A save label
   `"The Cellar Vaults, 2026-09-26 13:22:24"` overflowed its button at 640×360. Clip in
   the button function as a last guard, but design labels short.
2. **Every action works from every input the genre implies.** A mouse-driven dungeon
   crawler had mouse actions but no mouse movement: "I cannot turn around while clicking
   the mouse". Write the controls table with both keyboard and mouse columns, and fill
   every cell.
3. **Every modal screen can be left by every exit, and play resumes.** Try the close
   button, Esc, another panel's button, and loading a game, then assert that the player
   can move. A shop kept open in the game state behind a replaced panel froze movement.
4. **Every hint on screen is true on that screen.** "Click a portrait to stow it" did
   nothing while the shop was open.
5. **Saves from the previous build load and display correctly.**
6. **First launch on the target OS.** Check the unsigned-exe warning, the window size, and
   that the controls are listed.
7. **The game can be finished all the way to the title screen.** Drive the last boss, the
   ending, the credits and the score entry with real input, then assert that the title
   screen comes back. Tests that stop at `won == true` never see the ending. In *Vale of
   Shards*, the last ending page switched to a mode string (`"name_check"`) that nothing
   handled, and the game froze after the final boss.
8. **Gameplay buttons don't skip story screens.** A player still mashing fire at the boss
   turned all three ending pages in a moment. Ignore input for about 0.8 s on each page,
   and on the fade before it.
9. **The button that closes a dialog doesn't act in the game.** A jump button that also
   confirms made the hero jump as each dialog closed. Swallow the closing button until it
   is released: don't latch it, and mask it from the game input while it is held.
10. **The story has its beats.** Players expect a scene before the final boss, an ending
    that shows the world changed, and credits. These are easy to leave out of a
    mechanics-first remake. Plan them in `DESIGN.md` next to the stages, and give each one
    a harness check.

When a player reports a bug:
1. Reproduce it through the harness.
2. Fix it.
3. Prove that the new check fails on the old code.
4. Look for siblings: the same root cause often has another path. The "can't stow"
   report led to the freeze.
5. Rebuild and test the exported data.
6. Log the report in the project's `CLAUDE.md`: what the player saw, the cause, the fix,
   and the check that now guards it. Future sessions start from that log.

## Pitfalls checklist (run before handoff)

1. **Shared Resource mutated at runtime:** every instance changes. Call `duplicate()` first.
2. **`.uid` files missing or left behind after a move:** references break. Move files inside the editor, or move the `.uid` files with them.
3. **Moving bodies in `_process` with physics interpolation on:** jitter. After a teleport, call `reset_physics_interpolation()`.
4. **Pixel distortion:** caused by fractional scale, the Linear filter, both snap settings on at once, or borderless fullscreen.
5. **Forward+-only features on Mobile or Compatibility:** they vanish silently. Check the renderer before promising a look.
6. **4.6 upgrade:** glow and fog too bright.
7. **4.7 upgrade:** blend-space sync changed, `device == 0` input checks broke, and Jolt world boundaries are inverted.
8. **Old project on "DEFAULT" physics:** still GodotPhysics3D. Switch to Jolt deliberately, not by assumption.
9. **Global shader uniform not defined:** the shader fails to compile. CSG with non-manifold meshes fails (4.4+).
10. **Tile seams:** atlas padding turned off, or a sheet exported without extrude or padding.
11. **`:=` on a Variant** (a Dictionary, Array or JSON value): parse error. Annotate the type explicitly.
12. **JSON save files:** ints come back as floats. Use `var_to_str`/`str_to_var`.
13. **Click tests against `Control` nodes under `--headless`:** the clicks never arrive, so the test blames the game. Run them under `xvfb-run`.
14. **Headless runs without `timeout`:** a script error leaves the process running for ever.
15. **Tests that set state directly** (open a panel, give an item): they skip the input path where players find bugs. Set up with shortcuts, but do the step under test with clicks and keys.
16. **Modal game state that outlives its screen** (shop, dialogue, trade): input freezes with no visible cause. Pair each modal state with its screen, and add a guard that closes orphans.
17. **Labels sized for sample data:** real dates, long names and old save labels overflow at low resolution.
18. **Mixed `and`/`or` without brackets:** `a or b and not a and c` hid a player-facing bug. Bracket every mixed condition.
19. **Test scripts that pipe into `grep`/`tail` without `set -o pipefail`:** a failing suite does not stop the run. Printing a number, such as "wins 9/12", is not a check either: compare it with a floor, and exit non-zero.
20. **Harness commands that ignore unknown names:** a typo in a test silently does nothing. Give the command switch a default branch that fails loudly.
21. **A mode or state name that nothing handles:** the screen freezes, with no error. Keep modes in an enum or a `match` with a default branch that fails loudly, and test every transition to its end.
22. **Replays and playthroughs that stop at "won":** the ending, credits and return to the title are never run. Keep driving past the win.
23. **Recorded inputs replayed from a different game state:** random events (a bounce, a turn) differ from the recording, and the run drifts. A route that passed before may just have been lucky. Check each recorded segment against its goal, and search it again from the real state when it misses. Or seed the random numbers at the point where recording started.
24. **Godot stdout redirected to a file is buffered until exit:** a long background run shows nothing, and a killed run loses its output. Use `printerr` for progress, give the harness a `quit` command, and end every script with it.
25. **`grep -E "$want"` with `|` as a separator:** `|` is alternation there, so the check passes on anything. Join expected lines with `;`. Capture the output first (`out=$(… 2>&1) || fail`), then parse it; a pipe inside `$(…)` under `set -e` exits silently.
26. **A copy of a generated file kept by hand** (a manifest duplicated into the game folder): it drifts from the source. Have the generator write every copy.
27. **An asset missing from the export:** stage-1 tests don't touch the ending art. Add a harness command that loads every manifest sprite and track, and run it inside the exported build.

## Handoff

Tell the user:
- which Godot version the files target;
- which headless checks and harness flows ran, and their output;
- what could only be judged on screen: feel, timing, glow strength, readability.

Name the one scene to open first. When you send a build, give:
- the archive name and version;
- what changed since the last build;
- how to run it, and that old saves still load.

Keep the project's `CLAUDE.md` current (commands, conventions, player-reported bugs), so
the next session starts where this one ended.