## All 2D drawing at 640x360: the frame, right panel (compass, mini-map, buttons,
## message log), the six character cards, and every overlay drawn over the 3D view.
## Immediate mode: each draw registers clickable rectangles in `hot`; main.gd asks
## hit() what is under the mouse.
extends Node2D

const PAL := ["0d0b14", "1c1726", "2e2838", "45404f", "5f5b68", "7d7a83", "a09d9f", "cdc8c0", "f2ede0",
	"2b1a14", "4a2c1c", "6e4428", "94643a", "bf8f55", "5c3a2e", "8c5a44", "c08868", "e8b894",
	"1c2a1e", "2f4a2a", "4f7234", "86a54a", "141e3c", "23407a", "3a70b0", "7ab8e0", "3a0f12", "7a1c1c",
	"b8382a", "e8783a", "f0c048", "fff39a"]
const VIEW := Rect2(0, 0, 448, 272)
const EQUIP_LAYOUT := {"head": Vector2(186, 30), "neck": Vector2(222, 30), "body": Vector2(186, 66), "hand_r": Vector2(150, 84),
	"hand_l": Vector2(222, 84), "legs": Vector2(186, 102), "feet": Vector2(186, 138), "ring1": Vector2(150, 138),
	"ring2": Vector2(222, 138), "quiver": Vector2(150, 30)}
const DIR_LETTER := ["N", "E", "S", "W"]
const ACT_ICON := {"attack": "icon_attack", "cast": "icon_cast", "guard": "icon_guard", "throw": "icon_throw", "use": "icon_bag"}

var m                  # main.gd
var font
var hot: Array = []    # [Rect2, info]
var mouse = Vector2.ZERO
var hover_info: Dictionary = {}


func c(i: int, a: float = 1.0) -> Color:
	var col = Color.html(PAL[i])
	col.a = a
	return col


func tex(key: String) -> Texture2D:
	return m.A.tex(key)


func reg(r: Rect2, info: Dictionary) -> void:
	hot.append([r, info])


func hit(p: Vector2) -> Dictionary:
	for i in range(hot.size() - 1, -1, -1):
		if (hot[i][0] as Rect2).has_point(p):
			return hot[i][1]
	return {}


func panel(r: Rect2, fill: int = 2) -> void:
	# 9-slice of ui/panel (8 px borders)
	var t = tex("ui/panel")
	var b = 8.0
	var s = Vector2(24, 24)
	draw_rect(r.grow(-4), c(fill))
	var xs = [r.position.x, r.position.x + b, r.end.x - b]
	var ys = [r.position.y, r.position.y + b, r.end.y - b]
	var ws = [b, r.size.x - 2 * b, b]
	var hs = [b, r.size.y - 2 * b, b]
	var sx = [0.0, b, s.x - b]
	var sy = [0.0, b, s.y - b]
	var sw = [b, s.x - 2 * b, b]
	for j in 3:
		for i in 3:
			if i == 1 and j == 1:
				continue
			draw_texture_rect_region(t, Rect2(xs[i], ys[j], ws[i], hs[j]), Rect2(sx[i], sy[j], sw[i], sw[j]))


func text(p: Vector2, s: String, col: int = 8, scale: int = 1, shadow: bool = true) -> void:
	font.draw(self, p, s, c(col), scale, shadow)


func button(r: Rect2, label: String, info: Dictionary, enabled: bool = true) -> void:
	var over: bool = r.has_point(mouse) and enabled
	draw_rect(r, c(4 if over else 3))
	draw_rect(r, c(12 if over else 1), false, 1.0)
	font.center(self, r.position.x + r.size.x / 2.0, r.position.y + (r.size.y - 9) / 2.0, label, c(8 if enabled else 5), 1, true)
	if enabled:
		reg(r, info)


func icon(key: String, p: Vector2, scale: float = 1.0) -> void:
	var t = tex(key)
	if t:
		draw_texture_rect(t, Rect2(p, Vector2(t.get_width(), t.get_height()) * scale), false)


func item_icon(it, p: Vector2, scale: float = 1.0) -> void:
	if it == null:
		return
	icon("items/" + String(m.g.item_def(it).get("icon", "bone")), p, scale)
	if it.has("amount") and int(it["amount"]) > 1:
		font.draw(self, p + Vector2(24 * scale - font.width(str(it["amount"])), 24 * scale - 9), str(it["amount"]), c(31), 1, true)


# ------------------------------------------------------------------ main draw

func _draw() -> void:
	hot.clear()
	mouse = get_global_mouse_position()
	if m.g == null:
		return
	match String(m.screen):
		"title":
			draw_title()
		"create":
			draw_create()
		_:
			draw_game()
	draw_cursor()


func draw_game() -> void:
	var g = m.g
	draw_rect(Rect2(0, 0, 448, 272), c(0), false, 1.0)
	draw_right_panel()
	draw_cards()
	var ov = String(m.overlay)
	if ov == "":
		reg(VIEW, {"kind": "view"})
		draw_view_hud()
	else:
		draw_rect(VIEW, c(0, 0.55))
		match ov:
			"inv": draw_inventory()
			"cast": draw_cast()
			"map": draw_automap(Rect2(8, 8, 432, 256), true)
			"book": draw_book()
			"dialog": draw_dialog()
			"shop": draw_shop()
			"menu": draw_menu()
			"help": draw_help()
	if g.s["mode"] == "dead":
		draw_end(false)
	elif g.s["mode"] == "won":
		draw_end(true)


