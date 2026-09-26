## Gates Below: the application. Owns the core game (scripts/core/game.gd), the 3D view
## (dungeon.gd, rendered into a 448x272 SubViewport), the 2D UI (ui.gd) and audio.
## The world advances in 100 ms ticks, as the core expects; overlays pause it.
extends Node

const Content = preload("res://scripts/core/content.gd")
const Game = preload("res://scripts/core/game.gd")
const Assets = preload("res://scripts/view/assets.gd")
const Dungeon = preload("res://scripts/view/dungeon.gd")
const UI = preload("res://scripts/view/ui.gd")
const Audio = preload("res://scripts/view/audio.gd")
const PixFont = preload("res://scripts/view/pixfont.gd")
const TICK := 0.1
const TURN_EDGE := 34.0   # px of the 3D view's left and right edges that turn on click
const SAVE_DIR := "user://saves/"
const MOVE_KEYS := {KEY_W: 0, KEY_UP: 0, KEY_S: 2, KEY_DOWN: 2, KEY_A: 3, KEY_D: 1}
const TURN_KEYS := {KEY_Q: -1, KEY_LEFT: -1, KEY_E: 1, KEY_RIGHT: 1}

const Rules = preload("res://scripts/core/rules.gd")
const Rng = preload("res://scripts/core/rng.gd")
## Faces offered on the creation screen (Maren's is kept for Maren), with default names.
const FACES := [["garrow", "Garrow", "m"], ["vesna", "Vesna", "f"], ["sefa", "Sefa", "f"], ["brann", "Brann", "m"],
	["ilsa", "Ilsa", "f"], ["odo", "Odo", "m"], ["tobin", "Tobin", "m"]]
## The eight disc profiles, counter-clockwise from the east.
const CALLINGS := ["Strider", "Runner", "Seer", "Sage", "Adept", "Rogue", "Duelist", "Warrior"]
const DISC_CENTER := Vector2(130, 196)

var content: Dictionary
var create: Dictionary = {}   # the creation screen: {slots, cur, rng, drag}
var g
var A
var dungeon
var ui
var audio
var sub: SubViewport
var screen = "title"     # title | game
var overlay = ""         # "" inv cast map book dialog shop menu help
var menu_sub = ""        # "" save load
var sel = 0
var cast_pending = ""
var book_page = 0
var hover_text = ""
var hover_item = null
var card_flash = {}
var tick_acc = 0.0
var battle_wait = 0.0
var queued_move = -99
# automation for screenshots/tests: --shot=path --script=a,b,c
var shot = ""
var shot_frame = 0
var frames = 0
var script_cmds: Array = []


func _ready() -> void:
	A = Assets.new()
	content = Content.load_all()
	Input.mouse_mode = Input.MOUSE_MODE_HIDDEN
	sub = SubViewport.new()
	sub.size = Vector2i(448, 272)
	sub.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	sub.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	add_child(sub)
	var tr = TextureRect.new()
	tr.texture = sub.get_texture()
	add_child(tr)
	audio = Audio.new()
	add_child(audio)
	audio.setup(A)
	ui = UI.new()
	ui.m = self
	var fm: Dictionary = A.json("font/font.json")
	ui.font = PixFont.new(A.tex("font/font"), fm)
	add_child(ui)
	_load_settings()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.substr(7)
		elif a.begins_with("--frames="):
			shot_frame = int(a.substr(9))
		elif a.begins_with("--script="):
			script_cmds = Array(a.substr(9).split(","))
	start_title()


# ------------------------------------------------------------------ screens

func _new_dungeon() -> void:
	if dungeon != null:
		dungeon.queue_free()
	dungeon = Dungeon.new()
	sub.add_child(dungeon)
	dungeon.setup(g, A)


func start_title() -> void:
	screen = "title"
	overlay = ""
	g = Game.new(content)
	g.new_game(1)
	g.pop_events()
	sub.size = Vector2i(640, 360)
	_new_dungeon()
	dungeon.build()
	dungeon.demo = true
	audio.music("title")


