## Vale of Shards: the application. It owns the core game (scripts/core/game.gd), steps it
## at the source's fixed rate, and draws it (world.gd and ui.gd). It also handles menus,
## saves, options, high scores, the attract-mode demo, and a scripted test harness
## (--script=...).
extends Node2D

const Game = preload("res://scripts/core/game.gd")
const D = preload("res://scripts/core/defs.gd")
const Assets = preload("res://scripts/view/assets.gd")
const World = preload("res://scripts/view/world.gd")
const UI = preload("res://scripts/view/ui.gd")
const Audio = preload("res://scripts/view/audio.gd")
const Controls = preload("res://scripts/view/controls.gd")
const Demo = preload("res://scripts/core/demo.gd")

const SAVE_DIR := "user://saves"
const SLOTS := 7

var A: Assets
var world: World
var ui: UI
var audio: Audio
var ctl: Controls
var manifest := {}

var g: Game = null
var mode := "title"
var cur := 0                 # menu cursor
var sub := ""                # sub-mode (slots: "save"/"load"; pages)
var back_to := "title"
var acc := 0.0
var options := {"relaxed": false, "music": 0.8, "sfx": 0.9, "fullscreen": false}
var latch := {"jump": false, "fire": false}
var swallow := {}             # buttons that closed a window: ignored by the game until released
var idle := 0.0
var shop_msg := ""
var modal_t := 0.0
var scores: Array = []
var name_entry := {}
var demo := {}
var page_list: Array = []
var page := 0
var frames := 0
var repeat_t := 0.0
var ending := {}              # the ending: {"phase": "white"|"pages"|"credits"|"end", "t": seconds, ...}

# harness
var script_cmds: Array = []
var shot := ""
var shot_frame := 0
var harness := false
var replay := {}
var wait_frames := 0


func _ready() -> void:
	A = Assets.new()
	manifest = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/manifest.json")) if FileAccess.file_exists("res://content/data/manifest.json") else {}
	ctl = Controls.new()
	add_child(ctl)
	audio = Audio.new()
	add_child(audio)
	audio.setup(A)
	world = World.new()
	add_child(world)
	world.setup(A, manifest)
	ui = UI.new()
	add_child(ui)
	ui.setup(A)
	ui.main = self
	load_options()
	load_scores()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
		elif a.begins_with("--frames="):
			shot_frame = int(a.substr(9))
		elif a.begins_with("--script="):
			script_cmds = Array(a.substr(9).split(","))
			harness = true
	to_title()


# ------------------------------------------------------------------ modes
func to_title() -> void:
	mode = "title"
	cur = 0
	idle = 0.0
	g = null
	world.g = null
	audio.music("title")


func title_items() -> Array:
	return ["New Game", "Continue", "Load Game", "The Story", "How to Play", "Controls", "High Scores", "Options", "Quit"]


func start_new() -> void:
	g = Game.new()
	g.new_game()
	world.g = g
	g.textwin("story")
	mode = "play"
	acc = 0.0


func start_stage(level: String, god: bool = false) -> void:
	# tests and demos: begin directly in a stage, as the route checker does
	g = Game.new()
	g.god = god
	g.load_level(level)
	g.pl["level"] = g.level.get("stage", 0)
	g.init_inv()
	g.stats(1)
	g.p_reenter(false)
	g.modal = {}
	world.g = g
	mode = "play"
	acc = 0.0


# ------------------------------------------------------------------ frame loop
func _process(delta: float) -> void:
	frames += 1
	if harness:
		delta = 1.0 / 60.0
		run_harness()
	handle_menu_input(delta)
	if mode == "play" or mode == "attract":
		run_steps(delta)
	if mode == "title":
		idle += delta
		if idle > 22.0 and not harness:
			start_attract()
	if mode == "ending":
		run_ending(delta)
	world.alpha = clampf(acc * step_hz(), 0.0, 1.0)
	world.visible = g != null and not (mode == "ending" and ending["phase"] != "white")
	world.queue_redraw()
	ui.queue_redraw()
	if shot != "" and script_cmds.is_empty() and wait_frames <= 0 and frames >= maxi(shot_frame, 10):
		get_viewport().get_texture().get_image().save_png(shot)
		print("SHOT ", shot)
		shot = ""
		get_tree().quit()


func step_hz() -> float:
	return Game.STEP_HZ / 2.0 if options["relaxed"] else Game.STEP_HZ


