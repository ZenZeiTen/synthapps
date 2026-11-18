# Crowmere Hill engine core -- GDScript port of web/src/core.js.
#
# Function-for-function parallel to the JavaScript so the golden transcripts in
# tests/transcripts replay byte-identically in both engines (godot/tests/
# run_transcripts.gd proves it). Pure logic: no nodes, no timers, no randomness.
#
# Parity notes: Godot parses every JSON number as a float, so anything printed
# (score, deltas) is cast with int(); positions stay float, which the core only
# compares, never prints.
extends RefCounted

const MOVE_VERBS := {"go": true, "climb": true, "enter": true, "exit": true, "jump": true}

var data: Dictionary
var rooms: Dictionary
var fillers := {}
var pronouns := {}
var preps := {}
var known := {}
var dir_words := {}
var verb_phrases := {}
var max_verb_len := 1
var conflicts: Array = []
var entities := {}
var entity_order: Array = []
var noun_phrases := {}
var max_noun_len := 1


# ---------------------------------------------------------------- normalization

static func normalize_tokens(text: String, fill: Dictionary) -> Array:
	var s := text.to_lower()
	var clean := ""
	for c in s:
		var is_alnum: bool = (c >= "a" and c <= "z") or (c >= "0" and c <= "9")
		clean += c if is_alnum else " "
	var out: Array = []
	for t in clean.split(" "):
		if t == "":
			continue
		if fill.has(t):
			continue
		out.append(t)
	return out


static func as_list(v) -> Array:
	if v == null:
		return []
	if typeof(v) == TYPE_ARRAY:
		return v
	return [v]


static func join(parts: Array, sep: String = " ") -> String:
	return sep.join(PackedStringArray(parts))


# JS compares any two values with ===; GDScript raises on Array == String, so every
# comparison against a literal that could meet a list goes through this.
static func is_str(v, s: String) -> bool:
	return typeof(v) == TYPE_STRING and v == s


static func say(text) -> Dictionary:
	return {"t": "say", "text": text}


# ---------------------------------------------------------------- construction

func _init(game_data: Dictionary, room_data: Dictionary) -> void:
	data = game_data
	rooms = room_data
	var v: Dictionary = data["vocab"]
	for f in v["fillers"]:
		fillers[f] = true
	for p in v["pronouns"]:
		pronouns[p] = true
	for p in v["preps"]:
		preps[p] = true
	for lst in [v["fillers"], v["pronouns"], v["preps"]]:
		for t in lst:
			known[t] = true
	for dir in v["dirs"]:
		for w in v["dirs"][dir]:
			var toks := normalize_tokens(w, fillers)
			if toks.size() == 1:
				dir_words[toks[0]] = dir
				known[toks[0]] = true
	for verb in v["verbs"]:
		for w in v["verbs"][verb]["words"]:
			var toks := normalize_tokens(w, fillers)
			if toks.is_empty():
				continue
			var phrase := join(toks)
			if verb_phrases.has(phrase) and verb_phrases[phrase] != verb:
				conflicts.append('verb phrase "%s": %s vs %s' % [phrase, verb_phrases[phrase], verb])
			if not verb_phrases.has(phrase):
				verb_phrases[phrase] = verb
			max_verb_len = maxi(max_verb_len, toks.size())
			for t in toks:
				known[t] = true
	for id in data["objects"]:
		entities[id] = {"kind": "object", "id": id, "def": data["objects"][id]}
		entity_order.append(id)
	for id in data["scenery"]:
		entities[id] = {"kind": "scenery", "id": id, "def": data["scenery"][id]}
		entity_order.append(id)
	for id in entity_order:
		for w in entities[id]["def"]["words"]:
			var toks := normalize_tokens(w, fillers)
			if toks.is_empty():
				continue
			var phrase := join(toks)
			if not noun_phrases.has(phrase):
				noun_phrases[phrase] = []
			if not noun_phrases[phrase].has(id):
				noun_phrases[phrase].append(id)
			max_noun_len = maxi(max_noun_len, toks.size())
			for t in toks:
				known[t] = true


# ---------------------------------------------------------------- state