func draw_view_hud() -> void:
	var g = m.g
	if g.s["mode"] == "battle":
		var ci: int = m.plan_char()
		var r = Rect2(4, 232, 440, 36)
		draw_rect(r, c(0, 0.75))
		draw_rect(r, c(27), false, 1.0)
		text(Vector2(10, 236), "BATTLE - round %d" % (int(g.s["battle"].get("round", 0)) + 1), 29)
		if ci >= 0:
			var nm: String = g.s["party"][ci]["name"]
			text(Vector2(10, 250), "%s: [A]ttack [C]ast [G]uard [T]hrow  [Enter] all attack" % nm, 7)
		else:
			text(Vector2(10, 250), "...", 7)
	# hover tooltip over floor items and fittings
	var h = hit(mouse)
	if h.get("kind", "") == "view" and not m.hover_text.is_empty():
		var w: int = font.width(m.hover_text) + 8
		var p = Vector2(clampf(mouse.x + 10, 0, 448 - w), clampf(mouse.y - 14, 0, 260))
		draw_rect(Rect2(p, Vector2(w, 12)), c(0, 0.8))
		text(p + Vector2(4, 2), m.hover_text, 31)


func draw_right_panel() -> void:
	var g = m.g
	panel(Rect2(448, 0, 192, 272), 1)
	var lvname: String = g.lv.data["name"]
	font.center(self, 544, 6, lvname, c(30), 1, true)
	# compass
	icon("ui/compass", Vector2(456, 20))
	font.center(self, 476, 35, DIR_LETTER[int(g.s["dir"])], c(8), 1, true)
	var t = int(g.s["time"])
	var day = t / (24 * 360) + 1
	var hour = (t / 360) % 24
	var minute = (t % 360) / 6
	text(Vector2(504, 22), "Day %d  %02d:%02d" % [day, hour, minute], 7)
	icon("items/coins", Vector2(502, 32), 0.75)
	text(Vector2(524, 38), "%d" % int(g.s["gold"]), 30)
	if g.s["held"] != null:
		text(Vector2(504, 50), g.item_name(g.s["held"]).substr(0, 21), 25)
	# mini-map
	var mm = Rect2(454, 64, 180, 96)
	draw_rect(mm, c(0))
	draw_automap(mm, false)
	draw_rect(mm, c(3), false, 1.0)
	# buttons
	var btn = [["icon_bag", "inv", "I"], ["icon_cast", "cast", "C"], ["icon_map", "map", "M"], ["icon_book", "book", "B"],
		["icon_rest", "rest", "R"], ["icon_menu", "menu", "Esc"]]
	for i in btn.size():
		var r = Rect2(456 + i * 30, 166, 24, 22)
		var over = r.has_point(mouse)
		draw_rect(r, c(4 if over else 2))
		draw_rect(r, c(12 if over else 0), false, 1.0)
		icon("ui/" + btn[i][0], r.position + Vector2(4, 3))
		reg(r, {"kind": "button", "id": btn[i][1]})
		if over:
			hover_info = {"text": {"inv": "Inventory (I)", "cast": "Cast (C)", "map": "Map (M)", "book": "Book (B)", "rest": "Rest (R)", "menu": "Menu (Esc)"}[btn[i][1]]}
	# message log
	var lines = PackedStringArray()
	var log: Array = g.s["log"]
	for i in range(log.size() - 1, -1, -1):
		var wrapped: PackedStringArray = font.wrap(String(log[i]), 178)
		for j in range(wrapped.size() - 1, -1, -1):
			lines.insert(0, wrapped[j])
		if lines.size() >= 8:
			break
	while lines.size() > 8:
		lines.remove_at(0)
	for i in lines.size():
		var fade: float = 0.55 + 0.45 * float(i + 1) / lines.size()
		font.draw(self, Vector2(456, 194 + i * 10), lines[i], c(7, fade), 1, true)
	if hover_info.has("text"):
		var w: int = font.width(hover_info["text"]) + 8
		draw_rect(Rect2(mouse.x - w, mouse.y - 16, w, 12), c(0, 0.85))
		text(Vector2(mouse.x - w + 4, mouse.y - 14), hover_info["text"], 31)
	hover_info = {}