func run_steps(delta: float) -> void:
	if not g.modal.is_empty():
		latch = {"jump": false, "fire": false}
		modal_input(delta)
		drain_events()
		return
	if not replay.is_empty() and replay.get("paused", false):
		# a talk replay resumes once the buttons that paged the dialog are up again
		if Input.is_action_pressed("jump") or Input.is_action_pressed("fire") or Input.is_action_pressed("accept"):
			return
		replay["paused"] = false
	for a in swallow.keys():
		if not Input.is_action_pressed(a):
			swallow.erase(a)
	if Input.is_action_just_pressed("jump") and not swallow.has("jump"):
		latch["jump"] = true
	if Input.is_action_just_pressed("fire") and not swallow.has("fire"):
		latch["fire"] = true
	acc += delta
	var dt := 1.0 / step_hz()
	var n := 0
	while acc >= dt and n < 4:
		acc -= dt
		n += 1
		var inp := Controls.held()
		if mode == "attract":
			inp = demo_input()
			if mode != "attract":
				return
		elif not replay.is_empty():
			if replay["done"]:
				return
			inp = replay_input()
			if replay["done"]:
				return
		if swallow.has("jump"):
			inp["fire2"] = false
		if swallow.has("fire"):
			inp["fire1"] = false
		if latch["jump"]:
			inp["fire2"] = true
		if latch["fire"]:
			inp["fire1"] = true
		latch = {"jump": false, "fire": false}
		g.step(inp)
		if not replay.is_empty() and replay.get("talk", false) and g.modal.get("type", "") == "dialog":
			release_all()                # the script pages the dialog; nothing stays held
			replay["held"] = {}
			replay["paused"] = true
		elif mode == "attract" or not replay.is_empty():
			while not g.modal.is_empty():
				g.close_modal()
		drain_events()
		if not g.modal.is_empty():
			modal_t = 0.0
			break
	if acc > dt:
		acc = dt
	if not replay.is_empty() and not replay["done"] and (g.gameover == 2 or g.newlevel.begins_with("!")):
		replay["done"] = true           # a replayed stage ended (the exit, or the heart crystal)
		replay["ok"] = true
		return
	if g.gameover == 2 and mode == "play":
		finish_game()
	elif g.gameover == 1 and mode == "play":
		quit_to_title()


func drain_events() -> void:
	for e in g.events:
		match e["t"]:
			"snd":
				if mode != "attract":
					audio.play(e["n"], e["p"])
			"music":
				if e["n"] != "":
					audio.music(e["n"])
			"cut":
				g.pvpox = g.vpox
				g.pvpoy = g.vpoy
				for o in g.objs:
					o.px = o.x
					o.py = o.y
			"autosave":
				if mode == "play" and not harness:
					write_slot("continue", "Continue")
	g.events.clear()


func modal_input(delta: float) -> void:
	modal_t += delta
	var m: Dictionary = g.modal
	var pressed_any := Input.is_action_just_pressed("accept") or Input.is_action_just_pressed("jump") or Input.is_action_just_pressed("fire")
	if m.get("type", "") == "intro":
		if modal_t > 4.0 or (modal_t > 1.2 and pressed_any):
			g.close_modal()
			_swallow_held()
		return
	if modal_t > 0.25 and pressed_any:
		g.close_modal()
		audio.play("select", 3)
		modal_t = 0.0
		if g.modal.is_empty():
			_swallow_held()


## The button that closes a window must not also jump or fire in the game (a player found
## Orrin jumping as each dialog closed), so it is ignored until released.
func _swallow_held() -> void:
	for a in ["jump", "fire"]:
		if Input.is_action_pressed(a):
			swallow[a] = true


# ------------------------------------------------------------------ menus
func pressed(a: String) -> bool:
	return Input.is_action_just_pressed(a)


func nav(n: int, delta: float) -> int:
	# up/down with key repeat for held sticks
	var dir := int(Input.is_action_pressed("down")) - int(Input.is_action_pressed("up"))
	if pressed("up") or pressed("down"):
		repeat_t = 0.35
		audio.play("menu", 1)
		return posmod(cur + dir, n)
	if dir != 0:
		repeat_t -= delta
		if repeat_t <= 0:
			repeat_t = 0.12
			audio.play("menu", 1)
			return posmod(cur + dir, n)
	return cur