func new_game() -> void:
	g = Game.new(content)
	g.new_game(int(Time.get_unix_time_from_system()) & 0x7FFFFFFF)
	_begin()


func _begin() -> void:
	screen = "game"
	overlay = ""
	sel = 0
	sub.size = Vector2i(448, 272)
	_new_dungeon()
	dungeon.build()
	audio.music(String(g.lv.data.get("music", "cellars")))
	process_events()


func load_slot(i: int) -> bool:
	var path = SAVE_DIR + "slot%d.sav" % i
	if not FileAccess.file_exists(path):
		return false
	var d = str_to_var(FileAccess.get_file_as_string(path))
	if not d is Dictionary:
		return false
	g = Game.new(content)
	g.from_save(d["state"])
	_begin()
	g.msg("Game loaded.")
	return true


func save_slot(i: int) -> void:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	var f = FileAccess.open(SAVE_DIR + "slot%d.sav" % i, FileAccess.WRITE)
	var when = Time.get_datetime_string_from_system(false, true).substr(5, 11)   # "MM-DD HH:MM"
	var label = "%s  %s" % [_short_level_name(String(g.s["level"])), when]
	f.store_string(var_to_str({"label": label, "state": g.to_save()}))
	f.close()
	_labels.erase(i)


var _labels = {}


func _short_level_name(id: String) -> String:
	var n = String(content["levels"].get(id, {}).get("name", id))
	return n.substr(4) if n.begins_with("The ") else n


## A slot's label, e.g. "Cellar Vaults  09-26 13:22". Cached: reading a save means
## parsing the whole game state, which the menu must not do every frame. Older saves
## carried a long label; theirs is rebuilt from the saved level and the file's time.
func slot_label(i: int) -> String:
	if _labels.has(i):
		return _labels[i]
	var path = SAVE_DIR + "slot%d.sav" % i
	var label = "empty"
	if FileAccess.file_exists(path):
		var d = str_to_var(FileAccess.get_file_as_string(path))
		label = "?"
		if d is Dictionary and d.has("state"):
			var when = Time.get_datetime_string_from_unix_time(FileAccess.get_modified_time(path) + int(Time.get_time_zone_from_system()["bias"]) * 60, true).substr(5, 11)
			label = "%s  %s" % [_short_level_name(String(d["state"].get("level", ""))), when]
			if String(d.get("label", "")).length() <= 26 and String(d.get("label", "")) != "":
				label = String(d["label"])
	_labels[i] = label
	return label


func latest_slot() -> int:
	var best = -1
	var best_t = 0
	for i in 10:
		var path = SAVE_DIR + "slot%d.sav" % i
		if FileAccess.file_exists(path):
			var t = FileAccess.get_modified_time(path)
			if t > best_t:
				best_t = t
				best = i
	return best


func _load_settings() -> void:
	var cf = ConfigFile.new()
	if cf.load("user://settings.cfg") == OK:
		audio.sound_on = bool(cf.get_value("audio", "sound", true))
		audio.music_on = bool(cf.get_value("audio", "music", true))


func _save_settings() -> void:
	var cf = ConfigFile.new()
	cf.set_value("audio", "sound", audio.sound_on)
	cf.set_value("audio", "music", audio.music_on)
	cf.save("user://settings.cfg")


# ------------------------------------------------------------------ creation screen

func open_create() -> void:
	screen = "create"
	overlay = ""
	create = {"slots": [], "cur": 0, "rng": Rng.new(int(Time.get_unix_time_from_system()) & 0x7FFFFFFF), "drag": false}
	add_slot()


func face_used(face: String, except: int) -> bool:
	for i in create["slots"].size():
		if i != except and String(create["slots"][i]["portrait"]) == face:
			return true
	return false


