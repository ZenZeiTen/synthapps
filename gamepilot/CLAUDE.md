# gamepilot: notes for Claude

An agent that plays PC and emulated games: Claude reads screenshots, a virtual Xbox pad or
keyboard and mouse carries out its plans. `README.md` is for players, `SETTINGS.md` explains
settings files, and this file is for whoever changes the code.

## Check every change

Run these from `gamepilot/`, all three, before every push:

```bash
python -m unittest discover -s tests -t .      # standard library only; one test runs only on Windows
ruff check synthapps_gamepilot tests            # config in pyproject.toml
python -m synthapps_gamepilot demo              # full loop on the built-in game, no API key
```

CI (`.github/workflows/gamepilot.yml`) runs the tests on Ubuntu and Windows with Python 3.11
and 3.13. The Windows jobs are the only place Win32 code really runs, so read their logs when
you touch `window.py` or `backends/win_sendinput.py`.

To check a Claude request without an API key, build a real `anthropic.Anthropic` with an
`http_client` whose transport is a `MockTransport` (httpx, or httpx2 in SDK 2.x), and inspect
the JSON body. Do this with an old SDK (0.60.0) and a current one.

## Layout

| File | Role |
|---|---|
| `controls.py` | Every control name: Windows scan codes, Linux key codes, XInput flags, text-to-key table |
| `plan.py` | Plan language: parse and validate steps, bindings, `mouse_to` mapping, `type_text` |
| `executor.py` | Plan to one input state per tick; real-time and frame-stepped clocks |
| `backends/` | ViGEm pad, SendInput keyboard/mouse, uinput, recorder; `base.py` diffs states |
| `window.py`, `capture.py`, `imaging.py` | Window list, lookup, focus, screenshots, PNG/JPEG |
| `claude.py` | The only code that sends requests to Claude |
| `planner.py` | The `act` tool, system prompt, append-only conversation |
| `recognize.py` | `setup`: which window is the game, which game, writes the settings file |
| `agent.py` | The look, think, act loop: goals, free play, safety checks |
| `retroarch.py` | RetroArch network commands |
| `sim.py` | Gem Garden and its scripted bot |

## Rules this code keeps

- The core uses only the standard library. Optional packages (anthropic, mss, Pillow, vgamepad,
  evdev, psutil) are imported inside the function that needs them, with an install hint if
  missing.
- Every request to Claude goes through `claude.create_message`. Newer request fields
  (`output_config`, `cache_control`, `fallbacks`) go in `extra_body`. Older SDK releases reject
  them as keyword arguments, and a user hit exactly that crash.
- Defaults: model `claude-opus-5-5`, effort `low`, `tool_choice` auto (forced tool choice
  returns a 400 on this model), and `fallbacks: "default"` with the
  `server-side-fallback-2026-07-01` beta.
- The planner conversation only grows by appending; thinking blocks are passed back
  unchanged. It is replaced, never edited, after `turns_per_conversation` turns. A goal change
  travels in the turn's status text, so the cached system prompt never changes.
- Everything the model sends is validated before anything is pressed. A rejected plan goes
  back as an `is_error` tool result whose message says how to fix it.
- Every input is released when a run ends, however it ends (`finally` in `Executor.run` and
  `GameAgent.run`).
- Settings-file mistakes print one readable line, never a traceback. Unknown keys are errors,
  and a misspelled control name gets a "did you mean" suggestion.
- Files are never overwritten (`_free_path` adds `-2`, `-3`...).
- Anti-cheat: refuse to start while known anti-cheat runs. Never add anything that hides the
  agent from anti-cheat software.

## Lessons from building and first use (Windows 11, Python 3.14, PowerShell)

- Windows reports a UDP request to a closed port as `ConnectionResetError`, not a timeout.
  Catch both (`retroarch.ask`).
- The user's installed `anthropic` was older than the one used in development. Never pass
  new API fields as SDK keyword arguments; use `extra_body`.
- PowerShell users: `gamepilot` is only on PATH after `pip install`. Every instruction gives
  `py -m synthapps_gamepilot ...`, run from the `gamepilot/` folder.
- Before a branch is merged, users must `git clone`, then `git checkout` the branch. A first
  attempt failed with "not a git repository" because no clone existed yet.
- Menu-driven and cozy games need absolute clicks (`mouse_to` in screenshot pixels).
  Relative mouse movement only turns cameras.
- The agent stopped after its one goal. Players expect it to keep going: `goals` and
  `free_play` exist for that.
- Keys pressed in the same tick go down modifiers-first and come up modifiers-last, so
  Shift+letter is never read as lowercase.
- Window titles can match the wrong window. A browser tab "Stardew Valley Wiki - Google
  Chrome" contains the game's whole title, so no title part can exclude it. `prefer_game`
  picks a window not owned by a known non-game program, and `check` and `setup` print which
  window they matched.
- The skill (`plugins/gamepilot/skills/gamepilot/SKILL.md`) was tested twice: a fresh agent
  had only the skill and answered realistic player messages. Keep it in step with the code:
  control names, defaults (`max_turns` 300, `image_max_edge` 1024, `pause_settle_ms` 300),
  options and errors.
- In tests, a fake clock must move forward on every read, or the real-time clock's final
  busy-wait spins forever.
- Verified live: Gem Garden played by Claude (5/5 gems, about $0.09). In Virtual Cottage 2,
  Claude clicked New Task, typed the task, then went through five goals and free play.
  Not yet verified on a real game: the virtual controller, a fast real-time game, RetroArch.

## When adding a feature

1. Put the change in the module that owns it (see the layout table).
2. If the model can now ask for something new, add it to the `act` tool schema and the
   system prompt in `planner.py`, and validate it in `plan.py`.
3. Add tests next to the existing ones (fakes are in `tests/helpers.py`), and check that the
   demo still collects every gem.
4. Update `README.md` (and `SETTINGS.md` for settings), including the test count and the
   "what has been verified" section.
