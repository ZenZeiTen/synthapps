## Tidebell's rules: one stage in play, stepped at 60 Hz. Pure data; no nodes. Positions and
## speeds are 16.16 fixed point integers, as in the source cartridge (docs/ANALYSIS.md), so
## web/src/core/game.js computes the very same numbers. Keep the two files in step: the
## parity check (tests/parity.sh) runs both on the same inputs and compares state hashes.
##
## Rule IDs (M1, A3, H6, ...) refer to the tables in docs/DESIGN.md.
extends RefCounted

const Level = preload("res://scripts/core/level.gd")
const Kinds = preload("res://scripts/core/kinds.gd")

const FX := 65536
const T := 16

var D: Dictionary = {}           # content/data/defs.json
var P: Dictionary = {}           # D.player
var H: Dictionary = {}           # the chosen hero's row of D.heroes
var stage := ""
var head: Dictionary = {}
var rows: Array = []             # Array[PackedByteArray], one per tile row
var lw := 0                      # width and height in tiles
var lh := 0
var hero := "kess"
var diff := 1
var prog: Dictionary = {}        # lives, maxhp, items, score, done, continues
var p: Dictionary = {}           # the player
var objs: Array = []
var next_id := 1
var tick := 0
var rng := 0x2545F491
var mode := "play"               # play, talk, dead, clear, over, ending
var mode_t := 0
var talk_id := ""                # the talk that opened (mode "talk") or is waiting for the hero to land
var talk_then := ""              # what closing the talk starts
var events: Array = []
var prev := {}
var cam_x := 0
var cam_y := 0
var arena_left := -1             # the arena's left wall in px once it is locked, else -1
var arena_x := -1                # the A marker's column in px
var guardian_id := 0
var check_x := 0
var check_y := 0
var chests: Array = []
var npcs: Array = []


# ------------------------------------------------------------------ setup
func _init(defs: Dictionary = {}) -> void:
	D = defs
	if D.is_empty():
		D = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	P = D["player"]


static func new_progress(defs: Dictionary, difficulty: int) -> Dictionary:
	var items := {}
	for k in defs["items"]:
		items[k] = 0
	return {"lives": int(defs["player"]["lives"]), "maxhp": int(defs["player"]["hp_start"]), "items": items,
		"score": 0, "done": 0, "continues": int(defs["player"]["continues"]), "difficulty": difficulty,
		"sel": "tonic"}


## Starts stage `id` from its level text with the given progress (which it keeps and changes).
func start(id: String, text: String, progress: Dictionary, hero_id: String) -> void:
	stage = id
	prog = progress
	diff = int(prog["difficulty"])
	hero = hero_id
	H = D["heroes"][hero]
	var lv := Level.parse(text)
	head = lv["head"]
	rows = lv["rows"]
	lw = lv["w"]
	lh = lv["h"]
	chests = Level.list(head, "chests")
	npcs = Level.list(head, "npcs")
	objs = []
	next_id = 1
	tick = 0
	rng = 0x2545F491
	mode = "play"
	events = []
	prev = {}
	arena_left = -1
	arena_x = -1
	guardian_id = 0
	var ci := 0
	var ni := 0
	var sx := 2 * T
	var sy := 10 * T
	for m in lv["marks"]:
		var c: String = m[0]
		var x: int = m[1] * T + 8
		var y: int = m[2] * T + T      # feet on the tile's bottom edge
		if c == "S":
			sx = x
			sy = y
		elif c == "P":
			add_obj("post", x, y)
		elif c == "C":
			var o := add_obj("chest", x, y)
			o["holds"] = chests[ci] if ci < chests.size() else "coin"
			ci += 1
		elif c == "N":
			var o := add_obj("captive", x, y)
			o["talk"] = npcs[ni] if ni < npcs.size() else ""
			ni += 1
		elif c == "A":
			arena_x = m[1] * T
		elif c == "G":
			var o := add_obj(head.get("guardian", "vell"), x, y)
			o["asleep"] = 1
			guardian_id = o["id"]
		elif Level.ENEMY_MARKERS.has(c):
			add_obj(Level.ENEMY_MARKERS[c], x, y)
		elif Level.PICKUP_MARKERS.has(c):
			add_obj("pickup", x, y)["what"] = Level.PICKUP_MARKERS[c]
	p = {"x": sx * FX, "y": sy * FX, "vx": 0, "vy": 0, "face": 1, "ground": true, "st": "stand", "t": 0,
		"hp": int(prog["maxhp"]), "shown": int(prog["maxhp"]), "inv": 0, "coyote": 0, "jbuf": 0, "abuf": 0,
		"atk": 0, "alen": 0, "akind": "", "combo": 0, "chain": 0, "hits": [], "drop": 0, "slow": 0,
		"buff": "", "buff_t": 0, "safe_x": sx * FX, "safe_y": sy * FX, "crouch": false}
	check_x = sx * FX
	check_y = sy * FX
	snap_camera()
	emit({"t": "music", "id": head.get("music", stage)})