func draw_cards() -> void:
	var g = m.g
	draw_rect(Rect2(0, 272, 640, 88), c(1))
	for i in 6:
		var r = Rect2(2 + i * 106, 274, 104, 84)
		if i >= g.s["party"].size():
			draw_rect(r, c(0))
			continue
		var ch: Dictionary = g.s["party"][i]
		var st: Dictionary = g.stats(ch)
		var sel: bool = i == int(m.sel)
		draw_rect(r, c(2))
		var flash = float(m.card_flash.get(i, 0.0))
		if flash > 0.0:
			draw_rect(r, c(28, flash * 0.6))
		draw_rect(r, c(30 if sel else 3), false, 1.0)
		icon("portraits/" + String(ch["portrait"]), r.position + Vector2(3, 3))
		if ch["dead"]:
			draw_rect(Rect2(r.position + Vector2(3, 3), Vector2(40, 48)), c(0, 0.6))
			icon("ui/dead", r.position + Vector2(3, 3))
		text(r.position + Vector2(3, 54), String(ch["name"]), 30 if sel else 8)
		text(r.position + Vector2(3, 66), "L%d" % int(ch["level"]), 6)
		if int(ch["points"]) > 0 and not ch["dead"]:
			text(r.position + Vector2(24, 66), "+%d" % int(ch["points"]), 21)
		var bars = [["hp", "hp_max", 28], ["st", "st_max", 20], ["mp", "mp_max", 24]]
		for b in 3:
			var cur = int(ch[bars[b][0]])
			var mx = maxi(1, int(st[bars[b][1]]))
			var br = Rect2(r.position.x + 47, r.position.y + 5 + b * 13, 54, 9)
			draw_rect(br, c(0))
			draw_rect(Rect2(br.position, Vector2(br.size.x * clampf(float(cur) / mx, 0, 1), br.size.y)), c(bars[b][2]))
			font.draw(self, br.position + Vector2(2, 0), "%d" % cur, c(8), 1, true)
		# weapon in hand, or the planned action in battle
		if g.s["mode"] == "battle" and not ch["dead"]:
			var p: Dictionary = g.battle.plan_of(i)
			if not p.is_empty():
				icon("ui/" + ACT_ICON.get(String(p["act"]), "icon_guard"), r.position + Vector2(48, 45))
				text(r.position + Vector2(66, 49), String(p["act"]).substr(0, 6), 7)
			elif i == m.plan_char():
				text(r.position + Vector2(48, 49), "ready?", 29)
		else:
			var w = ch["equip"].get("hand_r")
			if w != null:
				item_icon(w, r.position + Vector2(48, 43), 0.75)
			var fstate = ""
			if int(ch["food"]) < 6 * 360:
				fstate += "hungry "
			if int(ch["water"]) < 6 * 360:
				fstate += "thirsty"
			if fstate != "" and not ch["dead"]:
				text(r.position + Vector2(47, 70), fstate.strip_edges().substr(0, 9), 29)
		for e in ch["effects"]:
			text(r.position + Vector2(70, 58), "*", 25)
		reg(r, {"kind": "card", "i": i})


# ------------------------------------------------------------------ automap

func draw_automap(area: Rect2, full: bool) -> void:
	var g = m.g
	var L = g.lv
	var cs = 8.0
	var origin = Vector2.ZERO
	if full:
		panel(Rect2(area.position - Vector2(4, 4), area.size + Vector2(8, 8)), 1)
		cs = floorf(minf((area.size.x - 16) / L.w, (area.size.y - 30) / L.h))
		origin = area.position + Vector2((area.size.x - cs * L.w) / 2.0, 22)
		font.center(self, area.position.x + area.size.x / 2.0, area.position.y + 4, "%s - map" % L.data["name"], c(30), 1, true)
	else:
		origin = area.position + area.size / 2.0 - Vector2(g.s["x"] * cs + cs / 2.0, g.s["y"] * cs + cs / 2.0)
	var seen: Dictionary = g.ls["seen"]
	for ci in L.cells.size():
		if L.cells[ci].is_empty() or not seen.has(str(ci)):
			continue
		var x: int = ci % L.w
		var y: int = ci / L.w
		var p = origin + Vector2(x * cs, y * cs)
		if not full and not area.grow(-1).intersects(Rect2(p, Vector2(cs, cs))):
			continue
		var cell: Dictionary = L.cells[ci]
		var fill = 3
		match String(cell["type"]):
			"water": fill = 23
			"pit": fill = 0
			"teleport": fill = 24 if bool(g.ls["tele"].get(str(ci), true)) else 3
			"plate": fill = 5
			"stairs": fill = 12
		draw_rect(Rect2(p, Vector2(cs, cs)), c(fill))
		for d in 4:
			var fi: int = ci * 4 + d
			var f: Dictionary = L.faces[fi]
			var kind = String(f["kind"])
			if kind == "open":
				continue
			if kind == "secret" and not g.ls["found"].has(str(L.edge_key(fi))):
				kind = "wall"
			elif kind == "secret":
				continue
			var col = 7
			if kind == "door":
				col = 12 if not g.face_passable(fi) else 11
			elif kind == "gate":
				col = 25 if not g.face_passable(fi) else 4
			var a = p
			var b = p
			match d:
				0: b = p + Vector2(cs, 0)
				1:
					a = p + Vector2(cs - 1, 0)
					b = p + Vector2(cs - 1, cs)
				2:
					a = p + Vector2(0, cs - 1)
					b = p + Vector2(cs, cs - 1)
				3: b = p + Vector2(0, cs)
			draw_line(a, b, c(col), 1.0 if cs < 12 else 2.0)
		if cell.get("stairs", "") != "" and cs >= 8:
			font.draw(self, p + Vector2(cs / 2 - 2, cs / 2 - 4), ">" if cell["stairs"] == "down" else "<", c(8))
	# the party: an arrow
	var pc = origin + Vector2(g.s["x"] * cs + cs / 2.0, g.s["y"] * cs + cs / 2.0)
	var d = int(g.s["dir"])
	var fwd = Vector2([0, 1, 0, -1][d], [-1, 0, 1, 0][d])
	var rt = Vector2(-fwd.y, fwd.x)
	var k = cs * 0.4
	draw_colored_polygon(PackedVector2Array([pc + fwd * k, pc - fwd * k + rt * k * 0.8, pc - fwd * k - rt * k * 0.8]), c(30))
	if full:
		reg(Rect2(0, 0, 448, 272), {"kind": "close"})


