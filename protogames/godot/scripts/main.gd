# The House on Crowmere Hill -- Godot 4.7 presentation layer.
#
# A port of web/src/{main,world,ui}.js on top of the shared GDScript core
# (scripts/core.gd). Everything draws at 320x200; project stretch mode
# "viewport" scales it to the 4:3 window. Content comes from res://content,
# loaded as raw bytes (the folder carries .gdignore, so no import step).
extends Node2D

const Core = preload("res://scripts/core.gd")
const PIC_Y := 10
const PIC_W := 320
const PIC_H := 168
const SCREEN_W := 320
const INPUT_Y := 184
const TICK := 0.04
const SPEED_X := 2
const SPEED_Y := 1
const BOX_CHARS := 36
const PAGE_LINES := 13
const HISTORY_MAX := 100
const SAVE_PATH := "user://crowmere-hill-save.json"
const EGA := [
	Color8(0, 0, 0), Color8(0, 0, 170), Color8(0, 170, 0), Color8(0, 170, 170), Color8(170, 0, 0), Color8(170, 0, 170),
	Color8(170, 85, 0), Color8(170, 170, 170), Color8(85, 85, 85), Color8(85, 85, 255), Color8(85, 255, 85),
	Color8(85, 255, 255), Color8(255, 85, 85), Color8(255, 85, 255), Color8(255, 255, 85), Color8(255, 255, 255),
]

var core
var game: Dictionary
var room_data := {}
var rooms := {}
var sprites := {}
var font_tex: Texture2D
var font_meta: Dictionary
var sfx := {}
var players: Array = []
var sound_on := true

var state: Dictionary = {}
var mode := "title"
var history: Array = []
var pending_death := false
var pending_win := false
var end_t := 0.0
var queue: Array = []
var dialog = null
var input_text := ""

var room: Dictionary = {}
var path: Array = []
var on_arrive = null
var moving := false
var step := 0
var last_zone = null
var last_trigger = null
var zone_mask := PackedInt32Array()
var zone_ids: Array = []
var trail: Array = []
var dog = null
var astar: AStarGrid2D
var fx := {"rain": [], "flash": 0, "next_flash": 120, "thunder_at": -1, "crow_fly": -1, "crow_was_gone": false}
var acc := 0.0
var now_ms := 0.0

var world_canvas: Node2D
# Per-frame textures (depth-masked sprite frames) must outlive the draw call: the
# canvas keeps only the texture's RID, so a freed local ImageTexture renders white.
var frame_textures: Array = []
var lightning_rect: ColorRect
var dark_rect: ColorRect
var ui_canvas: Node2D


func _ready() -> void:
	randomize()
	_load_content()
	core = Core.new(game, room_data)
	world_canvas = Node2D.new()
	add_child(world_canvas)
	world_canvas.draw.connect(_draw_world)
	lightning_rect = _shader_rect("res://shaders/lightning.gdshader")
	dark_rect = _shader_rect("res://shaders/darkness.gdshader")
	ui_canvas = Node2D.new()
	add_child(ui_canvas)
	ui_canvas.draw.connect(_draw_ui)
	for i in range(6):
		var p := AudioStreamPlayer.new()
		p.volume_db = -9.0
		add_child(p)
		players.append(p)
	for i in range(70):
		fx["rain"].append({"x": randf() * 360.0, "y": randf() * PIC_H, "v": 4.0 + randf() * 3.0})
	# Automated checks: `-- --demo-room=hall --screenshot=C:/x.png` starts a game,
	# drops Gus in a room, renders ~1.5 s of frames, saves one and quits.
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--demo-room="):
			new_game(false)
			queue.clear()
			state["room"] = a.substr(12)
			state["visited"][state["room"]] = true
			for f in ["door_slammed", "candle_lit"]:
				state["flags"][f] = true
			state["loc"]["candle"] = "inv"
			var p = core.point(state["room"], "from_hall") if state["room"] != "gate" else core.point("gate", "doormat")
			if state["room"] == "hall":
				p = core.point("hall", "armor")
			if state["room"] == "cellar":
				p = core.point("cellar", "crates")
			if p != null:
				state["pos"] = {"x": float(p[0]), "y": float(p[1])}
			enter_room()
		elif a.begins_with("--screenshot="):
			screenshot_path = a.substr(13)


var screenshot_path := ""


func _take_screenshot_if_due() -> void:
	if screenshot_path == "" or now_ms < 1500.0:
		return
	var img := get_viewport().get_texture().get_image()
	img.save_png(screenshot_path)
	print("screenshot ", screenshot_path, " ", img.get_size())
	screenshot_path = ""
	get_tree().quit()


func _shader_rect(shader_path: String) -> ColorRect:
	var r := ColorRect.new()
	r.position = Vector2(0, PIC_Y)
	r.size = Vector2(PIC_W, PIC_H)
	r.color = Color(0, 0, 0, 0)
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = load(shader_path)
	r.material = m
	add_child(r)
	return r


# ------------------------------------------------------------------ content

func _bytes(rel: String) -> PackedByteArray:
	return FileAccess.get_file_as_bytes("res://content/" + rel)


