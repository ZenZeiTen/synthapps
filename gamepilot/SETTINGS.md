# Writing a settings file

A settings file (also called a profile) tells gamepilot four things about one game:

1. Which window is the game, so it photographs only that window.
2. Which device to use: a controller, or a keyboard and mouse.
3. What the buttons do in this game, in words Claude can use ("jump", "attack").
4. What Claude should try to achieve, and how much time and money it may spend.

It is a plain text file in TOML format, with one file per game. The steps below use
Windows and PowerShell. On Linux, use `python` instead of `py` and any text editor.

## Step 1: Choose the template

Open PowerShell in the `gamepilot` folder:

```
cd $HOME\Documents\synthapps\gamepilot
```

Pick the template that matches how you play the game:

| You play it with | Copy this template |
|---|---|
| A controller (Xbox, PlayStation, Steam Deck layout) | `profiles\steam-gamepad-template.toml` |
| Keyboard and mouse | `profiles\steam-keyboard-mouse-template.toml` |
| A console game inside RetroArch | `profiles\retroarch-template.toml` |

If the game supports both, choose the controller. Its few buttons are easier for Claude
to use well than a full keyboard.

Copy it under a name of your own, then open it:

```
copy profiles\steam-gamepad-template.toml mygame.toml
notepad mygame.toml
```

Opening the copied file this way keeps the `.toml` ending. If you create a new file in
Notepad instead, it may save as `mygame.toml.txt`, which will not be found.

## Step 2: The rules of the format

You only need four:

- **Text goes in double quotes:** `name = "Hades"`. Numbers and `true`/`false` do not:
  `fps = 60`, `focus_check = true`.
- **A line starting with `#` is a comment** and is ignored. Delete the `#` to turn an
  example line on.
- **`[section]` lines start a group.** Every setting belongs to the group above it. Keep
  each group name exactly as it is, and only once.
- **Long text** can span several lines between three double quotes:

  ```
  notes = """
  First line.
  Second line.
  """
  ```

## Step 3: Fill in each part

### `name`

```toml
name = "Your Game"
```

The game's real name. Claude reads it, and it may already know the game from that.

### `[game]`

```toml
[game]
title_contains = "Your Game"
launch = "steam://rungameid/000000"
fps = 60
```

- **`title_contains`** is the most important setting. It is any part of the game window's
  title, and capitals do not matter. To find the title, start the game, then hover over
  its button on the taskbar, or press Alt+Tab. Choose a part that only the game's window
  has: `"Steam"` would also match the Steam window, and a game name could also match a
  browser tab about that game. `check` (step 4) shows which window it found, and lists
  every open window if it found none.
- **`launch`** is optional. It is used only with `--launch`, to start the game for you.
  For a Steam game, it is the number in the address of the game's Steam store page
  (`store.steampowered.com/app/NUMBER/...`). Leave the placeholder if you start the game
  yourself.
- **`fps`** is the frame rate the game runs at. 60 is right for most games. It sets how
  short a press can be and still be noticed.

### `[input]`

```toml
[input]
device = "gamepad"
```

- **`device`** is `"gamepad"` for the virtual Xbox controller, `"kbm"` for keyboard and
  mouse, or `"both"`.
- Leave the other lines (`tick_hz`, `min_hold_frames`, `min_release_frames`) as they are,
  unless the game misses presses. In that case raise both `min_` values to 3 or 4.
- **`focus_check = true`** makes gamepilot stop pressing buttons when another window is in
  front. Keep it on, so a stray keypress never lands in your browser.

### `[pacing]`

```toml
[pacing]
mode = "realtime"
# pause_input = "START"
```

Claude takes about 3 to 8 seconds to decide each move. During that time a real-time game
keeps running.

- For a game that waits for you (turn-based, puzzle, card games, menus), leave it as is.
- For a game that keeps moving, turn on `pause_input` by deleting the `#`. Set it to the
  button that pauses the game, such as `"START"` on a controller or `"KEY_ESC"` on a
  keyboard. gamepilot then pauses the game while Claude thinks. This only works if the
  same button also unpauses the game.

### `[bindings]`: what the buttons do

This tells Claude the game's controls in plain words. Each line is
`what it does = "which button"`:

```toml
[bindings]
confirm = "A"
cancel = "B"
attack = "X"
dash = "RB"
special = "Y"
open_map = "BACK"
pause_menu = "START"
move_up = "LS_UP"
move_down = "LS_DOWN"
move_left = "LS_LEFT"
move_right = "LS_RIGHT"
```

How to fill it in:

1. In the game, open Settings, then Controls, and note what each button does.
2. On the left, write a short name for the action. Use letters, numbers and `_`, with no
   spaces: `heavy_attack`, not `heavy attack`.
3. On the right, write the button's name in quotes.

Button names:

| Device | Names |
|---|---|
| Controller buttons | `A` `B` `X` `Y` `LB` `RB` `BACK` `START` `LS` (left stick click) `RS` |
| Controller d-pad | `DPAD_UP` `DPAD_DOWN` `DPAD_LEFT` `DPAD_RIGHT` |
| Controller sticks, pushed all the way | `LS_UP` `LS_DOWN` `LS_LEFT` `LS_RIGHT`, and the same with `RS_` |
| Controller triggers, pulled all the way | `LT` `RT` |
| Keyboard | `KEY_` and the key: `KEY_W` `KEY_SPACE` `KEY_ENTER` `KEY_ESC` `KEY_LEFTSHIFT` `KEY_TAB` `KEY_1` `KEY_F5` `KEY_UP` |
| Mouse | `MOUSE_LEFT` `MOUSE_RIGHT` `MOUSE_MIDDLE` `MOUSE_BACK` `MOUSE_FORWARD` |

Controller names follow the Xbox layout. On a PlayStation layout, A is Cross, B is Circle,
X is Square, Y is Triangle, LB is L1, RB is R1, LT is L2 and RT is R2. The PlayStation
names `L1` `R1` `L2` `R2` are accepted too.

An action that needs two buttons at once takes a list: `dodge_roll = ["B", "LS_LEFT"]`.

To see every accepted name:

```
py -m synthapps_gamepilot controls
```

A misspelled name is reported when you run `check`, with a suggestion such as "did you
mean KEY_SPACE?".

### `[agent]`: the goal and the limits

```toml
[agent]
goal = "Start a new game and get through the tutorial."
notes = """
The tutorial explains each control on screen; follow its instructions.
Do not change any settings in the options menu.
"""
effort = "low"
max_turns = 200
max_minutes = 30
max_cost_usd = 4.0
allow_anticheat = false
```

- **`goal`** says what "done" means. Make it concrete and reachable: "Finish the first
  level" works better than "Play well". Claude stops when it judges the goal reached.
- **`notes`** is everything Claude cannot see on screen: controls the menu does not show,
  what to avoid ("never sell the sword"), how the game saves, and which menus to stay out
  of.
- **`effort`** is how hard Claude thinks each turn. `"low"` is quick and cheap. Try
  `"medium"` or `"high"` if it makes poor decisions, which costs more and takes longer.
- **`max_turns`**, **`max_minutes`** and **`max_cost_usd`** stop the run at whichever
  limit comes first. In the built-in demo a turn cost about 1.5 cents at `"low"`. Real
  games send bigger screenshots, so expect somewhat more. Start with a low
  `max_cost_usd`, such as `1.0`, and raise it once things work.
- **`allow_anticheat`** stays `false`. See "Fair play" in the README.

Save the file (Ctrl+S).

## Step 4: Check the file

Start the game, then run:

```
py -m synthapps_gamepilot check mygame.toml
```

This reads the file and does not press anything. It prints one of three results:

- **A mistake in the file:** it names the line or the setting and says how to fix it.
  Correct it in Notepad, save, and run `check` again.
- **`Game window: NOT FOUND`:** it lists every open window. Find the game in that list
  and put part of its title in `title_contains`.
- **`Game window: found "..."`:** it saves `check.png` in the `gamepilot` folder. Open
  that image. It should show only the game, sharp and complete, because that is exactly
  what Claude will see. If it shows the wrong window, make `title_contains` more specific.
  If it is black, switch the game to *windowed* or *borderless window* mode in its video
  settings, because some games in exclusive fullscreen cannot be photographed.

## Step 5: A dry run, then a real run

The dry run lets Claude look and plan without pressing anything:

```
py -m synthapps_gamepilot play mygame.toml --dry-run --max-cost 0.5 --transcript run.jsonl --save-frames frames
```

Each turn prints one line: how long Claude thought, the running cost, and its plan.
Check that the plans fit what is on screen. If they do not, improve `notes` and
`[bindings]`.

Then the real run, the same command without `--dry-run`:

```
py -m synthapps_gamepilot play mygame.toml --max-cost 1
```

You have 3 seconds to click into the game window before it starts. To stop at any
moment, press **Pause/Break**, or create a file named `STOP` in the `gamepilot` folder,
or press Ctrl+C in PowerShell. Every button is released as soon as it stops.

## A complete example

A turn-based game played with a controller. The bindings are placeholders: copy the
real ones from your game's controls menu.

```toml
name = "My Turn-Based Game"

[game]
title_contains = "My Turn-Based Game"
fps = 60

[input]
device = "gamepad"
focus_check = true

[pacing]
mode = "realtime"

[bindings]
confirm = "A"
cancel = "B"
end_turn = "Y"
next_unit = "RB"
previous_unit = "LB"
move_cursor_up = "DPAD_UP"
move_cursor_down = "DPAD_DOWN"
move_cursor_left = "DPAD_LEFT"
move_cursor_right = "DPAD_RIGHT"
menu = "START"

[agent]
goal = "Win the first battle of the campaign."
notes = """
Move the cursor with the d-pad, select a unit with confirm, then choose its target.
End the turn when every unit has acted.
"""
effort = "low"
max_turns = 150
max_minutes = 30
max_cost_usd = 2.0
```