# ------------------------------------------------------------------ inventory

func slot_box(p: Vector2, it, info: Dictionary, label: String = "") -> void:
	icon("ui/slot", p)
	var r = Rect2(p, Vector2(28, 28))
	if it != null:
		item_icon(it, p + Vector2(2, 2))
	elif label != "":
		font.center(self, p.x + 14, p.y + 10, label, c(4), 1, false)
	if r.has_point(mouse):
		draw_rect(r, c(30), false, 1.0)
		if it != null:
			m.hover_item = it
	reg(r, info)


func draw_inventory() -> void:
	var g = m.g
	var ci = int(m.sel)
	var ch: Dictionary = g.s["party"][ci]
	var st: Dictionary = g.stats(ch)
	panel(Rect2(4, 4, 440, 264), 2)
	reg(Rect2(4, 4, 440, 264), {"kind": "none"})
	icon("portraits/" + String(ch["portrait"]), Vector2(14, 14))
	text(Vector2(60, 14), String(ch["name"]), 30, 2)
	text(Vector2(60, 34), "Level %d   XP %d / %d" % [ch["level"], ch["xp"], g.Rules.xp_for_next(int(ch["level"]))], 7)
	var lines = [
		["STR", "str"], ["MAG", "mag"], ["MOB", "mob"], ["DEX", "dex"],
	]
	for i in lines.size():
		var y = 70 + i * 12
		text(Vector2(14, y), "%s %3d" % [lines[i][0], int(st[lines[i][1]])], 8)
		if int(ch["points"]) > 0:
			button(Rect2(68, y - 1, 12, 11), "+", {"kind": "raise", "stat": lines[i][1]})
	if int(ch["points"]) > 0:
		text(Vector2(14, 120), "%d points" % int(ch["points"]), 21)
	var y2 = 134
	for row in [["HP", "%d/%d" % [ch["hp"], st["hp_max"]]], ["Stamina", "%d/%d" % [ch["st"], st["st_max"]]],
			["Mana", "%d/%d" % [ch["mp"], st["mp_max"]]], ["Attack", "%d-%d" % [st["atk_l"], st["atk_h"]]],
			["Defence", "%d-%d" % [st["def_l"], st["def_h"]]], ["AP", str(g.Rules.ap(int(st["mob"])))],
			["Load", "%d (-%d st)" % [g.weight_of(ch) / 10, g.weight_defect(ch)]]]:
		text(Vector2(14, y2), row[0], 6)
		text(Vector2(70, y2), row[1], 8)
		y2 += 11
	var res = ""
	for k in ["r_fire", "r_water", "r_earth", "r_air", "r_mind"]:
		res += "%d " % int(st[k])
	text(Vector2(14, y2 + 2), "Resist F W E A M", 6)
	text(Vector2(14, y2 + 13), res, 8)
	var sk = ""
	for fam in ch["skill"]:
		sk += "%s %d " % [String(fam).substr(0, 5), int(ch["skill"][fam])]
	if sk != "":
		text(Vector2(14, 256), sk.substr(0, 40), 21)
	# paper doll
	m.hover_item = null
	for slot in EQUIP_LAYOUT:
		var p: Vector2 = EQUIP_LAYOUT[slot] + Vector2(0, 24)
		if slot == "quiver":
			var q = int(ch["quiver"])
			slot_box(p, {"id": "arrows", "amount": q} if q > 0 else null, {"kind": "equip", "slot": slot}, "arw")
		else:
			slot_box(p, ch["equip"].get(slot), {"kind": "equip", "slot": slot}, slot.substr(0, 3))
	# pack
	text(Vector2(282, 40), "Pack", 7)
	for i in 12:
		var p = Vector2(282 + (i % 4) * 36, 54 + (i / 4) * 36)
		slot_box(p, ch["pack"][i], {"kind": "pack", "i": i})
	text(Vector2(282, 166), "Right-click: use", 5)
	text(Vector2(282, 176), "Food  %dh" % (int(ch["food"]) / 360), 6)
	text(Vector2(282, 186), "Water %dh" % (int(ch["water"]) / 360), 6)
	var hi = m.hover_item
	if hi != null:
		var d: Dictionary = g.item_def(hi)
		var desc = g.item_name(hi)
		var mods: Dictionary = d.get("mods", {})
		var parts = []
		for k in mods:
			parts.append("%s%+d" % [k, int(mods[k])])
		var req: Dictionary = d.get("req", {})
		var reqs = []
		for k in req:
			reqs.append("%s %d" % [String(k).to_upper(), int(req[k])])
		draw_rect(Rect2(150, 206, 290, 58), c(1))
		text(Vector2(154, 210), desc, 30)
		text(Vector2(154, 222), (", ".join(parts)).substr(0, 46), 7)
		if not reqs.is_empty():
			text(Vector2(154, 234), "Needs " + ", ".join(reqs), 28 if g.meets_req(ch, hi) != "" else 21)
		text(Vector2(154, 246), "weight %d  value %d" % [int(d.get("weight", 0)), int(d.get("value", 0))], 5)
	button(Rect2(396, 10, 42, 14), "close", {"kind": "close"})
	# switch character
	for i in g.s["party"].size():
		button(Rect2(230 + i * 26, 10, 24, 14), str(i + 1), {"kind": "select", "i": i}, true)


