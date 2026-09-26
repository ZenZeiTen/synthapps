## The whole game, as pure rules. No nodes, no rendering: the view reads `s` (the
## saveable state) and `lv`/`ls` (current level, static and live), and drains `events`.
## Battle rounds live in battle.gd and spells in magic.gd; both work on this object.
extends RefCounted

const Rules = preload("res://scripts/core/rules.gd")
const Level = preload("res://scripts/core/level.gd")
const Rng = preload("res://scripts/core/rng.gd")
const Battle = preload("res://scripts/core/battle.gd")
const Magic = preload("res://scripts/core/magic.gd")

const TICKS_PER_GAME_TICK := 100    # world ticks (100 ms) per game tick (10 s; the original's regen tick)
const PACK_SIZE := 12
const MAX_PARTY := 6
const EQUIP_SLOTS := ["head", "neck", "body", "legs", "feet", "hand_r", "hand_l", "ring1", "ring2"]
const DOOR_SPEED := 0.2             # a door takes 5 world ticks (0.5 s) to open or close
const DX: Array[int] = [0, 1, 0, -1]
const DY: Array[int] = [-1, 0, 1, 0]
const DIR_NAMES := ["north", "east", "south", "west"]

var content: Dictionary
var rng
var s: Dictionary = {}              # everything that is saved
var lv                              # compiled current level (level.gd)
var ls: Dictionary = {}             # live state of the current level (inside s.levels)
var events: Array = []              # for the view: {"t": kind, ...}
var battle
var magic
var dialog: Dictionary = {}         # active dialogue {id, node, npc}
var shop: Dictionary = {}           # active shop {id}
var _levels: Dictionary = {}        # compiled level cache
var _in_enter = false


func _init(c: Dictionary) -> void:
	content = c
	battle = Battle.new(self)
	magic = Magic.new(self)


# ------------------------------------------------------------------ setup

func new_game(seed_value: int = 20260926) -> void:
	rng = Rng.new(seed_value)
	var pd: Dictionary = content["party"]
	s = {"version": 1, "tick": 0, "time": 8 * Rules.HOUR, "level": "", "x": 0, "y": 0, "dir": 0,
		"gold": int(pd.get("start_gold", 0)), "runes": (pd.get("start_runes", []) as Array).duplicate(),
		"flags": {}, "once": {}, "book": [], "party": [], "held": null, "levels": {}, "mode": "explore",
		"next_uid": 1, "sleep": Rules.MAX_SLEEP, "shops": {}, "battle": {}, "omen": 0, "rng": 0, "log": []}
	for cid in pd["start"]:
		s["party"].append(make_character(cid))
	var first = ""
	for id in content["levels"]:
		if int(content["levels"][id].get("depth", 99)) == 1:
			first = id
	enter_level(first, "", -1)


## A new game with a party made on the creation disc. specs: [{name, portrait, sex,
## stats: {str, mag, mob, dex}}], 1..MAX_PARTY of them, already rolled.
func new_game_custom(seed_value: int, specs: Array) -> void:
	new_game(seed_value)
	s["party"] = []
	for i in specs.size():
		s["party"].append(make_created(i, specs[i]))
	# enter_level already ran with the default party; nothing in it depends on who is in it
	events = events.filter(func(e): return e["t"] != "autosave")


## Build a created character: the original's creation formulas, 5 bonus points, and a
## starting kit chosen by the build (every item's requirements are met). The first
## three characters get +1 maximum attack with STR > 20 and +1 maximum defence with
## DEX > 20 (CHARGEN.C, end of enter_generator).
func make_created(i: int, spec: Dictionary) -> Dictionary:
	var st: Dictionary = spec["stats"]
	var ch := {"id": "made%d" % i, "name": spec["name"], "portrait": spec["portrait"], "sex": spec.get("sex", "m"),
		"base": Rules.creation_stats(int(st["str"]), int(st["mag"]), int(st["mob"]), int(st["dex"])),
		"level": 1, "xp": 0, "points": 5, "skill": {}, "skill_hits": {}, "equip": {}, "pack": [],
		"quiver": 0, "effects": [], "dead": false, "hp": 0, "mp": 0, "st": 0, "food": 0, "water": 0}
	for k in PACK_SIZE:
		ch["pack"].append(null)
	if i < 3:
		if int(st["str"]) > 20:
			ch["base"]["atk_h"] = int(ch["base"]["atk_h"]) + 1
		if int(st["dex"]) > 20:
			ch["base"]["def_h"] = int(ch["base"]["def_h"]) + 1
	for slot_item in starting_kit(st):
		if slot_item[0] == "quiver":
			ch["quiver"] = int(slot_item[1])
		elif slot_item[0] == "pack":
			pack_add(ch, {"id": slot_item[1]})
		else:
			ch["equip"][slot_item[0]] = {"id": slot_item[1]}
	var cur := stats(ch)
	ch["hp"] = cur["hp_max"]
	ch["mp"] = cur["mp_max"]
	ch["st"] = cur["st_max"]
	ch["food"] = Rules.food_max(cur["hp_max"])
	ch["water"] = Rules.water_max(cur["hp_max"])
	return ch


## Kit by the strongest stat (Magic counts double: a mage wants a staff even when
## middling). Returns [[slot, item id or amount], ...]; slot "pack" = backpack.
func starting_kit(st: Dictionary) -> Array:
	var strv := int(st["str"])
	var magv := int(st["mag"])
	var dexv := int(st["dex"])
	var mobv := int(st["mob"])
	var kit := []
	var best := "str"
	var score := strv
	for k in [["mag", magv + 4], ["dex", dexv], ["mob", mobv - 2]]:
		if int(k[1]) > score:
			best = k[0]
			score = int(k[1])
	match best:
		"str":
			kit.append(["hand_r", "mace" if strv >= 13 else "dagger"])
			if strv >= 10:
				kit.append(["hand_l", "shield"])
			kit.append(["body", "leather"])
		"mag":
			kit.append(["hand_r", "staff"] if magv >= 8 else ["hand_r", "dagger"])
			kit.append(["pack", "potion_blue"])
		"dex":
			if dexv >= 12:
				kit.append(["hand_r", "bow"])
				kit.append(["quiver", 24])
				kit.append(["pack", "dagger"])
			else:
				kit.append(["hand_r", "dagger"])
		"mob":
			kit.append(["hand_r", "sword"] if strv >= 12 else ["hand_r", "dagger"])
			kit.append(["body", "leather"])
	kit.append(["pack", "bread"])
	kit.append(["pack", "potion_red"])
	return kit


func make_character(cid: String) -> Dictionary:
	var d: Dictionary = content["party"]["characters"][cid]
	var ch = {"id": cid, "name": d["name"], "portrait": d["portrait"], "sex": d.get("sex", "m"),
		"base": Rules.creation_stats(int(d["str"]), int(d["mag"]), int(d["mob"]), int(d["dex"])),
		"level": 1, "xp": 0, "points": 5, "skill": {}, "skill_hits": {}, "equip": {}, "pack": [],
		"quiver": 0, "effects": [], "dead": false, "hp": 0, "mp": 0, "st": 0, "food": 0, "water": 0}
	for i in PACK_SIZE:
		ch["pack"].append(null)
	var eq: Dictionary = d.get("equip", {})
	for slot in eq:
		if slot == "quiver":
			ch["quiver"] = int(eq[slot])
		else:
			ch["equip"][slot] = {"id": eq[slot]}
	for iid in d.get("pack", []):
		pack_add(ch, {"id": iid})
	var target_level = int(d.get("level", 1))
	if target_level > 1:
		gain_xp(ch, Rules.LEVEL_XP[target_level - 2], true)
	var st = stats(ch)
	ch["hp"] = st["hp_max"]
	ch["mp"] = st["mp_max"]
	ch["st"] = st["st_max"]
	ch["food"] = Rules.food_max(st["hp_max"])
	ch["water"] = Rules.water_max(st["hp_max"])
	return ch


