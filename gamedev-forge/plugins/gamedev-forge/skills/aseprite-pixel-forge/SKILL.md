---
name: "aseprite-pixel-forge"
description: "Make game pixel art in Aseprite via MCP or CLI: palettes and ramps, seamless and autotile tilesets, character animation timing, pixel VFX, Blender-render clean-up, and sheet/tileset export into Godot."
---

# Aseprite Pixel Forge

Make pixel art that reads well at 1× on screen, animates with weight, and drops into the engine
without seams, jitter or blurred pixels. The output is `.aseprite` source files, plus exported PNG
sheets, JSON sidecars and tilesets, plus a preview image for each asset.

## Neighbouring skills: who owns what

| Situation | Skill |
|---|---|
| Drawing, animating, cleaning up or exporting in Aseprite | **this skill** |
| Rendering sprite frames from 3D models first | `blender-game-asset-forge`, then back here for clean-up |
| Using the sheets in Godot: TileSet terrains, AnimationTree, particles | `godot-forge` |
| Procedural canvas sprites inside a single-HTML browser game | `game-creator-2d` |
| Pixel sprites lit in a 3D world (normal maps for sprites) | `hd2d-forge` |

## Facts checked on 2026-09-25 (re-check if more than about 3 months old)

- **Aseprite v1.3.18.6 (22 Sep 2026).** v1.3.18 came out on 22 Jul 2026. The Lua API version is 41.
- **1.3.16** changed undo behaviour in Lua: property changes outside `app.transaction` no longer create undo steps.
- **1.3.18** added the `--power-of-two-size` CLI flag, tag groups on the timeline, and Lua custom file formats. `--batch` no longer writes `aseprite.ini`.
- Some CLI flags exist in the source but are missing from the docs page: `--power-of-two-size`, `--play-subtags`, `--shrink-to`.
- **Aseprite Wizard for Godot: v9.8.0 (3 Mar 2026), Godot ≥4.3.** Compatibility with Godot 4.7 is not yet confirmed.

## Tools you have

The Aseprite MCP connector runs on the user's machine. Every tool takes an absolute `sprite` path; there is no "current sprite".

| Job | Tools |
|---|---|
| Set up | `create_sprite` (with `palette`: `db16`, `pico8`, `nes`, `gameboy` or a hex list; `color_mode: indexed` locks colours), `open_sprite`, `get_sprite_info`, `resize_canvas`, `save_sprite_as` |
| Structure | `add_layer`, `set_layer`, `reorder_layer`, `delete_layer`, `add_frame`, `duplicate_frame`, `delete_frame`, `set_frame_duration`, `add_tag`, `delete_tag`, `list_tags` |
| Draw | `draw_pixels` (up to 65,536 points per call: batch them), `draw_line`, `draw_rect`, `draw_ellipse`, `draw_gradient`, `fill_bucket`, `outline`, `apply_dither` (`checker`, `bayer2`, `bayer4`, `bayer8`) |
| Edit | `select_region`, `select_by_color`, `move_selection`, `clear_region`, `flip`, `rotate`, `crop_sprite`, `scale_sprite`, `replace_color` |
| Palette | `get_palette`, `set_palette`, `add_palette_color`, `extract_palette`, `quantize_to_palette` (the bridge for Blender renders) |
| Tiles | `create_tilemap_layer`, `add_tile`, `place_tile`, `fill_tilemap`, `export_tileset` |
| Output | `export_png`, `export_gif`, `export_preview`, `export_spritesheet` |
| Anything else | `run_lua_script`. It runs with full file-system authority, so use it only when no tool fits |

**Connector quirks that cause silent mistakes**
- Tool arguments count frames from **1**. The exported JSON sidecar counts from **0**.
- On an **indexed** sprite, hex colours snap to the nearest palette entry. Read `color_resolved` and the warnings after each call.
- If a colour resolves to the transparent index, the pixel is written **invisible** (`transparent_index_hit: true`). Keep index 0 reserved for transparency and never paint with it.
- `export_spritesheet` with layout `packed` is about 2.7× slower. Use `rows` or `horizontal` unless atlas space matters.
- With `trim: true`, the engine must re-apply the `spriteSourceSize` offsets, or sprites jitter.
- Pass `preview: true` on drawing calls, or call `export_preview`, and **look at the image**. The numbers alone won't show a mistake.

**Fallback without MCP (CLI)**
```bash
aseprite -b hero.aseprite --sheet hero.png --data hero.json --format json-hash \
  --sheet-type rows --list-tags --shape-padding 1 --extrude
aseprite -b world.aseprite --export-tileset --sheet tiles.png --data tiles.json
aseprite -b in.aseprite --script tool.lua --script-param mode=clean
```
In Lua, wrap every edit in `app.transaction("label", function() ... end)`, and read parameters from `app.params`.

