"""Mark every file in godot/content with a `.import` sidecar saying importer="keep".

Godot then leaves the files untouched (no re-encoding) and the exporter packs them
byte for byte, so the game loads the same PNG/WAV/GLB/JSON files in the editor and
in an exported build. (A .gdignore would also stop re-encoding, but then Godot leaves
the folder out of exported builds; measured in crowmere-hill.)

    python tools/mark_keep.py
"""
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "godot", "content")
EXT = {".png", ".wav", ".glb"}
n = 0
for d, _, files in os.walk(ROOT):
    for f in files:
        if os.path.splitext(f)[1].lower() in EXT:
            with open(os.path.join(d, f + ".import"), "w") as fh:
                fh.write('[remap]\n\nimporter="keep"\n')
            n += 1
print(f"marked {n} files keep")