func new_state() -> Dictionary:
	var st: Dictionary = data["start"]
	var state := {
		"room": st["room"], "pos": {"x": 0.0, "y": 0.0}, "face": st.get("face", "down"),
		"flags": {}, "loc": {}, "score": 0, "awarded": {}, "turns": 0,
		"dead": false, "won": false, "visited": {}, "lastNoun": null,
	}
	for id in data["objects"]:
		state["loc"][id] = data["objects"][id].get("start")
	for id in as_list(st.get("inventory")):
		state["loc"][id] = "inv"
	var pt = point(st["room"], st["point"])
	if pt != null:
		state["pos"] = {"x": float(pt[0]), "y": float(pt[1])}
	state["visited"][st["room"]] = true
	return state


func start(state: Dictionary) -> Array:
	return [say(room_look(state))]


func snapshot(state: Dictionary) -> String:
	return JSON.stringify(state)


func restore(json: String) -> Dictionary:
	return JSON.parse_string(json)


# ---------------------------------------------------------------- geometry helpers

func point(room, name) -> Variant:
	var r = rooms.get(room)
	if r == null or not r.has("points"):
		return null
	return r["points"].get(name)


func zone(room, name) -> Variant:
	var r = rooms.get(room)
	if r == null or not r.has("zones"):
		return null
	return r["zones"].get(name)


func is_near_point(state: Dictionary, point_name) -> bool:
	if point_name == null or point_name == "":
		return true
	var p = point(state["room"], point_name)
	if p == null:
		return true
	var rx := float(data["reach"]["rx"])
	var ry := float(data["reach"]["ry"])
	var dx := (float(state["pos"]["x"]) - float(p[0])) / rx
	var dy := (float(state["pos"]["y"]) - float(p[1])) / ry
	return dx * dx + dy * dy <= 1.0


func is_near(state: Dictionary, entity_id) -> bool:
	var e = entities.get(entity_id)
	if e == null:
		return true
	return is_near_point(state, e["def"].get("at"))


func walkable(room, x: float, y: float) -> bool:
	var r = rooms.get(room)
	if r == null or not r.has("walk"):
		return false
	var xi := int(floor(x))
	var yi := int(floor(y))
	var w: Dictionary = r["walk"]
	if yi < 0 or yi >= int(w["h"]) or xi < 0 or xi >= int(w["w"]):
		return false
	var runs: Array = w["rows"][yi]
	var i := 0
	while i < runs.size():
		var x0 := int(runs[i])
		if xi >= x0 and xi < x0 + int(runs[i + 1]):
			return true
		i += 2
	return false


func zone_at(state: Dictionary, x: float, y: float) -> Variant:
	var exits: Dictionary = data["rooms"][state["room"]].get("exits", {})
	for exit_id in exits:
		var z = zone(state["room"], exits[exit_id]["zone"])
		if z != null and point_in_poly(z["poly"], x, y):
			return exit_id
	return null


static func point_in_poly(poly: Array, x: float, y: float) -> bool:
	var inside := false
	var j := poly.size() - 1
	for i in range(poly.size()):
		var xi := float(poly[i][0])
		var yi := float(poly[i][1])
		var xj := float(poly[j][0])
		var yj := float(poly[j][1])
		if ((yi > y) != (yj > y)) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
			inside = not inside
		j = i
	return inside


# ---------------------------------------------------------------- conditions

func check(state: Dictionary, conds) -> bool:
	for c in as_list(conds):
		if not check_one(state, c):
			return false
	return true


func check_one(state: Dictionary, c: Dictionary) -> bool:
	if c.has("flag"):
		return bool(state["flags"].get(c["flag"], false))
	if c.has("not"):
		return not bool(state["flags"].get(c["not"], false))
	if c.has("has"):
		return state["loc"].get(c["has"]) == "inv"
	if c.has("hasnt"):
		return state["loc"].get(c["hasnt"]) != "inv"
	if c.has("at"):
		return state["loc"].get(c["at"][0]) == c["at"][1]
	if c.has("notat"):
		return state["loc"].get(c["notat"][0]) != c["notat"][1]
	if c.has("room"):
		return as_list(c["room"]).has(state["room"])
	if c.has("notroom"):
		return not as_list(c["notroom"]).has(state["room"])
	if c.has("near"):
		return is_near(state, c["near"])
	push_error("unknown condition " + JSON.stringify(c))
	return false