func add_slot() -> void:
	if create["slots"].size() >= 6:
		return
	var idx: int = create["slots"].size()
	var face: Array = FACES[0]
	for f in FACES:
		if not face_used(f[0], -1):
			face = f
			break
	create["slots"].append({"name": face[1], "portrait": face[0], "sex": face[2], "angle": 0, "radius": 0, "stats": null, "ready": false})
	create["cur"] = idx


func cur_slot() -> Dictionary:
	return create["slots"][int(create["cur"])]


func calling_of(slot: Dictionary) -> String:
	if int(slot["radius"]) < 20:
		return "Balanced"
	var k: int = int(round(float(slot["angle"]) / 45.0)) % 8
	return ("Leaning " if int(slot["radius"]) < 50 else "") + CALLINGS[k]


func set_pearl(p: Vector2) -> void:
	var s: Dictionary = cur_slot()
	var d: Vector2 = p - DISC_CENTER
	var ang: int = int(round(rad_to_deg(atan2(-d.y, d.x))))
	if ang < 0:
		ang += 360
	ang %= 360
	var r: int = mini(int(d.length()), Rules.DISC_RADIUS)
	if ang != int(s["angle"]) or r != int(s["radius"]):
		s["angle"] = ang
		s["radius"] = r
		s["stats"] = null     # moving the pearl re-opens the roll
		s["ready"] = false


func create_action(info: Dictionary) -> void:
	var s: Dictionary = cur_slot()
	match String(info["kind"]):
		"c_slot":
			create["cur"] = int(info["i"])
		"c_add":
			add_slot()
		"c_face":
			if not face_used(String(info["face"]), int(create["cur"])):
				var old_default = ""
				for f in FACES:
					if f[0] == s["portrait"]:
						old_default = f[1]
				for f in FACES:
					if f[0] == info["face"]:
						s["portrait"] = f[0]
						s["sex"] = f[2]
						if String(s["name"]) == old_default or String(s["name"]) == "":
							s["name"] = f[1]
				s["ready"] = false
		"c_roll":
			s["stats"] = Rules.disc_roll(create["rng"], Rules.disc_ranges(int(s["angle"]), int(s["radius"])))
			s["ready"] = false
			audio.play("rune")
		"c_accept":
			if s["stats"] != null and String(s["name"]).strip_edges() != "":
				s["ready"] = true
				audio.play("levelup")
				for i in create["slots"].size():
					if not create["slots"][i]["ready"]:
						create["cur"] = i
						break
		"c_remove":
			if create["slots"].size() > 1:
				create["slots"].remove_at(int(create["cur"]))
				create["cur"] = mini(int(create["cur"]), create["slots"].size() - 1)
		"c_disc":
			create["drag"] = true
			set_pearl(ui.get_global_mouse_position())
		"c_begin":
			begin_created()
		"c_back":
			screen = "title"
			create = {}


func party_ready() -> bool:
	if create.is_empty():
		return false
	for s in create["slots"]:
		if not s["ready"]:
			return false
	return true


func begin_created() -> void:
	if not party_ready():
		return
	var specs = []
	for s in create["slots"]:
		specs.append({"name": String(s["name"]).strip_edges(), "portrait": s["portrait"], "sex": s["sex"], "stats": s["stats"]})
	g = Game.new(content)
	g.new_game_custom(int(create["rng"].next()), specs)
	create = {}
	_begin()


func _create_key(e: InputEventKey) -> void:
	var s: Dictionary = cur_slot()
	if e.keycode == KEY_ESCAPE:
		create_action({"kind": "c_back"})
	elif e.keycode == KEY_BACKSPACE:
		s["name"] = String(s["name"]).substr(0, maxi(0, String(s["name"]).length() - 1))
		s["ready"] = false
	elif e.keycode == KEY_ENTER or e.keycode == KEY_KP_ENTER:
		if party_ready():
			begin_created()
		elif s["stats"] == null:
			create_action({"kind": "c_roll"})
		else:
			create_action({"kind": "c_accept"})
	elif e.keycode == KEY_TAB:
		create["cur"] = (int(create["cur"]) + 1) % create["slots"].size()
	elif e.unicode >= 32 and e.unicode < 127 and String(s["name"]).length() < 12:
		var ch: String = char(e.unicode)
		if ch.is_valid_identifier() or ch == " " or ch == "'" or ch == "-" or ch.is_valid_int():
			s["name"] = String(s["name"]) + ch
			s["ready"] = false


