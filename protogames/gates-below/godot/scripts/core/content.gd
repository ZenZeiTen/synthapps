## Loads the content package (res://content/data/*.json, res://content/levels/*.json).
extends RefCounted

const ROOT := "res://content/"


static func read_json(path: String):
	var txt := FileAccess.get_file_as_string(path)
	if txt == "":
		push_error("content: cannot read " + path)
		return {}
	var v = JSON.parse_string(txt)
	if v == null:
		push_error("content: bad JSON in " + path)
		return {}
	return v


static func load_all() -> Dictionary:
	var c := {}
	for k in ["items", "monsters", "spells", "party", "dialogs", "book", "shops"]:
		c[k] = read_json(ROOT + "data/" + k + ".json")
	c["levels"] = {}
	for f in DirAccess.get_files_at(ROOT + "levels"):
		if f.ends_with(".json"):
			var d: Dictionary = read_json(ROOT + "levels/" + f)
			c["levels"][d["id"]] = d
	return c
