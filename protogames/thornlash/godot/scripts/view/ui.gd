extends Node2D
## Menus, title, overlays. All text goes through one function so the fit audit can see it.

var main: Node = null
var frame := 0
var audit := false
var overflows: Dictionary = {}
var _panels: Array[Rect2] = []

const GOLD := Color(0.95, 0.82, 0.5)
const DIM := Color(0.6, 0.55, 0.5)
const RED := Color(0.85, 0.2, 0.15)

const ENDING_TEXT := [
	["The Pale Margrave falls.", "His keep shudders, and its", "towers fold into the fen."],
	["Dawn breaks over Hollowmoor", "for the first time in", "a hundred years."],
	["Corvin Ashdown winds the thornlash", "about his arm and walks", "home along the causeway."],
	["THORNLASH", "an original game", "", "design, code, art and music", "made for this project", "", "THANK YOU FOR PLAYING"],
]


func _process(_d: float) -> void:
	frame += 1
	queue_redraw()


func text(s: String, pos: Vector2, col: Color = Color.WHITE, big: bool = false) -> void:
	if audit:
		var ink := Rect2(pos, Vector2(Assets.text_width(s.strip_edges(false, true), big), 9 * (2 if big else 1)))
		var fr := Rect2(0, 0, 320, 224)
		for r in _panels:
			if r.has_point(pos):
				fr = r.grow(-3)
		if not fr.encloses(ink):
			overflows["over: " + s] = true
	Assets.draw_text(self, s, pos, col, big)


func ctext(s: String, cx: float, y: float, col: Color = Color.WHITE, big: bool = false) -> void:
	text(s, Vector2(cx - Assets.text_width(s, big) / 2.0, y), col, big)


func panel(r: Rect2) -> void:
	_panels.append(r)
	draw_rect(r, Color(0.04, 0.02, 0.05, 0.92))
	draw_rect(r, Color(0.45, 0.2, 0.12), false, 1.0)
	draw_rect(r.grow(-2), Color(0.25, 0.1, 0.08), false, 1.0)


func _draw() -> void:
	_panels.clear()
	var sc: String = main.screen
	match sc:
		"title":
			_draw_title()
		"menu":
			_draw_title_bg()
			_draw_menu(Rect2(100, 118, 120, 96))
		"pause", "gameover", "slots", "practice":
			_draw_menu(Rect2(60, 56, 200, 132))
		"options":
			_draw_options(Rect2(24, 34, 272, 184))
		"controls", "rebind_wait":
			_draw_controls(Rect2(16, 34, 288, 184))
		"ending":
			_draw_ending()
	if main.screen == "play" and main.rewinding:
		draw_rect(Rect2(0, 32, 320, 192), Color(0.35, 0.25, 0.1, 0.25))
		if frame % 30 < 20:
			text("<< REWIND", Vector2(8, 40), GOLD)
		var cap := maxi(1, int(main.opts.rewind) * 60)
		draw_rect(Rect2(8, 52, 60, 3), Color(0.2, 0.1, 0.05))
		draw_rect(Rect2(8, 52, 60.0 * main.history.size() / cap, 3), GOLD)
	if main.toast_t > 0:
		var w := Assets.text_width(main.toast) + 12
		var ty := 200.0 if main.screen == "play" else 4.0   # never over a menu
		var r := Rect2(160 - w / 2.0, ty, w, 16)
		panel(r)
		ctext(main.toast, 160, ty + 4, GOLD)


func _draw_title_bg() -> void:
	draw_rect(Rect2(0, 0, 320, 224), Color(0.02, 0.01, 0.04))
	var bg := Assets.texture("res://content/art/title.png")
	if bg != null:
		draw_texture(bg, Vector2.ZERO)
	else:
		ctext("THORNLASH", 160, 40, RED, true)
		ctext("THE VIGIL OF HOLLOWMOOR", 160, 66, GOLD)


func _draw_title() -> void:
	_draw_title_bg()
	if frame % 60 < 40:
		ctext("PRESS " + main.prompt("pause") + " OR " + main.prompt("jump"), 160, 170, Color.WHITE)
	ctext("AN ORIGINAL GAME  2026", 160, 208, DIM)


