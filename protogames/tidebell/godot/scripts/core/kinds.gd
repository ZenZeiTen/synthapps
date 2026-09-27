## What every object does each step: enemies, guardians, shots, chests, pickups, posts,
## captives and the bells. Static functions over the game (game.gd) and one object.
## web/src/core/kinds.js is the same, line for line; keep the two in step.
##
## Enemy and guardian numbers come from content/data/defs.json (DESIGN section 3).
extends RefCounted

const FX := 65536
const T := 16
const WAVE := [0, 2, 4, 6, 7, 8, 8, 8, 7, 6, 4, 2, 0, -2, -4, -6, -7, -8, -8, -8, -7, -6, -4, -2]
const ENEMIES := ["raider", "thrower", "mudskip", "bat", "crab", "gull", "wisp", "golem",
	"vell", "hullbreaker", "tallyman", "oldgrey", "warden", "grane", "siltking"]
const GUARDIANS := ["vell", "hullbreaker", "tallyman", "oldgrey", "warden", "grane", "siltking"]
const HARMFUL := ["bottle", "net", "blast", "feather", "spark", "shock", "wave"]


static func is_enemy(o: Dictionary) -> bool:
	return ENEMIES.has(o["k"])


static func is_guardian(o: Dictionary) -> bool:
	return GUARDIANS.has(o["k"])


static func hittable(o: Dictionary) -> bool:
	if o["k"] == "chest":
		return true
	if not is_enemy(o):
		return false
	if int(o.get("asleep", 0)) == 1:
		return false
	if o["k"] == "warden" and (o["st"] == "vanish" or o["st"] == "idle"):
		return false
	return o["st"] != "dying"


static func sgn(v: int) -> int:
	return 1 if v > 0 else (-1 if v < 0 else 0)


## Integer division toward zero, as Math.trunc does in game.js.
static func idiv(a: int, b: int) -> int:
	var q := absi(a) / absi(b)
	return q if (a >= 0) == (b >= 0) else -q


static func e(g, o: Dictionary, key: String, fallback: int = 0) -> int:
	return int(g.D["enemies"][o["k"]].get(key, fallback))


static func px(o: Dictionary) -> int:
	return o["x"] >> 16


static func py(o: Dictionary) -> int:
	return o["y"] >> 16


static func fall(g, o: Dictionary, grav: int = 27648) -> Dictionary:
	if not o["ground"]:
		o["vy"] = mini(o["vy"] + grav, 8 * FX)
	var hit: Dictionary = g.move_body(o, int(o["w"]) >> 1, int(o["h"]), true)
	o["ground"] = hit["floor"] or g.grounded(o, int(o["w"]) >> 1, true)
	return hit


## Is there floor under the next step in direction `dir`? (walkers turn at edges)
static func floor_ahead(g, o: Dictionary, dir: int) -> bool:
	var x := px(o) + dir * ((int(o["w"]) >> 1) + 2)
	return g.floor_at(x >> 4, py(o) >> 4)


static func spawn(g, kind: String, x: int, y: int, vx: int, vy: int) -> Dictionary:
	var s: Dictionary = g.add_obj(kind, 0, 0)
	s["x"] = x
	s["y"] = y
	s["vx"] = vx
	s["vy"] = vy
	s["active"] = true
	s["face"] = sgn(vx) if vx != 0 else 1
	var size := {"bottle": [8, 8], "net": [16, 12], "bomb": [10, 10], "blast": [36, 30], "feather": [8, 10],
		"spark": [10, 10], "shock": [14, 10], "wave": [16, 26], "fx": [8, 8], "coinfx": [8, 8]}
	if size.has(kind):
		s["w"] = size[kind][0]
		s["h"] = size[kind][1]
	return s


static func dx_to_player(g, o: Dictionary) -> int:
	return (g.p["x"] >> 16) - px(o)


static func dy_to_player(g, o: Dictionary) -> int:
	return (g.p["y"] >> 16) - py(o)


