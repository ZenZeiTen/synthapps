## The tide-code: the source's stage password (DESIGN S6), as 6 letters from a 16-letter
## alphabet (24 bits). web/src/core/code.js is the same.
##
## bits  0-2  stages done (0-6)       bits  3-5  lives - 1 (1-8)
## bits  6-7  maximum health step     bits  8-9  difficulty (0-2)
## bits 10-13 knives (0-9)            bits 14-17 tonics (0-9)
## bits 18-23 check: the sum of the four 6-bit groups above... see check()
extends RefCounted

const ALPHA := "BCDFGHJKLMNPRSTW"
const HP_STEPS := [71, 95, 119, 127]


static func check(v: int) -> int:
	var s := 0x2B
	for i in 3:
		s = (s * 7 + ((v >> (i * 6)) & 63)) & 63
	return s


static func encode(p: Dictionary) -> String:
	var hp_step := 0
	for i in HP_STEPS.size():
		if int(p["maxhp"]) >= HP_STEPS[i]:
			hp_step = i
	var v := clampi(int(p["done"]), 0, 6)
	v |= (clampi(int(p["lives"]), 1, 8) - 1) << 3
	v |= hp_step << 6
	v |= clampi(int(p["difficulty"]), 0, 2) << 8
	v |= clampi(int(p["items"].get("knives", 0)), 0, 9) << 10
	v |= clampi(int(p["items"].get("tonic", 0)), 0, 9) << 14
	v |= check(v) << 18
	var s := ""
	for i in 6:
		s += ALPHA[(v >> (i * 4)) & 15]
	return s


## Returns {} for a code that is not valid.
static func decode(code: String) -> Dictionary:
	var c := code.strip_edges().to_upper()
	if c.length() != 6:
		return {}
	var v := 0
	for i in 6:
		var k := ALPHA.find(c[i])
		if k < 0:
			return {}
		v |= k << (i * 4)
	var body := v & 0x3FFFF
	if (v >> 18) != check(body):
		return {}
	var done := body & 7
	var diff := (body >> 8) & 3
	var knives := (body >> 10) & 15
	var tonic := (body >> 14) & 15
	if done > 6 or diff > 2 or knives > 9 or tonic > 9:
		return {}
	return {"done": done, "lives": ((body >> 3) & 7) + 1, "maxhp": HP_STEPS[(body >> 6) & 3],
		"difficulty": diff, "items": {"knives": knives, "tonic": tonic}}
