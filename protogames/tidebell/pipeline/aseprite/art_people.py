"""The people of Tidebell, drawn with the jointed puppet (puppet.py): the three wardens,
the Brinecrow raiders, the guardians who are people, and the captives. All designs are
Tidebell's own.

    python3 pipeline/aseprite/art_people.py      # writes art/aseprite/<name>.aseprite
"""
from __future__ import annotations

import puppet as P
from canvas import Canvas
from palette import N
from sheet import save_sprite

OUTFITS = {
    # a harbour pilot: blue coat, red headscarf, cutlass
    "kess": {"colors": {"skin": "skin1", "shirt": "white", "coat": "blue1", "sleeve": "blue1", "arm": "blue1",
                        "legs": "night1", "boots": "wood1", "belt": "wood0",
                        "dark": {"sleeve": "blue0", "arm": "blue0", "legs": "night0", "boots": "wood0", "skin": "skin0"}},
             "coat": True, "headwear": P.scarf, "weapon": P.cutlass},
    # a netmender: green hood, short and quick, a hook-knife in each hand
    "june": {"colors": {"skin": "skin2", "shirt": "leaf3", "coat": "leaf2", "sleeve": "leaf2", "arm": "skin2",
                        "legs": "wood2", "boots": "wood1", "belt": "silt1",
                        "dark": {"sleeve": "leaf1", "arm": "skin1", "legs": "wood1", "boots": "wood0", "skin": "skin1"}},
             "scale": 0.92, "headwear": P.hood, "weapon": P.hook, "weapon2": P.hook},
    # a bell-founder: leather apron, big beard, a boarding anchor
    "brannoch": {"colors": {"skin": "skin1", "shirt": "wood1", "coat": "wood0", "sleeve": "stone2", "arm": "skin1",
                            "legs": "stone1", "boots": "ink", "belt": "gold0",
                            "dark": {"sleeve": "stone1", "arm": "skin0", "legs": "stone0", "boots": "ink",
                                     "skin": "skin0"}},
                 "scale": 1.06, "bulk": 2, "headwear": P.bald_beard, "weapon": P.anchor},
    "raider": {"colors": {"skin": "skin1", "shirt": "red1", "sleeve": "red1", "arm": "skin1", "legs": "stone1",
                          "boots": "ink", "belt": "wood0",
                          "dark": {"sleeve": "red0", "arm": "skin0", "legs": "stone0", "skin": "skin0"}},
               "headwear": P.bandana, "weapon": P.sabre},
    "thrower": {"colors": {"skin": "skin1", "shirt": "orange0", "sleeve": "orange0", "arm": "skin1", "legs": "night1",
                           "boots": "ink", "belt": "wood0",
                           "dark": {"sleeve": "wood1", "arm": "skin0", "legs": "night0", "skin": "skin0"}},
                "headwear": P.bandana, "weapon": P.bottle},
    "vell": {"colors": {"skin": "skin1", "shirt": "silt1", "coat": "silt0", "sleeve": "silt1", "arm": "skin1",
                        "legs": "wood1", "boots": "wood0", "belt": "gold0",
                        "dark": {"sleeve": "silt0", "arm": "skin0", "legs": "wood0", "skin": "skin0"}},
             "coat": True, "headwear": P.netcap, "weapon": P.netroll},
    "tallyman": {"colors": {"skin": "skin2", "shirt": "violet1", "coat": "violet0", "sleeve": "violet1",
                            "arm": "violet1", "legs": "ink", "boots": "ink", "belt": "gold1",
                            "dark": {"sleeve": "violet0", "arm": "violet0", "legs": "ink", "skin": "skin1"}},
                 "scale": 1.15, "bulk": 5, "coat": True, "headwear": P.topper, "weapon": P.ledger},
    "grane": {"colors": {"skin": "skin1", "shirt": "white", "coat": "red0", "sleeve": "red0", "arm": "red0",
                         "legs": "ink", "boots": "ink", "belt": "gold1",
                         "dark": {"sleeve": "ink", "arm": "ink", "legs": "ink", "skin": "skin0"}},
              "scale": 1.05, "coat": True, "headwear": P.tricorn, "weapon": P.rapier},
    "captive": {"colors": {"skin": "skin1", "shirt": "sea2", "sleeve": "sea2", "arm": "skin1", "legs": "wood2",
                           "boots": "wood1", "belt": "wood0",
                           "dark": {"sleeve": "sea1", "arm": "skin0", "legs": "wood1", "skin": "skin0"}},
                "scale": 0.9, "headwear": P.plainhair},
}

p = P.pose
STAND = [p(), p(dy=1, uaF=10, faF=22, uaB=-6)]
WALK = [
    p(thF=28, shF=-6, thB=-24, shB=18, uaF=-18, faF=10, uaB=20, faB=10, dy=0, wep=40),
    p(thF=14, shF=4, thB=-10, shB=30, uaF=-8, faF=14, uaB=10, faB=12, dy=1, wep=48),
    p(thF=-4, shF=24, thB=6, shB=4, uaF=4, faF=18, uaB=-2, faB=8, dy=0, wep=56),
    p(thF=-24, shF=18, thB=28, shB=-6, uaF=20, faF=14, uaB=-18, faB=8, dy=0, wep=66),
    p(thF=-10, shF=30, thB=14, shB=4, uaF=10, faF=16, uaB=-8, faB=10, dy=1, wep=58),
    p(thF=6, shF=4, thB=-4, shB=24, uaF=-2, faF=16, uaB=4, faB=10, dy=0, wep=48),
]
JUMP = [p(thF=40, shF=-60, thB=-10, shB=40, uaF=-40, faF=30, uaB=-30, faB=40, wep=10, dy=-1)]
FALL = [p(thF=20, shF=-20, thB=-20, shB=30, uaF=60, faF=40, uaB=-50, faB=30, wep=120)]
CROUCH = [p(thF=70, shF=-110, thB=40, shB=-100, dy=9, torso=16, uaF=30, faF=30, uaB=10, wep=70)]
# three swings: overhead cut, forward cut, spin (A3)
CUT0 = [p(uaF=190, faF=10, wep=190, torso=-8, thF=16, thB=-12),
        p(uaF=120, faF=-10, wep=110, torso=6, thF=22, shF=-8, thB=-18),
        p(uaF=60, faF=-10, wep=60, torso=12, thF=26, shF=-10, thB=-20, dy=1)]
