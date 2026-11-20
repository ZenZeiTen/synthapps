## Deterministic random numbers. The state is one integer, saved with the game, so a
## replayed command list always produces the same fights (the tests rely on it).
extends RefCounted

var state: int = 1


func _init(seed_value: int = 1) -> void:
	state = seed_value & 0x7FFFFFFF
	if state == 0:
		state = 1


func next() -> int:
	# 31-bit LCG (glibc constants). state < 2^31, so the product stays below 2^62.
	state = (state * 1103515245 + 12345) & 0x7FFFFFFF
	return state >> 4  # low bits of an LCG are weak; keep the top 27


## The original's rnd(n): an integer 0..n-1 (0 when n <= 0).
func rnd(n: int) -> int:
	if n <= 0:
		return 0
	return next() % n


func chance(pct: int) -> bool:
	return rnd(100) < pct


func shuffle(a: Array) -> void:
	for i in range(a.size() - 1, 0, -1):
		var j := rnd(i + 1)
		var t = a[i]
		a[i] = a[j]
		a[j] = t
