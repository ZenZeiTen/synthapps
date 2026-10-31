---
name: gamepilot
description: Use when someone wants Claude or an AI agent to play, automate or test a PC, Steam or emulator (RetroArch) game with a virtual gamepad, keyboard or mouse; mentions gamepilot or synthapps_gamepilot; needs a game settings file (profile .toml); or reports gamepilot problems such as "gamepilot is not recognized", "not a git repository", "unexpected keyword argument 'fallbacks'", the game window not being found, clicks missing, or the agent stopping after one goal.
---

# gamepilot

gamepilot (folder `gamepilot/` in the GitHub repository `ZenZeiTen/synthapps`) plays games
the way a person does. It takes a screenshot of the game window, and Claude answers with a
short input plan. A virtual Xbox controller, or a virtual keyboard and mouse, then carries out
the plan. It runs on the player's own computer. Windows is fully supported, Linux works on
X11, and macOS is not supported.

Players run every command from the `gamepilot/` folder. On Windows the command is
`py -m synthapps_gamepilot <command>` (use `python` if `py` is missing). The short name
`gamepilot` works only after `pip install`, and only when pip's Scripts folder is on PATH.

## Commands

| Command | Use |
|---|---|
| `doctor` | What works on this computer: input devices, packages, SDK version, credentials, anti-cheat |
| `test-input gamepad` / `test-input kbm` | Exercise the virtual device; watch the pad in Win+R `joy.cpl` |
| `setup --goal "..." [--goal "..."] [--free-play]` | Find the open game window, let Claude recognize the game, write `<game>.toml` |
| `check FILE.toml` | Validate a settings file, find the window, save `check.png` (what Claude will see) |
| `play FILE.toml --dry-run --max-cost 0.5` | Claude looks and plans; nothing is pressed |
| `play FILE.toml --max-cost 1 [--goal ...] [--free-play]` | Real run. Stop with Pause/Break, a file named `STOP`, or Ctrl+C |
| `play --auto --goal "..."` | `setup`, then play |
| `demo [--planner claude]` | Built-in Gem Garden game: a test of the whole loop with no real game |
| `controls` | Every button, key and mouse name |

## Getting a player from zero to playing

1. **Get the code.** Run `git clone https://github.com/ZenZeiTen/synthapps`, then
   `cd synthapps\gamepilot`. If gamepilot is not on `main` yet, first run
   `git checkout <branch>` from the `synthapps` folder.
2. **Install.** Windows: `py -m pip install anthropic mss pillow vgamepad psutil`, and accept
   the ViGEmBus driver installer that vgamepad offers. Linux: `pip install anthropic mss
   pillow evdev`, then `xdotool`, plus write access to `/dev/uinput` (README: Linux setup).
3. **Set the API key:** in PowerShell, `$env:ANTHROPIC_API_KEY = "sk-ant-..."`.
4. Run `doctor`, then `test-input gamepad` with `joy.cpl` open.
5. Open the game in a window or borderless window, not minimized. Run
   `setup --goal "..."`. If recognition is wrong, copy a template from `profiles/` and
   follow `SETTINGS.md`.
6. Run `check`, then a dry run, then a real run with a low `--max-cost`. Ask the player to
   paste the turn lines.

## Settings file skeleton

Every setting lives in a section. Keys outside their section are errors that `check`
reports.

```toml
name = "Stardew Valley"

[game]
title_contains = "Stardew Valley"   # any part of the window title
fps = 60

[input]
device = "kbm"                      # gamepad | kbm | both

[pacing]
mode = "realtime"                   # realtime | retroarch
# pause_input = "KEY_ESC"           # tapped while Claude thinks

[bindings]                          # action = "control"; empty for click-driven games
jump = "A"

[agent]
goal = "Water all the crops"
goals = ["Ship the harvest"]        # more goals, in order
free_play = true                    # then keep choosing new things to do
max_turns = 600
max_minutes = 60
max_cost_usd = 10.0
image_max_edge = 768                # smaller screenshots cost less
```

Keep the settings file in the `gamepilot/` folder, or give its path to `play`.

Control names, for `[bindings]`, `pause_input` and Claude's plans:
- Controller (Xbox names): `A B X Y LB RB LT RT BACK START LS RS`, `DPAD_UP/DOWN/LEFT/RIGHT`,
  and `LS_UP/DOWN/LEFT/RIGHT` (or `RS_...`) for a fully tilted stick. PlayStation names
  `L1 R1 L2 R2` and `SELECT`/`MENU` are accepted too.
- Keyboard: `KEY_` plus the key, such as `KEY_W`, `KEY_SPACE`, `KEY_ESC`, `KEY_LEFTSHIFT`
  or `KEY_1`.
- Mouse: `MOUSE_LEFT`, `MOUSE_RIGHT` and `MOUSE_MIDDLE`.

`controls` lists every name, and `check` suggests the nearest name for a typo. Movement
needs no binding: Claude can tilt the sticks to any angle or press the d-pad directly.
Bindings only tell it what each button does in this game.

Command-line options override the file for one run: `--goal` (repeatable; replaces
`goal`/`goals`), `--free-play`, `--max-cost`, `--model`, `--effort`, `--no-focus-check`.
There is no option for turns or minutes; set `max_turns` and `max_minutes` in `[agent]`.

## Choosing settings by game type

