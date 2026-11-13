extends Node2D
## Draws every screen from the app's state. Nothing here changes the game.

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")
const Game = preload("res://scripts/core/game.gd")

const INK := Color("18142c")
const PANEL := Color(0.07, 0.06, 0.16, 0.88)
const GOLD := Color("f8c438")
const PINK := Color("ff5fb4")
const CYAN := Color("5fe8ff")
const WHITE := Color.WHITE
const CAST_ORDER := ["rin", "mako", "jiro", "aya", "pochi", "goro", "yuki", "zeno", "onyx"]

var m: Node
var tex := {}
var eye_y := {}

func _ready() -> void:
	m = get_parent()
	for n in ["font", "font_big", "font_ital", "cards", "icons", "portraits", "bg_table", "bg_boss",
			"bg_title", "chip_spin", "chips", "star_spin", "trophy", "coin_burst"]:
		var p := "res://assets/art/%s.png" % n
		if ResourceLoader.exists(p):
			tex[n] = load(p)
	var f := FileAccess.open("res://assets/art/portraits.json", FileAccess.READ)
	if f:
		var j = JSON.parse_string(f.get_as_text())
		if j is Dictionary and j.has("eye_y"):
			eye_y = j["eye_y"]

# ---- primitives ---------------------------------------------------------------

func text_w(t: String, f: String = "s") -> int:
	return t.length() * (6 if f == "s" else 12)

## Draw text. With box > 0 the text is aligned inside [x, x + box] (0 left, 1 centre,
## 2 right) and a line wider than its box is reported to the `fit` harness check.
func txt(t: String, x: float, y: float, col: Color = WHITE, f: String = "s", box: int = 0, align: int = 0) -> void:
	var name := "font" if f == "s" else ("font_big" if f == "b" else "font_ital")
	if not tex.has(name):
		return
	var adv := 6 if f == "s" else 12
	var cw := 6 if f == "s" else (12 if f == "b" else 16)
	var ch := 9 if f == "s" else 18
	var w := t.length() * adv
	if box > 0:
		if w > box:
			m.fit_fail.append("%s|%s" % [m.screen, t])
		if align == 1:
			x += (box - w) / 2
		elif align == 2:
			x += box - w
	x = floorf(x)
	y = floorf(y)
	for i in t.length():
		var c := t.unicode_at(i) - 32
		if c <= 0 or c > 94:
			continue
		draw_texture_rect_region(tex[name], Rect2(x + i * adv, y, cw, ch),
			Rect2((c % 16) * cw, (c / 16) * ch, cw, ch), col)

func shadow(t: String, x: float, y: float, col: Color, f: String = "s", box: int = 0, align: int = 0) -> void:
	var d := 1 if f == "s" else 2
	txt(t, x + d, y + d, INK, f, box, align)
	var before: int = m.fit_fail.size()
	txt(t, x, y, col, f, box, align)
	m.fit_fail.resize(before)

func panel(r: Rect2, fill: Color = PANEL, border: Color = CYAN) -> void:
	draw_rect(r, fill)
	draw_rect(r, border, false, 1.0)

func wrap_text(t: String, chars: int) -> Array:
	var lines := []
	var cur := ""
	for word in t.split(" "):
		if cur == "":
			cur = word
		elif cur.length() + 1 + word.length() <= chars:
			cur += " " + word
		else:
			lines.append(cur)
			cur = word
	if cur != "":
		lines.append(cur)
	return lines

func card(c: int, x: float, y: float, up: bool = true, tint: Color = WHITE) -> void:
	if not tex.has("cards"):
		return
	var idx := c if up else 52
	draw_texture_rect_region(tex["cards"], Rect2(x, y, 40, 56), Rect2((idx % 13) * 40, (idx / 13) * 56, 40, 56), tint)

func icon(name: String, x: float, y: float, tint: Color = WHITE) -> void:
	var names := ["hawk", "swap", "guard", "over", "sight", "glare", "empty", "star", "dealer"]
	var i := names.find(name)
	if i >= 0 and tex.has("icons"):
		draw_texture_rect_region(tex["icons"], Rect2(x, y, 32, 32), Rect2(i * 32, 0, 32, 32), tint)

