# Gates Below: notes for Claude

A first-person party dungeon crawler in Godot 4.7. Its rules are reverse-engineered from the
Gates of Skeldal (1998) C source. Everything else is original: art, text, maps, names,
music. Read `README.md` for the game and `docs/` for the analysis, design and pipeline.
This file holds what a new session needs in order to work safely. It includes what went
wrong while the game was built, so the same mistakes are not repeated.

## Ground rules

- **Mechanics may follow the source; content never does.** Don't copy Skeldal's text, art,
  maps or names. When you port a behaviour, cite the source file and line, as the code
  comments do (for example `CLK_MAP.C clk_fly_cursor`), and read the actual numbers there.
  One slip: the right-click zones were first split at 60% of the view height, but the
  source splits at half (`yr>180` of 360).
- **Core and view are separate.**
  - `scripts/core/` is pure data and rules: no nodes, no rendering, and it can be tested
    headless.
  - `scripts/view/` draws the game and turns input into core calls.
  - A bug found in play should be reproduced through the view, the way a player hits it
    (see the automation section below).
- **Content is data.** `godot/content/data/*.json` (items, monsters, dialogues, shops,
  spells) and `content/levels/*.json` are the only hand-edited content. Everything else
  in `godot/content/` is written by `pipeline/` (see `docs/PIPELINE.md`).

## Commands (run from `gates-below/`)

| what | command |
|---|---|
| every check | `bash tests/run_all.sh` (a few minutes; stops at the first failure) |
| core suite only | `godot --headless --path godot --script res://tests/run_tests.gd` |
| export check | `python3 tests/verify_export.py` (Linux build, run from a temp folder, screenshot) |
| scripted session | `timeout 300 godot --headless --path godot --quit-after 3000 -- --script=seed:5,dump,click:495:150,wait,wait,dump` |
| screenshot | `xvfb-run -a -s "-screen 0 1280x720x24" godot --path godot --rendering-driver opengl3 --resolution 640x360 -- --script=seed:5,ov:help --shot=/path/out.png --frames=40` |
| Windows exe | `godot --headless --path godot --export-release "Windows Desktop" ../dist/windows/gates-below.exe` |
| run the exe's data here | `godot --headless --main-pack dist/windows/gates-below.exe --quit-after 3000 -- --script=...` |
| new art or sound files | `python3 tools/mark_keep.py` (writes `importer="keep"` sidecars), then `python3 tests/verify_art.py` |

- Wrap every headless run in `timeout`. A script error can leave Godot running forever.
- Use `--quit-after 3000` for scripted runs. Commands run every 6 frames and wait for
  camera tweens, and headless frames are short. With 150, a run stopped after 3 of its
  6 dumps, and it gave no error.
- Take screenshots under `xvfb-run` only. A `--headless` run with `--shot` hung.
- When Godot prints a chain of errors, fix the **first** `SCRIPT ERROR`. The rest (failed
  dependencies, `Nonexistent function 'new'`, calls on Nil) follow from it.
- Noise that is safe to ignore:
  - `N resources still in use at exit` and `ObjectDB instances were leaked` (both appear
    on `main` too);
  - ALSA, PulseAudio and V-Sync warnings under xvfb.

  To tell old noise from a new problem, run the same command after `git stash`.

`tests/run_all.sh` rules (hardened after a review of the build session):
- `set -eo pipefail`. Without `pipefail`, a failing core suite piped into `grep` did not
  stop the run. This was proven with a deliberate rule bug: the run printed "122 passed,
  2 failed" and carried on.
- The balance runs must meet a minimum number of wins (`need_wins`). Printing "wins N/M"
  is not a check.
- Every smoke run ends with `dump`, and the check requires that line, so a run that stops
  early fails.
- `_run_cmd` prints `HARNESS unknown command: …` for a typo such as `key:W` (there is no
  key command). The smoke check fails on it; before, a typo silently did nothing.

## The automation harness (`main.gd`)

`--script=a,b,c` runs one command every 6 frames. `--shot=path --frames=N` saves a
screenshot and quits. The commands live in `_run_cmd`:

- **Real input:**
  - `click:x:y` and `rclick:x:y` go through `_click_at`, the same router a mouse click
    uses. Coordinates are in the 640×360 canvas.
- **State shortcuts:**
  - `ov:name` sets the overlay directly;
  - `shop:id` opens a shop directly;
  - `at:x:y:dir` teleports the party;
  - `give`, `flag`, `level`, `tick:n`.
- **Reporting:** `dump` prints
  `DUMP pos=x,y dir=d level=… seen=n overlay=… held=… packs=a,b,c,d gold=g`.
  Tests grep this line.

