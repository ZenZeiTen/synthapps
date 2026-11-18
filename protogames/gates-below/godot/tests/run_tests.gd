## Headless test suite: rule formulas, level lint, save/load, and a full playthrough.
##   godot --headless --path godot --script res://tests/run_tests.gd [-- --verbose]
extends SceneTree

const Content = preload("res://scripts/core/content.gd")
const Game = preload("res://scripts/core/game.gd")
const Rules = preload("res://scripts/core/rules.gd")
const Rng = preload("res://scripts/core/rng.gd")
const Bot = preload("res://tests/bot.gd")
const Walk = preload("res://tests/walkthrough.gd")

var passed := 0
var failed := 0


func check(name: String, ok: bool, detail: String = "") -> void:
	if ok:
		passed += 1
	else:
		failed += 1
		print("FAIL ", name, (" -- " + detail) if detail != "" else "")


## A stand-in RNG that replays fixed rolls, so formulas can be checked by hand.
class FixedRng:
	var rolls: Array
	func _init(r: Array) -> void:
		rolls = r
	func rnd(n: int) -> int:
		if n <= 0:
			return 0
		var v: int = rolls.pop_front()
		return clampi(v, 0, n - 1)


func _init() -> void:
	var verbose := "--verbose" in OS.get_cmdline_user_args()
	test_rules()
	var c: Dictionary = Content.load_all()
	test_levels(c)
	test_mechanics(c)
	test_save(c)
	test_created(c)
	test_playthrough(c, verbose)
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)


