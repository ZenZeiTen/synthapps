# Remaking a classic game in Godot

Read this when the user wants an old game rebuilt in Godot: "remake X", "reverse-engineer
this source", "port this DOS game". The workflow was first used on a remake of a late-90s
first-person dungeon RPG: its rules were rebuilt from the released C source, and every
piece of content was made new. The project was built in one session, delivered as a
Windows exe, and then played by the user, who found three bugs. What those bugs taught is
folded in below.

A second remake (a platformer that follows the rules of a mid-90s DOS platformer whose
source was released) used the same workflow for a real-time game. Its player found four problems: a stiff, late
jump, no scene before the final boss, a freeze after the last hit, and no credits.
Section 9 holds what a real-time remake adds.

## Contents

1. The line between mechanics and content
2. Reading the source
3. Design documents
4. Architecture that can be tested
5. Asset pipeline
6. Verification ladder
7. Before the first delivery: a play-readiness pass
8. Delivery and the feedback loop
9. Real-time remakes: feel, story beats and recorded routes

## 1. The line between mechanics and content

- **Mechanics may follow the original.** Rules, formulas, the world model and the
  control scheme are fair game. Read them from the source and cite them.
- **Content is original:** art, text, names, maps, music, the title and the logo. Don't
  ship or trace the original's files, even when they sit in the zip beside the code.
- Keep a **kept / adapted / dropped** table in `docs/DESIGN.md`. Give each mechanic one
  row and one line of reason. It shows the user what they are getting, and it stops
  scope from drifting.
- **Every finding in the analysis gets a row, controls included.** In the first
  remake, the original's right-click movement zones were in `ANALYSIS.md`, but
  `DESIGN.md` dropped them silently. The first player's second complaint was exactly
  that: they could not turn with the mouse.

## 2. Reading the source

1. **Map the tree first.** Unpack the archive and list files by size. Find the
   headers that define the world, the actors and the items, and the main loop.
   - For a large tree, run parallel read-only explore agents split by subsystem (world
     and engine, rules, UI and items) while you install the toolchain.
   - Then spot-check their claims against the code before relying on them: grep the
     macros, tables and constants they name.
   - Old European sources are often in code page 1250. Read them with
     `iconv -c -f cp1250 -t utf-8 FILE.C`.
2. **Write `docs/ANALYSIS.md`** as you read. Organise it by system: world model,
   movement, combat, magic, items, character creation, progression, sound, input. Cite
   `FILE.C:line` for every claim.
3. **Copy constants and formulas exactly**, including integer and fixed-point behaviour
   (for example `(a+b)/(1+ab/8100)` resistance stacking, or the CALC_DIFF fixed-point
   code of a creation disc). Rounding is part of the feel.
4. **Record the input map.** Old games often keep it in click tables: screen rectangle →
   handler, with a mouse-button mask. List every entry: which region, which button, which
   action. A player who knows the original expects all of them. For example, the first
   remake had no mouse movement at all, and "I cannot turn around while clicking the
   mouse" was the second bug reported.
5. **Recheck numbers against the source when you port them.** In one port a split at
   half the view height (`yr>180` of 360) was typed as 60% from memory, and was only
   caught by rereading the handler.

## 3. Design documents

- `DESIGN.md` holds:
  - the kept/adapted/dropped table;
  - the controls table, keyboard **and** mouse, one row per action;
  - the content plan (levels, bestiary, items);
  - a walkthrough of the intended solution.
- The walkthrough doubles as the script for an automated playthrough test.

## 4. Architecture that can be tested

- **Core rules are plain scripts** (`RefCounted`, no nodes) that take and return data:
  `rules.gd` for formulas, `game.gd` for state and actions, `battle.gd`, `magic.gd`.
  They run under `godot --headless --script res://tests/run_tests.gd` with no scene.
- **The view** (`main.gd`, `ui.gd`, `dungeon.gd`) draws the core state and turns input
  into core calls. It holds only presentation state (which panel is open, the hover).
  **Pair every modal state in the core with its screen in the view.** A shop that stays
  open in `game.gd` after its panel closes blocks movement, and the player sees no
  reason why.
- **Content is JSON**: levels, items, monsters, dialogues, shops and spells. Level maps
  are ASCII grids with annotations. A level compiler validates references and reports
  errors, and a test asserts it reports none.
- **Seeded RNG in the saved state.** Bots, balance runs and bug repros can then be
  replayed exactly.
- **Saves use `var_to_str`/`str_to_var`.** JSON turns ints into floats (measured). Write
  a readable label into the save, and plan for old saves: a later version must read what
  an earlier one wrote.

## 5. Asset pipeline

Every asset comes from a script that you commit, and every source is kept in an editable
form (`.aseprite`, `.blend`):
- pixel art drawn in code;
- Blender sprite renders, palette-locked in Aseprite;
- a GLB level kit;
- synthesised sound effects and music.