func is_present(state: Dictionary, id) -> bool:
	var e = entities.get(id)
	if e == null:
		return false
	if e["kind"] == "object":
		var l = state["loc"].get(id)
		return l == "inv" or l == state["room"]
	var room = e["def"].get("room")
	var in_room: bool = is_str(room, "*") or as_list(room).has(state["room"])
	return in_room and check(state, e["def"].get("if"))


func overlays(state: Dictionary) -> Array:
	var ov: Dictionary = data["rooms"][state["room"]].get("overlays", {})
	var out: Array = []
	for id in ov:
		if check(state, ov[id]):
			out.append(id)
	return out


# ---------------------------------------------------------------- text

func eval_parts(state: Dictionary, parts) -> String:
	var out: Array = []
	for p in as_list(parts):
		if typeof(p) == TYPE_STRING:
			out.append(p)
		elif check(state, p.get("if")):
			out.append(p["text"])
	return join(out)


func format_text(state: Dictionary, text) -> String:
	return str(text).replace("{score}", str(int(state["score"]))).replace("{max}", str(int(data["meta"]["maxScore"])))


func msg(key: String, vars: Dictionary = {}) -> String:
	var s: String = data["text"][key]
	for k in vars:
		s = s.replace("{" + k + "}", str(vars[k]))
	return s


func room_look(state: Dictionary) -> String:
	return eval_parts(state, data["rooms"][state["room"]]["look"])


func inventory_text(state: Dictionary) -> String:
	var names: Array = []
	for id in data["objects"]:
		if state["loc"].get(id) == "inv":
			names.append(data["objects"][id]["name"])
	if names.is_empty():
		return msg("inventory_empty")
	var lst: String = names[0]
	if names.size() > 1:
		lst = join(names.slice(0, names.size() - 1), ", ") + " and " + names[names.size() - 1]
	return msg("inventory", {"items": lst})


# ---------------------------------------------------------------- parser

func find_nouns(tokens: Array) -> Dictionary:
	var found: Array = []
	var unmatched := false
	var i := 0
	while i < tokens.size():
		var t: String = tokens[i]
		if pronouns.has(t):
			found.append({"pronoun": t})
			i += 1
			continue
		var matched := false
		var l := mini(max_noun_len, tokens.size() - i)
		while l >= 1:
			var phrase := join(tokens.slice(i, i + l))
			if noun_phrases.has(phrase):
				found.append({"phrase": phrase, "ids": noun_phrases[phrase]})
				i += l
				matched = true
				break
			l -= 1
		if not matched:
			unmatched = true
			i += 1
	return {"found": found, "unmatched": unmatched}


func parse(input: String) -> Dictionary:
	var toks := normalize_tokens(input, fillers)
	if toks.is_empty():
		return {"empty": true}
	for t in toks:
		if not known.has(t):
			return {"error": "unknown", "word": t}
	var verb = null
	var vlen := 0
	var l := mini(max_verb_len, toks.size())
	while l >= 1:
		var phrase := join(toks.slice(0, l))
		if verb_phrases.has(phrase):
			verb = verb_phrases[phrase]
			vlen = l
			break
		l -= 1
	var rest: Array = toks.slice(vlen)
	var dir = null
	var verb_words := join(toks.slice(0, vlen))
	if verb == null:
		if dir_words.has(toks[0]):
			verb = "go"
			dir = dir_words[toks[0]]
			rest = toks.slice(1)
			verb_words = toks[0]
		else:
			return {"error": "noverb", "word": toks[0]}
	elif MOVE_VERBS.has(verb) and rest.size() > 0 and dir_words.has(rest[0]):
		dir = dir_words[rest[0]]
		rest = rest.slice(1)
	var p1: Array = rest
	var p2: Array = []
	for i in range(rest.size()):
		if preps.has(rest[i]):
			p1 = rest.slice(0, i)
			p2 = rest.slice(i + 1)
			break
	var a := find_nouns(p1)
	var b := find_nouns(p2)
	var n1 = a["found"][0] if a["found"].size() > 0 else null
	var n2 = b["found"][0] if b["found"].size() > 0 else null
	if n1 == null and n2 != null:
		n1 = n2
		n2 = b["found"][1] if b["found"].size() > 1 else null
	if n2 == null and a["found"].size() > 1:
		n2 = a["found"][1]
	return {"verb": verb, "verbWords": verb_words, "dir": dir, "n1": n1, "n2": n2, "unmatched": a["unmatched"] or b["unmatched"]}


