## Interface drawing: the status bar, the message line, text windows and menus. Everything
## is drawn in 320x180 canvas pixels with the pixel font. main.gd decides what is shown.
extends Node2D

const D = preload("res://scripts/core/defs.gd")
const PixFont = preload("res://scripts/view/font.gd")

const INK := Color(0.078, 0.063, 0.11)
const WHITE := Color(0.94, 0.93, 0.9)
const GOLD := Color(0.97, 0.84, 0.35)
const DIM := Color(0.6, 0.58, 0.63)
const TEAL := Color(0.63, 0.94, 0.82)
const RED := Color(0.9, 0.38, 0.17)
# message colours by the source's colour numbers (txt(msg, col))
const MSG_COL := {2: Color(0.45, 0.85, 0.45), 3: GOLD, 5: Color(0.95, 0.5, 0.45), 6: TEAL, 7: WHITE}

var A
var F: PixFont
var main          # main.gd: tells what to draw


func setup(assets) -> void:
	A = assets
	F = PixFont.new(assets)


func _draw() -> void:
	if main != null:
		main.draw_ui(self)


# ------------------------------------------------------------------ primitives
func panel(r: Rect2, dark: float = 0.92) -> void:
	var t: Texture2D = A.sprite("panel")
	if t == null:
		draw_rect(r, Color(INK, dark))
		draw_rect(r, GOLD, false)
		return
	var c := 8
	var x0 := r.position.x
	var y0 := r.position.y
	var x1 := r.end.x
	var y1 := r.end.y
	# corners, edges, centre of the 24x24 nine-slice
	draw_texture_rect_region(t, Rect2(x0, y0, c, c), Rect2(0, 0, c, c))
	draw_texture_rect_region(t, Rect2(x1 - c, y0, c, c), Rect2(16, 0, c, c))
	draw_texture_rect_region(t, Rect2(x0, y1 - c, c, c), Rect2(0, 16, c, c))
	draw_texture_rect_region(t, Rect2(x1 - c, y1 - c, c, c), Rect2(16, 16, c, c))
	draw_texture_rect_region(t, Rect2(x0 + c, y0, r.size.x - 2 * c, c), Rect2(8, 0, 8, c))
	draw_texture_rect_region(t, Rect2(x0 + c, y1 - c, r.size.x - 2 * c, c), Rect2(8, 16, 8, c))
	draw_texture_rect_region(t, Rect2(x0, y0 + c, c, r.size.y - 2 * c), Rect2(0, 8, c, 8))
	draw_texture_rect_region(t, Rect2(x1 - c, y0 + c, c, r.size.y - 2 * c), Rect2(16, 8, c, 8))
	draw_texture_rect_region(t, Rect2(x0 + c, y0 + c, r.size.x - 2 * c, r.size.y - 2 * c), Rect2(8, 8, 8, 8))


func text(pos: Vector2, s: String, col: Color = WHITE) -> void:
	F.draw(self, pos, s, col)


func center(cx: float, y: float, s: String, col: Color = WHITE) -> void:
	F.draw_center(self, cx, y, s, col)


func portrait(pos: Vector2, who: String) -> void:
	var names := ["orrin", "sable", "tolly", "regent"]
	var i := names.find(who)
	if i >= 0:
		A.draw_frame(self, "portrait", i, pos)


func glyph(pos: Vector2, action: String, device: String) -> void:
	if device == "pad":
		var i: int = {"jump": 0, "accept": 0, "back": 1, "fire": 2, "items": 3, "menu": 4, "shop": 5}.get(action, 7)
		A.draw_frame(self, "glyph", i, pos)


