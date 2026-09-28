extends Node
## Application controller: screens and menus, input (keyboard + every SDL gamepad) with
## rebinding, the fixed 60 Hz step with game-speed scaling, rewind history, save slots
## (quick, auto, three manual), options, vibration, button prompts and the test harness.

const ACTIONS := ["left", "right", "up", "down", "jump", "attack", "sub", "rewind", "pause",
	"quicksave", "quickload"]
const ACTION_LABEL := {"left": "Left", "right": "Right", "up": "Up", "down": "Down",
	"jump": "Jump / OK", "attack": "Whip", "sub": "Sub-weapon / Back", "rewind": "Rewind (hold)",
	"pause": "Pause", "quicksave": "Quick save", "quickload": "Quick load"}
const DEFAULT_KEYS := {"left": [KEY_LEFT, KEY_A], "right": [KEY_RIGHT, KEY_D], "up": [KEY_UP, KEY_W],
	"down": [KEY_DOWN, KEY_S], "jump": [KEY_Z, KEY_SPACE], "attack": [KEY_X, KEY_J],
	"sub": [KEY_C, KEY_K], "rewind": [KEY_R, KEY_BACKSPACE], "pause": [KEY_ENTER, KEY_ESCAPE],
	"quicksave": [KEY_F5], "quickload": [KEY_F9]}
const DEFAULT_PAD := {"left": [JOY_BUTTON_DPAD_LEFT], "right": [JOY_BUTTON_DPAD_RIGHT],
	"up": [JOY_BUTTON_DPAD_UP], "down": [JOY_BUTTON_DPAD_DOWN], "jump": [JOY_BUTTON_A],
	"attack": [JOY_BUTTON_X], "sub": [JOY_BUTTON_B, JOY_BUTTON_Y], "rewind": [JOY_BUTTON_LEFT_SHOULDER],
	"pause": [JOY_BUTTON_START], "quicksave": [JOY_BUTTON_BACK], "quickload": []}

const OPTION_DEFAULTS := {"style": "classic", "diff": "normal", "inf_lives": false, "rewind": 10,
	"speed": 100, "music": 7, "sfx": 8, "soundtrack": "16", "scanlines": false, "fullscreen": false,
	"vibration": true, "autosave": true}

var game := Game.new()
var view: GameView
var ui: Node2D
var audio: GameAudio

var screen := "title"
var screen_t := 0
var menu: Dictionary = {}
var menu_stack: Array = []
var opts: Dictionary = OPTION_DEFAULTS.duplicate()
var history: Array = []
var rewinding := false
var rewind_t := 0
var speed_acc := 0.0
var swallow: Dictionary = {}
var toast := ""
var toast_t := 0
var rebind_action := ""
var last_device := "keyboard"   # keyboard | xbox | ps | nintendo
var _last_block := ""
var _ending_page := 0
var user_dir := "user://"

# harness
var _cmds: Array = []
var _scripted := false
var _wait := 0
var _held: Dictionary = {}
var shot_path := ""


# ======================================================================== setup

func _ready() -> void:
	_harness_parse()
	get_tree().auto_accept_quit = false
	view = GameView.new()
	view.game = game
	add_child(view)
	ui = preload("res://scripts/view/ui.gd").new()
	ui.main = self
	add_child(ui)
	audio = GameAudio.new()
	add_child(audio)
	DirAccess.make_dir_recursive_absolute(user_dir + "saves")
	_load_options()
	_build_input_map()
	_load_bindings()
	_apply_options()
	game.new_game(opts.style, 1, 1)   # an attract-mode world behind the title
	_go("title")


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		quit_game()


func quit_game() -> void:
	# stop audio before quitting: quitting mid-song leaks the playback
	audio.stop_all()
	await get_tree().create_timer(0.1).timeout
	get_tree().quit()


# ======================================================================== options

func _opt_path() -> String:
	return user_dir + "options.cfg"


func _load_options() -> void:
	var cf := ConfigFile.new()
	if not _scripted and cf.load(_opt_path()) == OK:
		for k in OPTION_DEFAULTS:
			opts[k] = cf.get_value("options", k, OPTION_DEFAULTS[k])


func save_options() -> void:
	var cf := ConfigFile.new()
	for k in opts:
		cf.set_value("options", k, opts[k])
	cf.save(_opt_path())


