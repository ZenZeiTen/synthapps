## Tidebell: the application. It owns the core (scripts/core/game.gd), steps it at 60 Hz,
## draws it (world.gd, ui.gd), and runs the screens: title, opening, the Lantern-house hub,
## map, hero choice, pause and items, talks, game over, the ending and credits, tide-code
## entry and options. It also runs a scripted test harness (--script=...; see CLAUDE.md).
extends Node2D

const Game = preload("res://scripts/core/game.gd")
const Code = preload("res://scripts/core/code.gd")
const Inputs = preload("res://scripts/core/inputs.gd")
const Assets = preload("res://scripts/view/assets.gd")
const World = preload("res://scripts/view/world.gd")
const UI = preload("res://scripts/view/ui.gd")
const Audio = preload("res://scripts/view/audio.gd")
const Controls = preload("res://scripts/view/controls.gd")

const PAGE_GUARD := 0.4       # story pages ignore buttons this long after they appear
const ALPHA := "BCDFGHJKLMNPRSTW"

var A: Assets
var world: World
var ui: UI
var audio: Audio
var ctl: Controls
var D: Dictionary
var TX: Dictionary

var mode := "title"
var cur := 0
var g = null
var prog: Dictionary = {}
var hero := "kess"
var stage_id := ""
var options := {"difficulty": 1, "layout": 0, "music": 0.7, "sfx": 0.9, "fullscreen": false}
var best := 0
var last_code := ""
var pages: Array = []
var page := 0
var page_t := 0.0
var pages_then := ""
var pressed_in_window := {}
var swallow := {}
var latch := {}
var sel_next := ""
var acc := 0.0
var msg := ""
var msg_t := 0.0
var code_buf := ""
var ending := {}
var repeat_t := 0.0
var frames := 0

# harness
var harness := false
var script_cmds: Array = []
var shot := ""
var shot_frame := 0
var wait_frames := 0
var replay := {}
var fit_queue: Array = []


func _ready() -> void:
	A = Assets.new()
	D = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	TX = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/text.json"))
	ctl = Controls.new()
	add_child(ctl)
	audio = Audio.new()
	add_child(audio)
	audio.setup(A)
	world = World.new()
	add_child(world)
	world.setup(A)
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = UI.new()
	layer.add_child(ui)
	ui.setup(A)
	ui.main = self
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
		elif a.begins_with("--frames="):
			shot_frame = int(a.substr(9))
		elif a.begins_with("--script="):
			script_cmds = Array(a.substr(9).split(","))
			harness = true
	if harness:
		# harness runs keep their own files and start from nothing (CLAUDE.md)
		var d := DirAccess.open("user://")
		if d != null and d.dir_exists("harness"):
			for f in DirAccess.get_files_at("user://harness"):
				DirAccess.remove_absolute("user://harness/" + f)
	load_options()
	to_title()


# ------------------------------------------------------------------ files
func cfg_path() -> String:
	if harness:
		DirAccess.make_dir_recursive_absolute("user://harness")
		return "user://harness/tidebell.cfg"
	return "user://tidebell.cfg"


func load_options() -> void:
	var c := ConfigFile.new()
	if c.load(cfg_path()) == OK:
		for k in options:
			options[k] = c.get_value("options", k, options[k])
		best = int(c.get_value("game", "best", 0))
		last_code = String(c.get_value("game", "code", ""))
	apply_options()


func save_options() -> void:
	var c := ConfigFile.new()
	for k in options:
		c.set_value("options", k, options[k])
	c.set_value("game", "best", best)
	c.set_value("game", "code", last_code)
	c.save(cfg_path())


func apply_options() -> void:
	ctl.set_layout(int(options["layout"]))
	audio.set_volumes(float(options["music"]), float(options["sfx"]))
	if not harness:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if options["fullscreen"]
			else DisplayServer.WINDOW_MODE_WINDOWED)


# ------------------------------------------------------------------ screens
func to_title() -> void:
	mode = "title"
	cur = 0
	g = null
	world.g = null
	audio.music("title")


func title_items() -> Array:
	var it := ["New Game", "Enter Tide-Code"]
	if last_code != "":
		it.append("Continue " + last_code)
	it.append_array(["Options", "Controls", "Quit"])
	return it


func show_pages(list: Array, then: String) -> void:
	pages = list
	page = 0
	page_t = 0.0
	pages_then = then
	pressed_in_window = {}
	mode = "pages"


func new_game() -> void:
	prog = Game.new_progress(D, int(options["difficulty"]))
	hero = "kess"
	show_pages(TX["opening"], "hub")
	audio.music("house")


func to_hub(keep: int = 0) -> void:
	mode = "hub"
	cur = keep
	g = null
	world.g = null
	if int(prog["done"]) < 6:
		last_code = Code.encode(prog)
		save_options()
	audio.music("house")


