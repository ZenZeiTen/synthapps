## Route search shared by tests/route.gd (one stage) and tests/playthrough.gd (the whole game).
##
## A segment is a weighted best-first search over per-step inputs through the real rules,
## from a game state to a goal: touch a cell, ride a platform, or hold an item. Only
## route-relevant state is part of the visited key (the player, movers, the board, the
## inventory size), so creatures never make two states look different. "hunt" and "until"
## are small policies instead of searches: fight a boss, or wait on a moving plank.
extends RefCounted

const Game = preload("res://scripts/core/game.gd")
const D = preload("res://scripts/core/defs.gd")
const Demo = preload("res://scripts/core/demo.gd")
const INPUTS := Demo.INPUTS
const MOVERS := [D.PLATFORM, D.LIFT, D.DOOR, D.SPRING, D.SWITCH, D.BUTTON, D.TOKEN, D.KEY, D.SIGIL, D.TRANSPAD]
const BUDGET := 120000

var heap_f: Array = []
var games: Array = []
var parent := PackedInt32Array()
var input := PackedInt32Array()
var steps := PackedInt32Array()
var quiet := false


static func settle(g: Game) -> void:
	var guard := 0
	while not g.modal.is_empty() and guard < 20:
		g.close_modal()
		guard += 1


## "x,y" (touch), "x,y!" (touch, may fire), "ride", "until:col", "have:item", "hunt:kind"
static func parse(route: String) -> Array:
	var out: Array = []
	for part in route.split(";", false):
		var s := part.strip_edges()
		if s == "ride":
			out.append(["ride", 0, false])
		elif s.begins_with("until:"):
			out.append(["until", int(s.substr(6)), false])
		elif s.begins_with("have:"):
			out.append(["have", D.INV_NAMES.find(s.substr(5)), true])
		elif s.begins_with("hunt:"):
			out.append(["hunt", D.kind_id(s.substr(5)), false])
		else:
			var fire := s.ends_with("!")
			var a := s.trim_suffix("!").split(",")
			out.append([int(a[0]), int(a[1]), fire])
	return out


static func touches(g: Game, cx: int, cy: int) -> bool:
	var p = g.player()
	return p.x < cx * 16 + 16 and cx * 16 < p.x + p.xl and p.y < cy * 16 + 16 and cy * 16 < p.y + p.yl


static func sgn(v: int) -> int:
	return (1 if v > 0 else 0) - (1 if v < 0 else 0)


## Runs one goal from g. Returns [inputs, game_after] or [] if it fails.
func run(g: Game, goal: Array, is_last: bool) -> Array:
	if goal[0] is String and goal[0] == "hunt":
		return hunt(g, goal[1], is_last)
	if goal[0] is String and goal[0] == "until":
		return wait_until(g, goal[1])
	return segment(g, goal, is_last)


func say(s: String) -> void:
	if not quiet:
		print(s)


func key_of(g: Game) -> String:
	var p = g.player()
	var sub: int = p.substate
	var sc: int = clampi(p.statecount, -8, 4) if p.state in [D.ST_STAND, D.ST_CLIMBING, D.ST_JUMPING, D.ST_PLATFORM] else p.statecount
	if p.state == D.ST_STAND:
		sub = 0 if p.substate == 0 else (7 if p.substate == 7 else 1)
	elif p.state == D.ST_JUMPING:
		sub = mini(sub, 9)
		sc = 0
	var m := ""
	for o in g.objs:
		if o.kind in MOVERS:
			m += "%d.%d.%d.%d.%d;" % [o.x, o.y, o.state, o.substate, o.counter]
	return "%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d|%d|%d|%d|%s" % [p.kind, p.x, p.y, p.state, sub, p.xd, p.yd, sc, p.info1,
		g.fire1off, g.fire2off, g.pl["inv"].size(), hash(g.board), g.blink_phase, m]


func push(f: float, n: int) -> void:
	heap_f.append([f, n])
	var i := heap_f.size() - 1
	while i > 0:
		var pi := (i - 1) / 2
		if heap_f[pi][0] <= heap_f[i][0]:
			break
		var t = heap_f[pi]
		heap_f[pi] = heap_f[i]
		heap_f[i] = t
		i = pi


func pop() -> int:
	var top = heap_f[0]
	var last = heap_f.pop_back()
	if not heap_f.is_empty():
		heap_f[0] = last
		var i := 0
		var n := heap_f.size()
		while true:
			var l := 2 * i + 1
			var r := l + 1
			var m := i
			if l < n and heap_f[l][0] < heap_f[m][0]:
				m = l
			if r < n and heap_f[r][0] < heap_f[m][0]:
				m = r
			if m == i:
				break
			var t = heap_f[m]
			heap_f[m] = heap_f[i]
			heap_f[i] = t
			i = m
	return top[1]


