## Finds (and with `write`, saves) the route through one stage.
##   godot --headless --path godot --script res://tests/route.gd -- stage=reach [hero=kess] [write]
extends SceneTree

const Router = preload("res://tests/router.gd")


func _init() -> void:
	var stage := "reach"
	var hero := "kess"
	var write := false
	var width := 40
	for a in OS.get_cmdline_user_args():
		if a.begins_with("stage="):
			stage = a.substr(6)
		elif a.begins_with("hero="):
			hero = a.substr(5)
		elif a.begins_with("width="):
			width = int(a.substr(6))
		elif a == "write":
			write = true
	var defs = JSON.parse_string(FileAccess.get_file_as_string("res://content/data/defs.json"))
	var text := FileAccess.get_file_as_string("res://content/levels/%s.txt" % stage)
	var r := Router.new(defs)
	r.width = width
	var t0 := Time.get_ticks_msec()
	var res := r.find(stage, text, hero)
	print("ROUTE %s %s steps=%d hp=%d in %.1fs" % [stage, "ok" if res["ok"] else "FAIL", res["steps"], res["hp"],
		(Time.get_ticks_msec() - t0) / 1000.0])
	if res["ok"] and write:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../content/routes"))
		var f := FileAccess.open("res://../content/routes/%s.json" % stage, FileAccess.WRITE)
		f.store_string(JSON.stringify({"stage": stage, "hero": hero, "inputs": res["inputs"]}))
		f.close()
		print("ROUTE written content/routes/%s.json" % stage)
	quit(0 if res["ok"] else 1)