func hub_items() -> Array:
	var d: int = prog["done"]
	return ["Set Out: " + stage_name(d), "Talk to Pell", "Map of the Saltmarch", "Choose Warden", "Title Screen"]


func stage_name(i: int) -> String:
	var ids: Array = D["stages"]
	if i >= ids.size():
		return "-"
	var text := FileAccess.get_file_as_string("res://content/levels/%s.txt" % ids[i])
	for line in text.split("\n"):
		if line.begins_with("name:"):
			return line.substr(5).strip_edges()
	return ids[i]


func start_stage(id: String) -> void:
	stage_id = id
	g = Game.new(D)
	g.start(id, FileAccess.get_file_as_string("res://content/levels/%s.txt" % id), prog, hero)
	world.g = g
	world.theme = g.head.get("theme", id)
	mode = "play"
	acc = 0.0
	latch = {}
	swallow_held()
	drain_events()


# ------------------------------------------------------------------ frame loop
func _process(delta: float) -> void:
	frames += 1
	if harness:
		delta = 1.0 / 60.0
		run_harness()
	if msg_t > 0:
		msg_t -= delta
	match mode:
		"play":
			run_play(delta)
		"pages", "talk":
			run_pages(delta)
		"ending":
			run_ending(delta)
		_:
			handle_menus(delta)
	if shot != "" and frames == shot_frame:
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()


func _unhandled_input(e: InputEvent) -> void:
	ctl.note_event(e)


func just(a: String) -> bool:
	return Input.is_action_just_pressed(a)


func run_play(delta: float) -> void:
	for a in swallow.keys():
		if not Input.is_action_pressed(a):
			swallow.erase(a)
	for a in ["jump", "attack", "item", "special"]:
		if just(a) and not swallow.has(a):
			latch[a] = true
	if just("pause") and not swallow.has("pause") and replay.is_empty():
		mode = "pause"
		cur = 0
		audio.play("page")
		return
	acc += delta
	var dt := 1.0 / 60.0
	var n := 0
	while acc >= dt - 0.0001 and n < 4:
		acc -= dt
		n += 1
		var inp := Controls.held()
		if not replay.is_empty():
			if replay["done"]:
				return
			inp = replay_input()
			if replay["done"]:
				return
		for a in ["jump", "attack", "item", "special"]:
			if swallow.has(a):
				inp[a] = false
			if latch.get(a, false):
				inp[a] = true
		latch = {}
		if sel_next != "":
			inp["sel"] = sel_next
			sel_next = ""
		g.step(inp)
		drain_events()
		if mode != "play":
			break
	if acc > dt:
		acc = dt


func drain_events() -> void:
	if g == null:
		return
	var evs: Array = g.events.duplicate()
	g.events.clear()
	for e in evs:
		match e["t"]:
			"sfx":
				audio.play(e["id"])
			"music":
				audio.music(e["id"] if e["id"] != "none" else "")
			"talk":
				open_talk(String(e["id"]))
			"bell":
				audio.music("clear")
			"clear":
				stage_cleared()
			"ending":
				pass
			"gameover":
				game_over()


func open_talk(id: String) -> void:
	if not replay.is_empty() and not replay.get("talk", false):
		g.close_talk()          # a plain replay reads no pages
		return
	var list: Array = TX.get(id, [{"who": "", "lines": ["..."]}])
	show_pages(list, "talk")
	mode = "talk"


func stage_cleared() -> void:
	if not replay.is_empty():
		replay["done"] = true
		replay["ok"] = true
		if not replay.get("end", false):
			return
		replay["end_stage"] = true      # an ":end" replay goes on into the real flow
	prog["done"] = int(prog["done"]) + 1
	best = maxi(best, int(prog["score"]))
	if stage_id == "brinecrow":
		start_ending()
	else:
		last_code = Code.encode(prog)
		save_options()
		to_hub()
		msg = "The bell of %s is home." % stage_name(int(prog["done"]) - 1)
		msg_t = 3.0


func game_over() -> void:
	if not replay.is_empty():
		replay["done"] = true
		replay["ok"] = false
		return
	mode = "over"
	cur = 0
	audio.music("over")


## The buttons that were pressed to close a window (and are still held) are ignored by the
## game until released, so they cannot jump or strike on the next screen.
func swallow_held() -> void:
	for a in ["jump", "attack", "item", "special", "pause", "accept"]:
		if Input.is_action_pressed(a) and (pressed_in_window.has(a) or mode != "play"):
			swallow[a] = true
	pressed_in_window = {}


