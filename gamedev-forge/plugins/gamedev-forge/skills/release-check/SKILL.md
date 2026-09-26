---
name: release-check
description: "Run the pre-release gate on a game project before a build reaches players: builds, controls, originality, credits, secrets, localization and accessibility."
argument-hint: "[path to project or build]"
disable-model-invocation: true
---

# Release check

Target: $ARGUMENTS (use the current project if empty).

Run every gate. Mark each **PASS**, **FAIL** or **NOT CHECKED**, with evidence for each mark:
a command and its output, a file and line, or a screenshot you looked at. NOT CHECKED is an
honest answer; a guessed PASS is not.

1. **Build.** Run the track skill's own checks on the exact file that will ship, not only the
   project (for Godot, the exported build with `--main-pack`; for the web, the final HTML).
   No script errors, no page errors, the main loop runs.
2. **Play-readiness.** Every screen a player can reach has a way back, a pause and a mute.
   Controls match the README or the in-game help. The game can be won and lost, and a
   credits or end screen exists.
3. **Originality.** No names, characters, sprites, maps, music or logos from a commercial
   game. Brand names only where the originality rules allow them.
4. **Credits and licences.** Every non-code asset has a `CREDITS.md` line with source and
   licence, and each licence covers shipping it inside a build.
5. **Nothing private ships.** Check that the project's own files and the build contain no
   key-shaped strings, private-key blocks, committed environment files or personal paths.
   Report only the file and line, never the value. Stay inside the project folder: never open
   files elsewhere on the user's machine. Any hit is a FAIL until removed from the build and
   history.
6. **Localization** (if the game has more than one language, or plans to). Run the
   `game-loc-ops` readiness gate and its string lint and pseudo-localization scripts.
7. **Accessibility.** Readable text at the target resolution, reduced motion respected on the
   web, no required input that the platform reserves (for example Ctrl+W in a browser).
8. **Hand-off.** A README with how to run, full controls, the save location and the build's
   version or commit.

Then ask the `playtest-auditor` agent for an independent pass on the same target, and merge
its findings. Finish with a table of gates and marks, the list of FAILs with the fix for
each, and what only a human can check (feel, audio by ear, balance).