# ------------------------------------------------------------------ status bar
func hud(g, y0: int) -> void:
	# slot positions come from pipeline/aseprite/art_ui.py HUD_SLOTS
	A.draw_frame(self, "hud", 0, Vector2(0, y0))
	var sc := str(g.pl["score"])
	text(Vector2(69 - F.width(sc), y0 + 12), sc, GOLD)
	for i in 5:
		A.draw_frame(self, "pip", 0 if i < g.pl["health"] else 1, Vector2(81 + i * 10, y0 + 12))
	for c in 4:
		var have: bool = g.invcount(D.INV_KEY0 + c) > 0
		A.draw_frame(self, "keyslot", c + 1 if have else 0, Vector2(140 + c * 12, y0 + 10))
	if g.fruit_icon != 0:
		A.draw_frame(self, "icon", 1 + g.fruit_icon, Vector2(194, y0 + 10))
	text(Vector2(211, y0 + 12), str(g.fruit), WHITE)
	text(Vector2(259, y0 + 12), str(g.pl["shards"]), TEAL)
	# the form recess: the weapon that fires next and how many
	var ic := "bolt"
	var n: int = g.invcount(D.INV_BOLT)
	if g.invcount(D.INV_EMBER):
		ic = "embers"
		n = g.invcount(D.INV_EMBER)
	elif g.invcount(D.INV_STONES):
		ic = "stones"
		n = g.invcount(D.INV_STONES)
	A.draw_frame(self, "icon", A.frame("icon", ic), Vector2(293, y0 + 10))
	A.draw_frame(self, "digits", clampi(n, 0, 9), Vector2(307, y0 + 14))


func message(g, title: String) -> void:
	# the message line: transient text for 100 steps, else the stage name (XARGON.C upd_botmsg)
	var s: String = g.botmsg if g.bottime > 0 else title
	if s == "":
		return
	var col: Color = MSG_COL.get(7, WHITE)
	var lines: Array = F.wrap(s, 300)
	var h: int = 4 + lines.size() * 9
	draw_rect(Rect2(0, 0, 320, h), Color(INK, 0.72))
	for i in lines.size():
		center(160, 2 + i * 9, lines[i], col if g.bottime > 0 else DIM)


# ------------------------------------------------------------------ windows
## at_bottom: spoken dialog in play sits over the status bar, clear of the characters (the
## camera keeps Orrin's feet above canvas y 120)
func text_window(title: String, lines: Array, who: String, prompt: String, at_bottom: bool = false) -> void:
	var wide := 0
	for l in lines:
		wide = maxi(wide, F.width(l))
	var has_face := who != ""
	var w := clampi(wide + 24 + (40 if has_face else 0), 160, 308)
	var h := 30 + lines.size() * 10 + (0 if lines.size() > 1 or not has_face else 10)
	h = maxi(h, 56 if has_face else 40)
	var r := Rect2(160 - w / 2, (180 - h - 3) if at_bottom else (74 - h / 2), w, h)
	panel(r)
	var x0 := r.position.x + 10
	if has_face:
		portrait(Vector2(x0, r.position.y + 12), who)
		x0 += 40
	text(Vector2(x0, r.position.y + 8), title, GOLD)
	for i in lines.size():
		text(Vector2(x0, r.position.y + 20 + i * 10), lines[i], WHITE)
	if prompt != "":
		text(Vector2(r.end.x - F.width(prompt) - 8, r.end.y - 11), prompt, DIM)


func menu(title: String, items: Array, cur: int, y: int = 40, w: int = 180, values: Array = [], row: int = 11) -> Rect2:
	var top := 20 if title != "" else 8
	var h := top + 6 + items.size() * row
	var r := Rect2(160 - w / 2, y, w, h)
	panel(r)
	center(160, y + 7, title, GOLD)
	for i in items.size():
		var yy := y + top + i * row
		var col := WHITE if i == cur else DIM
		text(Vector2(r.position.x + 18, yy), items[i], col)
		if i < values.size() and values[i] != "":
			text(Vector2(r.end.x - 12 - F.width(values[i]), yy), values[i], TEAL if i == cur else DIM)
		if i == cur:
			A.draw_frame(self, "cursor", A.frame("cursor", "blink", Time.get_ticks_msec() / 300), Vector2(r.position.x + 7, yy))
	return r
