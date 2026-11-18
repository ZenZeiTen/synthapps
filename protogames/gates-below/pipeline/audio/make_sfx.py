"""Sound effects for Gates Below, synthesised from noise and FM tones (no samples).

    python pipeline/audio/make_sfx.py

Writes godot/content/sfx/<name>.wav (16-bit mono, 22050 Hz). The names are the ones
the core emits (grep 'sfx("' godot/scripts/core); tests/verify_audio.py checks that
every one exists.
"""
import os
import wave

import numpy as np

SR = 22050
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "content", "sfx")
rng = np.random.default_rng(1998)


def t(sec):
    return np.arange(int(SR * sec)) / SR


def env(n, a=0.005, d=0.1, s=0.0, r=0.05, hold=0.0):
    """ADSR envelope over n samples (times in seconds)."""
    out = np.zeros(n)
    i = 0
    for seg, (v0, v1) in ((a, (0, 1)), (d, (1, s)), (hold, (s, s)), (r, (s, 0))):
        k = min(n - i, int(seg * SR))
        if k > 0:
            out[i:i + k] = np.linspace(v0, v1, k, endpoint=False)
            i += k
    return out


def exp_decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def noise(sec):
    return rng.uniform(-1, 1, int(SR * sec))


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def sweep(f0, f1, sec, shape="sin"):
    f = np.geomspace(f0, f1, int(SR * sec))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == "sq":
        return np.sign(np.sin(ph))
    return np.sin(ph)


def fm(freq, sec, ratio=2.0, index=2.0, tau=0.2):
    tt = t(sec)
    mod = np.sin(2 * np.pi * freq * ratio * tt) * index * exp_decay(len(tt), tau)
    return np.sin(2 * np.pi * freq * tt + mod)


def cat(*parts):
    return np.concatenate(parts)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def pad(x, sec):
    return cat(x, np.zeros(int(SR * sec)))