func add_obj(kind: String, x: int, y: int) -> Dictionary:
	var e: Dictionary = D["enemies"].get(kind, {})
	var o := {"id": next_id, "k": kind, "x": x * FX, "y": y * FX, "vx": 0, "vy": 0, "face": -1, "st": "idle",
		"t": 0, "hp": int(e.get("hp", 1)), "w": int(e.get("w", 16)), "h": int(e.get("h", 16)), "ground": false,
		"active": false, "flash": 0, "dead": false, "hit_by": -1, "ox": x * FX, "oy": y * FX}
	next_id += 1
	# things that stand still are live from the start; enemies wake near the screen
	o["active"] = kind == "post" or kind == "chest" or kind == "captive" or kind == "pickup"
	objs.append(o)
	return o


func emit(e: Dictionary) -> void:
	events.append(e)


func rand(n: int) -> int:
	# xorshift32, the same in game.js
	var x := rng
	x = (x ^ (x << 13)) & 0xFFFFFFFF
	x = x ^ (x >> 17)
	x = (x ^ (x << 5)) & 0xFFFFFFFF
	rng = x
	return x % n


# ------------------------------------------------------------------ tiles
func tile(tx: int, ty: int) -> int:
	if tx < 0 or tx >= lw:
		return 35          # "#": the stage's sides are walls
	if ty < 0 or ty >= lh:
		return 46          # ".": open above and below (a pit)
	return rows[ty][tx]


func solid_at(tx: int, ty: int) -> bool:
	var c := tile(tx, ty)
	return c == 35 or c == 88 or c == 76     # # X L


## Can something stand on the top edge of tile (tx, ty)? Solid tiles, thin ledges
## and the top of a climb column (M12).
func floor_at(tx: int, ty: int) -> bool:
	var c := tile(tx, ty)
	if c == 35 or c == 88 or c == 76 or c == 61:
		return true
	return c == 72 and tile(tx, ty - 1) != 72


func thin_at(tx: int, ty: int) -> bool:
	var c := tile(tx, ty)
	return c == 61 or (c == 72 and tile(tx, ty - 1) != 72)


func box_hits_solid(x: int, y: int, hw: int, h: int) -> bool:
	# a box with its feet centre at pixel (x, y)
	var l := (x - hw) >> 4
	var r := (x + hw - 1) >> 4
	var tp := (y - h) >> 4
	var b := (y - 1) >> 4
	for ty in range(tp, b + 1):
		for tx in range(l, r + 1):
			if solid_at(tx, ty):
				return true
	return false


## Moves a body (player or object) by its speed against the tiles. Returns a Dictionary of
## what it touched: {"wall": bool, "floor": bool, "ceil": bool}.
func move_body(o: Dictionary, hw: int, h: int, thin_ok: bool) -> Dictionary:
	var hit := {"wall": false, "floor": false, "ceil": false}
	# x
	var nx: int = o["x"] + o["vx"]
	var py: int = o["y"] >> 16
	if o["vx"] != 0 and box_hits_solid(nx >> 16, py, hw, h):
		var px: int = o["x"] >> 16
		var step := 1 if o["vx"] > 0 else -1
		while not box_hits_solid(px + step, py, hw, h) and absi((px + step) * FX - o["x"]) <= absi(o["vx"]) + FX:
			px += step
		nx = px * FX
		o["vx"] = 0
		hit["wall"] = true
	o["x"] = nx
	# y
	var ny: int = o["y"] + o["vy"]
	var x: int = o["x"] >> 16
	var l := (x - hw) >> 4
	var r := (x + hw - 1) >> 4
	if o["vy"] > 0:
		var old_feet: int = o["y"] >> 16
		var new_feet := ny >> 16
		var ty := (old_feet + 15) >> 4      # the first tile edge at or below the feet
		while ty * T <= new_feet:
			if ty * T >= old_feet:
				for tx in range(l, r + 1):
					if solid_at(tx, ty) or (thin_ok and floor_at(tx, ty)) or (not thin_ok and floor_at(tx, ty) and not thin_at(tx, ty)):
						ny = ty * T * FX
						o["vy"] = 0
						hit["floor"] = true
						break
			if hit["floor"]:
				break
			ty += 1
	elif o["vy"] < 0:
		var head_now: int = (ny >> 16) - h
		var ty := head_now >> 4
		for tx in range(l, r + 1):
			if solid_at(tx, ty):
				ny = ((ty + 1) * T + h) * FX
				o["vy"] = 0
				hit["ceil"] = true
				break
	o["y"] = ny
	return hit


## Is the body standing on something? (feet exactly on a tile's top edge)
func grounded(o: Dictionary, hw: int, thin_ok: bool) -> bool:
	if (o["y"] & 0xFFFF) != 0:
		return false
	var feet: int = o["y"] >> 16
	if (feet & 15) != 0:
		return false
	var x: int = o["x"] >> 16
	var ty := feet >> 4
	for tx in range((x - hw) >> 4, ((x + hw - 1) >> 4) + 1):
		if solid_at(tx, ty) or (floor_at(tx, ty) and (thin_ok or not thin_at(tx, ty))):
			return true
	return false


