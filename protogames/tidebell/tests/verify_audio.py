"""Every sound effect and music track in the manifest exists in both builds, in the
expected format, and is not silent.

    python3 tests/verify_audio.py
"""
import json
import os
import sys
import wave

import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    errors = []
    man = json.load(open(os.path.join(ROOT, "content", "data", "manifest.json")))
    n = 0
    for base in ("godot/content", "web/public/content"):
        for s in man["sfx"]:
            path = os.path.join(ROOT, base, "sfx", s + ".wav")
            if not os.path.exists(path):
                errors.append(f"{base}: missing sfx {s}")
                continue
            with wave.open(path) as w:
                if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 22050):
                    errors.append(f"sfx {s}: not mono 16-bit 22050 Hz")
                x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
            if len(x) < 400 or np.max(np.abs(x)) < 3000:
                errors.append(f"sfx {s}: too short or silent")
            n += 1
        for m in man["music"]:
            path = os.path.join(ROOT, base, "music", m + ".ogg")
            if not os.path.exists(path):
                errors.append(f"{base}: missing music {m}")
                continue
            x, sr = sf.read(path)
            if sr != 32000 or x.ndim != 2 or x.shape[1] != 2:
                errors.append(f"music {m}: not stereo 32000 Hz")
            if len(x) < sr * 3 or np.sqrt(np.mean(x ** 2)) < 0.02:
                errors.append(f"music {m}: too short or too quiet")
            n += 1
    for e in errors:
        print("AUDIO", e)
    print("AUDIO ok (%d files)" % n if not errors else "AUDIO FAIL (%d problems)" % len(errors))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