func test_rules() -> void:
	check("ap mob 1..14 gives 1", Rules.ap(1) == 1 and Rules.ap(14) == 1)
	check("ap mob 15/29/30/45", Rules.ap(15) == 1 and Rules.ap(29) == 1 and Rules.ap(30) == 2 and Rules.ap(45) == 3)
	check("ap mob 0", Rules.ap(0) == 0)
	check("resist stacking", Rules.stack_resist(25, 25) == 46, str(Rules.stack_resist(25, 25)))
	var s := Rules.creation_stats(22, 3, 16, 14)
	check("creation hp (3*22+16)/2", s["hp_max"] == 41, str(s["hp_max"]))
	check("creation mana/stamina", s["mp_max"] == 6 and s["st_max"] == 28)
	check("xp table", Rules.xp_for_next(1) == 400 and Rules.xp_for_next(2) == 1000 and Rules.xp_for_next(39) == 140000000 and Rules.xp_for_next(40) == -1)
	# Hit formula by hand. Attacker: atk 3..9, STR 15, DEX 15 -> +(225+150)/150 = 2.
	# Defender: def 2..6, DEX 10 -> +2; crowd 3 -> chaos 2 -> ospod 1.
	var a := Rules.blank_stats()
	a["atk_l"] = 3; a["atk_h"] = 9; a["str"] = 15; a["dex"] = 15; a["dmg"] = 1
	var d := Rules.blank_stats()
	d["def_l"] = 2; d["def_h"] = 6; d["dex"] = 10
	# rolls: x=4 (attack 3+4+2=9), y=1 (defence 1+1+2=4), z=0 (no magic range)
	var h := Rules.hit(FixedRng.new([4, 1, 0]), a, d, 3, 2, [])
	check("hit attack", h["attack"] == 9, str(h))
	check("hit defence", h["defence"] == 4, str(h))
	check("hit phys = 9-4+dmg", h["phys"] == 6, str(h))
	check("hit total + skill", h["total"] == 8, str(h))
	var h2 := Rules.hit(FixedRng.new([0, 5, 0]), a, d, 3, 2, ["sanctuary"])
	check("miss is zero", h2["total"] == 0, str(h2))
	a["mag_l"] = 4; a["mag_h"] = 4; a["mag_el"] = 0
	d["r_fire"] = 50
	var h3 := Rules.hit(FixedRng.new([0, 5, 0]), a, d, 3, 2, [])
	check("magic lands on a miss, halved by resist, plus skill", h3["magic"] == 2 and h3["total"] == 4, str(h3))
	var h4 := Rules.hit(FixedRng.new([6, 0, 0]), a, d, 1, 0, ["sanctuary"])
	check("sanctuary halves", h4["total"] == (h4["phys"] + h4["magic"]) / 2, str(h4))
	# cast risk: magic >= need safe; < need/2 impossible; risky band rolls
	check("cast safe", Rules.cast_outcome(FixedRng.new([]), 20, 20, true)["result"] == "safe")
	check("cast impossible", Rules.cast_outcome(FixedRng.new([]), 9, 20, true)["result"] == "impossible")
	# magic 15, need 20: per1 = (15-10)*128/20 = 32. per2=63 -> 32/2+32=48 < 63 -> backfire
	check("cast backfire", Rules.cast_outcome(FixedRng.new([63]), 15, 20, true)["result"] == "backfire")
	check("cast fizzle when no backfire spell", Rules.cast_outcome(FixedRng.new([63]), 15, 20, false)["result"] == "fizzle")
	check("cast fizzle band", Rules.cast_outcome(FixedRng.new([40]), 15, 20, true)["result"] == "fizzle")
	check("cast success band", Rules.cast_outcome(FixedRng.new([10, 0]), 15, 20, true)["result"] == "success")
	check("flee never at 0", not Rules.wants_to_flee(Rng.new(5), 0, 1, 100, 99, 1))
	check("weight defect", Rules.weight_defect(4000, 10) == 1 and Rules.weight_defect(1000, 10) == 0)
	check("sound volume", is_equal_approx(Rules.sound_volume(0), 1.0) and Rules.sound_volume(8) == 0.0)
	# the creation disc (vypocet_vlastnosti): corners, centre, and interpolation with the
	# original's fixed-point rounding (worked by hand from CALC_DIFF / CALC_DIFF2)
	var d0 := Rules.disc_ranges(0, 75)
	check("disc east rim = corner 0", d0 == {"str": [17, 22], "mag": [5, 10], "mob": [17, 22], "dex": [9, 14]}, str(d0))
	check("disc centre = balanced", Rules.disc_ranges(123, 0) == {"str": [12, 17], "mag": [12, 17], "mob": [12, 17], "dex": [12, 17]})
	check("disc 45 deg rim = corner 1", Rules.disc_ranges(45, 75)["mob"] == [20, 25])
	var d22 := Rules.disc_ranges(22, 75)
	check("disc 22 deg: STR 15-20, MAG 7-12, MOB 18-23", d22["str"] == [15, 20] and d22["mag"] == [7, 12] and d22["mob"] == [18, 23], str(d22))
	check("disc half radius: STR lo 14", Rules.disc_ranges(0, 37)["str"][0] == 14, str(Rules.disc_ranges(0, 37)))
	check("disc 359 deg: negative step floors (STR lo 17)", Rules.disc_ranges(359, 75)["str"][0] == 17, str(Rules.disc_ranges(359, 75)))
	check("disc radius clamps at 75", Rules.disc_ranges(90, 200) == Rules.disc_ranges(90, 75))
	# cases where the +8 rounding matters: MOB at 10 deg is 17 + round(3*10/45) = 18, not 17
	check("disc 10 deg rim rounds MOB up to 18", Rules.disc_ranges(10, 75)["mob"] == [18, 23], str(Rules.disc_ranges(10, 75)))
	check("disc 10 deg r50 rounds STR to 15", Rules.disc_ranges(10, 50)["str"] == [15, 20], str(Rules.disc_ranges(10, 50)))
	var rolled := Rules.disc_roll(Rng.new(4), d22)
	check("disc roll stays in range", rolled["str"] >= 15 and rolled["str"] <= 20 and rolled["mag"] >= 7 and rolled["mag"] <= 12)
	var r1 := Rng.new(99)
	var r2 := Rng.new(99)
	var same := true
	for i in 50:
		if r1.rnd(1000) != r2.rnd(1000):
			same = false
	check("rng deterministic", same)


func test_levels(c: Dictionary) -> void:
	var g := Game.new(c)
	g.new_game(1)
	for id in c["levels"]:
		var L = g.level_static(id)
		check("level %s compiles" % id, L.errors.is_empty(), str(L.errors))
		# every stair/pit target exists
		for ci in L.cells.size():
			var cell: Dictionary = L.cells[ci]
			if cell.is_empty() or not cell.get("def", {}).has("to"):
				continue
			var to: Dictionary = cell["def"]["to"]
			check("%s: target level %s exists" % [id, to["level"]], c["levels"].has(to["level"]))
			if c["levels"].has(to["level"]):
				var T = g.level_static(String(to["level"]))
				var v: Vector2i = T.cell_ref(to["at"])
				check("%s: target square %s valid" % [id, str(to["at"])], T.valid(v.x, v.y))
		# every square reachable from the start, doors and secrets counted as passable
		var start: Vector2i = L.cell_ref(L.data["start"][0])
		var seen := {L.idx(start.x, start.y): true}
		var q := [L.idx(start.x, start.y)]
		while not q.is_empty():
			var cc: int = q.pop_front()
			for dd in 4:
				var f: Dictionary = L.faces[cc * 4 + dd]
				if f.is_empty() or f["kind"] == "wall":
					continue
				var n: int = L.neighbour(cc, dd)
				if n >= 0 and not seen.has(n):
					seen[n] = true
					q.append(n)
		var total := 0
		for cell in L.cells:
			if not cell.is_empty():
				total += 1
		check("%s: all %d squares connected" % [id, total], seen.size() == total, "%d of %d" % [seen.size(), total])
		for m in L.data.get("monsters", []):
			check("%s: monster %s defined" % [id, m["id"]], c["monsters"].has(m["id"]))
		for it in L.data.get("items", []):
			check("%s: item %s defined" % [id, it["id"]], c["items"].has(it["id"]))