## Both edges of the feet stand on firm, harmless ground: a place to come back to after a
## pit (H7).
func firm(o: Dictionary, hw: int) -> bool:
	var feet: int = o["y"] >> 16
	if (feet & 15) != 0 or (o["y"] & 0xFFFF) != 0:
		return false
	var x: int = o["x"] >> 16
	var ty := feet >> 4
	for tx in [(x - hw) >> 4, (x + hw - 1) >> 4]:
		if not floor_at(tx, ty) or tile(tx, ty) == 94:
			return false
	return true


# ------------------------------------------------------------------ step
func step(inp: Dictionary) -> void:
	var held := {"jump": bool(inp.get("jump", false)), "attack": bool(inp.get("attack", false)),
		"item": bool(inp.get("item", false)), "special": bool(inp.get("special", false))}
	var press := {}
	for k in held:
		press[k] = held[k] and not bool(prev.get(k, false))
	var dx: int = int(inp.get("dx", 0))
	var dy: int = int(inp.get("dy", 0))
	prev = held
	var sel: String = String(inp.get("sel", ""))
	if sel != "" and prog["items"].has(sel):
		prog["sel"] = sel
	if mode == "talk" or mode == "over" or mode == "ending":
		return
	tick += 1
	if mode == "dead":
		mode_t -= 1
		if mode_t <= 0:
			respawn()
		step_objects()
		cleanup()
		follow_camera()
		return
	if mode == "clear":
		mode_t -= 1
		step_player_physics_only()
		if mode_t <= 0:
			mode = "over"
			emit({"t": "clear", "stage": stage})
		follow_camera()
		return
	step_player(dx, dy, held, press)
	step_objects()
	player_hits()
	cleanup()
	# the shown health moves one point per step toward the real value (H3)
	if p["shown"] < p["hp"]:
		p["shown"] += 1
	elif p["shown"] > p["hp"]:
		p["shown"] -= 1
	follow_camera()
	check_arena()
	# a talk that waits for the hero to land (the repo rule: a hold keeps gravity)
	if talk_id != "" and mode == "play" and p["ground"] and p["st"] != "hurt":
		mode = "talk"
		emit({"t": "talk", "id": talk_id})


## The view calls this when the talk window closes.
func close_talk() -> void:
	if mode != "talk":
		return
	mode = "play"
	talk_id = ""
	var then := talk_then
	talk_then = ""
	if then.begins_with("wake:"):
		var o := obj_by_id(int(then.substr(5)))
		if not o.is_empty():
			o["asleep"] = 0
			emit({"t": "music", "id": "guardian"})
	elif then.begins_with("give:"):
		give(then.substr(5), 1)
	elif then == "silt":
		Kinds.silt_rise(self)


func queue_talk(id: String, then: String = "") -> void:
	talk_id = id
	talk_then = then
	p["inv"] = maxi(p["inv"], 30)


func obj_by_id(id: int) -> Dictionary:
	for o in objs:
		if o["id"] == id:
			return o
	return {}


# ------------------------------------------------------------------ the player
func step_player(dx: int, dy: int, held: Dictionary, press: Dictionary) -> void:
	var st: String = p["st"]
	if p["inv"] > 0:
		p["inv"] -= 1
	if p["drop"] > 0:
		p["drop"] -= 1
	if p["slow"] > 0:
		p["slow"] -= 1
	if p["buff_t"] > 0:
		p["buff_t"] -= 1
		if p["buff_t"] == 0:
			p["buff"] = ""
	if p["chain"] > 0:
		p["chain"] -= 1
	# buffered presses (M7, A2)
	if press["jump"]:
		p["jbuf"] = int(P["jump_buffer_f"])
	elif p["jbuf"] > 0:
		p["jbuf"] -= 1
	if press["attack"]:
		p["abuf"] = int(P["attack_buffer_f"])
	elif p["abuf"] > 0:
		p["abuf"] -= 1
	if talk_id != "":
		dx = 0
		p["jbuf"] = 0
		p["abuf"] = 0
	if press["item"] and st != "hurt" and st != "climb" and talk_id == "":
		if dy < 0:
			cycle_item()
		else:
			use_item()
	var g := int(P["gravity"])
	if p["buff"] == "feather":
		g = g / 2
	match st:
		"hurt":
			# knocked back: no control until the timer ends and the hero has landed (H6)
			p["t"] -= 1
			p["vy"] = mini(p["vy"] + g, int(P["max_fall"]))
			var hit := move_body(p, int(P["hw"]), int(P["h"]), true)
			if hit["floor"]:
				p["vx"] = 0
			if p["t"] <= 0 and grounded(p, int(P["hw"]), true):
				p["st"] = "stand"
		"climb":
			step_climb(dx, dy, press)
		"attack", "cattack", "jattack", "special":
			step_attack(dx, g)
		_:
			step_move(dx, dy, held, press, g)
	# pits (H7)
	if (p["y"] >> 16) > lh * T + int(P["pit_margin_px"]):
		hurt(int(P["pit_damage"]), 0, true)
		if p["hp"] > 0:
			p["x"] = p["safe_x"]
			p["y"] = p["safe_y"]
			p["vx"] = 0
			p["vy"] = 0
			p["st"] = "stand"
			p["inv"] = int(P["safe_f"])
			emit({"t": "sfx", "id": "splash"})
	# spikes and silt (H5): touching them with the lower body
	if p["inv"] == 0 and p["buff"] != "stoneskin" and mode == "play" and touches_hazard():
		hurt(int(D["difficulty"]["hazard"][diff]), p["face"] if p["vx"] != 0 else 0, false)
	# walking into a locked gate with a key opens it (I8)
	if int(prog["items"].get("key", 0)) > 0 and touches_gate():
		if open_gate():
			prog["items"]["key"] = int(prog["items"]["key"]) - 1
	if p["ground"] and firm(p, int(P["hw"])):
		p["safe_x"] = p["x"]
		p["safe_y"] = p["y"]