func _apply_options() -> void:
	audio.set_volumes(int(opts.music) / 10.0, int(opts.sfx) / 10.0)
	audio.soundtrack = String(opts.soundtrack)
	view.scanlines = bool(opts.scanlines)
	if not _scripted:
		var want := DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN if opts.fullscreen else DisplayServer.WINDOW_MODE_WINDOWED
		if DisplayServer.window_get_mode() != want:
			DisplayServer.window_set_mode(want)
	if not game.s.is_empty():
		game.s.style = opts.style
		game.s.diff = opts.diff
		game.s.inf_lives = bool(opts.inf_lives) or bool(game.s.get("practice", false))
	var cap := int(opts.rewind) * 60
	while history.size() > cap:
		history.pop_front()


# ======================================================================== input map & rebinding

func _build_input_map() -> void:
	for a in ACTIONS:
		if InputMap.has_action(a):
			InputMap.erase_action(a)
		InputMap.add_action(a, 0.4)
		for k in DEFAULT_KEYS[a]:
			var e := InputEventKey.new()
			e.physical_keycode = k
			InputMap.action_add_event(a, e)
		for b in DEFAULT_PAD[a]:
			var j := InputEventJoypadButton.new()
			j.button_index = b
			j.device = -1
			InputMap.action_add_event(a, j)
	# left stick doubles the d-pad
	var axes := {"left": [JOY_AXIS_LEFT_X, -1.0], "right": [JOY_AXIS_LEFT_X, 1.0],
		"up": [JOY_AXIS_LEFT_Y, -1.0], "down": [JOY_AXIS_LEFT_Y, 1.0]}
	for a in axes:
		var m := InputEventJoypadMotion.new()
		m.axis = axes[a][0]
		m.axis_value = axes[a][1]
		m.device = -1
		InputMap.action_add_event(a, m)
	# left trigger also rewinds
	var lt := InputEventJoypadMotion.new()
	lt.axis = JOY_AXIS_TRIGGER_LEFT
	lt.axis_value = 1.0
	lt.device = -1
	InputMap.action_add_event("rewind", lt)


func _bind_path() -> String:
	return user_dir + "input.cfg"


func _load_bindings() -> void:
	var cf := ConfigFile.new()
	if _scripted or cf.load(_bind_path()) != OK:
		return
	for a in ACTIONS:
		var keys: Array = cf.get_value("keys", a, [])
		var pads: Array = cf.get_value("pad", a, [])
		if not keys.is_empty():
			_set_binding(a, "key", keys)
		if not pads.is_empty():
			_set_binding(a, "pad", pads)


func _save_bindings() -> void:
	var cf := ConfigFile.new()
	for a in ACTIONS:
		cf.set_value("keys", a, binding_codes(a, "key"))
		cf.set_value("pad", a, binding_codes(a, "pad"))
	cf.save(_bind_path())


func binding_codes(a: String, kind: String) -> Array:
	var out := []
	for e in InputMap.action_get_events(a):
		if kind == "key" and e is InputEventKey:
			out.append(int((e as InputEventKey).physical_keycode))
		elif kind == "pad" and e is InputEventJoypadButton:
			out.append(int((e as InputEventJoypadButton).button_index))
	return out


func _set_binding(a: String, kind: String, codes: Array) -> void:
	for e in InputMap.action_get_events(a):
		if (kind == "key" and e is InputEventKey) or (kind == "pad" and e is InputEventJoypadButton):
			InputMap.action_erase_event(a, e)
	for c in codes:
		if kind == "key":
			var k := InputEventKey.new()
			k.physical_keycode = int(c)
			InputMap.action_add_event(a, k)
		else:
			var j := InputEventJoypadButton.new()
			j.button_index = int(c)
			j.device = -1
			InputMap.action_add_event(a, j)


func reset_bindings() -> void:
	_build_input_map()
	_save_bindings()


func pad_family(dev: int) -> String:
	var n := Input.get_joy_name(dev).to_lower()
	if n.contains("ps") or n.contains("dualshock") or n.contains("dualsense") or n.contains("playstation") or n.contains("sony"):
		return "ps"
	if n.contains("nintendo") or n.contains("switch") or n.contains("pro controller") or n.contains("joy-con"):
		return "nintendo"
	return "xbox"