func portrait(id: String, expr: String, x: float, y: float, framed: bool = true) -> void:
	if framed:
		draw_rect(Rect2(x - 2, y - 2, 100, 100), Color(0.05, 0.04, 0.12, 0.75))
		draw_rect(Rect2(x - 2, y - 2, 100, 100), GOLD if id == "onyx" else CYAN, false, 1.0)
	if not tex.has("portraits"):
		txt(id.to_upper(), x + 4, y + 40)
		return
	var row := CAST_ORDER.find(id)
	var col := maxi(Data.EXPR.find(expr), 0)
	draw_texture_rect_region(tex["portraits"], Rect2(x, y, 96, 96), Rect2(col * 96, row * 96, 96, 96))

func strip(name: String, frame: int, size: int, x: float, y: float) -> void:
	if tex.has(name):
		draw_texture_rect_region(tex[name], Rect2(x, y, size, size), Rect2(frame * size, 0, size, size))

func menu(items: Array) -> void:
	for i in items.size():
		var r: Rect2 = m.menu_rect(i)
		var on: bool = i == m.cursor
		panel(r, Color(0.5, 0.1, 0.4, 0.95) if on else PANEL, GOLD if on else CYAN)
		txt(items[i], r.position.x, r.position.y + (r.size.y - 9) / 2, GOLD if on else WHITE, "s", int(r.size.x), 1)

func speed_lines(r: Rect2, col: Color, seed_value: int) -> void:
	var box := {"k": seed_value}
	for i in 28:
		var y := r.position.y + Cards.roll(box, "k", int(r.size.y))
		var x := r.position.x + Cards.roll(box, "k", int(r.size.x))
		var w := 30 + Cards.roll(box, "k", 120)
		draw_line(Vector2(x, y), Vector2(x + w, y), col, 1.0)

# ---- screens ------------------------------------------------------------------

func _draw() -> void:
	m.fit_fail = []
	match m.screen:
		"title":
			_title()
		"avatar":
			_avatar()
		"story":
			_story()
		"versus":
			_story()
		"play":
			_play()
		"pause":
			_play()
			draw_rect(Rect2(0, 0, 640, 360), Color(0, 0, 0, 0.6))
			shadow("PAUSED", 0, 90, GOLD, "i", 640, 1)
			menu(m.menu_items())
		"options":
			_backdrop()
			shadow("OPTIONS", 0, 80, GOLD, "i", 640, 1)
			menu(m.menu_items())
			txt("LEFT / RIGHT CHANGES A VALUE", 0, 250, CYAN, "s", 640, 1)
		"matchend":
			_matchend()
		"scores":
			_scores()
		"credits":
			_credits()

func _backdrop() -> void:
	if tex.has("bg_title"):
		draw_texture(tex["bg_title"], Vector2.ZERO)
	else:
		draw_rect(Rect2(0, 0, 640, 360), Color("140c2c"))
	draw_rect(Rect2(0, 0, 640, 360), Color(0, 0, 0, 0.35))

func _logo(y: float) -> void:
	var t := "HYPER BLUFF!!"
	draw_set_transform(Vector2(0, y), 0.0, Vector2(3, 3))
	var x := (640.0 / 3.0 - t.length() * 12) / 2
	var bob := sin(m.tick * 0.08) * 1.0
	txt(t, x + 1.4, 1.4 + bob, INK, "i")
	txt(t, x + 0.7, 0.7 + bob, PINK, "i")
	txt(t, x, bob, GOLD, "i")
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	shadow("STARLIGHT SHOWDOWN", 0, y + 62, CYAN, "b", 640, 1)

func _title() -> void:
	if tex.has("bg_title"):
		draw_texture(tex["bg_title"], Vector2.ZERO)
	else:
		draw_rect(Rect2(0, 0, 640, 360), Color("140c2c"))
	speed_lines(Rect2(0, 20, 640, 150), Color(1, 1, 1, 0.12), m.tick / 4)
	_logo(60)
	menu(m.menu_items())
	txt("ARROWS + Z / ENTER, OR THE MOUSE", 0, 346, Color(1, 1, 1, 0.7), "s", 640, 1)