func touches_hazard() -> bool:
	var x: int = p["x"] >> 16
	var feet: int = p["y"] >> 16
	for ty in [(feet - 1) >> 4, (feet - 8) >> 4]:
		for tx in [(x - int(P["hw"]) + 2) >> 4, (x + int(P["hw"]) - 3) >> 4]:
			if tile(tx, ty) == 94:
				return true
	return false


func touches_gate() -> bool:
	var x: int = p["x"] >> 16
	var feet: int = p["y"] >> 16
	for tx in [(x - int(P["hw"]) - 2) >> 4, (x + int(P["hw"]) + 1) >> 4]:
		if tile(tx, (feet - 8) >> 4) == 76 or tile(tx, (feet - 30) >> 4) == 76:
			return true
	return false


func walk_max() -> int:
	var m := int(H["walk_max"])
	if p["slow"] > 0:
		m = m / 2
	return m


## Walking (M1 to M3): the speed builds from 0 (first step 0.375, then +0.5625 a step) and
## stops at once when the pad is released.
func walk(dx: int) -> void:
	if dx == 0:
		p["vx"] = 0
		return
	if p["vx"] == 0 or (p["vx"] > 0) != (dx > 0):
		p["vx"] = dx * int(P["walk_first"])
	else:
		var m := walk_max()
		p["vx"] = clampi(p["vx"] + dx * int(P["walk_accel"]), -m, m)
	p["face"] = dx


func step_move(dx: int, dy: int, held: Dictionary, press: Dictionary, g: int) -> void:
	var hw := int(P["hw"])
	var on := grounded(p, hw, p["drop"] == 0)
	p["ground"] = on
	if on:
		p["coyote"] = int(P["coyote_f"])
	elif p["coyote"] > 0:
		p["coyote"] -= 1
	var crouch: bool = on and dy > 0
	# climb (M9): up on a climb column, or down from the top of one
	if dy != 0 and talk_id == "" and can_climb(dy):
		p["st"] = "climb"
		p["vx"] = 0
		p["vy"] = 0
		p["x"] = (((p["x"] >> 16) >> 4) * T + 8) * FX
		if dy > 0 and on:
			p["y"] += 2 * FX
		p["ground"] = false
		return
	# drop through a thin ledge (M11)
	if on and dy > 0 and p["jbuf"] > 0 and standing_on_thin_only():
		p["drop"] = int(P["drop_f"])
		p["jbuf"] = 0
		p["y"] += FX
		p["ground"] = false
		on = false
		crouch = false
	# attack (A1, A4, A5), special (A6)
	if press["special"] and talk_id == "":
		if start_special():
			return
	if p["abuf"] > 0 and talk_id == "":
		p["abuf"] = 0
		if on and crouch:
			start_attack("cattack", int(P["crouch_swing_f"]))
		elif on:
			start_attack("attack", int(H["swing"]))
		else:
			start_attack("jattack", int(P["air_swing_f"]))
		if p["st"] == "attack":
			p["vx"] = 0
			return
		if p["st"] == "cattack":
			p["vx"] = 0
			p["crouch"] = true
			return
	# jump (M4 to M7): rises on the press step
	var launched := false
	if p["jbuf"] > 0 and (on or p["coyote"] > 0) and not (dy > 0 and on):
		launched = true
		p["jbuf"] = 0
		p["coyote"] = 0
		p["vy"] = int(P["jump_v"])
		p["ground"] = false
		on = false
		emit({"t": "sfx", "id": "jump"})
	if not on and p["vy"] < int(P["jump_cut"]) and not held["jump"] and p["st"] != "jattack":
		p["vy"] = int(P["jump_cut"])
	p["crouch"] = crouch
	if crouch:
		p["vx"] = 0
		if dx != 0:
			p["face"] = dx
	else:
		walk(dx)
	if not on and not launched:
		p["vy"] = mini(p["vy"] + g, int(P["max_fall"]))
	var h := int(P["h_crouch"]) if crouch else int(P["h"])
	var hit := move_body(p, hw, h, p["drop"] == 0)
	if hit["floor"]:
		p["ground"] = true
		emit({"t": "sfx", "id": "land"})
	if p["st"] != "jattack":
		if not p["ground"]:
			p["st"] = "jump" if p["vy"] < 0 else "fall"
		elif crouch:
			p["st"] = "crouch"
		elif p["vx"] != 0:
			p["st"] = "walk"
		else:
			p["st"] = "stand"