const PAD_NAMES := {
	"xbox": {JOY_BUTTON_A: "A", JOY_BUTTON_B: "B", JOY_BUTTON_X: "X", JOY_BUTTON_Y: "Y",
		JOY_BUTTON_LEFT_SHOULDER: "LB", JOY_BUTTON_RIGHT_SHOULDER: "RB", JOY_BUTTON_START: "MENU",
		JOY_BUTTON_BACK: "VIEW"},
	"ps": {JOY_BUTTON_A: "CROSS", JOY_BUTTON_B: "CIRCLE", JOY_BUTTON_X: "SQUARE", JOY_BUTTON_Y: "TRIANGLE",
		JOY_BUTTON_LEFT_SHOULDER: "L1", JOY_BUTTON_RIGHT_SHOULDER: "R1", JOY_BUTTON_START: "OPTIONS",
		JOY_BUTTON_BACK: "SHARE"},
	# SDL reports the Nintendo layout by position: the bottom face button is "A" to SDL, "B" on the pad
	"nintendo": {JOY_BUTTON_A: "B", JOY_BUTTON_B: "A", JOY_BUTTON_X: "Y", JOY_BUTTON_Y: "X",
		JOY_BUTTON_LEFT_SHOULDER: "L", JOY_BUTTON_RIGHT_SHOULDER: "R", JOY_BUTTON_START: "+",
		JOY_BUTTON_BACK: "-"},
}


func prompt(a: String) -> String:
	## The button to show for an action on the device the player is using now.
	if last_device == "keyboard":
		var ks := binding_codes(a, "key")
		return OS.get_keycode_string(int(ks[0])).to_upper() if not ks.is_empty() else "--"
	var ps := binding_codes(a, "pad")
	if ps.is_empty():
		return "--"
	var b := int(ps[0])
	var names: Dictionary = PAD_NAMES.get(last_device, PAD_NAMES.xbox)
	if names.has(b):
		return names[b]
	return {JOY_BUTTON_DPAD_UP: "UP", JOY_BUTTON_DPAD_DOWN: "DOWN", JOY_BUTTON_DPAD_LEFT: "LEFT",
		JOY_BUTTON_DPAD_RIGHT: "RIGHT", JOY_BUTTON_LEFT_STICK: "LS", JOY_BUTTON_RIGHT_STICK: "RS"}.get(b, "BTN%d" % b)


func vibrate(weak: float, strong: float, secs: float) -> void:
	if not opts.vibration:
		return
	for d in Input.get_connected_joypads():
		Input.start_joy_vibration(d, weak, strong, secs)


# ======================================================================== input events

func _input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed:
		last_device = "keyboard"
	elif (ev is InputEventJoypadButton and ev.pressed) or (ev is InputEventJoypadMotion and absf(ev.axis_value) > 0.5):
		last_device = pad_family(ev.device)
	if screen == "rebind_wait":
		_rebind_capture(ev)
		get_viewport().set_input_as_handled()
		return
	if screen == "play":
		if ev.is_action_pressed("pause") and not ev.is_echo():
			_open_pause()
		elif ev.is_action_pressed("quicksave") and not ev.is_echo():
			save_slot("quick")
		elif ev.is_action_pressed("quickload") and not ev.is_echo():
			load_slot("quick")
		return
	if _menu_screen():
		_menu_input(ev)


func _menu_screen() -> bool:
	return not menu.is_empty() and screen != "play"


func _game_input() -> Dictionary:
	var d := {}
	var map := {"l": "left", "r": "right", "u": "up", "d": "down", "jump": "jump", "atk": "attack", "sub": "sub"}
	for k in map:
		var a: String = map[k]
		var on := Input.is_action_pressed(a)
		if swallow.has(a):
			if on:
				on = false
			else:
				swallow.erase(a)
		d[k] = on
	# opposite directions cancel, as on a real d-pad
	if d.l and d.r:
		d.l = false
		d.r = false
	return d


func _swallow_held() -> void:
	## Buttons held when a menu closes don't act in the game until released.
	for a in ["jump", "attack", "sub", "up", "down", "left", "right"]:
		if Input.is_action_pressed(a):
			swallow[a] = true


# ======================================================================== the loop

func _physics_process(_d: float) -> void:
	_harness_tick()
	screen_t += 1
	if toast_t > 0:
		toast_t -= 1
	match screen:
		"play":
			_tick_play()
		"title":
			if screen_t > 20 and _any_pressed():
				_open_main_menu()
		"ending":
			_tick_ending()
		_:
			pass
	_update_music()