func resolve(state: Dictionary, np, verb) -> Variant:
	if np == null:
		return null
	if np.has("pronoun"):
		if state["lastNoun"] == null:
			return {"error": "pronoun", "word": np["pronoun"]}
		np = {"ids": [state["lastNoun"]]}
	var present: Array = []
	for id in np["ids"]:
		if is_present(state, id):
			present.append(id)
	if present.is_empty():
		return {"id": np["ids"][0], "absent": true}
	if present.size() == 1:
		return {"id": present[0]}
	var carried: Array = []
	var here: Array = []
	for id in present:
		if state["loc"].get(id) == "inv":
			carried.append(id)
		else:
			here.append(id)
	if verb == "take" and here.size() > 0:
		return {"id": here[0]}
	if carried.size() > 0:
		return {"id": carried[0]}
	return {"id": present[0]}


# ---------------------------------------------------------------- commands

func command(state: Dictionary, input: String) -> Array:
	var events: Array = []
	if state["dead"] or state["won"]:
		return events
	var p := parse(input)
	if p.has("empty"):
		return events
	if p.get("error") == "unknown":
		events.append(say(msg("unknown_word", {"word": p["word"]})))
		return events
	if p.get("error") == "noverb":
		events.append(say(msg("no_verb")))
		return events
	var verb = p["verb"]
	var n1 = resolve(state, p["n1"], verb)
	var n2 = resolve(state, p["n2"], verb)
	for n in [n1, n2]:
		if n != null and n.get("error") == "pronoun":
			events.append(say(msg("pronoun_unknown", {"word": n["word"]})))
			return events
	if verb == "look" and n1 != null:
		verb = "examine"
	var vdef: Dictionary = data["vocab"]["verbs"][verb]
	if vdef["noun"] == "required" and n1 == null and p["dir"] == null:
		events.append(say(msg("not_here") if p["unmatched"] else msg("what", {"verb": p["verbWords"]})))
		return events
	state["turns"] = int(state["turns"]) + 1
	if n1 != null and not n1.get("absent", false):
		state["lastNoun"] = n1["id"]
	run(state, verb, n1, n2, p["dir"], events, 0)
	return events


func rule_matches(state: Dictionary, rule: Dictionary, verb, n1, n2) -> bool:
	if not as_list(rule["verb"]).has(verb):
		return false
	if rule.has("room") and not as_list(rule["room"]).has(state["room"]):
		return false
	if rule.has("pair"):
		if n1 == null or n2 == null:
			return false
		var a = rule["pair"][0]
		var b = rule["pair"][1]
		if not ((n1["id"] == a and n2["id"] == b) or (n1["id"] == b and n2["id"] == a)):
			return false
	else:
		if rule.has("noun"):
			if n1 == null:
				return false
			if not is_str(rule["noun"], "*") and not as_list(rule["noun"]).has(n1["id"]):
				return false
		elif n1 != null:
			return false
		if rule.has("noun2"):
			if n2 == null:
				return false
			if not is_str(rule["noun2"], "*") and not as_list(rule["noun2"]).has(n2["id"]):
				return false
	return true


func first_rule(state: Dictionary, verb, n1, n2) -> Variant:
	for rule in data["rules"]:
		if not rule_matches(state, rule, verb, n1, n2):
			continue
		var absent: bool = (n1 != null and n1.get("absent", false)) or (n2 != null and n2.get("absent", false))
		if not rule.get("absentOK", false) and absent:
			continue
		if not check(state, rule.get("if")):
			continue
		return rule
	return null