func standing_on_thin_only() -> bool:
	var x: int = p["x"] >> 16
	var ty: int = (p["y"] >> 16) >> 4
	for tx in range((x - int(P["hw"])) >> 4, ((x + int(P["hw"]) - 1) >> 4) + 1):
		if solid_at(tx, ty):
			return false
	return true


func can_climb(dy: int) -> bool:
	var x: int = p["x"] >> 16
	var tx := x >> 4
	var feet: int = p["y"] >> 16
	if absi((x & 15) - 8) > 6:
		return false
	if dy < 0:
		# a climb column at the hero's middle
		return tile(tx, (feet - 20) >> 4) == 72 and p["vy"] >= -FX * 2
	# down: standing on the top of a column
	return p["ground"] and tile(tx, feet >> 4) == 72


func step_climb(dx: int, dy: int, press: Dictionary) -> void:
	var tx: int = (p["x"] >> 16) >> 4
	p["ground"] = false
	if p["jbuf"] > 0:
		p["jbuf"] = 0
		p["st"] = "jump"
		if dx != 0:
			p["vx"] = dx * int(P["climb_push"])
			p["face"] = dx
			p["vy"] = int(P["jump_v"])
			emit({"t": "sfx", "id": "jump"})
		else:
			p["vy"] = 0
		return
	var v := int(P["climb_v"])
	p["vy"] = dy * v
	var feet_now: int = p["y"] >> 16
	var ny: int = p["y"] + p["vy"]
	var feet := ny >> 16
	if dy < 0:
		# the top of the column: stand on it (M12)
		var top := feet_now >> 4
		while tile(tx, top - 1) == 72:
			top -= 1
		if feet <= top * T:
			p["y"] = top * T * FX
			p["vy"] = 0
			p["st"] = "stand"
			p["ground"] = true
			return
		if box_hits_solid(p["x"] >> 16, feet, int(P["hw"]), int(P["h"])):
			return
	elif dy > 0:
		# the foot of the column: stand on the floor, or let go over a drop
		if floor_at(tx, feet >> 4) and tile(tx, feet >> 4) != 72 and (feet & 15) < 8 and feet >= (feet >> 4) * T:
			p["y"] = (feet >> 4) * T * FX
			p["st"] = "stand"
			p["ground"] = true
			p["vy"] = 0
			return
		if tile(tx, (feet - 20) >> 4) != 72:
			p["st"] = "fall"
			return
	p["y"] = ny
	p["t"] += 1 if dy != 0 else 0


func start_attack(kind: String, length: int) -> void:
	# a new swing is allowed from the hero's re-press frame on (A2); the chain goes cut,
	# cut, spin (A3)
	p["st"] = kind
	p["akind"] = kind
	p["atk"] = 0
	p["alen"] = length
	p["hits"] = []
	if kind == "attack":
		p["combo"] = (p["combo"] + 1) % 3 if p["chain"] > 0 else 0
	else:
		p["combo"] = 0
	emit({"t": "sfx", "id": "spin" if p["combo"] == 2 and kind == "attack" else "swing"})


func start_special() -> bool:
	var s: Dictionary = P["special"]
	var free: bool = p["buff"] == "fury"
	if not free and p["hp"] < int(s["needs"]):
		emit({"t": "sfx", "id": "deny"})
		return false
	if not free:
		p["hp"] -= int(s["cost"])
	p["st"] = "special"
	p["akind"] = "special"
	p["atk"] = 0
	p["alen"] = int(s["len"])
	p["hits"] = []
	p["vx"] = 0
	emit({"t": "sfx", "id": "cleave"})
	return true


func step_attack(dx: int, g: int) -> void:
	var hw := int(P["hw"])
	p["atk"] += 1
	var kind: String = p["akind"]
	var on := grounded(p, hw, p["drop"] == 0)
	p["ground"] = on
	if kind == "jattack" or not on:
		# the jump attack keeps the arc (A5); the hero may still steer
		if kind == "jattack":
			walk(dx)
		p["vy"] = mini(p["vy"] + g, int(P["max_fall"]))
	else:
		p["vx"] = 0
	var hit := move_body(p, hw, int(P["h_crouch"]) if kind == "cattack" else int(P["h"]), p["drop"] == 0)
	if hit["floor"]:
		p["ground"] = true
		if kind == "jattack":
			p["atk"] = p["alen"]
	# a buffered press chains into the next swing from the re-press frame on (A2)
	var repress: int = p["alen"] - (int(H["swing"]) - int(H["repress"]))
	if kind == "attack" and p["abuf"] > 0 and p["atk"] >= repress:
		p["abuf"] = 0
		p["chain"] = 12
		start_attack("attack", int(H["swing"]))
		return
	if p["atk"] >= p["alen"]:
		p["chain"] = 12 if kind == "attack" else 0
		if p["ground"]:
			p["st"] = "crouch" if kind == "cattack" else "stand"
		else:
			p["st"] = "fall"
		p["crouch"] = kind == "cattack"