func _avatar() -> void:
	_backdrop()
	shadow("CHOOSE YOUR PLAYER", 0, 40, GOLD, "i", 640, 1)
	for i in 4:
		var id: String = Data.AVATARS[i]
		var x := 68 + i * 136
		var on: bool = i == m.cursor
		portrait(id, "fierce" if on else "neutral", x, 106 - (4 if on else 0))
		if on:
			draw_rect(Rect2(x - 4, 96, 104, 108), GOLD, false, 2.0)
	var id2: String = Data.AVATARS[m.cursor]
	var c: Dictionary = Data.CAST[id2]
	panel(Rect2(120, 226, 400, 70))
	shadow(c["name"], 120, 232, GOLD, "b", 400, 1)
	txt(c["title"].to_upper(), 120, 254, CYAN, "s", 400, 1)
	txt(c["blurb"], 120, 270, WHITE, "s", 400, 1)
	txt("LEFT / RIGHT TO CHOOSE, Z TO START, X TO GO BACK", 0, 330, Color(1, 1, 1, 0.7), "s", 640, 1)

func _story() -> void:
	var who: String = m.speaker
	if who == "":
		_backdrop()
	else:
		var boss: bool = who == "onyx"
		if tex.has("bg_boss" if boss else "bg_table"):
			draw_texture(tex["bg_boss" if boss else "bg_table"], Vector2.ZERO)
		draw_rect(Rect2(0, 0, 640, 360), Color(0, 0, 0, 0.45))
		speed_lines(Rect2(0, 40, 640, 150), Color(1, 1, 1, 0.1), m.tick / 5)
		shadow("FLOOR %d" % (m.s["match"] + 1), 0, 20, CYAN, "b", 640, 1)
		portrait(m.s["avatar"], "fierce", 150, 70)
		shadow("VS", 0, 108, PINK, "i", 640, 1)
		portrait(who, m.rexpr if m.page_after == "next" else "neutral", 394, 70)
		shadow(Data.CAST[m.s["avatar"]]["name"], 98, 176, WHITE, "s", 200, 1)
		shadow(Data.CAST[who]["name"], 342, 176, GOLD, "s", 200, 1)
		txt(Data.CAST[who]["title"].to_upper(), 342, 188, CYAN, "s", 200, 1)
	panel(Rect2(60, 214, 520, 100))
	if m.page < m.pages.size():
		var full: String = m.pages[m.page]
		var shown := full.substr(0, m.page_t * 2)
		var lines := wrap_text(full, 80)
		var left := shown.length()
		for i in lines.size():
			var line: String = lines[i]
			var part := line.substr(0, clampi(left, 0, line.length()))
			left -= line.length() + 1
			if who != "":
				txt(part, 76, 230 + i * 14, WHITE)
			var before: int = m.fit_fail.size()
			if who == "":
				txt(part, 76, 230 + i * 14, WHITE)
			m.fit_fail.resize(before)
			if line.length() * 6 > 488:
				m.fit_fail.append("story|" + line)
		if lines.size() > 5:
			m.fit_fail.append("story lines|" + full)
	if (m.tick / 20) % 2 == 0:
		txt("Z / CLICK", 510, 300, GOLD)

func _matchend() -> void:
	var s: Dictionary = m.s
	var won: bool = s["winner"] == 0
	if tex.has("bg_boss" if s["rival"] == "onyx" else "bg_table"):
		draw_texture(tex["bg_boss" if s["rival"] == "onyx" else "bg_table"], Vector2.ZERO)
	draw_rect(Rect2(0, 0, 640, 360), Color(0, 0, 0, 0.55))
	shadow("FLOOR CLEARED!!" if won else "BUSTED...", 0, 30, GOLD if won else PINK, "i", 640, 1)
	portrait(s["avatar"], "happy" if won else "defeat", 150, 70)
	portrait(s["rival"], "defeat" if won else "happy", 394, 70)
	if won and tex.has("trophy"):
		draw_texture(tex["trophy"], Vector2(288, 86))
	panel(Rect2(170, 184, 300, 56))
	txt("SCORE", 186, 192, CYAN)
	txt(str(s["score"]), 170, 190, GOLD, "b", 288, 2)
	if won:
		txt("FLOOR BONUS  +%d" % s["result"]["match_bonus"], 170, 216, WHITE, "s", 300, 1)
		if (m.tick / 20) % 2 == 0:
			txt("Z / CLICK TO GO ON", 0, 260, GOLD, "s", 640, 1)
	else:
		var lines := wrap_text(Data.CAST[s["rival"]]["gloat"][0], 46)
		for i in lines.size():
			txt(lines[i], 170, 212 + i * 11, WHITE, "s", 300, 1)
		menu(m.menu_items())

