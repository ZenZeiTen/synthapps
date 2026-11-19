## Finds a way through a stage with the real rules: a beam search over copies of the core
## state, moving by short player-like moves (walk, jump, hop, attack, climb, drop). A route
## that loses a life is thrown away. The result is a list of packed inputs, one per step,
## that tests/replay_routes.gd, the Godot harness and the browser tests play back.
##
## A route that cannot be found usually means the stage is wrong (a gap too wide, a ledge
## too high), so run this after every stage edit (tests/make_routes.sh).
extends RefCounted

const Game = preload("res://scripts/core/game.gd")
const Inputs = preload("res://scripts/core/inputs.gd")
const FX := 65536

# each move: a list of [steps, input]; "face" means toward the goal side
const MOVES := {
	"right": [[8, {"dx": 1}]],
	"left": [[8, {"dx": -1}]],
	"wait": [[6, {}]],
	"jr": [[18, {"dx": 1, "jump": true}]],
	"jl": [[18, {"dx": -1, "jump": true}]],
	"ju": [[18, {"jump": true}]],
	"jrlong": [[34, {"dx": 1, "jump": true}]],
	"jllong": [[34, {"dx": -1, "jump": true}]],
	"hopr": [[1, {"dx": 1, "jump": true}], [11, {"dx": 1}]],
	"hopl": [[1, {"dx": -1, "jump": true}], [11, {"dx": -1}]],
	"atk": [[1, {"attack": true}], [7, {}]],
	"atkr": [[1, {"dx": 1}], [1, {"attack": true}], [7, {}]],
	"atkl": [[1, {"dx": -1}], [1, {"attack": true}], [7, {}]],
	"catk": [[1, {"dy": 1}], [1, {"dy": 1, "attack": true}], [10, {"dy": 1}]],
	"jatk": [[1, {"jump": true}], [6, {"jump": true}], [1, {"jump": true, "attack": true}], [12, {"jump": true}]],
	"up": [[10, {"dy": -1}]],
	"down": [[10, {"dy": 1}]],
	"drop": [[1, {"dy": 1}], [1, {"dy": 1, "jump": true}], [8, {}]],
	"heal": [],
}

var defs: Dictionary
var width := 40
var max_iter := 1400
var log_every := 50


func _init(d: Dictionary) -> void:
	defs = d


func start_state(stage: String, text: String, hero: String, progress: Dictionary = {}) -> Game:
	var g := Game.new(defs)
	g.start(stage, text, progress.duplicate(true) if not progress.is_empty() else Game.new_progress(defs, 1), hero)
	return g


## How far along the stage a state is; bigger is better.
func score(g: Game, hp0: int) -> float:
	var x: float = float(g.p["x"] >> 16)
	var y: float = float(g.p["y"] >> 16)
	var s := 0.0
	var way: Array = g.head.get("route_pts", [])
	if way.is_empty():
		s = x
	else:
		# waypoints (tile coordinates) for stages that climb: progress is the number passed,
		# then the distance to the next one
		var k: int = g.get_meta("wp", 0)
		if k >= way.size():
			s = k * 1000.0 + x
		else:
			var dxw: float = way[k][0] * 16 + 8 - x
			var dyw: float = way[k][1] * 16 + 16 - y
			s = k * 1000.0 - (absf(dxw) + absf(dyw) * 1.5)
	if g.arena_left >= 0:
		s += 20000.0
		var gd: Dictionary = g.obj_by_id(g.guardian_id)
		if not gd.is_empty():
			var full := int(defs["enemies"][gd["k"]]["hp"])
			s += (full - int(gd["hp"])) * 300.0
			if gd["k"] == "siltking":
				s += 40000.0
			# stay near the guardian so the swings land
			s -= absf(float((gd["x"] >> 16) - (g.p["x"] >> 16))) * 2.0
		else:
			# the guardian has fallen: more than any living guardian can score, then the bell
			s += 100000.0
			for o in g.objs:
				if o["k"] == "bell":
					s -= absf(float((o["x"] >> 16) - (g.p["x"] >> 16))) * 4.0
	if g.mode == "clear":
		s += 100000.0
	s -= float(hp0 - int(g.p["hp"])) * 6.0
	s -= maxf(0.0, 30.0 - float(g.p["hp"])) * 150.0
	s += float(g.prog["score"]) * 0.01
	return s