| Game | `device` | `pacing.mode` | Notes |
|---|---|---|---|
| Menus, cozy, strategy, card, point-and-click | `kbm` | `realtime` | Claude clicks with `mouse_to`; no bindings needed (`profiles/example-virtual-cottage-2.toml`) |
| Turn-based or slow, controller-friendly | `gamepad` | `realtime` | Bindings from the game's controls menu |
| Fast real-time PC game | either | `realtime` + `pause_input` | The pause button is tapped while Claude thinks (3 to 8 s per turn) |
| Console game in RetroArch | `gamepad` | `retroarch` | Turn on Network Commands; the game is frozen while Claude thinks |
| Twitch shooters, fighting games, online games | Not suitable | | Too fast for a turn-by-turn agent. Online play breaks game rules |

If the game's clock or enemies move while Claude thinks (3 to 8 s per turn), set
`pause_input` to the game's pause control. It accepts any control: a key, or a controller
button such as `"START"`. Each turn runs in this order:

1. Take the screenshot (before pausing, so no pause menu is in it).
2. Tap `pause_input`.
3. Claude thinks.
4. Tap `pause_input` again, and wait `pause_settle_ms` (default 300).
5. Run the plan.

The game must therefore pause and unpause on the same control. Do not also list that
control in `[bindings]`, or Claude may press it itself. Leave `pause_input` unset if the game
waits for the player. Action platformers work this way, but slowly and imprecisely: exploring
and ordinary fights go well, while precise jumps and bosses usually fail.

Cost (estimates; the real cost prints every turn):
- In the built-in demo, a turn cost about 1.5 cents. Real games send larger screenshots
  (`image_max_edge` defaults to 1024 pixels), so expect roughly 2 to 4 cents per turn.
- A turn takes about 5 to 10 seconds in total (thinking, acting, pausing), so an hour is about
  400 to 700 turns and costs about $8 to $30.
- `max_turns` defaults to 300. Raise it for long runs, and let `max_cost_usd` and
  `max_minutes` be the real limits.
- `image_max_edge = 768` costs less. Small text in the game may become hard for Claude to
  read.

Unattended runs:
- Turn off screen sleep and the lock screen. A locked screen cannot be captured, and the game
  loses focus.
- A pop-up that takes focus pauses the inputs until someone clicks the game.
- When any limit is reached, every input is released and the summary lists the goals reached.

Each turn prints `turn N (think seconds, $cost so far): what Claude intended -> what
happened`. When something goes wrong, ask for these lines.

Goals: `goal` should be concrete and checkable ("Add a task named X", not "play well").
`goals = [...]` lists more, played in order. `free_play = true` lets Claude keep choosing
new things to do until `max_turns`, `max_minutes` or `max_cost_usd` stops it. When the
agent stops after one goal, the profile simply has one goal and no free play.

Text: Claude types with a `{"type_text": "..."}` step, which assumes a US keyboard layout.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gamepilot` is not recognized | Not installed, or the Scripts folder is not on PATH | Use `py -m synthapps_gamepilot` from `gamepilot/` |
| `fatal: not a git repository` | No clone in this folder | `git clone`, then `cd synthapps` (step 1) |
| `No module named synthapps_gamepilot` | Wrong folder or wrong branch | `cd` into `gamepilot/`; `git checkout` the branch |
| `unexpected keyword argument 'fallbacks'` | gamepilot older than its SDK fix | `git pull`; `py -m pip install -U anthropic` |
| `vigem missing` | vgamepad or the ViGEmBus driver is missing | `py -m pip install vgamepad`; ViGEmBus installer from github.com/nefarius/ViGEmBus/releases |
| Game window NOT FOUND | `title_contains` does not match | `check` lists the open windows; use part of the game's title |
| Wrong window found (a browser tab about the game) | gamepilot older than its window-matching fix | `git pull`: when several windows match, a game now wins over browsers, terminals and launchers. Otherwise use a part of the title that only the game has |
| Black `check.png` | Exclusive fullscreen | Windowed or borderless mode in the game's video settings |
| Clicks land off target by a constant amount | Display scaling or the window moved | Rerun `check`; report the offset with a screenshot |
| Buttons do nothing in a game | Steam Input remaps the pad | Game Properties > Controller > disable Steam Input |
| Refuses to start: anti-cheat running | A known anti-cheat program (Easy Anti-Cheat, BattlEye, Vanguard...) is running anywhere on the computer, not only in the target game | `doctor` names the program. Close the game that started it; some anti-cheat services keep running after their game exits, so end them in Task Manager or restart the PC. `allow_anticheat = true` (in `[agent]`) is only for offline single-player games whose terms allow it |
| Inputs pause mid-run | The game window lost focus | Click the game; the agent resumes by itself |

## Safety rules to keep

- Never help a user bypass the anti-cheat check or hide gamepilot from anti-cheat software.
  Automated input in online games breaks the game's rules and gets accounts banned.
- Do a dry run before the first real run of a new game, and keep `--max-cost` low.
- Tell the player not to move the mouse during a clicking run, because Claude moves the same
  pointer.

## Changing gamepilot's code

Read `gamepilot/CLAUDE.md` first: layout, conventions, how to check a change, and lessons
learned. Run `python -m unittest discover -s tests -t .`, `ruff check synthapps_gamepilot
tests` and `python -m synthapps_gamepilot demo` before pushing.