func _json(rel: String, optional := false):
	var p := "res://content/" + rel
	if not FileAccess.file_exists(p):
		if optional:
			return null
		push_error("missing " + p)
	return JSON.parse_string(FileAccess.get_file_as_string(p))


func _image(rel: String) -> Image:
	var b := _bytes(rel)
	if b.is_empty():
		return null
	var img := Image.new()
	img.load_png_from_buffer(b)
	img.convert(Image.FORMAT_RGBA8)
	return img


func _load_content() -> void:
	game = _json("game.json")
	font_meta = _json("font/font.json")
	font_tex = ImageTexture.create_from_image(_image("font/font.png"))
	var anims: Dictionary = _json("sprites/anims.json")
	for name in anims:
		var img := _image("sprites/%s.png" % name)
		var side: Dictionary = _json("sprites/%s.json" % name)
		var frames = side["frames"]
		var list: Array = frames if typeof(frames) == TYPE_ARRAY else frames.values()
		var rects: Array = []
		for f in list:
			var fr: Dictionary = f["frame"]
			rects.append(Rect2i(int(fr["x"]), int(fr["y"]), int(fr["w"]), int(fr["h"])))
		var a: Dictionary = anims[name]
		sprites[name] = {"img": img, "rects": rects, "anchor": Vector2i(int(a["anchor"][0]), int(a["anchor"][1])),
			"frames": a["frames"], "anims": a.get("anims", {})}
	for id in game["rooms"]:
		var r = _json("rooms/%s/room.json" % id, true)
		room_data[id] = r
		var entry := {"id": id, "data": r, "bg": null}
		if r != null and not r.get("provisional", false):
			entry["bg"] = ImageTexture.create_from_image(_image("rooms/%s/%s" % [id, r["bg"]]))
			var dimg := _image("rooms/%s/%s" % [id, r["depth"]])
			var n := PIC_W * PIC_H
			var scene := PackedByteArray()
			var flo := PackedByteArray()
			scene.resize(n)
			flo.resize(n)
			var raw := dimg.get_data()
			for i in range(n):
				scene[i] = raw[i * 4]
				flo[i] = raw[i * 4 + 1]
			entry["scene_depth"] = scene
			entry["floor_depth"] = flo
			entry["depth_tex"] = ImageTexture.create_from_image(dimg)
			var ovs := {}
			for oid in r.get("overlays", {}):
				var o: Dictionary = r["overlays"][oid]
				var e := o.duplicate()
				if o.has("img"):
					e["tex"] = ImageTexture.create_from_image(_image("rooms/%s/%s" % [id, o["img"]]))
				ovs[oid] = e
			entry["overlays"] = ovs
		rooms[id] = entry
	var idx = _json("sfx/sfx.json", true)
	if idx != null:
		for name in idx:
			var s := _wav("sfx/" + idx[name])
			if s != null:
				sfx[name] = s


func _wav(rel: String) -> AudioStreamWAV:
	var b := _bytes(rel)
	var pos := 12
	var rate := 22050
	while pos + 8 <= b.size():
		var cid := b.slice(pos, pos + 4).get_string_from_ascii()
		var size := b.decode_u32(pos + 4)
		if cid == "fmt ":
			rate = b.decode_u32(pos + 12)
		elif cid == "data":
			var s := AudioStreamWAV.new()
			s.format = AudioStreamWAV.FORMAT_16_BITS
			s.mix_rate = rate
			s.stereo = false
			s.data = b.slice(pos + 8, pos + 8 + size)
			return s
		pos += 8 + size + (size & 1)
	return null


func play(name: String) -> void:
	if not sound_on or not sfx.has(name):
		return
	for p in players:
		if not p.playing:
			p.stream = sfx[name]
			p.play()
			return


# ------------------------------------------------------------------ flow

func new_game(with_intro := true) -> void:
	state = core.new_state()
	enter_room()
	dog = null
	history.clear()
	pending_death = false
	pending_win = false
	queue.clear()
	dialog = null
	input_text = ""
	mode = "play"
	if with_intro:
		for t in game["intro"]:
			say(t)
	process_events(core.start(state))


func remember(reason: String) -> void:
	history.append({"snap": core.snapshot(state), "reason": reason, "room": state["room"], "turn": state["turns"]})
	if history.size() > HISTORY_MAX:
		history.pop_front()


func submit() -> void:
	var text := input_text.strip_edges()
	input_text = ""
	if text == "" or mode != "play":
		return
	remember("command")
	process_events(core.command(state, text))


func process_events(events: Array) -> void:
	for e in events:
		match e["t"]:
			"say":
				say(e["text"])
			"score":
				play("score")
			"sound":
				play(e["name"])
			"room":
				enter_room()
				remember("room")
			"die":
				say(e["text"])
				pending_death = true
				play("death")
			"win":
				pending_win = true
				play("win")
			"meta":
				meta(e["what"])
			"walkto":
				walk_event(e)


