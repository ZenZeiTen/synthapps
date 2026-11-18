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
# Fit audit (on in harness runs): every text drawn outside its frame, or clipped or wrapped to
# stay inside it, is recorded here. The frame of a text is the last panel drawn this pass
# that holds its start (a text is drawn after its own panel), else the screen. The harness
# command `fit` reports and clears it.
var audit := false
var overflows := {}
var _panels: Array[Rect2] = []


func setup(assets) -> void:
	A = assets
	F = PixFont.new(assets)


func _draw() -> void:
	_panels.clear()
	if main != null:
		main.draw_ui(self)


# ------------------------------------------------------------------ primitives
func panel(r: Rect2, dark: float = 0.92) -> void:
	_panels.append(r)
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
	if audit:
		_check_fit(pos, s)
	F.draw(self, pos, s, col)


func center(cx: float, y: float, s: String, col: Color = WHITE) -> void:
	text(Vector2(int(cx - F.width(s) / 2.0), y), s, col)


## The ink of a text must lie inside its frame: 5 px in from a panel's edge (the border
## art), or across the screen (text outside panels may scroll off the top or bottom, as
## the credits do).
func _check_fit(pos: Vector2, s: String) -> void:
	var inked := s.strip_edges(false, true)
	var lead := inked.length() - inked.strip_edges(true, false).length()
	if inked.strip_edges() == "":
		return
	var ink := Rect2(pos.x + lead * F.CW, pos.y, F.width(inked) - lead * F.CW, F.CH)
	var frame := Rect2(0, ink.position.y, 320, F.CH)
	for r in _panels:
		if r.has_point(pos):
			frame = r.grow(-5)
	if not frame.encloses(ink):
		note_fit("over", s)


func note_fit(kind: String, s: String) -> void:
	if audit:
		overflows["%s: %s" % [kind, s.strip_edges()]] = true


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
	var has_face := who != ""
	# a line too long for the widest window is wrapped (and noted: the text should be shortened)
	var room := 308 - 24 - (40 if has_face else 0)
	var fitted: Array = []
	for l in lines:
		if F.width(l) > room:
			note_fit("wrap", l)
			fitted.append_array(F.wrap(l, room))
		else:
			fitted.append(l)
	lines = fitted
	var wide := 0
	for l in lines:
		wide = maxi(wide, F.width(l))
	var w := clampi(wide + 24 + (40 if has_face else 0), 160, 308)
	var h := 32 + lines.size() * 10 + (0 if lines.size() > 1 or not has_face else 10)
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
		text(Vector2(r.end.x - F.width(prompt) - 8, r.end.y - 13), prompt, DIM)


## w is the smallest width; the menu grows to fit its title and each item with its value.
func menu(title: String, items: Array, cur: int, y: int = 40, w: int = 180, values: Array = [], row: int = 11) -> Rect2:
	var top := 20 if title != "" else 8
	var h := top + 6 + items.size() * row
	w = maxi(w, F.width(title) + 20)
	for i in items.size():
		w = maxi(w, 18 + F.width(items[i]) + _value_room(values, i) + 12)
	w = mini(w, 316)
	var r := Rect2(160 - w / 2, y, w, h)
	panel(r)
	center(160, y + 7, title, GOLD)
	for i in items.size():
		var yy := y + top + i * row
		var col := WHITE if i == cur else DIM
		var s: String = items[i]
		var room: int = w - 18 - _value_room(values, i) - 12
		if F.width(s) > room:
			note_fit("clip", s)
			s = s.left(room / F.CW)
		text(Vector2(r.position.x + 18, yy), s, col)
		if i < values.size() and values[i] != "":
			text(Vector2(r.end.x - 12 - F.width(values[i]), yy), values[i], TEAL if i == cur else DIM)
		if i == cur:
			A.draw_frame(self, "cursor", A.frame("cursor", "blink", Time.get_ticks_msec() / 300), Vector2(r.position.x + 7, yy))
	return r


func _value_room(values: Array, i: int) -> int:
	return F.width(values[i]) + 12 if i < values.size() and values[i] != "" else 0
