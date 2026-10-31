# gamepilot

An agent that plays PC games (Steam or any other) and emulated console games the way a
person does: it looks at the screen and presses buttons. Claude reads screenshots and
decides what to do. A virtual Xbox controller, or a virtual keyboard and mouse, carries
out the plan with frame-accurate timing.

```
look (screenshot) ──> think (Claude) ──> act (virtual pad / keyboard / mouse) ──┐
     ^                                                                          │
     └──────────────────────────────────────────────────────────────────────────┘
```

- **Real devices, not fake keypresses.** On Windows the controller is a virtual Xbox 360
  pad (ViGEmBus), so Steam, games and emulators treat it like a plugged-in controller. The
  keyboard sends hardware scan codes and the mouse moves relatively, which is what
  DirectInput and first-person games need. On Linux, uinput devices copy a real Xbox 360
  pad, so SDL and Steam map them automatically.
- **Inputs that games actually register.** Every press lasts at least two game frames.
  Pressing the same button twice puts a release gap in between. Timing runs against fixed
  deadlines, so it does not drift. Every input is released whenever a run ends, whatever
  the reason.
- **Emulators played frame by frame.** With RetroArch, the agent pauses the game, thinks
  as long as it needs, then runs its plan one emulated frame at a time. Nothing in the
  game moves while Claude is thinking. It can also make save states, load them after a
  failure, and read values such as lives from game memory.
- **Guardrails.** It refuses to start while well-known anti-cheat software is running. It
  stops sending input when the game window is not in front. It has a kill switch, and
  limits on turns, time and spending.

## Quick start

Python 3.11 or newer. From the repository root:

```bash
cd gamepilot
python -m synthapps_gamepilot demo
```

This plays *Gem Garden*, a small built-in game, with a scripted bot that sees only the
screenshots. It exercises the whole loop (capture, plan, frame-timed input, release) with
no extra packages and no API key. To let Claude play it:

```bash
pip install anthropic
export ANTHROPIC_API_KEY=...        # or: ant auth login
python -m synthapps_gamepilot demo --planner claude --save-frames frames
```

Check what works on your computer:

```bash
python -m synthapps_gamepilot doctor
```

## Install

```bash
pip install "./gamepilot[all]"            # from the repository root
gamepilot doctor
```

Or pick the extras you need: `claude` (the planner), `capture` (screenshots: `mss` and
Pillow), `windows` (`vgamepad`) or `linux` (`evdev`).

If your shell says `gamepilot` is not recognized, either the package is not installed or
pip's Scripts folder is not on your PATH (pip prints a warning about this when it
installs). Every command also works without that: from the `gamepilot` folder, run
`python -m synthapps_gamepilot` (on Windows, `py -m synthapps_gamepilot`) in place of
`gamepilot`.

### Windows setup

1. `py -m pip install vgamepad`. Its installer offers to install the **ViGEmBus** driver;
   accept. Without the driver, no virtual controller can be created. (ViGEmBus is no longer
   developed by its author, but the released driver still installs and works.)
2. From the `gamepilot` folder, test the controller with
   `py -m synthapps_gamepilot test-input gamepad`, while the Windows controller test
   (Win+R, `joy.cpl`) or Steam's controller test is open. You should see every button,
   stick and trigger move.
3. For keyboard and mouse games, turn off *Enhance pointer precision* (Mouse settings) so
   mouse movement distances are predictable.
4. If the game runs as administrator, run the agent as administrator too. Windows blocks
   input sent from a lower privilege level, and the agent reports that as an error.

Kill switch on Windows: the **Pause/Break** key.

### Linux setup

1. `pip install evdev`, and `sudo apt install xdotool` (window lookup and focus checks,
   X11 only).
2. Give your user access to `/dev/uinput`:

   ```bash
   sudo modprobe uinput
   echo 'KERNEL=="uinput", SUBSYSTEM=="misc", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"' \
     | sudo tee /etc/udev/rules.d/99-gamepilot-uinput.rules
   sudo usermod -aG input "$USER"      # then log out and back in
   ```

   If Steam's device rules are installed (the `steam-devices` package on many
   distributions), you may already have access.
3. Test: `gamepilot test-input gamepad`, and watch it with `evtest`, `jstest-gtk` or Steam's
   controller test.

