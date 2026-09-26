"""The game's 32-colour palette. Hue-shifted ramps: darks lean violet, lights lean warm.
Every exported pixel must be one of these colours (tests/verify_art.py checks it)."""

HEX = [
    # 0-8 stone / neutral ramp, violet shadows -> warm highlights
    "0d0b14", "1c1726", "2e2838", "45404f", "5f5b68", "7d7a83", "a09d9f", "cdc8c0", "f2ede0",
    # 9-13 wood / leather
    "2b1a14", "4a2c1c", "6e4428", "94643a", "bf8f55",
    # 14-17 skin / bone
    "5c3a2e", "8c5a44", "c08868", "e8b894",
    # 18-21 moss / slime
    "1c2a1e", "2f4a2a", "4f7234", "86a54a",
    # 22-25 water / cold magic
    "141e3c", "23407a", "3a70b0", "7ab8e0",
    # 26-29 blood / fire
    "3a0f12", "7a1c1c", "b8382a", "e8783a",
    # 30-31 gold / flame core
    "f0c048", "fff39a",
]
RGB = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in HEX]
RGBA = [c + (255,) for c in RGB]
N = {  # names used by the drawing code
    "ink": 0, "k1": 1, "s0": 2, "s1": 3, "s2": 4, "s3": 5, "s4": 6, "s5": 7, "white": 8,
    "w0": 9, "w1": 10, "w2": 11, "w3": 12, "w4": 13,
    "k0": 14, "sk1": 15, "sk2": 16, "sk3": 17,
    "g0": 18, "g1": 19, "g2": 20, "g3": 21,
    "b0": 22, "b1": 23, "b2": 24, "b3": 25,
    "r0": 26, "r1": 27, "r2": 28, "r3": 29,
    "gold": 30, "flame": 31,
}
