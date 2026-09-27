# Tidebell: notes for Claude

An original sword game in two builds: Godot 4.7 (desktop) and three.js (browser). Its rules
are measured from The Pirates of Dark Water (Sega Genesis, USA). Its art, text, names,
stages and music are original. Read `README.md` for the game, then `docs/ANALYSIS.md` (the
cartridge), `docs/DESIGN.md` (kept, changed or dropped) and `docs/PIPELINE.md` (how assets,
levels and routes are made).

## Ground rules

- **Mechanics may follow the cartridge; content never does.** No name, character, line of
  text, graphic, map or tune from the cartridge or the cartoon it is based on. The ROM is
  never committed; `tools/rom/probe.py` takes its path as an argument.
- **Every rule has an ID** (M1, A3, H7, I8, S12 in DESIGN.md). Code comments cite the ID.
  A number measured from the cartridge says so in ANALYSIS.md, with the probe that shows it.
- **One set of rules, two cores.** `godot/scripts/core/*.gd` and `web/src/core/*.js` are
  line-for-line ports of each other: 16.16 fixed point, 60 steps per second, xorshift32
  random numbers. Change both, then run `bash tests/parity.sh`. It must print
  `PARITY ok`.
- **Core and view are separate.** The cores use no nodes and no DOM, and run headless.
  `game.gd`/`game.js` hold the state and the hero, `kinds` every object's behaviour,
  `level` the level format, `code` the tide-code, `inputs` the packed input byte. The views
  (`godot/scripts/view`, `web/src/view`) draw the core and feed it input. `main.gd` and
  `app.js` hold the screens and the harness.
- **Content is data.** Edit only `content/` (rules numbers in `data/defs.json`, text in
  `data/text.json`, `levels/*.txt`). `python3 pipeline/sync_content.py` copies it to
  `godot/content` and `web/public/content`; `tests/verify_content.py` fails on a stale copy.
- **A level or rules change needs its routes re-recorded:** `bash tests/make_routes.sh
  [stage...]`. `replay_routes.gd` then proves each stage can still be finished. A route
  that cannot be found usually means the level is wrong.

## Commands (from `tidebell/`)

| what | command |
|---|---|
| every check | `bash tests/run_all.sh` (about 25 min; `--quick` skips the playthrough, the export and the browser) |
| browser only | `bash tests/run_web.sh` (build, parity, then `web/tests/check.mjs`; `ONLY='^replay_reach' node web/tests/check.mjs` runs some cases) |
| core suite | `godot --headless --path godot --script res://tests/run_tests.gd` |
| route for one stage | `bash tests/make_routes.sh cliffs` |
| whole game | `godot --headless --path godot --script res://tests/playthrough.gd` |
| scripted session | `timeout 120 godot --headless --path godot --quit-after 900 -- --script=stage:reach,key:right,wait:30,keyup:right,dump` |
| stage from the pad | `... --quit-after 40000 -- --script=replay:reach:pad` (prints `REPLAY reach ok`) |
| screenshot | `xvfb-run -a -s "-screen 0 1280x960x24" godot --path godot --rendering-driver opengl3 -- --script=stage:reach,wait:60 --shot=/tmp/s.png --frames=90` |
| browser page with a script | `http://127.0.0.1:8421/?fast=8&script=replay:reach:pad` after `node web/tools/serve.mjs` |
| art, all of it | `bash pipeline/build_art.sh` (see PIPELINE.md for Blender, reality.js and audio) |
| exports and the 7z | `python3 tests/verify_export.py` |

Harness commands (`main.gd run_harness` and `app.js`, the same in both), one every 6 frames:

| command | what it does |
|---|---|
| `newgame` | start a new game from the title |
| `stage:NAME[:hero]` | start in a stage |
| `key:K`, `keyup:K`, `tap:K` | keyboard events |
| `pad:B`, `padup:B`, `ptap:B`, `axis:lx:-1` | gamepad events (the browser uses a virtual Gamepad API pad) |
| `wait:N` | wait N frames |
| `replay:STAGE:kb` or `:pad` | play a recorded route through device events; `:talk` leaves each story page open for the script to page; `:end` keeps going after the stage |
| `waittalk` | wait for the next story page |
| `dump` | print the state (`mode=`, `cur=`, `stage=`, `pos=`, `page=`, `who=`, `phase=`) |
| `set:score:N`, `set:done:N`, `set:hp:N`, `set:items:...` | shortcuts for setting up a check |
| `fitall`, `fit` | draw every window with real text; print `FIT ok` or each text outside its frame |
| `assets` | load every sprite, still and track in the manifest; print `ASSETS ok` |
| `quit` | quit |