**No Aseprite and no MCP: `scripts/asefile.py`**

Build machines and cloud containers often have neither Aseprite nor the connector. Don't
fall back to loose PNGs. The bundled `scripts/asefile.py` (pure Python, plus Pillow for
PNG in and out) reads and writes real `.aseprite` files, so the user still gets editable
sources.

```bash
python scripts/asefile.py from-png hero.aseprite f0.png f1.png --duration 120 --tag idle:0:1 \
    --palette palette.png --lock --outline 20,12,28      # palette-lock + 1-px outline (Blender renders)
python scripts/asefile.py info  hero.aseprite            # size, frames, layers, palette, tags, durations
python scripts/asefile.py sheet hero.aseprite hero.png hero.json   # horizontal strip + JSON the Godot builder below reads
```

- As a library: `A.write(path, A.Sprite(w, h, [A.Frame([pixels], ms)], ["art"], palette,
  tags))`, `A.read(path)`, `A.flatten(sprite, frame)`. Drawing code writes sprites
  directly.
- Scope: RGBA sprites, layers, compressed cels, palette, sRGB profile and tags. It reads
  files saved by Aseprite too, including linked cels, but not indexed or greyscale files.
- **Export from the `.aseprite` files, never from the generator's memory.** Then an edit
  the user makes in Aseprite is what ships. Verify that every exported PNG equals its
  source, pixel for pixel.
- Measured on 2026-09-26:
  - the independent npm reader `ase-parser` 0.0.19 parsed the output with matching size,
    frames, layers, tags, palette, durations and cels;
  - `sheet` output matched a game's pipeline exports pixel for pixel;
  - the Godot SpriteFrames builder below read its JSON correctly.

## Method: work in value before colour

1. **Brief.** Settle four things: the game's base resolution (e.g. 320×180 or 640×360), the tile size, the character height in pixels, and the light direction (top-left is conventional). Write them down. Every asset must obey them.
2. **Palette first.** Build the palette before drawing (below). Use an indexed sprite with the palette locked.
3. **Silhouette.** Block the shape in one flat colour. If it doesn't read as a black shape, no shading will save it.
4. **Value, then colour.** Shade with 3–4 steps of one ramp, then check it in greyscale. Foreground actors need clearly different values from the background.
5. **Clean up.** Remove orphan pixels and jaggies. Apply anti-aliasing only inside the sprite (rules below).
6. **Preview at 1× and at 3×**, in context: on the actual tile background.

## Palettes and ramps

- Start from a known palette when the user has no brand colours. DB16 or PICO-8 suit small games; Lospec palettes such as Resurrect 64 suit larger ones. Aseprite loads `.gpl`, `.pal`, `.ase` or PNG palettes.
- **Hue-shifted ramps.** Brighter steps drift toward yellow or warm, darker steps toward blue or purple.
  - Slynyrd's method uses about 20° of hue shift per step.
  - Saturation peaks in the mid-tones and never hits 0% or 100%.
  - Brightness steps get smaller toward the top.
- Aim for 4–6 steps per material ramp: skin, metal, foliage, stone.
- Share colours across ramps. The darkest shade of the foliage ramp can be the mid-tone of the shadow ramp. A small shared palette is what makes a game look unified.
- Give the background lower contrast and saturation. Keep the highest contrast for the player, enemies, pickups and hazards.

## Tiles and worlds

- **Tile size:** 16×16 is the standard; 32×32 suits detailed top-down games. Much bigger rarely pays off. Characters are usually 1–2 tiles tall.
- **Set up tilemaps with MCP:**
  1. `create_tilemap_layer` with `tile_width` / `tile_height` equal to the grid;
  2. `add_tile` to author each tile;
  3. `place_tile` / `fill_tilemap` to lay out a test room;
  4. `export_tileset` for the engine.