func walk_event(e: Dictionary) -> void:
	var start_room = state["room"]
	if e.has("exit"):
		var exit_id: String = e["exit"]
		var x: Dictionary = game["rooms"][state["room"]]["exits"][exit_id]
		var z = core.zone(state["room"], x["zone"])
		if z == null:
			return
		last_trigger = null
		walk_to(float(z["target"][0]), float(z["target"][1]), func():
			if state["room"] == start_room and last_trigger != exit_id:
				return core.enter_zone(state, exit_id)["events"]
			return [], exit_id)
	elif e.has("point"):
		var p = core.point(state["room"], e["point"])
		if p != null:
			walk_to(float(p[0]), float(p[1]))


func meta(what: String) -> void:
	match what:
		"save":
			save_game()
		"restore":
			restore_game()
		"restart":
			confirm("Restart the game from the beginning?", func(): new_game(false))
		"quit":
			confirm("Quit to the title screen?", func(): mode = "title")


func confirm(question: String, yes: Callable) -> void:
	dialog = {"title": null, "lines": [question, "", "  Y - yes      N - no"], "keys": {"y": yes, "n": func(): pass, "escape": func(): pass}}


func save_game() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		say("Sorry, the game could not be saved.")
		return
	f.store_string(JSON.stringify({"v": 1, "state": core.snapshot(state)}))
	say("Game saved.")


func has_save() -> bool:
	return FileAccess.file_exists(SAVE_PATH)


func restore_game() -> bool:
	if not has_save():
		say("There is no saved game to restore.")
		return false
	var data = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if data == null:
		say("The saved game could not be read.")
		return false
	state = core.restore(data["state"])
	enter_room()
	dog = null
	pending_death = false
	pending_win = false
	queue.clear()
	dialog = null
	mode = "play"
	say("Game restored.")
	return true


# Mirror of web/src/death.js -- keep the two in step when the policy changes.
func death_options(_hist: Array, _has_save: bool) -> Dictionary:
	# TODO(you): mirror the policy chosen in web/src/death.js
	return {"rewind_to": null}


func open_death_dialog() -> void:
	pending_death = false
	var saved := has_save()
	var opts := death_options(history, saved)
	var lines: Array = [""]
	var keys := {"s": func(): new_game(false)}
	if saved:
		lines.append("R - restore your saved game")
		keys["r"] = func():
			if not restore_game():
				open_death_dialog()
	lines.append("S - start over")
	var i = opts.get("rewind_to")
	if typeof(i) == TYPE_INT and i >= 0 and i < history.size():
		lines.append("U - undo, and try something else")
		keys["u"] = func():
			state = core.restore(history[i]["snap"])
			history = history.slice(0, i)
			enter_room()
			say("Let's pretend that never happened.")
	dialog = {"title": "You have died.", "lines": lines, "keys": keys}


# ------------------------------------------------------------------ text UI

func wrap_text(text: String, max_chars: int) -> Array:
	var lines: Array = []
	var line := ""
	for w in text.split(" "):
		if line == "":
			line = w
		elif line.length() + 1 + w.length() <= max_chars:
			line += " " + w
		else:
			lines.append(line)
			line = w
	if line != "":
		lines.append(line)
	return lines


func say(text: String) -> void:
	var lines: Array = []
	for para in text.split("\n"):
		lines.append_array(wrap_text(para, BOX_CHARS))
	var i := 0
	while i < lines.size():
		queue.append({"lines": lines.slice(i, i + PAGE_LINES)})
		i += PAGE_LINES


func modal() -> bool:
	return queue.size() > 0 or dialog != null


# ------------------------------------------------------------------ room runtime

func enter_room() -> void:
	room = rooms[state["room"]]
	path.clear()
	on_arrive = null
	moving = false
	last_zone = core.zone_at(state, float(state["pos"]["x"]), float(state["pos"]["y"]))
	trail.clear()
	fx["crow_was_gone"] = bool(state["flags"].get("crow_gone", false))
	fx["crow_fly"] = -1
	if state["flags"].get("crumpet_follows", false):
		dog = {"x": float(state["pos"]["x"]) - 10.0, "y": float(state["pos"]["y"]), "face": "right", "moving": false}
	# exit-zone mask: auto-walk never wanders through an exit it was not sent to
	zone_mask = PackedInt32Array()
	zone_mask.resize(PIC_W * PIC_H)
	zone_mask.fill(-1)
	zone_ids = Array(game["rooms"][state["room"]].get("exits", {}).keys())
	for k in range(zone_ids.size()):
		var x: Dictionary = game["rooms"][state["room"]]["exits"][zone_ids[k]]
		var z = core.zone(state["room"], x["zone"])
		if z == null:
			continue
		var xs: Array = []
		var ys: Array = []
		for p in z["poly"]:
			xs.append(float(p[0]))
			ys.append(float(p[1]))
		for y in range(maxi(0, int(ys.min())), mini(PIC_H, int(ys.max()) + 1)):
			for xx in range(maxi(0, int(xs.min())), mini(PIC_W, int(xs.max()) + 1)):
				if zone_mask[y * PIC_W + xx] < 0 and core.point_in_poly(z["poly"], xx, y):
					zone_mask[y * PIC_W + xx] = k
	astar = AStarGrid2D.new()
	astar.region = Rect2i(0, 0, PIC_W, PIC_H)
	astar.cell_size = Vector2(1, 1)
	astar.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_ONLY_IF_NO_OBSTACLES
	astar.update()
	astar.fill_solid_region(astar.region, true)
	var r = room.get("data")
	if r != null:
		var rows: Array = r["walk"]["rows"]
		for y in range(rows.size()):
			var runs: Array = rows[y]
			var i := 0
			while i < runs.size():
				astar.fill_solid_region(Rect2i(int(runs[i]), y, int(runs[i + 1]), 1), false)
				i += 2
	for idx in range(zone_mask.size()):
		if zone_mask[idx] >= 0:
			astar.set_point_solid(Vector2i(idx % PIC_W, idx / PIC_W), true)


