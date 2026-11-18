## A scripted player for the headless tests. It walks by breadth-first search over the
## current level, opens doors on its way, fights with a simple policy, and follows a
## route of goals (tests/walkthrough.gd). It drives only the public core API, the same
## calls the view makes.
extends RefCounted

const Level = preload("res://scripts/core/level.gd")

var g
var log_lines: Array = []
var verbose := false
var rounds := 0
var steps := 0


func _init(game) -> void:
	g = game


func say(t: String) -> void:
	log_lines.append(t)
	if verbose:
		print(t)


func drain() -> void:
	for e in g.pop_events():
		if e["t"] == "msg":
			say("  | " + String(e["text"]))


func ticks(n: int) -> void:
	for i in n:
		g.tick()
		if g.s["mode"] == "battle":
			fight()
	drain()


func cell_of(ref) -> int:
	var v: Vector2i = g.lv.cell_ref(ref)
	return g.lv.idx(v.x, v.y)


func face_dir(d: int) -> void:
	var cur := int(g.s["dir"])
	if cur == d:
		return
	if ((cur + 1) & 3) == d:
		g.turn(1)
	elif ((cur + 3) & 3) == d:
		g.turn(-1)
	else:
		g.turn(1)
		g.turn(1)
	drain()


func _step_ok(c: int, d: int, goal: int) -> bool:
	var fi: int = c * 4 + d
	var f: Dictionary = g.lv.faces[fi]
	if f.is_empty():
		return false
	var n: int = g.lv.neighbour(c, d)
	if n < 0:
		return false
	var passable: bool = g.face_passable(fi)
	if not passable:
		if f["kind"] != "door":
			return false
		if f.has("lock") and not g.ls["unlocked"].has(str(g.lv.edge_key(fi))) and g.find_key(String(f["lock"])) == "":
			return false
	if n != goal:
		var t: String = g.lv.cells[n]["type"]
		if t in ["pit", "stairs"]:
			return false
		if t == "teleport" and bool(g.ls["tele"].get(str(n), true)):
			return false
	return true


func route(goal: int) -> Array:
	var start: int = g.cur_cell()
	var prev := {start: [-1, -1]}
	var q := [start]
	while not q.is_empty():
		var c: int = q.pop_front()
		if c == goal:
			break
		for d in 4:
			if not _step_ok(c, d, goal):
				continue
			var n: int = g.lv.neighbour(c, d)
			if prev.has(n):
				continue
			prev[n] = [c, d]
			q.append(n)
	if not prev.has(goal):
		return []
	var dirs := []
	var cur := goal
	while cur != start:
		dirs.push_front(prev[cur][1])
		cur = prev[cur][0]
	return dirs


## Walk to a square (anchor or "x,y"), then face `face` if given.
func goto(ref, face: String = "") -> bool:
	var goal := cell_of(ref)
	var guard := 0
	while g.cur_cell() != goal:
		guard += 1
		if guard > 200 or g.s["mode"] in ["dead", "won"]:
			say("goto %s failed at %d" % [str(ref), g.cur_cell()])
			return false
		var path := route(goal)
		if path.is_empty():
			say("no route to %s from %d,%d" % [str(ref), g.s["x"], g.s["y"]])
			return false
		var d: int = path[0]
		face_dir(d)
		var fi: int = g.cur_cell() * 4 + d
		if not g.face_passable(fi):
			g.touch()
			ticks(6)
			continue
		var level_before: String = g.s["level"]
		var r: Dictionary = g.step(0)
		steps += 1
		drain()
		if g.s["mode"] == "battle":
			fight()
		if g.s["level"] != level_before:
			return true
		if not r.get("ok", false):
			ticks(3)
			continue
		ticks(2)
		rest_if_needed()
	if face != "":
		face_dir(Level.dir_of(face))
	return true


func touch(face: String) -> void:
	face_dir(Level.dir_of(face))
	g.touch()
	ticks(6)


## Pick up everything at a corner of the current square and hand it to the party.
func take(corner: int) -> void:
	face_dir(corner)   # facing d reaches corners d and d+1
	var n: int = g.pile(g.cur_cell(), corner).size()
	for i in n:
		if g.pile(g.cur_cell(), corner).is_empty():
			break
		g.pick(g.cur_cell(), corner)
		drain()
		stow((corner + 1) & 3)


## Put whatever is held somewhere sensible: equipment onto whoever it suits, the rest
## into the first pack with room.
func stow(spare_corner: int = -1) -> void:
	var it = g.s["held"]
	if it == null:
		return
	var d: Dictionary = g.item_def(it)
	if String(it["id"]) == "arrows":
		for ci in g.living():
			if String(g.item_def(g.s["party"][ci]["equip"].get("hand_r", {"id": ""})).get("type", "")) == "ranged":
				g.equip_click(ci, "quiver")
				return
	var wants := {"mail": "brann", "boots": "maren", "amulet": "ilsa", "ring_ember": "ilsa", "helm": "brann", "axe": ""}
	var who := String(wants.get(String(it["id"]), ""))
	if who != "":
		for ci in g.living():
			if g.s["party"][ci]["id"] == who:
				var slot := String(d.get("slot", ""))
				if slot == "ring":
					slot = "ring1"
				if g.equip_click(ci, slot):
					if g.s["held"] != null:
						break
					return
	for ci in g.living():
		if g.give_held(ci):
			return
	g.drop(g.cur_cell(), spare_corner if spare_corner >= 0 else int(g.s["dir"]))


