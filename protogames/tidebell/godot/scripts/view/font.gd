## The 5x7 pixel font (sprite "font": ASCII 32..127 in 6x8 cells).
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
		if code == 32:
			x += CW
			continue    # the space cell holds one placeholder pixel; it is never drawn
		ci.draw_texture_rect_region(t, Rect2(x, int(pos.y), CW, CH), Rect2((code - 32) * CW, 0, CW, CH), col)
		x += CW


func draw_center(ci: CanvasItem, cx: float, y: float, text: String, col: Color = Color.WHITE) -> void:
	draw(ci, Vector2(int(cx - width(text) / 2.0), y), text, col)