- **Seamless check.** Tile the texture over a 3×3 area (in Aseprite's View > Tiled Mode, or by `place_tile` in a test room) and look for seams and grid patterns. Let detail clusters cross tile edges. Keep large calm areas, because busy texture next to busy texture tires the eye.
- **Autotile sets.** Draw the set that matches the Godot terrain mode you'll use:

  | Set | Tile count | Godot terrain mode |
  |---|---|---|
  | Blob (corners + edges) | 47 | Match Corners and Sides |
  | Corner / marching squares | 16 | Match Corners |
  | Edge / Wang | 16 | Match Sides |

  Lay the atlas out in a fixed, documented order, so terrain bits can be assigned systematically in Godot.
- Variants: make 2–4 alternates of plain ground tiles to break repetition. Godot's TileSet can pick them randomly.

## Characters

- **Size.** Choose from the brief: 16–24 px tall for NES/GB-style games, 32–48 px for SNES-style or HD-2D. Heads are large, and limbs at least 2 px wide. 1-px limbs read as flat and flimsy.
- **Outlines.** A dark outline, one step darker than the adjacent ramp colour rather than black, separates the sprite from any background.
  - `outline` (corners `square`) draws a 1-px outline around a cel.
  - Selective outlining ("sel-out") lightens the outline on the lit side. Use it sparingly.
- **Anti-aliasing rules:**
  - No AA on straight lines or perfect 45° lines.
  - Soften long stair-steps with an intermediate colour.
  - Keep AA **inside** the sprite: outer-edge AA looks dirty on changing backgrounds.
  - Remove any AA that adds noise.
- **Avoid:** pillow shading (shading inward from the outline instead of from a light), banding (parallel bands of equal length), too many near-identical colours, and inconsistent light direction.
- **Directions.** Top-down games need 4 directions (down, up, side, and side mirrored) or 8. Mirror only symmetric designs; flip in the engine (`flip_h`).
- **From Blender renders.**
  1. Import the frames.
  2. Run `quantize_to_palette` with `dithering: none` for characters, or `ordered` for smoke and gradients. `to_indexed: true` locks the ramp. Without MCP, `asefile.py from-png … --lock --outline R,G,B` does the same job: it thresholds alpha at 50%, snaps colours to the nearest palette entry (redmean distance, no dither), and draws the outline outside the silhouette.
  3. Fix by hand: silhouette, stray pixels, eye and face readability.
  4. Keep camera distance and scale identical across the cast.

## Animation

Frame durations are in milliseconds (`set_frame_duration`). Name tags after engine animation
names: `idle`, `walk`, `run`, `attack`, `hurt`, `die`. For directional sets, add a suffix
(`walk_down`, `walk_up`, `walk_side`).

Typical budgets are starting points, not rules:

| Animation | Frames | Timing |
|---|---|---|
| Idle | 2–6 | 150–250 ms each; small breathing shift of 1 px |
| Walk | 4–8 | ~100–150 ms each |
| Run | 6–8 at ~80 ms; or 4 at ~160 ms (Slynyrd) | Fewer, stronger frames beat many weak ones |
| Attack | 3–6: anticipation (long) → contact (1–2 short frames) → recovery | Hold the anticipation frame; the strike should snap |
| Hurt / hit | 1–3 | Pair with the engine's white flash and hit-stop |

- **Timing and motion techniques:**
  - Animate "on twos" to save frames.
  - Use smear frames (a stretched shape along the motion path) for fast swings.
  - Squash and stretch conserves area.
  - Sub-pixel animation (shifting colour, not position) gives slow subtle motion such as blinking lights and breathing.
- **Tag directions:** `forward`, `reverse`, `pingpong`, `pingpong_reverse`. Engines that ignore the `direction` field play ping-pong wrong. Either bake the frames forward or read the field (the builder below does).
- Use onion skinning in the editor (F3). Over MCP, export a preview GIF (`export_gif`) and look at it.

## Visual effects

- **Frame budget: 3–6 frames, drawn on twos.**
  - A sharp start: 1 frame of the full-size flash or impact shape.
  - A fast expansion.
  - A slow break-up into smaller pieces or dither.
  - Layer parts on different timings (core, sparks, smoke) so the effect doesn't feel mechanical.
- **Shape before colour.** Block each frame as a one-colour silhouette first, then colour it with a 3–4-colour VFX ramp. Fire runs white-yellow → orange → red → dark red. Magic runs white → the element colour → a deep shade.
- **Dissipation.** Use `apply_dither` (`bayer4` or `checker`) to fade smoke and energy in the last frames, instead of transparency. That keeps the effect palette-true.
- **Types to reach for:**
  - hit sparks: 3–4 frames, star or cross shape;
  - dust puffs: 4–5 frames;
  - slashes: a 2–3 frame arc plus a fading trail;
  - explosions: 6–8 frames, a flash then a dithered smoke ring;
  - fire loops: 4–6 frames, seamless.
- **Blending is decided in the engine.** Aseprite layer blend modes do not survive a PNG export. Draw additive effects (fire, light, magic) on a transparent base, and set `CanvasItemMaterial.blend_mode = ADD` in Godot.

## Export and hand-off to Godot

1. **Sheet plus JSON:**
   ```
   export_spritesheet(sprite, dest=".../hero.png", json_dest=".../hero.json", layout="rows", padding=1)
   ```
   - Use `split_tags` or `split_layers` with `{tag}` / `{layer}` in the file name when the engine wants separate sheets.
   - Leave `trim` off unless atlas space matters.
2. **Tileset:** `export_tileset(sprite, tileset=<layer>, dest=".../tiles.png", columns=<n>)`. In Godot, keep **Use Texture Padding** on in the TileSet atlas.
3. **Godot settings.** Set the default texture filter to Nearest, the stretch scale mode to integer, and import textures as Lossless. See `godot-forge` for the full table.
4. **Getting animations into Godot.** The simplest route is the **Aseprite Wizard** plugin, which imports `.aseprite` directly. If the plugin isn't installed, build SpriteFrames from the JSON sidecar with the editor script below (run it from Godot's Script editor with File > Run):

