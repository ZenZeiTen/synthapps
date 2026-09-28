class_name Assets
extends RefCounted
## Loads content raw (PNG/JSON/WAV bytes via FileAccess) so the editor, headless tests and
## the exported build read identical files. Sprite sheets are PNG + JSON with named frames
## (rect + pivot at the feet) and named animations.

static var _tex: Dictionary = {}
static var _sheets: Dictionary = {}
static var _font: Texture2D = null
static var _font_big: Texture2D = null
static var missing: Dictionary = {}

const FONT_CW := 6
const FONT_CH := 9


static func texture(path: String) -> Texture2D:
	if _tex.has(path):
		return _tex[path]
	var t: Texture2D = null
	if FileAccess.file_exists(path):
		var bytes := FileAccess.get_file_as_bytes(path)
		var img := Image.new()
		if img.load_png_from_buffer(bytes) == OK:
			t = ImageTexture.create_from_image(img)
	if t == null:
		missing[path] = true
	_tex[path] = t
	return t


static func json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		missing[path] = true
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func sheet(name: String) -> Dictionary:
	## {tex, frames: {name: {x,y,w,h,ox,oy}}, anims: {name: {frames:[..], ms:[..], loop}}}
	if _sheets.has(name):
		return _sheets[name]
	var base := "res://content/art/%s" % name
	var t := texture(base + ".png")
	var j: Variant = json(base + ".json")
	var sh := {}
	if t != null and j is Dictionary:
		# a mirrored copy of the whole sheet: flipped sprites sample it with a normal,
		# positive rect (a negative-width rect does not draw on this renderer - measured)
		var img: Image = t.get_image().duplicate()   # never flip the texture's own image
		img.flip_x()
		sh = {"tex": t, "tex_flip": ImageTexture.create_from_image(img), "tw": t.get_width(),
			"frames": j.get("frames", {}), "anims": j.get("anims", {})}
	_sheets[name] = sh
	return sh


static var _anim_index: Dictionary = {}   # anim name -> sheet name
static var _indexed := false


static func sheet_for(anim: String) -> Dictionary:
	## Finds the sheet holding `anim` among those listed in content/art/sheets.json.
	if not _indexed:
		_indexed = true
		var lst: Variant = json("res://content/art/sheets.json")
		if lst is Array:
			for n in lst:
				var sh := sheet(String(n))
				if sh.is_empty():
					continue
				for an in sh.anims:
					_anim_index[an] = String(n)
				for fr in sh.frames:
					if not _anim_index.has(fr):
						_anim_index[fr] = String(n)
	var nm: String = _anim_index.get(anim, "")
	return sheet(nm) if nm != "" else {}


static func anim_frame(sh: Dictionary, anim: String, t_frames: int) -> String:
	## Which frame of `anim` is showing t_frames (60 Hz) after it started.
	if sh.is_empty() or not sh.anims.has(anim):
		return ""
	var a: Dictionary = sh.anims[anim]
	var frames: Array = a.frames
	var ms: Array = a.get("ms", [])
	if frames.is_empty():
		return ""
	var total := 0
	for i in frames.size():
		total += int(ms[i]) if i < ms.size() else 100
	var t := int(t_frames * 1000 / 60)
	if a.get("loop", true):
		t = t % maxi(total, 1)
	var acc := 0
	for i in frames.size():
		acc += int(ms[i]) if i < ms.size() else 100
		if t < acc:
			return String(frames[i])
	return String(frames[frames.size() - 1])


static func anim_len_frames(sh: Dictionary, anim: String) -> int:
	if sh.is_empty() or not sh.anims.has(anim):
		return 1
	var total := 0
	for m in sh.anims[anim].get("ms", []):
		total += int(m)
	return maxi(1, total * 60 / 1000)


static func draw_frame(ci: CanvasItem, sh: Dictionary, frame: String, pos: Vector2, flip: bool,
		mod: Color = Color.WHITE) -> bool:
	if sh.is_empty() or not sh.frames.has(frame):
		return false
	var f: Dictionary = sh.frames[frame]
	var w: float = f.w
	var h: float = f.h
	var ox: float = f.ox
	var oy: float = f.oy
	if flip:
		var tw: float = sh.tw
		var src_f := Rect2(tw - float(f.x) - w, f.y, w, h)
		var dst_f := Rect2(round(pos.x - (w - ox)), round(pos.y - oy), w, h)
		ci.draw_texture_rect_region(sh.tex_flip, dst_f, src_f, mod)
	else:
		ci.draw_texture_rect_region(sh.tex, Rect2(round(pos.x - ox), round(pos.y - oy), w, h), Rect2(f.x, f.y, w, h), mod)
	return true


# ------------------------------------------------------------------ bitmap text

static func font() -> Texture2D:
	if _font == null:
		_font = texture("res://content/art/font.png")
	return _font


static func font_big() -> Texture2D:
	if _font_big == null:
		_font_big = texture("res://content/art/font_big.png")
	return _font_big


static func text_width(s: String, big: bool = false) -> int:
	return s.length() * FONT_CW * (2 if big else 1)


static func draw_text(ci: CanvasItem, s: String, pos: Vector2, col: Color = Color.WHITE,
		big: bool = false, shadow: bool = true) -> void:
	var tex := font_big() if big else font()
	if tex == null:
		return
	var cw := FONT_CW * (2 if big else 1)
	var chh := FONT_CH * (2 if big else 1)
	var p := pos.round()
	if shadow:
		_draw_run(ci, tex, s, p + Vector2(1, 1), cw, chh, Color(0, 0, 0, col.a))
	_draw_run(ci, tex, s, p, cw, chh, col)


static func _draw_run(ci: CanvasItem, tex: Texture2D, s: String, p: Vector2, cw: int, chh: int, col: Color) -> void:
	for i in s.length():
		var c := s.unicode_at(i)
		if c < 32 or c > 126:
			c = 63
		var gi := c - 32
		if gi == 0:
			continue
		var src := Rect2((gi % 16) * cw, (gi / 16) * chh, cw, chh)
		ci.draw_texture_rect_region(tex, Rect2(p.x + i * cw, p.y, cw, chh), src, col)


static func draw_text_centered(ci: CanvasItem, s: String, cx: float, y: float,
		col: Color = Color.WHITE, big: bool = false) -> void:
	draw_text(ci, s, Vector2(cx - text_width(s, big) / 2.0, y), col, big)
