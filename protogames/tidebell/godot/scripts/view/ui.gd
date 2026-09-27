## Screen drawing helpers: windows (a 9-slice of the "panel" sprite), text, menus, the
## HUD, and the fit audit. Every text is drawn through text_in(), which records any text
## that does not fit inside its frame; the harness `fit` command prints them
## (the repo rule: text must fit with real data).
extends Node2D

const PixelFont = preload("res://scripts/view/font.gd")

var A
var F
var main = null
var overflows := {}
var frame := 0


func setup(assets) -> void:
	A = assets
	F = PixelFont.new(assets)


func _process(_d: float) -> void:
	frame += 1
	queue_redraw()


func _draw() -> void:
	if main != null:
		main.draw_ui(self)


func window(r: Rect2) -> void:
	var t: Texture2D = A.sprite("panel")
	if t == null:
		draw_rect(r, Color(0.05, 0.08, 0.2))
		return
	var s := 8
	var x0 := r.position.x
	var y0 := r.position.y
	var w := r.size.x
	var h := r.size.y
	# corners, edges, middle
	draw_texture_rect_region(t, Rect2(x0, y0, s, s), Rect2(0, 0, s, s))
	draw_texture_rect_region(t, Rect2(x0 + w - s, y0, s, s), Rect2(16, 0, s, s))
	draw_texture_rect_region(t, Rect2(x0, y0 + h - s, s, s), Rect2(0, 16, s, s))
	draw_texture_rect_region(t, Rect2(x0 + w - s, y0 + h - s, s, s), Rect2(16, 16, s, s))
	draw_texture_rect_region(t, Rect2(x0 + s, y0, w - 2 * s, s), Rect2(8, 0, 8, s))
	draw_texture_rect_region(t, Rect2(x0 + s, y0 + h - s, w - 2 * s, s), Rect2(8, 16, 8, s))
	draw_texture_rect_region(t, Rect2(x0, y0 + s, s, h - 2 * s), Rect2(0, 8, s, 8))
	draw_texture_rect_region(t, Rect2(x0 + w - s, y0 + s, s, h - 2 * s), Rect2(16, 8, s, 8))
	draw_texture_rect_region(t, Rect2(x0 + s, y0 + s, w - 2 * s, h - 2 * s), Rect2(8, 8, 8, 8))


## Text at pos that must stay inside `frame` (the inner area of its window or screen).
func text_in(frame_r: Rect2, pos: Vector2, s: String, col: Color = Color.WHITE) -> void:
	var w: int = F.width(s)
	if pos.x < frame_r.position.x or pos.x + w > frame_r.end.x + 0.5 or pos.y < frame_r.position.y \
			or pos.y + 8 > frame_r.end.y + 0.5:
		overflows["over: " + s.strip_edges().left(40)] = true
	F.draw(self, pos, s, col)


func text_center(frame_r: Rect2, cx: float, y: float, s: String, col: Color = Color.WHITE) -> void:
	text_in(frame_r, Vector2(int(cx - F.width(s) / 2.0), y), s, col)


## A menu of items in a window; returns nothing. The cursor points at `cur`.
func menu(r: Rect2, items: Array, cur: int, title: String = "") -> void:
	window(r)
	var inner := r.grow(-9)
	var y := inner.position.y + 2
	if title != "":
		text_center(inner, r.get_center().x, y, title, Color(1, 0.9, 0.5))
		y += 14
	for i in items.size():
		var col := Color.WHITE if i == cur else Color(0.7, 0.75, 0.85)
		text_in(inner, Vector2(inner.position.x + 10, y), String(items[i]), col)
		if i == cur:
			A.draw_frame(self, "cursor", (frame >> 4) % 2, Vector2(inner.position.x, y))
		y += 11


func portrait(who: String, pos: Vector2) -> void:
	var order: Array = A.meta("portraits").get("tags", {}).keys()
	if not A.meta("portraits").get("tags", {}).has(who):
		return
	A.draw_frame(self, "portraits", A.frame("portraits", who), pos)
