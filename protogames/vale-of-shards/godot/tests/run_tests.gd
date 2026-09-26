## Core suite: rules against hand-computed numbers from the source, level checks, saves.
##   godot --headless --path godot --script res://tests/run_tests.gd
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const D = preload("res://scripts/core/defs.gd")
const T = preload("res://scripts/core/tiles.gd")
const Level = preload("res://scripts/core/level.gd")

var passed := 0
var failed := 0

func check(cond: bool, what: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		print("FAIL ", what)

func eq(got, want, what: String) -> void:
	check(got == want, "%s: got %s, want %s" % [what, str(got), str(want)])

func fixture(name: String = "flat") -> Game:
	var g := Game.new("res://tests/fixtures")
	g.pl["level"] = 1
	g.load_level(name)
	g.init_inv()
	g.stats(1)
	g.p_reenter(false)
	g.modal = {}
	for i in 41:
		g.step({})
	return g

func run(g: Game, inp: Dictionary, n: int) -> void:
	for i in n:
		g.step(inp)

func _init() -> void:
	test_begin_and_run()
	test_jump_heights()
	test_jump_launch()
	test_land_into_run()
	test_jump_buffer()
	test_ledge_grace()
	test_ledge_from_below()
	test_wall_stop()
	test_vine()
	test_fire_caps()
	test_walk_off_edge()
	test_levels_parse()
	test_save_roundtrip()
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)

func test_begin_and_run() -> void:
	var g := fixture()
	var p = g.player()
	eq(p.state, D.ST_STAND, "after 40 entry steps the hero stands")
	eq([p.x, p.y], [64, 168], "start position: checkpoint x, 24 px above it")
	g.step({"dx": 1})
	eq(p.x, 64, "the first press only turns (X_PLAYER.C: substate 7, no move)")
	eq(p.xd, 1, "facing right after the turn step")
	g.step({"dx": 1})
	eq(p.x, 72, "running moves 8 px per step")
	run(g, {"dx": 1}, 4)
	eq(p.x, 104, "still 8 px per step")
	g.step({"dx": -1})
	eq(p.x, 104, "reversing stops first")
	eq(p.statecount, 5, "the reverse sets a 4-step pause (then +1)")

func _rise(boots: int) -> int:
	var g := fixture()
	for i in boots:
		g.addinv(D.INV_BOOTS)
	var p = g.player()
	var y0: int = p.y
	var miny: int = y0
	g.step({"fire2": true})
	miny = p.y
	for i in 60:
		g.step({})
		miny = mini(miny, p.y)
	eq(p.y, y0, "lands back on the floor (boots %d)" % boots)
	eq(p.state, D.ST_STAND, "standing after the jump (boots %d)" % boots)
	return y0 - miny

func test_jump_heights() -> void:
	eq(_rise(0), 56, "jump height 14+12+..+2")
	eq(_rise(1), 90, "jump height with spring boots 18+16+..+2")

## Adapted jump feel (DESIGN rows 9, 10, 66, 67): the source's arc and heights stay, but the jump
## leaves the floor at once, a landing runs straight on, a press just before landing is
## kept, and a press just after walking off an edge still jumps.
func test_jump_launch() -> void:
	var g := fixture()
	var p = g.player()
	var y0: int = p.y
	g.step({"fire2": true})
	eq(y0 - p.y, 14, "the jump rises 14 px on the step it is pressed (no launch hang)")
	eq(p.state, D.ST_JUMPING, "airborne after one step")

func test_land_into_run() -> void:
	var g := fixture()
	var p = g.player()
	g.step({"dx": 1})
	g.step({"dx": 1, "fire2": true})
	var landed := false
	for i in 40:
		g.step({"dx": 1})
		if p.state == D.ST_STAND:
			landed = true
			break
	check(landed, "the running jump lands")
	var x0: int = p.x
	g.step({"dx": 1})
	eq(p.x - x0, 8, "holding the direction runs on from the landing step")

func test_jump_buffer() -> void:
	var g := fixture()
	var p = g.player()
	var y0: int = p.y
	g.step({"fire2": true})
	while not (p.state == D.ST_JUMPING and p.yd >= 12):
		g.step({})
	g.step({"fire2": true})          # pressed while still falling, before the floor
	var miny: int = y0
	for i in 40:
		g.step({})
		miny = mini(miny, p.y)
	check(y0 - miny >= 40, "a jump pressed just before landing jumps again (rose %d px)" % (y0 - miny))