Under Wayland, other programs cannot look up or watch windows. The agent then captures
the whole screen and needs `--no-focus-check`: keep the game in front yourself.

Kill switch on any system: create a file named `STOP` in the working directory
(`touch STOP`), or press Ctrl+C in the terminal.

macOS has no virtual-device backend yet.

## Playing a game

Each game gets a profile: a TOML file saying where the game's window is, which device to
use, how to pace play, what the buttons do and what the goal is. Start from a template in
[`profiles/`](profiles/):

| Template | For |
|---|---|
| `steam-gamepad-template.toml` | Steam (or any PC) game with a controller |
| `steam-keyboard-mouse-template.toml` | PC game with keyboard and mouse |
| `retroarch-template.toml` | A console game in RetroArch, played frame by frame |

```bash
cp profiles/steam-gamepad-template.toml mygame.toml   # then edit it
gamepilot play mygame.toml --dry-run                  # plans, sends nothing
gamepilot play mygame.toml --launch --transcript run.jsonl
```

`--dry-run` takes screenshots and asks Claude for plans, but records the inputs instead of
sending them. Use it to check the setup before the agent touches anything.

### What goes in a profile

```toml
name = "Game title"                 # shown to the model

[game]
title_contains = "Game title"       # part of the window title; screenshots are cropped to it
launch = "steam://rungameid/APPID"  # or a command: ["retroarch", "-L", "core.so", "game.sfc"]
fps = 60

[input]
device = "gamepad"                  # gamepad | kbm | both

[pacing]
mode = "realtime"                   # realtime | retroarch
pause_input = "START"               # optional: pause the game while Claude thinks

[bindings]                          # action names the model can use
jump = "A"
move_left = "LS_LEFT"
attack = "MOUSE_LEFT"

[agent]
goal = "Finish the first level."
notes = "Anything the model cannot see: controls, objectives, what to avoid."
effort = "low"                      # low | medium | high | xhigh | max
max_cost_usd = 5.0
```

Run `gamepilot controls` for every control name. Unknown keys and unknown control names
are errors, so a typo cannot silently do nothing.

### Pacing: what suits which games

Claude takes a few seconds to answer each turn.

- **`retroarch`**: the game is frozen while Claude thinks, and plans run frame by frame.
  Precise platforming and action are possible, just slower than real time. This is the
  most reliable way to play.
- **`realtime`** suits games that wait for the player: turn-based, strategy, puzzle,
  visual novels, menus, slow exploration. For faster games, set `pause_input` to the
  game's pause button so the agent pauses the game while it thinks. Real-time reflex play
  (fighting games, shooters) is beyond what a turn-by-turn agent can do well.

### RetroArch

Turn on *Settings > Network > Network Commands* (or `network_cmd_enable = "true"` in
`retroarch.cfg`). The virtual pad appears as an Xbox 360 controller, which RetroArch maps
automatically. Then:

```bash
gamepilot retroarch status          # is RetroArch reachable, which game is loaded
gamepilot play profiles/my-snes-game.toml
```

In this mode Claude can also send `save_state` and `load_state` (the currently selected
slot), and the profile can list memory addresses to show it every turn (`[[retroarch.watch]]`).

Other emulators work in `realtime` mode like any PC game: they see the virtual controller
or keyboard.

### Steam

Steam sees the virtual pad as an Xbox 360 controller. If a game's buttons come out wrong,
open the game's *Properties > Controller* and turn Steam Input off for it. Avoid binding
`GUIDE`, which opens the Steam overlay.

## How Claude is used

Each turn sends the newest screenshot(s), the result of the previous plan and the agent's
own notes. Claude answers with one call to an `act` tool: what it sees, what it intends,
a list of input steps, and, optionally, updated notes. A step looks like this:

```json
{"buttons": ["jump", "DPAD_RIGHT"], "left_stick": {"x": 1, "y": 0}, "duration_ms": 300}
```

Plans are checked before anything is pressed. A rejected plan, with the reason, goes back
to Claude as an error so it can correct itself.

- Model: `claude-opus-5-5` by default (`agent.model` or `--model`). `agent.effort` sets how
  much it thinks; `low` keeps turns quick.
- The conversation only grows by appending, which keeps the prompt cache working. After
  `turns_per_conversation` turns, a fresh conversation starts that carries over the notes
  and a short log, so cost per turn stays flat over long sessions.
