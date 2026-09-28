"""Thornlash sound effects, synthesised (no samples). 16-bit mono 32 kHz WAV.

    python tools/audio/sfx.py   ->  godot/content/audio/sfx/<name>.wav

Every name the game emits (Game.sfx / main.gd audio.play) has a recipe here; the test
suite checks the two lists match.
"""
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot" / "content" / "audio" / "sfx"
SR = 32000
rng = np.random.default_rng(1986)


def T(sec):
    return np.arange(int(sec * SR)) / SR


def noise(n):
    return rng.uniform(-1, 1, n)


def hp(x, k=0.9):
    return x - np.concatenate([[0], x[:-1]]) * k


def lp(x, k=0.2):
    # cheap one-pole low-pass via exponential smoothing in chunks (vectorised approximation)
    y = np.convolve(x, np.exp(-np.arange(64) * k) * k, mode="same")
    return y


def tone(f, t, shape="sine"):
    ph = 2 * np.pi * np.cumsum(np.broadcast_to(f, t.shape)) / SR
    if shape == "square":
        return np.sign(np.sin(ph))
    if shape == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)


def env(t, a, d):
    return np.clip(t / max(a, 1e-4), 0, 1) * np.exp(-t / d)


def cat(*xs):
    return np.concatenate(xs)