# ------------------------------------------------------------------ casting

func draw_cast() -> void:
	var g = m.g
	var ci = int(m.sel)
	var ch: Dictionary = g.s["party"][ci]
	var mag = int(g.stats(ch)["mag"])
	panel(Rect2(4, 4, 440, 264), 2)
	reg(Rect2(4, 4, 440, 264), {"kind": "none"})
	text(Vector2(14, 12), "%s casts  (Magic %d, mana %d)" % [ch["name"], mag, ch["mp"]], 30)
	if String(m.cast_pending) != "":
		text(Vector2(14, 26), "Choose a target: click a portrait below.", 25)
	var runes: Array = g.s["runes"]
	var y = 42
	var spells: Dictionary = g.content["spells"]
	for r in spells["runes"]:
		if not r in runes:
			continue
		var rd: Dictionary = spells["runes"][r]
		icon("items/" + String(rd["icon"]), Vector2(12, y - 2), 0.75)
		text(Vector2(34, y + 4), String(rd["name"]), 8)
		for pw in 3:
			var id = "%s_%d" % [r, pw + 1]
			var sp: Dictionary = spells["spells"][id]
			var need = int(sp["need"])
			var col = 8
			var ok = true
			if mag < need / 2 or int(ch["mp"]) < int(sp["mana"]):
				col = 4
				ok = false
			elif mag < need:
				col = 29
			var rr = Rect2(92 + pw * 116, y - 2, 112, 26)
			var over = rr.has_point(mouse) and ok
			draw_rect(rr, c(4 if over else 1))
			text(rr.position + Vector2(4, 2), String(sp["name"]), col)
			text(rr.position + Vector2(4, 13), "%d mana  need %d" % [sp["mana"], need], 5 if not ok else 6)
			if ok:
				reg(rr, {"kind": "spell", "id": id})
		y += 32
	if runes.is_empty():
		text(Vector2(14, 60), "The party knows no runes yet.", 7)
	text(Vector2(14, 250), "White: safe. Orange: risky (may fizzle or backfire). Grey: out of reach.", 5)
	button(Rect2(396, 10, 42, 14), "close", {"kind": "close"})


# ------------------------------------------------------------------ book, dialogue, shop, menu

func draw_book() -> void:
	var g = m.g
	panel(Rect2(4, 4, 440, 264), 13)
	draw_rect(Rect2(222, 10, 2, 252), c(11))
	reg(Rect2(4, 4, 440, 264), {"kind": "book_next"})
	reg(Rect2(4, 4, 220, 264), {"kind": "book_prev"})
	var pages: Array = m.book_pages()
	var pi = int(m.book_page)
	for side in 2:
		var k = pi + side
		if k >= pages.size():
			continue
		var pg: Array = pages[k]
		var x = 14 + side * 218
		for i in pg.size():
			var ln: Array = pg[i]
			font.draw(self, Vector2(x, 14 + i * 11), String(ln[0]), c(int(ln[1])), 1, false)
		font.draw(self, Vector2(x + 90, 252), str(k + 1), c(11), 1, false)
	button(Rect2(396, 10, 42, 14), "close", {"kind": "close"})


func draw_dialog() -> void:
	var g = m.g
	if g.dialog.is_empty():
		return
	var d: Dictionary = g.content["dialogs"][g.dialog["id"]]
	panel(Rect2(4, 4, 440, 264), 1)
	reg(Rect2(4, 4, 440, 264), {"kind": "none"})
	var por = "portraits/" + String(d.get("portrait", ""))
	if FileAccess.file_exists("res://content/" + por + ".png"):
		icon(por, Vector2(14, 14))
	else:
		var key = "sprites/" + String(d.get("portrait", ""))
		var t: Texture2D = tex(key)
		if t:
			draw_texture_rect_region(t, Rect2(8, 10, 56, 56), Rect2(0, 0, 56, 56))
	text(Vector2(64, 14), String(d["name"]), 30, 2)
	var lines: PackedStringArray = font.wrap(g.dialog_text(), 364)
	for i in lines.size():
		text(Vector2(64, 36 + i * 11), lines[i], 8)
	var y = 44 + lines.size() * 11
	var n = 1
	for ch in g.dialog_choices():
		var r = Rect2(60, y, 376, 14)
		var over = r.has_point(mouse)
		draw_rect(r, c(4 if over else 2))
		text(r.position + Vector2(4, 3), "%d. %s" % [n, ch["text"]], 30 if over else 7)
		reg(r, {"kind": "choice", "i": ch["i"]})
		y += 16
		n += 1


