# Headless transcript runner -- the GDScript twin of tests/harness.mjs.
#
#   godot --headless --path godot --script res://tests/run_transcripts.gd
#
# Replays every tests/transcripts/*.txt against the GDScript core and compares the
# regenerated text with the golden file byte for byte. The JavaScript core passes
# the same files, so a PASS here is engine parity. Exit code 1 on any failure.
extends SceneTree

const Core = preload("res://scripts/core.gd")


func _init() -> void:
	var root := ProjectSettings.globalize_path("res://").path_join("..").simplify_path()
	var content := root.path_join("content")
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(content.path_join("game.json")))
	var rooms := {}
	for id in data["rooms"]:
		var p := content.path_join("rooms/%s/room.json" % id)
		rooms[id] = JSON.parse_string(FileAccess.get_file_as_string(p)) if FileAccess.file_exists(p) else null
	var dir := root.path_join("tests/transcripts")
	var files := Array(DirAccess.get_files_at(dir))
	files.sort()
	var failures := 0
	var count := 0
	for f in files:
		if not f.ends_with(".txt"):
			continue
		count += 1
		var game = Core.new(data, rooms)
		var res := run_transcript(game, FileAccess.get_file_as_string(dir.path_join(f)))
		if res["actual"] == res["expected"]:
			print("PASS ", f)
		else:
			failures += 1
			print("FAIL ", f)
			var a: PackedStringArray = res["actual"].split("\n")
			var e: PackedStringArray = res["expected"].split("\n")
			for i in range(maxi(a.size(), e.size())):
				var al: String = a[i] if i < a.size() else "<eof>"
				var el: String = e[i] if i < e.size() else "<eof>"
				if al != el:
					print("  line %d\n    expected: %s\n    actual:   %s" % [i + 1, el, al])
					break
	print("%d transcripts, %d failed" % [count, failures])
	quit(1 if failures > 0 else 0)


func render_events(game, state: Dictionary, events: Array, out: Array) -> void:
	for e in events:
		match e["t"]:
			"say":
				out.append(e["text"])
			"score":
				out.append("[score +%d = %d]" % [int(e["delta"]), int(e["total"])])
			"room":
				out.append("[room %s]" % e["room"])
			"sound":
				out.append("[sound %s]" % e["name"])
			"meta":
				out.append("[meta %s]" % e["what"])
			"die":
				out.append("[died] " + e["text"])
			"win":
				out.append("[won] " + e["text"])
			"walkto":
				if e.has("exit"):
					out.append("[walk %s]" % e["exit"])
					var x: Dictionary = game.data["rooms"][state["room"]]["exits"][e["exit"]]
					var z = game.zone(state["room"], x["zone"])
					if z != null:
						state["pos"] = {"x": float(z["target"][0]), "y": float(z["target"][1])}
					render_events(game, state, game.enter_zone(state, e["exit"])["events"], out)
				else:
					out.append("[walk to %s]" % e["point"])
					var p = game.point(state["room"], e["point"])
					if p != null:
						state["pos"] = {"x": float(p[0]), "y": float(p[1])}
			_:
				push_error("unknown event " + JSON.stringify(e))


func is_input(line: String) -> bool:
	return line.begins_with(">") or line.begins_with("@") or line.begins_with("#")


func run_transcript(game, text: String) -> Dictionary:
	var lines := text.replace("\r\n", "\n").split("\n")
	var out: Array = []
	var state = null
	for raw in lines:
		var line: String = raw.rstrip(" \t\r")
		if not is_input(line):
			continue
		out.append(line)
		if line.begins_with("#"):
			continue
		if line == "@start":
			state = game.new_state()
			render_events(game, state, game.start(state), out)
		elif line.begins_with("@near "):
			var id := line.substr(6).strip_edges()
			var at = game.entities[id]["def"].get("at") if game.entities.has(id) else null
			var p = game.point(state["room"], at) if at != null else null
			assert(p != null, "@near %s: no point in %s" % [id, state["room"]])
			state["pos"] = {"x": float(p[0]), "y": float(p[1])}
		elif line.begins_with("@walkin "):
			var exit_id := line.substr(8).strip_edges()
			var x: Dictionary = game.data["rooms"][state["room"]]["exits"][exit_id]
			var z = game.zone(state["room"], x["zone"])
			state["pos"] = {"x": float(z["target"][0]), "y": float(z["target"][1])}
			var res: Dictionary = game.enter_zone(state, exit_id)
			render_events(game, state, res["events"], out)
			if res["blocked"]:
				out.append("[blocked]")
		elif line.begins_with("@at "):
			var parts := line.substr(4).strip_edges().split(" ", false)
			state["pos"] = {"x": float(parts[0]), "y": float(parts[1])}
		elif line.begins_with(">"):
			render_events(game, state, game.command(state, line.substr(1).strip_edges()), out)
		else:
			push_error("unknown directive " + line)
	while out.size() > 0 and out[out.size() - 1] == "":
		out.pop_back()
	var expected: Array = []
	for l in lines:
		expected.append(l.rstrip(" \t\r"))
	while expected.size() > 0 and expected[expected.size() - 1] == "":
		expected.pop_back()
	return {"actual": "\n".join(PackedStringArray(out)) + "\n", "expected": "\n".join(PackedStringArray(expected)) + "\n"}