func run_pages(delta: float) -> void:
	page_t += delta
	var any := false
	for a in ["accept", "jump", "attack", "item", "pause"]:
		if just(a):
			pressed_in_window[a] = true
			if page_t > PAGE_GUARD:
				any = true
	if not any:
		return
	audio.play("page")
	page += 1
	page_t = 0.0
	if page < pages.size():
		return
	var then := pages_then
	if then == "talk":
		mode = "play"
		swallow_held()
		g.close_talk()
		drain_events()
	elif then == "hub":
		to_hub(1 if mode == "pages" and not prog.is_empty() and page > 0 and pages != TX["opening"] else 0)
		swallow_held()
	elif then == "title":
		to_title()
	elif then == "ending_pages":
		ending["phase"] = "credits"
		ending["t"] = 0.0
		mode = "ending"


func nav(n: int, delta: float) -> int:
	var dir := int(Input.is_action_pressed("down")) - int(Input.is_action_pressed("up"))
	if just("up") or just("down"):
		repeat_t = 0.35
		audio.play("menu")
		return posmod(cur + dir, n)
	if dir != 0:
		repeat_t -= delta
		if repeat_t <= 0:
			repeat_t = 0.12
			audio.play("menu")
			return posmod(cur + dir, n)
	return cur


func accept() -> bool:
	return just("accept") or just("jump")


func back() -> bool:
	return just("back") or just("item")


func handle_menus(delta: float) -> void:
	match mode:
		"title":
			var it := title_items()
			cur = nav(it.size(), delta)
			if accept():
				audio.play("select")
				var c: String = it[cur]
				if c == "New Game":
					new_game()
				elif c == "Enter Tide-Code":
					mode = "code"
					code_buf = ""
					cur = 0
				elif c.begins_with("Continue"):
					use_code(last_code)
				elif c == "Options":
					mode = "options"
					cur = 0
				elif c == "Controls":
					mode = "help"
				elif c == "Quit":
					get_tree().quit()
		"hub":
			var it := hub_items()
			cur = nav(it.size(), delta)
			if accept():
				audio.play("select")
				match cur:
					0:
						start_stage(D["stages"][int(prog["done"])])
					1:
						var d := int(prog["done"])
						var key: String = "pell_done" if d >= 6 else "pell_" + String(D["stages"][d])
						show_pages(TX[key], "hub")
					2:
						mode = "map"
					3:
						mode = "heroes"
						cur = D["hero_order"].find(hero)
					4:
						to_title()
		"map":
			if accept() or back():
				audio.play("select")
				mode = "hub"
				cur = 2
		"heroes":
			var order: Array = D["hero_order"]
			if just("left") or just("up"):
				cur = posmod(cur - 1, order.size())
				audio.play("menu")
			elif just("right") or just("down"):
				cur = posmod(cur + 1, order.size())
				audio.play("menu")
			if accept():
				hero = order[cur]
				audio.play("select")
				mode = "hub"
				cur = 3
			elif back():
				mode = "hub"
				cur = 3
		"pause":
			var it := pause_items()
			cur = nav(it.size(), delta)
			# Enter is both "accept" and "pause": here it chooses; Esc, Back or Start closes
			if (just("pause") and not just("accept")) or just("back"):
				mode = "play"
				swallow_held()
			elif accept():
				audio.play("select")
				var c: String = it[cur]
				if c == "Resume":
					mode = "play"
					swallow_held()
				elif c == "Controls":
					mode = "help_pause"
				elif c == "Quit to Title":
					best = maxi(best, int(prog["score"]))
					save_options()
					to_title()
				else:
					sel_next = c.split(" ")[0].to_lower()
					mode = "play"
					swallow_held()
		"help", "help_pause":
			if accept() or back() or just("pause"):
				mode = "title" if mode == "help" else "pause"
				swallow_held()
		"options":
			option_menu(delta)
		"code":
			code_menu()
		"over":
			var it := over_items()
			cur = nav(it.size(), delta)
			if accept():
				audio.play("select")
				if it[cur].begins_with("Continue"):
					prog["continues"] = int(prog["continues"]) - 1
					prog["lives"] = int(D["player"]["lives"])
					start_stage(stage_id)
				else:
					best = maxi(best, int(prog["score"]))
					save_options()
					to_title()


func pause_items() -> Array:
	var it: Array = ["Resume"]
	for k in D["items"]:
		var n := int(prog["items"].get(k, 0))
		if n > 0:
			it.append("%s x%d%s" % [String(k).capitalize(), n, " <" if prog["sel"] == k else ""])
	it.append_array(["Controls", "Quit to Title"])
	return it


func over_items() -> Array:
	var it: Array = []
	if int(prog["continues"]) > 0:
		it.append("Continue (%d left)" % int(prog["continues"]))
	it.append("End the Game")
	return it


func option_rows() -> Array:
	var names: Array = D["difficulty"]["names"]
	return ["Difficulty: " + String(names[int(options["difficulty"])]),
		"Buttons: " + Controls.LAYOUT_NAMES[int(options["layout"])],
		"Music: %d%%" % int(round(float(options["music"]) * 100)),
		"Effects: %d%%" % int(round(float(options["sfx"]) * 100)),
		"Fullscreen: " + ("on" if options["fullscreen"] else "off"), "Back"]


