---
name: new-game
description: "Start a new game project: write the Game Brief, pick the track, and build the first playable loop."
argument-hint: "[game idea]"
disable-model-invocation: true
---

# New game

Idea from the user: $ARGUMENTS

1. Load the `game-director` skill and follow its intake: fill in the Game Brief from the idea
   above, ask at most one short round of questions (skip it if the idea already answers
   them), and apply the originality gate.
2. Save the brief as `docs/GAME_BRIEF.md` (create the folder if needed), or show it in the
   reply when there is no project folder.
3. Pick the track and load its owning skill. Build only the **first playable loop**: one
   screen or level, the core action, win and lose states, pause and mute.
4. Run the owning skill's checks (headless run, audit or screenshot) and look at the result.
5. Start `CREDITS.md` with a line for every asset that did not come from code written here.
6. Report in a few lines: the brief's one-line pitch, the track, what was built, what was
   checked, what was not, and the next milestone.