func _scores() -> void:
	_backdrop()
	shadow("HIGH SCORES", 0, 40, GOLD, "i", 640, 1)
	panel(Rect2(140, 84, 360, 200))
	if m.scores.is_empty():
		txt("NO SCORES YET. THE TOWER AWAITS.", 140, 170, WHITE, "s", 360, 1)
	for i in m.scores.size():
		var e: Dictionary = m.scores[i]
		var y: float = 98 + i * 36
		var col := GOLD if i == m.last_rank else WHITE
		txt("%d." % (i + 1), 154, y + 4, col, "b")
		txt(Data.CAST[e["avatar"]]["name"], 190, y, col, "s", 170)
		txt("CHAMPION" if e["clear"] else "FLOOR %d" % e["floor"], 190, y + 12, CYAN, "s", 170)
		txt(str(e["score"]), 360, y + 4, col, "b", 128, 2)
	if (m.tick / 20) % 2 == 0:
		txt("Z / CLICK TO RETURN", 0, 310, GOLD, "s", 640, 1)

func _credits() -> void:
	_backdrop()
	draw_rect(Rect2(0, 0, 640, 360), Color(0, 0, 0, 0.3))
	for i in Data.CREDITS.size():
		var y: float = 360 - m.credits_y + i * 16
		if y < -20 or y > 370:
			continue
		var line: String = Data.CREDITS[i]
		if i < 2:
			shadow(line, 0, y, GOLD, "b", 640, 1)
		else:
			txt(line, 0, y, WHITE if i % 3 != 0 else CYAN, "s", 640, 1)
	if tex.has("trophy"):
		draw_texture(tex["trophy"], Vector2(40, 280))