# ------------------------------------------------------------------ dispatch
static func step(g, o: Dictionary) -> void:
	o["t"] += 1
	if int(o.get("asleep", 0)) == 1:
		fall(g, o)
		o["face"] = sgn(dx_to_player(g, o)) if dx_to_player(g, o) != 0 else o["face"]
		return
	match o["k"]:
		"raider": raider(g, o)
		"thrower": thrower(g, o)
		"mudskip": mudskip(g, o)
		"bat": bat(g, o)
		"crab": crab(g, o)
		"gull": gull(g, o)
		"wisp": wisp(g, o)
		"golem": golem(g, o)
		"vell": vell(g, o)
		"hullbreaker": hullbreaker(g, o)
		"tallyman": tallyman(g, o)
		"oldgrey": oldgrey(g, o)
		"warden": warden(g, o)
		"grane": grane(g, o)
		"siltking": siltking(g, o)
		"knife": knife(g, o)
		"bottle", "bomb":
			var hit := fall(g, o, 16384 if o["k"] == "bottle" else 19661)
			if hit["floor"] or hit["wall"] or hit["ceil"]:
				o["dead"] = true
				if o["k"] == "bomb":
					spawn(g, "blast", o["x"], o["y"] + 8 * FX, 0, 0)
					g.emit({"t": "sfx", "id": "boom"})
				else:
					g.emit({"t": "sfx", "id": "break"})
		"net":
			o["x"] += o["vx"]
			o["y"] += o["vy"]
			o["vy"] += 4096
			if o["t"] > 90 or g.solid_at(px(o) >> 4, (py(o) - 4) >> 4):
				o["dead"] = true
		"feather", "spark":
			o["x"] += o["vx"]
			o["y"] += o["vy"]
			if o["t"] > 240:
				o["dead"] = true
		"shock", "wave":
			o["x"] += o["vx"]
			if o["t"] > int(o.get("life", 40)) or g.solid_at((px(o) + sgn(o["vx"]) * 8) >> 4, (py(o) - 4) >> 4):
				o["dead"] = true
		"blast", "fx", "coinfx":
			if o["t"] > 14:
				o["dead"] = true
		"pickup":
			if int(o.get("fall", 0)) == 1:
				fall(g, o, 20000)
				if o["ground"]:
					o["vx"] = 0
		"bell":
			fall(g, o, 16000)
		"captive":
			if o["st"] == "free":
				o["x"] += FX
				if o["t"] > 60:
					o["dead"] = true
		_:
			pass


# ------------------------------------------------------------------ enemies
static func raider(g, o: Dictionary) -> void:
	fall(g, o)
	var dx := dx_to_player(g, o)
	var dy := dy_to_player(g, o)
	var reach := e(g, o, "reach")
	match o["st"]:
		"windup":
			o["vx"] = 0
			if o["t"] >= e(g, o, "windup"):
				o["st"] = "cut"
				o["t"] = 0
				o["struck"] = 0
				g.emit({"t": "sfx", "id": "eswing"})
		"cut":
			var x := px(o)
			var y := py(o)
			var box: Array = [x, y - 30, x + reach, y - 8] if o["face"] > 0 else [x - reach, y - 30, x, y - 8]
			if int(o.get("struck", 0)) == 0 and g.overlap(box, g.player_box()):
				o["struck"] = 1
				g.enemy_hit(o)
			if o["t"] >= e(g, o, "cut"):
				o["st"] = "cool"
				o["t"] = 0
		"cool", "knock":
			if o["st"] == "knock":
				o["vx"] = o["vx"] - sgn(o["vx"]) * 16384
			else:
				o["vx"] = 0
			if o["t"] >= (8 if o["st"] == "knock" else e(g, o, "cool")):
				o["st"] = "walk"
				o["t"] = 0
				o["vx"] = 0
		_:
			o["vx"] = 0
			if absi(dx) < 200 and absi(dy) < 48:
				o["face"] = sgn(dx) if dx != 0 else o["face"]
				if absi(dx) <= reach - 2 and absi(dy) < 30:
					o["st"] = "windup"
					o["t"] = 0
				elif floor_ahead(g, o, o["face"]):
					o["vx"] = o["face"] * e(g, o, "speed")
					o["st"] = "walk"