func handle_menu_input(delta: float) -> void:
	match mode:
		"title":
			if Input.is_anything_pressed():
				idle = 0.0
			cur = nav(title_items().size(), delta)
			if pressed("accept"):
				audio.play("select", 3)
				title_choose(title_items()[cur])
		"attract":
			if Input.is_anything_pressed() and demo.get("t", 0.0) > 0.5:
				to_title()
			demo["t"] = demo.get("t", 0.0) + delta
		"play":
			if not g.modal.is_empty():
				return
			if pressed("menu"):
				audio.play("pause", 4)
				mode = "pause"
				cur = 0
			elif pressed("items"):
				audio.play("menu", 4)
				mode = "items"
			elif pressed("shop"):
				if g.can_shop():
					audio.play("menu", 4)
					mode = "shop"
					cur = 0
					shop_msg = ""
				else:
					g.txt(g.tr_text("shop_map"), 5)
			elif pressed("help"):
				g.textwin("help")
		"pause":
			var items := pause_items()
			cur = nav(items.size(), delta)
			if pressed("back") or pressed("menu"):
				mode = "play"
			elif pressed("accept"):
				audio.play("select", 3)
				pause_choose(items[cur])
		"items":
			if pressed("accept") or pressed("back") or pressed("items") or pressed("menu"):
				mode = "play"
		"shop":
			cur = nav(Game.SHOP.size() + 1, delta)
			if pressed("back") or pressed("shop") or pressed("menu"):
				mode = "play"
			elif pressed("accept"):
				if cur == Game.SHOP.size():
					mode = "play"
				else:
					var why := g.buy(Game.SHOP[cur][0])
					shop_msg = "" if why == "" else g.tr_text("shop_" + why)
					if why != "":
						audio.play("error", 3)
					drain_events()
		"slots":
			cur = nav(SLOTS, delta)
			if pressed("back") or pressed("menu"):
				mode = back_to
				cur = 0
			elif pressed("accept"):
				slot_choose(cur)
		"options":
			cur = nav(5, delta)
			var lr := int(pressed("right")) - int(pressed("left"))
			if pressed("back") or pressed("menu"):
				save_options()
				mode = back_to
				cur = 0
			elif pressed("accept") or lr != 0:
				option_change(cur, lr if lr != 0 else 1)
		"pages":
			if pressed("accept") or pressed("jump") or pressed("fire") or pressed("right"):
				page += 1
				audio.play("menu", 2)
				if page >= page_list.size():
					mode = back_to
					cur = 0
			elif pressed("back") or pressed("menu"):
				mode = back_to
				cur = 0
			elif pressed("left") and page > 0:
				page -= 1
		"scores":
			if pressed("accept") or pressed("back") or pressed("menu"):
				mode = back_to
				cur = 0
		"name":
			name_input()


func title_choose(item: String) -> void:
	match item:
		"New Game":
			start_new()
		"Continue":
			if not load_slot("continue"):
				audio.play("error", 3)
		"Load Game":
			open_slots("load", "title")
		"The Story":
			show_pages("story", "title")
		"How to Play":
			show_pages("help", "title")
		"Controls":
			show_controls("title")
		"High Scores":
			back_to = "title"
			mode = "scores"
		"Options":
			back_to = "title"
			mode = "options"
			cur = 0
		"Quit":
			get_tree().quit()


func pause_items() -> Array:
	return ["Resume", "Items", "Tolly's Pack", "Save Game", "Load Game", "Options", "How to Play", "Controls", "Quit to Title"]


func pause_choose(item: String) -> void:
	match item:
		"Resume":
			mode = "play"
		"Items":
			mode = "items"
		"Tolly's Pack":
			if g.can_shop():
				mode = "shop"
				cur = 0
				shop_msg = ""
			else:
				mode = "play"
				g.txt(g.tr_text("shop_map"), 5)
		"Save Game":
			if g.level.get("overworld", false):
				open_slots("save", "pause")
			else:
				mode = "play"
				g.txt(g.tr_text("save_where"), 5)
		"Load Game":
			open_slots("load", "pause")
		"Options":
			back_to = "pause"
			mode = "options"
			cur = 0
		"How to Play":
			show_pages("help", "pause")
		"Controls":
			show_controls("pause")
		"Quit to Title":
			quit_to_title()


func show_pages(key: String, ret: String) -> void:
	var t = g.text.get(key) if g != null else null
	if t == null:
		t = Game.new().text.get(key)
	page_list = t if t is Array else [t]
	page = 0
	back_to = ret
	mode = "pages"


func show_controls(ret: String) -> void:
	page_list = [{"title": "Controls", "who": "", "lines": [
		"               KEYBOARD          GAMEPAD",
		"Move / climb   arrows, WASD      D-pad, left stick",
		"Jump           Z  Alt  Ctrl  K   A (south)",
		"Fire           X  Shift Space J  X or B",
		"Items          I  Enter          Y (north)",
		"Tolly's pack   B                 Back / Select",
		"Menu           Esc  P            Start",
		"Menus: confirm Enter/Z or A, back Esc or B"]}]
	page = 0
	back_to = ret
	mode = "pages"