func draw_shop() -> void:
	var g = m.g
	if g.shop.is_empty():
		return
	var sd: Dictionary = g.content["shops"][g.shop["id"]]
	panel(Rect2(4, 4, 440, 264), 2)
	reg(Rect2(4, 4, 440, 264), {"kind": "none"})
	text(Vector2(14, 12), String(sd["name"]), 30, 2)
	text(Vector2(250, 16), "Your coins: %d" % int(g.s["gold"]), 30)
	var stock: Array = g.s["shops"][g.shop["id"]]
	for i in stock.size():
		var e: Dictionary = stock[i]
		var r = Rect2(12, 36 + i * 26, 250, 24)
		var ok: bool = int(e["count"]) > 0 and g.s["held"] == null
		var over = r.has_point(mouse) and ok
		draw_rect(r, c(4 if over else 1))
		item_icon({"id": e["id"]}, r.position)
		var nm: String = g.content["items"][e["id"]]["name"]
		if g.content["items"][e["id"]].get("stack", false):
			nm += " x10"
		text(r.position + Vector2(30, 3), nm, 8 if ok else 5)
		text(r.position + Vector2(30, 13), "%d coins   (%d left)" % [g.shop_price(String(e["id"]), true), e["count"]], 30 if ok else 5)
		if ok:
			reg(r, {"kind": "buy", "i": i})
	var sell = Rect2(280, 60, 150, 90)
	draw_rect(sell, c(1))
	draw_rect(sell, c(12), false, 1.0)
	font.center(self, 355, 70, "SELL", c(30), 2, true)
	if g.s["held"] != null:
		var d: Dictionary = g.item_def(g.s["held"])
		var price: int = int(d.get("value", 0)) * int(g.s["held"].get("amount", 1)) * (100 - int(sd["factor"])) / 100
		font.center(self, 355, 100, g.item_name(g.s["held"]).substr(0, 22), c(8), 1, true)
		font.center(self, 355, 114, "offer: %d coins" % price, c(30), 1, true)
		font.center(self, 355, 130, "click here to sell", c(6), 1, true)
	else:
		font.center(self, 355, 100, "hold an item and", c(6), 1, true)
		font.center(self, 355, 112, "click here", c(6), 1, true)
	reg(sell, {"kind": "sell"})
	text(Vector2(280, 160), "Bought items go to", 5)
	text(Vector2(280, 170), "your hand: click a", 5)
	text(Vector2(280, 180), "portrait to stow them.", 5)
	button(Rect2(380, 246, 56, 16), "leave", {"kind": "close"})


func draw_menu() -> void:
	panel(Rect2(104, 16, 240, 240), 2)
	reg(Rect2(104, 16, 240, 240), {"kind": "none"})
	font.center(self, 224, 26, "GATES BELOW", c(30), 2, true)
	var sub = String(m.menu_sub)
	if sub == "":
		var items = [["Resume", "resume"], ["Save game", "save_menu"], ["Load game", "load_menu"],
			["Sound: " + ("on" if m.audio.sound_on else "off"), "sound"], ["Music: " + ("on" if m.audio.music_on else "off"), "music"],
			["Controls", "help"], ["Quit to title", "title"]]
		for i in items.size():
			button(Rect2(134, 56 + i * 26, 180, 20), items[i][0], {"kind": "menu", "id": items[i][1]})
	else:
		font.center(self, 224, 46, "Save to slot" if sub == "save" else "Load from slot", c(8), 1, true)
		for i in 10:
			var info: String = m.slot_label(i)
			var enabled = sub == "save" and i != 9 or info != "empty"
			button(Rect2(124, 60 + i * 18, 200, 16), "%d  %s" % [i, info], {"kind": "slot", "i": i}, enabled)
		button(Rect2(184, 242, 80, 12), "back", {"kind": "menu", "id": "back"})


func draw_help() -> void:
	panel(Rect2(4, 4, 440, 264), 2)
	reg(Rect2(4, 4, 440, 264), {"kind": "close"})
	var lines = [
		["CONTROLS", 30],
		["W / Up        step forward     S / Down   step back", 8],
		["A, D          strafe           Q, E / Left, Right   turn", 8],
		["Space         use the wall ahead: lever, door, niche, fountain", 8],
		["Mouse         click walls, floor items and people in the view", 8],
		["              click a portrait with an item in hand to stow it", 8],
		["I / 1-6       inventory        C  cast (rune magic)", 8],
		["M / Tab       map              B  book       R  rest", 8],
		["F5 / F9       quick save / quick load      Esc  menu", 8],
		["", 8],
		["IN BATTLE", 30],
		["Each character plans an action; then everyone acts in a", 7],
		["random order. A attack, C cast, G guard (rest a little),", 7],
		["T throw the item in hand. Enter: all attack. A movement", 7],
		["key moves the whole party instead. Face your enemy:", 7],
		["attacks only reach the square straight ahead.", 7],
		["", 8],
		["Picking up a rune teaches it to the whole party.", 21],
	]
	for i in lines.size():
		text(Vector2(16, 14 + i * 13), String(lines[i][0]), int(lines[i][1]))


