# Asset pipeline

Every pixel and sound in the game is made here, and all of it lands in `content/`:
the engine-agnostic package that the browser build and the Godot build both read.
Nothing in `content/` is edited by hand.

```
pipeline/aseprite/art.mjs   ASCII pixel definitions (sprites, 49 textures, 5x9 font)
   └─ build_art.mjs ──(Aseprite MCP)──> art/aseprite/*.aseprite    editable sources
                                        art/textures/*.png         -> Blender materials
                                        content/sprites, content/font
pipeline/blender/rooms/*.py  one script per room, built with kit.py
   └─ build_rooms.py ──(Blender)──────> build/rooms/<room>/  color, ids, depth, walk,
                                        light passes + meta.json, per state as well
                                        art/blender/<room>.blend   editable scene
pipeline/post/compose.py ─────────────> content/rooms/<room>/  bg.png, depth.png,
                                        ov_<state>.png, room.json
pipeline/audio/make_sfx.py ───────────> content/sfx/*.wav + sfx.json
pipeline/audio/make_music.py ─────────> content/music/*.wav + music.json
tools/sync_godot.mjs ─────────────────> godot/content/ (raw copy; PNG/WAV imported as "keep")
tools/bundle_web.mjs ─────────────────> dist/crowmere-hill.html (+ .fragment.html)
```

## Rebuilding

Run from the repository root, in this order. Textures feed the Blender rooms, so art
comes first.

```bash
node pipeline/aseprite/build_art.mjs
```

```bash
blender -b --factory-startup --python pipeline/blender/build_rooms.py -- gate hall library kitchen bedroom cellar
```

With the Blender MCP connected, you can instead exec `pipeline/blender/build_rooms.py` in the live
session and call `build_room('hall')`. Both routes run the same code.

```bash
python pipeline/post/compose.py
```

```bash
python pipeline/audio/make_sfx.py
```

```bash
python pipeline/audio/make_music.py
```

```bash
node tools/sync_godot.mjs
```

```bash
node tools/bundle_web.mjs
```

`compose.py` takes room names, or composes every room under `build/rooms/`. After any
content change, run the checks in the README. They catch geometry that has moved
out from under a puzzle.

## How a room becomes EGA

A room script places textured boxes, cylinders and prisms in metres, then marks up
the scene:

- named floor **points** (where Gus stands to use something)
- exit **zones**
- item **markers**
- **states**, which are toggles such as an open door

`Room.render_passes()` renders five passes per state at 320x168. A pixel aspect of
1.2 makes 320x200 on a 4:3 monitor look right.

| pass | engine and settings | encodes |
|---|---|---|
| `color` | Workbench, FLAT + TEXTURE, Standard view, dither 0, AA off | final flat colours, already on the palette (F1–F6) |
| `ids` | Workbench, OBJECT colour, Raw | outline-group id = R + 256·G (F10) |
| `depth` | Workbench, VERTEX colour, Raw | horizontal distance along the camera's forward axis, bytes 1–254; 0 = sky (F7) |
| `walk` | Workbench, VERTEX colour, Raw: walkable surfaces plus generated footprints, nothing else | the floor plan through the camera. R = 255 where Gus may stand, G = that floor's depth |
| `light` | EEVEE, every surface swapped to white clay | how much light each pixel gets (F11) |

**The walk pass is a floor plan, not a picture of the floor.**

- Every object that stands on a walkable surface, or hangs below 1.3 m over one, gets
  a flat no-walk **footprint** under it. A tabletop blocks the floor between its legs.
- Things that lie flat on a surface, such as a mat, don't block.
- Objects don't hide the floor behind them: Gus can walk behind a table, and the
  renderer hides his legs by depth.
- Only walls, door frames and the backdrops beyond doorways are flagged
  `occlude=True`. Floor they hide is somewhere Gus must never stand.
- `R.blocker()` adds a limit that no object provides, and `R.probe()` declares a spot
  that must be walkable or blocked. The lint suite checks every probe.

An earlier version rendered every object as an occluder and marked the floor it could
still see. That let Gus walk under the kitchen table, through the floor visible
between its legs, and put an invisible wall behind it, where the tabletop hid the
floor. A player reported both. The kitchen probes pin the fix, and
`tests/mutation_walk.mjs` replays that bug to prove the check catches it.

To re-render only the walk masks after a change like that, which leaves every art
pass and `bg.png` byte-identical:

```bash
blender -b --factory-startup --python pipeline/blender/build_rooms.py -- --walk-only
```

`compose.py` then does four things:

1. **Shades.** Each EGA colour has a ramp of darker EGA colours (white → light grey →
   dark grey → black, yellow → brown → black, and so on). The light pass picks a
   position on the ramp, and a 4x4 Bayer matrix dithers between neighbouring steps.
   Colour is never blended. Very bright pixels step *up* the ramp as highlights.
   Glowing objects (flames, lit windows, the moon) skip shading.