static func thrower(g, o: Dictionary) -> void:
	fall(g, o)
	var dx := dx_to_player(g, o)
	o["face"] = sgn(dx) if dx != 0 else o["face"]
	if o["st"] == "knock":
		o["vx"] = o["vx"] - sgn(o["vx"]) * 16384
		if o["t"] >= 8:
			o["st"] = "walk"
			o["t"] = 0
		return
	o["vx"] = 0
	var ad := absi(dx)
	var want := 0
	if ad < 70:
		want = -o["face"]
	elif ad > 130 and ad < 240:
		want = o["face"]
	if want != 0 and floor_ahead(g, o, want):
		o["vx"] = want * e(g, o, "speed")
	if o["t"] >= e(g, o, "every") and ad < 260 and g.on_screen(o, 0):
		o["t"] = 0
		var vx := clampi(idiv(dx * FX, 45), -229376, 229376)
		spawn(g, "bottle", o["x"], o["y"] - 30 * FX, vx, -5 * FX)
		g.emit({"t": "sfx", "id": "throw"})


static func mudskip(g, o: Dictionary) -> void:
	var hit := fall(g, o)
	if hit["floor"]:
		o["vx"] = 0
	var dx := dx_to_player(g, o)
	if o["ground"] and o["t"] >= e(g, o, "every") and absi(dx) < 180:
		o["t"] = 0
		o["face"] = sgn(dx) if dx != 0 else o["face"]
		o["vy"] = -5 * FX
		o["vx"] = o["face"] * 98304
		o["ground"] = false


static func bat(g, o: Dictionary) -> void:
	var dx := dx_to_player(g, o)
	var dy := dy_to_player(g, o)
	match o["st"]:
		"swoop":
			o["x"] += o["vx"]
			o["y"] += o["vy"]
			if py(o) >= int(o["ty"]) or o["t"] > 90:
				o["st"] = "rise"
				o["t"] = 0
				o["vy"] = -98304
				o["vx"] = sgn(o["vx"]) * FX
		"rise":
			o["x"] += o["vx"]
			o["y"] += o["vy"]
			if o["y"] <= o["oy"]:
				o["y"] = o["oy"]
				o["st"] = "idle"
				o["t"] = 0
		_:
			if o["t"] > 30 and absi(dx) < 90 and dy > 0 and dy < 150:
				o["st"] = "swoop"
				o["t"] = 0
				o["ty"] = (g.p["y"] >> 16) - 16
				o["face"] = sgn(dx) if dx != 0 else 1
				o["vx"] = o["face"] * 2 * FX
				o["vy"] = 163840


static func crab(g, o: Dictionary) -> void:
	var hit := fall(g, o)
	if o["st"] == "knock":
		o["vx"] = 0
		if o["t"] >= 10:
			o["st"] = "walk"
		return
	if hit["wall"] or (o["ground"] and not floor_ahead(g, o, o["face"])):
		o["face"] = -o["face"]
	o["vx"] = o["face"] * e(g, o, "speed")


static func gull(g, o: Dictionary) -> void:
	if o["st"] == "idle":
		o["st"] = "fly"
		o["face"] = -1 if dx_to_player(g, o) < 0 else 1
		if o["face"] < 0 and px(o) < g.cam_x + 160:
			o["face"] = 1
	o["x"] += o["face"] * e(g, o, "speed")
	o["y"] = o["oy"] + WAVE[(o["t"] >> 1) % WAVE.size()] * 3 * FX
	if o["t"] > 90 and not g.on_screen(o, 64):
		o["dead"] = true