- If a request is declined by a safety check, the API retries it on Anthropic's
  recommended fallback model (`fallbacks: "default"`). If that is declined too, the run
  stops with status `refused`.
- Cost: each turn sends one or two screenshots, roughly (width × height) / 750 input
  tokens each (about 800 for a 1024×576 frame), plus the conversation. Set `max_cost_usd`. The running estimate is
  printed every turn.

Any other planner can be plugged in: it needs one method, `decide(observation) -> Decision`
(see `ScriptedGemPlanner` in `sim.py`).

## Fair play

Use this with single-player and offline games, or games whose rules allow automation.
Automated input in online games breaks most games' terms of service and can get accounts
banned. The agent refuses to start while known anti-cheat services are running (Easy
Anti-Cheat, BattlEye, Riot Vanguard, FACEIT, EA Javelin, PunkBuster and others; see
`safety.py`). Some single-player games ship anti-cheat too. Setting
`agent.allow_anticheat = true` in a profile overrides the check, with a warning. Nothing
in this project hides the agent from anti-cheat software.

## Commands

| Command | What it does |
|---|---|
| `gamepilot doctor` | Shows which backends, packages and credentials are available, and any anti-cheat running |
| `gamepilot test-input gamepad\|kbm [--dry-run]` | Creates the virtual device and exercises it |
| `gamepilot play PROFILE [--dry-run] [--launch] [--model M] [--effort E] [--max-cost USD] [--transcript F] [--save-frames DIR] [--no-focus-check]` | Plays a game |
| `gamepilot launch PROFILE` | Starts the game named in the profile |
| `gamepilot demo [--planner scripted\|claude] [--device gamepad\|kbm]` | Plays the built-in Gem Garden |
| `gamepilot retroarch status\|pause\|resume\|advance N\|save\|load\|read ADDR LEN` | Sends one command to RetroArch |
| `gamepilot controls` | Lists every control name |

Without installing, use `python -m synthapps_gamepilot` instead of `gamepilot`.

## Layout

| File | Role |
|---|---|
| `controls.py` | Control names, with Windows scan codes, Linux key codes and XInput flags |
| `plan.py` | The plan language: parsing, validation, profile bindings |
| `executor.py` | Turns plans into one input state per tick; real-time and frame-stepped clocks |
| `backends/` | Virtual devices: ViGEm (Windows pad), SendInput (Windows keyboard/mouse), uinput (Linux), recorder |
| `capture.py`, `window.py`, `imaging.py` | Screenshots of the game window, focus checks, image encoding |
| `retroarch.py` | RetroArch network commands: pause, frame advance, save states, memory |
| `planner.py` | The Claude planner and the `act` tool |
| `agent.py` | The look, think, act loop with its safety checks |
| `safety.py` | Anti-cheat detection, kill switch, budgets |
| `sim.py` | Gem Garden and its scripted bot |

## Tests

```bash
cd gamepilot
python -m unittest discover -s tests -t .
```

63 tests, standard library only. They cover plan validation, frame timing (minimum
holds, release gaps, exact mouse totals, no drift), release on stop and on error, every
backend against stand-ins for its driver library, the Claude request format and
conversation handling with a fake client, a fake RetroArch over UDP, profiles, safety
checks, and full game runs on Gem Garden.

## What has been verified, and what has not

Verified in development (Linux, no display):

- The full loop on Gem Garden, with the gamepad and the keyboard profile.
- The request the planner builds, sent through the real `anthropic` SDK (2.3.0) with a
  mocked HTTP transport: fallback header, effort, prompt caching, tool results and
  thinking blocks passed back.
- All 81 Linux key codes and every gamepad and mouse code, checked against python-evdev's
  tables. The ViGEm button names and method signatures, checked against vgamepad's source.
- Real-time pacing: a dry-run controller test ran 853 ticks in 7.10 s at 120 Hz.

Not verified yet: a run against a real game. Real virtual devices on Windows or on a
Linux desktop, live screen capture, and a live RetroArch were not available where this was
built. Treat the first sessions on your machine as the real test. Start with
`test-input`, then `play --dry-run`, then a short real run with a low `max_cost_usd`.
Reports of what works and what does not are welcome.
