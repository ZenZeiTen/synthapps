extends Node2D
## App: screens, input, saves, options and the test harness. The poker rules live in
## scripts/core (pure data); this file only drives them and keeps what the view shows.

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")
const Game = preload("res://scripts/core/game.gd")
const Ai = preload("res://scripts/core/ai.gd")

const ACTIONS := {
	"up": [KEY_UP, KEY_W], "down": [KEY_DOWN, KEY_S], "left": [KEY_LEFT, KEY_A], "right": [KEY_RIGHT, KEY_D],
	"ok": [KEY_Z, KEY_ENTER, KEY_SPACE], "cancel": [KEY_X, KEY_BACKSPACE], "pause": [KEY_ESCAPE, KEY_P],
	"power1": [KEY_1], "power2": [KEY_2], "power3": [KEY_3],
	"fold": [KEY_F], "call": [KEY_C], "raise": [KEY_R],
}
const PADS := {
	"up": JOY_BUTTON_DPAD_UP, "down": JOY_BUTTON_DPAD_DOWN, "left": JOY_BUTTON_DPAD_LEFT,
	"right": JOY_BUTTON_DPAD_RIGHT, "ok": JOY_BUTTON_A, "cancel": JOY_BUTTON_B, "pause": JOY_BUTTON_START,
	"power1": JOY_BUTTON_X, "power2": JOY_BUTTON_Y, "power3": JOY_BUTTON_RIGHT_SHOULDER,
	"fold": JOY_BUTTON_LEFT_SHOULDER,
}
const TIERS := [[0.0, "SHAKY"], [0.4, "EVEN"], [0.55, "SOLID"], [0.7, "STRONG"], [0.85, "MONSTER"]]
const METER_SAMPLES := 480
const SCREEN_LOCK := 12
const PACE := [1.5, 1.0, 0.6]
const PACE_NAME := ["RELAXED", "NORMAL", "FAST"]
const DEAL_TICKS := 18        # a card's slide from the deck
const FLIP_TICKS := 14        # turning it face up
const SEAT := [Vector2(70, 300), Vector2(440, 30)]
const BET_SPOT := [Vector2(186, 186), Vector2(186, 106)]
const POT_SPOT := Vector2(450, 142)

@onready var view: Node2D = $View
@onready var audio: Node = $Audio

var screen := "title"
var tick := 0
var lock := 0                 # ticks during which presses are ignored after a screen change
var cursor := 0
var hot: Array = []           # clickable regions: {"id", "rect"}
var hover := ""
var s: Dictionary = {}        # the run (see core/game.gd)
var opts := {"music": 7, "sfx": 8, "full": false, "pace": 0}
var scores: Array = []
var save_dir := "user://"
var harness := false
var seed_next := 0

# story / dialog pages
var pages: Array = []
var page := 0
var page_t := 0
var page_after := ""
var speaker := ""

# play screen
var wait := 0
var btn := 1                  # 0 fold, 1 call, 2 raise
var raise_i := 0
var msg := ""
var bubble := ""
var bubble_t := 0
var rexpr := "neutral"
var pexpr := "neutral"
var expr_t := 0
var cutin := {}
var pops: Array = []
var reveal := false
var shake := 0
var burst_t := 0
var card_t := {}              # "p0" "r1" "b3" -> tick the card leaves the deck
var fliers: Array = []        # chips in flight: from, to, t, dur, delay, frame
var pot_show := 0.0
var stack_show := [800.0, 800.0]
var result_t := 0
var bubble_age := 0
var last_bets := 0
var meter := {"key": "", "score": 0, "n": 0, "box": {"k": 1}}
var meter_show := 0.0
var rig := ""
var pause_from := ""
var end_cursor := 0
var credits_y := 0.0
var last_rank := -1
var fit_fail: Array = []
var _script: Array = []
var _script_wait := 0
var _busy := false