static func wisp(g, o: Dictionary) -> void:
	var dx := dx_to_player(g, o)
	var dy := dy_to_player(g, o) - 20
	var v := e(g, o, "speed")
	if absi(dx) > 2:
		o["x"] += sgn(dx) * v
	if absi(dy) > 2:
		o["y"] += sgn(dy) * v
	o["face"] = sgn(dx) if dx != 0 else o["face"]


static func golem(g, o: Dictionary) -> void:
	fall(g, o)
	var dx := dx_to_player(g, o)
	match o["st"]:
		"windup":
			o["vx"] = 0
			if o["t"] >= 30:
				o["st"] = "cool"
				o["t"] = 0
				slam(g, o, 100)
		"cool":
			o["vx"] = 0
			if o["t"] >= e(g, o, "cool"):
				o["st"] = "walk"
				o["t"] = 0
		_:
			o["vx"] = 0
			if absi(dx) < 220:
				o["face"] = sgn(dx) if dx != 0 else o["face"]
				if absi(dx) < 60 and absi(dy_to_player(g, o)) < 60:
					o["st"] = "windup"
					o["t"] = 0
				elif floor_ahead(g, o, o["face"]):
					o["vx"] = o["face"] * e(g, o, "speed")


static func slam(g, o: Dictionary, reach_px: int) -> void:
	g.emit({"t": "sfx", "id": "slam"})
	for d in [-1, 1]:
		var s := spawn(g, "shock", o["x"] + d * 10 * FX, o["y"], d * 163840, 0)
		s["life"] = reach_px * 2 / 5


static func knife(g, o: Dictionary) -> void:
	o["x"] += o["vx"]
	if g.solid_at(px(o) >> 4, (py(o) - 3) >> 4) or o["t"] > 80:
		o["dead"] = true
		return
	var kb: Array = g.obj_box(o)
	for t in g.objs:
		if t["dead"] or not t["active"] or not hittable(t):
			continue
		if g.overlap(kb, g.obj_box(t)):
			damage(g, t, int(g.P["knife_damage"]), o["face"])
			o["dead"] = true
			return


# ------------------------------------------------------------------ guardians
static func arena_mid(g) -> int:
	return g.arena_left + 160


static func vell(g, o: Dictionary) -> void:
	var hit := fall(g, o)
	var dx := dx_to_player(g, o)
	match o["st"]:
		"leap":
			if hit["floor"]:
				o["vx"] = 0
				o["st"] = "throw"
				o["t"] = 0
		"throw":
			o["vx"] = 0
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			if o["t"] == 14:
				spawn(g, "net", o["x"] + o["face"] * 10 * FX, o["y"] - 26 * FX, o["face"] * 3 * FX, -FX)
				g.emit({"t": "sfx", "id": "throw"})
			if o["t"] >= 34:
				o["st"] = "walk"
				o["t"] = 0
		_:
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			o["vx"] = o["face"] * 81920 if absi(dx) > 24 else 0
			if o["t"] >= 50 and o["ground"]:
				o["st"] = "leap"
				o["t"] = 0
				o["vy"] = -7 * FX
				o["vx"] = clampi(idiv(dx * FX, 34), -3 * FX, 3 * FX)
				o["ground"] = false


static func hullbreaker(g, o: Dictionary) -> void:
	var hit := fall(g, o)
	var dx := dx_to_player(g, o)
	match o["st"]:
		"charge":
			o["vx"] = o["face"] * 3 * FX
			if hit["wall"]:
				o["st"] = "rest"
				o["t"] = 0
				o["vx"] = 0
				g.emit({"t": "sfx", "id": "slam"})
		"rest":
			o["vx"] = 0
			if o["t"] >= 90:
				o["st"] = "wind"
				o["t"] = 0
		_:
			o["vx"] = 0
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			if o["t"] >= 30:
				o["st"] = "charge"
				o["t"] = 0