The export step reads the **editable sources back**, not the generator's memory, so a
hand edit made in Aseprite is what ships. See `aseprite-pixel-forge` and
`blender-game-asset-forge` for the tools, including fallbacks when their MCP servers are
missing.

Load content raw at runtime, with `importer="keep"` sidecars (see SKILL.md, "Loading
content raw"). The editor, headless tests and the exported build then all read the same
bytes.

## 6. Verification ladder (each rung caught real bugs)

| rung | what it proves |
|---|---|
| unit tests pinned to hand-computed source values | the formulas match the original |
| level compiler, zero errors, plus a connectivity lint (every square reachable) | the content references resolve and no area is cut off. The lint caught a missing corridor: 58 of 76 squares were reachable |
| scripted full playthrough (a bot follows the walkthrough through the same core API the view uses) | the game can be finished. It found 7 real bugs, including an endless battle, a boss that moved when it shouldn't, and an infinite pickup loop |
| balance runs over N seeds, including random parties, with a floor on wins | it is winnable, but not trivially. A 12-seed probe that runs in about a second made boss tuning tractable, where single runs were not |
| mutation check (deliberate bugs must fail the suite) | the tests actually bite. Two survivors in one session led to two stronger tests |
| art/audio verifiers (every PNG equals its editable source pixel for pixel; every sound the code names exists, in one format; music loops are seamless) | the pipeline output is intact |
| scripted **input** flows through the real click/key path | what the player does works (see `test-harness.md`) |
| export check (export, run from a temp folder, screenshot) | the shipped build starts and renders |

## 7. Before the first delivery: a play-readiness pass

Run the play-readiness pass in SKILL.md: text fit, input completeness, modal exits, true
hints, old saves, first launch. A remake adds two items:

- **Input-map parity.** Work through the source's input map (section 2, step 4). Tick off
  every entry as ported or deliberately replaced, and put both the keyboard and the
  mouse column in the controls table.
- **Genre expectations.** Players of the original will try its gestures first. For
  example, they right-click the view to step, or click the edge to turn. Missing ones
  read as bugs, not as design choices.

Debugging aid: when something moves or changes and you can't see why, add
`print("PROBE ", get_stack())` inside the suspect function. Run the balance probe once,
then delete the line. In that build it pointed straight at the code path that moved the
stationary boss.

## 8. Delivery and the feedback loop

- Deliver the build (see SKILL.md, "Shipping a build to a player"), open a pull request,
  and keep a **player-reported bugs** table in the project's `CLAUDE.md`. For each
  report record what the player saw, the root cause, the fix, and the check that now
  guards it.
- For each report, reproduce it through the harness first, then fix it. Check that the
  new check fails on the old code, rebuild the exe, and run the flow against the
  exported data (`--main-pack`) before sending.
- While fixing, look for siblings: the same root cause often has a second path. The
  "can't stow" report led to finding the frozen-movement path, which no one had reported
  yet.

## 9. Real-time remakes: feel, story beats and recorded routes

**Faithful timing can feel wrong.** An old game's frame rate and input polling are part
of its feel on the old hardware, and they read as lag today.
- The original platformer's jump hung for 2 steps (110 ms at 18.2 Hz) before the first rise, and a landing
  locked running for 4 to 7 steps. Both were exact ports, and the player called the jump
  "stiff, with a slight delay".
- Before the first delivery, measure the steps from a press to visible motion for jump,
  fire and turn. Anything above one step is a DESIGN row: keep it on purpose, or adapt
  it and say why.
- Modern players also expect a jump buffer and ledge grace (about 100 ms each), and a
  pose for takeoff, rise, apex, fall and landing. The details are in SKILL.md,
  "Platformer jump feel".
- A rules change that alters timing invalidates every recorded route. Re-record all of
  them, not only the stage you were looking at.

**Plan the story beats, even where the source has none.** The original platformer goes straight from the
last corridor into the boss, and its ending is a text screen. The player asked for a
scene before the boss and for credits. List the beats in DESIGN.md before building:
opening, each chapter's first meeting, the boss meeting, the ending and the credits.
Give each one a check that drives it through the harness.

**Drive the check past the win.** Every replay stopped at "won", so nothing ever saw what
came after, and the ending froze on a mode that no code handled. The last check of the
game must keep pressing buttons through the ending until the title screen is back. Fire
during the fade, because a player still firing at the boss does exactly that.

**Recorded routes drift.** A route is a list of per-step inputs from a search. It stays
valid only while the random numbers match the recording.
- In the full playthrough, a stone bounced differently, and the run lost a stage that
  passed alone. The old routes had passed by luck.
- Give each segment a goal (a position, a key held, the exit reached). When a replayed
  segment misses its goal, search again from the real state, and print how many
  segments needed it.
- Or seed the RNG per stage. Either way, never trust a replay that only "did not crash".

**Check the export's assets, not only its start.** The export check played stage 1, so a
new image used only in the ending could have been left out of the pack. Add a harness
command that loads every sprite and track in the manifest, and run it inside the
exported build.