# ------------------------------------------------------------------ small helpers

func item_def(it) -> Dictionary:
	return content["items"].get(String(it["id"]), {}) if it != null else {}


func item_name(it) -> String:
	var d = item_def(it)
	var n: String = d.get("name", String(it["id"]))
	if it.has("amount") and int(it["amount"]) > 1:
		n += " (%d)" % int(it["amount"])
	return n


func msg(text: String) -> void:
	events.append({"t": "msg", "text": text})
	s["log"].append(text)
	if s["log"].size() > 60:
		s["log"].pop_front()


func sfx(name: String, cell: int = -1) -> void:
	var d = 0
	if cell >= 0:
		d = absi(cell % lv.w - int(s["x"])) + absi(cell / lv.w - int(s["y"]))
	events.append({"t": "sfx", "name": name, "vol": Rules.sound_volume(d)})


func cur_cell() -> int:
	return lv.idx(int(s["x"]), int(s["y"]))


func front_cell() -> int:
	return lv.neighbour(cur_cell(), int(s["dir"]))


func living() -> Array:
	var out = []
	for i in s["party"].size():
		if not s["party"][i]["dead"]:
			out.append(i)
	return out


## Current stats of a character: base + worn items + timed spell changes.
func stats(ch: Dictionary) -> Dictionary:
	var mods = []
	for slot in ch["equip"]:
		var it = ch["equip"][slot]
		if it != null:
			var d = item_def(it)
			if d.has("mods"):
				mods.append(d["mods"])
	for e in ch["effects"]:
		if e.has("mods"):
			mods.append(e["mods"])
	return Rules.derive(ch["base"], mods)


func fx_of(who: Dictionary) -> Array:
	var out = []
	for e in who.get("effects", []):
		for f in e.get("flags", []):
			out.append(f)
	return out


func dist(a: int, b: int) -> int:
	return absi(a % lv.w - b % lv.w) + absi(a / lv.w - b / lv.w)


# ------------------------------------------------------------------ levels

func level_static(id: String):
	if not _levels.has(id):
		_levels[id] = Level.new(id, content["levels"][id])
	return _levels[id]


func level_state(id: String) -> Dictionary:
	if not s["levels"].has(id):
		s["levels"][id] = _init_level_state(level_static(id))
	return s["levels"][id]


func _init_level_state(L) -> Dictionary:
	var st = {"doors": {}, "unlocked": {}, "switches": {}, "items": {}, "niches": {}, "monsters": [],
		"seen": {}, "found": {}, "tele": {}, "plates": {}, "timers": []}
	for fi in L.faces.size():
		var f: Dictionary = L.faces[fi]
		if f.is_empty():
			continue
		if f["kind"] in ["door", "gate"]:
			st["doors"][str(L.edge_key(fi))] = {"p": 0.0, "to": 0.0}
		if f.has("switch"):
			st["switches"][str(fi)] = false
		if f.has("niche"):
			var items = []
			for iid in f["niche"]:
				items.append({"id": iid})
			st["niches"][str(fi)] = items
	for ci in L.cells.size():
		var c: Dictionary = L.cells[ci]
		if c.is_empty():
			continue
		if c["type"] == "teleport":
			st["tele"][str(ci)] = true
		if c["type"] == "plate":
			st["plates"][str(ci)] = false
	for it in L.data.get("items", []):
		var at: Array = it["at"]
		var cv: Vector2i = L.cell_ref(at[0])
		var inst = {"id": it["id"]}
		if it.has("amount"):
			inst["amount"] = int(it["amount"])
		var key = str(L.idx(cv.x, cv.y) * 4 + int(at[1]))
		if not st["items"].has(key):
			st["items"][key] = []
		st["items"][key].append(inst)
	for m in L.data.get("monsters", []):
		var cv: Vector2i = L.cell_ref(m["at"])
		st["monsters"].append(new_monster(String(m["id"]), L.idx(cv.x, cv.y), Level.dir_of(String(m.get("dir", "S"))), m.get("drops", [])))
	return st


func new_monster(mid: String, cell: int, dir: int, drops: Array = []) -> Dictionary:
	var t: Dictionary = content["monsters"][mid]
	var uid = int(s["next_uid"])
	s["next_uid"] = uid + 1
	var m = {"uid": uid, "id": mid, "cell": cell, "dir": maxi(dir, 0), "hp": int(t["hp"]), "cd": 1 + (uid * 7) % 10,
		"home": cell, "in_battle": false, "hunt": false, "alert": -1, "taken": 0, "effects": [], "fear": 0,
		"drops": drops.duplicate(), "from": cell}
	return m


func mtemplate(m: Dictionary) -> Dictionary:
	return content["monsters"][m["id"]]


## "the cellar rat", or a proper name as is ("The Warden").
func mname(m: Dictionary) -> String:
	var n := String(mtemplate(m)["name"])
	return "the " + n.substr(4) if n.begins_with("The ") else "the " + n.to_lower()


func mname_cap(m: Dictionary) -> String:
	var n := mname(m)
	return n.substr(0, 1).to_upper() + n.substr(1)


func mflag(m: Dictionary, f: String) -> bool:
	return f in mtemplate(m)["flags"]


func mstats(m: Dictionary) -> Dictionary:
	var t = mtemplate(m)
	var base = Rules.blank_stats()
	for k in t["stats"]:
		base[k] = t["stats"][k]
	base["hp_max"] = int(t["hp"])
	var mods = []
	for e in m["effects"]:
		if e.has("mods"):
			mods.append(e["mods"])
	return Rules.derive(base, mods)


## Enter a level at an anchor (or its start) facing dir (-1 = the level's start facing).
func enter_level(id: String, at_ref: String, dir: int) -> void:
	s["level"] = id
	lv = level_static(id)
	ls = level_state(id)
	var start: Array = lv.data.get("start", ["A", "E"])
	var cv: Vector2i = lv.cell_ref(at_ref if at_ref != "" else String(start[0]))
	s["x"] = cv.x
	s["y"] = cv.y
	s["dir"] = dir if dir >= 0 else Level.dir_of(String(start[1]))
	events.append({"t": "level", "id": id})
	run_ops(lv.data.get("on_start", []), {})
	update_seen()
	update_plates()


# ------------------------------------------------------------------ faces, doors, sight

func door_state(fi: int) -> Dictionary:
	return ls["doors"].get(str(lv.edge_key(fi)), {"p": 0.0, "to": 0.0})


func face_passable(fi: int) -> bool:
	var f: Dictionary = lv.faces[fi]
	if f.is_empty():
		return false
	match String(f["kind"]):
		"open", "secret":
			return true
		"door", "gate":
			return float(door_state(fi)["p"]) >= 1.0
	return false


func face_see_through(fi: int) -> bool:
	var f: Dictionary = lv.faces[fi]
	if f.is_empty():
		return false
	match String(f["kind"]):
		"open", "gate":
			return true
		"door":
			return float(door_state(fi)["p"]) > 0.5
	return false