static func tallyman(g, o: Dictionary) -> void:
	var hit := fall(g, o, 27648)
	var dx := dx_to_player(g, o)
	match o["st"]:
		"hop":
			if hit["floor"] or (o["ground"] and o["t"] > 4):
				o["vx"] = 0
				o["st"] = "lob"
				o["t"] = 0
		"lob":
			o["vx"] = 0
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			if o["t"] == 14 or o["t"] == 30 or o["t"] == 46:
				var vx := clampi(idiv(dx * FX, 40) + (o["t"] - 30) * 4096, -4 * FX, 4 * FX)
				spawn(g, "bomb", o["x"], o["y"] - 34 * FX, vx, -6 * FX)
				g.emit({"t": "sfx", "id": "throw"})
			if o["t"] >= 80:
				o["st"] = "idle"
				o["t"] = 0
		_:
			if o["t"] >= 10 and o["ground"]:
				var stalls: Array = [g.arena_left + 72, g.arena_left + 168, g.arena_left + 264]
				var cur := 0
				for i in 3:
					if absi(stalls[i] - px(o)) < absi(stalls[cur] - px(o)):
						cur = i
				var nxt: int = (cur + 1 + g.rand(2)) % 3
				o["st"] = "hop"
				o["t"] = 0
				o["vy"] = -7 * FX
				o["vx"] = idiv((stalls[nxt] - px(o)) * FX, 33)
				o["ground"] = false


static func oldgrey(g, o: Dictionary) -> void:
	var top: int = g.cam_y + 48
	match o["st"]:
		"dive":
			o["x"] += o["vx"]
			o["y"] += o["vy"]
			if o["t"] >= 30:
				o["st"] = "climb"
				o["t"] = 0
		"climb":
			o["y"] -= 2 * FX
			o["x"] += o["face"] * FX
			if py(o) <= top or o["t"] >= 60:
				o["st"] = "circle"
				o["t"] = 0
		_:
			if o["st"] != "circle":
				o["st"] = "circle"
				o["t"] = 0
				o["face"] = -1
			o["x"] += o["face"] * 2 * FX
			if px(o) < g.arena_left + 40:
				o["face"] = 1
			elif px(o) > g.arena_left + 280:
				o["face"] = -1
			o["y"] = (top + WAVE[(o["t"] >> 1) % WAVE.size()]) * FX
			if o["t"] % 40 == 20:
				spawn(g, "feather", o["x"], o["y"], 0, FX)
			if o["t"] >= 120:
				o["st"] = "dive"
				o["t"] = 0
				var tx: int = g.p["x"] >> 16
				var ty: int = (g.p["y"] >> 16) - 10
				o["vx"] = idiv((tx - px(o)) * FX, 30)
				o["vy"] = idiv((ty - py(o)) * FX, 30)
				o["face"] = sgn(o["vx"]) if o["vx"] != 0 else o["face"]
				g.emit({"t": "sfx", "id": "screech"})


static func warden(g, o: Dictionary) -> void:
	match o["st"]:
		"vanish":
			if o["t"] >= 40:
				var spots: Array = [[g.arena_left + 60, 0], [g.arena_left + 260, 0], [g.arena_left + 110, -56],
					[g.arena_left + 210, -56]]
				var s: Array = spots[g.rand(4)]
				o["x"] = s[0] * FX
				o["y"] = o["oy"] + s[1] * FX
				o["st"] = "cast"
				o["t"] = 0
				g.emit({"t": "sfx", "id": "appear"})
		"cast":
			var dx := dx_to_player(g, o)
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			if o["t"] == 45:
				for k in 3:
					var dy := dy_to_player(g, o) - 20
					spawn(g, "spark", o["x"], o["y"] - 24 * FX, sgn(dx) * (FX + k * 24576), sgn(dy) * (16384 + k * 16384))
				g.emit({"t": "sfx", "id": "cast"})
			if o["t"] >= 100:
				o["st"] = "vanish"
				o["t"] = 0
				g.emit({"t": "sfx", "id": "vanish"})
		_:
			o["st"] = "cast"
			o["t"] = 0


