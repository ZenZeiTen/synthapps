# The GDScript twin of tests/music.test.mjs: the same cases against music_for() in
# scripts/main.gd, so both engines play the same track in the same place.
#
#   godot --headless --path godot --script res://tests/music_policy.gd
#
# Prints PASS/FAIL per case and a summary line; exit code 1 on any failure.
extends SceneTree


func _init() -> void:
	var main = load("res://scripts/main.gd").new()
	var index := {"tracks": {"t": {}, "a": {}, "b": {}, "e": {}}, "title": "t", "ending": "e", "rooms": {"hall": "a", "cellar": "b"}}
	var cases := [
		["the title screen has its own track", main.music_for("title", {}, index), "t"],
		["the ending has its own track", main.music_for("ending", {"room": "cellar"}, index), "e"],
		["the hall plays its track", main.music_for("play", {"room": "hall", "dead": false}, index), "a"],
		["the cellar plays its track", main.music_for("play", {"room": "cellar", "dead": false}, index), "b"],
		["silence while Gus lies dead", main.music_for("play", {"room": "hall", "dead": true}, index), null],
		["silence in an unlisted room", main.music_for("play", {"room": "attic", "dead": false}, index), null],
		["silence without an index", main.music_for("play", {"room": "hall", "dead": false}, null), null],
	]
	var failed := 0
	for c in cases:
		var ok: bool = (c[1] == null and c[2] == null) or (c[1] != null and c[2] != null and str(c[1]) == str(c[2]))
		if not ok:
			failed += 1
		print("%s %s (got %s, want %s)" % ["PASS" if ok else "FAIL", c[0], str(c[1]), str(c[2])])
	main.free()
	print("%d music-policy cases, %d failed" % [cases.size(), failed])
	quit(1 if failed > 0 else 0)