CUT1 = [p(uaF=-40, faF=10, wep=-30, torso=-6, thF=10, thB=-10),
        p(uaF=70, faF=10, wep=90, torso=10, thF=30, shF=-10, thB=-24),
        p(uaF=100, faF=0, wep=120, torso=14, thF=30, shF=-10, thB=-24, dy=1)]
SPIN = [p(uaF=-80, faF=-10, wep=-90, torso=-14, thF=20, thB=-20, dy=1),
        p(uaF=180, faF=0, wep=180, torso=0, thF=-16, thB=16),
        p(uaF=90, faF=0, wep=90, torso=10, thF=24, shF=-8, thB=-24, dy=1)]
CATTACK = [p(thF=70, shF=-110, thB=40, shB=-100, dy=9, torso=18, uaF=20, faF=10, wep=40),
           p(thF=70, shF=-110, thB=40, shB=-100, dy=9, torso=24, uaF=80, faF=0, wep=88),
           p(thF=70, shF=-110, thB=40, shB=-100, dy=9, torso=24, uaF=95, faF=0, wep=100)]
JATTACK = [p(thF=40, shF=-60, thB=-10, shB=40, uaF=200, faF=0, wep=200, uaB=-30, faB=40, dy=-1),
           p(thF=40, shF=-60, thB=-10, shB=40, uaF=110, faF=0, wep=130, uaB=-30, faB=40, dy=-1, torso=10)]
SPECIAL = [p(uaF=120, faF=0, wep=100, torso=-10, dy=2, thF=30, shF=-20, thB=-30, shB=20),
           p(uaF=180, faF=0, wep=190, torso=0, dy=2, thF=30, shF=-20, thB=-30, shB=20),
           p(uaF=260, faF=0, wep=260, torso=8, dy=2, thF=30, shF=-20, thB=-30, shB=20),
           p(uaF=90, faF=0, wep=90, torso=10, dy=2, thF=30, shF=-20, thB=-30, shB=20)]
CLIMB = [p(uaF=170, faF=-20, uaB=150, faB=10, thF=40, shF=-60, thB=-4, shB=10, wep=200, torso=-4),
         p(uaF=150, faF=10, uaB=170, faB=-20, thF=-4, shF=10, thB=40, shB=-60, wep=190, torso=-4)]
HURT = [p(torso=-24, head=-16, uaF=-60, faF=-20, uaB=-80, faB=-10, thF=10, thB=-30, shB=20, wep=-40)]
DEAD = [p(torso=-40, head=-20, uaF=-70, faF=0, uaB=-90, thF=20, thB=-20, dy=4, wep=-60),
        p(torso=-80, head=-10, uaF=-100, faF=0, uaB=-110, thF=-70, shF=0, thB=-80, dy=15, wep=-100)]

HERO_POSES = STAND + WALK + JUMP + FALL + CROUCH + CUT0 + CUT1 + SPIN + CATTACK + JATTACK + SPECIAL + CLIMB + HURT + DEAD
FOE_POSES = STAND + WALK[0:6:2] + WALK[3:4] + [CUT1[0]] + CUT1[1:3] + HURT


def figure(name, pose, size=(48, 48), feet=(24, 46)):
    c = Canvas(*size)
    P.draw(c, OUTFITS[name], pose, feet)
    c.outline("ink")
    return c


def build() -> list[str]:
    out = []
    for hero in ("kess", "june", "brannoch"):
        out.append(save_sprite(hero, [figure(hero, q) for q in HERO_POSES]))
    out.append(save_sprite("raider", [figure("raider", q) for q in FOE_POSES]))
    throw = [p(uaF=200, faF=-20, wep=180, torso=-10), p(uaF=80, faF=0, wep=60, torso=10, thF=20, thB=-20)]
    out.append(save_sprite("thrower", [figure("thrower", q) for q in STAND + WALK[0:6:2] + WALK[3:4] + throw + HURT]))
    out.append(save_sprite("vell", [figure("vell", q) for q in STAND + WALK[0:6:2] + WALK[3:4] + JUMP + throw + HURT]))
    lob = [p(uaF=160, faF=-30, wep=150, torso=-6), p(uaF=70, faF=0, wep=60, torso=6)]
    tall = [figure("tallyman", q, (56, 56), (28, 54)) for q in STAND + JUMP + lob + HURT]
    out.append(save_sprite("tallyman", tall))
    back = [p(thF=30, shF=-40, thB=-30, shB=30, uaF=40, faF=40, wep=80, torso=-14, dy=-1)]
    out.append(save_sprite("grane", [figure("grane", q) for q in FOE_POSES + back]))
    wave = [p(uaF=160, faF=20, uaB=-10), p(uaF=140, faF=-20, uaB=-10)]
    out.append(save_sprite("captive", [figure("captive", q, (32, 44), (16, 42)) for q in STAND + wave]))
    return out


if __name__ == "__main__":
    for path in build():
        print(path)