func door_do(fi: int, what: String, ctx: Dictionary) -> void:
	if fi < 0:
		return
	var d: Dictionary = ls["doors"].get(str(lv.edge_key(fi)), {})
	if d.is_empty():
		return
	var target = float(d["to"])
	match what:
		"open": target = 1.0
		"close": target = 0.0
		"toggle": target = 0.0 if target > 0.5 else 1.0
		"switch": target = 1.0 if ctx.get("switch", false) else 0.0
	if target != float(d["to"]):
		d["to"] = target
		sfx("door" if lv.faces[fi]["kind"] == "door" else "gate", fi >> 2)
		noise(fi >> 2, 4)


## Can a ray pass from cell a to b (monster sight, projectiles)? Cell-by-cell traversal of
## the grid line; at an exact corner either route will do.
func line_clear(a: int, b: int, see: bool = true) -> bool:
	var x0 = a % lv.w
	var y0 = a / lv.w
	var x1 = b % lv.w
	var y1 = b / lv.w
	var dx = absi(x1 - x0)
	var dy = absi(y1 - y0)
	var sx = 1 if x1 > x0 else -1
	var sy = 1 if y1 > y0 else -1
	var err = dx - dy
	var x = x0
	var y = y0
	var n = dx + dy
	while n > 0:
		var e2 = 2 * err
		if e2 > -dy and e2 < dx:
			# exact corner: try x-then-y and y-then-x
			var okx = _cross(x, y, 1 if sx > 0 else 3, see) and _cross(x + sx, y, 2 if sy > 0 else 0, see)
			var oky = _cross(x, y, 2 if sy > 0 else 0, see) and _cross(x, y + sy, 1 if sx > 0 else 3, see)
			if not (okx or oky):
				return false
			x += sx
			y += sy
			err += -dy + dx
			n -= 2
		elif e2 > -dy:
			if not _cross(x, y, 1 if sx > 0 else 3, see):
				return false
			x += sx
			err -= dy
			n -= 1
		else:
			if not _cross(x, y, 2 if sy > 0 else 0, see):
				return false
			y += sy
			err += dx
			n -= 1
	return true


func _cross(x: int, y: int, d: int, see: bool) -> bool:
	if not lv.valid(x, y):
		return false
	var fi: int = lv.idx(x, y) * 4 + d
	return face_see_through(fi) if see else face_passable(fi)


## Automap: the original marks squares in the centre column +-1, up to 4 deep, reached
## through see-through faces (BUILDER.C:678-709).
func update_seen() -> void:
	var start = cur_cell()
	var d = int(s["dir"])
	var left = (d + 3) & 3
	var right = (d + 1) & 3
	ls["seen"][str(start)] = true
	var frontier = [[start, 0, 0]]
	var visited = {start: true}
	while not frontier.is_empty():
		var cur: Array = frontier.pop_front()
		var c: int = cur[0]
		var depth: int = cur[1]
		var col: int = cur[2]
		for step in [[d, 1, 0], [left, 0, -1], [right, 0, 1]]:
			var nd: int = depth + step[1]
			var nc: int = col + step[2]
			if nd > 4 or absi(nc) > 1:
				continue
			if not face_see_through(c * 4 + step[0]):
				continue
			var n: int = lv.neighbour(c, step[0])
			if n < 0 or visited.has(n):
				continue
			visited[n] = true
			ls["seen"][str(n)] = true
			frontier.append([n, nd, nc])


# ------------------------------------------------------------------ movement

## rel: 0 forward, 1 strafe right, 2 back, 3 strafe left.
func step(rel: int) -> Dictionary:
	if s["mode"] == "battle":
		return battle.party_move((int(s["dir"]) + rel) & 3)
	if s["mode"] != "explore" or not dialog.is_empty() or not shop.is_empty():
		return {"ok": false}
	return move_party((int(s["dir"]) + rel) & 3)


func move_party(d: int) -> Dictionary:
	var c = cur_cell()
	var fi = c * 4 + d
	for ci in living():
		if int(s["party"][ci]["st"]) <= 0 and living().size() == 1:
			msg("Too exhausted to move.")
			return {"ok": false}
	if not face_passable(fi):
		sfx("bump")
		noise(c, 3)
		var f: Dictionary = lv.faces[fi]
		if f.get("kind", "") == "door" and float(door_state(fi)["to"]) < 0.5:
			if f.has("lock") and not ls["unlocked"].has(str(lv.edge_key(fi))):
				pass
		events.append({"t": "bump", "dir": d})
		return {"ok": false, "bump": true}
	var n = lv.neighbour(c, d)
	var mobs = monsters_at(n)
	if not mobs.is_empty():
		for m in mobs:
			if mflag(m, "npc"):
				msg("%s is in the way." % mtemplate(m)["name"])
				return {"ok": false}
		if s["mode"] == "explore":
			battle.start(mobs[0], false)
		return {"ok": false, "battle": true}
	var f: Dictionary = lv.faces[fi]
	s["x"] = n % lv.w
	s["y"] = n / lv.w
	if f["kind"] == "secret":
		var key = str(lv.edge_key(fi))
		if not ls["found"].has(key):
			ls["found"][key] = true
			msg("The wall was only an illusion!")
	# carried weight costs stamina on every step (REALGAME.C:1378)
	for ci in living():
		var ch: Dictionary = s["party"][ci]
		ch["st"] = maxi(0, int(ch["st"]) - weight_defect(ch))
	events.append({"t": "step", "from": c, "to": n, "dir": d})
	run_ops(f.get("on_pass", []), {"face": fi})
	after_enter(n, d)
	return {"ok": true}


func turn(delta: int) -> void:
	if s["mode"] in ["dead", "won"] or not dialog.is_empty():
		return
	s["dir"] = (int(s["dir"]) + delta + 4) & 3
	events.append({"t": "turn", "delta": delta})
	update_seen()


func after_enter(n: int, d: int) -> void:
	update_seen()
	update_plates()
	var c: Dictionary = lv.cells[n]
	var def: Dictionary = c.get("def", {})
	if c["type"] == "water":
		sfx("splash")
		for ci in living():
			var ch: Dictionary = s["party"][ci]
			if int(ch["st"]) > 0:
				ch["st"] = maxi(0, int(ch["st"]) - 3)
			else:
				damage_char(ci, 4, "drowning")
	if c["type"] == "teleport" and ls["tele"].get(str(n), true) and not _in_enter:
		run_ops(def.get("on_enter", []), {"cell": n})
		var t: Dictionary = def["teleport"]
		var cv: Vector2i = lv.cell_ref(t["at"])
		s["x"] = cv.x
		s["y"] = cv.y
		s["dir"] = Level.dir_of(String(t.get("dir", "N")))
		sfx("teleport")
		events.append({"t": "teleport"})
		_in_enter = true
		after_enter(cur_cell(), int(s["dir"]))
		_in_enter = false
		return
	if def.has("to"):
		var to: Dictionary = def["to"]
		if c["type"] == "pit":
			msg("The floor gives way!")
			sfx("fall")
			for ci in living():
				var mh: int = stats(s["party"][ci])["hp_max"]
				# the original: rnd(maxHP/2) + maxHP/3; halved here, see DESIGN.md
				damage_char(ci, rng.rnd(mh / 4) + mh / 6, "the fall")
		else:
			sfx("stairs")
		if s["mode"] == "dead":
			return
		enter_level(String(to["level"]), String(to["at"]), Level.dir_of(String(to.get("dir", "N"))))
		events.append({"t": "autosave"})
		return
	if c["type"] != "teleport":
		run_ops(def.get("on_enter", []), {"cell": n})


