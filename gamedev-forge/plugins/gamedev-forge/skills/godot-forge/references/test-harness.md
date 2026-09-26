# Scripted-input test harness for Godot 4

A small harness in the main scene lets a shell command play the game, report its state
and take screenshots. It is the cheapest way to test what a player actually does, and
most of the bugs players report live there.

Build it on day one. Every flow a player can reach (a menu, a shop, movement, save and
load) should get one line in the project's test script.

Measured on Godot 4.7.1 (Linux container, 2026-09-26) unless noted.

## Contents

1. The harness code
2. Where injected input arrives, headless and under xvfb (measured)
3. Writing a check: got/want, and prove it fails first
4. Real input versus state shortcuts
5. Screenshots
6. Real-time games: pads, replays, dialogs and long runs

## 1. The harness code

Put this in the main scene's script, or in an autoload. The test run passes commands
after `--`, so the engine's own arguments stay separate:

```bash
timeout 300 godot --headless --path proj --quit-after 3000 -- --script=dump,click:120:115,wait,dump
```

```gdscript
# ---------------------------------------------------------------- test harness
var _cmds: Array = []
var _scripted := false                    # true only when launched with --script=...
var _shot := ""
var _shot_frame := 0
var _frames := 0

func _harness_ready() -> void:            # call from _ready()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--script="):
			_cmds = Array(a.substr(9).split(","))
			_scripted = true
		elif a.begins_with("--shot="):
			_shot = a.substr(7)
		elif a.begins_with("--frames="):
			_shot_frame = int(a.substr(9))

func _harness_process() -> void:          # call from _process()
	_frames += 1
	# One command every 6 frames; also wait while tweens or animations run (add your own busy check).
	if not _cmds.is_empty() and _frames % 6 == 0:
		_run(String(_cmds.pop_front()))
	if _scripted and _cmds.is_empty():
		if _shot != "":
			if _frames >= maxi(_shot_frame, 10):
				get_viewport().get_texture().get_image().save_png(_shot)
				get_tree().quit()
		elif _frames % 6 == 0:
			get_tree().quit()                 # a normal launch (no --script) never quits

func _run(cmd: String) -> void:
	var p := cmd.split(":")
	match p[0]:
		"click":  _mouse(Vector2(float(p[1]), float(p[2])), MOUSE_BUTTON_LEFT)
		"rclick": _mouse(Vector2(float(p[1]), float(p[2])), MOUSE_BUTTON_RIGHT)
		"key":    _key(OS.find_keycode_from_string(p[1]))     # key:Escape, key:W
		"wait":   pass
		"dump":   print("DUMP ", _state_line())                # one greppable line
		_:        print("HARNESS unknown command: ", cmd)      # a typo must fail the test, not do nothing

func _mouse(at: Vector2, button: MouseButton) -> void:
	var m := InputEventMouseMotion.new()
	m.position = at
	m.global_position = at
	Input.parse_input_event(m)
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.position = at
		e.global_position = at
		e.button_index = button
		e.pressed = pressed
		Input.parse_input_event(e)

func _key(code: Key) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = code
		e.physical_keycode = code
		e.pressed = pressed
		Input.parse_input_event(e)

func _state_line() -> String:
	# Replace with your game's state: everything a check might assert on, as key=value pairs.
	return "frames=%d" % _frames
```

Coordinates are in the base canvas: the viewport size set in the project (for example
640×360), not window pixels.

Keep the game-specific commands (`dump`, teleports, giving items) small, and add them as
needed. The `click`, `rclick` and `key` commands are the ones that matter.

## 2. Where injected input arrives (measured)

| run | mouse click reaches `_input` / `_unhandled_input` | mouse click presses a GUI `Control` (Button) | key reaches `_unhandled_input` |
|---|---|---|---|
| `godot --headless` | yes | **no** (tried `Input.parse_input_event`, `Viewport.push_input`, press and release in separate frames) | yes |
| `xvfb-run -a -s "-screen 0 1280x720x24" godot --rendering-driver opengl3 --audio-driver Dummy` | yes | yes | yes |

What this means:

- **The UI is Control nodes** (Button, ItemList, …). Run click tests under `xvfb-run`, not
  `--headless`. The headless run gives a false "the button does nothing".
- **The UI is drawn by hand** in `_draw` with your own hit list. Headless works. You can
  also route `click:x:y` straight into the game's own click handler, the same function
  that `_input` calls. The first remake did this (`_click_at(p, right)`). Just
  never go around that function.
- `--audio-driver Dummy` removes the ALSA and PulseAudio error spam when the container has
  no sound device. Without it the log shows `ERROR: … ERR_CANT_OPEN` from the ALSA
  driver, which is harmless but hides real errors from a grep.

## 3. Writing a check

Assert on the `DUMP` lines, as one got/want string per flow:

```bash
echo "== shop: talk, buy, stow by portrait, walk on"
got=$(timeout 300 godot --headless --path godot --quit-after 3000 -- \
  --script=seed:5,dialog:peddler,wait,click:100:94,wait,wait,click:100:120,wait,click:264:310,wait,dump,click:495:150,wait,wait,dump \
  2>&1 | grep -oE "pos=[0-9]+,[0-9]+ .* held=[a-z_]+ packs=[0-9,]+" | tr '\n' '|')
want="pos=1,1 ... held=none packs=1,1,3,1|pos=2,1 ... held=none packs=1,1,3,1|"
[ "$got" = "$want" ] || { echo "FAIL shop"; echo " got:  $got"; echo " want: $want"; exit 1; }
```

- **Prove the check fails on the old code.** Revert the fix, run the check, and watch it
  fail. Then restore the fix. A check that passes both ways tests nothing. This is the
  same idea as mutation testing (below), applied to one bug.