# ------------------------------------------------------------------ frame loop

func paused() -> bool:
	return overlay in ["menu", "help", "dialog", "shop", "book", "map", "inv", "cast"] or screen != "game"


func _process(delta: float) -> void:
	frames += 1
	if screen == "game":
		if not paused() and g.s["mode"] in ["explore", "battle"]:
			tick_acc += delta
			while tick_acc >= TICK:
				tick_acc -= TICK
				g.tick()
		else:
			tick_acc = 0.0
		_battle_flow(delta)
		process_events()
		# An open shop blocks movement (game.step), so it must never outlive its screen.
		if not g.shop.is_empty() and not overlay in ["shop", "dialog"]:
			g.close_shop()
		if queued_move != -99 and not dungeon.busy():
			var mv = queued_move
			queued_move = -99
			_do_move(mv)
	if screen == "create" and not create.is_empty() and bool(create["drag"]):
		if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
			set_pearl(ui.get_global_mouse_position())
		else:
			create["drag"] = false
	for k in card_flash.keys():
		card_flash[k] = maxf(0.0, float(card_flash[k]) - delta * 2.5)
	dungeon.update(delta)
	_update_hover()
	ui.queue_redraw()
	_automation()


func process_events() -> void:
	for e in g.pop_events():
		match String(e["t"]):
			"sfx":
				audio.play(String(e["name"]), float(e["vol"]))
			"level":
				if dungeon.level_id != g.s["level"]:
					dungeon.build()
					audio.music(String(g.lv.data.get("music", "cellars")))
			"autosave":
				save_slot(9)
			"dialog":
				overlay = "dialog"
			"dialog_end":
				if overlay == "dialog":
					overlay = "shop" if not g.shop.is_empty() else ""
			"shop":
				overlay = "shop"
			"hurt":
				card_flash[int(e["ci"])] = 1.0
			"battle_start":
				battle_wait = 0.4
				_pick_plan_char()
			"won":
				audio.music("ending")
			"party_dead":
				audio.music("")
			_:
				dungeon.on_event(e)


# ------------------------------------------------------------------ battle pacing

func plan_char() -> int:
	if g.s["mode"] != "battle":
		return -1
	if sel >= 0 and sel < g.s["party"].size() and not g.s["party"][sel]["dead"] and g.battle.plan_of(sel).is_empty() and int(g.s["party"][sel]["st"]) > 0:
		return sel
	for ci in g.living():
		if g.battle.plan_of(ci).is_empty() and int(g.s["party"][ci]["st"]) > 0:
			return ci
	return -1


func _pick_plan_char() -> void:
	var c = plan_char()
	if c >= 0:
		sel = c


func _battle_flow(delta: float) -> void:
	if g.s["mode"] != "battle" or overlay != "":
		return
	if battle_wait > 0.0:
		battle_wait -= delta
		return
	if g.battle.ready():
		g.battle.resolve_round()
		g.s["battle"]["plans"] = {} if g.s["mode"] == "battle" else {}
		battle_wait = 0.7
		_pick_plan_char()


func plan(p: Dictionary) -> void:
	var ci = plan_char()
	if ci < 0:
		return
	g.battle.plan(ci, p)
	_pick_plan_char()


func plan_all_attack() -> void:
	for ci in g.living():
		if g.battle.plan_of(ci).is_empty():
			var ch: Dictionary = g.s["party"][ci]
			var w = ch["equip"].get("hand_r")
			var ranged: bool = w != null and String(g.item_def(w).get("type", "")) == "ranged"
			var can: bool = (ranged and g.battle.line_target() != null and int(ch["quiver"]) > 0) or (not ranged and not g.battle.front_monsters().is_empty())
			g.battle.plan(ci, {"act": "attack" if can else "guard"})