func draw_end(won: bool) -> void:
	var g = m.g
	draw_rect(Rect2(0, 0, 640, 360), c(0, 0.75))
	panel(Rect2(80, 50, 480, 250), 1)
	reg(Rect2(0, 0, 640, 360), {"kind": "none"})
	if won:
		font.center(self, 320, 66, "THE GATE IS SHUT", c(30), 3, true)
		var lines: PackedStringArray = font.wrap(String(g.content["book"]["ending"]["text"]), 440)
		for i in lines.size():
			font.center(self, 320, 110 + i * 12, lines[i], c(8), 1, true)
		font.center(self, 320, 200, "Thank you for playing Gates Below.", c(21), 1, true)
		button(Rect2(260, 260, 120, 20), "Title screen", {"kind": "menu", "id": "title"})
	else:
		font.center(self, 320, 80, "THE PARTY HAS FALLEN", c(28), 3, true)
		font.center(self, 320, 130, "The dark of the Underkeep closes over them.", c(7), 1, true)
		button(Rect2(210, 200, 220, 20), "Load the autosave", {"kind": "slot_load", "i": 9}, m.slot_label(9) != "empty")
		button(Rect2(210, 230, 220, 20), "Title screen", {"kind": "menu", "id": "title"})


func draw_title() -> void:
	draw_rect(Rect2(0, 0, 640, 360), c(0, 0.35))
	font.center(self, 320, 40, "GATES BELOW", c(30), 5, true)
	font.center(self, 320, 92, "a dungeon crawl on the mechanics of Gates of Skeldal", c(7), 1, true)
	var items = [["New game", "new"], ["Create party", "create"], ["Continue", "continue"], ["Load game", "load_menu"], ["Controls", "help"], ["Quit", "quit"]]
	for i in items.size():
		var enabled: bool = items[i][1] != "continue" or m.latest_slot() >= 0
		button(Rect2(250, 128 + i * 24, 140, 20), items[i][0], {"kind": "title", "id": items[i][1]}, enabled)
	font.center(self, 320, 340, "original art, words and music; Godot 4.7, Blender, Aseprite", c(4), 1, true)
	if String(m.overlay) == "menu":
		draw_menu()
	elif String(m.overlay) == "help":
		draw_help()


# ------------------------------------------------------------------ character creation