2. **Outlines.** A 1-px black line goes on the nearer object wherever the object id
   changes *and* depth jumps. Silhouettes get a line; creases such as wall-to-floor don't.
3. **Walk mask.** Walkable pixels are eroded 3 px sideways and 0 px vertically, so
   Gus's feet stay on the floor without sealing thin thresholds. Every point is then
   snapped onto walkable floor, and the mask is stored run-length encoded in
   `room.json`.
4. **Overlays.** Each state is diffed against the base render. The changed pixels are
   cropped into `ov_<state>.png`, and item sprites are placed at their markers.

## How the music is made

`make_music.py` holds four original scores as plain text, one line per part. For
example, `A4:2 D5:1 F5:2 E5:1` is a phrase and `[F3,A3,D4]:6` is a chord. It
renders them with two-operator FM synthesis, the way an AdLib card's OPL2 chip made
sound in 1990.

| track | plays | style |
|---|---|---|
| Crowmere Hill | title screen, gate | D minor waltz in 6/8, theremin lead over organ and plucked bass |
| Tiptoe | hall, library, kitchen, bedroom | A minor staccato harpsichord, with the grandfather clock ticking |
| Down Below | cellar | E Phrygian drone, distant bells, drips, a faint heartbeat |
| Delivery Complete | ending | the title's opening call in D major |

The files are 8-bit mono WAV at 22050 Hz, which is what a sound card of the day
played. That keeps all four pieces to 2.2 MB.

Every loop is rendered twice and only the second pass is kept. Notes still ringing
at the end of the loop are then already sounding at its start, so the seam can't be
heard. Mixing levels were set by measuring each part's loudness: in every piece the
melody is at least as loud as each accompaniment part.

`tests/verify_music.py` checks three things:
- the files match `music.json`;
- every loop seam is as smooth as an ordinary sample step;
- every melody note sounds at its written pitch (152 notes).

The expected pitches come from the checker's own reading of the note names, so a
parser bug can't agree with itself. `tests/mutation_music.py` plants faults in the
synth (sharps ignored, wrong octave, seam cut from the first pass, late notes,
16-bit output) and requires the check to catch each one.

## Measured facts

Every setting above exists because something was measured. The facts are numbered
because `pipeline/blender/kit.py` cites them. The Blender facts were measured with
Blender 5.2, the Aseprite facts with the Aseprite MCP v0.3.0 server. Re-measure after
upgrading either tool. The raw probe renders were throwaway files. The build-wide
checks (F6, F7, F10) were re-run on 2026-09-24 against `build/rooms/`.

### Blender

| # | Fact | Evidence | What the code does about it |
|---|---|---|---|
| F1 | Workbench FLAT + TEXTURE, sampling a PNG texture *file*, with the Standard view transform, reproduces all 16 EGA colours exactly. | An 8x8 render of a 4x4 texture holding the 16 colours: 16 of 16 exact. | The `color` pass uses exactly these settings. |
| F2 | AgX, Blender's default view transform, shifts 15 of the 16 colours (#0000AA came out as (1, 55, 160)). | Same probe with AgX. | The kit sets Standard explicitly on every colour render. |
| F3 | The Raw view transform writes linear values: 170 becomes 103, and 14 of 16 colours are off. | Same probe with Raw. | Raw is used only for data passes, where the stored bytes are the payload. |
| F4 | Generated (in-memory) images sample as black in Workbench. Only images loaded from disk work. | The probe with a generated texture rendered only (0,0,0) and (1,1,1). | Textures are PNG files in `art/textures/`, made by the Aseprite step. |
| F5 | Render dither, on by default, adds ±1 noise to flat colours: one grey rendered as 188/188/188, 188/188/189 and 189/189/189. | Colour-type probes. | `render.dither_intensity = 0`. |
| F6 | With F1–F5 applied, plus Closest texture sampling and render AA off, all 15 colour passes of the six rooms (806,400 px) are on the EGA palette. So are the shipped `bg.png` and all 9 overlays. Closest and AA-off were set from the start and never measured in isolation. | Build-wide palette check. | `compose.py` never has to snap a colour. |
| F7 | VERTEX colour + Raw carries depth to within ±1 step. Byte = 1 + 253·(d − near)/(far − near). Across 40 floor points in 6 rooms, predicting the byte at the pixel centre leaves a residual of max 1.23 and mean 0.35 steps (39 of 40 within 1). Reading the *rounded* pixel instead costs up to one pixel row of depth: 3–5 steps at the back of a room. | Build-wide check against the analytic distances in `meta.json`. | Sprites are hidden where scene depth is more than 2 steps nearer than their feet. Readers sample the pixel that *contains* a point. |
| F8 | In a freshly built scene, `world_to_camera_view` sees a stale camera matrix until the view layer updates. The first probe divided by zero. | Failure while projecting points. | The kit calls `view_layers[0].update()` before projecting. |
| F9 | Workbench's own object outline is anti-aliased (7 grey levels in a probe), so it can never be palette-exact. | Outline probe. | Outlines are drawn in `compose.py` from id and depth edges. |
| F10 | OBJECT colour + Raw carries small integers exactly. R + 256·G decodes to a valid group id on every pixel of all 15 id passes. | Build-wide check against each `meta.json` group table. | The `ids` pass drives outlines and glow. |
| F11 | The EEVEE light pass is continuous (689 distinct values in a probe room). | Light probe. | `compose.py` quantizes it onto EGA ramps with ordered dithering. |