func option_change(i: int, d: int) -> void:
	match i:
		0:
			options["relaxed"] = not options["relaxed"]
		1:
			options["music"] = clampf(snappedf(options["music"] + 0.1 * d, 0.1), 0.0, 1.0)
		2:
			options["sfx"] = clampf(snappedf(options["sfx"] + 0.1 * d, 0.1), 0.0, 1.0)
			audio.set_volumes(options["sfx"], options["music"])
			audio.play("shard", 3)
		3:
			options["fullscreen"] = not options["fullscreen"]
		4:
			save_options()
			mode = back_to
			cur = 0
			return
	apply_options()


func apply_options() -> void:
	audio.set_volumes(options["sfx"], options["music"])
	if not harness:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if options["fullscreen"] else DisplayServer.WINDOW_MODE_WINDOWED)


func load_options() -> void:
	var cf := ConfigFile.new()
	if cf.load("user://options.cfg") == OK:
		for k in options:
			options[k] = cf.get_value("options", k, options[k])
	apply_options()


func save_options() -> void:
	var cf := ConfigFile.new()
	for k in options:
		cf.set_value("options", k, options[k])
	cf.save("user://options.cfg")


# ------------------------------------------------------------------ saves
func open_slots(kind: String, ret: String) -> void:
	sub = kind
	back_to = ret
	mode = "slots"
	cur = 0


func slot_label(i) -> String:
	var path := "%s/slot_%s.save" % [SAVE_DIR, str(i)]
	if not FileAccess.file_exists(path):
		return "- empty -"
	var d = str_to_var(FileAccess.get_file_as_string(path))
	return d.get("label", "?") if d is Dictionary else "?"


func slot_choose(i: int) -> void:
	if sub == "save":
		var done: int = g.done_stages.size()
		write_slot(str(i), "%d of 6 stages  %d pts" % [done, g.pl["score"]])
		audio.play("token", 4)
		mode = "play"
		g.txt("Game saved.", 3)
	else:
		if load_slot(str(i)):
			audio.play("level", 4)
		else:
			audio.play("error", 3)


func write_slot(name: String, label: String) -> void:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	var f := FileAccess.open("%s/slot_%s.save" % [SAVE_DIR, name], FileAccess.WRITE)
	if f:
		f.store_string(var_to_str({"label": label + "  " + Time.get_datetime_string_from_system().substr(5, 11).replace("T", " "),
			"state": g.save_state()}))


func load_slot(name: String) -> bool:
	var path := "%s/slot_%s.save" % [SAVE_DIR, name]
	if not FileAccess.file_exists(path):
		return false
	var d = str_to_var(FileAccess.get_file_as_string(path))
	if not (d is Dictionary and d.has("state")):
		return false
	g = Game.new()
	g.load_state(d["state"])
	world.g = g
	mode = "play"
	acc = 0.0
	drain_events()
	return true


# ------------------------------------------------------------------ ending and scores
## The ending, after the heart crystal's blast: the Spire fades to white, the Vale comes up at
## dawn, the ending pages play over it, then the credits roll. Only then does the game go on
## to the high-score entry (if the score qualifies) and the title. Each page and the credits
## ignore buttons for a moment, so a player still firing at the crystal does not skip them.
const ENDING_WHITE := 1.6           # seconds of fade to white
const ENDING_GUARD := 0.8           # seconds a page ignores buttons
const CREDITS_SPEED := 16.0         # pixels per second; a held button runs them 4x faster
const CREDITS_ROW := 12

func finish_game() -> void:
	audio.music("ending")
	ending = {"phase": "white", "t": 0.0, "page": 0, "scroll": 0.0,
		"pages": g.text.get("ending", []), "credits": g.text.get("credits", [])}
	mode = "ending"
	g.gameover = 3


func run_ending(delta: float) -> void:
	ending["t"] += delta
	var t: float = ending["t"]
	var go := t > ENDING_GUARD and (pressed("accept") or pressed("jump") or pressed("fire"))
	match ending["phase"]:
		"white":
			if t >= ENDING_WHITE:
				_ending_phase("pages" if not ending["pages"].is_empty() else "credits")
		"pages":
			if go:
				audio.play("menu", 2)
				ending["page"] += 1
				ending["t"] = 0.0
				if ending["page"] >= ending["pages"].size():
					_ending_phase("credits")
		"credits":
			var fast := Input.is_action_pressed("accept") or Input.is_action_pressed("jump") or Input.is_action_pressed("fire")
			ending["scroll"] += delta * CREDITS_SPEED * (4.0 if fast and t > ENDING_GUARD else 1.0)
			if ending["scroll"] >= credits_end():
				ending["scroll"] = credits_end()
				_ending_phase("end")
		"end":
			if go:
				end_game()


func _ending_phase(ph: String) -> void:
	ending["phase"] = ph
	ending["t"] = 0.0


