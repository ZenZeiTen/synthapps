## Replays every recorded route (content/routes/*.json) through the core and checks each
## reaches its goal: the stage's bell is taken ("clear"). A route that only runs out of
## inputs is a failure (the repo rule: check each segment's goal, not only that it ended).
##   godot --headless --path godot --script res://tests/replay_routes.gd
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Inputs = preload("res://scripts/core/inputs.gd")


func _init() -> void:
	var defs = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	var bad := 0
	for stage in defs["stages"]:
		var path := "res://content/routes/%s.json" % stage
		if not FileAccess.file_exists(path):
			print("REPLAY %s MISSING" % stage)
			bad += 1
			continue
		var r = JSON.parse_string(FileAccess.get_file_as_string(path))
		var g := Game.new(defs)
		g.start(stage, FileAccess.get_file_as_string("res://content/levels/%s.txt" % stage),
			Game.new_progress(defs, 1), r.get("hero", "kess"))
		var cleared := false
		var steps := 0
		for c in r["inputs"]:
			g.step(Inputs.unpack(int(c)))
			steps += 1
			for e in g.events:
				if e["t"] == "talk":
					g.close_talk()
				elif e["t"] == "clear":
					cleared = true
			g.events.clear()
			if g.mode == "dead" or cleared:
				break
		var ok := cleared and g.mode != "dead"
		print("REPLAY %s %s steps=%d hp=%d lives=%d" % [stage, "ok" if ok else "FAIL", steps, g.p["hp"],
			int(g.prog["lives"])])
		if not ok:
			bad += 1
	print("REPLAYS %s" % ("ok" if bad == 0 else "FAIL %d" % bad))
	quit(1 if bad else 0)