static func grane(g, o: Dictionary) -> void:
	var hit := fall(g, o)
	var dx := dx_to_player(g, o)
	match o["st"]:
		"windup":
			o["vx"] = 0
			if o["t"] >= 10:
				o["st"] = "cut"
				o["t"] = 0
				o["struck"] = 0
				g.emit({"t": "sfx", "id": "eswing"})
		"cut":
			var x := px(o)
			var y := py(o)
			var box: Array = [x, y - 32, x + 34, y - 8] if o["face"] > 0 else [x - 34, y - 32, x, y - 8]
			if int(o.get("struck", 0)) == 0 and g.overlap(box, g.player_box()):
				o["struck"] = 1
				g.enemy_hit(o)
			if o["t"] >= 8:
				o["cuts"] = int(o.get("cuts", 0)) + 1
				o["t"] = 0
				if o["cuts"] >= 2:
					o["cuts"] = 0
					o["st"] = "back"
					o["vx"] = -o["face"] * 163840
					o["vy"] = -5 * FX
					o["ground"] = false
				else:
					o["st"] = "windup"
		"back":
			if hit["floor"] or (o["ground"] and o["t"] > 4):
				o["vx"] = 0
				o["st"] = "walk"
				o["t"] = 0
		_:
			o["face"] = sgn(dx) if dx != 0 else o["face"]
			if absi(dx) < 34 and o["t"] > 20:
				o["st"] = "windup"
				o["t"] = 0
				o["vx"] = 0
			else:
				o["vx"] = o["face"] * 98304 if absi(dx) >= 30 else 0


static func siltking(g, o: Dictionary) -> void:
	fall(g, o)
	o["vx"] = 0
	var dx := dx_to_player(g, o)
	o["face"] = sgn(dx) if dx != 0 else o["face"]
	if int(o.get("called", 0)) == 0 and o["hp"] <= e(g, o, "hp") / 2:
		o["called"] = 1
		for x in [g.arena_left + 24, g.arena_left + 296]:
			var r: Dictionary = g.add_obj("raider", x, (o["y"] >> 16))
			r["active"] = true
			r["y"] = o["y"] - 40 * FX
		g.emit({"t": "sfx", "id": "roar"})
	match o["st"]:
		"slam":
			if o["t"] >= 40:
				slam(g, o, 150)
				o["st"] = "rest"
				o["t"] = 0
				o["n"] = int(o.get("n", 0)) + 1
		"wave":
			if o["t"] == 30:
				var w := spawn(g, "wave", o["x"] + o["face"] * 30 * FX, o["y"], o["face"] * 163840, 0)
				w["life"] = 150
				g.emit({"t": "sfx", "id": "wave"})
			if o["t"] >= 60:
				o["st"] = "rest"
				o["t"] = 0
				o["n"] = int(o.get("n", 0)) + 1
		"rest":
			if o["t"] >= 50:
				o["st"] = "slam" if int(o.get("n", 0)) % 3 == 0 else "wave"
				o["t"] = 0
		_:
			o["st"] = "rest"
			o["t"] = 0


## Grane's change (after his defeat talk): the Silt King rises where he fell.
static func silt_rise(g) -> void:
	var old: Dictionary = g.obj_by_id(g.guardian_id)
	var x: int = g.arena_left + 240
	var y: int = old["y"] >> 16 if not old.is_empty() else (g.p["y"] >> 16)
	if not old.is_empty():
		old["dead"] = true
	var k: Dictionary = g.add_obj("siltking", x, y)
	k["active"] = true
	k["oy"] = k["y"]
	g.guardian_id = k["id"]
	g.emit({"t": "sfx", "id": "roar"})
	g.emit({"t": "music", "id": "final"})


static func reset_guardian(g, o: Dictionary) -> void:
	o["hp"] = e(g, o, "hp")
	o["x"] = o["ox"]
	o["y"] = o["oy"]
	o["vx"] = 0
	o["vy"] = 0
	o["st"] = "idle"
	o["t"] = 0
	o["called"] = 0
	for s in g.objs:
		if HARMFUL.has(s["k"]) or s["k"] == "bomb":
			s["dead"] = true


