# The GDScript twin of tests/death.test.mjs: same cases against death_options() in
# scripts/main.gd, so the two engines forgive the same deaths.
#
#   godot --headless --path godot --script res://tests/death_policy.gd
#
# Prints PASS/FAIL per case and a summary line; exit code 1 on any failure.
extends SceneTree


func snap(turn: int, dead: bool = false) -> Dictionary:
	return {"snap": JSON.stringify({"room": "hall", "turns": turn, "dead": dead}), "reason": "command", "room": "hall", "turn": turn}


func _init() -> void:
	var main = load("res://scripts/main.gd").new()
	var cases := [
		["undo rewinds to the moment just before the fatal step", main.death_options([snap(1), snap(2), snap(3)], false), 2],
		["undo is offered whether or not there is a save", main.death_options([snap(1), snap(2)], true), 1],
		["a snapshot that is already dead is skipped", main.death_options([snap(1), snap(2), snap(3, true)], false), 1],
		["with no history there is nothing to undo", main.death_options([], true), null],
		["with only a dead snapshot there is nothing to undo", main.death_options([snap(1, true)], false), null],
	]
	var failed := 0
	for c in cases:
		var got = c[1].get("rewind_to")
		var ok: bool = (got == null and c[2] == null) or (got != null and c[2] != null and int(got) == int(c[2]))
		if not ok:
			failed += 1
		print("%s %s (got %s, want %s)" % ["PASS" if ok else "FAIL", c[0], str(got), str(c[2])])
	main.free()
	print("%d death-policy cases, %d failed" % [cases.size(), failed])
	quit(1 if failed > 0 else 0)
