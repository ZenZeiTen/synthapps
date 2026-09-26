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
| routes for all stages | `bash tests/make_routes.sh` (after any rules change; the jump change in 2026-09 needed all six) |
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
| `replay:STAGE:pad:talk` | the same, but each dialog stays open until the script pages it (`ptap:a`) |
| `waitmodal` | wait for the next dialog of a talk replay (prints `HARNESS waitmodal: ...` if the replay ends first) |
| `dump` | print the state (in a dialog: `modal=dialog:<speaker>`; in the ending: `phase=` and `page=`; in the slot menu: each row and its date; on a title page: `title=`) |
| `set:score:N`, `set:done:N` | state shortcuts for setting up a check: the score, and N stages done |
| `fit` | print `FIT ok`, or every text drawn outside its frame since the last `fit` (`over:`, or `clip:`/`wrap:` when a menu or window had to cut it to fit) |
| `fitall` | draw every window in `text.json` and the Controls page, one per frame (follow it with `fit`) |
| `close` | close a text window |
| `quit` | quit (a script otherwise runs until `--quit-after`) |

An unknown command prints `HARNESS unknown`, and `run_all.sh` fails on it. Harness runs keep
their saves in `user://saves_harness`, start from the default options and an empty score
table, and write `options_harness.cfg` and `scores_harness.json`: a run never reads or changes
the player's files.

- **Text must fit its frame.** Menus grow to fit their items (up to 316 px), and a window line
  wider than the widest window is wrapped, but both are only guards: `fit` reports them, and
  `run_all.sh` fails. With a portrait, a window line holds 40 characters; without, 47.

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
| **player report:** the game froze after the heart crystal, with no ending | the ending pages returned to a mode `name_check` that nothing handled; fire and jump also turned the pages, so a player still firing at the crystal skipped all three at once and landed on the frozen screen | a real ending mode (fade, dawn scene, pages, credits, then scores and the title); buttons are ignored for 0.8 s on each page | the Spire and ending check in `run_all.sh` fires during the fade and must reach the title |
| no check ever saw the ending | replays stop at `gameover == 2`, and the playthrough runs the core only | the Spire check keeps driving the harness after the replay ends | the same check |
| **player report:** the jump felt delayed and stiff | the source's 2-step hang before the first rise (110 ms), a 4 to 7-step landing lag before running again, one pose for the whole rise, and a front-facing pose on straight-up jumps and landings | the jump rises on the press step, landings run on, and there are takeoff, apex and landing poses in profile; a jump buffer and a ledge grace (DESIGN rows 9, 10, 66, 67) | `run_tests.gd` jump checks (each fails on the old core) |
| **player report:** no scene before the final boss | the source has none | the Regent's meeting (DESIGN row 45) | the Spire check expects the Regent's and Orrin's lines before the fight |
| the game's manifest copy went stale | `godot/content/data/manifest.json` was copied by hand once | `pipeline/manifest.py` writes both copies | re-running the pipeline |
| closing a dialog with A (jump) made Orrin jump as the game resumed | the press was latched for the next step, and the still-held button read as a fresh jump | the button that closes a window is ignored by the game until it is released (`main.gd _swallow_held`) | the Spire check's talk replay, which desyncs if a jump leaks |
| the playthrough lost the Mines after the jump change | recorded inputs assume the recording's random numbers; in the playthrough a stone bounced differently and the run drifted. The old routes had passed by luck | each replayed segment must reach its goal from the level's `route:` line, or is searched again live from the real state | `playthrough.gd` prints how many segments were re-searched |
| **player report:** a Load Game row ran past the menu's right edge | the label "5 of 6 stages  23588 pts  09-27 05:35" (40 characters, 240 px) sat in a 250 px menu that starts text 18 px in. The story page 2, How to Play and Controls windows also ran off the screen, every dialog's page prompt sat on the bottom border, the space glyph's placeholder pixel showed as a dot in double spaces, and a lowercase p looked like a capital P | the slot menu shows the stages and score on the left and the date in its own column, built from each save's state (so old saves show the same way); menus grow to fit, long window lines wrap; the long lines were rewritten; the prompt moved up; spaces are not drawn; p and q were redrawn at letter height | the UI's fit audit: `run_all.sh` checks every text.json window, the story, help and Controls pages, the widest save row (6 stages, 7-digit score) and the Spire and ending |
| **player report:** an invisible barrier after opening the gates | the gates stand in one-cell gaps through the river and the rocks. The map walker moves 4 px a step and only when its whole box is clear, so a walker a few pixels off the path's row (easy after turning a corner) stopped at the banks beside the open gate | the walker slides up to 12 px sideways toward an opening, and a blocked diagonal walks along the open side (DESIGN row 69) | `run_tests.gd test_map_gate_off_row` (fails on the old core) |
| **player report:** the screen froze for a while after the final boss when shooting mid-air | the Regent's and the heart crystal's blasts hold Orrin still for 60 steps (3.3 s); the hold froze him wherever he was, so a killing shot fired mid-jump left him hanging in the air, deaf to every button | a hold that begins in mid-air falls to the floor in the falling pose, then holds (DESIGN row 68). The Spire route was re-recorded: its kill came mid-jump | `run_tests.gd test_still_in_air_lands` (fails on the old core); the Spire route and talk replay |
| the Spire check passed in `run_all.sh` but not against the exported exe | harness runs shared the player's score table; ten test scores filled it, the next score no longer qualified, and the ending went straight to the title instead of the name entry the script expects | harness runs start with an empty table and write their own files | the Spire check, now the same on every machine |
| a new image could be left out of the export unnoticed | the export check only played stage 1 | the `assets` harness command loads every manifest sprite and music track; `verify_export.py` runs it inside the exported build | `verify_export.py` |

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