func _draw_menu(r: Rect2) -> void:
	var m: Dictionary = main.menu
	if m.is_empty():
		return
	var items: Array = m.items
	var title: String = m.get("title", "")
	var h := 12 * items.size() + (22 if title != "" else 10)
	r = Rect2(r.position.x, r.position.y, r.size.x, maxf(r.size.y, h))
	if m.id == "main":
		# sit below the logo, anchored to the bottom of the screen
		r = Rect2(r.position.x, 224 - h - 4, r.size.x, h)
	if m.id == "slots":
		r = Rect2(28, 56, 264, h)
	panel(r)
	var y := r.position.y + 6
	if title != "":
		ctext(title, r.get_center().x, y, RED)
		y += 16
	for i in items.size():
		var it: Dictionary = items[i]
		var sel: bool = i == int(m.sel)
		var col := GOLD if sel else DIM
		var label: String = it.label
		if m.id == "slots" and it.id == "slot":
			label = "%-6s %s" % [label, main.slot_label(String(it.slot))]
			text(("> " if sel else "  ") + label, Vector2(r.position.x + 8, y), col)
		else:
			ctext(("> " if sel else "") + label + (" <" if sel else ""), r.get_center().x, y, col)
		y += 12


func _draw_options(r: Rect2) -> void:
	var m: Dictionary = main.menu
	panel(r)
	ctext("OPTIONS", 160, r.position.y + 5, RED)
	var y := r.position.y + 18
	var items: Array = m.items
	for i in items.size():
		var it: Dictionary = items[i]
		var sel: bool = i == int(m.sel)
		var col := GOLD if sel else DIM
		text(("> " if sel else "  ") + String(it.label), Vector2(r.position.x + 8, y), col)
		var v: String = main.option_text(it)
		if v != "":
			var vs := ("< " + v + " >") if sel else v
			text(vs, Vector2(r.end.x - 8 - Assets.text_width(vs), y), Color.WHITE if sel else DIM)
		y += 11
	text("ALL OPTIONS ARE SAVED AT ONCE", Vector2(r.position.x + 8, r.end.y - 12), Color(0.45, 0.4, 0.4))


func _draw_controls(r: Rect2) -> void:
	var m: Dictionary = main.menu
	panel(r)
	ctext("CONTROLS", 160, r.position.y + 5, RED)
	text("ACTION", Vector2(r.position.x + 8, r.position.y + 16), Color(0.5, 0.45, 0.45))
	text("KEY", Vector2(r.position.x + 148, r.position.y + 16), Color(0.5, 0.45, 0.45))
	text("PAD", Vector2(r.position.x + 214, r.position.y + 16), Color(0.5, 0.45, 0.45))
	var y := r.position.y + 27
	var items: Array = m.items
	var saved: String = main.last_device
	for i in items.size():
		var it: Dictionary = items[i]
		var sel: bool = i == int(m.sel)
		var col := GOLD if sel else DIM
		text(("> " if sel else "  ") + String(it.label), Vector2(r.position.x + 8, y), col)
		if it.id == "bind":
			main.last_device = "keyboard"
			var k: String = main.prompt(String(it.action))
			main.last_device = saved if saved != "keyboard" else "xbox"
			var pd: String = main.prompt(String(it.action))
			main.last_device = saved
			if main.screen == "rebind_wait" and sel:
				k = "PRESS..." if frame % 30 < 20 else ""
				pd = ""
			text(k.substr(0, 10), Vector2(r.position.x + 148, y), Color.WHITE if sel else DIM)
			text(pd.substr(0, 9), Vector2(r.position.x + 214, y), Color.WHITE if sel else DIM)
		y += 11
	var hint := "PRESS A KEY OR BUTTON  (ESC CANCELS)" if main.screen == "rebind_wait" else "CHOOSE AN ACTION TO REBIND IT"
	text(hint, Vector2(r.position.x + 8, r.end.y - 12), Color(0.45, 0.4, 0.4))


func _draw_ending() -> void:
	draw_rect(Rect2(0, 0, 320, 224), Color(0.02, 0.01, 0.03))
	var bg := Assets.texture("res://content/art/ending_%d.png" % main._ending_page)
	if bg != null:
		draw_texture(bg, Vector2.ZERO)
	var page: int = clampi(main._ending_page, 0, ENDING_TEXT.size() - 1)
	var lines: Array = ENDING_TEXT[page]
	var a := clampf(main.screen_t / 30.0, 0.0, 1.0)
	var y := 150 if page < 3 else 50
	for i in lines.size():
		var big: bool = page == 3 and i == 0
		ctext(String(lines[i]), 160, y, Color(1, 0.9, 0.75, a) if not big else Color(0.85, 0.2, 0.15, a), big)
		y += 22 if big else 12
	if main.screen_t > 48 and frame % 60 < 40:
		ctext(main.prompt("jump"), 300, 212, DIM)
