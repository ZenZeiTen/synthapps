## Loads the content folder at run time: PNG strips (described by content/data/manifest.json),
## tile sheets, backdrops, stills, WAV effects and OGG music. The files are packed byte for
## byte (tools/mark_keep.py writes importer="keep"), so the editor and an export read the
## same data.
extends RefCounted

const ROOT := "res://content/"

var manifest: Dictionary = {}
var _tex := {}
var _snd := {}


func _init() -> void:
	var path := ROOT + "data/manifest.json"
	if FileAccess.file_exists(path):
		manifest = JSON.parse_string(FileAccess.get_file_as_string(path))


func tex(path: String) -> Texture2D:
	if _tex.has(path):
		return _tex[path]
	var bytes := FileAccess.get_file_as_bytes(ROOT + path + ".png")
	var img := Image.new()
	var t: Texture2D = null
	if bytes.size() > 0 and img.load_png_from_buffer(bytes) == OK:
		t = ImageTexture.create_from_image(img)
	_tex[path] = t
	return t


func meta(name: String) -> Dictionary:
	return manifest.get("sprites", {}).get(name, {})


func sprite(name: String) -> Texture2D:
	return tex("sprites/" + name)


## The frame index for a tag, cycling through its frames by n.
func frame(name: String, tag: String, n: int = 0) -> int:
	var m := meta(name)
	if m.is_empty() or not m["tags"].has(tag):
		return 0
	var r: Array = m["tags"][tag]
	return int(r[0]) + posmod(n, int(r[1]))


func tag_len(name: String, tag: String) -> int:
	var m := meta(name)
	if m.is_empty() or not m["tags"].has(tag):
		return 1
	return int(m["tags"][tag][1])


## Draws frame i with its top-left at pos.
func draw_frame(ci: CanvasItem, name: String, i: int, pos: Vector2, flip: bool = false,
		mod: Color = Color.WHITE) -> void:
	var t := sprite(name)
	var m := meta(name)
	if t == null or m.is_empty():
		return
	var w: int = m["w"]
	var h: int = m["h"]
	var src := Rect2(i * w, 0, w, h)
	var dst := Rect2(pos.round(), Vector2(w, h))
	if flip:
		dst = Rect2(pos.round() + Vector2(w, 0), Vector2(-w, h))
	ci.draw_texture_rect_region(t, dst, src, mod)


## Draws frame i with the sprite's origin at `at` (an object's feet).
func draw_at(ci: CanvasItem, name: String, i: int, at: Vector2, flip: bool = false, mod: Color = Color.WHITE) -> void:
	var m := meta(name)
	if m.is_empty():
		return
	var o: Array = m["origin"]
	var ox: int = int(o[0])
	if flip:
		ox = int(m["w"]) - ox
	draw_frame(ci, name, i, at - Vector2(ox, int(o[1])), flip, mod)


func sound(path: String) -> AudioStream:
	if _snd.has(path):
		return _snd[path]
	var s: AudioStream = null
	if FileAccess.file_exists(ROOT + path + ".wav"):
		s = AudioStreamWAV.load_from_file(ROOT + path + ".wav")
	elif FileAccess.file_exists(ROOT + path + ".ogg"):
		s = AudioStreamOggVorbis.load_from_file(ROOT + path + ".ogg")
	_snd[path] = s
	return s