func option_menu(delta: float) -> void:
	var rows := option_rows()
	cur = nav(rows.size(), delta)
	var d := 0
	if just("left"):
		d = -1
	elif just("right") or (accept() and cur < rows.size() - 1):
		d = 1
	if d != 0:
		audio.play("menu")
		match cur:
			0: options["difficulty"] = posmod(int(options["difficulty"]) + d, 3)
			1: options["layout"] = posmod(int(options["layout"]) + d, 3)
			2: options["music"] = clampf(snappedf(float(options["music"]) + d * 0.1, 0.1), 0.0, 1.0)
			3: options["sfx"] = clampf(snappedf(float(options["sfx"]) + d * 0.1, 0.1), 0.0, 1.0)
			4: options["fullscreen"] = not options["fullscreen"]
		apply_options()
		save_options()
	if (accept() and cur == rows.size() - 1) or back():
		mode = "title"
		cur = 3


func code_menu() -> void:
	# a 4x4 grid of letters, then DEL and OK
	var n := ALPHA.length() + 2
	if just("right"):
		cur = (cur + 1) % n
	elif just("left"):
		cur = posmod(cur - 1, n)
	elif just("down"):
		cur = mini(cur + 4, n - 1)
	elif just("up"):
		cur = maxi(cur - 4, 0)
	if accept():
		audio.play("select")
		if cur < ALPHA.length():
			if code_buf.length() < 6:
				code_buf += ALPHA[cur]
			if code_buf.length() == 6:
				cur = n - 1
		elif cur == ALPHA.length():
			code_buf = code_buf.left(maxi(0, code_buf.length() - 1))
		else:
			use_code(code_buf)
	elif back():
		if code_buf.is_empty():
			to_title()
		else:
			code_buf = code_buf.left(code_buf.length() - 1)


func use_code(c: String) -> void:
	var d := Code.decode(c)
	if d.is_empty():
		msg = "That tide-code is not right."
		msg_t = 2.5
		audio.play("deny")
		return
	prog = Game.new_progress(D, int(d["difficulty"]))
	prog["done"] = d["done"]
	prog["lives"] = d["lives"]
	prog["maxhp"] = d["maxhp"]
	prog["items"]["knives"] = d["items"]["knives"]
	prog["items"]["tonic"] = d["items"]["tonic"]
	if int(prog["done"]) >= 6:
		start_ending()
		return
	to_hub()


# ------------------------------------------------------------------ ending
func start_ending() -> void:
	mode = "ending"
	ending = {"phase": "bells", "t": 0.0}
	g = null
	world.g = null
	best = maxi(best, int(prog.get("score", 0)))
	last_code = ""
	save_options()
	audio.music("ending")


func run_ending(delta: float) -> void:
	ending["t"] = float(ending["t"]) + delta
	match ending["phase"]:
		"bells":
			if float(ending["t"]) > 4.0:
				show_pages(TX["ending"], "ending_pages")
		"credits":
			var any := just("accept") or just("jump") or just("pause")
			if float(ending["t"]) > credits_len() or (any and float(ending["t"]) > 1.0):
				ending["phase"] = "end"
				ending["t"] = 0.0
		"end":
			if float(ending["t"]) > 3.0 or ((just("accept") or just("jump")) and float(ending["t"]) > PAGE_GUARD):
				swallow_held()
				to_title()


func credits_len() -> float:
	return 4.0 + TX["credits"].size() * 1.1


# ------------------------------------------------------------------ drawing
func screen() -> Rect2:
	return Rect2(0, 0, 320, 224)


func draw_still(u: UI, name: String) -> void:
	var t: Texture2D = A.tex("stills/" + name)
	if t != null:
		u.draw_texture(t, Vector2.ZERO)
	else:
		u.draw_rect(screen(), Color(0.05, 0.08, 0.18))