func hdist(g: Game, goal: Array) -> float:
	var p = g.player()
	if goal[0] is String:
		# "ride": the nearest moving platform; "have": the nearest token or crate holding the item
		var best := 1e9
		for o in g.objs:
			var hit := false
			if goal[0] == "ride":
				hit = o.kind == D.PLATFORM
			else:
				hit = (o.kind == D.TOKEN and o.state == goal[1]) or (o.kind == D.CRATE and goal[1] == D.INV_GATEKEY and o.state == 10)
			if hit:
				best = minf(best, absf(p.x - o.x) / 8.0 + absf(p.y + p.yl - o.y - o.yl) / 10.0)
		return best
	var dx := absf(p.x + p.xl * 0.5 - (goal[0] * 16 + 8))
	var dy := absf(p.y + p.yl * 0.5 - (goal[1] * 16 + 8))
	return dx / 8.0 + dy / 10.0


func reached(c: Game, goal: Array, is_last: bool) -> bool:
	if is_last and not c.level.get("overworld", false):
		return c.newlevel.begins_with("!") or c.gameover == 2
	if goal[0] is String:
		if goal[0] == "ride":
			return c.player().state == D.ST_PLATFORM
		return c.invcount(goal[1]) > 0
	return touches(c, goal[0], goal[1])


func segment(start: Game, goal: Array, is_last: bool) -> Array:
	heap_f = []
	games = [start]
	parent = PackedInt32Array([-1])
	input = PackedInt32Array([-1])
	steps = PackedInt32Array([0])
	var seen := {key_of(start): true}
	push(0.0, 0)
	var nin: int = INPUTS.size() if goal[2] else 8
	var expanded := 0
	while not heap_f.is_empty() and expanded < BUDGET:
		var n := pop()
		var g: Game = games[n]
		games[n] = null
		expanded += 1
		for i in nin:
			var c: Game = g.clone()
			c.step(INPUTS[i])
			settle(c)
			if c.player().state == D.ST_DIE:
				continue
			var k := key_of(c)
			if seen.has(k):
				continue
			seen[k] = true
			games.append(c)
			parent.append(n)
			input.append(i)
			steps.append(steps[n] + 1)
			var id := games.size() - 1
			if reached(c, goal, is_last):
				var path: Array = []
				var q := id
				while q > 0:
					path.push_front(input[q])
					q = parent[q]
				say("  segment to %s,%s: %d steps, %d expanded" % [goal[0], goal[1], path.size(), expanded])
				games = []
				return [path, c]
			push(steps[id] + 2.5 * hdist(c, goal), id)
	say("  segment to %s,%s: NOT FOUND after %d expanded" % [goal[0], goal[1], expanded])
	games = []
	return []


func hunt(g: Game, kind: int, is_last: bool) -> Array:
	# face the nearest target, close in to bolt range, and fire every other step
	var path: Array = []
	for t in 4000:
		var target = null
		var best := 1 << 30
		var p = g.player()
		for o in g.objs:
			if o.kind == kind and o.substate < 50 and o.info1 < 40:
				var d: int = absi(o.x + o.xl / 2 - p.x - 12)
				if d < best:
					best = d
					target = o
		var done: bool = target == null
		if is_last:
			done = g.gameover == 2 or g.newlevel.begins_with("!")
		if done:
			say("  hunt %s: %d steps" % [D.KINDS[kind][0], path.size()])
			return [path, g]
		var i := 0
		if target != null and p.state != D.ST_STILL:
			var dx: int = sgn(target.x + target.xl / 2 - (p.x + 12))
			if best > 120 or p.info1 != dx:
				i = 1 if dx > 0 else 2
			elif t % 2 == 0:
				i = 8
		g.step(INPUTS[i])
		settle(g)
		path.append(i)
		if g.player().state == D.ST_DIE:
			break
	say("  hunt %s: FAILED" % D.KINDS[kind][0])
	return []


func wait_until(g: Game, col: int) -> Array:
	# ride without input until Orrin's box spans the given cell column
	var path: Array = []
	var p = g.player()
	var target: int = col * 16
	for t in 800:
		if p.x <= target and p.x + p.xl >= target:
			say("  wait until column %d: %d steps" % [col, path.size()])
			return [path, g]
		g.step(INPUTS[0])
		settle(g)
		path.append(0)
		if p.state == D.ST_DIE:
			break
	say("  wait until column %d: FAILED" % col)
	return []
