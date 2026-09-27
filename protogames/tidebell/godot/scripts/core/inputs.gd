## One step of recorded input as a small integer (routes, replays and the parity check):
## bits 0-1 dx+1, bits 2-3 dy+1, bit 4 jump, bit 5 attack, bit 6 item, bit 7 special.
## web/src/core/inputs.js is the same.
extends RefCounted


static func pack(i: Dictionary) -> int:
	return (int(i.get("dx", 0)) + 1) | ((int(i.get("dy", 0)) + 1) << 2) | (int(bool(i.get("jump", false))) << 4) \
		| (int(bool(i.get("attack", false))) << 5) | (int(bool(i.get("item", false))) << 6) \
		| (int(bool(i.get("special", false))) << 7)


static func unpack(c: int) -> Dictionary:
	return {"dx": (c & 3) - 1, "dy": ((c >> 2) & 3) - 1, "jump": (c & 16) != 0, "attack": (c & 32) != 0,
		"item": (c & 64) != 0, "special": (c & 128) != 0}