# ------------------------------------------------------------------ touching walls

## Space, or a click on the wall ahead. `hit` = the click landed on the fitting.
func touch() -> void:
	touch_face(cur_cell() * 4 + int(s["dir"]))


func touch_face(fi: int) -> void:
	if s["mode"] in ["dead", "won"]:
		return
	var f: Dictionary = lv.faces[fi]
	if f.is_empty():
		return
	var kind = String(f["kind"])
	if kind == "door" or kind == "gate":
		var key = str(lv.edge_key(fi))
		if f.has("lock") and not ls["unlocked"].has(key):
			var k = find_key(String(f["lock"]))
			if k == "":
				msg("It is locked.")
				sfx("locked")
				return
			ls["unlocked"][key] = true
			msg("Unlocked with the %s." % k)
			sfx("unlock")
		if kind == "gate":
			msg("The portcullis will not move by hand.")
			return
		door_do(fi, "toggle", {})
		return
	if f.has("niche"):
		niche_click(fi)
		return
	if f.has("switch"):
		var key = str(fi)
		var on = not bool(ls["switches"].get(key, false))
		ls["switches"][key] = on
		sfx("lever", fi >> 2)
		events.append({"t": "switch", "face": fi, "on": on})
		run_ops(f.get("on_touch", []), {"face": fi, "switch": on})
		return
	if f.get("fountain", false):
		for ci in living():
			var ch: Dictionary = s["party"][ci]
			ch["water"] = Rules.water_max(stats(ch)["hp_max"])
		msg("You drink deep. The water is cold and clean.")
		sfx("drink")
		return
	if f.has("on_touch"):
		run_ops(f["on_touch"], {"face": fi})
		return
	if kind == "wall" and s["mode"] == "explore":
		events.append({"t": "touch_wall"})


func find_key(lock: String) -> String:
	var cands = []
	if s["held"] != null:
		cands.append(s["held"])
	for ch in s["party"]:
		for it in ch["pack"]:
			if it != null:
				cands.append(it)
	for it in cands:
		if String(item_def(it).get("key", "")) == lock:
			return item_name(it)
	return ""


func niche_click(fi: int) -> void:
	var key = str(fi)
	var items: Array = ls["niches"].get(key, [])
	if s["held"] != null:
		items.append(s["held"])
		msg("You place the %s in the niche." % item_name(s["held"]))
		s["held"] = null
	elif not items.is_empty():
		s["held"] = items.pop_back()
		msg("You take the %s." % item_name(s["held"]))
		on_pickup()
	else:
		msg("The niche is empty.")
		return
	ls["niches"][key] = items
	sfx("item")
	run_ops(lv.faces[fi].get("on_niche", []), {"face": fi})


# ------------------------------------------------------------------ floor items

func pile_key(cell: int, corner: int) -> String:
	return str(cell * 4 + corner)


func pile(cell: int, corner: int) -> Array:
	return ls["items"].get(pile_key(cell, corner), [])


## Which floor piles can be reached from here: the front two corners of our own square
## and the near two of the square ahead (CLK_MAP.C:473-476).
func reachable_piles() -> Array:
	var d = int(s["dir"])
	var c = cur_cell()
	# corners in absolute terms: 0 NW, 1 NE, 2 SE, 3 SW; the front-left corner of a square
	# faced in direction d is corner d, front-right is d+1.
	var out = [[c, d], [c, (d + 1) & 3]]
	var f = front_cell()
	if f >= 0 and face_passable(c * 4 + d):
		out.append([f, (d + 3) & 3])
		out.append([f, (d + 2) & 3])
	return out


func pick(cell: int, corner: int) -> bool:
	if s["held"] != null:
		return drop(cell, corner)
	var p = pile(cell, corner)
	if p.is_empty():
		return false
	s["held"] = p.pop_back()
	if p.is_empty():
		ls["items"].erase(pile_key(cell, corner))
	sfx("item")
	on_pickup()
	update_plates()
	return true


func drop(cell: int, corner: int) -> bool:
	if s["held"] == null:
		return false
	var key = pile_key(cell, corner)
	if not ls["items"].has(key):
		ls["items"][key] = []
	ls["items"][key].append(s["held"])
	s["held"] = null
	sfx("drop")
	update_plates()
	return true


## Picking up a rune, money or a text scroll takes effect at once (do_items_specs).
func on_pickup() -> void:
	var it = s["held"]
	if it == null:
		return
	var d = item_def(it)
	match String(d.get("type", "")):
		"rune":
			var r = String(d["rune"])
			if not r in s["runes"]:
				s["runes"].append(r)
			msg("The party learns the %s rune." % content["spells"]["runes"][r]["name"])
			sfx("rune")
			s["held"] = null
		"money":
			var n = int(it.get("amount", 1))
			s["gold"] = int(s["gold"]) + n
			msg("%d coins." % n)
			sfx("coins")
			s["held"] = null
		"text":
			add_book(String(d["book"]))
			s["held"] = null


func add_book(entry: String) -> void:
	if entry in s["book"]:
		return
	s["book"].append(entry)
	msg("Added to the book: %s." % content["book"][entry]["title"])
	events.append({"t": "book"})


## Pressure plates are pressed by the party, a monster or any item (REALGAME.C:522-551).
func update_plates() -> void:
	for key in ls["plates"].keys():
		var c = int(key)
		var pressed = c == cur_cell() or not monsters_at(c).is_empty()
		for k in 4:
			if not pile(c, k).is_empty():
				pressed = true
		if pressed != bool(ls["plates"][key]):
			ls["plates"][key] = pressed
			sfx("plate", c)
			var def: Dictionary = lv.cells[c].get("def", {})
			run_ops(def.get("on_press" if pressed else "on_release", []), {"cell": c})


# ------------------------------------------------------------------ inventory

func pack_add(ch: Dictionary, it: Dictionary) -> bool:
	for i in PACK_SIZE:
		if ch["pack"][i] == null:
			ch["pack"][i] = it
			return true
	return false


func weight_of(ch: Dictionary) -> int:
	var w10 = 0
	for it in ch["pack"]:
		if it != null:
			w10 += int(item_def(it).get("weight", 0)) * 15
	for slot in ch["equip"]:
		if ch["equip"][slot] != null:
			w10 += int(item_def(ch["equip"][slot]).get("weight", 0)) * 10
	return w10


func weight_defect(ch: Dictionary) -> int:
	return Rules.weight_defect(weight_of(ch), int(stats(ch)["str"]))


func meets_req(ch: Dictionary, it) -> String:
	var st = stats(ch)
	var req: Dictionary = item_def(it).get("req", {})
	for k in req:
		if int(st[k]) < int(req[k]):
			return "%s needs %s %d." % [item_name(it), String(k).to_upper(), int(req[k])]
	return ""


func slot_fits(it, slot: String) -> bool:
	var want = String(item_def(it).get("slot", ""))
	match slot:
		"hand_r":
			return want == "hand" or want == "two_hand"
		"hand_l":
			return want == "hand"
		"ring1", "ring2":
			return want == "ring"
	return want == slot