func _ready() -> void:
	for a in ACTIONS:
		if not InputMap.has_action(a):
			InputMap.add_action(a)
		for k in ACTIONS[a]:
			var e := InputEventKey.new()
			e.keycode = k
			InputMap.action_add_event(a, e)
		if PADS.has(a):
			var j := InputEventJoypadButton.new()
			j.button_index = PADS[a]
			InputMap.action_add_event(a, j)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--script="):
			harness = true
			_script = Array(arg.substr(9).split(",", false))
	if harness:
		save_dir = "user://harness/"
		DirAccess.make_dir_recursive_absolute(save_dir)
		for f in ["run.sav", "options.sav", "scores.sav"]:
			if FileAccess.file_exists(save_dir + f):
				DirAccess.remove_absolute(save_dir + f)
		seed_next = 1234
	_load_files()
	_apply_opts()
	goto("title")

# ---- files --------------------------------------------------------------------

func _read(name: String):
	if not FileAccess.file_exists(save_dir + name):
		return null
	var f := FileAccess.open(save_dir + name, FileAccess.READ)
	return str_to_var(f.get_as_text()) if f else null

func _write(name: String, value) -> void:
	var f := FileAccess.open(save_dir + name, FileAccess.WRITE)
	if f:
		f.store_string(var_to_str(value))

func _load_files() -> void:
	var o = _read("options.sav")
	if o is Dictionary:
		for k in opts:
			if o.has(k) and typeof(o[k]) == typeof(opts[k]):
				opts[k] = o[k]
	var sc = _read("scores.sav")
	if sc is Array:
		scores = sc

func _apply_opts() -> void:
	audio.music_volume = opts["music"]
	audio.sfx_volume = opts["sfx"]
	audio.apply_volume()
	if not harness and DisplayServer.get_name() != "headless":
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if opts["full"]
			else DisplayServer.WINDOW_MODE_WINDOWED)

func has_save() -> bool:
	return FileAccess.file_exists(save_dir + "run.sav")

func save_run() -> void:
	_write("run.sav", s)

func drop_save() -> void:
	if has_save():
		DirAccess.remove_absolute(save_dir + "run.sav")

func record_score(cleared: bool) -> void:
	var entry := {"score": s["score"], "avatar": s["avatar"], "floor": s["match"] + 1, "clear": cleared}
	entry["floor"] = mini(entry["floor"], Data.RIVALS.size())
	scores.append(entry)
	scores.sort_custom(func(a, b): return a["score"] > b["score"])
	last_rank = scores.find(entry)
	if scores.size() > 5:
		scores.resize(5)
	if last_rank >= 5:
		last_rank = -1
	_write("scores.sav", scores)

# ---- screens ------------------------------------------------------------------

func goto(name: String) -> void:
	screen = name
	cursor = 0
	lock = SCREEN_LOCK
	hover = ""
	match name:
		"title":
			audio.music("title")
		"avatar":
			audio.music("title")
		"scores":
			audio.music("ending")
		"credits":
			credits_y = 0.0
			audio.music("ending")

func menu_items() -> Array:
	match screen:
		"title":
			var items := ["NEW GAME"]
			if has_save():
				items.append("CONTINUE")
			return items + ["HIGH SCORES", "OPTIONS", "QUIT"]
		"pause":
			return ["RESUME", "OPTIONS", "QUIT TO TITLE"]
		"options":
			return ["MUSIC  " + str(opts["music"]), "SOUND  " + str(opts["sfx"]),
				"PACE  " + PACE_NAME[opts["pace"]],
				"FULL SCREEN  " + ("ON" if opts["full"] else "OFF"), "BACK"]
		"matchend":
			if not s.is_empty() and s["winner"] == 1:
				return ["CONTINUE (HALF SCORE)", "GIVE UP"]
	return []

func menu_rect(i: int) -> Rect2:
	match screen:
		"title":
			return Rect2(240, 222 + i * 22, 160, 18)
		"matchend":
			return Rect2(200, 250 + i * 24, 240, 20)
	return Rect2(220, 130 + i * 26, 200, 20)

## Story text box: 80 characters a line, 5 lines a page. Longer pages are split so no
## page can run past the bottom of its box.
const PAGE_CHARS := 80
const PAGE_LINES := 5

static func split_pages(list: Array) -> Array:
	var out := []
	for text in list:
		var lines: Array = wrap_lines(text, PAGE_CHARS)
		var i := 0
		while i < lines.size():
			out.append(" ".join(lines.slice(i, i + PAGE_LINES)))
			i += PAGE_LINES
	return out

