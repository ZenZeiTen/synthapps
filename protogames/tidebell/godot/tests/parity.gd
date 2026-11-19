## Prints the GDScript core's state hash every 30 steps while replaying each route, the
## same lines as web/tests/parity.mjs. tests/parity.sh compares the two.
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Inputs = preload("res://scripts/core/inputs.gd")


func _init() -> void:
	var defs = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	var out: Array = []
	for stage in defs["stages"]:
		var r = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % stage))
		var text := FileAccess.get_file_as_string("res://content/levels/%s.txt" % stage)
		for variant in ["route", "items"]:
			var g := Game.new(defs)
			var prog := Game.new_progress(defs, 1)
			if variant == "items":
				for k in defs["items"]:
					prog["items"][k] = 3
			g.start(stage, text, prog, r.get("hero", "kess"))
			var i := 0
			for c in r["inputs"]:
				var inp := Inputs.unpack(int(c))
				if variant == "items" and i % 97 == 50:
					inp["item"] = true
				if variant == "items" and i % 211 == 100:
					inp["item"] = true
					inp["dy"] = -1
				if variant == "items" and i % 331 == 7:
					inp["special"] = true
				g.step(inp)
				for e in g.events:
					if e["t"] == "talk":
						g.close_talk()
				g.events.clear()
				i += 1
				if i % 30 == 0:
					out.append("%s %s %d %d" % [stage, variant, i, g.state_hash()])
			out.append("%s %s end %d %d mode=%s" % [stage, variant, i, g.state_hash(), g.mode])
	var f := FileAccess.open(OS.get_cmdline_user_args()[0], FileAccess.WRITE)
	f.store_string("\n".join(out) + "\n")
	f.close()
	print("PARITY lines %d" % out.size())
	quit()