func draw_ui(u: UI) -> void:
	match mode:
		"title":
			draw_still(u, "title")
			A.draw_frame(u, "logo", 0, Vector2(32, 18))
			var it := title_items()
			u.menu(Rect2(92, 104, 136, 20 + it.size() * 11), it, cur)
			u.text_center(screen(), 160, 212, "Best %d" % best, Color(0.8, 0.85, 1.0))
		"pages", "talk":
			if mode == "talk" or pages_then == "talk":
				pass
			elif pages_then == "ending_pages":
				draw_still(u, "dawn")
			else:
				draw_still(u, "title")
			draw_page(u)
		"hub":
			draw_still(u, "map")
			u.draw_rect(screen(), Color(0, 0, 0.1, 0.45))
			var top := Rect2(8, 8, 304, 40)
			u.window(top)
			u.text_in(top.grow(-8), Vector2(20, 17), "THE LANTERN-HOUSE", Color(1, 0.9, 0.5))
			u.text_in(top.grow(-8), Vector2(20, 29), "Score %d   Bells %d/6" % [int(prog["score"]), int(prog["done"])])
			u.text_in(top.grow(-8), Vector2(214, 17), "Tide-code")
			u.text_in(top.grow(-8), Vector2(214, 29), last_code, Color(0.6, 1, 0.9))
			u.menu(Rect2(40, 60, 240, 80), hub_items(), cur)
			draw_hero_line(u, Rect2(40, 146, 240, 40))
			if msg_t > 0:
				u.window(Rect2(20, 192, 280, 24))
				u.text_center(Rect2(28, 196, 264, 16), 160, 200, msg, Color(1, 0.9, 0.5))
		"map":
			draw_map(u)
		"heroes":
			draw_heroes(u)
		"play":
			draw_hud(u)
		"pause":
			draw_hud(u)
			var it := pause_items()
			u.menu(Rect2(70, 30, 180, 22 + it.size() * 11), it, cur, "PAUSED")
			var selk: String = prog["sel"]
			var hint: String = TX["items"].get(selk, "")
			if hint != "":
				u.window(Rect2(10, 188, 300, 26))
				u.text_center(Rect2(18, 194, 284, 12), 160, 197, hint)
		"help", "help_pause":
			if mode == "help":
				draw_still(u, "title")
			draw_lines(u, "CONTROLS", TX["help"], "")
		"options":
			draw_still(u, "title")
			u.menu(Rect2(40, 50, 240, 90), option_rows(), cur, "OPTIONS")
		"code":
			draw_code(u)
		"over":
			u.draw_rect(screen(), Color(0, 0, 0.05, 0.75))
			draw_lines(u, "", TX["over"], "", 40)
			u.menu(Rect2(90, 130, 140, 50), over_items(), cur)
		"ending":
			draw_ending(u)
	if msg_t > 0 and mode in ["title", "code"]:
		u.window(Rect2(40, 190, 240, 24))
		u.text_center(Rect2(48, 194, 224, 16), 160, 198, msg, Color(1, 0.8, 0.6))
	if fit_queue.size() > 0:
		var w: Array = fit_queue.pop_front()
		draw_lines(u, String(w[0]), w[1], String(w[2]))


func draw_hero_line(u: UI, r: Rect2) -> void:
	u.window(r)
	A.draw_frame(u, "hud", A.frame("hud", hero), r.position + Vector2(10, 12))
	var prof: Array = TX["profiles"][hero]
	u.text_in(r.grow(-8), r.position + Vector2(32, 10), String(prof[0]), Color(1, 0.9, 0.5))
	u.text_in(r.grow(-8), r.position + Vector2(32, 22), String(prof[2]))


func draw_page(u: UI) -> void:
	if page >= pages.size():
		return
	var pg: Dictionary = pages[page]
	var lines: Array = pg.get("lines", [])
	var who: String = pg.get("who", "")
	draw_lines(u, "", lines, who)
	if page_t > PAGE_GUARD and (frames >> 5) % 2 == 0:
		A.draw_frame(u, "cursor", 0, Vector2(292, 205).round())


## A text window at the bottom of the screen (with a portrait when `who` is set).
func draw_lines(u: UI, title: String, lines: Array, who: String, top: int = -1) -> void:
	var h := 22 + lines.size() * 10 + (12 if title != "" else 0)
	var y := 216 - h if top < 0 else top
	var r := Rect2(8, y, 304, h)
	u.window(r)
	var inner := r.grow(-8)
	var x := 18
	if who != "":
		u.portrait(who, Vector2(14, y + 8))
		x = 70
		inner = Rect2(Vector2(66, inner.position.y), Vector2(r.end.x - 8 - 66, inner.size.y))
	var ty := y + 11
	if title != "":
		u.text_in(inner, Vector2(x, ty), title, Color(1, 0.9, 0.5))
		ty += 12
	for l in lines:
		u.text_in(inner, Vector2(x, ty), String(l))
		ty += 10