static func wrap_lines(t: String, chars: int) -> Array:
	var lines := []
	var cur := ""
	for word in t.split(" "):
		if cur == "":
			cur = word
		elif cur.length() + 1 + word.length() <= chars:
			cur += " " + word
		else:
			lines.append(cur)
			cur = word
	if cur != "":
		lines.append(cur)
	return lines

func start_story(list: Array, who: String, after: String) -> void:
	pages = split_pages(list)
	page = 0
	page_t = 0
	speaker = who
	page_after = after
	goto("story")

func new_game(avatar: String) -> void:
	var seed_value := seed_next if seed_next != 0 else int(Time.get_unix_time_from_system()) ^ (Time.get_ticks_usec() << 8)
	s = Game.new_run(seed_value, avatar)
	save_run()
	start_story(Data.STORY_OPEN, "", "versus")

func begin_versus() -> void:
	audio.music("boss" if s["rival"] == "onyx" else "match")
	var c: Dictionary = Data.CAST[s["rival"]]
	start_story(c.get("lore", []) + c["intro"], s["rival"], "play")
	screen = "versus"

## A pause of n ticks at normal pace, stretched or shortened by the PACE option.
func pw(n: int) -> int:
	return int(n * PACE[opts["pace"]])

func fly(from: Vector2, to: Vector2, frame: int, delay: int = 0) -> void:
	fliers.append({"from": from, "to": to, "t": 0, "dur": 20, "delay": delay, "frame": frame})

func begin_play() -> void:
	goto("play")
	wait = pw(40)
	card_t = {}
	fliers = []
	pot_show = 0.0
	stack_show = [float(s["stack"][0]), float(s["stack"][1])]
	last_bets = 0
	msg = ""
	bubble = ""
	reveal = false
	rexpr = "neutral"
	pexpr = "neutral"
	cutin = {}
	pops = []
	btn = 1

func after_story() -> void:
	match page_after:
		"versus":
			begin_versus()
		"play":
			begin_play()
		"boss":
			begin_versus()
		"credits":
			goto("credits")
		"next":
			leave_matchend()

func leave_matchend() -> void:
	Game.next_match(s)
	if s["phase"] == "run_won":
		drop_save()
		audio.music("ending")
		start_story(Data.STORY_END, "", "credits")
		return
	save_run()
	if s["rival"] == "onyx":
		start_story(Data.STORY_BOSS, "", "boss")
	else:
		begin_versus()

# ---- input --------------------------------------------------------------------