**Test what the player does, not what the code allows.** The shop bug below survived
because every test opened screens with `ov:` and `shop:`, never with the buttons a
player presses. For any flow a player can reach, add a check in `tests/run_all.sh` that
drives it with `click:`/`rclick:`. Then prove the check fails on the old code before
trusting it.

## GDScript conventions here

- Use untyped `var x = …` in `core/` and `view/`. `:=` cannot infer a type from the
  Variant values that come out of JSON dictionaries, and it fails at parse time.
- Saves use `var_to_str` / `str_to_var`, because JSON turns every int into a float.
  Keep that format; old saves on players' disks must keep loading.
- When a script edits code by text replacement, assert that each old string occurs
  exactly once. An unasserted replace once silently missed a guard, and the "stationary"
  boss kept chasing the party. Diagnosing that took about ten tool calls. After a failed
  multi-file edit, grep to see what actually changed.
- Put brackets around mixed `and`/`or`. `right or held != null and not right and
  overlay == ""` is what hid the peddler bug.
- To find which code moves or changes something, use a temporary probe:
  `print("PROBE ", get_stack())` inside the suspect function. Run once, then delete the
  line.
- Assets load raw: `assets.gd` reads PNG bytes with `load_png_from_buffer`, so the
  exported build carries the files byte for byte. Texture keys without a folder default
  to `textures/`.

## Before "fixing" something on screen

- Decide what the correct picture looks like first. A mini-map that "drew one square"
  was correct: six seen squares form a 2×3 block. Five tool calls went on it.
- Zoom in 4–8× with nearest-neighbour scaling before editing. A slashed zero looked like
  "A", and the pixel font's lowercase "a" made "leave" look garbled. Neither was a bug.
- Take click coordinates from the layout code or from a screenshot. A dialogue click
  11 px too low hit the wrong choice.

## UI rules learned from players

- **Every string must fit its box.** At 640×360 with a pixel font, long labels overflow
  quietly. `ui.gd` `button()` now clips with `..`, but that is a last guard. Design
  labels short, and look at every screen with worst-case data: the longest level name,
  a real timestamp, the longest item names.
- **Mouse-driven genres need full mouse play.** The original is played with the mouse: an
  arrow pad and right-click zones in the view. The first remake had mouse actions but no
  mouse movement, and a player could not turn around. The zones were in `ANALYSIS.md`,
  but `DESIGN.md` dropped them without a row in the kept/adapted/dropped table. Every
  mechanic in the analysis, including every control, needs a row in that table. Port
  each entry of the original's input map (`CLK_MAP.C` click tables), or replace it on
  purpose.
- **Keep view state and game state in step.** An open shop (`g.shop`) blocks movement
  in `game.step`. When another panel replaced the shop screen, the shop stayed open, and
  the party froze until a load. Panel buttons now leave the shop, and `_process` closes
  any shop whose screen is gone. Any new modal state in `game.gd` needs the same pairing.

## Player-reported bugs (keep this log)

| reported | cause | fix | check that now guards it |
|---|---|---|---|
| save-slot text ran past its button | label was `"<full level name>, <full datetime>"` | short label `Cellar Vaults  09-26 13:22`; old saves relabelled on read; labels cached; `button()` clips | screenshot with `legacysave:0`, `menusub:save` |
| "I cannot turn around while clicking the mouse" | no mouse movement at all | arrow pad, edge-click turns with a turn cursor, right-click zones as in the source | mouse movement run in `run_all.sh` |
| items bought from the peddler could not be put into any character | a portrait click in the shop only selected; a panel opened from the shop left `g.shop` set, which froze movement | stow on click in the shop; buttons leave the shop; `_process` guard | peddler run in `run_all.sh` (fails on the old code) |

## Delivering a playable build

- The Windows exe is about 116 MB with the data embedded (`binary_format/embed_pck=true`).
  The chat upload limit is 30 MiB:
  - a zip came out at 42 MiB;
  - 7z with the x86 BCJ filter plus LZMA2 preset 9 extreme gives 29.7 MiB.

  ```python
  import py7zr
  f = [{"id": py7zr.FILTER_X86}, {"id": py7zr.FILTER_LZMA2, "preset": 9 | py7zr.PRESET_EXTREME}]
  with py7zr.SevenZipFile("GatesBelow-windows.7z", "w", filters=f) as z:
      z.writeall("GatesBelow", "GatesBelow")
  ```

  Unpack the archive again and compare SHA-256 hashes before sending it.
- Ship a `README.txt` beside the exe with CRLF line endings. It should hold the controls,
  the save folder (`%APPDATA%\Godot\app_userdata\Gates Below\saves`) and the "Windows
  protected your PC → More info → Run anyway" note, since the exe is not signed.
- Before sending, run the fixed flow against the exported data with `--main-pack`, not
  only against the project.
