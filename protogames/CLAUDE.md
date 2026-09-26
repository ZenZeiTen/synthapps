# protogames: notes for Claude

Each game lives in its own folder with its own README, docs, pipeline and tests:

- `crowmere-hill/`: an EGA-style parser adventure (browser and Godot). Start with its
  `README.md` and `docs/`.
- `gates-below/`: a Godot 4.7 party dungeon crawler. Read `gates-below/CLAUDE.md`
  first. It holds the commands, the automation harness, and the bugs players found
  after delivery.

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