R = {}
t = T(0.22); R["whip"] = hp(noise(len(t)), 0.97) * env(t, 0.06, 0.03) * np.clip((t - 0.05) * 60, 0, 1) + 0.3 * tone(900 - 2600 * t, t) * env(t, 0.05, 0.03)
t = T(0.14); R["jump"] = 0.5 * tone(220 + 900 * t, t, "tri") * env(t, 0.002, 0.07)
t = T(0.08); R["land"] = lp(noise(len(t)), 0.3) * env(t, 0.001, 0.02) * 1.4
t = T(0.18); R["throw"] = hp(noise(len(t)), 0.9) * env(t, 0.02, 0.05) * 0.6
t = T(0.35); R["candle"] = 0.7 * hp(noise(len(t)), 0.6) * env(t, 0.001, 0.07) + 0.3 * tone(700, t) * env(t, 0.001, 0.04)
t = T(0.25); R["heart"] = cat(0.5 * tone(1320, T(0.06), "tri") * env(T(0.06), 0.002, 0.05), 0.5 * tone(1760, T(0.19), "tri") * env(T(0.19), 0.002, 0.09))
t = T(0.3); R["coin"] = cat(0.5 * tone(1568, T(0.07), "square") * 0.4, 0.5 * tone(2093, T(0.23), "square") * 0.4 * env(T(0.23), 0.001, 0.1))
R["power"] = cat(*[0.35 * tone(f, T(0.07), "square") * env(T(0.07), 0.002, 0.05) for f in (523, 659, 784, 1047, 1319, 1568)])
R["heal"] = cat(*[0.4 * tone(f, T(0.1), "tri") * env(T(0.1), 0.004, 0.08) for f in (392, 523, 659, 784, 1047)])
t = T(1.6); R["rosary"] = sum(0.25 * tone(f, t) * env(t, 0.002, 0.6) for f in (660, 990 * 1.02, 1650, 2210)) + 0.4 * lp(noise(len(t)), 0.05) * env(t, 0.005, 0.3)
R["oneup"] = cat(*[0.35 * tone(f, T(0.09), "square") * env(T(0.09), 0.002, 0.07) for f in (784, 988, 1175, 1568, 1976)])
t = T(1.2); R["orb"] = sum(0.25 * tone(f * (1 + 0.004 * np.sin(2 * np.pi * 6 * t)), t) * env(t, 0.02, 0.5) for f in (523, 784, 1047, 1568))
t = T(0.12); R["hit"] = 0.8 * hp(noise(len(t)), 0.5) * env(t, 0.001, 0.025) + 0.5 * tone(160 - 400 * t, t) * env(t, 0.001, 0.04)
t = T(0.4); R["kill"] = 0.7 * lp(noise(len(t)), 0.15) * env(t, 0.002, 0.12) + 0.4 * tone(300 - 500 * t, t, "square") * env(t, 0.002, 0.08)
t = T(0.35); R["hurt"] = 0.6 * tone(420 - 700 * t, t, "square") * env(t, 0.002, 0.12) + 0.3 * noise(len(t)) * env(t, 0.001, 0.05)
t = T(1.2); R["death"] = 0.5 * tone(330 * np.exp(-t * 1.4), t, "square") * env(t, 0.01, 0.6) + 0.3 * lp(noise(len(t)), 0.1) * env(t, 0.01, 0.3)
t = T(0.15); R["tink"] = 0.5 * tone(2400, t) * env(t, 0.001, 0.04) + 0.3 * tone(3700, t) * env(t, 0.001, 0.03)
t = T(0.5); R["crumble"] = lp(noise(len(t)), 0.12) * env(t, 0.004, 0.18) * (0.6 + 0.4 * (np.sin(t * 90) > 0))
t = T(0.6); R["splash"] = hp(noise(len(t)), 0.5) * env(t, 0.004, 0.18) * 0.7 + 0.2 * tone(300 + 400 * t, t) * env(t, 0.004, 0.1)
t = T(0.05); R["tick"] = 0.5 * tone(1800, t, "square") * env(t, 0.0005, 0.01)
t = T(0.8); R["freeze"] = sum(0.25 * tone(f * (1 - 0.3 * t), t) * env(t, 0.01, 0.35) for f in (1400, 2100, 2800))
t = T(0.5); R["flame"] = lp(noise(len(t)), 0.08) * env(t, 0.01, 0.2) * 1.2
t = T(0.25); R["spit"] = 0.6 * lp(noise(len(t)), 0.2) * env(t, 0.01, 0.07) + 0.3 * tone(200 + 300 * t, t) * env(t, 0.01, 0.06)
R["bones"] = cat(*[0.5 * hp(noise(int(0.03 * SR)), 0.3) * env(T(0.03), 0.0005, 0.008) for _ in range(5)] + [np.zeros(200)] * 5)
t = T(0.5); R["growl"] = 0.6 * tone(70 + 10 * np.sin(t * 40), t, "square") * env(t, 0.03, 0.2) * (0.6 + 0.4 * lp(noise(len(t)), 0.05))
t = T(0.3); R["caw"] = 0.5 * tone(900 - 500 * t + 60 * np.sin(t * 300), t, "square") * env(t, 0.01, 0.1)
t = T(0.7); R["screech"] = 0.5 * tone(1800 + 700 * np.sin(t * 14) - 900 * t, t, "square") * env(t, 0.02, 0.25) + 0.2 * noise(len(t)) * env(t, 0.01, 0.2)
t = T(0.2); R["bosshit"] = 0.8 * hp(noise(len(t)), 0.4) * env(t, 0.001, 0.04) + 0.6 * tone(110, t) * env(t, 0.001, 0.08)
t = T(2.0); R["bossdie"] = 0.8 * lp(noise(len(t)), 0.06) * env(t, 0.01, 0.8) + 0.4 * tone(90 * np.exp(-t), t) * env(t, 0.01, 0.9)
t = T(0.45); R["boom"] = 0.9 * lp(noise(len(t)), 0.08) * env(t, 0.002, 0.15) + 0.5 * tone(60, t) * env(t, 0.002, 0.2)
t = T(1.0); R["bossstart"] = 0.5 * tone(110 * (1 + 0.5 * t), t, "square") * env(t, 0.02, 0.5) + 0.3 * lp(noise(len(t)), 0.05) * env(t, 0.02, 0.5)
R["save"] = cat(*[0.35 * tone(f, T(0.08), "tri") * env(T(0.08), 0.003, 0.06) for f in (659, 880, 1319)])
R["pause"] = cat(0.35 * tone(988, T(0.06), "square") * env(T(0.06), 0.001, 0.05), 0.35 * tone(659, T(0.1), "square") * env(T(0.1), 0.001, 0.06))
t = T(0.04); R["cursor"] = 0.3 * tone(1320, t, "square") * env(t, 0.0005, 0.02)
t = T(0.12); R["select"] = cat(0.3 * tone(988, T(0.04), "square"), 0.3 * tone(1480, T(0.08), "square") * env(T(0.08), 0.001, 0.04))


def write(name, x):
    x = x / max(np.abs(x).max(), 1e-9) * 0.85
    fade = min(200, len(x) // 4)
    x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.clip(np.round(x * 32767), -32768, 32767).astype("<i2").tobytes())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for k, v in R.items():
        write(k, np.asarray(v, dtype=float))
    print(len(R), "sound effects written")


if __name__ == "__main__":
    main()
