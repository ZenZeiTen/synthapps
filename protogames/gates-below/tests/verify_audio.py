"""Audio checks.

1. Every sound name the core emits (sfx("...") in godot/scripts/core, plus the
   spell_<fx> names built from spells.json) exists as godot/content/sfx/<name>.wav.
2. Every WAV is 16-bit mono 22050 Hz.
3. Every music loop is seamless: the jump from the last sample to the first is no
   larger than the largest ordinary step within the track.

    python tests/verify_audio.py
"""
import glob
import json
import os
import re
import sys
import wave

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONTENT = os.path.join(ROOT, "godot", "content")
fails = []


def read(path):
    with wave.open(path) as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 22050):
            fails.append(f"{os.path.basename(path)}: format {w.getnchannels()}ch {w.getsampwidth() * 8}bit {w.getframerate()}Hz")
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.int32)


names = set()
for p in glob.glob(os.path.join(ROOT, "godot", "scripts", "core", "*.gd")):
    names.update(re.findall(r'sfx\("([a-z_]+)"[,)]', open(p).read()))
spells = json.load(open(os.path.join(CONTENT, "data", "spells.json")))["spells"]
names.update("spell_" + s["fx"] for s in spells.values() if s.get("fx"))
# the battle strike picks "claw" or "slam" in one call
names.update({"claw", "slam"})
for n in sorted(names):
    if not os.path.exists(os.path.join(CONTENT, "sfx", n + ".wav")):
        fails.append(f"missing sound effect: {n}")
for p in glob.glob(os.path.join(CONTENT, "sfx", "*.wav")):
    read(p)
tracks = glob.glob(os.path.join(CONTENT, "music", "*.wav"))
for p in tracks:
    x = read(p)
    steps = np.abs(np.diff(x))
    seam = abs(int(x[0]) - int(x[-1]))
    if seam > steps.max():
        fails.append(f"{os.path.basename(p)}: loop seam jump {seam} > largest step {steps.max()}")
print(f"{len(names)} effect names referenced, {len(tracks)} music loops")
for f in fails:
    print("FAIL", f)
print("audio OK" if not fails else f"{len(fails)} failures")
sys.exit(1 if fails else 0)