## Clicking a paper-doll slot with or without a held item (human_click, INV.C:2079-2177).
func equip_click(ci: int, slot: String) -> bool:
	var ch: Dictionary = s["party"][ci]
	if ch["dead"]:
		return false
	var held = s["held"]
	if slot == "quiver":
		if held == null:
			if int(ch["quiver"]) > 0:
				s["held"] = {"id": "arrows", "amount": ch["quiver"]}
				ch["quiver"] = 0
				return true
			return false
		if String(held["id"]) == "arrows":
			ch["quiver"] = mini(99, int(ch["quiver"]) + int(held.get("amount", 1)))
			s["held"] = null
			sfx("item")
			return true
		return false
	if held == null:
		var cur = ch["equip"].get(slot)
		if cur == null:
			return false
		s["held"] = cur
		ch["equip"].erase(slot)
		sfx("item")
		return true
	if not slot_fits(held, slot):
		msg("That does not go there.")
		return false
	var why = meets_req(ch, held)
	if why != "":
		msg(why)
		return false
	var two = String(item_def(held).get("slot", "")) == "two_hand"
	if two and ch["equip"].get("hand_l") != null:
		if not pack_add(ch, ch["equip"]["hand_l"]):
			msg("No room in the pack for the other hand's item.")
			return false
		ch["equip"].erase("hand_l")
	if slot == "hand_l" and ch["equip"].get("hand_r") != null and String(item_def(ch["equip"]["hand_r"]).get("slot", "")) == "two_hand":
		msg("Both hands are busy.")
		return false
	var old = ch["equip"].get(slot)
	ch["equip"][slot] = held
	s["held"] = old
	sfx("wear")
	clamp_pools(ch)
	return true


func pack_click(ci: int, idx: int) -> bool:
	var ch: Dictionary = s["party"][ci]
	var old = ch["pack"][idx]
	var held = s["held"]
	if held != null and old != null and String(held["id"]) == String(old["id"]) and item_def(held).get("stack", false):
		old["amount"] = int(old.get("amount", 1)) + int(held.get("amount", 1))
		s["held"] = null
		return true
	ch["pack"][idx] = held
	s["held"] = old
	if old != null or held != null:
		sfx("item")
	return true


## Give the held item to a character (a click on the portrait with an item in hand).
func give_held(ci: int) -> bool:
	if s["held"] == null:
		return false
	var ch: Dictionary = s["party"][ci]
	if String(s["held"]["id"]) == "arrows" and ch["equip"].get("hand_r") != null and String(item_def(ch["equip"]["hand_r"]).get("type", "")) == "ranged":
		return equip_click(ci, "quiver")
	if pack_add(ch, s["held"]):
		s["held"] = null
		sfx("item")
		return true
	msg("%s's pack is full." % ch["name"])
	return false


## Use a pack item (potions, food) or the held item on a character.
func use_item(ci: int, idx: int) -> bool:
	var ch: Dictionary = s["party"][ci]
	var it = s["held"] if idx < 0 else ch["pack"][idx]
	if it == null:
		return false
	if ch["dead"]:
		msg("%s is beyond help from that." % ch["name"])
		return false
	var d = item_def(it)
	match String(d.get("type", "")):
		"potion":
			magic.item_spell(String(d["spell"]), ci)
			sfx("potion")
		"food":
			ch["food"] = mini(Rules.food_max(stats(ch)["hp_max"]), int(ch["food"]) + int(d.get("hours", 24)) * Rules.HOUR)
			msg("%s eats the %s." % [ch["name"], d["name"]])
			sfx("eat")
		_:
			msg("%s cannot use that." % ch["name"])
			return false
	if idx < 0:
		s["held"] = null
	else:
		ch["pack"][idx] = null
	return true


func clamp_pools(ch: Dictionary) -> void:
	var st = stats(ch)
	ch["hp"] = mini(int(ch["hp"]), int(st["hp_max"]))
	ch["mp"] = mini(int(ch["mp"]), int(st["mp_max"]))
	ch["st"] = mini(int(ch["st"]), int(st["st_max"]))


func party_has(iid: String) -> bool:
	if s["held"] != null and String(s["held"]["id"]) == iid:
		return true
	for ch in s["party"]:
		for it in ch["pack"]:
			if it != null and String(it["id"]) == iid:
				return true
		for slot in ch["equip"]:
			if ch["equip"][slot] != null and String(ch["equip"][slot]["id"]) == iid:
				return true
	return false


func party_take(iid: String) -> bool:
	if s["held"] != null and String(s["held"]["id"]) == iid:
		s["held"] = null
		return true
	for ch in s["party"]:
		for i in PACK_SIZE:
			if ch["pack"][i] != null and String(ch["pack"][i]["id"]) == iid:
				ch["pack"][i] = null
				return true
	return false


# ------------------------------------------------------------------ characters

func damage_char(ci: int, amount: int, cause: String = "") -> void:
	var ch: Dictionary = s["party"][ci]
	if ch["dead"] or amount == 0:
		return
	if amount < 0:
		ch["hp"] = mini(int(stats(ch)["hp_max"]), int(ch["hp"]) - amount)
		return
	ch["hp"] = int(ch["hp"]) - amount
	events.append({"t": "hurt", "ci": ci, "dmg": amount})
	if int(ch["hp"]) <= 0:
		kill_char(ci, cause)


## Death is final until raised (SOUBOJE.C:2335): XP falls back to the start of the level.
func kill_char(ci: int, cause: String) -> void:
	var ch: Dictionary = s["party"][ci]
	ch["hp"] = 0
	ch["mp"] = 0
	ch["st"] = 0
	ch["dead"] = true
	ch["effects"] = []
	ch["xp"] = 0 if int(ch["level"]) <= 1 else int(Rules.LEVEL_XP[int(ch["level"]) - 2])
	msg("%s dies%s." % [ch["name"], (" of " + cause) if cause != "" else ""])
	sfx("death")
	events.append({"t": "death", "ci": ci})
	if living().is_empty():
		s["mode"] = "dead"
		events.append({"t": "party_dead"})


func gain_xp(ch: Dictionary, amount: int, quiet: bool = false) -> void:
	if ch["dead"] or amount <= 0:
		return
	ch["xp"] = int(ch["xp"]) + amount
	while int(ch["level"]) < Rules.MAX_LEVEL and int(ch["xp"]) >= Rules.xp_for_next(int(ch["level"])):
		ch["level"] = int(ch["level"]) + 1
		ch["points"] = int(ch["points"]) + 5
		_hidden_gains(ch)
		if not quiet:
			msg("%s reaches level %d!" % [ch["name"], ch["level"]])
			sfx("levelup")


## Hidden level gains (rozdelit_skryte_bonusy): rank STR, MAG, DEX; the top one gives
## rnd(5)+1, the second rnd(3)+1, the third 1, to HP, mana and stamina respectively.
func _hidden_gains(ch: Dictionary) -> void:
	var b: Dictionary = ch["base"]
	var order = [["str", "hp_max"], ["mag", "mp_max"], ["dex", "st_max"]]
	order.sort_custom(func(p, q): return int(b[p[0]]) > int(b[q[0]]))
	var gains = [rng.rnd(5) + 1, rng.rnd(3) + 1, 1]
	for i in 3:
		if order[i][0] == "mag" and int(b["mag"]) <= 0:
			continue
		b[order[i][1]] = int(b[order[i][1]]) + gains[i]
		if order[i][1] == "hp_max":
			ch["hp"] = int(ch["hp"]) + gains[i]


