## The 5x7 pixel font (sprite "font": 96 glyphs for ASCII 32..127 in 6x8 cells).
extends RefCounted

const CW := 6
const CH := 8

var A


func _init(assets) -> void:
	A = assets


func width(text: String) -> int:
	return text.length() * CW


func draw(ci: CanvasItem, pos: Vector2, text: String, col: Color = Color.WHITE) -> void:
	var t: Texture2D = A.sprite("font")
	if t == null:
		return
	var x := int(pos.x)
	for i in text.length():
		var code := text.unicode_at(i)
		if code < 32 or code > 127:
			code = 63
		var k := code - 32
		if k == 0:
			x += CW
			continue    # the space glyph holds one placeholder pixel (see art_ui.py font())
		ci.draw_texture_rect_region(t, Rect2(x, int(pos.y), CW, CH), Rect2(k * CW, 0, CW, CH), col)
		x += CW


func draw_center(ci: CanvasItem, cx: float, y: float, text: String, col: Color = Color.WHITE) -> void:
	draw(ci, Vector2(int(cx - width(text) / 2.0), y), text, col)


## Split text into lines that fit max_px.
func wrap(text: String, max_px: int) -> Array:
	var out: Array = []
	var line := ""
	for word in text.split(" "):
		var t := word if line == "" else line + " " + word
		if width(t) > max_px and line != "":
			out.append(line)
			line = word
		else:
			line = t
	if line != "":
		out.append(line)
	return out