SFX = {
    "bump": lambda: lowpass(noise(0.12), 400) * exp_decay(int(SR * 0.12), 0.03) * 2.5,
    "door": lambda: mix(lowpass(noise(0.6), 250) * env(int(SR * 0.6), 0.05, 0.3, 0.4, 0.2) * 1.5,
                        sweep(90, 70, 0.6) * 0.3 * env(int(SR * 0.6), 0.1, 0.4, 0.3, 0.1)),
    "gate": lambda: mix(*[fm(180 + 40 * k, 0.9, 3.1, 1.5, 0.3) * exp_decay(int(SR * 0.9), 0.3) * 0.15 for k in range(4)],
                        lowpass(noise(0.9), 600) * 0.4 * env(int(SR * 0.9), 0.01, 0.5, 0.2, 0.3)),
    "splash": lambda: lowpass(noise(0.35), 1800) * exp_decay(int(SR * 0.35), 0.08),
    "teleport": lambda: sweep(200, 1600, 0.6) * env(int(SR * 0.6), 0.05, 0.3, 0.5, 0.2) * 0.5 + sweep(1600, 300, 0.6) * 0.2,
    "fall": lambda: cat(sweep(600, 80, 0.5) * 0.4, lowpass(noise(0.3), 300) * exp_decay(int(SR * 0.3), 0.06) * 2.5),
    "stairs": lambda: cat(*[pad(lowpass(noise(0.06), 500) * exp_decay(int(SR * 0.06), 0.02) * 2, 0.12) for _ in range(4)]),
    "locked": lambda: cat(fm(300, 0.08, 1.5, 3, 0.02) * 0.5, np.zeros(400), fm(280, 0.1, 1.5, 3, 0.02) * 0.5),
    "unlock": lambda: cat(fm(420, 0.06, 2.7, 3, 0.02) * 0.4, np.zeros(1200), fm(520, 0.15, 2.7, 3, 0.05) * 0.5),
    "lever": lambda: cat(fm(160, 0.08, 3.3, 4, 0.03) * 0.5, lowpass(noise(0.2), 900) * exp_decay(int(SR * 0.2), 0.05)),
    "drink": lambda: cat(*[fm(500 + 90 * k, 0.07, 1.0, 0.5, 0.05) * exp_decay(int(SR * 0.07), 0.03) * 0.5 for k in range(5)]),
    "item": lambda: fm(880, 0.08, 2.0, 1.5, 0.03) * exp_decay(int(SR * 0.08), 0.03) * 0.4,
    "drop": lambda: lowpass(noise(0.1), 700) * exp_decay(int(SR * 0.1), 0.02) * 2.0,
    "coins": lambda: mix(*[cat(np.zeros(int(SR * 0.05 * k)), fm(2200 + 300 * k, 0.12, 3.5, 2, 0.05) * exp_decay(int(SR * 0.12), 0.04) * 0.25) for k in range(4)]),
    "rune": lambda: mix(*[cat(np.zeros(int(SR * 0.09 * k)), fm(f, 0.6, 3.0, 1.5, 0.3) * exp_decay(int(SR * 0.6), 0.25) * 0.3) for k, f in enumerate([523, 659, 784, 1046])]),
    "plate": lambda: lowpass(noise(0.25), 200) * exp_decay(int(SR * 0.25), 0.08) * 3.0,
    "wear": lambda: lowpass(noise(0.18), 1500) * env(int(SR * 0.18), 0.02, 0.1, 0.2, 0.05) * 0.8,
    "potion": lambda: cat(*[fm(600 + 120 * k, 0.06, 1.0, 0.8, 0.05) * 0.4 for k in range(6)]),
    "eat": lambda: cat(*[pad(lowpass(noise(0.05), 2500) * exp_decay(int(SR * 0.05), 0.015), 0.07) for _ in range(3)]),
    "death": lambda: sweep(300, 60, 1.0, "sq") * env(int(SR * 1.0), 0.01, 0.6, 0.2, 0.3) * 0.25,
    "levelup": lambda: mix(*[cat(np.zeros(int(SR * 0.12 * k)), fm(f, 0.5, 2.0, 1.0, 0.3) * exp_decay(int(SR * 0.5), 0.3) * 0.3) for k, f in enumerate([392, 494, 587, 784])]),
    "battle": lambda: mix(fm(110, 0.8, 1.0, 3, 0.2) * exp_decay(int(SR * 0.8), 0.3) * 0.5, fm(165, 0.8, 1.0, 2, 0.2) * exp_decay(int(SR * 0.8), 0.3) * 0.3),
    "bow": lambda: cat(fm(140, 0.05, 5, 6, 0.02) * 0.4, lowpass(noise(0.15), 3000) * exp_decay(int(SR * 0.15), 0.05) * 0.6),
    "swing": lambda: lowpass(noise(0.2), 1200) * env(int(SR * 0.2), 0.06, 0.1, 0.0, 0.04) * 1.2,
    "miss": lambda: lowpass(noise(0.14), 3000) * env(int(SR * 0.14), 0.04, 0.1, 0.0, 0.0) * 0.5,
    "throw": lambda: sweep(900, 300, 0.25) * 0.15 + lowpass(noise(0.25), 2000) * exp_decay(int(SR * 0.25), 0.1) * 0.4,
    "mob_die": lambda: mix(sweep(260, 50, 0.7, "sq") * env(int(SR * 0.7), 0.01, 0.5, 0.1, 0.1) * 0.2, lowpass(noise(0.4), 300) * exp_decay(int(SR * 0.4), 0.1)),
    "claw": lambda: mix(lowpass(noise(0.18), 2500) * exp_decay(int(SR * 0.18), 0.04) * 0.9, sweep(220, 120, 0.18) * 0.2),
    "slam": lambda: mix(lowpass(noise(0.4), 180) * exp_decay(int(SR * 0.4), 0.1) * 3.0, sweep(70, 40, 0.4) * 0.5 * exp_decay(int(SR * 0.4), 0.15)),
    "spell_fire": lambda: mix(lowpass(noise(0.7), 900) * env(int(SR * 0.7), 0.05, 0.4, 0.3, 0.2) * 1.2, sweep(120, 400, 0.7) * 0.15),
    "spell_frost": lambda: mix(*[fm(1200 + 500 * k, 0.6, 3.7, 2, 0.2) * exp_decay(int(SR * 0.6), 0.2) * 0.12 for k in range(4)], lowpass(noise(0.6), 5000) * 0.1),
    "spell_spark": lambda: np.sign(noise(0.35)) * (rng.uniform(0, 1, int(SR * 0.35)) > 0.7) * exp_decay(int(SR * 0.35), 0.12) * 0.4,
    "spell_heal": lambda: mix(*[fm(f, 0.9, 1.0, 0.6, 0.5) * env(int(SR * 0.9), 0.2, 0.4, 0.4, 0.3) * 0.18 for f in (523, 659, 784)]),
    "spell_sight": lambda: mix(*[fm(f, 1.0, 2.0, 0.8, 0.5) * env(int(SR * 1.0), 0.3, 0.4, 0.3, 0.3) * 0.18 for f in (440, 554, 659)]),
    "fizzle": lambda: sweep(600, 150, 0.35) * env(int(SR * 0.35), 0.01, 0.3, 0.0, 0.0) * 0.3 + lowpass(noise(0.35), 3000) * 0.15,
}


def write(name, x):
    x = np.asarray(x, dtype=np.float64)
    peak = np.max(np.abs(x)) or 1.0
    x = x / peak * 0.8
    fade = min(len(x), int(SR * 0.01))
    x[-fade:] *= np.linspace(1, 0, fade)
    pcm = (x * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, fn in SFX.items():
        write(name, fn())
    print(f"wrote {len(SFX)} sound effects to {OUT}")


if __name__ == "__main__":
    main()
