extends RefCounted
## Rival decisions. think() returns {"power": slot} when the rival wants to use a power
## first (ask again afterwards), otherwise {"a": action, "amt": raise-to amount}.
## It only reads what the seat may know: its own cards, the board, peeked cards.

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")
const Game = preload("res://scripts/core/game.gd")

const SAMPLES := 140
const DEFAULT := {"loose": 0.5, "aggr": 0.5, "bluff": 0.15}

static func profile(s: Dictionary, who: int) -> Dictionary:
	if who == 1:
		return Data.CAST[s["rival"]]
	return s.get("bot", DEFAULT)

static func _size(s: Dictionary, who: int, frac: float) -> int:
	var cur := maxi(s["bet"][0], s["bet"][1])
	var x := cur + int(frac * float(Game.pot(s) + Game.to_call(s, who)))
	x -= x % 5
	return clampi(x, Game.min_raise_to(s, who), Game.max_raise_to(s, who))

static func think(s: Dictionary, who: int) -> Dictionary:
	var o := 1 - who
	var p := profile(s, who)
	var loose: float = p["loose"]
	var aggr: float = p["aggr"]
	var bluff: float = p["bluff"]
	var eq := Cards.equity(s["hole"][who], Game.known_board(s, who), Game.known_opp(s, who), [],
		SAMPLES, s, "rng_ai")
	var need_chips := Game.to_call(s, who)
	var pot_size := Game.pot(s)
	var stack: int = s["stack"][who]
	var street: int = s["street"]
	var fx: Dictionary = s["fx"]
	var r := float(Cards.roll(s, "rng_ai", 1000)) / 1000.0
	var may_raise := Game.can_raise(s, who)

	if fx["pstreet"][who] != street:
		var inv: Array = s["powers"][who]
		for i in inv.size():
			var id: String = inv[i]
			if not Game.can_use(s, who, id):
				continue
			var want := false
			match id:
				"swap":
					want = street == 0 and eq < 0.45
				"hawk":
					want = need_chips > 0 and need_chips * 10 >= pot_size * 3 and eq > 0.35 and eq < 0.7
				"sight":
					want = street >= 1 and street <= 2 and eq > 0.4 and eq < 0.7
				"guard":
					want = need_chips > 0 and need_chips * 2 >= stack and eq > 0.4
				"glare":
					want = street >= 1 and need_chips == 0 and eq < 0.45 and r < 0.5
			if want:
				return {"power": i}

	var scared: bool = fx["glare"][o] == street
	if need_chips == 0:
		var bet_p := aggr * 0.25
		if eq > 0.62:
			bet_p = 0.35 + aggr * 0.6
		elif eq < 0.42:
			bet_p = bluff
		if fx["glare"][who] == street:
			bet_p = 1.0
		if may_raise and not scared and r < bet_p:
			if eq > 0.9 and r < aggr * 0.3:
				return {"a": "raise", "amt": Game.max_raise_to(s, who)}
			return {"a": "raise", "amt": _size(s, who, 1.0 if eq > 0.8 else 0.5)}
		return {"a": "call", "amt": 0}

	var odds := float(need_chips) / float(pot_size + need_chips)
	var need := odds + 0.12 - loose * 0.2
	if need_chips * 2 >= stack:
		need += 0.08
	if scared:
		need += 0.25
	var strong := 0.72 if street > 0 else 0.6 - aggr * 0.12
	if eq >= strong and may_raise and not scared and r < 0.25 + aggr * 0.6:
		if eq > 0.88 or stack < pot_size:
			return {"a": "raise", "amt": Game.max_raise_to(s, who)}
		return {"a": "raise", "amt": _size(s, who, 1.0)}
	if eq >= need:
		return {"a": "call", "amt": 0}
	if may_raise and not scared and r < bluff * 0.5 and need_chips * 5 <= pot_size * 2:
		return {"a": "raise", "amt": _size(s, who, 1.0)}
	return {"a": "fold", "amt": 0}

## Apply think() until the seat has acted. Used by tests and by bot playouts.
static func play(s: Dictionary, who: int) -> void:
	for _i in 8:
		var d := think(s, who)
		if d.has("power"):
			Game.use_power(s, who, d["power"])
		else:
			Game.act(s, who, d["a"], d["amt"])
			return