# ------------------------------------------------------------------ input

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		_key(event as InputEventKey)
	elif event is InputEventMouseButton and event.pressed:
		_click(event as InputEventMouseButton)


func _key(e: InputEventKey) -> void:
	var k = e.keycode
	if screen == "create":
		_create_key(e)
		return
	if screen == "title":
		if k == KEY_ESCAPE and overlay != "":
			overlay = ""
			menu_sub = ""
		elif k == KEY_ENTER or k == KEY_SPACE:
			new_game()
		return
	if g.s["mode"] in ["dead", "won"]:
		return
	if overlay == "dialog":
		if k >= KEY_1 and k <= KEY_9:
			var cs: Array = g.dialog_choices()
			var n = k - KEY_1
			if n < cs.size():
				g.dialog_choose(int(cs[n]["i"]))
		return
	if k == KEY_ESCAPE:
		if overlay == "shop":
			g.close_shop()
			overlay = ""
		elif overlay != "":
			overlay = ""
			cast_pending = ""
			menu_sub = ""
		else:
			overlay = "menu"
		return
	if k == KEY_F5:
		save_slot(0)
		g.msg("Saved to slot 0.")
		return
	if k == KEY_F9:
		load_slot(0)
		return
	if overlay == "book":
		if k in [KEY_RIGHT, KEY_D, KEY_SPACE]:
			book_page = mini(book_page + 2, maxi(0, book_pages().size() - 1))
		elif k in [KEY_LEFT, KEY_A]:
			book_page = maxi(0, book_page - 2)
		elif k == KEY_B:
			overlay = ""
		return
	if overlay in ["inv", "cast", "map", "help", "menu", "shop"]:
		if (overlay == "inv" and k == KEY_I) or (overlay == "cast" and k == KEY_C) or (overlay == "map" and (k == KEY_M or k == KEY_TAB)):
			overlay = ""
			cast_pending = ""
		elif overlay == "inv" and k >= KEY_1 and k <= KEY_6 and k - KEY_1 < g.s["party"].size():
			sel = k - KEY_1
		return
	# no overlay: movement and commands
	if MOVE_KEYS.has(k):
		queued_move = MOVE_KEYS[k]
		return
	if TURN_KEYS.has(k):
		queued_move = 10 + TURN_KEYS[k]
		return
	if g.s["mode"] == "battle":
		match k:
			KEY_G: plan({"act": "guard"})
			KEY_T:
				if g.s["held"] != null:
					plan({"act": "throw"})
				else:
					g.msg("Hold an item to throw it.")
			KEY_ENTER, KEY_KP_ENTER: plan_all_attack()
			KEY_C:
				var ci = plan_char()
				if ci >= 0:
					sel = ci
					overlay = "cast"
			KEY_A:
				plan({"act": "attack"})
		if k >= KEY_1 and k <= KEY_6 and k - KEY_1 < g.s["party"].size():
			sel = k - KEY_1
		return
	match k:
		KEY_SPACE: g.touch()
		KEY_I: overlay = "inv"
		KEY_C: overlay = "cast"
		KEY_M, KEY_TAB: overlay = "map"
		KEY_B:
			overlay = "book"
			book_page = maxi(0, (book_pages().size() - 1) & ~1)
		KEY_R: g.rest()
		KEY_H, KEY_F1: overlay = "help"
	if k >= KEY_1 and k <= KEY_6 and k - KEY_1 < g.s["party"].size():
		sel = k - KEY_1
		overlay = "inv"


func _do_move(mv: int) -> void:
	if screen != "game" or overlay != "" or g.s["mode"] in ["dead", "won"]:
		return
	if mv >= 9:
		g.turn(mv - 10)
	else:
		g.step(mv)
		if g.s["mode"] == "battle":
			battle_wait = 0.5