func _process(_d: float) -> void:
	if shot_path != "":
		var img := get_viewport().get_texture().get_image()
		img.save_png(shot_path)
		print("SHOT ", shot_path, " ", img.get_size())
		shot_path = ""


func _any_pressed() -> bool:
	for a in ["jump", "attack", "pause"]:
		if Input.is_action_just_pressed(a):
			return true
	return false


func _tick_play() -> void:
	var rewind_ok: bool = int(opts.rewind) > 0
	if rewind_ok and Input.is_action_pressed("rewind") and not history.is_empty():
		rewinding = true
		rewind_t += 1
		var n := 1 if rewind_t < 45 else 2
		for i in n:
			if history.size() > 1:
				history.pop_back()
		game.restore(history[history.size() - 1])
		view.game = game
		return
	if rewinding:
		rewinding = false
		rewind_t = 0
		_swallow_held()
		if game.s.mode == "gameover":
			pass
	if game.s.mode == "gameover":
		_open_gameover()
		return
	if game.s.mode == "ending":
		_start_ending()
		return
	speed_acc += int(opts.speed) / 100.0
	while speed_acc >= 1.0:
		speed_acc -= 1.0
		_step_once()


func _step_once() -> void:
	game.step(_game_input())
	for ev in game.events:
		if ev.has("sfx"):
			audio.play(String(ev.sfx))
			match String(ev.sfx):
				"hurt":
					vibrate(0.4, 0.7, 0.25)
				"bosshit":
					vibrate(0.25, 0.0, 0.08)
				"bossdie":
					vibrate(0.8, 0.8, 0.7)
				"death":
					vibrate(0.6, 1.0, 0.5)
	if int(opts.rewind) > 0:
		history.append(game.snapshot())
		if history.size() > int(opts.rewind) * 60:
			history.pop_front()
	# autosave whenever a new block starts
	if game.s.mode == "play" and game.s.block != _last_block:
		_last_block = game.s.block
		if opts.autosave and not game.s.practice:
			save_slot("auto", true)


func _update_music() -> void:
	var track := ""
	match screen:
		"title", "menu", "options", "controls", "rebind", "rebind_wait", "slots", "practice":
			track = "title" if game.s.get("mode", "") != "play" or screen == "title" or not _in_game() else _game_track()
		"play", "pause":
			track = _game_track()
		"gameover":
			track = "gameover"
		"ending":
			track = "ending"
	audio.music(track)


func _in_game() -> bool:
	return menu_stack.size() > 0 and String(menu_stack[0].get("id", "")) == "pause" or screen == "pause"


func _game_track() -> String:
	var s: Dictionary = game.s
	if s.mode == "clear":
		return "clear"
	if s.mode == "dying" and int(s.mode_t) > 20:
		return "death"
	if int(s.boss.id) != 0 and int(s.boss.hp) > 0:
		return "boss"
	var l := game.lvl()
	return String(l.meta.get("music", "stage1")) if l != null else ""


# ======================================================================== game start / saves

func start_new_game(stage: int = 1, practice: bool = false) -> void:
	game.new_game(opts.style, stage, int(Time.get_ticks_usec() & 0x7fffffff) if not _scripted else 4242)
	game.s.practice = practice
	if practice:
		game.s.p.whip = 3
		game.s.p.hearts = 30
	_apply_options()
	history.clear()
	_last_block = ""
	_close_menus()
	_go("play")


func slot_path(slot: String) -> String:
	return user_dir + "saves/%s.sav" % slot


func save_slot(slot: String, silent: bool = false) -> void:
	if game.s.mode != "play" and slot != "auto":
		show_toast("CAN'T SAVE NOW")
		return
	var f := FileAccess.open(slot_path(slot), FileAccess.WRITE)
	if f == null:
		show_toast("SAVE FAILED")
		return
	var stamp := Time.get_datetime_string_from_system(false, true).substr(5, 11)
	f.store_string(game.save_text(stamp))
	f.close()
	if not silent:
		show_toast("SAVED - " + slot.to_upper())
		audio.play("save")


func load_slot(slot: String) -> bool:
	if not FileAccess.file_exists(slot_path(slot)):
		show_toast("NO SAVE IN " + slot.to_upper())
		return false
	var ok := game.load_text(FileAccess.get_file_as_string(slot_path(slot)))
	if not ok:
		show_toast("SAVE UNREADABLE")
		return false
	_apply_options()
	history.clear()
	_last_block = game.s.block
	_close_menus()
	_swallow_held()
	_go("play")
	show_toast("LOADED - " + slot.to_upper())
	return true