An unknown command prints `HARNESS unknown` and the run fails. Harness runs keep their
options, best score and last code in `user://harness/`, which is cleared at start: a run
never reads or changes the player's files.

- Wrap every Godot run in `timeout`. A SceneTree script whose `_init` fails never quits.
- Screenshots only work under `xvfb-run`.
- `pkill -f godot` or `pgrep -f` also match your own shell's command line. Kill by PID
  after checking `/proc/PID/cmdline`.
- Playwright is pinned to 1.56.1 because that version matches the preinstalled Chromium.
  Do not run `playwright install`.
- Under `set -o pipefail`, `diff | head` fails with 141 when head closes early. Write to a
  file first.

## Bugs found while building (keep this log)

| found | cause | fix | what guards it now |
|---|---|---|---|
| the jump reached 73 px, not the measured 81 | gravity was applied on the launch step | no gravity on the step that launches | `run_tests.gd` jump height and air time |
| spikes acted as a floor | spikes were solid tiles | spikes are a contact hazard, not a floor | `run_tests.gd test_spikes_hurt_by_difficulty` |
| a captive never spoke when the check started a stage mid-way | objects woke only when they came on screen, and a check that placed the hero skipped that | posts, chests, captives and pickups are active from the start | `run_tests.gd test_captive_talks_after_landing`, the stage 1 talk replay |
| the route search stalled on the cliffs | it scored the nearest waypoint, not progress along them | each search state carries its own waypoint progress | `make_routes.sh cliffs` |
| the abbey's key could never be used | the gate needed the item button; the search never tried it | a gate opens when the hero walks into it carrying the key (DESIGN I8) | the abbey route and replays |
| the search left the Silt King at 2 health | killing him removed his score term, so the kill looked worse | a fallen guardian is worth +100000 | the brinecrow route |
| routes ran out of health | no way to reach a tonic mid-fight without pausing | Up + item switches items (a new control, DESIGN row), and the search can heal | playthrough |
| `check_parse` passed with a broken script | `load()` succeeds on a script that does not compile | it calls `can_instantiate()`, proven with a planted error | `run_all.sh` parse step |
| `Font` script class would not load | it shadowed Godot's native `Font` | renamed `PixelFont` | parse step |
| Enter closed the pause menu instead of choosing | Enter was both confirm and close | only Esc, Back and Start close it | the walk check |
| the hub cursor jumped to the top after Talk | returning to the hub reset it | `to_hub(keep)` | the walk expects `cur=1` after Talk |
| the hub header was 1 px outside its frame | the portrait pushed the text | text moved, portrait removed | `fit` |
| parity diff hid its own message | `diff \| head` under pipefail exits 141 | diff to a file first; a planted change was caught | `parity.sh` |
| every web window turned the text colour | text was tinted with `source-atop` on the shared canvas | one cached, pre-tinted font sheet per colour | the browser screenshots |
| Brannoch's colours ran together; the Silt King's hat read as a cone | too close in value; a cone primitive | new colours and a grey beard; a brim and crown hat, matte | contact sheet review |

## Delivering a playable build

- `python3 tests/verify_export.py` exports both platforms, runs the asset check, a stage 1
  pad replay and the whole final check (Silt King, ending, credits, title) against the
  exported data, then packs `dist/Tidebell-windows.7z` with the x86 BCJ filter and LZMA2
  preset 9 extreme and checks that it unpacks byte-identical.
- The size budget is tight: the 7z is about 28.1 MiB against the 30 MiB limit.
- `dist_readme.txt` goes beside the exe as a CRLF `README.txt`: controls, the save file
  (`%APPDATA%\Godot\app_userdata\Tidebell\tidebell.cfg`) and the unsigned-exe note.
- The browser build is `web/dist/` after `node web/tools/build.mjs`: a static folder.
