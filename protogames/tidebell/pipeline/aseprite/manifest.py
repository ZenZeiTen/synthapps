"""Every sprite in the game: size, origin (the point placed on the object's feet), where it
comes from, and its animation tags in frame order. The art scripts assert against this, and
export_art.py writes content/data/manifest.json from it for both builds.

    SPRITES[name] = (w, h, (origin_x, origin_y), source, [(tag, frames), ...])
"""
from __future__ import annotations

import json
import os

HERO_TAGS = [("stand", 2), ("walk", 6), ("jump", 1), ("fall", 1), ("crouch", 1), ("cut0", 3), ("cut1", 3),
             ("spin", 3), ("cattack", 3), ("jattack", 2), ("special", 4), ("climb", 2), ("hurt", 1), ("dead", 2)]
FOE_TAGS = [("stand", 2), ("walk", 4), ("windup", 1), ("cut", 2), ("hurt", 1)]

SPRITES: dict[str, tuple] = {
    # the wardens (pipeline/aseprite/art_people.py, a jointed puppet)
    "kess": (48, 48, (24, 46), "puppet", HERO_TAGS),
    "june": (48, 48, (24, 46), "puppet", HERO_TAGS),
    "brannoch": (48, 48, (24, 46), "puppet", HERO_TAGS),
    # people of the Brinecrows
    "raider": (48, 48, (24, 46), "puppet", FOE_TAGS),
    "thrower": (48, 48, (24, 46), "puppet", [("stand", 2), ("walk", 4), ("throw", 2), ("hurt", 1)]),
    "vell": (48, 48, (24, 46), "puppet", [("stand", 2), ("walk", 4), ("leap", 1), ("throw", 2), ("hurt", 1)]),
    "tallyman": (56, 56, (28, 54), "puppet", [("stand", 2), ("hop", 1), ("lob", 2), ("hurt", 1)]),
    "grane": (48, 48, (24, 46), "puppet", FOE_TAGS + [("back", 1)]),
    "captive": (32, 44, (16, 42), "puppet", [("stand", 2), ("wave", 2)]),
    # creatures (art_creatures.py)
    "mudskip": (24, 16, (12, 15), "drawn", [("stand", 2), ("hop", 1)]),
    "bat": (24, 16, (12, 15), "drawn", [("hang", 1), ("fly", 2)]),
    "crab": (32, 20, (16, 19), "drawn", [("walk", 2)]),
    "gull": (32, 20, (16, 16), "drawn", [("fly", 2)]),
    "wisp": (16, 16, (8, 14), "drawn", [("float", 2)]),
    "golem": (40, 44, (20, 43), "drawn", [("walk", 2), ("windup", 1), ("slam", 1)]),
    "hullbreaker": (64, 40, (32, 39), "drawn", [("walk", 2), ("charge", 2), ("rest", 1)]),
    "oldgrey": (64, 40, (32, 30), "drawn", [("fly", 3), ("dive", 1)]),
    "warden": (40, 48, (20, 46), "drawn", [("float", 2), ("cast", 1)]),
    "siltking": (96, 96, (48, 94), "blender", [("stand", 2), ("slam", 2), ("wave", 1)]),
    # things
    "chest": (20, 16, (10, 15), "drawn", [("shut", 1)]),
    "post": (16, 40, (8, 39), "drawn", [("dark", 1), ("lit", 2)]),
    "bell": (20, 20, (10, 19), "blender", [("shine", 2)]),
    "items": (16, 16, (8, 14), "drawn", [("coin", 1), ("gem", 1), ("key", 1), ("tonic", 1), ("heartroot", 1),
                                        ("knives", 1), ("feather", 1), ("squall", 1), ("stoneskin", 1),
                                        ("fury", 1), ("life", 1)]),
    "knife": (12, 6, (6, 3), "drawn", [("fly", 1)]),
    "bottle": (8, 8, (4, 7), "drawn", [("spin", 2)]),
    "net": (16, 12, (8, 11), "drawn", [("fly", 1)]),
    "bomb": (10, 10, (5, 9), "drawn", [("spin", 2)]),
    "blast": (36, 30, (18, 29), "drawn", [("burst", 3)]),
    "feather": (8, 10, (4, 9), "drawn", [("fall", 1)]),
    "spark": (10, 10, (5, 9), "drawn", [("glow", 2)]),
    "shock": (14, 10, (7, 9), "drawn", [("run", 2)]),
    "wave": (16, 26, (8, 25), "drawn", [("roll", 2)]),
    "fx": (24, 24, (12, 20), "drawn", [("poof", 4)]),
    "gust": (48, 48, (24, 40), "drawn", [("spin", 2)]),
    # screens
    "font": (576, 8, (0, 0), "drawn", [("glyphs", 1)]),
    "hud": (16, 16, (0, 0), "drawn", [("kess", 1), ("june", 1), ("brannoch", 1), ("box", 1), ("heart", 1)]),
    "panel": (24, 24, (0, 0), "drawn", [("frame", 1)]),
    "cursor": (8, 8, (0, 0), "drawn", [("point", 2)]),
    "portraits": (48, 48, (0, 0), "puppet", [("pell", 1), ("kess", 1), ("june", 1), ("brannoch", 1),
                                              ("vell", 1), ("hullbreaker", 1), ("tallyman", 1), ("oldgrey", 1),
                                              ("warden", 1), ("grane", 1), ("siltking", 1), ("villager", 1)]),
    "logo": (256, 56, (0, 0), "drawn", [("logo", 1)]),
    "mapmark": (16, 16, (8, 8), "drawn", [("island", 1), ("done", 1), ("here", 2)]),
}

TILE_COLS, TILE_ROWS = 8, 3
THEMES = ["reach", "harbor", "village", "cliffs", "abbey", "brinecrow"]
# tile sheet cells (index = row * 8 + col)
TILE_CELLS = ["top", "inner", "top_l", "top_r", "ledge", "climb", "spikes", "gate",
              "crate", "water", "side_l", "side_r", "under", "top_alt", "inner_alt", "climb_top",
              "deco0", "deco1", "deco2", "deco3", "ledge_l", "ledge_r", "water_top", "blank"]

MUSIC = ["title", "house", "reach", "harbor", "village", "cliffs", "abbey", "brinecrow", "guardian", "final",
         "clear", "ending", "over"]
SFX = ["jump", "land", "swing", "spin", "cleave", "hit", "clink", "hurt", "die", "coin", "item", "use", "deny",
       "chest", "post", "splash", "eswing", "throw", "break", "boom", "slam", "net", "screech", "appear", "vanish",
       "cast", "roar", "wave", "bell", "gate", "life", "select", "menu", "page"]
BACKDROPS = THEMES
STILLS = ["title", "map", "dawn"]


def manifest_json() -> dict:
    out = {"sprites": {}, "tiles": {"cols": TILE_COLS, "rows": TILE_ROWS, "cells": TILE_CELLS, "themes": THEMES},
           "music": MUSIC, "sfx": SFX, "backdrops": BACKDROPS, "stills": STILLS}
    for name, (w, h, org, _src, tags) in SPRITES.items():
        t, i = {}, 0
        for tag, n in tags:
            t[tag] = [i, n]
            i += n
        out["sprites"][name] = {"w": w, "h": h, "origin": list(org), "frames": i, "tags": t}
    return out


def write_manifest(root: str) -> None:
    data = json.dumps(manifest_json(), indent=1, sort_keys=True)
    for rel in ("content/data/manifest.json",):
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(data + "\n")
