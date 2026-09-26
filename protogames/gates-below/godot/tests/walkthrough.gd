## The full route through the game, as goals for the bot (see docs/DESIGN.md, spoilers).
## Returns true when the game is won.
extends RefCounted


static func play(b) -> bool:
	var g = b.g
	# ---- Level 1: the Cellar Vaults
	b.take(1)                       # the Mayor's letter
	b.goto("B")
	b.touch("W")                    # lever: raise the south portcullis
	b.goto("R")                     # storeroom (the door on the way opens itself)
	b.take(0)                       # bread
	b.take(1)                       # red draught
	b.goto("8,2")
	b.take(2)                       # axe
	b.goto("K")
	b.touch("N")                    # the niche: iron key
	b.stow()
	b.goto("H", "N")
	b.goto("C")                     # through the illusion wall
	b.take(0)                       # Ember rune
	b.take(2)                       # coins
	b.goto("N")
	b.take(0)
	b.take(2)
	b.goto("0,8")
	b.take(3)
	b.goto("Q")                     # past the iron door into the plate crypt
	b.face_dir(1)
	g.pick(g.cur_cell(), 1)         # a bone, kept in hand
	b.goto("8,5", "E")
	g.drop(g.lv.idx(9, 5), 0)       # the bone holds the plate down
	b.ticks(8)
	if not b.goto(">"):
		return false
	if g.s["level"] != "cistern":
		b.say("did not reach the Cistern")
		return false
	# ---- Level 2: the Cistern
	b.take(3)                       # Cistern notes
	b.goto("C")
	b.take(1)                       # ring mail
	b.goto("R")
	b.take(0)                       # Rime rune
	b.goto("V")
	b.touch("S")                    # the sluice lever stills the teleports
	b.goto("I")
	b.take(1)                       # Sight rune
	b.goto("7,9")
	b.take(2)                       # wading boots
	b.goto("B")
	b.take(2)
	b.goto("12,0")
	b.take(1)                       # arrows
	b.goto("L")
	b.touch("E")                    # raises Maren's cell
	b.goto("H")
	b.take(3)
	b.goto("N", "N")
	b.talk("Come with us")
	b.goto("W")
	b.take(0)                       # gilt key
	b.take(2)
	if not b.goto(">"):
		return false
	if g.s["level"] != "gatehall":
		b.say("did not reach the Gate Hall")
		return false
	# ---- Level 3: the Gate Hall
	b.goto("P")
	b.take(0)                       # the Warden's Litany
	b.goto("B")
	b.take(2)                       # Ring of Embers
	b.goto("O")
	b.take(0)                       # bone key (dropped by the bone guard)
	b.goto("C")
	b.take(1)                       # Spark rune
	for lever in [["N", "N"], ["E", "E"], ["U", "S"], ["W", "W"]]:
		b.goto(lever[0])
		b.touch(lever[1])
	b.goto("J")
	b.goto("H")
	b.goto("10,9", "S")
	b.goto("R")
	b.take(0)                       # Return rune
	b.take(2)                       # amulet
	b.goto("Q")
	b.take(1)
	b.rest_full()
	b.goto("X")                     # the Warden
	b.take(0)                       # the Sealstone
	b.take(1)
	b.goto("Z", "E")
	# hold the Sealstone and set it in the Gate's niche
	for ci in g.s["party"].size():
		var ch: Dictionary = g.s["party"][ci]
		for i in ch["pack"].size():
			if ch["pack"][i] != null and ch["pack"][i]["id"] == "sealstone":
				g.pack_click(ci, i)
	g.touch()
	b.drain()
	return g.s["mode"] == "won"