func _play() -> void:
	var s: Dictionary = m.s
	if s.is_empty():
		return
	var boss: bool = s["rival"] == "onyx"
	var off := Vector2.ZERO
	if m.shake > 0:
		off = Vector2((m.tick * 7) % 5 - 2, (m.tick * 13) % 5 - 2)
	draw_set_transform(off, 0.0, Vector2.ONE)
	if tex.has("bg_boss" if boss else "bg_table"):
		draw_texture(tex["bg_boss" if boss else "bg_table"], Vector2.ZERO)
	else:
		draw_rect(Rect2(0, 0, 640, 360), Color("0c3a2c"))
	if s["fever"]:
		var hue := fmod(m.tick * 0.02, 1.0)
		for i in 3:
			draw_rect(Rect2(i, i, 640 - i * 2, 360 - i * 2), Color.from_hsv(fmod(hue + i * 0.1, 1.0), 0.8, 1.0), false, 1.0)
		speed_lines(Rect2(0, 0, 640, 360), Color(1, 1, 1, 0.08), m.tick / 3)

	# top row: mission, rival, score
	var mission: Dictionary = s["mission"]
	panel(Rect2(6, 4, 256, 14), PANEL, GOLD)
	if not mission.is_empty():
		txt("BONUS " + mission["text"], 10, 7, GOLD, "s", 250)
	if s["fever"]:
		shadow("FEVER x3", 10, 22, Color.from_hsv(fmod(m.tick * 0.03, 1.0), 0.6, 1.0), "b")
	portrait(s["rival"], m.rexpr, 272, 14)
	var rc: Dictionary = Data.CAST[s["rival"]]
	panel(Rect2(376, 12, 150, 30))
	txt(rc["name"], 380, 16, GOLD, "s", 142)
	txt("CHIPS %d" % s["stack"][1], 380, 28, WHITE, "s", 90)
	for i in s["powers"][1].size():
		draw_rect(Rect2(480 + i * 10, 29, 7, 7), PINK)
	panel(Rect2(532, 20, 104, 44))
	txt("SCORE", 536, 24, CYAN)
	txt(str(s["score"]), 536, 34, GOLD, "s", 96, 2)
	txt("HAND %d" % s["hand_no"], 536, 44, WHITE, "s", 96)
	if s.has("blind"):
		txt("BLINDS %d/%d" % [s["blind"][0], s["blind"][1]], 536, 54, WHITE, "s", 96)
	panel(Rect2(604, 4, 32, 14), PANEL, GOLD if m.hover == "pause" else CYAN)
	txt("MENU", 604, 7, WHITE, "s", 32, 1)
	if m.bubble_t > 0 and m.bubble != "":
		var bl := wrap_text(m.bubble, 38)
		panel(Rect2(22, 40, 240, 8 + bl.size() * 11), Color(1, 1, 1, 0.95), INK)
		for i in bl.size():
			txt(bl[i], 28, 45 + i * 11, INK, "s", 230)

	# rival hole cards
	var seen: Array = s["fx"]["peek"][0]
	for i in 2:
		if s["hole"][1].size() < 2 or m.deal_t > 10 + i * 6:
			continue
		var up: bool = m.reveal or seen.has(i)
		card(s["hole"][1][i], 380 + i * 44, 46, up)
		if up and not m.reveal:
			txt("SEEN", 380 + i * 44, 104, CYAN, "s", 40, 1)

	# board
	for i in 5:
		draw_rect(Rect2(208 + i * 46, 128, 40, 56), Color(0, 0, 0, 0.18))
	for i in s["board"].size():
		card(s["board"][i], 208 + i * 46, 128)
		if s["stars"].has(i):
			strip("star_spin", (m.tick / 6) % 8, 24, 208 + i * 46 + 22, 120)
			if not tex.has("star_spin"):
				icon("star", 208 + i * 46 + 16, 116)
	var kb := Game.known_board(s, 0)
	if kb.size() > s["board"].size():
		var i2: int = s["board"].size()
		card(kb[i2], 208 + i2 * 46, 128, true, Color(1, 1, 1, 0.55))
		txt("SIGHT", 208 + i2 * 46, 186, CYAN, "s", 40, 1)
	panel(Rect2(444, 128, 88, 56))
	txt("POT", 448, 132, CYAN)
	var pot_now: int = s["result"]["pot"] if s["phase"] in ["hand_over", "match_over"] and s["result"].has("pot") else Game.pot(s)
	txt(str(pot_now), 476, 142, GOLD, "b", 52, 2)
	strip("chip_spin", (m.tick / 5) % 8, 24, 448, 139)
	txt("STARS +%d" % s["star_pot"], 448, 164, GOLD if s["star_pot"] > 0 else Color(1, 1, 1, 0.4), "s", 80)
	if s["bet"][1] > 0:
		strip("chips", 1, 20, 186, 106)
		shadow("BET %d" % s["bet"][1], 208, 112, WHITE)
	if s["bet"][0] > 0:
		strip("chips", 2, 20, 186, 186)
		shadow("BET %d" % s["bet"][0], 208, 192, WHITE)
	if m.burst_t > 0:
		strip("coin_burst", clampi((36 - m.burst_t) / 6, 0, 5), 32, 472, 136)
	if s["phase"] != "pre":
		icon("dealer", 232 if s["button"] == 0 else 232, 216 if s["button"] == 0 else 78)

	# player side
	portrait(s["avatar"], m.pexpr, 10, 196)
	txt(Data.CAST[s["avatar"]]["name"], 8, 298, WHITE, "s", 100, 1)
	txt("CHIPS %d" % s["stack"][0], 8, 309, GOLD, "s", 100, 1)
	for i in s["hole"][0].size():
		if m.deal_t > i * 6:
			continue
		card(s["hole"][0][i], 276 + i * 46, 206)
	_meter(376, 204)
	for i in 3:
		var x := 532 + i * 35
		var inv: Array = s["powers"][0]
		if i < inv.size():
			var usable: bool = m.my_turn() and Game.can_use(s, 0, inv[i])
			icon(inv[i], x, 204, WHITE if usable else Color(0.55, 0.55, 0.6))
			if m.hover == "power:%d" % i:
				draw_rect(Rect2(x - 1, 203, 34, 34), GOLD, false, 1.0)
		else:
			icon("empty", x, 204)
		txt(str(i + 1), x, 238, CYAN, "s", 32, 1)
	var hp := -1
	if m.hover.begins_with("power:"):
		hp = int(m.hover.substr(6))
	if hp >= 0 and hp < s["powers"][0].size():
		var pw: Dictionary = Data.POWERS[s["powers"][0][hp]]
		panel(Rect2(376, 262, 258, 26))
		txt(pw["name"], 380, 265, GOLD, "s", 250)
		txt(pw["desc"], 380, 276, WHITE, "s", 250)
	else:
		txt("POINT AT A POWER FOR ITS EFFECT", 376, 268, Color(1, 1, 1, 0.6), "s", 258, 2)

	shadow(m.msg, 112, 304, WHITE, "s", 450, 1)
	_buttons()
	for p in m.pops:
		shadow(p["text"], p["x"], p["y"], p["col"], "b")
	if s["phase"] in ["hand_over", "match_over"] and m.wait == 0:
		_result()
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if not m.cutin.is_empty():
		_cutin()