func _click(e: InputEventMouseButton) -> void:
	if e.button_index != MOUSE_BUTTON_LEFT and e.button_index != MOUSE_BUTTON_RIGHT:
		return
	_click_at(ui.get_global_mouse_position(), e.button_index == MOUSE_BUTTON_RIGHT)


func _click_at(p: Vector2, right: bool) -> void:
	var h: Dictionary = ui.hit(p)
	if String(h.get("kind", "")).begins_with("c_"):
		create_action(h)
		return
	match String(h.get("kind", "")):
		"pad":
			if overlay == "" and screen == "game":
				queued_move = int(h["move"])
		"title":
			match String(h["id"]):
				"new": new_game()
				"create": open_create()
				"continue": load_slot(latest_slot())
				"load_menu":
					overlay = "menu"
					menu_sub = "load"
				"help": overlay = "help"
				"quit": get_tree().quit()
		"button":
			if overlay == "shop":
				g.close_shop()
				overlay = ""
			match String(h["id"]):
				"inv": overlay = "" if overlay == "inv" else "inv"
				"cast": overlay = "" if overlay == "cast" else "cast"
				"map": overlay = "" if overlay == "map" else "map"
				"book":
					overlay = "" if overlay == "book" else "book"
					book_page = maxi(0, (book_pages().size() - 1) & ~1)
				"rest": g.rest()
				"menu": overlay = "" if overlay == "menu" else "menu"
		"card":
			var ci = int(h["i"])
			if cast_pending != "":
				_finish_cast(ci)
			elif right or (g.s["held"] != null and overlay in ["", "shop"]):
				if g.s["held"] != null:
					g.give_held(ci)
				else:
					sel = ci
					overlay = "inv"
			else:
				if sel == ci and overlay == "" and g.s["mode"] != "battle":
					overlay = "inv"
				sel = ci
		"view":
			_view_click(p, right)
		"close":
			if overlay == "shop":
				g.close_shop()
			overlay = ""
			cast_pending = ""
		"equip":
			g.equip_click(sel, String(h["slot"]))
		"pack":
			if right:
				if g.s["mode"] == "battle":
					plan({"act": "use", "idx": int(h["i"])})
					overlay = ""
				else:
					g.use_item(sel, int(h["i"]))
			else:
				g.pack_click(sel, int(h["i"]))
		"raise":
			g.raise_stat(sel, String(h["stat"]))
		"select":
			sel = int(h["i"])
		"spell":
			_choose_spell(String(h["id"]))
		"book_next":
			book_page = mini(book_page + 2, maxi(0, book_pages().size() - 1))
		"book_prev":
			book_page = maxi(0, book_page - 2)
		"choice":
			g.dialog_choose(int(h["i"]))
		"buy":
			g.shop_buy(int(h["i"]))
		"sell":
			g.shop_sell()
		"menu":
			match String(h["id"]):
				"resume": overlay = ""
				"save_menu": menu_sub = "save"
				"load_menu": menu_sub = "load"
				"back": menu_sub = ""
				"sound":
					audio.sound_on = not audio.sound_on
					_save_settings()
				"music":
					audio.set_music_on(not audio.music_on)
					_save_settings()
				"help": overlay = "help"
				"title": start_title()
		"slot":
			if menu_sub == "save" or (screen == "game" and menu_sub == "save"):
				save_slot(int(h["i"]))
				g.msg("Saved to slot %d." % int(h["i"]))
				overlay = ""
				menu_sub = ""
			else:
				if load_slot(int(h["i"])):
					menu_sub = ""
		"slot_load":
			load_slot(int(h["i"]))


## Left edge / right edge of the 3D view: a click there turns (the cursor shows it).
func turn_edge(p: Vector2) -> int:
	if screen != "game" or overlay != "" or g == null or g.s["mode"] in ["dead", "won"]:
		return 0
	if p.y < 0 or p.y > 272:
		return 0
	if p.x >= 0 and p.x < TURN_EDGE:
		return -1
	if p.x > 448 - TURN_EDGE and p.x < 448:
		return 1
	return 0