func draw_hud(u: UI) -> void:
	if g == null:
		return
	var p: Dictionary = g.p
	A.draw_frame(u, "hud", A.frame("hud", hero), Vector2(8, 6))
	u.text_in(screen(), Vector2(26, 10), "x%d" % int(prog["lives"]))
	u.text_center(screen(), 160, 8, "%07d" % int(prog["score"]), Color(1, 0.95, 0.7))
	A.draw_frame(u, "hud", A.frame("hud", "box"), Vector2(294, 4))
	var selk: String = prog["sel"]
	var cnt := int(prog["items"].get(selk, 0))
	if cnt > 0:
		A.draw_frame(u, "items", A.frame("items", selk), Vector2(294, 4))
		u.text_in(screen(), Vector2(284, 22), "x%d" % cnt)
	if p["buff"] != "":
		var secs := int(ceil(p["buff_t"] / 60.0))
		A.draw_frame(u, "items", A.frame("items", p["buff"]), Vector2(274, 4))
		u.text_in(screen(), Vector2(250, 8), "%2d" % secs, Color(0.7, 0.9, 1))
	# the health bar: 1 px per point, framed at the maximum (H2, H3)
	var maxhp := int(prog["maxhp"])
	var x0 := 92
	var y0 := 206
	u.draw_rect(Rect2(x0 - 1, y0 - 1, maxhp + 2, 5), Color(0.9, 0.9, 1.0))
	u.draw_rect(Rect2(x0, y0, maxhp, 3), Color(0.05, 0.05, 0.15))
	var shown: int = clampi(int(p["shown"]), 0, maxhp)
	u.draw_rect(Rect2(x0, y0, shown, 3), Color(1.0, 0.85, 0.2) if shown > 24 else Color(1.0, 0.35, 0.2))
	A.draw_frame(u, "hud", A.frame("hud", "heart"), Vector2(x0 - 18, y0 - 7))
	# the guardian's health, while the arena is shut
	if g.arena_left >= 0 and g.guardian_id > 0:
		var gd: Dictionary = g.obj_by_id(g.guardian_id)
		if not gd.is_empty() and int(gd.get("asleep", 0)) == 0:
			var full := int(D["enemies"][gd["k"]]["hp"])
			u.draw_rect(Rect2(110, 22, 100, 4), Color(0.1, 0, 0))
			u.draw_rect(Rect2(110, 22, int(100.0 * maxi(0, int(gd["hp"])) / full), 4), Color(0.9, 0.2, 0.3))
	if g.mode == "clear":
		u.window(Rect2(70, 90, 180, 28))
		u.text_center(Rect2(78, 96, 164, 16), 160, 100, "THE BELL IS FOUND!", Color(1, 0.9, 0.4))


func draw_map(u: UI) -> void:
	draw_still(u, "map")
	var spots := [Vector2(52, 150), Vector2(96, 70), Vector2(160, 46), Vector2(236, 62), Vector2(272, 138), Vector2(170, 176)]
	var done := int(prog["done"])
	for i in spots.size():
		var tag := "done" if i < done else "island"
		A.draw_frame(u, "mapmark", A.frame("mapmark", tag), spots[i] - Vector2(8, 8))
		if i == done:
			A.draw_frame(u, "mapmark", A.frame("mapmark", "here", frames >> 4), spots[i] - Vector2(8, 8))
		u.text_center(screen(), spots[i].x, spots[i].y + 9, stage_name(i), Color(1, 1, 1) if i == done else Color(0.75, 0.8, 0.9))
	u.window(Rect2(60, 4, 200, 22))
	u.text_center(Rect2(68, 8, 184, 14), 160, 11, "THE SALTMARCH", Color(1, 0.9, 0.5))


func draw_heroes(u: UI) -> void:
	draw_still(u, "title")
	var order: Array = D["hero_order"]
	u.window(Rect2(8, 8, 304, 30))
	u.text_center(Rect2(16, 14, 288, 18), 160, 19, "CHOOSE A WARDEN", Color(1, 0.9, 0.5))
	for i in order.size():
		var x := 50 + i * 110
		var r := Rect2(x - 40, 46, 80, 80)
		u.window(r)
		if i == cur:
			u.draw_rect(r.grow(-6), Color(1, 0.9, 0.4, 0.15))
		A.draw_at(u, order[i], A.frame(order[i], "stand" if i != cur else "walk", frames >> 3), Vector2(x, 116))
	var prof: Array = TX["profiles"][order[cur]]
	var r2 := Rect2(8, 134, 304, 62)
	u.window(r2)
	var inner := r2.grow(-8)
	for k in prof.size():
		u.text_in(inner, Vector2(18, 143 + k * 11), String(prof[k]), Color(1, 0.9, 0.5) if k == 0 else Color.WHITE)
	u.text_center(screen(), 160, 206, "left/right to look, %s to choose" % ctl.label("accept"), Color(0.8, 0.85, 1))


