## Loads every script, so a syntax error anywhere fails the run (the test runner's first step).
extends SceneTree


func _init() -> void:
	var bad := 0
	for dir in ["res://scripts/core", "res://scripts/view", "res://tests"]:
		var d := DirAccess.open(dir)
		if d == null:
			continue
		for f in d.get_files():
			if f.ends_with(".gd"):
				var s = load(dir + "/" + f)
				if s == null or not (s is GDScript) or not s.can_instantiate():
					bad += 1
					printerr("PARSE FAIL ", dir, "/", f)
	print("PARSE %s" % ("ok" if bad == 0 else "FAIL %d" % bad))
	quit(1 if bad else 0)