## The hero's hit box this step, or [] when the swing is not active. [x0, y0, x1, y1] in px.
func attack_box() -> Array:
	var st: String = p["st"]
	var x: int = p["x"] >> 16
	var y: int = p["y"] >> 16
	var f: int = p["face"]
	var t: int = p["atk"]
	var reach := int(H["reach"])
	if st == "attack":
		var from := int(H["from"])
		var to := int(H["to"])
		if t < from or t > to:
			return []
		if p["combo"] == 2:
			return [x - reach - 4, y - 34, x + reach + 4, y - 8]
		return [x + 4, y - 34, x + 4 + reach, y - 8] if f > 0 else [x - 4 - reach, y - 34, x - 4, y - 8]
	if st == "cattack":
		if t < 3 or t > 10:
			return []
		return [x + 4, y - 18, x + 4 + reach, y - 1] if f > 0 else [x - 4 - reach, y - 18, x - 4, y - 1]
	if st == "jattack":
		if t < 2 or t > 10:
			return []
		return [x + 2, y - 32, x + 2 + reach, y - 2] if f > 0 else [x - 2 - reach, y - 32, x - 2, y - 2]
	if st == "special":
		var s: Dictionary = P["special"]
		if t < int(s["from"]) or t > int(s["to"]):
			return []
		var r: int = reach + int(s["reach_add"])
		return [x - r, y - 40, x + r, y - 2]
	return []


func attack_damage() -> int:
	var st: String = p["st"]
	if st == "special":
		return int(P["special"]["damage"])
	var d := int(H["damage"])
	if st == "attack" and p["combo"] == 2:
		d *= 2
	return d


## The hero's hurt box in px: [x0, y0, x1, y1].
func player_box() -> Array:
	var x: int = p["x"] >> 16
	var y: int = p["y"] >> 16
	var h := int(P["h_crouch"]) if p["crouch"] else int(P["h"])
	return [x - int(P["hw"]), y - h, x + int(P["hw"]), y]


func obj_box(o: Dictionary) -> Array:
	var x: int = o["x"] >> 16
	var y: int = o["y"] >> 16
	var hw: int = int(o["w"]) >> 1
	return [x - hw, y - int(o["h"]), x + hw, y]


static func overlap(a: Array, b: Array) -> bool:
	return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


## Damage to the hero (H4 to H6). `from_dir` is the side the blow came from (-1, 0, 1).
func hurt(amount: int, from_dir: int, no_knock: bool) -> void:
	if mode != "play":
		return
	if p["buff"] == "stoneskin" and not no_knock:
		return
	if p["inv"] > 0 and not no_knock:
		return
	p["hp"] = maxi(0, p["hp"] - amount)
	emit({"t": "sfx", "id": "hurt"})
	if p["hp"] <= 0:
		die()
		return
	if no_knock:
		return
	var away: int = -from_dir if from_dir != 0 else -p["face"]
	p["vx"] = away * int(P["knock_vx"])
	p["vy"] = int(P["knock_vy"])
	p["st"] = "hurt"
	p["t"] = int(P["hurt_f"])
	p["inv"] = int(P["safe_f"])
	p["ground"] = false
	p["crouch"] = false


func enemy_hit(o: Dictionary) -> void:
	var dir := 1 if o["x"] < p["x"] else -1
	hurt(int(D["difficulty"]["enemy_hit"][diff]), -dir, false)


func die() -> void:
	mode = "dead"
	mode_t = int(P["dead_f"])
	p["st"] = "dead"
	p["vx"] = 0
	talk_id = ""
	emit({"t": "sfx", "id": "die"})


## After a death (H8, H9): a life is lost; with lives left the hero comes back at the last
## post with full health, and the bar refills from 0.
func respawn() -> void:
	prog["lives"] = int(prog["lives"]) - 1
	if int(prog["lives"]) <= 0:
		mode = "over"
		emit({"t": "gameover"})
		return
	mode = "play"
	p["x"] = check_x
	p["y"] = check_y
	p["vx"] = 0
	p["vy"] = 0
	p["hp"] = int(prog["maxhp"])
	p["shown"] = 0
	p["st"] = "stand"
	p["inv"] = int(P["safe_f"])
	p["buff"] = ""
	p["buff_t"] = 0
	p["slow"] = 0
	# a guardian fight starts over
	if arena_left >= 0 and guardian_id > 0:
		var gd := obj_by_id(guardian_id)
		if not gd.is_empty() and not gd["dead"]:
			Kinds.reset_guardian(self, gd)
	snap_camera()


