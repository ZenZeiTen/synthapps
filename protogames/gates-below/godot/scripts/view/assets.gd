## Runtime loading of the content package: PNGs as ImageTextures (files are packed raw,
## see tools/mark_keep.py), sprite-sheet sidecars, GLB models and WAV sounds.
extends RefCounted

const ROOT := "res://content/"

var _tex := {}
var _meta := {}
var _glb := {}
var _wav := {}


## Bare keys ("wall_stone") mean surface textures; others carry their folder.
static func full(key: String) -> String:
	return key if "/" in key else "textures/" + key


func tex(key: String) -> Texture2D:
	key = full(key)
	if _tex.has(key):
		return _tex[key]
	# raw bytes (packed as-is by the "keep" importer), decoded here: export-safe
	var bytes := FileAccess.get_file_as_bytes(ROOT + key + ".png")
	var img := Image.new()
	var t: Texture2D = null
	if bytes.size() > 0 and img.load_png_from_buffer(bytes) == OK:
		t = ImageTexture.create_from_image(img)
	else:
		push_error("missing texture " + key)
	_tex[key] = t
	return t


## Frames of a horizontal strip (Aseprite json-array layout) or one frame.
func meta(key: String) -> Dictionary:
	key = full(key)
	if _meta.has(key):
		return _meta[key]
	var m := {}
	var path := ROOT + key + ".json"
	if FileAccess.file_exists(path):
		m = JSON.parse_string(FileAccess.get_file_as_string(path))
	else:
		var t := tex(key)
		m = {"frames": [{"frame": {"x": 0, "y": 0, "w": t.get_width(), "h": t.get_height()}, "duration": 100}], "meta": {"frameTags": []}}
	var t2 := tex(key)
	m["size"] = Vector2(t2.get_width(), t2.get_height())
	m["tags"] = {}
	for tg in m["meta"].get("frameTags", []):
		m["tags"][tg["name"]] = [int(tg["from"]), int(tg["to"])]
	_meta[key] = m
	return m


## Shader region (uv offset, uv size) of frame i.
func region(key: String, i: int) -> Vector4:
	var m := meta(key)
	var fr: Dictionary = m["frames"][clampi(i, 0, m["frames"].size() - 1)]["frame"]
	var s: Vector2 = m["size"]
	return Vector4(fr["x"] / s.x, fr["y"] / s.y, fr["w"] / s.x, fr["h"] / s.y)


func frame_count(key: String) -> int:
	return meta(key)["frames"].size()


func frame_px(key: String) -> Vector2:
	var fr: Dictionary = meta(key)["frames"][0]["frame"]
	return Vector2(fr["w"], fr["h"])


func glb(name: String) -> Node3D:
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	var err := doc.append_from_file(ROOT + "models/" + name + ".glb", st)
	if err != OK:
		push_error("cannot load model " + name)
		return Node3D.new()
	return doc.generate_scene(st)


func wav(name: String) -> AudioStream:
	if _wav.has(name):
		return _wav[name]
	var path := ROOT + name + ".wav"
	var s: AudioStream = null
	if FileAccess.file_exists(path):
		s = AudioStreamWAV.load_from_file(path)
	_wav[name] = s
	return s


func json(path: String):
	return JSON.parse_string(FileAccess.get_file_as_string(ROOT + path))