## The scroll at which the last credits line ("THE END") sits in the middle of the screen.
func credits_end() -> float:
	return 180.0 + (ending["credits"].size() - 1) * CREDITS_ROW - 86.0


func end_game() -> void:
	ending = {}
	if qualifies(g.pl["score"]):
		begin_name()
	else:
		back_to = "title"
		mode = "scores"
		g = null
		world.g = null
		audio.music("title")


func quit_to_title() -> void:
	if g != null and qualifies(g.pl["score"]):
		begin_name()
	else:
		to_title()


func qualifies(score: int) -> bool:
	return score > 0 and (scores.size() < 10 or score > scores[-1]["score"])


func begin_name() -> void:
	name_entry = {"chars": "        ".split(""), "pos": 0, "score": g.pl["score"]}
	name_entry["chars"] = ["A", " ", " ", " ", " ", " ", " ", " "]
	mode = "name"


const LETTERS := " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"

func name_input() -> void:
	var ch: Array = name_entry["chars"]
	var p: int = name_entry["pos"]
	var li := LETTERS.find(ch[p])
	if pressed("up"):
		ch[p] = LETTERS[posmod(li + 1, LETTERS.length())]
	elif pressed("down"):
		ch[p] = LETTERS[posmod(li - 1, LETTERS.length())]
	elif pressed("right") or pressed("jump"):
		name_entry["pos"] = mini(p + 1, 7)
	elif pressed("left") or pressed("back"):
		name_entry["pos"] = maxi(p - 1, 0)
	elif pressed("accept") or pressed("menu"):
		var nm := "".join(ch).strip_edges()
		scores.append({"name": nm if nm != "" else "ORRIN", "score": name_entry["score"]})
		scores.sort_custom(func(a, b): return a["score"] > b["score"])
		scores = scores.slice(0, 10)
		save_scores()
		back_to = "title"
		mode = "scores"
		g = null
		world.g = null


func _unhandled_input(e: InputEvent) -> void:
	ctl.note_event(e)
	if mode == "name" and e is InputEventKey and e.pressed and not e.echo:
		var c := char(e.unicode).to_upper() if e.unicode > 0 else ""
		if c != "" and LETTERS.find(c) > 0:
			name_entry["chars"][name_entry["pos"]] = c
			name_entry["pos"] = mini(name_entry["pos"] + 1, 7)


func load_scores() -> void:
	if FileAccess.file_exists("user://scores.json"):
		var s = JSON.parse_string(FileAccess.get_file_as_string("user://scores.json"))
		if s is Array:
			scores = s


func save_scores() -> void:
	var f := FileAccess.open("user://scores.json", FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(scores))


# ------------------------------------------------------------------ attract mode (the source's demo)
func start_attract() -> void:
	var names: Array = []
	var d := DirAccess.open("res://content/routes")
	if d == null:
		idle = 0.0
		return
	for f in d.get_files():
		if f.ends_with(".json"):
			names.append(f.get_basename())
	if names.is_empty():
		idle = 0.0
		return
	names.sort()
	var pick: String = names[demo.get("n", 0) % names.size()]
	var r = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % pick))
	start_stage(pick, true)
	for i in 41:
		g.step({})
	drain_events()
	demo = {"n": demo.get("n", 0) + 1, "inputs": r["inputs"], "i": 0, "t": 0.0}
	mode = "attract"
	audio.music(g.level.get("music", ""))


func demo_input() -> Dictionary:
	var i: int = demo["i"]
	demo["i"] = i + 1
	if i >= demo["inputs"].size() or g.newlevel != "":
		to_title()
		return {}
	return Demo.INPUTS[int(demo["inputs"][i])]