# ------------------------------------------------------------------ items
func give(what: String, n: int) -> void:
	if what == "coin" or what == "gem":
		prog["score"] = int(prog["score"]) + int(D["score"][what]) * n
		emit({"t": "sfx", "id": "coin"})
		return
	if what == "life":
		prog["lives"] = mini(int(prog["lives"]) + n, 8)
		emit({"t": "sfx", "id": "life"})
		return
	var items: Dictionary = prog["items"]
	if items.has(what):
		items[what] = mini(int(items[what]) + n, int(P["item_cap"]))
		if int(items.get(prog["sel"], 0)) == 0:
			prog["sel"] = what
		emit({"t": "sfx", "id": "item"})


## Up + the item button: the next item carried becomes the selected one.
func cycle_item() -> void:
	var order: Array = D["items"]
	var i := order.find(prog["sel"])
	for k in range(1, order.size() + 1):
		var nx: String = order[(i + k) % order.size()]
		if int(prog["items"].get(nx, 0)) > 0:
			if nx != prog["sel"]:
				prog["sel"] = nx
				emit({"t": "sfx", "id": "menu"})
			return


func use_item() -> void:
	var what: String = prog["sel"]
	var items: Dictionary = prog["items"]
	if int(items.get(what, 0)) <= 0:
		return
	match what:
		"tonic":
			# I1: not used at full health
			if p["hp"] >= int(prog["maxhp"]):
				emit({"t": "sfx", "id": "deny"})
				return
			p["hp"] = int(prog["maxhp"])
		"heartroot":
			if int(prog["maxhp"]) >= int(P["hp_cap"]) and p["hp"] >= int(prog["maxhp"]):
				emit({"t": "sfx", "id": "deny"})
				return
			prog["maxhp"] = mini(int(prog["maxhp"]) + int(P["heartroot_add"]), int(P["hp_cap"]))
			p["hp"] = int(prog["maxhp"])
		"knives":
			var k := add_obj("knife", 0, 0)
			k["x"] = p["x"] + p["face"] * 8 * FX
			k["y"] = p["y"] - 22 * FX
			k["vx"] = p["face"] * int(P["knife_v"])
			k["face"] = p["face"]
			k["active"] = true
			k["w"] = 12
			k["h"] = 6
		"key":
			if not open_gate():
				emit({"t": "sfx", "id": "deny"})
				return
		"feather", "squall", "stoneskin", "fury":
			p["buff"] = what
			p["buff_t"] = int(D["timed"][what]["f"])
			if what == "squall":
				squall_burst()
		_:
			return
	items[what] = int(items[what]) - 1
	emit({"t": "sfx", "id": "use"})


func squall_burst() -> void:
	for o in objs:
		if Kinds.is_enemy(o) and o["active"] and not o["dead"] and on_screen(o, 0):
			Kinds.damage(self, o, int(D["timed"]["squall"]["burst"]), 0)


## The key opens the nearest locked gate within 3 tiles.
func open_gate() -> bool:
	var x: int = (p["x"] >> 16) >> 4
	var y: int = ((p["y"] >> 16) - 20) >> 4
	for ty in range(y - 3, y + 4):
		for tx in range(x - 3, x + 4):
			if tile(tx, ty) == 76:
				for yy in range(0, lh):
					if tile(tx, yy) == 76:
						rows[yy][tx] = 46
				emit({"t": "sfx", "id": "gate"})
				return true
	return false


# ------------------------------------------------------------------ objects
func on_screen(o: Dictionary, margin: int) -> bool:
	var x: int = o["x"] >> 16
	var y: int = o["y"] >> 16
	return x >= cam_x - margin and x <= cam_x + 320 + margin and y >= cam_y - margin and y - int(o["h"]) <= cam_y + 224 + margin


func step_objects() -> void:
	var n := objs.size()
	for i in n:
		var o: Dictionary = objs[i]
		if o["dead"]:
			continue
		if not o["active"]:
			if on_screen(o, 48):
				o["active"] = true
			else:
				continue
		if o["flash"] > 0:
			o["flash"] -= 1
		Kinds.step(self, o)


func cleanup() -> void:
	var keep: Array = []
	for o in objs:
		if not o["dead"]:
			keep.append(o)
	objs = keep


## The hero's swing and body against every object.
func player_hits() -> void:
	var ab := attack_box()
	var pb := player_box()
	# the Squall Charm's gust (I5): 1 damage every 20 steps to what it touches
	if p["buff"] == "squall" and tick % 20 == 0:
		var x: int = p["x"] >> 16
		var y: int = p["y"] >> 16
		var gust: Array = [x - 24, y - 44, x + 24, y + 4]
		for o in objs:
			if not o["dead"] and o["active"] and Kinds.is_enemy(o) and Kinds.hittable(o) and overlap(gust, obj_box(o)):
				Kinds.damage(self, o, 1, 1 if o["x"] > p["x"] else -1)
	for o in objs:
		if o["dead"] or not o["active"]:
			continue
		var ob := obj_box(o)
		if not ab.is_empty() and Kinds.hittable(o) and overlap(ab, ob) and not p["hits"].has(o["id"]):
			p["hits"].append(o["id"])
			var times := int(H["hits"]) if p["st"] == "attack" else 1
			for i in times:
				Kinds.damage(self, o, attack_damage(), p["face"] if p["st"] != "special" and not (p["st"] == "attack" and p["combo"] == 2) else (1 if o["x"] > p["x"] else -1))
		if mode != "play":
			return
		if overlap(pb, ob):
			Kinds.touch(self, o)