- **Find coordinates from a screenshot.** Don't guess them. A click that misses its
  target fails silently: in one session, a dialogue choice was aimed 11 px too low
  and hit the wrong option.
- **Wrap every run in `timeout`.** A script error does not stop the main loop, so a
  broken run can live forever. `--quit-after N` is the second guard. Make N large
  (3000) when commands wait on tweens; headless frames are very short. With 150, a run
  stopped after 3 of its 6 dumps, and it gave no error.
- **End every run with `dump`, and require that line.** It proves the run reached its
  last command. Also fail on `HARNESS unknown command`.
- **Harden the test script itself:**
  - start it with `set -eo pipefail`, because without `pipefail` a failing suite piped
    into `grep` does not stop the run;
  - compare every printed result with a floor (`wins 12/12` must stay at or above 12).

**Mutation testing for rules code.**
1. Keep a list of small deliberate bugs, for example `>=` becoming `>`, a constant off by
   one, or a sign flipped in a formula.
2. Apply each one with an asserted text replace.
3. Run the suite, and expect it to fail.
4. Restore the file.

A mutant that survives means a weak test. In one session two survived, and two stronger
tests were written: a disc angle where rounding matters, and an explicit stat-bonus case.
Brute-force search, trying many inputs in a small script, found the input values where
the mutant and the original differ.

Mutate the view too, not only the rules. In that session every mutant touched the
rules scripts. All three bugs the first player found were in the view and input code:
the button drawing, the click router, and modal state.

## 4. Real input versus state shortcuts

Shortcut commands such as `ov:inventory`, `shop:id` and `at:x:y` are useful for reaching a
state quickly. But a check that uses them skips the code the player runs, and that code
is where the bugs were:

- Tests opened the shop with `shop:` and the inventory with `ov:`. No test ever pressed
  the inventory **button while the shop was open**. That path left the shop's game
  state open behind the new panel, and movement froze until a reload.
- Tests gave items with `give:`. No test **bought an item and clicked a portrait** with
  the shop open. That click only selected the character, so a bought item could never
  be stowed.

Rule: use shortcuts to set up the state. Then do the step under test with
`click`/`rclick`/`key`, exactly as a player would.

## 5. Screenshots

```bash
xvfb-run -a -s "-screen 0 1280x720x24" godot --path proj --rendering-driver opengl3 \
  --audio-driver Dummy --resolution 640x360 -- --script=...,wait --shot=/abs/out.png --frames=40
```

- Look at every screen you changed, at 1×. Crop and upscale with nearest-neighbour
  (PIL `Image.NEAREST`) to judge pixel text.
- Put worst-case data on screen before judging a layout: the longest name, a real
  timestamp, a full inventory, an old save from a previous version.
- `--main-pack build/game.exe` runs the data packed inside an exported Windows exe with
  the Linux editor binary. Use it to test the exact build you are about to send.

## 6. Real-time games: pads, replays, dialogs and long runs

Learned on a platformer remake with keyboard and gamepad controls (Godot 4.7.1).

**Pad events.** Build them like keys and push them through the same path:

```gdscript
func _pad(button: JoyButton, pressed: bool) -> void:
	var e := InputEventJoypadButton.new()
	e.device = 0
	e.button_index = button
	e.pressed = pressed
	Input.parse_input_event(e)
	Input.flush_buffered_events()   # deliver it now, not with next frame's batch

func _axis(axis: JoyAxis, value: float) -> void:
	var e := InputEventJoypadMotion.new()
	e.device = 0
	e.axis = axis
	e.axis_value = value
	Input.parse_input_event(e)
	Input.flush_buffered_events()
```

Give the harness separate `key`/`keyup`/`tap` and `pad`/`padup`/`ptap` commands, plus
`axis:lx:-1`. A held button is a different test from a tap.

**Replays through device events.** A route recorded as per-step inputs can be played back
as key or pad events (`replay:STAGE:kb`, `replay:STAGE:pad`). That tests the input map
for both devices on every stage. Print one greppable result line (`REPLAY hollow ok`),
and quit the harness when the replay ends, so the run does not idle until
`--quit-after`.

**Dialogs during a replay.** A plain replay closes dialogs by itself, so it never tests
what a player does there. Add a talk mode:
- the replay pauses at each dialog and waits for the script to page it (`ptap:a`);
- a `waitmodal` command waits for the next dialog, and prints a clear line if the replay
  ends first;
- the replay resumes only once every button is up.

Keep reading harness commands while the game is paused. The first version stopped the
command queue during the pause, so the script could never close the dialog, and the run
hung.

**The button that closes a window must not act in the game.** A player closed a dialog
with A (jump), and the hero jumped as play resumed: the still-held button was read as a
fresh press. Ignore every button that was down when the window closed until it is
released. The talk replay guards this, because a leaked jump makes the route desync.

**Story screens need a guard.** Fire and jump also turned the ending pages, so a player
still firing at the boss skipped three pages at once. Ignore buttons for about 0.8 s
after each page appears, and test it by firing through the fade.

**End a script with `quit`.** Without it, a run lasts until `--quit-after`, and a slow
test is hard to tell from a hung one.

**Long runs:**
- Godot's stdout is block-buffered when it goes to a file or a pipe, so a background
  run shows nothing until it exits. Print progress with `printerr`.
- `pkill -f playthrough` also matches the shell that ran it and kills that shell. Kill
  by PID.
- Parse only after the run has finished. Capture the output to a variable or a file,
  then grep it.
- Don't put `|` inside a want-string when the check joins lines with `tr '\n' '|'` and
  matches with `grep -E`, where `|` means "or". One check matched far too much this way.