## Spend a bonus point (advance_vls, INV.C:1582-1622): +1 to the stat, and the stats it
## drives rise by the difference of the floored products.
func raise_stat(ci: int, stat: String) -> bool:
	var ch: Dictionary = s["party"][ci]
	var b: Dictionary = ch["base"]
	if int(ch["points"]) <= 0 or not stat in ["str", "mag", "mob", "dex"] or int(b[stat]) >= 100:
		return false
	var o = int(b[stat])
	var n = o + 1
	b[stat] = n
	ch["points"] = int(ch["points"]) - 1
	match stat:
		"str":
			b["hp_max"] = int(b["hp_max"]) + int(1.5 * n) - int(1.5 * o)
			b["hp_reg"] = int(b["hp_reg"]) + int(0.08 * n) - int(0.08 * o)
		"mag":
			b["mp_max"] = int(b["mp_max"]) + 2
			b["mp_reg"] = int(b["mp_reg"]) + int(0.1 * n) - int(0.1 * o)
		"mob":
			b["hp_max"] = int(b["hp_max"]) + int(0.5 * n) - int(0.5 * o)
			b["st_max"] = int(b["st_max"]) + int(0.25 * n) - int(0.25 * o)
		"dex":
			b["st_max"] = int(b["st_max"]) + int(0.5 * n) - int(0.5 * o)
			b["st_reg"] = int(b["st_reg"]) + int(0.1 * n) - int(0.1 * o)
	return true


func weapon_family(ch: Dictionary) -> String:
	var it = ch["equip"].get("hand_r")
	if it == null:
		return "other"
	return String(item_def(it).get("weapon", "other"))


func skill_level(ch: Dictionary, fam: String) -> int:
	return int(ch["skill"].get(fam, 0))


func skill_hit(ch: Dictionary, fam: String) -> void:
	var lvl = skill_level(ch, fam)
	if lvl >= Rules.SKILL_MAX:
		return
	var n = int(ch["skill_hits"].get(fam, 0)) + 1
	ch["skill_hits"][fam] = n
	if n >= Rules.skill_threshold(lvl):
		ch["skill"][fam] = lvl + 1
		msg("%s grows more skilled with the %s (%d)." % [ch["name"], fam, lvl + 1])


func join(cid: String) -> void:
	if s["party"].size() >= MAX_PARTY:
		msg("The party is full.")
		return
	s["party"].append(make_character(cid))
	for m in ls["monsters"].duplicate():
		if String(m["id"]) == cid:
			ls["monsters"].erase(m)
	msg("%s joins the party." % content["party"]["characters"][cid]["name"])
	events.append({"t": "join", "id": cid})


# ------------------------------------------------------------------ monsters in the world

func monsters_at(cell: int) -> Array:
	var out = []
	for m in ls.get("monsters", []):
		if int(m["cell"]) == cell:
			out.append(m)
	return out


func monster_by_uid(uid: int):
	for m in ls["monsters"]:
		if int(m["uid"]) == uid:
			return m
	return null


func monster_can_enter(m: Dictionary, cell: int) -> bool:
	if cell < 0 or cell == cur_cell():
		return false
	var c: Dictionary = lv.cells[cell]
	if c["type"] in ["pit", "stairs", "teleport"]:
		return false
	if c["type"] == "water" and not mflag(m, "fly"):
		return false
	var here = monsters_at(cell)
	if here.is_empty():
		return true
	if mflag(m, "big"):
		return false
	if here.size() >= 2:
		return false
	for o in here:
		if mflag(o, "big") or mflag(o, "npc"):
			return false
	return true


## Does monster m see the party (q_vidis_postavu, ENEMY.C:545): within sight, in the
## half-plane it faces, with a clear line.
func sees_party(m: Dictionary) -> bool:
	var t = mtemplate(m)
	var mc = int(m["cell"])
	var pc = cur_cell()
	var dx = pc % lv.w - mc % lv.w
	var dy = pc / lv.w - mc / lv.w
	if maxi(absi(dx), absi(dy)) > int(t["sight"]):
		return false
	var d = int(m["dir"])
	if dx * DX[d] + dy * DY[d] < 0:
		return false
	return line_clear(mc, pc, true)


## Breadth-first step toward a goal through faces monsters may pass.
func path_step(m: Dictionary, goal: int, limit: int = 24) -> int:
	var start = int(m["cell"])
	if start == goal:
		return -1
	var prev = {start: -1}
	var q = [start]
	var steps = 0
	while not q.is_empty() and steps < 600:
		steps += 1
		var c: int = q.pop_front()
		for d in 4:
			if not face_passable(c * 4 + d):
				continue
			var n: int = lv.neighbour(c, d)
			if n < 0 or prev.has(n):
				continue
			if n == goal:
				prev[n] = c
				var cur = n
				while prev[cur] != start:
					cur = prev[cur]
				return cur
			if not monster_can_enter(m, n):
				continue
			prev[n] = c
			if dist(start, n) <= limit:
				q.append(n)
	return -1


func dir_to(a: int, b: int) -> int:
	var dx = b % lv.w - a % lv.w
	var dy = b / lv.w - a / lv.w
	if absi(dx) >= absi(dy):
		return 1 if dx > 0 else 3
	return 2 if dy > 0 else 0


func move_monster(m: Dictionary, to: int) -> void:
	var from = int(m["cell"])
	m["dir"] = dir_to(from, to)
	m["from"] = from
	m["cell"] = to
	events.append({"t": "mob_move", "uid": m["uid"], "from": from, "to": to})
	update_plates()


## Noise wakes listening monsters (sirit_zvuk, ENEMY.C:1756).
func noise(cell: int, radius: int) -> void:
	for m in ls.get("monsters", []):
		if mflag(m, "listen") and dist(int(m["cell"]), cell) <= radius:
			m["alert"] = cell


func world_monsters() -> void:
	for m in ls["monsters"].duplicate():
		if mflag(m, "npc") or not ls["monsters"].has(m):
			continue
		var t = mtemplate(m)
		m["cd"] = int(m["cd"]) - 1
		if int(m["cd"]) > 0:
			continue
		m["cd"] = maxi(1, int(t["step_ticks"]) * (2 if int(m["fear"]) > 0 else 1))
		if mflag(m, "watch") and sees_party(m):
			m["hunt"] = true
			m["alert"] = -1
			var pc = cur_cell()
			var mc = int(m["cell"])
			var d = dir_to(mc, pc)
			var adjacent = dist(mc, pc) == 1 and face_passable(mc * 4 + d)
			var ranged: bool = (mflag(m, "shoot") or mflag(m, "cast")) and int(t["reach"]) > 1 and (mc % lv.w == pc % lv.w or mc / lv.w == pc / lv.w) and dist(mc, pc) <= int(t["reach"]) and line_clear(mc, pc, false)
			if adjacent or ranged:
				m["dir"] = d
				var front: bool = lv.neighbour(pc, int(s["dir"])) == mc or (ranged and dir_to(pc, mc) == int(s["dir"]))
				battle.start(m, not front)
				return
			if not mflag(m, "stay"):
				var nx = path_step(m, pc)
				if nx >= 0:
					move_monster(m, nx)
			continue
		if int(m["alert"]) >= 0:
			var nx = path_step(m, int(m["alert"]), 8)
			if nx >= 0 and nx != int(m["alert"]):
				move_monster(m, nx)
			else:
				m["dir"] = dir_to(int(m["cell"]), int(m["alert"]))
				m["alert"] = -1
			continue
		if mflag(m, "guard") and int(m["cell"]) != int(m["home"]):
			var nx = path_step(m, int(m["home"]))
			if nx >= 0:
				move_monster(m, nx)
				continue
		if mflag(m, "walk"):
			_wander(m)


