"""Audio checks for what cannot be heard in a test run.

    python tests/verify_audio.py

* every track the game can request exists in both soundtrack versions;
* each file's length equals its score's length (bars x bar length at the tempo), read from
  the score text with this file's own parser, not the synth's;
* no clipping, not silent, and the loop seam is no louder than an ordinary step;
* every sound effect name used in the scripts has a WAV.
"""
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "godot" / "content" / "audio" / "music"
SFX = ROOT / "godot" / "content" / "audio" / "sfx"
sys.path.insert(0, str(ROOT / "tools" / "audio"))
import music as M  # noqa: E402  (only its TRACKS data; timing is re-derived below)

fails = []


def read(p):
    with wave.open(str(p)) as w:
        n, sr, sw = w.getnframes(), w.getframerate(), w.getsampwidth()
        raw = w.readframes(n)
    x = np.frombuffer(raw, dtype="<i2").astype(float) / 32768 if sw == 2 else (np.frombuffer(raw, dtype=np.uint8).astype(float) - 128) / 128
    return x, sr


def units(text):
    """Independent bar parser: token durations are the number after the last ':'."""
    bars = [b for b in text.split("|")]
    return [sum(float(tok.rsplit(":", 1)[1]) for tok in b.split()) for b in bars]


needed = {"title", "gameover", "ending", "boss", "clear", "death"}
for lv in (ROOT / "godot" / "content" / "levels").glob("stage*.txt"):
    for m in re.findall(r"^music=(\w+)", lv.read_text(), re.M):
        needed.add(m)
for name in sorted(needed):
    if name not in M.TRACKS:
        fails.append(f"no score for track {name}")
        continue
    tr = M.TRACKS[name]
    bl = units(tr["melody"])
    if any(abs(b - tr["bar"]) > 1e-6 for b in bl):
        fails.append(f"{name}: bar lengths {bl} != {tr['bar']}")
    secs = len(bl) * tr["bar"] * 60.0 / tr["bpm"]
    for v in ("16", "8"):
        p = MUSIC / f"{name}_{v}.wav"
        if not p.exists():
            fails.append(f"missing {p.name}")
            continue
        x, sr = read(p)
        dur = len(x) / sr
        if abs(dur - secs) > 0.02:
            fails.append(f"{p.name}: {dur:.2f}s, score says {secs:.2f}s")
        peak = np.abs(x).max()
        rms = np.sqrt(np.mean(x * x))
        if peak > 0.999 or rms < 0.02:
            fails.append(f"{p.name}: peak {peak:.3f} rms {rms:.3f}")
        if not tr.get("once"):
            seam = abs(x[0] - x[-1])
            step = np.percentile(np.abs(np.diff(x)), 99.5)
            if seam > step * 1.5 + 1e-3:
                fails.append(f"{p.name}: loop seam jump {seam:.3f} > ordinary step {step:.3f}")
        print(f"ok  {p.name:16s} {dur:5.1f}s peak {peak:.2f} rms {rms:.3f}")

used = set()
for gd in (ROOT / "godot" / "scripts").rglob("*.gd"):
    src = gd.read_text(encoding="utf8")
    used |= set(re.findall(r'sfx\("([a-z0-9_]+)"\)', src))
    used |= set(re.findall(r'audio\.play\("([a-z0-9_]+)"\)', src))
    used |= set(re.findall(r'sfx\("([a-z0-9_]+)" if', src))
for s in sorted(used):
    if not (SFX / f"{s}.wav").exists():
        fails.append(f"sfx {s} has no wav")
print(f"{len(used)} sound effect names used, all present" if not any("sfx" in f for f in fails) else "")
for f in fails:
    print("FAIL", f)
print("AUDIO", "ok" if not fails else f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