## Right-click in the view moves by zone, as in the original (CLK_MAP.C:155):
## top row turn left / forward / turn right, bottom row strafe left / back / strafe right.
static func zone_move(p: Vector2) -> int:
	var col = clampi(int(p.x / (448.0 / 3.0)), 0, 2)
	var top = p.y < 272.0 * 0.5   # the original splits at half height (yr>180 of 360)
	if top:
		return [9, 0, 11][col]
	return [3, 2, 1][col]


func _view_click(p: Vector2, right: bool) -> void:
	if g.s["mode"] in ["dead", "won"]:
		return
	if right:
		queued_move = zone_move(p)
		return
	var edge = turn_edge(p)
	if edge != 0:
		queued_move = 10 + edge
		return
	var t: Dictionary = dungeon.pick(p)
	var kind = String(t.get("kind", ""))
	if g.s["mode"] == "battle":
		if g.s["held"] != null and not right:
			plan({"act": "throw"})
		return
	match kind:
		"pile", "floor":
			var cell = int(t["cell"])
			var corner = int(t["corner"])
			if _reachable(cell, corner):
				if g.s["held"] != null:
					g.drop(cell, corner)
				else:
					g.pick(cell, corner)
		"niche":
			if int(t["face"]) == g.cur_cell() * 4 + int(g.s["dir"]):
				g.touch_face(int(t["face"]))
		"face":
			g.touch_face(int(t["face"]))
		"mob":
			var m = g.monster_by_uid(int(t["uid"]))
			if m != null and g.mtemplate(m).has("dialog") and int(m["cell"]) == g.front_cell():
				g.talk_front()
			elif m != null:
				g.msg("%s." % g.mname_cap(m))


func _reachable(cell: int, corner: int) -> bool:
	for rp in g.reachable_piles():
		if int(rp[0]) == cell and int(rp[1]) == corner:
			return true
	return false


func _choose_spell(id: String) -> void:
	var sp: Dictionary = g.magic.spell(id)
	if String(sp["target"]) in ["ally", "dead"]:
		cast_pending = id
		return
	if g.s["mode"] == "battle":
		plan({"act": "cast", "spell": id})
		overlay = ""
	else:
		g.magic.cast(sel, id, -1)
		overlay = ""


func _finish_cast(target: int) -> void:
	var id = cast_pending
	cast_pending = ""
	overlay = ""
	if g.s["mode"] == "battle":
		plan({"act": "cast", "spell": id, "target": target})
	else:
		g.magic.cast(sel, id, target)


func _update_hover() -> void:
	hover_text = ""
	if screen != "game" or overlay != "":
		return
	var p = ui.get_global_mouse_position()
	if not Rect2(0, 0, 448, 272).has_point(p):
		return
	var t: Dictionary = dungeon.pick(p)
	match String(t.get("kind", "")):
		"pile":
			var pile: Array = g.pile(int(t["cell"]), int(t["corner"]))
			if not pile.is_empty():
				hover_text = g.item_name(pile[pile.size() - 1])
				if not _reachable(int(t["cell"]), int(t["corner"])):
					hover_text += " (too far)"
		"mob":
			var m = g.monster_by_uid(int(t["uid"]))
			if m != null:
				hover_text = String(g.mtemplate(m)["name"])
				if int(g.s["omen"]) > 0 or g.s["mode"] == "battle":
					hover_text += "  %d/%d" % [int(m["hp"]), int(g.mtemplate(m)["hp"])]


# ------------------------------------------------------------------ book

## Book pages as lists of [text, colour] lines (21 lines per page, 34 chars wide).
func book_pages() -> Array:
	var pages = []
	var cur = []
	for entry in g.s["book"]:
		var b: Dictionary = content["book"][entry]
		var lines = [[String(b["title"]), 27]]
		for ln in ui.font.wrap(String(b["text"]), 200):
			lines.append([ln, 9])
		lines.append(["", 9])
		for ln in lines:
			cur.append(ln)
			if cur.size() >= 21:
				pages.append(cur)
				cur = []
	if not cur.is_empty():
		pages.append(cur)
	if pages.is_empty():
		pages.append([["The book is empty.", 11]])
	return pages