func slot_label(slot: String) -> String:
	## Built from the saved state (not a stored string) so old saves show the new layout.
	var path := slot_path(slot)
	if not FileAccess.file_exists(path):
		return "- empty -"
	var v: Variant = str_to_var(FileAccess.get_file_as_string(path))
	if typeof(v) != TYPE_DICTIONARY or not v.has("state"):
		return "- unreadable -"
	var st: Dictionary = v.state
	return "%s  %06d  %s" % [String(st.get("block", "?")), int(st.get("score", 0)), String(v.get("label", ""))]


func show_toast(s: String) -> void:
	toast = s
	toast_t = 120


# ======================================================================== screens & menus

func _go(sc: String) -> void:
	screen = sc
	screen_t = 0


func _open_main_menu() -> void:
	var items := [{"id": "new", "label": "START GAME"}]
	if FileAccess.file_exists(slot_path("auto")) or FileAccess.file_exists(slot_path("quick")):
		items.append({"id": "continue", "label": "CONTINUE"})
	items.append_array([{"id": "load", "label": "LOAD GAME"}, {"id": "practice", "label": "PRACTICE"},
		{"id": "options", "label": "OPTIONS"}, {"id": "quit", "label": "QUIT"}])
	menu_stack.clear()
	menu = {"id": "main", "title": "", "items": items, "sel": 0}
	_go("menu")


func _open_pause() -> void:
	menu_stack.clear()
	menu = {"id": "pause", "title": "PAUSED", "items": [
		{"id": "resume", "label": "RESUME"}, {"id": "save", "label": "SAVE GAME"},
		{"id": "load", "label": "LOAD GAME"}, {"id": "options", "label": "OPTIONS"},
		{"id": "retry", "label": "RESTART STAGE"}, {"id": "title", "label": "QUIT TO TITLE"}], "sel": 0}
	audio.play("pause")
	_go("pause")


func _open_gameover() -> void:
	menu_stack.clear()
	menu = {"id": "gameover", "title": "GAME OVER", "items": [
		{"id": "cont", "label": "CONTINUE"}, {"id": "title", "label": "QUIT TO TITLE"}], "sel": 0}
	_go("gameover")


func _push(m: Dictionary, sc: String) -> void:
	menu_stack.append({"menu": menu, "screen": screen, "id": menu.get("id", "")})
	menu = m
	_go(sc)


func _pop() -> void:
	if menu_stack.is_empty():
		if screen == "pause":
			_resume()
		return
	var top: Dictionary = menu_stack.pop_back()
	menu = top.menu
	_go(String(top.screen))


func _close_menus() -> void:
	menu_stack.clear()
	menu = {}


func _resume() -> void:
	_close_menus()
	_swallow_held()
	_go("play")


func _open_options() -> void:
	_push({"id": "options", "title": "OPTIONS", "items": _option_items(), "sel": 0}, "options")