func walkable(x: float, y: float) -> bool:
	return core.walkable(state["room"], x, y)


func passable(x: int, y: int, allow_exit) -> bool:
	if not walkable(x, y):
		return false
	var k := zone_mask[y * PIC_W + x] if x >= 0 and y >= 0 and x < PIC_W and y < PIC_H else -1
	return k < 0 or zone_ids[k] == allow_exit


func exit_at(x: int, y: int):
	if x < 0 or y < 0 or x >= PIC_W or y >= PIC_H:
		return null
	var k := zone_mask[y * PIC_W + x]
	return zone_ids[k] if k >= 0 else null


func move(dx: int, dy: int) -> Dictionary:
	var p: Dictionary = state["pos"]
	var nx := float(p["x"]) + dx
	var ny := float(p["y"]) + dy
	if not walkable(nx, ny):
		if dx != 0 and walkable(float(p["x"]) + dx, float(p["y"])):
			ny = float(p["y"])
		elif dy != 0 and walkable(float(p["x"]), float(p["y"]) + dy):
			nx = float(p["x"])
		else:
			moving = false
			return {"blocked": true, "events": []}
	var prev := {"x": float(p["x"]), "y": float(p["y"])}
	p["x"] = nx
	p["y"] = ny
	var mx: float = nx - prev["x"]
	var my: float = ny - prev["y"]
	if absf(mx) >= absf(my) * 2.0 and mx != 0.0:
		state["face"] = "right" if mx > 0 else "left"
	elif my != 0.0:
		state["face"] = "down" if my > 0 else "up"
	moving = true
	step += 1
	trail.append({"x": nx, "y": ny})
	if trail.size() > 64:
		trail.pop_front()
	var z = core.zone_at(state, nx, ny)
	if z != last_zone:
		last_zone = z
		if z != null:
			last_trigger = z
			var res: Dictionary = core.enter_zone(state, z)
			if res["blocked"]:
				p["x"] = prev["x"]
				p["y"] = prev["y"]
				last_zone = null
				path.clear()
				on_arrive = null
				moving = false
			return {"blocked": res["blocked"], "events": res["events"]}
	return {"blocked": false, "events": []}


func tick() -> void:
	if mode != "play":
		tick_fx()
		return
	if modal():
		moving = false
		tick_fx()
	else:
		var dx := 0
		var dy := 0
		if Input.is_key_pressed(KEY_LEFT):
			dx -= SPEED_X
		if Input.is_key_pressed(KEY_RIGHT):
			dx += SPEED_X
		if Input.is_key_pressed(KEY_UP):
			dy -= SPEED_Y
		if Input.is_key_pressed(KEY_DOWN):
			dy += SPEED_Y
		var events: Array = []
		var room_before = state["room"]
		if dx != 0 or dy != 0:
			path.clear()
			on_arrive = null
			events = move(dx, dy)["events"]
		elif path.size() > 0:
			var w: Vector2i = path[0]
			var sx := clampi(w.x - int(state["pos"]["x"]), -SPEED_X, SPEED_X)
			var sy := clampi(w.y - int(state["pos"]["y"]), -SPEED_Y, SPEED_Y)
			var r := move(sx, sy)
			events = r["events"]
			if r["blocked"] and events.is_empty():
				path.clear()
				events = _arrive()
			elif state["room"] == room_before and path.size() > 0 and int(state["pos"]["x"]) == w.x and int(state["pos"]["y"]) == w.y:
				path.pop_front()
				if path.is_empty():
					events.append_array(_arrive())
		else:
			moving = false
		tick_dog()
		tick_fx()
		if events.size() > 0:
			process_events(events)
	if not modal() and pending_death:
		open_death_dialog()
	if not modal() and pending_win:
		pending_win = false
		mode = "ending"
		end_t = now_ms


func _arrive() -> Array:
	var cb = on_arrive
	on_arrive = null
	if cb == null:
		return []
	var out = cb.call()
	return out if out != null else []