# ------------------------------------------------------------------ drawing (called by ui.gd)
func draw_ui(u: UI) -> void:
	if mode == "ending":
		draw_ending(u)
		return
	match mode:
		"title", "slots", "options", "pages", "scores", "name":
			if g == null or mode == "title" or back_to == "title":
				draw_title(u)
	if g != null and mode in ["play", "pause", "items", "shop", "attract", "slots", "options", "pages"] and not (back_to == "title" and mode in ["slots", "options", "pages"]):
		u.hud(g, 148)
		if not g.level.get("overworld", false) or g.bottime > 0:
			u.message(g, g.level.get("name", ""))
		elif g.level.get("overworld", false):
			u.message(g, "The Vale")
		if not g.modal.is_empty() and mode == "play":
			draw_modal(u)
	match mode:
		"title":
			u.menu("", title_items(), cur, 74, 120, [], 10)
		"attract":
			u.center(160, 136, "DEMO  -  press any button", ui.GOLD if (frames / 30) % 2 == 0 else ui.DIM)
		"pause":
			u.menu("Paused", pause_items(), cur, 22, 160)
		"items":
			draw_items(u)
		"shop":
			draw_shop(u)
		"slots":
			var labels: Array = []
			for i in SLOTS:
				labels.append("%d  %s" % [i + 1, slot_label(i)])
			u.menu("Save Game" if sub == "save" else "Load Game", labels, cur, 30, 250)
		"options":
			u.menu("Options", ["Relaxed speed", "Music volume", "Sound volume", "Fullscreen", "Done"], cur, 40, 200,
				["on" if options["relaxed"] else "off", str(int(round(options["music"] * 10))),
				str(int(round(options["sfx"] * 10))), "on" if options["fullscreen"] else "off", ""])
		"pages":
			if page < page_list.size():
				var p: Dictionary = page_list[page]
				u.text_window(p.get("title", ""), p.get("lines", []), p.get("who", ""), ">")
		"scores":
			var lines: Array = []
			for s in scores:
				lines.append("%-10s %8d" % [s["name"], s["score"]])
			if lines.is_empty():
				lines = ["No scores yet."]
			u.text_window("High Scores", lines, "", "")
		"name":
			var s := "".join(name_entry["chars"])
			u.text_window("A new high score!", ["Score  %d" % name_entry["score"], "", "Name:  " + s,
				"       " + " ".repeat(name_entry["pos"]) + "^", "", "UP/DOWN letter, LEFT/RIGHT move,", "confirm to finish"], "orrin", "")


func draw_ending(u: UI) -> void:
	var t: float = ending["t"]
	var white := Color(1.0, 0.97, 0.9)
	match ending["phase"]:
		"white":
			u.draw_rect(Rect2(0, 0, 320, 180), Color(white, clampf(t / ENDING_WHITE, 0.0, 1.0)))
		"pages":
			A.draw_frame(u, "dawn", 0, Vector2.ZERO)
			if ending["page"] == 0:
				u.draw_rect(Rect2(0, 0, 320, 180), Color(white, clampf(1.0 - t / 1.2, 0.0, 1.0)))
			var p: Dictionary = ending["pages"][ending["page"]]
			u.text_window(p.get("title", ""), p.get("lines", []), p.get("who", ""), ">" if t > ENDING_GUARD else "")
		"credits", "end":
			A.draw_frame(u, "dawn", 0, Vector2.ZERO)
			u.draw_rect(Rect2(0, 0, 320, 180), Color(u.INK, 0.55))
			var lines: Array = ending["credits"]
			for i in lines.size():
				var y: float = 180.0 + i * CREDITS_ROW - ending["scroll"]
				if y < -10 or y > 180:
					continue
				var s: String = lines[i]
				if s.begins_with("# "):
					u.center(160, y, s.substr(2), u.GOLD)
				else:
					u.center(160, y, s, u.WHITE)
			if ending["phase"] == "end" and t > ENDING_GUARD and int(t * 2) % 2 == 0:
				u.center(160, 164, "press a button", u.DIM)


func draw_title(u: UI) -> void:
	A.draw_frame(u, "title", 0, Vector2.ZERO)
	A.draw_frame(u, "logo", 0, Vector2(32, 4))


func draw_modal(u: UI) -> void:
	var m: Dictionary = g.modal
	match m.get("type", ""):
		"intro":
			u.text_window(m.get("title", ""), m.get("lines", []), "", "")
		"text":
			u.text_window(m.get("title", ""), m.get("lines", []), m.get("who", ""), ctl.label("accept"))
		"dialog":
			var p: Dictionary = m["pages"][m["page"]]
			u.text_window(p.get("title", ""), p.get("lines", []), p.get("who", ""), ctl.label("accept"), true)


func draw_items(u: UI) -> void:
	var r := Rect2(40, 20, 240, 118)
	u.panel(r)
	u.center(160, 28, "Orrin's Satchel", ui.GOLD)
	var rows := [
		["bolt", "Lamp bolts at once", g.invcount(D.INV_BOLT)],
		["embers", "Ember charges", g.invcount(D.INV_EMBER)],
		["stones", "Throwing stones", g.invcount(D.INV_STONES)],
		["gatekey", "Gate keys", g.invcount(D.INV_GATEKEY)],
		["boots", "Spring boots", g.invcount(D.INV_BOOTS)],
		["ward", "Ward of light", g.invcount(D.INV_WARD)]]
	for i in rows.size():
		var y := 42 + i * 12
		A.draw_frame(u, "icon", A.frame("icon", rows[i][0]), Vector2(52, y - 2))
		u.text(Vector2(68, y), str(rows[i][2]), ui.GOLD)
		u.text(Vector2(84, y), rows[i][1], ui.WHITE)
	u.text(Vector2(186, 42), "Sigils", ui.GOLD)
	for k in 3:
		var have: bool = g.invcount(D.INV_SIGIL1 + k) > 0
		A.draw_frame(u, "sigil", k, Vector2(186 + k * 28, 52), false, Color.WHITE if have else Color(0.2, 0.2, 0.25, 0.8))
	u.text(Vector2(186, 84), "Runes %d/4" % mini(g.invcount(D.INV_RUNE), 4), ui.WHITE)
	u.text(Vector2(186, 96), "Berries %d/16" % g.fruit, ui.WHITE)
	u.center(160, 124, "Stages done: %d of 6" % g.done_stages.size(), ui.DIM)