func draw_create() -> void:
	var cr: Dictionary = m.create
	if cr.is_empty():
		return
	draw_rect(Rect2(0, 0, 640, 360), c(0, 0.72))
	panel(Rect2(4, 4, 632, 352), 1)
	reg(Rect2(4, 4, 632, 352), {"kind": "none"})
	font.center(self, 320, 10, "CREATE YOUR PARTY", c(30), 2, true)
	var slots: Array = cr["slots"]
	var cur: int = int(cr["cur"])
	# party slots
	for i in 6:
		var r: Rect2 = Rect2(12 + i * 104, 32, 100, 58)
		if i < slots.size():
			var sl: Dictionary = slots[i]
			draw_rect(r, c(3 if i == cur else 2))
			draw_rect(r, c(30 if i == cur else (21 if sl["ready"] else 4)), false, 1.0)
			draw_texture_rect(tex("portraits/" + String(sl["portrait"])), Rect2(r.position + Vector2(4, 4), Vector2(40, 48)), false)
			text(r.position + Vector2(48, 6), String(sl["name"]).substr(0, 8), 8)
			text(r.position + Vector2(48, 20), "ready" if sl["ready"] else ("rolled" if sl["stats"] != null else "..."), 21 if sl["ready"] else 6)
			if sl["stats"] != null:
				var ss: Dictionary = sl["stats"]
				text(r.position + Vector2(48, 34), "S%d M%d" % [ss["str"], ss["mag"]], 5)
				text(r.position + Vector2(48, 44), "B%d D%d" % [ss["mob"], ss["dex"]], 5)
			reg(r, {"kind": "c_slot", "i": i})
		elif i == slots.size():
			var over: bool = r.has_point(mouse)
			draw_rect(r, c(3 if over else 2))
			draw_rect(r, c(4), false, 1.0)
			font.center(self, r.position.x + 50, r.position.y + 14, "+", c(30), 2, true)
			font.center(self, r.position.x + 50, r.position.y + 38, "add", c(6), 1, false)
			reg(r, {"kind": "c_add"})
		else:
			draw_rect(r, c(1))
	var s: Dictionary = slots[cur]
	# the disc and its pearl
	var ctr: Vector2 = m.DISC_CENTER
	icon("ui/disc", ctr - Vector2(85, 85))
	var pr: Vector2 = Vector2(cos(deg_to_rad(float(s["angle"]))), -sin(deg_to_rad(float(s["angle"])))) * float(s["radius"])
	icon("ui/pearl", ctr + pr - Vector2(5, 5))
	for k in 8:
		var a: float = deg_to_rad(k * 45.0)
		var lp: Vector2 = ctr + Vector2(cos(a), -sin(a)) * 97.0
		var near: bool = int(round(float(s["angle"]) / 45.0)) % 8 == k and int(s["radius"]) >= 20
		font.center(self, lp.x, lp.y - 4, m.CALLINGS[k], c(30 if near else 6), 1, true)
	reg(Rect2(ctr - Vector2(84, 84), Vector2(168, 168)), {"kind": "c_disc"})
	# right column: name, faces, ranges, roll
	var x0: float = 262.0
	text(Vector2(x0, 100), "Name", 6)
	var nr: Rect2 = Rect2(x0 + 34, 97, 120, 14)
	draw_rect(nr, c(0))
	draw_rect(nr, c(12), false, 1.0)
	var blink: String = "_" if int(Time.get_ticks_msec() / 400) % 2 == 0 else ""
	text(nr.position + Vector2(4, 3), String(s["name"]) + blink, 31)
	text(Vector2(x0 + 164, 100), m.calling_of(s), 30)
	for i in m.FACES.size():
		var face: String = m.FACES[i][0]
		var fr: Rect2 = Rect2(x0 + i * 38, 116, 32, 38)
		var used: bool = m.face_used(face, cur)
		draw_texture_rect_region(tex("portraits/" + face), fr, Rect2(4, 2, 32, 38), Color(1, 1, 1, 0.3) if used else Color.WHITE)
		if face == String(s["portrait"]):
			draw_rect(fr, c(30), false, 1.0)
		elif fr.has_point(mouse) and not used:
			draw_rect(fr, c(7), false, 1.0)
		if not used:
			reg(fr, {"kind": "c_face", "face": face})
	var ranges: Dictionary = m.Rules.disc_ranges(int(s["angle"]), int(s["radius"]))
	var labels: Array = [["STR", "str", 28], ["MAG", "mag", 24], ["MOB", "mob", 30], ["DEX", "dex", 20]]
	for i in 4:
		var y: float = 164.0 + i * 14
		var k2: String = labels[i][1]
		var rg: Array = ranges[k2]
		text(Vector2(x0, y), labels[i][0], 7)
		var bar: Rect2 = Rect2(x0 + 30, y + 1, 150, 8)
		draw_rect(bar, c(0))
		draw_rect(Rect2(bar.position.x + int(rg[0]) * 5, bar.position.y, (int(rg[1]) - int(rg[0]) + 1) * 5, 8), c(int(labels[i][2]), 0.55))
		text(Vector2(x0 + 186, y), "%2d-%2d" % [rg[0], rg[1]], 6)
		if s["stats"] != null:
			var v: int = int(s["stats"][k2])
			draw_rect(Rect2(bar.position.x + v * 5, bar.position.y - 1, 5, 10), c(int(labels[i][2])))
			text(Vector2(x0 + 224, y), "= %d" % v, 31)
	var st = s["stats"]
	if st == null:
		var lo: Array = [int(ranges["str"][0]), int(ranges["mag"][0]), int(ranges["mob"][0]), int(ranges["dex"][0])]
		var hi: Array = [int(ranges["str"][1]), int(ranges["mag"][1]), int(ranges["mob"][1]), int(ranges["dex"][1])]
		text(Vector2(x0, 224), "HP %d-%d  Mana %d-%d  Stamina %d-%d" % [(3 * lo[0] + lo[2]) / 2, (3 * hi[0] + hi[2]) / 2, 2 * lo[1], 2 * hi[1], 2 * lo[3], 2 * hi[3]], 6)
		text(Vector2(x0, 238), "Roll to see this character's stats and kit.", 5)
	else:
		text(Vector2(x0, 224), "HP %d   Mana %d   Stamina %d   AP %d" % [(3 * int(st["str"]) + int(st["mob"])) / 2, 2 * int(st["mag"]), 2 * int(st["dex"]), m.Rules.ap(int(st["mob"]))], 8)
		var kit: Array = []
		for it in m.g.starting_kit(st):
			if it[0] == "quiver":
				kit.append("%d arrows" % int(it[1]))
			else:
				kit.append(String(m.content["items"][it[1]]["name"]))
		var lines: PackedStringArray = font.wrap("Kit: " + ", ".join(kit), 360)
		for i in mini(lines.size(), 2):
			text(Vector2(x0, 238 + i * 10), lines[i], 7)
	button(Rect2(x0, 264, 80, 18), "Roll" if st == null else "Reroll", {"kind": "c_roll"})
	button(Rect2(x0 + 88, 264, 80, 18), "Accept", {"kind": "c_accept"}, st != null and not s["ready"] and String(s["name"]).strip_edges() != "")
	button(Rect2(x0 + 176, 264, 80, 18), "Remove", {"kind": "c_remove"}, slots.size() > 1)
	var tips: PackedStringArray = font.wrap("Drag the pearl: its direction picks the calling, its distance from the centre how strongly. Moving it clears the roll. Type to rename.", 360)
	for i in tips.size():
		text(Vector2(x0, 292 + i * 10), tips[i], 5)
	button(Rect2(12, 330, 80, 18), "Back", {"kind": "c_back"})
	button(Rect2(470, 330, 156, 18), "Begin the descent", {"kind": "c_begin"}, m.party_ready())
	if not m.party_ready():
		font.center(self, 300, 335, "accept every character to begin", c(5), 1, false)


func draw_cursor() -> void:
	var g = m.g
	if g != null and m.screen == "game" and g.s["held"] != null:
		item_icon(g.s["held"], mouse - Vector2(12, 12))
	else:
		icon("ui/cursor", mouse)