func run(state: Dictionary, verb, n1, n2, dir, events: Array, depth: int) -> String:
	assert(depth <= 5, "redirect loop at " + str(verb))
	var rule = first_rule(state, verb, n1, n2)
	if rule != null:
		if rule.has("near") and not is_near(state, rule["near"]):
			events.append(say(msg("not_close")))
			return "done"
		return apply_effects(state, rule["do"], events, depth)
	if (n1 != null and n1.get("absent", false)) or (n2 != null and n2.get("absent", false)):
		events.append(say(msg("not_here")))
		return "done"
	if n1 != null:
		var canned = entities[n1["id"]]["def"].get("verbs")
		if canned != null and canned.has(verb):
			events.append(say(canned[verb]))
			return "done"
	return defaults(state, verb, n1, n2, dir, events)


func apply_effects(state: Dictionary, effects, events: Array, depth: int) -> String:
	for e in as_list(effects):
		if e.has("if") and not check(state, e["if"]):
			continue
		if e.has("say"):
			events.append(say(format_text(state, e["say"])))
		elif e.has("set"):
			state["flags"][e["set"]] = true
		elif e.has("clear"):
			state["flags"].erase(e["clear"])
		elif e.has("move"):
			state["loc"][e["move"][0]] = e["move"][1]
		elif e.has("score"):
			award(state, int(e["score"][0]), e["score"][1], events)
		elif e.has("sound"):
			events.append({"t": "sound", "name": e["sound"]})
		elif e.has("die"):
			state["dead"] = true
			events.append({"t": "die", "text": e["die"]})
			return "die"
		elif e.has("win"):
			state["won"] = true
			events.append({"t": "win", "text": e["win"]})
			return "win"
		elif e.has("goto"):
			goto_room(state, e["goto"][0], e["goto"][1], e["goto"][2], events)
			return "goto"
		elif e.has("stop"):
			return "stop"
		elif e.has("redirect"):
			var r: Array = e["redirect"]
			var a = {"id": r[1]} if r.size() > 1 and r[1] != null else null
			var b = {"id": r[2]} if r.size() > 2 and r[2] != null else null
			var res := run(state, r[0], a, b, null, events, depth + 1)
			if res in ["die", "win", "goto", "stop"]:
				return res
		else:
			push_error("unknown effect " + JSON.stringify(e))
	return "done"


func award(state: Dictionary, points: int, id, events: Array) -> void:
	if state["awarded"].has(id):
		return
	state["awarded"][id] = true
	state["score"] = int(state["score"]) + points
	events.append({"t": "score", "delta": points, "total": int(state["score"])})


func find_exit(state: Dictionary, dir, entity_id) -> Variant:
	var exits: Dictionary = data["rooms"][state["room"]].get("exits", {})
	for id in exits:
		var x: Dictionary = exits[id]
		if dir != null and as_list(x.get("dir")).has(dir):
			return id
		if entity_id != null and as_list(x.get("nouns")).has(entity_id):
			return id
	return null