func draw_shop(u: UI) -> void:
	var names := {"health": "A heart", "bolt": "Extra lamp bolt", "rapid": "Rapid fire (5 bolts)",
		"ember1": "1 ember charge", "ember5": "5 ember charges", "ward": "Ward of light"}
	var items: Array = []
	var vals: Array = []
	for e in Game.SHOP:
		items.append(names[e[0]])
		vals.append(str(e[1]))
	items.append("Leave")
	vals.append("")
	var r := u.menu("Tolly's Pack  (%d shards)" % g.pl["shards"], items, cur, 26, 230, vals)
	u.portrait(Vector2(r.position.x - 36, r.position.y), "tolly")
	if shop_msg != "":
		var lines: Array = u.F.wrap(shop_msg, 260)
		for i in lines.size():
			u.center(160, r.end.y + 4 + i * 9, lines[i], ui.RED)


# ------------------------------------------------------------------ test harness
## --script=cmd,cmd,...   one command every 6 frames (commands with a count wait longer)
func run_harness() -> void:
	if wait_frames > 0:
		wait_frames -= 1
		return
	if not replay.is_empty():
		if replay["done"]:
			print("REPLAY %s %s steps=%d" % [replay["level"], "ok" if replay["ok"] else "FAIL", replay["i"]])
			release_all()
			replay = {}
			if script_cmds.is_empty() and shot == "":
				get_tree().quit()
			return
		if not (replay.get("talk", false) and g != null and (not g.modal.is_empty() or replay.get("paused", false))):
			return
		# a "talk" replay waits on an open dialog (and then for its buttons to come up): the
		# script's next commands page it and release them
	if script_cmds.is_empty() or frames % 6 != 0:
		return
	var cmd: String = script_cmds.pop_front()
	var a := cmd.split(":")
	match a[0]:
		"newgame":
			start_new()
		"stage":
			start_stage(a[1], a.size() > 2 and a[2] == "god")
			for i in 41:
				g.step({})
			drain_events()
		"key", "keyup":
			send_key(a[1], a[0] == "key")
		"pad", "padup":
			send_pad(a[1], a[0] == "pad")
		"axis":
			send_axis(a[1], float(a[2]))
		"tap":
			send_key(a[1], true)
			script_cmds.push_front("keyup:" + a[1])
		"ptap":
			send_pad(a[1], true)
			script_cmds.push_front("padup:" + a[1])
		"wait":
			wait_frames = int(a[1]) if a.size() > 1 else 6
		"replay":
			begin_replay(a[1], a[2] if a.size() > 2 else "kb", a.size() > 3 and a[3] == "talk")
		"waitmodal":
			# wait for the next dialog of a talk replay; give up once the replay has ended
			if g != null and g.modal.is_empty() and not replay.is_empty() and not replay["done"]:
				script_cmds.push_front(cmd)
			elif g == null or g.modal.is_empty():
				print("HARNESS waitmodal: the replay ended without another dialog")
		"dump":
			dump()
		"close":
			if g != null:
				g.modal = {}
		"quit":
			get_tree().quit()
		"assets":
			check_assets()
		_:
			print("HARNESS unknown command: ", cmd)


## Every sprite in the manifest and every music track must load (the export check runs this
## inside the exported build, so a file left out of the pack is caught).
func check_assets() -> void:
	var missing: Array = []
	var n := 0
	for name in manifest.get("sprites", {}):
		n += 1
		if A.sprite(name) == null:
			missing.append("sprites/" + name)
	for t in ["title", "map", "hollow", "mines", "aqueduct", "canopy", "foundry", "spire", "clear", "ending"]:
		n += 1
		if A.sound("music/" + t) == null:
			missing.append("music/" + t)
	if missing.is_empty():
		print("ASSETS ok %d" % n)
	else:
		print("ASSETS missing ", ", ".join(missing))