# ------------------------------------------------------------------ automation (screenshots)

func _automation() -> void:
	if not script_cmds.is_empty() and frames % 6 == 0 and (dungeon == null or not dungeon.busy()):
		var cmd: String = script_cmds.pop_front()
		_run_cmd(cmd)
	if shot != "" and script_cmds.is_empty() and frames >= maxi(shot_frame, 10):
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()


func _run_cmd(cmd: String) -> void:
	var parts = cmd.split(":")
	match parts[0]:
		"new": new_game()
		"seed":
			g = Game.new(content)
			g.new_game(int(parts[1]))
			_begin()
		"fw": _do_move(0)
		"back": _do_move(2)
		"left": _do_move(9)
		"right": _do_move(11)
		"touch": g.touch()
		"ov": overlay = parts[1]
		"sel": sel = int(parts[1])
		"wait": pass
		"tick":
			for i in int(parts[1]):
				g.tick()
		"at":
			g.s["x"] = int(parts[1])
			g.s["y"] = int(parts[2])
			g.s["dir"] = int(parts[3])
			g.update_seen()
			dungeon.snap_camera()
		"level":
			g.enter_level(parts[1], parts[2], int(parts[3]))
			process_events()
			dungeon.build()
		"mouse":
			Input.warp_mouse(Vector2(float(parts[1]), float(parts[2])) * 2.0)
		"give":
			g.s["held"] = {"id": parts[1]}
		"runes":
			for r in ["ember", "rime", "spark", "mend", "return", "sight"]:
				if not r in g.s["runes"]:
					g.s["runes"].append(r)
		"join": g.join(parts[1])
		"flag": g.s["flags"][parts[1]] = true
		"dialog":
			g.start_dialog(parts[1])
			process_events()
		"shop":
			g.open_shop(parts[1])
			process_events()
		"book":
			for b in parts.slice(1):
				g.add_book(b)
			overlay = "book"
		"create": open_create()
		"pearl":
			set_pearl(DISC_CENTER + Vector2(cos(deg_to_rad(float(parts[1]))), -sin(deg_to_rad(float(parts[1])))) * float(parts[2]))
		"cface": create_action({"kind": "c_face", "face": parts[1]})
		"croll": create_action({"kind": "c_roll"})
		"caccept": create_action({"kind": "c_accept"})
		"cadd": create_action({"kind": "c_add"})
		"cbegin": begin_created()
		"click":
			_click_at(Vector2(float(parts[1]), float(parts[2])), false)
		"rclick":
			_click_at(Vector2(float(parts[1]), float(parts[2])), true)
		"dump":
			var packs = []
			for ch in g.s["party"]:
				packs.append(ch["pack"].filter(func(x): return x != null).size())
			var held = "none" if g.s["held"] == null else String(g.s["held"]["id"])
			print("DUMP pos=", g.s["x"], ",", g.s["y"], " dir=", g.s["dir"], " level=", g.s["level"], " seen=", g.ls["seen"].size(),
				" overlay=", "none" if overlay == "" else overlay, " held=", held, " packs=", ",".join(packs.map(func(n): return str(n))), " gold=", g.s["gold"])
		"save": save_slot(int(parts[1]))
		"menusub":
			overlay = "menu"
			menu_sub = parts[1]
		"legacysave":
			# a save written by the first release: long label, as players have on disk
			DirAccess.make_dir_recursive_absolute(SAVE_DIR)
			var f = FileAccess.open(SAVE_DIR + "slot%d.sav" % int(parts[1]), FileAccess.WRITE)
			f.store_string(var_to_str({"label": "The Cellar Vaults, 2026-09-26 13:22:24", "state": g.to_save()}))
			f.close()
			_labels.erase(int(parts[1]))
		_:
			# a typo in a test script must fail the test, not silently do nothing
			print("HARNESS unknown command: ", cmd)