func draw_code(u: UI) -> void:
	draw_still(u, "title")
	var r := Rect2(60, 30, 200, 150)
	u.window(r)
	var inner := r.grow(-8)
	u.text_center(inner, 160, 40, "ENTER TIDE-CODE", Color(1, 0.9, 0.5))
	var shown := code_buf + "______".substr(code_buf.length())
	u.text_center(inner, 160, 58, " ".join(Array(shown.split(""))), Color(0.6, 1, 0.9))
	for i in ALPHA.length():
		var x := 104 + (i % 4) * 30
		var y := 78 + (i / 4) * 16
		u.text_in(inner, Vector2(x, y), ALPHA[i], Color.WHITE if i == cur else Color(0.7, 0.75, 0.85))
		if i == cur:
			A.draw_frame(u, "cursor", 0, Vector2(x - 10, y))
	var dl := ALPHA.length()
	u.text_in(inner, Vector2(104, 146), "DEL", Color.WHITE if cur == dl else Color(0.7, 0.75, 0.85))
	u.text_in(inner, Vector2(170, 146), "OK", Color.WHITE if cur == dl + 1 else Color(0.7, 0.75, 0.85))
	if cur >= dl:
		A.draw_frame(u, "cursor", 0, Vector2(94 if cur == dl else 160, 146))
	for k in TX["code_help"].size():
		u.text_center(screen(), 160, 190 + k * 10, String(TX["code_help"][k]), Color(0.8, 0.85, 1))


func draw_ending(u: UI) -> void:
	match ending["phase"]:
		"bells":
			draw_still(u, "dawn")
			var t: float = ending["t"]
			for i in 6:
				if t > 0.5 + i * 0.5:
					var x := 30 + i * 52
					A.draw_frame(u, "bell", A.frame("bell", "shine", int(t * 6) + i), Vector2(x, 30 + (i % 2) * 8))
			u.draw_rect(screen(), Color(1, 1, 1, clampf(1.0 - t, 0.0, 1.0)))
		"credits":
			u.draw_rect(screen(), Color(0.02, 0.03, 0.08))
			var y := 224 - float(ending["t"]) * 24.0
			var lines: Array = TX["credits"]
			for k in lines.size():
				var ly := y + k * 12
				if ly > -10 and ly < 230:
					u.text_center(Rect2(0, -20, 320, 264), 160, ly, String(lines[k]), Color(1, 0.9, 0.5) if k == 0 else Color.WHITE)
		"end":
			draw_still(u, "dawn")
			u.window(Rect2(60, 90, 200, 44))
			u.text_center(Rect2(68, 96, 184, 32), 160, 100, "THE END", Color(1, 0.9, 0.5))
			u.text_center(Rect2(68, 96, 184, 32), 160, 114, "Final score %d" % int(prog.get("score", 0)))


# ------------------------------------------------------------------ harness
func run_harness() -> void:
	if wait_frames > 0:
		wait_frames -= 1
		return
	if not replay.is_empty():
		if replay["done"]:
			print("REPLAY %s %s steps=%d" % [replay["stage"], "ok" if replay["ok"] else "FAIL", replay["i"]])
			release_all()
			var ended: bool = replay.get("end", false)
			replay = {}
			if script_cmds.is_empty() and shot == "" and not ended:
				get_tree().quit()
			return
		if not (replay.get("talk", false) and mode == "talk"):
			return
	if script_cmds.is_empty() or frames % 6 != 0:
		return
	var cmd: String = script_cmds.pop_front()
	var a := cmd.split(":")
	match a[0]:
		"newgame":
			new_game()
		"stage":
			prog = Game.new_progress(D, 1)
			hero = a[2] if a.size() > 2 else "kess"
			start_stage(a[1])
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
			# replay:STAGE[:kb|pad[:talk][:end]]: ":end" carries on past the bell (hub or ending)
			begin_replay(a[1], a[2] if a.size() > 2 else "kb", a.has("talk"), a.has("end"))
		"waittalk":
			# wait for the next talk of a talk replay; give up once the replay has ended
			if mode != "talk" and not replay.is_empty() and not replay["done"]:
				script_cmds.push_front(cmd)
			elif mode != "talk":
				print("HARNESS waittalk: the replay ended without another talk")
		"dump":
			dump()
		"set":
			match a[1]:
				"score":
					prog["score"] = int(a[2])
				"done":
					prog["done"] = int(a[2])
				"hp":
					g.p["hp"] = int(a[2])
				"items":
					for k in D["items"]:
						prog["items"][k] = int(a[2])
				_:
					print("HARNESS unknown command: ", cmd)
		"fitall":
			for k in TX:
				var v = TX[k]
				if v is Array and v.size() > 0 and v[0] is Dictionary:
					for pg in v:
						fit_queue.append(["", pg["lines"], pg.get("who", "")])
			fit_queue.append(["CONTROLS", TX["help"], ""])
			script_cmds.push_front("fitwait")
		"fitwait":
			if not fit_queue.is_empty():
				script_cmds.push_front(cmd)
		"fit":
			var over: Array = ui.overflows.keys()
			over.sort()
			print("FIT ok" if over.is_empty() else "FIT %d: %s" % [over.size(), " / ".join(over)])
			ui.overflows.clear()
		"assets":
			check_assets()
		"quit":
			get_tree().quit()
		_:
			print("HARNESS unknown command: ", cmd)


