## The whole game in the core, stage after stage, with the progress carried over (health
## maximum, items, lives, score), as a player carries it. Each stage first replays its
## recorded route; a route recorded from a fresh start can drift once the inventory differs
## (the repo rule: recorded inputs are fragile), so a stage whose replay does not reach its
## bell is searched again live from the real state. The run prints how many were.
##   godot --headless --path godot --script res://tests/playthrough.gd   (a few minutes)
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Inputs = preload("res://scripts/core/inputs.gd")
const Router = preload("res://tests/router.gd")


func _init() -> void:
	var defs = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	var prog := Game.new_progress(defs, 1)
	var searched := 0
	var ok := true
	for stage in defs["stages"]:
		var text := FileAccess.get_file_as_string("res://content/levels/%s.txt" % stage)
		var r = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % stage))
		var g := Game.new(defs)
		var p: Dictionary = prog.duplicate(true)
		g.start(stage, text, p, r.get("hero", "kess"))
		var cleared := false
		for c in r["inputs"]:
			g.step(Inputs.unpack(int(c)))
			for e in g.events:
				if e["t"] == "talk":
					g.close_talk()
				elif e["t"] == "clear":
					cleared = true
			g.events.clear()
			if cleared or g.mode == "dead" or g.mode == "over":
				break
		if cleared:
			prog = g.prog
		else:
			searched += 1
			printerr("playthrough: %s drifted from its route; searching again" % stage)
			var rt := Router.new(defs)
			var res := rt.find(stage, text, r.get("hero", "kess"), prog)
			if not res["ok"]:
				print("PLAYTHROUGH FAIL at %s" % stage)
				ok = false
				break
			prog = res["prog"]
		prog["done"] = int(prog["done"]) + 1
		print("PLAYTHROUGH %s cleared: score %d lives %d maxhp %d items %s" % [stage, int(prog["score"]),
			int(prog["lives"]), int(prog["maxhp"]), str(prog["items"])])
	if ok:
		print("PLAYTHROUGH ok: 6 bells, %d stage(s) searched again" % searched)
	quit(0 if ok else 1)