func _input(e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		hover = _region_at(e.position)
	elif e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_LEFT:
			var id := _region_at(e.position)
			if lock == 0:
				click(id)
		elif e.button_index == MOUSE_BUTTON_WHEEL_UP:
			press("up")
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			press("down")
	else:
		for a in ACTIONS:
			if e.is_action_pressed(a, a in ["up", "down", "left", "right"]):
				press(a)
				return

func _region_at(p: Vector2) -> String:
	build_regions()
	for i in range(hot.size() - 1, -1, -1):
		if hot[i]["rect"].has_point(p):
			return hot[i]["id"]
	return ""

func build_regions() -> void:
	hot = []
	var items := menu_items()
	for i in items.size():
		hot.append({"id": "menu:%d" % i, "rect": menu_rect(i)})
	match screen:
		"avatar":
			for i in 4:
				hot.append({"id": "avatar:%d" % i, "rect": Rect2(58 + i * 136, 96, 116, 116)})
		"story", "versus", "scores", "credits":
			hot.append({"id": "next", "rect": Rect2(0, 0, 640, 360)})
		"matchend":
			if s["winner"] == 0:
				hot.append({"id": "next", "rect": Rect2(0, 0, 640, 360)})
		"play":
			hot.append({"id": "next", "rect": Rect2(0, 0, 640, 360)})
			hot.append({"id": "btn:0", "rect": Rect2(112, 322, 100, 30)})
			hot.append({"id": "btn:1", "rect": Rect2(218, 322, 130, 30)})
			hot.append({"id": "btn:2", "rect": Rect2(354, 322, 150, 30)})
			hot.append({"id": "less", "rect": Rect2(510, 322, 24, 30)})
			hot.append({"id": "more", "rect": Rect2(538, 322, 24, 30)})
			for i in 3:
				hot.append({"id": "power:%d" % i, "rect": Rect2(532 + i * 35, 204, 32, 32)})
			hot.append({"id": "pause", "rect": Rect2(604, 4, 32, 14)})

func click(id: String) -> void:
	if id == "":
		return
	var parts := id.split(":")
	match parts[0]:
		"menu":
			cursor = int(parts[1])
			press("ok")
		"avatar":
			if cursor == int(parts[1]):
				press("ok")
			else:
				cursor = int(parts[1])
				audio.play("move")
		"btn":
			if my_turn():
				btn = int(parts[1])
				press("ok")
		"less":
			press("down")
		"more":
			press("up")
		"power":
			press("power%d" % (int(parts[1]) + 1))
		"pause":
			press("pause")
		"next":
			press("ok")

func my_turn() -> bool:
	return screen == "play" and not s.is_empty() and s["phase"] == "bet" and s["to_act"] == 0 \
		and wait == 0 and cutin.is_empty()

func press(a: String) -> void:
	if lock > 0:
		return
	var items := menu_items()
	if items.size() > 0:
		_press_menu(a, items)
		return
	match screen:
		"avatar":
			if a == "left" or a == "right":
				cursor = posmod(cursor + (1 if a == "right" else -1), 4)
				audio.play("move")
			elif a == "ok":
				audio.play("ok")
				new_game(Data.AVATARS[cursor])
			elif a == "cancel" or a == "pause":
				audio.play("cancel")
				goto("title")
		"story", "versus":
			if a == "ok" or a == "cancel":
				if page_t < 15:
					return
				var full: int = pages[page].length()
				if page_t < full:
					page_t = full
				else:
					page += 1
					page_t = 0
					audio.play("ok")
					if page >= pages.size():
						after_story()
		"scores":
			if a in ["ok", "cancel", "pause"]:
				audio.play("ok")
				goto("title")
		"credits":
			if a in ["ok", "cancel", "pause"]:
				finish_credits()
		"matchend":
			if a == "ok" and s["winner"] == 0:
				audio.play("ok")
				var line: Array = Data.CAST[s["rival"]]["beaten"]
				start_story(line, s["rival"], "next")
				screen = "versus"
		"play":
			_press_play(a)

func finish_credits() -> void:
	record_score(true)
	goto("scores")

func _press_menu(a: String, items: Array) -> void:
	if a == "up" or a == "down":
		cursor = posmod(cursor + (1 if a == "down" else -1), items.size())
		audio.play("move")
		return
	if screen == "options" and (a == "left" or a == "right"):
		var d := 1 if a == "right" else -1
		if cursor == 0:
			opts["music"] = clampi(opts["music"] + d, 0, 10)
		elif cursor == 1:
			opts["sfx"] = clampi(opts["sfx"] + d, 0, 10)
		elif cursor == 2:
			opts["pace"] = posmod(opts["pace"] + d, 3)
		elif cursor == 3:
			opts["full"] = not opts["full"]
		_apply_opts()
		_write("options.sav", opts)
		audio.play("move")
		return
	if a == "cancel" or a == "pause":
		if screen == "pause":
			audio.play("cancel")
			screen = "play"
			lock = SCREEN_LOCK
		elif screen == "options":
			audio.play("cancel")
			goto(pause_from)
		return
	if a != "ok":
		return
	audio.play("ok")
	var label: String = items[cursor]
	match screen:
		"title":
			if label == "NEW GAME":
				goto("avatar")
			elif label == "CONTINUE":
				var loaded = _read("run.sav")
				if loaded is Dictionary and loaded.has("rival"):
					s = loaded
					Game.start_match(s)
					begin_versus()
			elif label == "HIGH SCORES":
				last_rank = -1
				goto("scores")
			elif label == "OPTIONS":
				pause_from = "title"
				goto("options")
			else:
				if harness:
					print("DUMP quit")
				get_tree().quit()
		"pause":
			if cursor == 0:
				screen = "play"
				lock = SCREEN_LOCK
			elif cursor == 1:
				pause_from = "pause"
				goto("options")
			else:
				goto("title")
		"options":
			if cursor == 2:
				opts["pace"] = posmod(opts["pace"] + 1, 3)
				_write("options.sav", opts)
			elif cursor == 3:
				opts["full"] = not opts["full"]
				_apply_opts()
				_write("options.sav", opts)
			elif cursor == 4:
				goto(pause_from)
		"matchend":
			if cursor == 0:
				Game.continue_run(s)
				save_run()
				begin_versus()
			else:
				record_score(false)
				drop_save()
				goto("scores")

func raise_opts() -> Array:
	return Game.raise_options(s, 0) if not s.is_empty() and s["phase"] == "bet" else []

func _press_play(a: String) -> void:
	if a == "pause":
		audio.play("ok")
		goto("pause")
		return
	if not cutin.is_empty():
		return
	if a.begins_with("power"):
		if my_turn():
			var slot := int(a.substr(5)) - 1
			if Game.use_power(s, 0, slot):
				drain()
			else:
				audio.play("error")
				if slot < s["powers"][0].size():
					msg = "That power cannot be used right now."
		return
	if s["phase"] in ["hand_over", "match_over"]:
		if a == "ok" and wait == 0:
			audio.play("ok")
			if s["phase"] == "match_over":
				audio.music("victory" if s["winner"] == 0 else "defeat")
				end_cursor = 0
				goto("matchend")
			else:
				next_hand()
		return
	if not my_turn():
		if a == "ok" and wait > 12:
			wait = 12
		return
	var ro := raise_opts()
	match a:
		"left":
			btn = posmod(btn - 1, 3)
			audio.play("move")
		"right":
			btn = posmod(btn + 1, 3)
			audio.play("move")
		"up", "down":
			if ro.size() > 0:
				raise_i = clampi(raise_i + (1 if a == "up" else -1), 0, ro.size() - 1)
				btn = 2
				audio.play("roulette_tick")
		"fold":
			btn = 0
			_commit()
		"call":
			btn = 1
			_commit()
		"raise":
			btn = 2
			_commit()
		"ok":
			_commit()
		"cancel":
			btn = 1
			audio.play("move")

func _commit() -> void:
	var ro := raise_opts()
	if btn == 2:
		if ro.is_empty():
			audio.play("error")
			msg = "You cannot raise right now."
			return
		Game.act(s, 0, "raise", ro[clampi(raise_i, 0, ro.size() - 1)])
	elif btn == 0:
		if Game.to_call(s, 0) == 0:
			audio.play("error")
			msg = "Nothing to call. Check instead of folding."
			return
		Game.act(s, 0, "fold")
	else:
		Game.act(s, 0, "call")
	raise_i = 0
	btn = 1
	drain()
	wait = pw(40)

# ---- play flow ----------------------------------------------------------------

func next_hand() -> void:
	Game.start_hand(s)
	if rig != "":
		var win := rig == "win"
		s["hole"] = [Cards.cards("As Ad" if win else "7h 2c"), Cards.cards("7h 2c" if win else "As Ad")]
		s["runout"] = Cards.cards("Ks Qd 9c 4h 3s")
		rig = ""
	reveal = false
	result_t = 0
	card_t = {"p0": tick + 6, "r0": tick + 18, "p1": tick + 30, "r1": tick + 42}
	msg = ""
	raise_i = 0
	btn = 1
	drain()
	last_bets = 0
	fly(SEAT[0], BET_SPOT[0], 2, 50)
	fly(SEAT[1], BET_SPOT[1], 1, 56)
	wait = pw(60) + 50

func say(who_rival_key: String) -> void:
	var lines: Array = Data.CAST[s["rival"]][who_rival_key]
	bubble = lines[tick % lines.size()]
	bubble_t = pw(200)
	bubble_age = 0

func pop(text: String, x: float, y: float, col: Color) -> void:
	pops.append({"text": text, "x": x, "y": y, "t": 110, "col": col})

func set_expr(p: String, r: String) -> void:
	pexpr = p
	rexpr = r
	expr_t = pw(180)

func drain() -> void:
	var rname: String = Data.CAST[s["rival"]]["name"]
	for e in s["events"]:
		match e["t"]:
			"hand":
				pass
			"fever":
				audio.play("fever")
				audio.music("fever")
				pop("FEVER TIME!! x3", 250, 100, Color(1, 0.4, 0.8))
				shake = 20
			"act":
				var who: int = e["who"]
				var name := "You" if who == 0 else rname
				match e["a"]:
					"fold":
						audio.play("fold")
						msg = name + (" fold." if who == 0 else " folds.")
					"check":
						audio.play("check")
						msg = name + (" check." if who == 0 else " checks.")
					"call":
						audio.play("chip_bet")
						fly(SEAT[who], BET_SPOT[who], 2 - who)
						msg = name + (" call." if who == 0 else " calls.")
					"bet", "raise":
						audio.play("chip_bet")
						fly(SEAT[who], BET_SPOT[who], 2 - who)
						fly(SEAT[who], BET_SPOT[who], 3, 5)
						msg = "%s %s to %d." % [name, ("raise" if who == 0 else "raises"), e["amt"]]
					"allin":
						audio.play("allin")
						for k in 5:
							fly(SEAT[who], BET_SPOT[who], k, k * 4)
						msg = name + (" are ALL IN!" if who == 0 else " is ALL IN!")
						shake = 14
						cutin = {"who": who, "text": "ALL IN!!", "t": 100, "len": 100}
						if who == 1:
							say("allin")
			"power":
				audio.play("powerup")
				var who2: int = e["who"]
				cutin = {"who": who2, "text": Data.POWERS[e["id"]]["name"] + "!!", "t": 100, "len": 100}
				msg = ("You use " if who2 == 0 else rname + " uses ") + Data.POWERS[e["id"]]["name"] + ": " \
					+ Data.POWERS[e["id"]]["desc"]
			"street":
				var first: int = 0 if e["n"] == 1 else e["n"] + 1
				for i in range(first, s["board"].size()):
					card_t["b%d" % i] = tick + 8 + (i - first) * 16
			"star":
				audio.play("star")
				pop("STAR +%d" % e["value"], 208 + e["idx"] * 46, 116, Color(1, 0.9, 0.3))
				if e["power"] != "":
					pop("777! NEW POWER", 250, 96, Color(0.5, 1, 1))
			"settle":
				reveal = s["result"]["showdown"]
				var w: int = e["winner"]
				result_t = 0
				if w >= 0:
					for k in 6:
						fly(POT_SPOT, SEAT[w], k % 5, 20 + k * 5)
				if w == 0:
					audio.play("chip_win")
					burst_t = 36
					set_expr("happy", "shock")
					say("lose")
					if s["result"]["points"] > 0:
						pop("+%d PTS" % s["result"]["points"], 260, 180, Color(1, 1, 0.5))
				elif w == 1:
					audio.play("lose_hand")
					set_expr("shock", "happy")
					say("win")
				else:
					audio.play("check")
				if s["phase"] == "match_over":
					set_expr("happy" if s["winner"] == 0 else "defeat", "defeat" if s["winner"] == 0 else "happy")
					expr_t = 100000
				if s["fever"]:
					audio.music("boss" if s["rival"] == "onyx" else "match")
	s["events"] = []

func _tick_play() -> void:
	for key in card_t:
		if card_t[key] == tick:
			audio.play("card_deal")
		elif card_t[key] + DEAL_TICKS == tick and (key.begins_with("b") or key.begins_with("p")):
			audio.play("card_flip")
	for f in fliers:
		if f["delay"] > 0:
			f["delay"] -= 1
		else:
			f["t"] += 1
	fliers = fliers.filter(func(f): return f["t"] < f["dur"])
	var bets_now: int = s["bet"][0] + s["bet"][1]
	if last_bets > 0 and bets_now == 0 and s["phase"] in ["advance", "showdown"]:
		fly(BET_SPOT[0], POT_SPOT, 2)
		fly(BET_SPOT[1], POT_SPOT, 1)
		audio.play("chip_bet")
	last_bets = bets_now
	var pot_target := float(Game.pot(s))
	if s["phase"] in ["hand_over", "match_over"]:
		pot_target = 0.0
		if wait == 0:
			result_t += 1
	pot_show = move_toward(pot_show, pot_target, maxf(1.0, absf(pot_target - pot_show) * 0.12))
	for i in 2:
		var target := float(s["stack"][i])
		stack_show[i] = move_toward(stack_show[i], target, maxf(1.0, absf(target - stack_show[i]) * 0.12))
	bubble_age += 1
	if bubble_t > 0:
		bubble_t -= 1
	if expr_t > 0:
		expr_t -= 1
		if expr_t == 0:
			pexpr = "neutral"
			rexpr = "neutral"
	if shake > 0:
		shake -= 1
	if burst_t > 0:
		burst_t -= 1
	for p in pops:
		p["t"] -= 1
		p["y"] -= 0.3
	pops = pops.filter(func(p): return p["t"] > 0)
	_tick_meter()
	if not cutin.is_empty():
		if cutin["t"] == cutin["len"]:
			audio.play("cutin")
		cutin["t"] -= 1
		if cutin["t"] <= 0:
			cutin = {}
		return
	if wait > 0:
		wait -= 1
		return
	match s["phase"]:
		"pre":
			next_hand()
		"bet":
			if s["to_act"] == 1:
				var d := Ai.think(s, 1)
				if d.has("power"):
					Game.use_power(s, 1, d["power"])
				else:
					Game.act(s, 1, d["a"], d["amt"])
				drain()
				wait = pw(70)
			elif msg == "":
				msg = "Your move."
		"advance":
			Game.advance(s)
			drain()
			wait = pw(60) + (70 if s["street"] == 1 else 38)
		"showdown":
			if s["folded"] < 0 and not reveal:
				reveal = true
				card_t["r0"] = tick - DEAL_TICKS
				card_t["r1"] = tick - DEAL_TICKS + 10
				audio.play("card_flip")
				wait = pw(80)
				return
			Game.settle(s)
			drain()
			wait = pw(50)

func meter_value() -> float:
	return float(meter["score"]) / float(maxi(1, 2 * meter["n"]))

func meter_tier() -> String:
	var v := meter_value()
	var name := "SHAKY"
	for t in TIERS:
		if v >= t[0]:
			name = t[1]
	return name

func _tick_meter() -> void:
	if s.is_empty() or s["hole"][0].is_empty():
		return
	var board := Game.known_board(s, 0)
	var opp := Game.known_opp(s, 0)
	if reveal:
		opp = s["hole"][1]
	var key := str(s["hole"][0]) + str(board) + str(opp)
	if key != meter["key"]:
		meter = {"key": key, "score": 0, "n": 0, "box": {"k": 4242}}
	if meter["n"] < METER_SAMPLES:
		var r := Cards.equity_batch(s["hole"][0], board, opp, [], 60, meter["box"], "k")
		meter["score"] += r[0]
		meter["n"] += r[1]
		if tick % 4 == 0 and screen == "play":
			audio.play("meter_tick")
	meter_show = lerpf(meter_show, meter_value(), 0.07)

# ---- main loop ----------------------------------------------------------------

func _process(_delta: float) -> void:
	var steps := 8 if harness and DisplayServer.get_name() == "headless" else 1
	for _i in steps:
		if harness:
			_run_script()
		_tick()
	view.queue_redraw()

func _tick() -> void:
	tick += 1
	if lock > 0:
		lock -= 1
	match screen:
		"story", "versus":
			page_t += 1
			if page < pages.size() and page_t <= pages[page].length() and page_t % 4 == 0:
				audio.play("type")
		"play":
			_tick_play()
		"credits":
			credits_y += 0.4
			if credits_y > Data.CREDITS.size() * 16 + 380:
				finish_credits()

# ---- harness ------------------------------------------------------------------

func dump() -> String:
	var out := "screen=%s cur=%d" % [screen, cursor]
	if screen in ["story", "versus"]:
		out += " page=%d/%d" % [page, pages.size()]
	if not s.is_empty():
		out += " rival=%s phase=%s hand=%d street=%d to_act=%d pot=%d stack=%d/%d score=%d powers=%d/%d btn=%d" % [
			s["rival"], s["phase"], s["hand_no"], s.get("street", 0), s.get("to_act", 0), Game.pot(s),
			s["stack"][0], s["stack"][1], s["score"], s["powers"][0].size(), s["powers"][1].size(), btn]
		out += " meter=%d fever=%d winner=%d" % [int(round(meter_value() * 100)), int(s["fever"]), s["winner"]]
	var moving := 0
	for key in card_t:
		if tick - card_t[key] < DEAL_TICKS + FLIP_TICKS:
			moving += 1
	out += " moving=%d fliers=%d pace=%s room=%s head=%s" % [moving, fliers.size(), PACE_NAME[opts["pace"]],
		view.room_name(), view.head_text.replace(" ", "_")]
	out += " music=%s sfx=%s save=%d scores=%d opts=%d/%d" % [audio.current, audio.last_sfx, int(has_save()),
		scores.size(), opts["music"], opts["sfx"]]
	return out

func _send(e: InputEvent) -> void:
	Input.parse_input_event(e)
	Input.flush_buffered_events()

func _run_script() -> void:
	if _busy:
		return
	if _script_wait > 0:
		_script_wait -= 1
		return
	while _script.size() > 0 and _script_wait == 0:
		var cmd: String = _script.pop_front()
		var p := cmd.split(":")
		match p[0]:
			"wait":
				_script_wait = int(p[1])
			"tap":
				var e := InputEventAction.new()
				e.action = p[1]
				e.pressed = true
				_send(e)
				var u := InputEventAction.new()
				u.action = p[1]
				u.pressed = false
				_send(u)
				_script_wait = 1
			"key":
				for down in [true, false]:
					var k := InputEventKey.new()
					k.keycode = OS.find_keycode_from_string(p[1])
					k.pressed = down
					_send(k)
				_script_wait = 1
			"pad":
				for down in [true, false]:
					var j := InputEventJoypadButton.new()
					j.button_index = int(p[1])
					j.pressed = down
					_send(j)
				_script_wait = 1
			"click":
				build_regions()
				var id := cmd.substr(6)
				var found := false
				for h in hot:
					if h["id"] == id:
						found = true
						for down in [true, false]:
							var m := InputEventMouseButton.new()
							m.button_index = MOUSE_BUTTON_LEFT
							m.pressed = down
							m.position = h["rect"].get_center()
							m.global_position = m.position
							_send(m)
				if not found:
					print("HARNESS no region ", id)
				_script_wait = 1
			"wheel":
				var m2 := InputEventMouseButton.new()
				m2.button_index = MOUSE_BUTTON_WHEEL_UP if p[1] == "up" else MOUSE_BUTTON_WHEEL_DOWN
				m2.pressed = true
				m2.position = Vector2(400, 330)
				_send(m2)
				_script_wait = 1
			"seed":
				seed_next = int(p[1])
			"rig":
				rig = p[1]
				var total: int = s["stack"][0] + s["stack"][1] + Game.pot(s)
				s["stack"] = [total - 5, 5] if p[1] == "win" else [5, total - 5]
			"floor":
				s["match"] = int(p[1])
				Game.start_match(s)
			"give":
				s["powers"][0] = Array(p[1].split("+"))
			"fever":
				s["fever"] = true
			"score":
				s["score"] = int(p[1])
			"until":
				# until:<mine|over|a screen name>:max-ticks  waits while the game keeps running
				var met := false
				if p[1] == "mine":
					met = my_turn()
				elif p[1] == "over":
					met = screen == "play" and s["phase"] in ["hand_over", "match_over"] and wait == 0
				else:
					met = screen == p[1] and lock == 0
				if not met:
					var left := int(p[2]) - 1
					if left > 0:
						_script.push_front("until:%s:%d" % [p[1], left])
						_script_wait = 1
					else:
						print("HARNESS until timed out ", p[1])
			"dump":
				print("DUMP ", dump())
			"fit":
				_busy = true
				view.queue_redraw()
				await get_tree().process_frame
				await get_tree().process_frame
				print("DUMP fit=", fit_fail.size(), " ", ";".join(fit_fail.slice(0, 5)))
				_busy = false
			"shot":
				_busy = true
				view.queue_redraw()
				await RenderingServer.frame_post_draw
				await RenderingServer.frame_post_draw
				get_viewport().get_texture().get_image().save_png(cmd.substr(5))
				_busy = false
			"quit":
				get_tree().quit()
			_:
				print("HARNESS unknown command ", cmd)
	if _script.is_empty() and _script_wait == 0 and not _busy:
		get_tree().quit()