func has_spell(id: String) -> bool:
	return id in g.magic.known_spells()


## Battle policy: heal the badly hurt, casters use their best affordable spell, the rest
## attack whatever is in front. Adjacent monsters out of line are faced first (turning
## is free, as in the original).
func fight() -> void:
	var guard := 0
	while g.s["mode"] == "battle":
		guard += 1
		if guard > 150:
			say("battle did not end")
			return
		rounds += 1
		_face_threat()
		# close in on a lone enemy standing off down the corridor (melee needs contact)
		var lt = g.battle.line_target()
		if g.battle.front_monsters().is_empty() and lt != null and g.monsters_at(g.front_cell()).is_empty() and g.face_passable(g.cur_cell() * 4 + int(g.s["dir"])):
			g.step(0)
			drain()
			continue
		for ci in g.living():
			g.battle.plan(ci, _choose(ci))
		g.battle.resolve_round()
		drain()
	rest_if_needed()


func _face_threat() -> void:
	if not g.battle.front_monsters().is_empty():
		return
	var pc: int = g.cur_cell()
	for d in 4:
		if g.face_passable(pc * 4 + d):
			for m in g.monsters_at(g.lv.neighbour(pc, d)):
				if bool(m["in_battle"]):
					face_dir(d)
					return
	# nothing adjacent: face an engaged monster down a straight corridor
	for d in 4:
		var c: int = pc
		for i in 5:
			if not g.face_passable(c * 4 + d):
				break
			c = g.lv.neighbour(c, d)
			var hit := false
			for m in g.monsters_at(c):
				if bool(m["in_battle"]):
					hit = true
			if hit:
				face_dir(d)
				return


func _choose(ci: int) -> Dictionary:
	var ch: Dictionary = g.s["party"][ci]
	var st: Dictionary = g.stats(ch)
	# potion when very low
	if int(ch["hp"]) * 4 < int(st["hp_max"]):
		for i in ch["pack"].size():
			if ch["pack"][i] != null and ch["pack"][i]["id"] == "potion_red":
				return {"act": "use", "idx": i}
	# healers mend the weakest
	var weakest := -1
	var worst := 1.0
	for k in g.living():
		var o: Dictionary = g.s["party"][k]
		var frac: float = float(o["hp"]) / float(g.stats(o)["hp_max"])
		if frac < worst:
			worst = frac
			weakest = k
	var mag := int(st["mag"])
	if worst < 0.45 and weakest >= 0 and mag >= 12:
		for sp in ["mend_2", "mend_1"]:
			var sd: Dictionary = g.magic.spell(sp)
			if has_spell(sp) and int(ch["mp"]) >= int(sd["mana"]) and mag >= int(sd["need"]):
				return {"act": "cast", "spell": sp, "target": weakest}
	# offensive casters
	if mag >= 12:
		var front: bool = not g.battle.front_monsters().is_empty()
		var line: bool = g.battle.line_target() != null
		for sp in ["ember_3", "spark_3", "spark_2", "ember_2", "rime_2", "spark_1", "ember_1"]:
			var sd: Dictionary = g.magic.spell(sp)
			if not has_spell(sp) or int(ch["mp"]) < int(sd["mana"]) or mag < int(sd["need"]):
				continue
			if (sd["target"] == "line" and line) or (sd["target"] == "front_all" and front):
				return {"act": "cast", "spell": sp}
	var w = ch["equip"].get("hand_r")
	if w != null and String(g.item_def(w).get("type", "")) == "ranged":
		if int(ch["quiver"]) > 0 and g.battle.line_target() != null:
			return {"act": "attack"}
		return {"act": "guard"}
	if not g.battle.front_monsters().is_empty():
		return {"act": "attack"}
	return {"act": "guard"}


func rest_if_needed() -> void:
	if g.s["mode"] != "explore":
		return
	var low := false
	for ci in g.living():
		var ch: Dictionary = g.s["party"][ci]
		var st: Dictionary = g.stats(ch)
		if int(ch["hp"]) * 2 < int(st["hp_max"]) or (int(st["mp_max"]) > 12 and int(ch["mp"]) * 3 < int(st["mp_max"])):
			low = true
	if not low:
		return
	for ci in g.living():
		var ch: Dictionary = g.s["party"][ci]
		if int(ch["food"]) < 30 * 360:
			for i in ch["pack"].size():
				if ch["pack"][i] != null and ch["pack"][i]["id"] == "bread":
					g.use_item(ci, i)
					break
	var r: Dictionary = g.rest(8)
	drain()
	say("  rest %d h (%s)" % [r["hours"], r["why"]])
	if g.s["mode"] == "battle":
		fight()


func talk(choice_text: String) -> bool:
	if not g.talk_front():
		say("nobody to talk to")
		return false
	drain()
	var guard := 0
	while not g.dialog.is_empty() and guard < 10:
		guard += 1
		var picked := false
		for c in g.dialog_choices():
			if String(c["text"]).begins_with(choice_text):
				g.dialog_choose(int(c["i"]))
				picked = true
				break
		if not picked:
			var cs: Array = g.dialog_choices()
			g.dialog_choose(int(cs[cs.size() - 1]["i"]))
		drain()
	return true


func rest_full() -> void:
	for i in 3:
		var r: Dictionary = g.rest(12)
		drain()
		if g.s["mode"] == "battle":
			fight()
		if r["hours"] == 0:
			break