func check_assets() -> void:
	var missing: Array = []
	var n := 0
	for name in A.manifest.get("sprites", {}):
		n += 1
		if A.sprite(name) == null:
			missing.append("sprites/" + name)
	for t in A.manifest.get("tiles", {}).get("themes", []):
		n += 3
		for p in ["tiles/" + t, "backdrops/%s_far" % t, "backdrops/%s_mid" % t]:
			if A.tex(p) == null:
				missing.append(p)
	for s in A.manifest.get("stills", []):
		n += 1
		if A.tex("stills/" + s) == null:
			missing.append("stills/" + s)
	for m in A.manifest.get("music", []):
		n += 1
		if A.sound("music/" + m) == null:
			missing.append("music/" + m)
	for s in A.manifest.get("sfx", []):
		n += 1
		if A.sound("sfx/" + s) == null:
			missing.append("sfx/" + s)
	print("ASSETS ok %d" % n if missing.is_empty() else "ASSETS missing " + ", ".join(missing))


func dump() -> void:
	var extra := ""
	match mode:
		"pages", "talk":
			extra = " page=%d/%d who=%s" % [page, pages.size(), pages[mini(page, pages.size() - 1)].get("who", "") if pages.size() > 0 else ""]
		"hub", "title", "pause", "over", "options":
			extra = " cur=%d" % cur
		"ending":
			extra = " phase=%s" % ending["phase"]
		"code":
			extra = " code=%s" % code_buf
	if g != null and mode in ["play", "pause", "talk"]:
		var p: Dictionary = g.p
		extra += " stage=%s pos=%d,%d st=%s hp=%d lives=%d score=%d core=%s sel=%s items=%s" % [g.stage, p["x"] >> 16,
			p["y"] >> 16, p["st"], p["hp"], int(prog["lives"]), int(prog["score"]), g.mode, prog["sel"], str(prog["items"])]
	elif not prog.is_empty():
		extra += " done=%d score=%d hero=%s code=%s" % [int(prog["done"]), int(prog["score"]), hero, last_code]
	print("DUMP mode=%s%s" % [mode, extra])


const KEYMAP := {"left": KEY_LEFT, "right": KEY_RIGHT, "up": KEY_UP, "down": KEY_DOWN, "z": KEY_Z, "x": KEY_X,
	"c": KEY_C, "v": KEY_V, "enter": KEY_ENTER, "esc": KEY_ESCAPE, "space": KEY_SPACE}
const PADMAP := {"a": JOY_BUTTON_A, "b": JOY_BUTTON_B, "x": JOY_BUTTON_X, "y": JOY_BUTTON_Y,
	"start": JOY_BUTTON_START, "up": JOY_BUTTON_DPAD_UP, "down": JOY_BUTTON_DPAD_DOWN,
	"left": JOY_BUTTON_DPAD_LEFT, "right": JOY_BUTTON_DPAD_RIGHT}


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


## Plays a route through synthesized device events, so the path from device to input map
## to Controls.held() to the core is exercised. "kb" uses the arrows, Z, X, C; "pad" the
## left stick for left and right, the D-pad for up and down, and A, X, B (layout 1).
func begin_replay(stage: String, device: String, talk: bool, end: bool = false) -> void:
	var r = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % stage))
	prog = Game.new_progress(D, 1)
	hero = r.get("hero", "kess")
	start_stage(stage)
	replay = {"stage": stage, "device": device, "inputs": r["inputs"], "i": 0, "done": false, "ok": false,
		"held": {}, "talk": talk, "end": end}


func replay_input() -> Dictionary:
	var i: int = replay["i"]
	if i >= replay["inputs"].size():
		replay["done"] = true
		replay["ok"] = false
		return {}
	replay["i"] = i + 1
	var want := Inputs.unpack(int(replay["inputs"][i]))
	if replay["device"] == "kb":
		set_held("right", want["dx"] > 0, func(d): send_key("right", d))
		set_held("left", want["dx"] < 0, func(d): send_key("left", d))
		set_held("down", want["dy"] > 0, func(d): send_key("down", d))
		set_held("up", want["dy"] < 0, func(d): send_key("up", d))
		set_held("z", want["jump"], func(d): send_key("z", d))
		set_held("x", want["attack"], func(d): send_key("x", d))
		set_held("c", want["item"], func(d): send_key("c", d))
		set_held("v", want["special"], func(d): send_key("v", d))
	else:
		if replay["held"].get("lx", 0) != want["dx"]:
			replay["held"]["lx"] = want["dx"]
			send_axis("lx", float(want["dx"]))
		set_held("pdown", want["dy"] > 0, func(d): send_pad("down", d))
		set_held("pup", want["dy"] < 0, func(d): send_pad("up", d))
		set_held("pa", want["jump"], func(d): send_pad("a", d))
		set_held("px", want["attack"], func(d): send_pad("x", d))
		set_held("pb", want["item"], func(d): send_pad("b", d))
		set_held("py", want["special"], func(d): send_pad("y", d))
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