func test_ledge_grace() -> void:
	var g := fixture()
	var p = g.player()
	p.x = 240
	p.y = 120
	g.step({})
	while p.state == D.ST_STAND:
		g.step({"dx": 1})
	g.step({"dx": 1, "fire2": true})    # the first step after walking off
	var miny: int = p.y
	for i in 30:
		g.step({})
		miny = mini(miny, p.y)
	check(miny < 120 - 30, "a jump just after walking off an edge still jumps (top y %d)" % miny)

func test_ledge_from_below() -> void:
	var g := fixture()
	var p = g.player()
	p.x = 240
	p.px = 240
	g.step({"fire2": true})
	run(g, {}, 40)
	eq(p.y + p.yl, 160, "jumps up through the one-way ledge and lands on it")
	eq(p.state, D.ST_STAND, "standing on the ledge")
	p.x = 320
	p.y = 168
	g.step({"fire2": true})
	run(g, {}, 40)
	eq(p.y + p.yl, 208, "a ledge 4 cells up is out of reach without boots")

func test_wall_stop() -> void:
	var g := fixture()
	var p = g.player()
	p.x = 440
	run(g, {"dx": 1}, 20)
	eq(p.x, 488, "the hero stops flush against the wall")

func test_vine() -> void:
	var g := fixture()
	var p = g.player()
	p.x = 416
	g.step({"dy": -1})
	eq(p.state, D.ST_CLIMBING, "up at a vine starts climbing")
	var y0: int = p.y
	run(g, {"dy": -1}, 6)
	eq(y0 - p.y, 18, "climbing up covers 18 px per 6 steps (4,0,0,6,4,4)")
	run(g, {"dy": -1}, 80)
	eq(p.state, D.ST_STAND, "at the vine top the hero stands")
	eq(p.y + p.yl, 64, "standing on the vine top cell")
	run(g, {"dx": 1}, 4)
	eq(p.y + p.yl, 64, "steps off onto the ledge beside it")

func test_fire_caps() -> void:
	var g := fixture()
	g.step({"dx": 1})
	g.step({"fire1": true})
	eq(g.countobj(D.BOLT, false), 1, "one bolt")
	g.step({"fire1": true})
	eq(g.countobj(D.BOLT, false), 1, "holding fire does not repeat (edge-triggered)")
	g.step({})
	g.step({"fire1": true})
	eq(g.countobj(D.BOLT, false), 1, "one bolt upgrade = one bolt on screen")
	g.addinv(D.INV_BOLT)
	g.step({})
	g.step({"fire1": true})
	eq(g.countobj(D.BOLT, false), 2, "two upgrades = two bolts")

func test_walk_off_edge() -> void:
	var g := fixture()
	var p = g.player()
	p.x = 240
	p.y = 120
	g.step({})
	eq(p.state, D.ST_STAND, "standing on the ledge")
	run(g, {"dx": 1}, 6)
	eq(p.y, 120, "still standing while any part of the box is over the ledge (x=280 overlaps it by 8 px)")
	run(g, {"dx": 1}, 2)
	check(p.state == D.ST_JUMPING or p.y > 120, "walking off the ledge falls")
	run(g, {}, 30)
	eq(p.y + p.yl, 208, "lands on the floor")

func test_levels_parse() -> void:
	var d := DirAccess.open("res://content/levels")
	if d == null:
		check(false, "content/levels exists")
		return
	for f in d.get_files():
		if not f.ends_with(".txt"):
			continue
		var name := f.get_basename()
		var data := Level.load_level("res://content", name)
		check(not data.is_empty(), "level %s parses" % name)

func test_save_roundtrip() -> void:
	var g := fixture()
	run(g, {"dx": 1}, 5)
	var s := var_to_str(g.save_state())
	var g2 := Game.new("res://tests/fixtures")
	g2.load_state(str_to_var(s))
	eq(var_to_str(g2.save_state()), s, "save round-trips exactly")
	for i in 30:
		var inp := {"dx": [1, 0, -1][i % 3], "fire2": i % 7 == 0, "fire1": i % 5 == 0}
		g.step(inp)
		g2.step(inp)
	eq(var_to_str(g2.save_state()), var_to_str(g.save_state()), "a loaded game replays identically")