# ------------------------------------------------------------------ camera and arena
func snap_camera() -> void:
	cam_x = cam_target_x()
	cam_y = cam_target_y()


func cam_target_x() -> int:
	var x: int = (p["x"] >> 16) - 152
	var lo := 0
	if arena_left >= 0:
		lo = arena_left
	return clampi(x, lo, maxi(lo, lw * T - 320))


func cam_target_y() -> int:
	return clampi((p["y"] >> 16) - 150, 0, maxi(0, lh * T - 224))


func follow_camera() -> void:
	var tx := cam_target_x()
	var ty := cam_target_y()
	# up to 6 px a step horizontally, 4 vertically, so pit returns and respawns glide
	cam_x += clampi(tx - cam_x, -6, 6)
	cam_y += clampi(ty - cam_y, -4, 4)


## The guardian's arena (S5): passing the A marker locks the camera and the way back, and the
## guardian speaks once the hero is on the ground.
func check_arena() -> void:
	if arena_x < 0 or arena_left >= 0:
		return
	if (p["x"] >> 16) - int(P["hw"]) >= arena_x + T:
		arena_left = arena_x
		var col := arena_x >> 4
		for ty in lh:
			if rows[ty][col] == 46:
				rows[ty][col] = 88       # an invisible wall: the view draws nothing for it here
		var gd := obj_by_id(guardian_id)
		if not gd.is_empty():
			gd["active"] = true
			queue_talk(head.get("talk", "meet_" + String(gd["k"])), "wake:%d" % guardian_id)
			emit({"t": "music", "id": "none"})


## A guardian fell: its bell drops (or, on the flagship, Grane's change begins).
func guardian_down(o: Dictionary) -> void:
	prog["score"] = int(prog["score"]) + int(D["enemies"][o["k"]]["score"])
	if o["k"] == "grane":
		queue_talk("grane_change", "silt")
		return
	var b := add_obj("bell", o["x"] >> 16, (o["y"] >> 16) - 8)
	b["active"] = true
	b["vy"] = -3 * FX
	emit({"t": "sfx", "id": "bell"})
	emit({"t": "music", "id": "none"})


func take_bell(o: Dictionary) -> void:
	o["dead"] = true
	prog["score"] = int(prog["score"]) + int(D["score"]["bell"])
	mode = "clear"
	mode_t = 150
	p["st"] = "stand" if p["ground"] else "fall"
	emit({"t": "bell", "stage": stage})
	if stage == "brinecrow":
		emit({"t": "ending"})


func step_player_physics_only() -> void:
	# during the bell scene the hero lands (a hold keeps gravity)
	var hw := int(P["hw"])
	p["vx"] = 0
	if not grounded(p, hw, true):
		p["vy"] = mini(p["vy"] + int(P["gravity"]), int(P["max_fall"]))
		var hit := move_body(p, hw, int(P["h"]), true)
		p["ground"] = hit["floor"]
		p["st"] = "stand" if hit["floor"] else "fall"
	else:
		p["ground"] = true
		p["st"] = "stand"


# ------------------------------------------------------------------ checks
## A full copy of the state (the route finder searches from copies).
func clone():
	var c = get_script().new(D)
	c.stage = stage
	c.head = head
	c.rows = []
	for r in rows:
		c.rows.append(r.duplicate())
	c.lw = lw
	c.lh = lh
	c.hero = hero
	c.H = H
	c.diff = diff
	c.prog = prog.duplicate(true)
	c.p = p.duplicate(true)
	c.objs = objs.duplicate(true)
	c.next_id = next_id
	c.tick = tick
	c.rng = rng
	c.mode = mode
	c.mode_t = mode_t
	c.talk_id = talk_id
	c.talk_then = talk_then
	c.prev = prev.duplicate()
	c.cam_x = cam_x
	c.cam_y = cam_y
	c.arena_left = arena_left
	c.arena_x = arena_x
	c.guardian_id = guardian_id
	c.check_x = check_x
	c.check_y = check_y
	c.chests = chests
	c.npcs = npcs
	return c


## A short, stable text of the state for the parity check between the two builds.
func state_hash() -> int:
	var h := 17
	var parts: Array = [tick, p["x"], p["y"], p["vx"], p["vy"], p["hp"], p["shown"], p["inv"], p["atk"],
		cam_x, cam_y, int(prog["score"]), int(prog["lives"]), rng & 0xFFFF, objs.size()]
	for o in objs:
		parts.append(o["id"])
		parts.append(o["x"])
		parts.append(o["y"])
		parts.append(o["hp"])
	for v in parts:
		h = (h * 31 + (int(v) & 0xFFFFFFF)) & 0xFFFFFFF
	return h
