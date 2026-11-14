# Hyper Bluff!!: project notes for future sessions

An original anime-style heads-up poker game: Godot 4 project in `godot/` (features tag 4.4
so older editors and Summer Engine open it), 640x360, GDScript only.

## Commands

```bash
. tests/env.sh            # GODOT, GODOT_OLD, ASEPRITE paths (edit OPT for your machine)
bash tests/run_all.sh     # everything; must end with "ALL OK"
$GODOT --headless --path godot --script res://tests/run_tests.gd   # "TESTS 42/42 passed"
bash godot/tests/harness.sh $GODOT                                 # "HARNESS 0 failure(s)"
python3 tests/verify_audio.py                                      # "AUDIO ok"
python3 tools/art/ase_crosscheck.py $ASEPRITE                      # "ASECHECK ok: 15 files"
$GODOT --headless --path godot --script res://tests/stats.gd       # bot playouts per rival
$GODOT --headless --path godot --export-release "Windows Desktop" ../dist/HyperBluff/HyperBluff.exe
bash godot/tests/harness.sh $GODOT --main-pack "$PWD/dist/HyperBluff/HyperBluff.exe"
```

Screenshots need a display: `xvfb-run -a $GODOT --path godot --audio-driver Dummy
--rendering-driver opengl3 -- --script=...,shot:/abs/x.png`.

Harness commands: `wait:n`, `tap:action`, `key:K`, `pad:button-index`, `click:region`,
`wheel:up|down`, `until:mine|over|<screen>:max`, `dump`, `fit`, `shot:path`, and the
set-up shortcuts `seed:n`, `rig:win|lose`, `floor:n`, `give:a+b`, `score:n`, `fever`.
Harness runs save under `user://harness/`, wiped at start.

## Architecture

- `scripts/core/` is pure rules on one Dictionary `s`: `cards.gd` (evaluator, win chance,
  LCG), `game.gd` (hold'em, powers, missions, stars, fever, scoring), `ai.gd`, `data.gd`.
  Phases: pre, bet, advance, showdown, hand_over, match_over, run_won.
- `scripts/main.gd` drives the rules, input, saves and the harness; `view/render.gd`
  draws; `view/audio.gd` plays.
- Art: `tools/art/sheets.py` (cards, icons, fonts), `portraits.py` + `export_portraits.py`.
  `paint`/`portraits.py` overwrite the `.aseprite` sources; after a hand edit run only the
  export step. `tools/blender/` and `tools/audio/` regenerate the rest.

## Lessons (2026-11-13)

- **A test that hits a script error must fail.** The first run printed 38/40 while
  `game.gd` did not even compile, because an aborted test never set a failure. Tests now
  return true and anything else is a failure.
- **`wrap` is a built-in**; a helper with that name fails to parse. It is `wrap_text`.
- **Python blending is not Aseprite blending.** PIL's alpha composite differed by 1 per
  channel from Aseprite on semi-transparent pixels; `asefile.flatten` now uses Aseprite's
  integer maths and the cross-check passes pixel-exact both ways.
- **Aseprite CLI builds headless** with `-DLAF_BACKEND=none` (no Skia); it needs the X11
  dev headers and a system libjpeg. Never commit the binary or its source.
- **Pot not cleared after payout** let chips appear from nowhere in bot playouts; the
  chip-conservation test caught it.

## Player-reported bugs

Log each: what the player saw, the cause, the fix, the check that guards it.

- **"Moves too quickly, animations feel clunky" (2026-11-13).** Cause: every step was a
  fixed 24 to 45 tick timer and things popped into place; the checks only asked whether a
  step happened, never how long it took or whether anything moved. Fix: PACE option
  (default RELAXED), eased card slides and flips, chip arcs, counting numbers, sliding
  result panel (DESIGN "Pace and motion"). Checks: "cards slide in from the deck",
  "relaxed pace", "fast pace from the options menu". Rule: give every pause and move a row
  in DESIGN with its length, and check the length.
- **"Portraits are generic and forgettable" (2026-11-13).** Cause: nine front-view busts on
  one face template. Fix: redrawn with larger heads, own head shapes, turned poses and one
  loud signature element each. No automatic check can judge this; look at the contact
  sheet and the silhouette sheet before handoff.
- **"The poker room looks the same at every stage" (2026-11-13).** Cause: one table render
  plus a relit copy for the boss. Fix: five rooms (`bg_floor1..5`) with their own felt and
  UI accent. Check: "each floor has its own room".
- **"Text overflows the text boxes" (2026-11-14).** Cause: the hand result panel was drawn
  over the player's portrait and the bet buttons; the rival's last word could spill out of a
  fixed 56 px panel; story pages had no height limit; the `fit` check measured width only.
  Fix: result panel moved right, match-end panel grows with its text, long story pages split
  into more pages, and a `para` helper reports vertical overflow to `fit`. Checks: "text
  stays inside its boxes on every screen" (now with height), `t_story_pages_fit`.
- **Ladder change (2026-11-14):** the player asked for more lore and mini-bosses between
  floors. Nine matches now; harness paths that skip story pages count them per rival
  (pages: opening 5, floor rivals 4, wardens 3, boss scene 4, ending 5). A changed page
  count shows up as an `until` timeout, not a wrong answer.
