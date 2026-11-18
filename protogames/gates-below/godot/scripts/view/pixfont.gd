## The 5x9 bitmap font (6x10 cells, ASCII 32-126), drawn with draw_texture_rect_region.
extends RefCounted

var tex: Texture2D
var cell := Vector2i(6, 10)
var glyph := Vector2i(5, 9)
var cols := 16
var first := 32
var last := 126


func _init(t: Texture2D, meta: Dictionary) -> void:
	tex = t
	cell = Vector2i(int(meta["cell"][0]), int(meta["cell"][1]))
	glyph = Vector2i(int(meta["glyph"][0]), int(meta["glyph"][1]))
	cols = int(meta["cols"])
	first = int(meta["first"])
	last = int(meta["last"])


func draw(ci: CanvasItem, pos: Vector2, text: String, col: Color, scale: int = 1, shadow: bool = false) -> void:
	if shadow:
		draw(ci, pos + Vector2(scale, scale), text, Color(0, 0, 0, col.a), scale, false)
	var x := pos.x
	for i in text.length():
		var code := text.unicode_at(i)
		if code < first or code > last:
			code = 63
		var k := code - first
		var src := Rect2((k % cols) * cell.x, (k / cols) * cell.y, glyph.x, glyph.y)
		ci.draw_texture_rect_region(tex, Rect2(x, pos.y, glyph.x * scale, glyph.y * scale), src, col)
		x += cell.x * scale


func width(text: String, scale: int = 1) -> int:
	return text.length() * cell.x * scale


func center(ci: CanvasItem, cx: float, y: float, text: String, col: Color, scale: int = 1, shadow: bool = false) -> void:
	draw(ci, Vector2(roundi(cx - width(text, scale) / 2.0), y), text, col, scale, shadow)


## Greedy word wrap to at most max_px wide.
func wrap(text: String, max_px: int) -> PackedStringArray:
	var out := PackedStringArray()
	var max_chars := maxi(1, max_px / cell.x)
	for para in text.split("\n"):
		var line := ""
		for word in para.split(" "):
			if line == "":
				line = word
			elif line.length() + 1 + word.length() <= max_chars:
				line += " " + word
			else:
				out.append(line)
				line = word
			while line.length() > max_chars:
				out.append(line.substr(0, max_chars))
				line = line.substr(max_chars)
		out.append(line)
	return out