## Patrol: keep going while the way is free, pick a random exit at junctions, turn
## around at dead ends (rozhodni_o_smeru, ENEMY.C:806).
func _wander(m: Dictionary) -> void:
	var c = int(m["cell"])
	var d = int(m["dir"])
	var opts = []
	for k in [0, 1, 3]:
		var nd = (d + k) & 3
		if face_passable(c * 4 + nd) and monster_can_enter(m, lv.neighbour(c, nd)):
			opts.append(nd)
	if opts.is_empty():
		m["dir"] = (d + 2) & 3
		return
	var nd: int = opts[0] if (opts.size() == 1 or (opts.has(d) and rng.rnd(3) > 0)) else opts[rng.rnd(opts.size())]
	if not opts.has(d) or nd != d:
		pass
	move_monster(m, lv.neighbour(c, nd))


# ------------------------------------------------------------------ time

## One world tick (100 ms): doors, delayed actions, monsters; every 100 ticks a game
## tick (10 s) with regeneration, hunger and spell durations.
func tick() -> void:
	if s["mode"] in ["dead", "won"]:
		return
	s["tick"] = int(s["tick"]) + 1
	for key in ls["doors"]:
		var d: Dictionary = ls["doors"][key]
		var p = float(d["p"])
		var to = float(d["to"])
		if p != to:
			p = move_toward(p, to, DOOR_SPEED)
			d["p"] = p
			if p == to:
				events.append({"t": "door_done", "edge": int(key)})
				update_seen()
	var fired = []
	for t in ls["timers"]:
		t["t"] = int(t["t"]) - 1
		if int(t["t"]) <= 0:
			fired.append(t)
	for t in fired:
		ls["timers"].erase(t)
		run_ops(t["ops"], {})
	if s["mode"] == "explore" and dialog.is_empty() and shop.is_empty():
		world_monsters()
	if int(s["tick"]) % TICKS_PER_GAME_TICK == 0 and s["mode"] == "explore":
		game_tick()


func game_tick() -> void:
	s["time"] = int(s["time"]) + 1
	s["sleep"] = mini(Rules.MAX_SLEEP, int(s["sleep"]) + Rules.MAX_SLEEP / 30)
	if int(s["omen"]) > 0:
		s["omen"] = int(s["omen"]) - 1
	for ci in living():
		var ch: Dictionary = s["party"][ci]
		var st = stats(ch)
		ch["food"] = maxi(0, int(ch["food"]) - 1)
		ch["water"] = maxi(0, int(ch["water"]) - 1)
		if int(ch["water"]) <= 0:
			damage_char(ci, 1, "thirst")
			continue
		if int(ch["food"]) <= 0:
			continue
		ch["st"] = mini(int(st["st_max"]), int(ch["st"]) + ceili(int(st["st_reg"]) / 10.0))
		ch["mp"] = mini(int(st["mp_max"]), int(ch["mp"]) + ceili(int(st["mp_reg"]) / 10.0))
	magic.tick_effects()


## Sleep hour by hour (sleep_players, REALGAME.C:1856): full regeneration per hour; a
## prowling monster may interrupt.
func rest(max_hours: int = 12) -> Dictionary:
	if s["mode"] != "explore":
		return {"hours": 0, "why": "not now"}
	for m in ls["monsters"]:
		if not mflag(m, "npc") and (bool(m["hunt"]) and sees_party(m)):
			msg("You cannot rest with enemies near.")
			return {"hours": 0, "why": "enemies"}
	var hours = 0
	var why = "rested"
	while hours < max_hours:
		if int(s["sleep"]) < Rules.HOUR:
			why = "not tired"
			break
		var all_full = true
		for ci in living():
			var ch: Dictionary = s["party"][ci]
			var st = stats(ch)
			if int(ch["hp"]) < int(st["hp_max"]) or int(ch["mp"]) < int(st["mp_max"]) or int(ch["st"]) < int(st["st_max"]):
				all_full = false
		if all_full:
			break
		var hungry = false
		for ci in living():
			if int(s["party"][ci]["food"]) < Rules.HOUR or int(s["party"][ci]["water"]) < Rules.HOUR:
				hungry = true
		if hungry:
			why = "hunger"
			msg("Hunger and thirst keep you awake.")
			break
		hours += 1
		s["time"] = int(s["time"]) + Rules.HOUR
		s["sleep"] = int(s["sleep"]) - Rules.HOUR
		for ci in living():
			var ch: Dictionary = s["party"][ci]
			var st = stats(ch)
			ch["food"] = int(ch["food"]) - Rules.HOUR
			ch["water"] = int(ch["water"]) - Rules.HOUR
			ch["hp"] = mini(int(st["hp_max"]), int(ch["hp"]) + maxi(1, int(st["hp_reg"])))
			ch["mp"] = mini(int(st["mp_max"]), int(ch["mp"]) + int(st["mp_reg"]))
			ch["st"] = mini(int(st["st_max"]), int(ch["st"]) + int(st["st_reg"]))
		for k in Rules.HOUR:
			magic.tick_effects()
			if k > 40:
				break
		var intruder = _prowler()
		if intruder != null:
			msg("You are woken by a %s!" % mtemplate(intruder)["name"].to_lower())
			why = "interrupted"
			battle.start(intruder, dir_to(cur_cell(), int(intruder["cell"])) != int(s["dir"]))
			break
	if hours > 0:
		msg("You rest for %d hour%s." % [hours, "" if hours == 1 else "s"])
	events.append({"t": "rest", "hours": hours})
	return {"hours": hours, "why": why}


func _prowler():
	for m in ls["monsters"]:
		if mflag(m, "npc") or mflag(m, "stay") or not (mflag(m, "walk") or mflag(m, "watch")):
			continue
		if dist(int(m["cell"]), cur_cell()) > 8 or rng.rnd(100) >= 8:
			continue
		for d in 4:
			var n = lv.neighbour(cur_cell(), d)
			if n >= 0 and face_passable(cur_cell() * 4 + d) and monster_can_enter(m, n) and path_step(m, n, 12) >= 0:
				m["cell"] = n
				m["from"] = n
				m["dir"] = (d + 2) & 3
				return m
	return null


# ------------------------------------------------------------------ scripts

func run_ops(ops: Array, ctx: Dictionary) -> void:
	for op in ops:
		if not run_op(op, ctx):
			return