```gdscript
@tool
extends EditorScript
# Builds a SpriteFrames resource from an Aseprite sheet + JSON (hash or array format).
const SHEET := "res://art/hero.png"
const DATA := "res://art/hero.json"
const OUT := "res://art/hero_frames.tres"

func _run() -> void:
	var tex: Texture2D = load(SHEET)
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(DATA))
	var raw: Variant = data["frames"]
	var frames: Array = raw if raw is Array else (raw as Dictionary).values()  # hash keeps file order
	var sf := SpriteFrames.new()
	sf.remove_animation("default")
	for tag: Dictionary in data["meta"]["frameTags"]:
		var anim: String = tag["name"]
		sf.add_animation(anim)
		sf.set_animation_speed(anim, 1000.0)  # 1000 "fps" -> frame duration below is in ms
		sf.set_animation_loop(anim, true)
		var order: Array = range(int(tag["from"]), int(tag["to"]) + 1)
		match String(tag.get("direction", "forward")):
			"reverse":
				order.reverse()
			"pingpong":
				var back := order.slice(1, order.size() - 1)
				back.reverse()
				order.append_array(back)
			"pingpong_reverse":
				order.reverse()
				var back2 := order.slice(1, order.size() - 1)
				back2.reverse()
				order.append_array(back2)
		for i: int in order:
			var f: Dictionary = frames[i]
			var r: Dictionary = f["frame"]
			var at := AtlasTexture.new()
			at.atlas = tex
			at.region = Rect2(r["x"], r["y"], r["w"], r["h"])
			if f.get("trimmed", false):  # restore trim offsets so frames don't jitter
				var s: Dictionary = f["spriteSourceSize"]
				var src: Dictionary = f["sourceSize"]
				at.margin = Rect2(s["x"], s["y"], src["w"] - r["w"], src["h"] - r["h"])
			sf.add_frame(anim, at, float(f["duration"]))
	ResourceSaver.save(sf, OUT)
	print("Saved ", OUT, " with ", sf.get_animation_names())
```

- `set_animation_speed(anim, 1000)` together with a per-frame duration in ms reproduces Aseprite's timing exactly, with no fps rounding.
- Tested in Godot 4.7.2 on a JSON-hash sidecar whose keys were deliberately out of alphabetical order. It kept file order, expanded ping-pong (2,3,4 → 2,3,4,3) and reverse tags correctly, restored trim margins, and summed durations exactly.
- Set loops to false afterwards for one-shots such as `attack` and `die`.

## Pitfalls checklist (run before handoff)

1. **Mixed pixel density:** assets drawn at different scales, or scaled by non-integers. One texel size everywhere.
2. **Seams or bleeding:** no padding or extrude on sheets, texture padding off in the TileSet, or a Linear filter.
3. **Trim without offsets:** jittering sprites.
4. **Pillow shading, banding, inconsistent light direction, near-duplicate colours:** muddy art.
5. **Outer-edge anti-aliasing:** dirty halos on other backgrounds.
6. **Ping-pong tags played forward** by an engine that ignores `direction`.
7. **Indexed transparent-index hits:** pixels drawn but invisible.
8. **Frame numbers:** 1-based in tools, 0-based in the sidecar. Off-by-one tag ranges.
9. **Lua edits outside `app.transaction`:** no undo steps (1.3.16+).
10. **Loose PNGs instead of sources** when Aseprite is missing: the user cannot edit the art. Write `.aseprite` files with `scripts/asefile.py`, and export from them.
11. **Partial alpha from renders:** it survives into the sheet as halos. Threshold alpha before the palette lock.

## Handoff

For each asset, give the user:
- the `.aseprite` path, the exported files, and the tag list with frame counts and timings;
- one preview image or GIF that you have looked at;
- the palette used;
- which parts need the user's eye in the game, such as readability over real backgrounds and feel at full speed.