# Vale of Shards: notes for Claude

An original platformer in Godot 4.7. Its rules are ported from the Xargon C source. Its
art, text, names, stages and music are original. Read `README.md` for the game, then
`docs/ANALYSIS.md` (the source), `docs/DESIGN.md` (kept, adapted or dropped) and
`docs/PIPELINE.md` (how assets, levels and routes are made).

## Ground rules

- **Mechanics may follow the source; content never does.** When you port a behaviour,
  name the source function in a comment (for example `X_OBJ2.C msg_troll`) and take its
  numbers from there. Every mechanic and every control in ANALYSIS needs a row in the
  DESIGN table.
- **Core and view are separate.**
  - `godot/scripts/core/` is pure rules. It steps at 18.2 Hz, uses no nodes, and runs
    headless. `game.gd` holds the state and helpers, `kinds.gd` every object's behaviour,
    and `level.gd` the level file format.
  - `godot/scripts/view/` draws the core and feeds it input. `main.gd` holds the app
    states and the harness, `world.gd` the play view, and `ui.gd` the HUD and windows.
    `controls.gd` builds the input map for keys and pads.
- **Content is data.** `content/data/text.json` and `content/levels/*.txt` are hand-edited.
  The pipeline writes everything else in `content/`.
- **A level change needs its route re-recorded:** `bash tests/make_routes.sh <stage>`.
  `replay_routes.gd` then proves the stage can still be finished. A route that cannot be
  found usually means the level is wrong. See the bugs below.

## Commands (from `vale-of-shards/`)

| what | command |
|---|---|
| every check | `bash tests/run_all.sh` (about 10 min; `--quick` skips the playthrough and the export) |
| core suite | `godot --headless --path godot --script res://tests/run_tests.gd` |
| route for one stage | `godot --headless --path godot --script res://tests/route.gd -- level=mines write` |
| whole game | `godot --headless --path godot --script res://tests/playthrough.gd` (about 4 min) |
| scripted session | `timeout 120 godot --headless --path godot --quit-after 900 -- --script=stage:hollow,key:right,wait:30,keyup:right,dump` |
| stage from the pad | `... --quit-after 30000 -- --script=replay:hollow:pad` (prints `REPLAY hollow ok`) |
| screenshot | `xvfb-run -a -s "-screen 0 1280x720x24" godot --path godot --rendering-driver opengl3 --resolution 1280x720 -- --script=replay:canopy:kb --shot=/tmp/s.png --frames=900` |
| Windows exe | `godot --headless --path godot --export-release "Windows Desktop" ../dist/windows/vale-of-shards.exe` |

Harness commands (in `main.gd run_harness`), one every 6 frames:

| command | what it does |
|---|---|
| `stage:NAME[:god]` | start in a stage |
| `newgame` | start a new game |
| `key:K`, `keyup:K`, `tap:K` | keyboard events |
| `pad:B`, `padup:B`, `ptap:B` | gamepad button events |
| `axis:lx:-1` | a stick axis |
| `wait:N` | wait N frames |
| `replay:STAGE:kb` or `:pad` | play a recorded route through device events |
| `dump` | print the state |
| `close` | close a text window |

An unknown command prints `HARNESS unknown`, and `run_all.sh` fails on it.

- Wrap every Godot run in `timeout`. A SceneTree script whose `_init` fails never quits.
- Screenshots only work under `xvfb-run`.
- `pkill -f playthrough` also matches your own shell's command line and kills it. Kill by
  PID instead.
- Godot's stdout is buffered when it goes to a file. Long background runs show nothing
  until they exit. Use `printerr` for progress.

## Bugs found while building (keep this log)

| found | cause | fix | what guards it now |
|---|---|---|---|
| the stage 1 vine route was not found | the upper shelf touched the vine column, and Orrin's 24 px box hit it while climbing | vines keep one clear column beside them | the route checker |
| Orrin fell through the stage 5 grate into lava | lava sat directly under the plank, and the 8 px dip before landing touched it | the lava lake is one cell lower | the route checker |
| the Spire's crystal wall never opened | a marker cell took its neighbour's tile, so the bridger's own cell was not a beam | `on=<char>` in the legend | the playthrough (boss, then heart crystal) |
| stage 4 could be left without the gate key | the exit only looked for loose tokens, not crates that hold one | `_gatekey_left` also counts crates with drop 10 | the route's `have:gatekey` goal |
| the first touch of a map marker threw the walker to (0,0) | the marker's return spot is recorded by its own update, which runs after the walker's touch | stay put while no spot is recorded | the playthrough (the map walk to stage 1) |
| blinking boughs changed timing with the time spent on the map | the source's blink cycle runs off the global step count | a per-stage step counter (DESIGN row 40) | playthrough plus replay_routes |
| the export check never saw stage 1 finish | the screenshot fired at frame 1200, before the replay ended | `--frames=3000`; replays quit the harness when they end | `verify_export.py` |
| the harness never reported the Spire replay | the ending screens took over before the replay was marked done | a replay ends at `gameover == 2` or a stage exit | the Spire pad replay in `run_all.sh` |
| the title menu ran off the screen | 9 items at 11 px rows under the logo | 10 px rows, starting at y 74 | screenshot review |

## Delivering a playable build

- Export `Windows Desktop`, then pack it with 7z using the x86 BCJ filter and LZMA2
  preset 9 extreme (see `gates-below/CLAUDE.md`). Unpack it again and compare SHA-256
  hashes before sending.
- The size budget is tight. The exe is 115 MB, and the 7z comes to 29.3 MiB against a
  30 MiB limit. With the music at Vorbis quality ~0.35 it was 30.2 MiB, so
  `make_music.py` now uses ~0.25 (4.4 MB of music). Any new asset has to fit in the
  0.7 MiB that is left.
- Run the replays against the exported data before sending:
  `godot --headless --main-pack dist/windows/vale-of-shards.exe --quit-after 30000 -- --script=replay:hollow:pad`.
- Put a CRLF `README.txt` beside the exe. It holds:
  - the controls;
  - the save folder, `%APPDATA%\Godot\app_userdata\Vale of Shards\saves`;
  - the "Windows protected your PC → More info → Run anyway" note, since the exe is not
    signed.