func tick_dog() -> void:
	if not state["flags"].get("crumpet_follows", false):
		return
	if dog == null:
		var hide = core.point("cellar", "crates")
		dog = {"x": float(hide[0]) if hide != null else float(state["pos"]["x"]), "y": float(hide[1]) if hide != null else float(state["pos"]["y"]), "face": "right", "moving": false}
	if trail.size() > 12:
		var t: Dictionary = trail[trail.size() - 12]
		var dx := clampf(t["x"] - dog["x"], -3.0, 3.0)
		var dy := clampf(t["y"] - dog["y"], -2.0, 2.0)
		dog["moving"] = dx != 0.0 or dy != 0.0
		if dx != 0.0:
			dog["face"] = "right" if dx > 0 else "left"
		dog["x"] += dx
		dog["y"] += dy
	else:
		dog["moving"] = false


func tick_fx() -> void:
	for d in fx["rain"]:
		d["y"] += d["v"]
		d["x"] -= 1.0
		if d["y"] > PIC_H:
			d["y"] = -4.0
			d["x"] = randf() * 360.0
	if fx["flash"] > 0:
		fx["flash"] -= 1
	fx["next_flash"] -= 1
	if fx["next_flash"] <= 0:
		fx["flash"] = 5
		fx["next_flash"] = 150 + randi() % 250
		fx["thunder_at"] = 8 + randi() % 10
	if fx["thunder_at"] > 0:
		fx["thunder_at"] -= 1
		if fx["thunder_at"] == 0:
			fx["thunder_at"] = -1
			if mode != "play" or state["room"] == "gate":
				play("thunder")
	if mode == "play":
		if state["flags"].get("crow_gone", false) and not fx["crow_was_gone"]:
			fx["crow_was_gone"] = true
			fx["crow_fly"] = 0
		if fx["crow_fly"] >= 0:
			fx["crow_fly"] += 1
			if fx["crow_fly"] > 40:
				fx["crow_fly"] = -1


# ---- pathfinding: AStarGrid2D on the walk mask, then walker-consistent smoothing

func nearest_passable(x: int, y: int, allow_exit) -> Vector2i:
	if passable(x, y, allow_exit):
		return Vector2i(x, y)
	for r in range(1, 200):
		var best := Vector2i(-1, -1)
		var bd := INF
		for dy in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dy)) != r:
					continue
				if passable(x + dx, y + dy, allow_exit):
					var d := float(dx * dx + 4 * dy * dy)
					if d < bd:
						bd = d
						best = Vector2i(x + dx, y + dy)
		if best.x >= 0:
			return best
	return Vector2i(-1, -1)


func clear_line(a: Vector2i, b: Vector2i, allow_exit) -> bool:
	var x := a.x
	var y := a.y
	while x != b.x or y != b.y:
		x += clampi(b.x - x, -SPEED_X, SPEED_X)
		y += clampi(b.y - y, -SPEED_Y, SPEED_Y)
		if not passable(x, y, allow_exit):
			return false
	return true


func walk_to(tx: float, ty: float, arrive = null, allow_exit = null) -> void:
	var goal := nearest_passable(int(round(tx)), int(round(ty)), allow_exit)
	var start := Vector2i(int(state["pos"]["x"]), int(state["pos"]["y"]))
	path.clear()
	on_arrive = arrive
	if goal.x < 0:
		process_events(_arrive())
		return
	var opened: Array = []
	if allow_exit != null:
		for idx in range(zone_mask.size()):
			if zone_mask[idx] >= 0 and zone_ids[zone_mask[idx]] == allow_exit and walkable(idx % PIC_W, idx / PIC_W):
				astar.set_point_solid(Vector2i(idx % PIC_W, idx / PIC_W), false)
				opened.append(idx)
	var was_solid := astar.is_point_solid(start)
	astar.set_point_solid(start, false)
	var raw: Array = astar.get_id_path(start, goal, true)
	astar.set_point_solid(start, was_solid)
	for idx in opened:
		astar.set_point_solid(Vector2i(idx % PIC_W, idx / PIC_W), true)
	var pts: Array = raw.slice(1)
	if pts.size() >= 3:
		var out: Array = []
		var from := start
		var i := 0
		while i < pts.size():
			var j := pts.size() - 1
			while j > i and not clear_line(from, pts[j], allow_exit):
				j -= 1
			out.append(pts[j])
			from = pts[j]
			i = j + 1
		pts = out
	path = pts
	if path.is_empty():
		process_events(_arrive())


# ------------------------------------------------------------------ frame loop

func _process(delta: float) -> void:
	now_ms += delta * 1000.0
	acc += minf(delta, 0.25)
	while acc >= TICK:
		tick()
		acc -= TICK
	var dark: bool = mode == "play" and bool(game["rooms"][state["room"]].get("dark", false))
	var lit: bool = mode == "play" and bool(state["flags"].get("candle_lit", false)) and state["loc"].get("candle") == "inv"
	var dm: ShaderMaterial = dark_rect.material
	dm.set_shader_parameter("enabled", dark)
	if dark:
		var jit := float(int(now_ms / 90.0) * 7919 % 5) - 2.0 if lit else 0.0
		dm.set_shader_parameter("center", Vector2(float(state["pos"]["x"]), float(state["pos"]["y"]) - 16.0))
		dm.set_shader_parameter("r0", 36.0 + jit if lit else 0.0)
		dm.set_shader_parameter("r1", 66.0 + jit if lit else 1.0)
	var lm: ShaderMaterial = lightning_rect.material
	var gate_shown: bool = mode != "play" or state["room"] == "gate"
	var flashing: bool = gate_shown and fx["flash"] > 0 and fx["flash"] != 3 and rooms["gate"].has("depth_tex")
	lm.set_shader_parameter("enabled", flashing)
	if flashing:
		lm.set_shader_parameter("depth_tex", rooms["gate"]["depth_tex"])
	world_canvas.queue_redraw()
	ui_canvas.queue_redraw()
	_take_screenshot_if_due()