func defaults(state: Dictionary, verb, n1, n2, dir, events: Array) -> String:
	var room: Dictionary = data["rooms"][state["room"]]
	match verb:
		"look":
			events.append(say(room_look(state)))
			return "done"
		"examine":
			var text := eval_parts(state, entities[n1["id"]]["def"].get("look"))
			events.append(say(text if text != "" else msg("examine_default")))
			return "done"
		"inventory":
			events.append(say(inventory_text(state)))
			return "done"
		"score":
			events.append(say(format_text(state, msg("score"))))
			return "done"
		"help":
			events.append(say(msg("help")))
			return "done"
		"wait":
			events.append(say(msg("wait")))
			return "done"
		"hint":
			for h in data["hints"]:
				if check(state, h.get("if")):
					events.append(say(h["text"]))
					return "done"
			return "done"
		"save", "restore", "restart", "quit":
			events.append({"t": "meta", "what": verb})
			return "done"
		"take":
			var e: Dictionary = entities[n1["id"]]
			if e["kind"] != "object":
				events.append(say(msg("cant_take")))
				return "done"
			if state["loc"].get(n1["id"]) == "inv":
				events.append(say(msg("already_have")))
				return "done"
			if not is_near_point(state, e["def"].get("at")):
				events.append(say(msg("not_close")))
				return "done"
			state["loc"][n1["id"]] = "inv"
			events.append(say(e["def"].get("take", msg("taken"))))
			if e["def"].has("score"):
				award(state, int(e["def"]["score"]), "take_" + str(n1["id"]), events)
			return "done"
		"drop", "throw":
			if state["loc"].get(n1["id"]) != "inv":
				events.append(say(msg("dont_have")))
				return "done"
			events.append(say(msg("cant_drop")))
			return "done"
		"smell", "listen":
			if n1 == null:
				events.append(say(room.get(verb, msg("cant_do"))))
				return "done"
		"go", "climb", "enter", "exit", "jump":
			var exit_id = null
			if dir != null:
				exit_id = find_exit(state, dir, null)
			elif n1 != null:
				exit_id = find_exit(state, null, n1["id"])
			elif verb == "enter":
				exit_id = find_exit(state, "in", null)
			elif verb == "exit":
				exit_id = find_exit(state, "out", null)
			var ent_at = entities[n1["id"]]["def"].get("at") if n1 != null else null
			if exit_id != null:
				var x: Dictionary = room["exits"][exit_id]
				if check(state, x.get("when")):
					events.append({"t": "walkto", "exit": exit_id})
					return "done"
				if verb == "go" and dir == null and ent_at != null and ent_at != "":
					events.append({"t": "walkto", "point": ent_at})
					return "done"
				events.append(say(x.get("blocked", msg("cant_go"))))
				return "done"
			if verb == "go" and ent_at != null and ent_at != "":
				events.append({"t": "walkto", "point": ent_at})
				return "done"
			if dir != null or verb in ["go", "enter", "exit"]:
				events.append(say(msg("cant_go")))
				return "done"
	var vdef = data["vocab"]["verbs"].get(verb)
	events.append(say(vdef["default"] if vdef != null and vdef.has("default") else msg("cant_do")))
	return "done"


# ---------------------------------------------------------------- rooms & exits

func goto_room(state: Dictionary, room, point_name, face, events: Array) -> void:
	state["room"] = room
	var pt = point(room, point_name)
	if pt != null:
		state["pos"] = {"x": float(pt[0]), "y": float(pt[1])}
	if face != null and face != "":
		state["face"] = face
	events.append({"t": "room", "room": room, "point": point_name})
	for rule in data["rules"]:
		if not as_list(rule["verb"]).has("@enter"):
			continue
		if rule.has("room") and not as_list(rule["room"]).has(room):
			continue
		if not check(state, rule.get("if")):
			continue
		apply_effects(state, rule["do"], events, 0)
	if not state["visited"].get(room, false):
		state["visited"][room] = true
		events.append(say(room_look(state)))


# Walking into an exit zone (or arriving after a walkto). Returns
# {events, blocked, passable} exactly like Game.enterZone in core.js.
func enter_zone(state: Dictionary, exit_id) -> Dictionary:
	var events: Array = []
	var x = data["rooms"][state["room"]].get("exits", {}).get(exit_id)
	if x == null or state["dead"] or state["won"]:
		return {"events": events, "blocked": false, "passable": true}
	if not check(state, x.get("when")):
		if x.get("silent", false):
			return {"events": events, "blocked": false, "passable": true}
		events.append(say(x.get("blocked", msg("cant_go"))))
		return {"events": events, "blocked": true, "passable": false}
	var hook = first_rule(state, "_exit", {"id": exit_id}, null)
	if hook != null:
		var res := apply_effects(state, hook["do"], events, 0)
		if res in ["die", "win", "goto", "stop"]:
			return {"events": events, "blocked": res == "stop", "passable": false}
	goto_room(state, x["to"], x["at"], x.get("face"), events)
	return {"events": events, "blocked": false, "passable": false}