func dump() -> void:
	if mode == "ending":
		print("DUMP mode=ending phase=%s page=%d" % [ending["phase"], ending["page"]])
		return
	if g == null:
		print("DUMP mode=%s" % mode)
		return
	var p = g.player()
	var md: String = g.modal.get("type", "none")
	if md == "dialog":
		md += ":" + str(g.modal["pages"][g.modal["page"]].get("who", ""))
	print("DUMP mode=%s level=%s pos=%d,%d state=%d kind=%d health=%d shards=%d score=%d modal=%s inv=%s" % [mode, g.curlevel,
		p.x, p.y, p.state, p.kind, g.pl["health"], g.pl["shards"], g.pl["score"], md, str(g.pl["inv"])])


const KEYMAP := {"left": KEY_LEFT, "right": KEY_RIGHT, "up": KEY_UP, "down": KEY_DOWN, "z": KEY_Z, "x": KEY_X,
	"enter": KEY_ENTER, "esc": KEY_ESCAPE, "i": KEY_I, "b": KEY_B, "space": KEY_SPACE, "p": KEY_P}
const PADMAP := {"a": JOY_BUTTON_A, "b": JOY_BUTTON_B, "x": JOY_BUTTON_X, "y": JOY_BUTTON_Y, "start": JOY_BUTTON_START,
	"back": JOY_BUTTON_BACK, "up": JOY_BUTTON_DPAD_UP, "down": JOY_BUTTON_DPAD_DOWN, "left": JOY_BUTTON_DPAD_LEFT,
	"right": JOY_BUTTON_DPAD_RIGHT}


func send_key(name: String, down: bool) -> void:
	var e := InputEventKey.new()
	e.physical_keycode = KEYMAP[name]
	e.keycode = KEYMAP[name]
	e.pressed = down
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func send_pad(name: String, down: bool) -> void:
	var e := InputEventJoypadButton.new()
	e.device = 0
	e.button_index = PADMAP[name]
	e.pressed = down
	e.pressure = 1.0 if down else 0.0
	Input.parse_input_event(e)
	Input.flush_buffered_events()


func send_axis(name: String, v: float) -> void:
	var e := InputEventJoypadMotion.new()
	e.device = 0
	e.axis = JOY_AXIS_LEFT_X if name == "lx" else JOY_AXIS_LEFT_Y
	e.axis_value = v
	Input.parse_input_event(e)
	Input.flush_buffered_events()


## Plays a route file through synthesized device events, so the whole path from device to
## InputMap to Controls.held() to the core is exercised. "kb" uses arrow keys, Z and X; "pad"
## uses the left stick for left/right, the D-pad for up/down, A to jump and X to fire.
func begin_replay(level: String, device: String, talk: bool = false) -> void:
	var r = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % level))
	start_stage(level, true)
	for i in 41:
		g.step({})
	drain_events()
	replay = {"level": level, "device": device, "inputs": r["inputs"], "i": 0, "done": false, "ok": false, "held": {},
		"talk": talk}


func replay_input() -> Dictionary:
	var i: int = replay["i"]
	if i >= replay["inputs"].size() or g.newlevel != "":
		replay["done"] = true
		replay["ok"] = g.newlevel.begins_with("!") or g.gameover == 2
		return {}
	replay["i"] = i + 1
	var want: Dictionary = Demo.INPUTS[int(replay["inputs"][i])]
	var dx: int = want.get("dx", 0)
	var dy: int = want.get("dy", 0)
	var j: bool = want.get("fire2", false)
	var f: bool = want.get("fire1", false)
	if replay["device"] == "kb":
		set_held("right", dx > 0, func(d): send_key("right", d))
		set_held("left", dx < 0, func(d): send_key("left", d))
		set_held("down", dy > 0, func(d): send_key("down", d))
		set_held("up", dy < 0, func(d): send_key("up", d))
		set_held("z", j, func(d): send_key("z", d))
		set_held("x", f, func(d): send_key("x", d))
	else:
		if replay["held"].get("lx", 0) != dx:
			replay["held"]["lx"] = dx
			send_axis("lx", float(dx))
		set_held("pdown", dy > 0, func(d): send_pad("down", d))
		set_held("pup", dy < 0, func(d): send_pad("up", d))
		set_held("pa", j, func(d): send_pad("a", d))
		set_held("px", f, func(d): send_pad("x", d))
	return Controls.held()


func set_held(k: String, down: bool, send: Callable) -> void:
	if replay["held"].get(k, false) != down:
		replay["held"][k] = down
		send.call(down)


func release_all() -> void:
	for k in KEYMAP:
		send_key(k, false)
	for k in PADMAP:
		send_pad(k, false)
	send_axis("lx", 0.0)