func _meter(x: float, y: float) -> void:
	var s: Dictionary = m.s
	panel(Rect2(x, y, 150, 54))
	txt("AURA METER", x + 4, y + 4, CYAN)
	if s["hole"][0].is_empty():
		return
	var v: float = clampf(m.meter_show, 0.0, 1.0)
	txt("%d%%" % int(round(v * 100)), x + 4, y + 4, WHITE, "s", 142, 2)
	draw_rect(Rect2(x + 4, y + 16, 142, 10), Color(0, 0, 0, 0.6))
	var w := int(142 * v)
	for i in range(0, w, 2):
		var k := float(i) / 142.0
		draw_rect(Rect2(x + 4 + i, y + 16, 2, 10), Color.from_hsv(lerpf(0.0, 0.38, k), 0.85, 1.0))
	if v >= 0.7:
		var fl: int = 3 + (m.tick / 3) % 4
		draw_rect(Rect2(x + 4 + w - 2, y + 16 - fl, 3, fl), GOLD)
		draw_rect(Rect2(x + 4 + w - 6, y + 16 - fl / 2, 2, fl / 2), PINK)
	draw_rect(Rect2(x + 4, y + 16, 142, 10), WHITE, false, 1.0)
	var tier: String = m.meter_tier()
	txt(tier, x + 4, y + 30, GOLD if v >= 0.7 else WHITE, "s", 142)
	var made := Cards.name_of(Cards.eval(s["hole"][0] + s["board"]))
	txt(made, x + 4, y + 41, CYAN, "s", 144)

func _buttons() -> void:
	var s: Dictionary = m.s
	var live: bool = m.my_turn()
	var need := Game.to_call(s, 0) if s["phase"] == "bet" else 0
	var ro: Array = m.raise_opts()
	var labels := ["FOLD", "CHECK" if need == 0 else "CALL %d" % need, "RAISE"]
	if ro.size() > 0:
		var amt: int = ro[clampi(m.raise_i, 0, ro.size() - 1)]
		if amt == ro[-1]:
			labels[2] = "ALL-IN %d" % amt
		elif maxi(s["bet"][0], s["bet"][1]) == 0:
			labels[2] = "BET %d" % amt
		else:
			labels[2] = "RAISE TO %d" % amt
	elif live:
		labels[2] = "NO RAISE"
	var rects := [Rect2(112, 322, 100, 30), Rect2(218, 322, 130, 30), Rect2(354, 322, 150, 30)]
	for i in 3:
		var on: bool = live and i == m.btn
		var fill := Color(0.5, 0.1, 0.4, 0.95) if on else PANEL
		if not live:
			fill = Color(0.1, 0.1, 0.14, 0.7)
		panel(rects[i], fill, GOLD if on else (CYAN if live else Color(0.4, 0.4, 0.5)))
		txt(labels[i], rects[i].position.x, 328, WHITE if live else Color(0.6, 0.6, 0.65), "s", int(rects[i].size.x), 1)
		txt(["F", "C", "R"][i], rects[i].position.x, 340, CYAN if live else Color(0.4, 0.4, 0.5), "s", int(rects[i].size.x), 1)
	for i in 2:
		var r := Rect2(510 + i * 28, 322, 24, 30)
		panel(r, PANEL, CYAN if live and ro.size() > 1 else Color(0.4, 0.4, 0.5))
		txt("-" if i == 0 else "+", r.position.x, 333, WHITE, "s", 24, 1)