func run_op(op: Dictionary, ctx: Dictionary) -> bool:
	match String(op["op"]):
		"once":
			if s["once"].has(op["key"]):
				return false
			s["once"][op["key"]] = true
		"msg":
			msg(String(op["text"]))
		"book":
			add_book(String(op["entry"]))
		"door":
			door_do(lv.face_ref(String(op["face"])), String(op["do"]), ctx)
		"teleports":
			for ref in op["cells"]:
				var cv: Vector2i = lv.cell_ref(ref)
				var key = str(lv.idx(cv.x, cv.y))
				match String(op["do"]):
					"on": ls["tele"][key] = true
					"off": ls["tele"][key] = false
					"switch_off": ls["tele"][key] = not ctx.get("switch", false)
		"flag":
			var v = op.get("value", true)
			if op.has("switch"):
				v = bool(ls["switches"].get(str(lv.face_ref(String(op["switch"]))), false))
			s["flags"][String(op["set"])] = v
		"if":
			if cond(op["cond"], ctx):
				run_ops(op.get("then", []), ctx)
			else:
				run_ops(op.get("else", []), ctx)
		"give":
			var it = {"id": op["item"]}
			if op.has("amount"):
				it["amount"] = op["amount"]
			if s["held"] == null:
				s["held"] = it
				on_pickup()
			else:
				var key = pile_key(cur_cell(), int(s["dir"]))
				if not ls["items"].has(key):
					ls["items"][key] = []
				ls["items"][key].append(it)
		"take":
			party_take(String(op["item"]))
		"gold":
			s["gold"] = maxi(0, int(s["gold"]) + int(op["amount"]))
		"wound":
			for ci in living():
				damage_char(ci, int(op["min"]) + rng.rnd(int(op["max"]) - int(op["min"]) + 1), String(op.get("cause", "")))
		"xp":
			for ci in living():
				gain_xp(s["party"][ci], int(op["amount"]))
		"rune":
			if not String(op["id"]) in s["runes"]:
				s["runes"].append(String(op["id"]))
		"sound":
			sfx(String(op["sfx"]))
		"spawn":
			var cv: Vector2i = lv.cell_ref(op["at"])
			ls["monsters"].append(new_monster(String(op["id"]), lv.idx(cv.x, cv.y), Level.dir_of(String(op.get("dir", "S")))))
		"shop":
			open_shop(String(op["id"]))
		"dialog":
			start_dialog(String(op["id"]))
		"join":
			join(String(op["id"]))
		"teleport":
			var cv: Vector2i = lv.cell_ref(op["at"])
			s["x"] = cv.x
			s["y"] = cv.y
			if op.has("dir"):
				s["dir"] = Level.dir_of(String(op["dir"]))
			events.append({"t": "teleport"})
			update_seen()
		"level":
			enter_level(String(op["level"]), String(op.get("at", "")), Level.dir_of(String(op.get("dir", "N"))))
		"delay":
			ls["timers"].append({"t": int(op["ticks"]), "ops": op["then"]})
		"end_game":
			s["mode"] = "won"
			events.append({"t": "won"})
		_:
			push_warning("unknown script op " + String(op["op"]))
	return true


func cond(c: Dictionary, ctx: Dictionary) -> bool:
	for k in c:
		var v = c[k]
		match String(k):
			"switch":
				if not bool(ls["switches"].get(str(lv.face_ref(String(v))), false)):
					return false
			"switches":
				for ref in v:
					if not bool(ls["switches"].get(str(lv.face_ref(String(ref))), false)):
						return false
			"flag":
				if not bool(s["flags"].get(String(v), false)):
					return false
			"not_flag":
				if bool(s["flags"].get(String(v), false)):
					return false
			"item":
				if not party_has(String(v)):
					return false
			"gold":
				if int(s["gold"]) < int(v):
					return false
			"party_lt":
				if s["party"].size() >= int(v):
					return false
			"rune":
				if not String(v) in s["runes"]:
					return false
			"niche_has":
				var found = false
				for it in ls["niches"].get(str(lv.face_ref(String(c["face"]))), []):
					if String(it["id"]) == String(v):
						found = true
				if not found:
					return false
			"face":
				pass
	return true


# ------------------------------------------------------------------ dialogue and shops

func talk_front() -> bool:
	for m in monsters_at(front_cell()):
		if mtemplate(m).has("dialog") and line_clear(cur_cell(), int(m["cell"]), true):
			start_dialog(String(mtemplate(m)["dialog"]))
			return true
	return false


func start_dialog(id: String) -> void:
	var d: Dictionary = content["dialogs"][id]
	dialog = {"id": id, "node": ""}
	_goto_node(String(d["start"]))


func _goto_node(node: String) -> void:
	if node == "end" or node == "":
		dialog = {}
		events.append({"t": "dialog_end"})
		return
	var nodes: Dictionary = content["dialogs"][dialog["id"]]["nodes"]
	var n: Dictionary = nodes[node]
	if n.has("if_flag") and not bool(s["flags"].get(String(n["if_flag"]), false)):
		_goto_node(String(n["else"]))
		return
	dialog["node"] = node
	events.append({"t": "dialog", "id": dialog["id"], "node": node})


func dialog_text() -> String:
	if dialog.is_empty():
		return ""
	var t = String(content["dialogs"][dialog["id"]]["nodes"][dialog["node"]]["text"])
	var speaker: String = s["party"][living()[0]]["name"] if not living().is_empty() else ""
	return t.replace("%n", speaker)


func dialog_choices() -> Array:
	var out = []
	if dialog.is_empty():
		return out
	var n: Dictionary = content["dialogs"][dialog["id"]]["nodes"][dialog["node"]]
	for i in n.get("choices", []).size():
		var ch: Dictionary = n["choices"][i]
		if ch.has("if") and not cond(ch["if"], {}):
			continue
		out.append({"i": i, "text": ch["text"]})
	return out


func dialog_choose(i: int) -> void:
	if dialog.is_empty():
		return
	var n: Dictionary = content["dialogs"][dialog["id"]]["nodes"][dialog["node"]]
	var ch: Dictionary = n["choices"][i]
	var next = String(ch.get("goto", "end"))
	run_ops(ch.get("do", []), {})
	if not dialog.is_empty():
		_goto_node(next)


func open_shop(id: String) -> void:
	if not s["shops"].has(id):
		var stock = []
		for e in content["shops"][id]["stock"]:
			stock.append({"id": e["id"], "count": int(e["count"])})
		s["shops"][id] = stock
	shop = {"id": id}
	events.append({"t": "shop", "id": id})


func shop_price(iid: String, buying: bool) -> int:
	var f = int(content["shops"][shop["id"]]["factor"])
	var v = int(content["items"][iid].get("value", 0))
	var bundle = 10 if content["items"][iid].get("stack", false) else 1
	return maxi(1, v * bundle * (100 + f) / 100) if buying else v * bundle * (100 - f) / 100


func shop_buy(idx: int) -> bool:
	var stock: Array = s["shops"][shop["id"]]
	var e: Dictionary = stock[idx]
	if int(e["count"]) <= 0 or s["held"] != null:
		return false
	var price = shop_price(String(e["id"]), true)
	if int(s["gold"]) < price:
		msg("You cannot afford that.")
		return false
	s["gold"] = int(s["gold"]) - price
	var it = {"id": e["id"]}
	if content["items"][e["id"]].get("stack", false):
		it["amount"] = mini(10, int(e["count"]))
		e["count"] = int(e["count"]) - int(it["amount"])
	else:
		e["count"] = int(e["count"]) - 1
	s["held"] = it
	sfx("coins")
	return true


func shop_sell() -> bool:
	var it = s["held"]
	if it == null:
		return false
	var d = item_def(it)
	if int(d.get("value", 0)) <= 0 or d.get("type", "") in ["key", "quest"]:
		msg("The peddler shakes her head at that.")
		return false
	var amount = int(it.get("amount", 1))
	var price = int(d["value"]) * amount * (100 - int(content["shops"][shop["id"]]["factor"])) / 100
	s["gold"] = int(s["gold"]) + price
	s["held"] = null
	msg("Sold for %d coins." % price)
	sfx("coins")
	return true


func close_shop() -> void:
	shop = {}


# ------------------------------------------------------------------ saving

func to_save() -> Dictionary:
	s["rng"] = rng.state
	return s.duplicate(true)


func from_save(d: Dictionary) -> void:
	s = d.duplicate(true)
	rng = Rng.new(int(s["rng"]))
	lv = level_static(String(s["level"]))
	ls = s["levels"][s["level"]]
	dialog = {}
	shop = {}
	events.append({"t": "level", "id": s["level"]})
	events.append({"t": "loaded"})


func pop_events() -> Array:
	var e = events
	events = []
	return e
