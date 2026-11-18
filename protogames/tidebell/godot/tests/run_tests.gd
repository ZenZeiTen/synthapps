## Core rule checks, headless. Each check drives the core with inputs the way a player
## would press them and compares with the numbers in docs/ANALYSIS.md and DESIGN.md.
##   godot --headless --path godot --script res://tests/run_tests.gd
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Code = preload("res://scripts/core/code.gd")
const FX := 65536

var passed := 0
var failed := 0
var defs: Dictionary


func _init() -> void:
	defs = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	for m in get_method_list():
		var n: String = m["name"]
		if n.begins_with("test_"):
			call(n)
	print("TESTS %d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)


func ok(cond: bool, what: String) -> void:
	if cond:
		passed += 1
	else:
		failed += 1
		printerr("FAIL ", what)


func fixture(name: String, hero: String = "kess", diff: int = 1) -> Game:
	var g := Game.new(defs)
	var prog := Game.new_progress(defs, diff)
	g.start(name, FileAccess.get_file_as_string("res://tests/fixtures/%s.txt" % name), prog, hero)
	return g


func level(name: String, hero: String = "kess") -> Game:
	var g := Game.new(defs)
	g.start(name, FileAccess.get_file_as_string("res://content/levels/%s.txt" % name), Game.new_progress(defs, 1), hero)
	return g


func run(g: Game, n: int, inp: Dictionary) -> void:
	for i in n:
		g.step(inp)


# ------------------------------------------------------------------ movement
func test_walk_matches_source() -> void:
	# ANALYSIS: 0.375, 0.9375, 1.5, 2.0625, 2.625, then 2.75 (M1, M2)
	var g := fixture("flat")
	var want := [24576, 61440, 98304, 135168, 172032, 180224, 180224]
	var got: Array = []
	for i in want.size():
		g.step({"dx": 1})
		got.append(g.p["vx"])
	ok(got == want, "walk speeds %s" % str(got))
	g.step({})
	ok(g.p["vx"] == 0, "stops on the step after release (M3)")


func test_walk_moves_on_press_step() -> void:
	var g := fixture("flat")
	var x0: int = g.p["x"]
	g.step({"dx": 1})
	ok(g.p["x"] > x0 and g.p["st"] == "walk", "walk shows on the press step")


func test_jump_rises_on_press_step() -> void:
	var g := fixture("flat")
	var y0: int = g.p["y"]
	g.step({"jump": true})
	ok(g.p["y"] < y0, "the hero rises on the press step (M5)")


func test_full_jump_matches_source() -> void:
	# held jump: the source's arc, 81 px high, 38 frames in the air (M4)
	var g := fixture("flat")
	var y0: int = g.p["y"]
	var top: int = y0
	var air := 0
	for i in 60:
		g.step({"jump": true})
		top = mini(top, g.p["y"])
		if g.p["y"] < y0:
			air += 1
	var h := float(y0 - top) / FX
	ok(h > 80.0 and h < 82.5, "jump height %.2f" % h)
	ok(air >= 37 and air <= 39, "frames in the air %d" % air)


func test_tap_jump_is_lower() -> void:
	var g := fixture("flat")
	var y0: int = g.p["y"]
	var top: int = y0
	g.step({"jump": true})
	for i in 50:
		g.step({})
		top = mini(top, g.p["y"])
	var h := float(y0 - top) / FX
	ok(h > 10.0 and h < 30.0, "tap hop height %.2f (M6)" % h)


func test_jump_buffer_and_coyote() -> void:
	# a press a few steps before landing still jumps (M7)
	var g := fixture("flat")
	run(g, 1, {"jump": true})
	var n := 0
	while g.p["vy"] <= 0 or (g.p["y"] >> 16) < 180:
		g.step({"jump": true})
		n += 1
		if n > 80:
			break
	g.step({})
	g.step({"jump": true})         # pressed in the air, about 3 steps before landing
	var jumped := false
	for i in 10:
		g.step({"jump": true})
		if g.p["vy"] < -FX * 6:
			jumped = true
	ok(jumped, "a buffered press jumps on landing")


func test_climb_to_top_of_column() -> void:
	var g := fixture("flat")
	g.p["x"] = (21 * 16 + 8) * FX
	run(g, 1, {})
	var n := 0
	while g.p["st"] != "stand" or n < 3:
		g.step({"dy": -1})
		n += 1
		if n > 200:
			break
	ok((g.p["y"] >> 16) == 4 * 16, "stands on the column top (M12), y=%d" % (g.p["y"] >> 16))


func test_pit_returns_to_firm_ground() -> void:
	var g := fixture("flat")
	g.p["x"] = (32 * 16) * FX
	g.snap_camera()
	run(g, 3, {})
	var hp: int = g.p["hp"]
	var n := 0
	while g.p["hp"] == hp and n < 200:
		g.step({"dx": 1})
		n += 1
	ok(hp - g.p["hp"] == 20, "a pit costs 20 (H7), cost %d" % (hp - g.p["hp"]))
	ok((g.p["x"] >> 16) < 33 * 16 and g.p["ground"] or (g.p["y"] >> 16) == 192, "back on firm ground")


func test_spikes_hurt_by_difficulty() -> void:
	for d in 3:
		var g := fixture("flat", "kess", d)
		g.p["x"] = (70 * 16 + 8) * FX
		run(g, 2, {})
		var hp: int = g.p["hp"]
		var n := 0
		while g.p["hp"] == hp and n < 40:
			g.step({"dx": 1})
			n += 1
		ok(hp - g.p["hp"] == [10, 15, 20][d], "spikes on difficulty %d cost %d" % [d, hp - g.p["hp"]])
		ok(g.p["st"] == "hurt" and g.p["vx"] < 0, "thrown back from the spikes")


# ------------------------------------------------------------------ attacks
func test_attack_length_and_root() -> void:
	var g := fixture("flat")
	g.step({"attack": true})
	ok(g.p["st"] == "attack", "the swing shows on the press step (A1)")
	var x0: int = g.p["x"]
	var n := 1
	while true:
		g.step({"dx": 1})
		if g.p["st"] != "attack":
			break
		n += 1
	ok(n == 20, "Kess's swing lasts 20 steps, got %d" % n)
	ok(g.p["x"] == x0, "rooted during the swing")


func test_chain_goes_cut_cut_spin() -> void:
	var g := fixture("flat")
	var combos: Array = []
	for i in 70:
		var a := i % 8 == 0
		g.step({"attack": a})
		if g.p["st"] == "attack" and g.p["atk"] == 0:
			combos.append(g.p["combo"])
	ok(combos.slice(0, 3) == [0, 1, 2], "chain %s (A3)" % str(combos))


func test_crouch_and_air_attack_lengths() -> void:
	var g := fixture("flat")
	g.step({"dy": 1})
	g.step({"dy": 1, "attack": true})
	var n := 1
	while true:
		g.step({"dy": 1})
		if g.p["st"] != "cattack":
			break
		n += 1
	ok(n == 21, "crouch attack 21 steps (A4), got %d" % n)
	g = fixture("flat")
	g.step({"jump": true})
	run(g, 3, {"jump": true})
	g.step({"jump": true, "attack": true})
	n = 1
	while true:
		g.step({"jump": true})
		if g.p["st"] != "jattack":
			break
		n += 1
	ok(n == 13, "jump attack 13 steps (A5), got %d" % n)


func test_special_needs_24_and_costs_12() -> void:
	var g := fixture("flat")
	var hp: int = g.p["hp"]
	g.step({"special": true})
	ok(g.p["st"] == "special" and hp - g.p["hp"] == 12, "Tide Cleave costs 12 (A6)")
	g = fixture("flat")
	g.p["hp"] = 23
	g.step({"special": true})
	ok(g.p["st"] != "special", "not below 24 health")
	g.prog["items"]["fury"] = 1
	g.prog["sel"] = "fury"
	g.step({"item": true})
	g.step({})
	g.step({"special": true})
	ok(g.p["st"] == "special" and g.p["hp"] == 23, "free with Fury Salt (A8)")


func test_raider_hit_costs_12_and_knocks_back() -> void:
	var g := fixture("flat")
	g.p["x"] = (41 * 16) * FX
	var hp: int = g.p["hp"]
	var n := 0
	while g.p["hp"] == hp and n < 300:
		g.step({})
		n += 1
	ok(hp - g.p["hp"] == 12, "a raider's cut costs 12 (H4), cost %d" % (hp - g.p["hp"]))
	ok(g.p["st"] == "hurt" and g.p["inv"] == 100, "knocked back with 100 safe steps (H6)")
	ok(absi(g.p["vx"]) == 4 * FX or g.p["vx"] == 0, "knockback speed 4")


func test_raider_dies_to_three_cuts() -> void:
	var g := fixture("flat")
	var r: Dictionary = {}
	for o in g.objs:
		if o["k"] == "raider":
			r = o
	g.p["x"] = r["x"] - 30 * FX
	for i in 120:
		g.step({"attack": i % 20 == 0})
		if r["dead"]:
			break
	ok(r["dead"], "the raider (6 hp) falls to Kess's cuts (2, 2, 4)")


func test_chest_and_pickup() -> void:
	var g := fixture("flat")
	g.p["x"] = (24 * 16) * FX
	run(g, 2, {})
	g.step({"attack": true})
	run(g, 60, {"dx": 1})
	ok(g.prog["items"]["tonic"] == 1, "the chest's tonic was picked up")


func test_captive_talks_after_landing() -> void:
	var g := fixture("flat")
	g.p["x"] = 476 * FX            # the captive's box starts at 480
	g.snap_camera()
	var talked := -1
	for i in 60:
		g.step({"dx": 1, "jump": true})
		for e in g.events:
			if e["t"] == "talk":
				talked = i
				ok(g.p["ground"], "the talk opens only once the hero has landed")
		g.events.clear()
		if talked >= 0:
			break
	ok(talked >= 0 and g.mode == "talk", "the captive's story page opens")
	g.close_talk()
	ok(g.prog["items"]["knives"] == 1, "the captive's gift")


func test_death_and_respawn() -> void:
	var g := fixture("flat")
	run(g, 50, {"dx": 1})          # past the post
	g.hurt(500, 1, true)
	ok(g.mode == "dead", "dead at 0 health")
	run(g, 95, {})
	ok(g.mode == "play" and g.prog["lives"] == 2 and g.p["hp"] == 71 and g.p["shown"] < 10, "back with full health, bar refilling (H8)")
	ok((g.p["x"] >> 16) == 7 * 16 + 8, "at the post")


func test_game_over() -> void:
	var g := fixture("flat")
	for i in 3:
		g.hurt(500, 1, true)
		run(g, 95, {})
	ok(g.mode == "over", "game over after 3 lives (H9)")


# ------------------------------------------------------------------ items
func test_items() -> void:
	var g := fixture("flat")
	g.prog["items"]["heartroot"] = 5
	g.prog["sel"] = "heartroot"
	for i in 5:
		g.step({"item": true})
		g.step({})
	ok(g.prog["maxhp"] == 127 and g.p["hp"] == 127, "heartroot +24 to the 127 cap (H1, I2), got %d" % g.prog["maxhp"])
	ok(g.prog["items"]["heartroot"] == 2, "not used once at the cap and full")
	g.p["hp"] = 50
	g.prog["items"]["tonic"] = 1
	g.prog["sel"] = "tonic"
	g.step({"item": true})
	ok(g.p["hp"] == 127, "tonic fills health (I1)")
	g.prog["items"]["stoneskin"] = 1
	g.step({"sel": "stoneskin"})
	g.step({"item": true})
	ok(g.p["buff"] == "stoneskin" and g.p["buff_t"] == 1200, "stoneskin 20 s (I6)")


func test_tide_code_round_trip() -> void:
	var p := {"done": 4, "lives": 5, "maxhp": 95, "difficulty": 2, "items": {"knives": 7, "tonic": 3}}
	var c := Code.encode(p)
	var d := Code.decode(c)
	ok(c.length() == 6 and d["done"] == 4 and d["lives"] == 5 and d["maxhp"] == 95 and d["difficulty"] == 2
		and d["items"]["knives"] == 7 and d["items"]["tonic"] == 3, "tide-code %s round trip" % c)
	var bad := c.substr(0, 5) + ("B" if c[5] != "B" else "C")
	ok(Code.decode(bad).is_empty(), "a changed letter is refused")