func _result() -> void:
	var s: Dictionary = m.s
	var res: Dictionary = s["result"]
	var w: int = res["winner"]
	panel(Rect2(4, 190, 266, 166), Color(0.05, 0.04, 0.14, 0.96), GOLD)
	var head := "SPLIT POT"
	if w == 0:
		head = "YOU WIN!!"
	elif w == 1:
		head = "RIVAL WINS"
	shadow(head, 4, 196, GOLD if w == 0 else (PINK if w == 1 else WHITE), "i", 262, 1)
	var y := 218
	if res["showdown"]:
		txt("YOU: " + Cards.name_of(res["vals"][0]), 12, y, WHITE, "s", 250)
		txt("RIVAL: " + Cards.name_of(res["vals"][1]), 12, y + 11, WHITE, "s", 250)
		y += 24
	else:
		txt("NO SHOWDOWN", 12, y, WHITE, "s", 250)
		y += 13
	for line in res["lines"]:
		txt(line[0], 12, y, CYAN, "s", 180)
		txt("+%d" % line[1], 12, y, GOLD, "s", 250, 2)
		y += 11
	if res["points"] > 0:
		draw_line(Vector2(12, y + 1), Vector2(262, y + 1), GOLD)
		txt("POINTS", 12, y + 4, WHITE, "s", 100)
		txt("+%d" % res["points"], 12, y + 4, GOLD, "s", 250, 2)
		y += 15
	if res["guarded"]:
		txt("IRON GUARD SAVED HALF THE BET", 12, y, CYAN, "s", 250)
		y += 11
	if res["power"] != "":
		txt("NEW POWER: " + Data.POWERS[res["power"]]["name"], 12, y, PINK, "s", 250)
	if (m.tick / 20) % 2 == 0:
		txt("Z / CLICK: " + ("RESULT" if s["phase"] == "match_over" else "NEXT HAND"), 4, 344, GOLD, "s", 262, 1)

func _cutin() -> void:
	var c: Dictionary = m.cutin
	var who: int = c["who"]
	var id: String = m.s["avatar"] if who == 0 else m.s["rival"]
	var t: int = c["t"]
	var slide := clampf(float(80 - t) / 8.0, 0.0, 1.0)
	var col := Color(0.1, 0.25, 0.7, 0.92) if who == 0 else Color(0.6, 0.08, 0.2, 0.92)
	draw_rect(Rect2(0, 110, 640, 100), col)
	draw_rect(Rect2(0, 108, 640, 2), GOLD)
	draw_rect(Rect2(0, 210, 640, 2), GOLD)
	speed_lines(Rect2(0, 112, 640, 96), Color(1, 1, 1, 0.5), m.tick / 2)
	if tex.has("portraits"):
		var row := CAST_ORDER.find(id)
		var ey: int = int(eye_y.get(id, 30))
		var x := -400 + slide * 420 if who == 0 else 640 - slide * 420
		draw_texture_rect_region(tex["portraits"], Rect2(x, 112, 384, 96), Rect2(4 * 96, row * 96 + ey, 96, 24))
	var tx := 420.0 if who == 0 else 24.0
	shadow(c["text"], tx - 8, 136, GOLD, "i", 216, 1)
	shadow(Data.CAST[id]["shout"], tx - 40, 170, WHITE, "s", 280, 1)