func test_mechanics(c: Dictionary) -> void:
	var g := Game.new(c)
	g.new_game(7)
	g.pop_events()
	# a closed door blocks until opened, and the door takes time to open
	g.s["dir"] = 1
	var r: Dictionary = g.step(0)   # A (1,1) -> (2,1)
	check("walk east", r.get("ok", false))
	r = g.step(0)
	check("closed door blocks", not r.get("ok", false))
	g.touch()
	check("door not yet passable", not g.face_passable(g.cur_cell() * 4 + 1))
	for i in 5:
		g.tick()
	check("door open after 0.5 s", g.face_passable(g.cur_cell() * 4 + 1))
	# the lever raises the portcullis south of the start room
	var gate_face: int = g.lv.face_ref("1,2.S")
	check("portcullis starts closed", not g.face_passable(gate_face))
	g.s["x"] = 0; g.s["y"] = 1; g.s["dir"] = 3
	g.touch()
	for i in 5:
		g.tick()
	check("lever raised the portcullis", g.face_passable(gate_face))
	# an item on the plate holds the crypt gate
	g.s["x"] = 8; g.s["y"] = 5; g.s["dir"] = 1
	var crypt_gate: int = g.lv.face_ref("10,5.E")
	g.s["held"] = {"id": "bone"}
	g.drop(g.lv.idx(9, 5), 0)
	for i in 5:
		g.tick()
	check("item on plate opens gate", g.face_passable(crypt_gate))
	g.pick(g.lv.idx(9, 5), 0)
	for i in 5:
		g.tick()
	check("lifting the item closes it", not g.face_passable(crypt_gate))
	# picking up a rune teaches it
	g.s["held"] = {"id": "rune_ember"}
	g.on_pickup()
	check("rune learned", "ember" in g.s["runes"] and g.s["held"] == null)
	# equipment requirements
	var ilsa := 1
	g.s["held"] = {"id": "mail"}
	check("Ilsa cannot wear ring mail (STR 14)", not g.equip_click(ilsa, "body"))
	g.s["held"] = null
	# the secret wall is walkable and becomes found
	g.s["x"] = 3; g.s["y"] = 5; g.s["dir"] = 0
	r = g.step(0)
	check("walk through illusion", r.get("ok", false) and g.s["y"] == 4)
	check("illusion found", g.ls["found"].has(str(g.lv.edge_key(g.lv.face_ref("3,5.N")))))
	# level-up grants 5 points and raise_stat follows advance_vls
	var ch: Dictionary = g.s["party"][0]
	var hp0: int = int(ch["base"]["hp_max"])
	g.gain_xp(ch, 400, true)
	check("level 2 at 400 xp", ch["level"] == 2 and ch["points"] == 10)
	var str0: int = int(ch["base"]["str"])
	var hp1: int = int(ch["base"]["hp_max"])
	g.raise_stat(0, "str")
	check("STR +1 raises max HP by the floored 1.5x step", int(ch["base"]["hp_max"]) - hp1 == int(1.5 * (str0 + 1)) - int(1.5 * str0))
	check("hidden gains raised HP", hp1 > hp0)


## A party made on the disc: four builds from the four quarters of the disc.
static func made_specs(seed_value: int) -> Array:
	var rng := Rng.new(seed_value)
	var out := []
	var picks := [["Wren", "garrow", "m", 315, 70], ["Hale", "vesna", "f", 135, 70], ["Pell", "sefa", "f", 225, 60], ["Corin", "tobin", "m", 20, 50]]
	for p in picks:
		out.append({"name": p[0], "portrait": p[1], "sex": p[2], "stats": Rules.disc_roll(rng, Rules.disc_ranges(p[3], p[4]))})
	return out