# ------------------------------------------------------------------ drawing

func frame_index(sp: Dictionary, name: String) -> int:
	return sp["frames"].find(name)


# Draw one sprite frame with its feet at picture (x, y). With `depth`, every
# pixel the room's depth map says is nearer than Gus's feet is left out -- the
# same per-pixel test as web/src/world.js drawSprite.
func draw_sprite(sp: Dictionary, fi: int, x: float, y: float, flip: bool, depth) -> void:
	if fi < 0:
		return
	var r: Rect2i = sp["rects"][fi]
	var img := Image.create(r.size.x, r.size.y, false, Image.FORMAT_RGBA8)
	img.blit_rect(sp["img"], r, Vector2i.ZERO)
	if flip:
		img.flip_x()
	var anchor: Vector2i = sp["anchor"]
	var ax: int = r.size.x - anchor.x if flip else anchor.x
	var dx: int = int(round(x)) - ax
	var dy: int = int(round(y)) - anchor.y
	if depth != null and room.has("scene_depth"):
		var sd: PackedByteArray = room["scene_depth"]
		for j in range(r.size.y):
			for i in range(r.size.x):
				var px := dx + i
				var py := dy + j
				if px < 0 or py < 0 or px >= PIC_W or py >= PIC_H:
					continue
				if img.get_pixel(i, j).a < 0.5:
					continue
				if sd[py * PIC_W + px] < int(depth) - 2:
					img.set_pixel(i, j, Color(0, 0, 0, 0))
	var tex := ImageTexture.create_from_image(img)
	frame_textures.append(tex)
	world_canvas.draw_texture(tex, Vector2(dx, dy + PIC_Y))


func feet_depth(x: float, y: float):
	if not room.has("floor_depth"):
		return null
	var i := int(round(y)) * PIC_W + int(round(x))
	if i < 0 or i >= PIC_W * PIC_H:
		return null
	var f: int = room["floor_depth"][i]
	return f if f > 0 else int(room["scene_depth"][i])


func _draw_world() -> void:
	frame_textures.clear()
	if mode == "title" or mode == "ending":
		_draw_backdrop()
		return
	if room.get("bg") == null:
		world_canvas.draw_rect(Rect2(0, PIC_Y, PIC_W, PIC_H), EGA[1])
		return
	world_canvas.draw_texture(room["bg"], Vector2(0, PIC_Y))
	for id in core.overlays(state):
		var o = room["overlays"].get(id)
		if o == null:
			continue
		if o.has("tex"):
			world_canvas.draw_texture(o["tex"], Vector2(o["x"], float(o["y"]) + PIC_Y))
		elif o.has("sprite"):
			var sp: Dictionary = sprites[o["sprite"]]
			var name: String = o["frame"]
			if name == "candle" and state["flags"].get("candle_lit", false):
				name = "candle_lit"
			draw_sprite(sp, frame_index(sp, name), float(o["x"]), float(o["y"]), false, null)
	var mk: Dictionary = room["data"].get("markers", {})
	var actors: Array = []
	var g: Dictionary = sprites["gus"]
	var face: String = state["face"]
	var dir := "side" if face == "left" or face == "right" else face
	var an: Dictionary = g["anims"][dir]
	var gf: int = int(an["walk"][int(step / 3) % an["walk"].size()]) if moving else int(an["stand"])
	var gx := float(state["pos"]["x"])
	var gy := float(state["pos"]["y"])
	actors.append({"y": gy, "fn": func():
		draw_sprite(g, gf, gx, gy, face == "left", feet_depth(gx, gy))
		if state["flags"].get("candle_lit", false) and state["loc"].get("candle") == "inv" and face != "up":
			var it: Dictionary = sprites["items"]
			var fl := frame_index(it, "flame_a" if int(now_ms / 128.0) % 2 == 1 else "flame_b")
			var hx := gx + (6.0 if face == "right" else -6.0)
			draw_sprite(it, fl, hx, gy - 13.0, false, null)})
	if state["room"] == "hall" and mk.has("portrait_eyes"):
		var ex := float(mk["portrait_eyes"][0])
		var fi := 0 if gx < ex - 25 else (2 if gx > ex + 25 else 1)
		actors.append({"y": -1.0, "fn": func(): draw_sprite(sprites["eyes"], fi, ex, float(mk["portrait_eyes"][1]), false, null)})
	if state["room"] == "kitchen" and mk.has("bubbles"):
		actors.append({"y": -1.0, "fn": func(): draw_sprite(sprites["bubbles"], int(now_ms / 260.0) % 3, float(mk["bubbles"][0]), float(mk["bubbles"][1]), false, null)})
	if state["room"] == "bedroom" and mk.has("crow"):
		var c: Dictionary = sprites["crow"]
		if not state["flags"].get("crow_gone", false):
			var seq: Array = c["anims"]["perch"]
			var cf := int(seq[int(now_ms / 400.0) % seq.size()])
			actors.append({"y": -1.0, "fn": func(): draw_sprite(c, cf, float(mk["crow"][0]), float(mk["crow"][1]), false, null)})
		elif fx["crow_fly"] >= 0:
			var t: int = fx["crow_fly"]
			var ff := frame_index(c, "fly_up" if (t >> 2) & 1 == 1 else "fly_down")
			actors.append({"y": -1.0, "fn": func(): draw_sprite(c, ff, float(mk["crow"][0]) + t * 4, float(mk["crow"][1]) - t * 2.5, true, null)})
	if state["room"] == "cellar":
		var d: Dictionary = sprites["crumpet"]
		if not state["flags"].get("crumpet_follows", false) and mk.has("crumpet"):
			var flip := int(now_ms / 1024.0) % 2 == 1
			actors.append({"y": float(mk["crumpet"][1]), "fn": func(): draw_sprite(d, frame_index(d, "peek"), float(mk["crumpet"][0]), float(mk["crumpet"][1]), flip, null)})
		elif dog != null:
			var df: int
			if dog["moving"]:
				df = int(d["anims"]["walk"][(step >> 1) % 2])
			else:
				var idle: Array = d["anims"]["idle"]
				df = int(idle[int(now_ms / 300.0) % idle.size()])
			var ddx: float = dog["x"]
			var ddy: float = dog["y"]
			actors.append({"y": ddy, "fn": func(): draw_sprite(d, df, ddx, ddy, dog["face"] == "left", feet_depth(ddx, ddy))})
	actors.sort_custom(func(p, q): return p["y"] < q["y"])
	for a in actors:
		a["fn"].call()
	if state["room"] == "gate":
		_draw_rain()


