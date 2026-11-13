extends RefCounted
## Cards, the hand evaluator and the win-chance estimate. Pure rules: no nodes.
## A card is an int 0..51: rank = c % 13 (0 is the Two, 12 is the Ace), suit = c / 13
## (0 spades, 1 hearts, 2 diamonds, 3 clubs).

const RANK_CH := "23456789TJQKA"
const SUIT_CH := "shdc"
const RANK_NAME := ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
	"Jack", "Queen", "King", "Ace"]
const RANK_PLURAL := ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines",
	"Tens", "Jacks", "Queens", "Kings", "Aces"]
const CAT_NAME := ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush",
	"Full House", "Four of a Kind", "Straight Flush"]

static func rank(c: int) -> int:
	return c % 13

static func suit(c: int) -> int:
	return c / 13

static func card(text: String) -> int:
	return SUIT_CH.find(text[1]) * 13 + RANK_CH.find(text[0])

static func cards(text: String) -> Array:
	var out := []
	for t in text.split(" ", false):
		out.append(card(t))
	return out

static func label(c: int) -> String:
	return RANK_CH[c % 13] + SUIT_CH[c / 13]

## Step a 64-bit LCG kept in `box[key]` and return a number in 0..n-1.
static func roll(box: Dictionary, key: String, n: int) -> int:
	var x: int = box[key] * 6364136223846793005 + 1442695040888963407
	box[key] = x
	return ((x >> 33) & 0x7FFFFFFF) % n

static func _straight_top(mask: int) -> int:
	for top in range(12, 3, -1):
		if (mask >> (top - 4)) & 0x1F == 0x1F:
			return top
	if mask & 0x100F == 0x100F:
		return 3
	return -1

## Best poker hand in 2..7 cards. Bigger is better: category << 20, then up to five rank
## nibbles from the most to the least important card.
static func eval(cs: Array) -> int:
	var rc := [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
	var sc := [0, 0, 0, 0]
	var sm := [0, 0, 0, 0]
	var rmask := 0
	for c in cs:
		var r: int = c % 13
		var s: int = c / 13
		rc[r] += 1
		sc[s] += 1
		sm[s] |= 1 << r
		rmask |= 1 << r
	var fs := -1
	for s in 4:
		if sc[s] >= 5:
			fs = s
	if fs >= 0:
		var sf := _straight_top(sm[fs])
		if sf >= 0:
			return (8 << 20) | (sf << 16)
	var quad := -1
	var trips := []
	var pairs := []
	var singles := []
	for r in range(12, -1, -1):
		match rc[r]:
			4: quad = r
			3: trips.append(r)
			2: pairs.append(r)
			1: singles.append(r)
	if quad >= 0:
		var k := -1
		for r in range(12, -1, -1):
			if r != quad and rc[r] > 0:
				k = r
				break
		return (7 << 20) | (quad << 16) | (maxi(k, 0) << 12)
	if trips.size() >= 2 or (trips.size() == 1 and pairs.size() >= 1):
		var p: int = -1
		if trips.size() >= 2:
			p = trips[1]
		if pairs.size() >= 1:
			p = maxi(p, pairs[0])
		return (6 << 20) | (trips[0] << 16) | (p << 12)
	if fs >= 0:
		var v := 5 << 20
		var sh := 16
		for r in range(12, -1, -1):
			if sm[fs] & (1 << r):
				v |= r << sh
				sh -= 4
				if sh < 0:
					break
		return v
	var st := _straight_top(rmask)
	if st >= 0:
		return (4 << 20) | (st << 16)
	if trips.size() == 1:
		var v3: int = (3 << 20) | (trips[0] << 16)
		var sh3 := 12
		for r in singles:
			v3 |= r << sh3
			sh3 -= 4
			if sh3 < 4:
				break
		return v3
	if pairs.size() >= 2:
		var k2 := -1
		if pairs.size() >= 3:
			k2 = pairs[2]
		if singles.size() > 0:
			k2 = maxi(k2, singles[0])
		return (2 << 20) | (pairs[0] << 16) | (pairs[1] << 12) | (maxi(k2, 0) << 8)
	if pairs.size() == 1:
		var v1: int = (1 << 20) | (pairs[0] << 16)
		var sh1 := 12
		for r in singles:
			v1 |= r << sh1
			sh1 -= 4
			if sh1 < 4:
				break
		return v1
	var v0 := 0
	var sh0 := 16
	for r in singles:
		v0 |= r << sh0
		sh0 -= 4
		if sh0 < 0:
			break
	return v0

static func category(v: int) -> int:
	return v >> 20

static func is_royal(v: int) -> bool:
	return (v >> 20) == 8 and ((v >> 16) & 15) == 12

## A short name for the meter and the showdown banner, at most 24 characters.
static func name_of(v: int) -> String:
	var cat := v >> 20
	var a := (v >> 16) & 15
	var b := (v >> 12) & 15
	match cat:
		8:
			return "Royal Flush" if a == 12 else "Straight Flush"
		7:
			return "Four " + RANK_PLURAL[a]
		6:
			return "Full House, " + RANK_PLURAL[a]
		5:
			return "Flush, " + RANK_NAME[a] + " high"
		4:
			return "Straight to " + RANK_NAME[a]
		3:
			return "Three " + RANK_PLURAL[a]
		2:
			return "Two Pair, " + RANK_PLURAL[a]
		1:
			return "Pair of " + RANK_PLURAL[a]
	return RANK_NAME[a] + " high"

## Monte Carlo win chance of `hole` against one unknown hand. `opp_known` holds any rival
## hole cards already seen, `dead` any other cards known to be out of the deck. Returns
## [score, samples] where a win counts 2 and a tie 1, so chance = score / (2 * samples).
static func equity_batch(hole: Array, board: Array, opp_known: Array, dead: Array,
		samples: int, box: Dictionary, key: String) -> Array:
	var used := {}
	for c in hole:
		used[c] = true
	for c in board:
		used[c] = true
	for c in opp_known:
		used[c] = true
	for c in dead:
		used[c] = true
	var rest := []
	for c in 52:
		if not used.has(c):
			rest.append(c)
	var need_opp := 2 - opp_known.size()
	var need_board := 5 - board.size()
	var need := need_opp + need_board
	var n := rest.size()
	var score := 0
	var mine := hole + board
	var theirs := opp_known + board
	var base_m := mine.size()
	var base_t := theirs.size()
	mine.resize(base_m + need_board)
	theirs.resize(base_t + need_opp + need_board)
	for _i in samples:
		for j in need:
			var k := j + roll(box, key, n - j)
			var t = rest[j]
			rest[j] = rest[k]
			rest[k] = t
		for j in need_opp:
			theirs[base_t + j] = rest[j]
		for j in need_board:
			var c = rest[need_opp + j]
			mine[base_m + j] = c
			theirs[base_t + need_opp + j] = c
		var a := eval(mine)
		var b := eval(theirs)
		if a > b:
			score += 2
		elif a == b:
			score += 1
	return [score, samples]

static func equity(hole: Array, board: Array, opp_known: Array, dead: Array, samples: int,
		box: Dictionary, key: String) -> float:
	var r := equity_batch(hole, board, opp_known, dead, samples, box, key)
	return float(r[0]) / float(2 * r[1])