Two Blender behaviours that aren't about pixels, both learned by failure:

- Deleting a scene leaves its objects, meshes and materials behind. The kit purges
  every datablock with the room's name prefix before rebuilding.
- A room module written during a live session isn't importable until
  `importlib.invalidate_caches()` runs. `build_rooms.py` calls it.
- By default Blender stamps `Date` and `RenderTime` into every PNG it writes, so an
  unchanged scene re-rendered to different bytes. That would be a binary diff in git
  on every rebuild. The kit turns all `use_stamp*` options off. Passes rendered
  before that change still carry stamps until their next full rebuild.
- In a long-lived session, reloading a room module does not reload the helpers it
  imports. An edit to `rooms/_shell.py` silently didn't apply until `build_rooms.py`
  started reloading every `rooms._*` module first.

### Aseprite MCP

| # | Fact | Evidence | What the code does about it |
|---|---|---|---|
| A1 | Exports are palette-exact. | A 4x4 probe: 16 of 16. `tests/verify_art.py` now checks every sprite frame, the font sheet and all 49 textures pixel-for-pixel against their ASCII source. | Nothing to correct. The check stays in the test list. |
| A2 | On exFAT (the E: drive) the server's post-write check fails spuriously (`E-WRITE-UNCONFIRMED`) because exFAT file times are too coarse. | Failures on E:, success on NTFS. | `build_art.mjs` edits in `os.tmpdir()/crowmere-aseprite` (NTFS) and copies the results into `art/aseprite/`. |
| A3 | Windows filenames are case-insensitive, so `tex_c_b` and `tex_c_B` were one file. | `verify_art.py` found a texture holding the wrong colour. | Solid-colour textures are named by colour (`c_black` … `c_white`). |
| A4 | `export_png` returns no `bytes` field. | Result inspection. | Sizes are read from disk. |

A2 and A4 are worth reporting upstream to the Aseprite MCP project.

### Godot export

Measured with Godot 4.7.2 on 2026-09-24 by exporting a pack from a scratch copy of the
project.

| # | Fact | Evidence | What the code does about it |
|---|---|---|---|
| G1 | A folder carrying `.gdignore` is left out of exports, **even when the preset's include filter names it**. | A 59 KB pack holding only scripts, the scene and shaders. None of the 61 content files. | `godot/content/` has no `.gdignore`. |
| G2 | A `<file>.import` sidecar with `importer="keep"` makes the editor leave the file untouched. The exporter packs it byte for byte. | Every one of the 61 content files in the pack has the source's md5, and no imported copies appeared under `.godot/imported`. | `tools/sync_godot.mjs` writes that sidecar for every PNG and WAV. |
| G3 | `--export-pack` needs no export templates; `--export-release` to an `.exe` does. | The pack exported with no templates installed. | `tests/verify_godot_export.py` checks the export through a pack. |
| G4 | A PCK file (format 4) keeps a table of contents at an offset given in its header, with an md5 for every file. | Parsed; each stored md5 matches its bytes. | The verifier reads the table itself and refuses any other format version. |
| G5 | The first full editor scan writes a `.uid` file beside each script and shader. | They appeared after the first export. | Committed, as Godot recommends. |
| G6 | Quitting while music plays leaks the stream and its playback at exit. Stopping the players in `_exit_tree` is too late. | `--verbose` exit report: `AudioStreamWAV` and `AudioStreamPlaybackWAV` leaked. Gone after stopping the players and waiting 0.1 s. | Every quit, including the window's close button, goes through `quit_cleanly()` in `main.gd`, with `auto_accept_quit` off. |

`python tests/verify_godot_export.py --run` exports the real preset, requires every
content file byte for byte and no test scripts, then starts the game from the pack alone.
Three planted faults, all caught:
- bringing back the `.gdignore` (61 files missing);
- a texture importer on one PNG (1 file changed);
- a preset that ships the test scripts (6 found).
