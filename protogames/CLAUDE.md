# protogames: notes for Claude

Each game lives in its own folder with its own README, docs, pipeline and tests:

- `crowmere-hill/`: an EGA-style parser adventure (browser and Godot). Start with its
  `README.md` and `docs/`.
- `gates-below/`: a Godot 4.7 party dungeon crawler. Read `gates-below/CLAUDE.md`
  first. It holds the commands, the automation harness, and the bugs players found
  after delivery.
- `vale-of-shards/`: a Godot 4.7 platformer with keyboard and gamepad controls. Read
  `vale-of-shards/CLAUDE.md` first. It holds the commands, the harness (which can drive
  the game through synthesized key and pad events), the route checker that proves every
  stage can be finished, and the level bugs it caught.
- `tidebell/`: a side-scrolling sword game in two builds, Godot 4.7 and three.js, with one
  set of rules ported to both and a parity check that they match. Read `tidebell/CLAUDE.md`
  first. Its rules were measured by running a Genesis ROM in an emulator; the ROM is never
  committed.

Rules shared by every project here:

- **Original content.** A game may follow an old game's mechanics, but its art, text,
  names, maps and music are original.
- **Everything checkable is checked before handoff.** Each project has a one-command
  test run, and it must pass before a commit is pushed.
- **Test flows the way a player reaches them.** Drive checks through the real input
  path, with clicks and keys, not through state shortcuts. A new check should fail on
  the old code first.
- **Shell pipelines hide failures.** Use `set -o pipefail` in test scripts. A retry loop
  such as `git push … | tail -2 && break` always breaks after the first try, because
  `tail` succeeds. Test the command's own exit status.
- **Playable builds for the user** go through the chat as files under 30 MiB. For a
  Godot exe that means 7z with the x86 BCJ filter and LZMA2 extreme (see
  `gates-below/CLAUDE.md`). Check that the archive unpacks byte-identical before
  sending it.

## What players found after delivery (check these before the next handoff)

Both games passed every check and still had bugs that players found in minutes. Each one
came from a gap in what the checks covered, so each is now a standing rule:

- **Cover every control the original had.** Gates Below shipped without the original's
  mouse turning. Every entry in the source's input map needs a row in DESIGN.md: ported,
  replaced, or dropped with a reason.
- **Test the paths between screens.** Gates Below froze movement when the inventory
  opened over the shop. Open each window from every place a player can open it, with the
  real button.
- **Measure how quick the controls feel.** Vale of Shards ported Xargon's jump exactly,
  and the player found it late and stiff. Count the steps from a press to visible motion.
  More than one step needs a DESIGN row that says why.
- **Plan the story, not only the rules.** The player asked for a scene before the final
  boss and for credits. List the opening, the boss meeting, the ending and the credits
  in DESIGN.md, and give each a check.
- **Play past the win.** Every replay stopped at "won", and the ending froze on a mode
  nothing handled. The last check must reach the title screen again.
- **Buttons carry over.** The button that closes a window, or a player still firing,
  must not act on the next screen: swallow held buttons until release, and guard story
  pages for a moment after they appear.
- **Text must fit with real data.** Both games shipped a save label that ran past its box
  (a full level name and date in Gates Below; stages, score and date in Vale of Shards). Check
  every screen for text outside its frame with the longest real data, as Vale of Shards'
  `fit` harness command does.
- **Walk every narrow gap from slightly off-line.** Vale of Shards' map walker moves 4 px a
  step and stops at any blocked cell, so a player a few pixels off the path's row met an
  "invisible barrier" beside an open gate in a one-tile gap. Test each gap, door and
  corridor from every offset the step size allows.
- **A hold keeps gravity.** A boss's death blast held the hero still for 3.3 s; started
  mid-jump, it froze him in the air and the player reported a freeze. Start every hold,
  cutscene and dialog from mid-air and mid-action in a check.
- **Tests keep out of the player's files.** Harness runs shared the high-score table; once
  test scores filled it, the ending took another path and a check passed in the project but
  failed on the exported exe. Harness runs get their own saves, options and scores, start
  empty, and the same checks run against the exported build before it is sent.
- **Recorded inputs are fragile.** A replay that passes alone can drift in a full run
  when the random numbers differ. Check each segment's goal, not only that it ended.