func _draw_rain() -> void:
	for d in fx["rain"]:
		for k in range(3):
			var x := int(round(d["x"] - k * 0.3)) - 20
			var y := int(round(d["y"] - k))
			if x >= 0 and x < PIC_W and y >= 0 and y < PIC_H:
				world_canvas.draw_rect(Rect2(x, y + PIC_Y, 1, 1), EGA[9] if k > 0 else EGA[11])


func _draw_backdrop() -> void:
	var gate: Dictionary = rooms["gate"] if rooms["gate"].get("bg") != null else rooms["hall"]
	if gate.get("bg") != null:
		world_canvas.draw_texture(gate["bg"], Vector2(0, PIC_Y))
	_draw_rain()
	var g: Dictionary = sprites["gus"]
	if mode == "title":
		var r: Rect2i = g["rects"][3]
		draw_sprite(g, 3, 160.0, float(PIC_H - 5), false, null)
	else:
		var e := (now_ms - end_t) / 1000.0
		var gx := 60.0 + minf(e * 22.0, 200.0)
		var gi := int(g["anims"]["side"]["walk"][int(now_ms / 120.0) % 4])
		var d: Dictionary = sprites["crumpet"]
		var di := int(d["anims"]["walk"][int(now_ms / 160.0) % 2])
		var saved_room := room
		room = {}
		draw_sprite(g, gi, gx, 150.0, false, null)
		draw_sprite(d, di, gx - 18.0, 150.0, false, null)
		room = saved_room


func text(canvas: Node2D, s: String, x: float, y: float, color: int, scale := 1) -> void:
	var cw := int(font_meta["cell"][0])
	var ch := int(font_meta["cell"][1])
	var first := int(font_meta["first"])
	var cols := int(font_meta["cols"])
	for k in range(s.length()):
		var code := s.unicode_at(k)
		if code < first or code > int(font_meta["last"]):
			code = 63
		var i := code - first
		var src := Rect2((i % cols) * cw, (i / cols) * ch, cw, ch)
		canvas.draw_texture_rect_region(font_tex, Rect2(x + k * cw * scale, y, cw * scale, ch * scale), src, EGA[color])


