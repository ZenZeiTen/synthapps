## Runtime loading of the content folder: PNG strips with their JSON sidecars, tile sheets,
## backdrops, WAV effects and OGG music. The files are packed byte for byte
## (tools/mark_keep.py writes importer="keep"), so the editor and an export load the same data.
extends RefCounted

const ROOT := "res://content/"

var _tex := {}
var _meta := {}
var _snd := {}


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


## Sprite metadata: {"w","h","frames","origin":[ox,oy],"tags":{tag:[a,b]}}
func meta(name: String) -> Dictionary:
	if _meta.has(name):
		return _meta[name]
	var m := {}
	var path := ROOT + "sprites/" + name + ".json"
	if FileAccess.file_exists(path):
		m = JSON.parse_string(FileAccess.get_file_as_string(path))
	_meta[name] = m
	return m


func sprite(name: String) -> Texture2D:
	return tex("sprites/" + name)


## Frame index for a tag, cycling through its frames by n.
func frame(name: String, tag: String, n: int = 0) -> int:
	var m := meta(name)
	if m.is_empty() or not m["tags"].has(tag):
		return 0
	var r: Array = m["tags"][tag]
	var count: int = int(r[1]) - int(r[0]) + 1
	return int(r[0]) + posmod(n, count)


func tag_len(name: String, tag: String) -> int:
	var m := meta(name)
	if m.is_empty() or not m["tags"].has(tag):
		return 1
	return int(m["tags"][tag][1]) - int(m["tags"][tag][0]) + 1


## Draw frame i of a sprite with its top-left at pos (already origin-corrected by the caller).
func draw_frame(ci: CanvasItem, name: String, i: int, pos: Vector2, flip: bool = false, mod: Color = Color.WHITE) -> void:
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


## Draw at an object's hitbox position using the sprite's origin.
func draw_at(ci: CanvasItem, name: String, i: int, hitbox_pos: Vector2, flip: bool = false, mod: Color = Color.WHITE) -> void:
	var m := meta(name)
	if m.is_empty():
		return
	var o: Array = m["origin"]
	draw_frame(ci, name, i, hitbox_pos - Vector2(o[0], o[1]), flip, mod)


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