func test_created(c: Dictionary) -> void:
	var g := Game.new(c)
	var specs := made_specs(11)
	g.new_game_custom(5, specs)
	check("created party size", g.s["party"].size() == 4)
	var ok := true
	for ch in g.s["party"]:
		for slot in ch["equip"]:
			if g.meets_req(ch, ch["equip"][slot]) != "":
				ok = false
				print("  ", ch["name"], " cannot use ", ch["equip"][slot]["id"])
	check("every starting item meets its requirements", ok)
	var mage: Dictionary = g.s["party"][1]
	check("the mage build gets a staff", mage["equip"].get("hand_r", {"id": ""})["id"] == "staff", str(mage["equip"]))
	var b0: Dictionary = g.s["party"][0]["base"]
	check("creation formula for made characters", int(b0["hp_max"]) == (3 * int(specs[0]["stats"]["str"]) + int(specs[0]["stats"]["mob"])) / 2)
	check("first three: +1 max attack when STR > 20", int(b0["atk_h"]) == (3 if int(specs[0]["stats"]["str"]) > 20 else 2))
	var strong := {"name": "S", "portrait": "brann", "sex": "m", "stats": {"str": 24, "mag": 2, "mob": 15, "dex": 22}}
	var g1 := Game.new(c)
	g1.new_game_custom(5, [strong])
	check("first slot: STR 24 gives max attack 3, DEX 22 gives max defence 3", int(g1.s["party"][0]["base"]["atk_h"]) == 3 and int(g1.s["party"][0]["base"]["def_h"]) == 3,
		str([g1.s["party"][0]["base"]["atk_h"], g1.s["party"][0]["base"]["def_h"]]))
	# the fourth character never gets the bonus, whatever the roll
	var sp4 := {"name": "X", "portrait": "odo", "sex": "m", "stats": {"str": 25, "mag": 0, "mob": 15, "dex": 25}}
	var g2 := Game.new(c)
	g2.new_game_custom(5, [specs[0], specs[1], specs[2], sp4])
	check("fourth character gets no creation bonus", int(g2.s["party"][3]["base"]["atk_h"]) == 2 and int(g2.s["party"][3]["base"]["def_h"]) == 2)
	# a made party can win the whole game
	var g3 := Game.new(c)
	g3.new_game_custom(20260926, made_specs(3))
	var b := Bot.new(g3)
	var won: bool = Walk.play(b)
	check("walkthrough wins with a party made on the disc", won, "mode=%s level=%s" % [g3.s["mode"], g3.s["level"]])
	print("made-party playthrough: %d rounds, levels %s, dead %d" % [b.rounds, str(g3.s["party"].map(func(ch): return ch["level"])),
		g3.s["party"].filter(func(ch): return ch["dead"]).size()])


func test_save(c: Dictionary) -> void:
	var g := Game.new(c)
	g.new_game(3)
	g.s["dir"] = 1
	g.step(0)
	g.touch()
	for i in 7:
		g.tick()
	var snap := var_to_str(g.to_save())
	var g2 := Game.new(c)
	g2.new_game(99)
	g2.from_save(str_to_var(snap))
	check("save round trip", var_to_str(g2.to_save()) == snap)
	# both copies continue identically
	for i in 300:
		g.tick()
		g2.tick()
	check("replay after load is identical", var_to_str(g.to_save()) == var_to_str(g2.to_save()))


func test_playthrough(c: Dictionary, verbose: bool) -> void:
	var g := Game.new(c)
	g.new_game(20260926)
	var b := Bot.new(g)
	b.verbose = verbose
	var won: bool = Walk.play(b)
	if not won and not verbose:
		for l in b.log_lines.slice(maxi(0, b.log_lines.size() - 40)):
			print(l)
	if not won:
		print("held: ", g.s["held"])
		for ch in g.s["party"]:
			print(ch["name"], ": ", ch["pack"].filter(func(x): return x != null).map(func(x): return x["id"]))
		print("floor: ", g.ls["items"])
	check("walkthrough wins the game", won, "mode=%s level=%s at %d,%d" % [g.s["mode"], g.s["level"], g.s["x"], g.s["y"]])
	var dead := []
	for ch in g.s["party"]:
		if ch["dead"]:
			dead.append(ch["name"])
	print("playthrough: %d steps, %d battle rounds, party levels %s, dead %s" % [b.steps, b.rounds,
		str(g.s["party"].map(func(ch): return ch["level"])), str(dead)])