func _draw_box(lines: Array, title, border := 4) -> void:
	var cw := int(font_meta["cell"][0])
	var ch := int(font_meta["cell"][1])
	var longest := 0
	for l in lines:
		longest = maxi(longest, l.length())
	if title != null:
		longest = maxi(longest, str(title).length())
	var w := longest * cw + 16
	var h := lines.size() * ch + 12 + (ch + 2 if title != null else 0)
	var x := int((SCREEN_W - w) / 2)
	var y := PIC_Y + maxi(2, int((PIC_H - h) / 2))
	ui_canvas.draw_rect(Rect2(x, y, w, h), EGA[0])
	ui_canvas.draw_rect(Rect2(x + 1, y + 1, w - 2, h - 2), EGA[15])
	ui_canvas.draw_rect(Rect2(x + 3, y + 3, w - 6, 1), EGA[border])
	ui_canvas.draw_rect(Rect2(x + 3, y + h - 4, w - 6, 1), EGA[border])
	ui_canvas.draw_rect(Rect2(x + 3, y + 3, 1, h - 6), EGA[border])
	ui_canvas.draw_rect(Rect2(x + w - 4, y + 3, 1, h - 6), EGA[border])
	var ty := y + 7
	if title != null:
		text(ui_canvas, str(title), x + int((w - str(title).length() * cw) / 2), ty, border)
		ty += ch + 2
	for l in lines:
		text(ui_canvas, l, x + 8, ty, 0)
		ty += ch


func _center(s: String, y: float, color: int, scale := 1) -> void:
	text(ui_canvas, s, int((SCREEN_W - s.length() * 6 * scale) / 2), y, color, scale)


func _draw_ui() -> void:
	var blink := int(now_ms / 500.0) % 2 == 0
	if mode == "title":
		ui_canvas.draw_rect(Rect2(0, PIC_Y + 4, SCREEN_W, 58), EGA[0])
		_center("THE HOUSE ON", PIC_Y + 8, 12, 2)
		_center("CROWMERE HILL", PIC_Y + 30, 14, 2)
		_center("A Gus Pickett Misadventure", PIC_Y + 52, 7)
		if blink:
			_center("Press ENTER to begin", 186, 15)
		return
	if mode == "ending":
		ui_canvas.draw_rect(Rect2(40, PIC_Y + 14, 240, 62), EGA[0])
		ui_canvas.draw_rect(Rect2(42, PIC_Y + 16, 236, 58), EGA[15])
		_center("THE END", PIC_Y + 22, 4, 2)
		_center("You scored %d of %d points." % [int(state["score"]), int(game["meta"]["maxScore"])], PIC_Y + 46, 0)
		_center("Thanks for playing!", PIC_Y + 58, 8)
		if blink:
			_center("Press ENTER to play again", 186, 15)
		return
	ui_canvas.draw_rect(Rect2(0, 0, SCREEN_W, PIC_Y), EGA[15])
	text(ui_canvas, " Score: %d of %d" % [int(state["score"]), int(game["meta"]["maxScore"])], 0, 1, 0)
	var snd := "Sound: %s " % ("on" if sound_on else "off")
	text(ui_canvas, snd, SCREEN_W - snd.length() * 6, 1, 0)
	ui_canvas.draw_rect(Rect2(0, PIC_Y + PIC_H, SCREEN_W, 200 - PIC_Y - PIC_H), EGA[0])
	var shown := input_text.right(50) if input_text.length() > 50 else input_text
	text(ui_canvas, ">" + shown + ("_" if not modal() and int(now_ms / 400.0) % 2 == 0 else " "), 2, INPUT_Y, 15)
	if dialog != null:
		_draw_box(dialog["lines"], dialog.get("title"), 4)
	elif queue.size() > 0:
		_draw_box(queue[0]["lines"], null, 4)


# ------------------------------------------------------------------ input

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_click(event.position)
		return
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var k: int = event.keycode
	match k:
		KEY_F2:
			sound_on = not sound_on
			return
		KEY_F5:
			if mode == "play" and dialog == null:
				save_game()
			return
		KEY_F7:
			if mode == "play" and dialog == null:
				restore_game()
			return
		KEY_F9:
			if mode == "play":
				meta("restart")
			return
	if mode == "title":
		if k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_SPACE:
			new_game(true)
		return
	if mode == "ending":
		if k == KEY_ENTER or k == KEY_KP_ENTER:
			mode = "title"
		return
	if k in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
		return
	var ch := String.chr(event.unicode) if event.unicode > 0 and event.unicode < 127 else ""
	if dialog != null:
		var key := "escape" if k == KEY_ESCAPE else ch.to_lower()
		if dialog["keys"].has(key):
			var fn: Callable = dialog["keys"][key]
			dialog = null
			fn.call()
		return
	if queue.size() > 0:
		if ch != "" or k == KEY_ENTER or k == KEY_KP_ENTER or k == KEY_ESCAPE:
			queue.pop_front()
		return
	if k == KEY_ENTER or k == KEY_KP_ENTER:
		submit()
	elif k == KEY_BACKSPACE:
		input_text = input_text.left(input_text.length() - 1)
	elif k == KEY_ESCAPE:
		input_text = ""
	elif ch != "" and input_text.length() < 60:
		input_text += ch


func _click(pos: Vector2) -> void:
	if mode == "title":
		new_game(true)
		return
	if mode == "ending":
		mode = "title"
		return
	if dialog != null:
		return
	if queue.size() > 0:
		queue.pop_front()
		return
	var x := int(pos.x)
	var y := int(pos.y) - PIC_Y
	if y >= 0 and y < PIC_H and x >= 0 and x < PIC_W:
		walk_to(x, y, null, exit_at(x, y))