func _option_items() -> Array:
	return [
		{"id": "style", "label": "CONTROL FEEL", "vals": ["classic", "modern"]},
		{"id": "diff", "label": "DIFFICULTY", "vals": ["easy", "normal", "hard"]},
		{"id": "inf_lives", "label": "INFINITE LIVES", "vals": [false, true]},
		{"id": "rewind", "label": "REWIND", "vals": [0, 5, 10, 20, 30]},
		{"id": "speed", "label": "GAME SPEED", "vals": [100, 90, 80, 70, 60, 50]},
		{"id": "music", "label": "MUSIC VOLUME", "vals": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
		{"id": "sfx", "label": "SOUND VOLUME", "vals": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
		{"id": "soundtrack", "label": "SOUNDTRACK", "vals": ["16", "8"]},
		{"id": "scanlines", "label": "SCANLINES", "vals": [false, true]},
		{"id": "fullscreen", "label": "FULLSCREEN", "vals": [false, true]},
		{"id": "vibration", "label": "VIBRATION", "vals": [true, false]},
		{"id": "autosave", "label": "AUTO-SAVE", "vals": [true, false]},
		{"id": "controls", "label": "CONTROLS..."},
		{"id": "back", "label": "BACK"},
	]


func option_text(it: Dictionary) -> String:
	if not it.has("vals"):
		return ""
	var v: Variant = opts[it.id]
	match String(it.id):
		"style":
			return "CLASSIC" if v == "classic" else "MODERN"
		"rewind":
			return "OFF" if int(v) == 0 else "%d SEC" % int(v)
		"speed":
			return "%d%%" % int(v)
		"soundtrack":
			return "16-BIT" if v == "16" else "8-BIT"
		"music", "sfx":
			return "%d" % int(v)
		"diff":
			return String(v).to_upper()
	if typeof(v) == TYPE_BOOL:
		return "ON" if v else "OFF"
	return str(v)


func _open_controls() -> void:
	var items := []
	for a in ACTIONS:
		items.append({"id": "bind", "action": a, "label": String(ACTION_LABEL[a]).to_upper()})
	items.append({"id": "reset", "label": "RESET TO DEFAULTS"})
	items.append({"id": "back", "label": "BACK"})
	_push({"id": "controls", "title": "CONTROLS", "items": items, "sel": 0}, "controls")


func _open_slots(mode: String) -> void:
	var items := []
	for slot in ["quick", "auto", "slot1", "slot2", "slot3"]:
		if mode == "save" and slot == "auto":
			continue
		items.append({"id": "slot", "slot": slot, "label": slot.to_upper()})
	items.append({"id": "back", "label": "BACK"})
	_push({"id": "slots", "mode": mode, "title": "SAVE GAME" if mode == "save" else "LOAD GAME",
		"items": items, "sel": 0}, "slots")


func _open_practice() -> void:
	var items := []
	for n in range(1, Game.STAGES + 1):
		if Game.levels_for_stage(n).has("%d-1" % n):
			items.append({"id": "stage", "n": n, "label": "STAGE %d" % n})
	items.append({"id": "back", "label": "BACK"})
	_push({"id": "practice", "title": "PRACTICE", "items": items, "sel": 0}, "practice")


func _menu_input(ev: InputEvent) -> void:
	if ev.is_echo():
		return
	var items: Array = menu.get("items", [])
	if items.is_empty():
		return
	var sel: int = menu.sel
	if ev.is_action_pressed("up"):
		menu.sel = (sel - 1 + items.size()) % items.size()
		audio.play("cursor")
	elif ev.is_action_pressed("down"):
		menu.sel = (sel + 1) % items.size()
		audio.play("cursor")
	elif ev.is_action_pressed("left") or ev.is_action_pressed("right"):
		var it: Dictionary = items[sel]
		if it.has("vals"):
			var vals: Array = it.vals
			var i := vals.find(opts[it.id])
			i = (i + (1 if ev.is_action_pressed("right") else -1) + vals.size()) % vals.size()
			opts[it.id] = vals[i]
			_apply_options()
			save_options()
			audio.play("cursor")
	elif ev.is_action_pressed("jump") or ev.is_action_pressed("attack") or (ev.is_action_pressed("pause") and screen != "pause"):
		if screen_t > 6:
			_menu_accept(items[sel])
	elif ev.is_action_pressed("sub") or (ev.is_action_pressed("pause") and screen == "pause"):
		if screen == "pause" and menu_stack.is_empty():
			_resume()
		elif screen != "menu" and screen != "gameover":
			_pop()


func _menu_accept(it: Dictionary) -> void:
	audio.play("select")
	var id: String = it.id
	match id:
		"new":
			start_new_game(1)
		"continue":
			var best := "auto"
			if FileAccess.file_exists(slot_path("quick")) and (not FileAccess.file_exists(slot_path("auto")) or \
					FileAccess.get_modified_time(slot_path("quick")) > FileAccess.get_modified_time(slot_path("auto"))):
				best = "quick"
			load_slot(best)
		"load":
			_open_slots("load")
		"save":
			_open_slots("save")
		"practice":
			_open_practice()
		"stage":
			start_new_game(int(it.n), true)
		"options":
			_open_options()
		"controls":
			_open_controls()
		"quit":
			quit_game()
		"resume":
			_resume()
		"retry":
			var st: int = game.s.stage
			var keep := game.s.duplicate(true)
			game.continue_game()
			game.s.score = keep.score
			game.s.lives = keep.lives
			game.s.practice = keep.practice
			_apply_options()
			history.clear()
			_resume()
		"title":
			_close_menus()
			game.new_game(opts.style, 1, 1)
			history.clear()
			_go("title")
		"cont":
			game.continue_game()
			_apply_options()
			history.clear()
			_resume()
		"back":
			_pop()
		"slot":
			var slot: String = it.slot
			if menu.mode == "save":
				_pop()
				_pop()
				save_slot(slot)
				_resume()
			else:
				load_slot(slot)
		"bind":
			rebind_action = it.action
			_go("rebind_wait")
		"reset":
			reset_bindings()
			show_toast("CONTROLS RESET")
		_:
			if it.has("vals"):
				var vals: Array = it.vals
				var i := vals.find(opts[it.id])
				opts[it.id] = vals[(i + 1) % vals.size()]
				_apply_options()
				save_options()
			else:
				push_error("menu item with no handler: " + id)


func _rebind_capture(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.is_echo():
		var k := ev as InputEventKey
		if k.physical_keycode == KEY_ESCAPE:
			_go("controls")
			return
		_set_binding(rebind_action, "key", [int(k.physical_keycode)])
	elif ev is InputEventJoypadButton and ev.pressed:
		_set_binding(rebind_action, "pad", [int((ev as InputEventJoypadButton).button_index)])
	else:
		return
	_save_bindings()
	audio.play("select")
	_go("controls")
	screen_t = 0


# ======================================================================== ending

func _start_ending() -> void:
	_close_menus()
	_ending_page = 0
	_go("ending")
	# a finished run clears the resume slots so CONTINUE doesn't reopen the last boss
	for s in ["auto", "quick"]:
		if FileAccess.file_exists(slot_path(s)):
			DirAccess.remove_absolute(slot_path(s))


const ENDING_PAGES := 4


func _tick_ending() -> void:
	# story pages ignore buttons for 0.8 s, so fire held from the boss can't skip them
	if screen_t > 48 and _any_pressed():
		_ending_page += 1
		screen_t = 0
		if _ending_page >= ENDING_PAGES:
			game.new_game(opts.style, 1, 1)
			history.clear()
			_go("title")


# ======================================================================== test harness

func _harness_parse() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--script="):
			_cmds = Array(a.substr(9).split(","))
			_scripted = true
	if _scripted:
		user_dir = "user://harness/"
		DirAccess.make_dir_recursive_absolute(user_dir)
		# start empty: results must not depend on earlier runs
		var d := DirAccess.open(user_dir + "saves")
		if d != null:
			for f in d.get_files():
				d.remove(f)


func _harness_tick() -> void:
	if not _scripted:
		return
	if _wait > 0:
		_wait -= 1
		return
	while not _cmds.is_empty() and _wait == 0:
		var c := String(_cmds.pop_front())
		_harness_run(c)
	if _cmds.is_empty() and _wait == 0:
		print("HARNESS end of script")
		_scripted = false
		quit_game()


func _harness_run(cmd: String) -> void:
	var p := cmd.split(":")
	match p[0]:
		"wait":
			_wait = int(p[1]) if p.size() > 1 else 1
		"hold":
			_act(p[1], true)
		"up":
			_act(p[1], false)
		"tap":
			_act(p[1], true)
			_cmds.push_front("up:" + p[1])
			_cmds.push_front("wait:2")
		"key":
			_key(OS.find_keycode_from_string(p[1]), true)
			_key(OS.find_keycode_from_string(p[1]), false)
		"keydown":
			_key(OS.find_keycode_from_string(p[1]), true)
		"keyup":
			_key(OS.find_keycode_from_string(p[1]), false)
		"pad":
			_pad(int(p[1]), true)
		"padup":
			_pad(int(p[1]), false)
		"new":
			opts.style = p[1] if p.size() > 1 else "classic"
			start_new_game(int(p[2]) if p.size() > 2 else 1)
		"block":
			game.load_block(p[1])
		"stage":
			game.start_stage(int(p[1]))
			game._snap_camera()
		"boss":
			# stand just short of the boss trigger of the current stage's last block
			for id in Game.levels_for_stage(int(game.s.stage)):
				var l: Level = Game.levels_for_stage(int(game.s.stage))[id]
				if l.meta.get("boss", "") != "":
					game.load_block(id)
					for m in l.marks:
						if m.c == "Z":
							game.s.p.x = float(m.x) - 24.0
							game.s.p.y = float(m.y)
					game._snap_camera()
		"at":
			game.s.p.x = float(p[1])
			game.s.p.y = float(p[2])
			game._snap_camera()
		"killboss":
			# shortcut to the end of a fight: the rules then run the death sequence
			var bb: Variant = game.find(int(game.s.boss.id))
			if bb != null:
				Actors.on_hit(game, bb, 999, game.s.p.x)
		"toorb":
			for e in game.s.ents:
				if e.t == "item" and e.kind == "orb":
					game.s.p.x = e.x
					game.s.p.y = e.y
		"hurt":
			game.hurt_player(int(p[1]), game.s.p.x + 10)
		"give":
			var k: String = p[1]
			if k == "whip":
				game.s.p.whip = 3
			elif k == "hearts":
				game.s.p.hearts = 99
			else:
				game.s.p.sub = k
		"set":
			opts[p[1]] = str_to_var(p[2])
			_apply_options()
		"dump":
			print("DUMP ", _state_line())
		"assets":
			# load every piece of art and audio the game can ask for (run it on the export)
			var miss := []
			var n := 0
			for sname in Assets.json("res://content/art/sheets.json"):
				n += 1
				if Assets.sheet(String(sname)).is_empty(): miss.append(String(sname))
			var areas: Dictionary = Assets.json("res://content/art/areas.json")
			for ar in areas:
				n += 1
				if Assets.texture("res://content/art/tiles_%s.png" % ar) == null: miss.append("tiles_" + ar)
				for L in areas[ar].get("layers", []):
					n += 1
					if Assets.texture("res://content/art/%s.png" % String(L.file)) == null: miss.append(String(L.file))
			for img in ["title", "ending_0", "ending_1", "ending_2", "fog", "font", "font_big"]:
				n += 1
				if Assets.texture("res://content/art/%s.png" % img) == null: miss.append(img)
			var tracks: Dictionary = Assets.json("res://content/audio/music/music.json")
			for tr in tracks:
				for v in ["16", "8"]:
					n += 1
					if GameAudio.load_wav("res://content/audio/music/%s_%s.wav" % [tr, v], true) == null: miss.append("%s_%s" % [tr, v])
			var d := DirAccess.open("res://content/audio/sfx")
			if d != null:
				for f in d.get_files():
					if f.ends_with(".wav"):
						n += 1
						if GameAudio.load_wav("res://content/audio/sfx/" + f, false) == null: miss.append(f)
			for st in range(1, Game.STAGES + 1):
				n += 1
				if Game.levels_for_stage(st).is_empty(): miss.append("stage%d" % st)
			print("ASSETS %d loaded, missing: %s" % [n - miss.size(), miss])
		"menu":
			var labels := []
			for it in menu.get("items", []):
				labels.append(String(it.label))
			print("MENU ", menu.get("id", "-"), " sel=", menu.get("sel", -1), " ", ",".join(labels))
		"ents":
			for e in game.s.ents:
				if String(e.t) != "sp" and String(e.t) != "zone":
					print("ENT %s x=%d y=%d st=%s hidden=%s cam=%d" % [e.t, int(e.x), int(e.y), e.get("st", ""), e.get("hidden", false), int(game.s.cam.x)])
		"shot":
			shot_path = cmd.substr(5)   # the path may contain a drive colon
			_wait = 2
		"quit":
			_cmds.clear()
		_:
			print("HARNESS unknown command: ", cmd)


func _act(a: String, on: bool) -> void:
	var e := InputEventAction.new()
	e.action = a
	e.pressed = on
	e.strength = 1.0 if on else 0.0
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _key(code: Key, on: bool) -> void:
	var e := InputEventKey.new()
	e.keycode = code
	e.physical_keycode = code
	e.pressed = on
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _pad(b: int, on: bool) -> void:
	var e := InputEventJoypadButton.new()
	e.device = 0
	e.button_index = b
	e.pressed = on
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func _state_line() -> String:
	var s: Dictionary = game.s
	var p: Dictionary = s.p
	return "screen=%s mode=%s block=%s x=%d y=%d st=%s hp=%d hearts=%d whip=%d sub=%s lives=%d score=%d hist=%d boss=%d music=%s" % [
		screen, s.mode, s.block, int(p.x), int(p.y), p.st, int(p.hp), int(p.hearts), int(p.whip),
		p.sub if p.sub != "" else "-", int(s.lives), int(s.score), history.size(), int(s.boss.hp), audio.current()]
