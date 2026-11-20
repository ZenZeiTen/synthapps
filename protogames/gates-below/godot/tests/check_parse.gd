extends SceneTree
func _init() -> void:
	for p in ["res://scripts/core/rng.gd", "res://scripts/core/rules.gd", "res://scripts/core/level.gd", "res://scripts/core/content.gd", "res://scripts/core/battle.gd", "res://scripts/core/magic.gd", "res://scripts/core/game.gd"]:
		var s = load(p)
		if s == null:
			print("FAILED ", p)
			quit(1)
			return
	var C = load("res://scripts/core/content.gd")
	var c = C.load_all()
	var G = load("res://scripts/core/game.gd")
	var g = G.new(c)
	g.new_game(1)
	for id in c["levels"]:
		var L = g.level_static(id)
		print(id, " ", L.w, "x", L.h, " errors: ", L.errors)
	print("party ", g.s["party"].size(), " at ", g.s["x"], ",", g.s["y"], " dir ", g.s["dir"])
	for e in g.pop_events(): print(e)
	quit()