func key(g: Game) -> String:
	var gd: Dictionary = g.obj_by_id(g.guardian_id) if g.arena_left >= 0 else {}
	return "%d,%d,%s,%d,%d,%d" % [(g.p["x"] >> 16) >> 2, (g.p["y"] >> 16) >> 2, g.p["st"], g.arena_left,
		int(gd.get("hp", 0)) if not gd.is_empty() else 0, g.get_meta("wp", 0)]


## The steps of a move. "heal" is built from the state: Up + item until the tonic is
## selected, then item.
func parts(g: Game, move: String) -> Array:
	if move != "heal":
		return MOVES[move]
	var out: Array = []
	var sel: String = g.prog["sel"]
	var n := 0
	var order: Array = defs["items"]
	while sel != "tonic" and n < order.size():
		out.append([1, {"dy": -1, "item": true}])
		out.append([1, {}])
		var i := order.find(sel)
		for k in range(1, order.size() + 1):
			var nx: String = order[(i + k) % order.size()]
			if int(g.prog["items"].get(nx, 0)) > 0:
				sel = nx
				break
		n += 1
	out.append([1, {"item": true}])
	out.append([3, {}])
	return out


## Runs one move from a copy of `g`. Returns [state, inputs] or [] when the move loses a life.
func apply(g: Game, move: String) -> Array:
	if move == "heal" and (int(g.prog["items"].get("tonic", 0)) == 0 or g.p["hp"] > int(g.prog["maxhp"]) - 24 \
			or not g.p["ground"]):
		return []
	var c = g.clone()
	c.set_meta("wp", g.get_meta("wp", 0))
	var way: Array = g.head.get("route_pts", [])
	var rec: Array = []
	for part in parts(g, move):
		for i in int(part[0]):
			c.events.clear()
			c.step(part[1])
			rec.append(Inputs.pack(part[1]))
			for e in c.events:
				if e["t"] == "talk":
					c.close_talk()
			if c.mode == "dead" or c.mode == "over":
				return []
			var wp: int = c.get_meta("wp")
			while wp < way.size() and absi((c.p["x"] >> 16) - (way[wp][0] * 16 + 8)) < 20 and absi((c.p["y"] >> 16) - (way[wp][1] * 16 + 16)) < 24:
				wp += 1
			c.set_meta("wp", wp)
			if c.mode == "clear" or c.mode == "over":
				break
		if c.mode == "clear" or c.mode == "over":
			break
	return [c, rec]


## Returns {"ok": bool, "inputs": [...], "steps": n, "hp": left}.
func find(stage: String, text: String, hero: String, progress: Dictionary = {}) -> Dictionary:
	var g0 := start_state(stage, text, hero, progress)
	g0.head["route_pts"] = parse_points(g0.head.get("route", ""))
	var hp0: int = g0.p["hp"]
	var beam: Array = [[g0, [], 0.0]]
	for it in max_iter:
		var cand: Array = []
		var seen := {}
		for b in beam:
			for m in MOVES:
				var r := apply(b[0], m)
				if r.is_empty():
					continue
				var c: Game = r[0]
				var inputs: Array = b[1] + r[1]
				if c.mode == "clear":
					# let the bell scene play out to its end
					while c.mode == "clear":
						c.step({})
						inputs.append(Inputs.pack({}))
					return {"ok": true, "inputs": inputs, "steps": inputs.size(), "hp": c.p["hp"], "prog": c.prog}
				var k := key(c)
				var s := score(c, hp0)
				if seen.has(k) and seen[k][2] >= s:
					continue
				seen[k] = [c, inputs, s]
		cand = seen.values()
		if cand.is_empty():
			return {"ok": false, "inputs": [], "steps": 0, "hp": 0}
		cand.sort_custom(func(a, b): return a[2] > b[2])
		beam = cand.slice(0, width)
		if it % log_every == 0:
			var best: Game = beam[0][0]
			printerr("route %s it=%d x=%d y=%d hp=%d arena=%d score=%.0f" % [stage, it, best.p["x"] >> 16,
				best.p["y"] >> 16, best.p["hp"], best.arena_left, beam[0][2]])
	return {"ok": false, "inputs": [], "steps": 0, "hp": 0}


static func parse_points(s: String) -> Array:
	var out: Array = []
	for part in s.split(" ", false):
		var xy := part.split(",")
		if xy.size() == 2:
			out.append([int(xy[0]), int(xy[1])])
	return out