# ------------------------------------------------------------------ damage and touch
## A blow of `amount` from direction `dir` (the side it travels toward).
static func damage(g, o: Dictionary, amount: int, dir: int) -> void:
	if o["k"] == "chest":
		o["dead"] = true
		var what: String = o.get("holds", "coin")
		g.emit({"t": "sfx", "id": "chest"})
		var n := 3 if what == "coin" else 1
		for i in n:
			var pk: Dictionary = g.add_obj("pickup", 0, 0)
			pk["x"] = o["x"] + (i - (n >> 1)) * 10 * FX
			pk["y"] = o["y"] - 4 * FX
			pk["vy"] = -3 * FX
			pk["what"] = what
			pk["fall"] = 1
			pk["active"] = true
			pk["w"] = 10
			pk["h"] = 10
		return
	var st: String = g.p["st"]
	var front: bool = sgn(dx_to_player(g, o)) == o["face"]
	var blocked := false
	if o["k"] == "crab" and front and st != "jattack" and st != "special":
		blocked = true
	elif o["k"] == "hullbreaker" and o["st"] != "rest":
		blocked = true
	elif o["k"] == "grane" and front:
		o["blocks"] = int(o.get("blocks", 0)) + 1
		blocked = o["blocks"] % 3 == 0
	if blocked:
		g.emit({"t": "sfx", "id": "clink"})
		return
	o["hp"] -= amount
	o["flash"] = 10
	g.emit({"t": "sfx", "id": "hit"})
	if o["hp"] <= 0:
		o["dead"] = true
		var fx := spawn(g, "fx", o["x"], o["y"] - (int(o["h"]) >> 1) * FX, 0, 0)
		fx["w"] = o["w"]
		if is_guardian(o):
			g.guardian_down(o)
		else:
			g.prog["score"] = int(g.prog["score"]) + e(g, o, "score")
			if g.rand(4) == 0:
				var pk: Dictionary = g.add_obj("pickup", 0, 0)
				pk["x"] = o["x"]
				pk["y"] = o["y"] - 8 * FX
				pk["vy"] = -3 * FX
				pk["what"] = "coin"
				pk["fall"] = 1
				pk["active"] = true
				pk["w"] = 10
				pk["h"] = 10
		return
	if not is_guardian(o) and o["k"] != "golem" and (o["k"] == "raider" or o["k"] == "thrower" or o["k"] == "crab"):
		o["st"] = "knock"
		o["t"] = 0
		o["vx"] = dir * 2 * FX


## The hero's body touches `o`.
static func touch(g, o: Dictionary) -> void:
	match o["k"]:
		"pickup":
			o["dead"] = true
			g.give(String(o["what"]), 1)
		"post":
			if int(o.get("lit", 0)) == 0:
				o["lit"] = 1
				g.check_x = o["x"]
				g.check_y = o["y"]
				g.emit({"t": "sfx", "id": "post"})
		"captive":
			if o["st"] != "free" and g.talk_id == "":
				o["st"] = "free"
				o["t"] = 0
				var parts := String(o.get("talk", "")).split(":")
				g.prog["score"] = int(g.prog["score"]) + int(g.D["score"]["captive"])
				g.queue_talk(parts[0], ("give:" + parts[1]) if parts.size() > 1 else "")
		"bell":
			if o["ground"]:
				g.take_bell(o)
		"raider", "thrower", "grane", "chest", "knife", "fx", "coinfx":
			pass
		"hullbreaker":
			if o["st"] == "charge":
				g.enemy_hit(o)
		"warden":
			if o["st"] == "cast":
				g.enemy_hit(o)
		"net":
			g.p["slow"] = 120
			o["dead"] = true
			g.emit({"t": "sfx", "id": "net"})
		"bottle", "spark", "feather":
			o["dead"] = true
			g.enemy_hit(o)
		"blast", "shock", "wave":
			g.enemy_hit(o)
		_:
			if is_enemy(o) and int(o.get("asleep", 0)) == 0:
				g.enemy_hit(o)
