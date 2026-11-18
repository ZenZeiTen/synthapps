"""Hyper Bluff!! Starlight Showdown sound effects, synthesised from scratch.

    python3 tools/audio/sfx.py              (from hyper-bluff/)

Writes godot/assets/audio/<name>.wav: mono, 16-bit, 22050 Hz, peak about -3 dBFS, with a
short fade at both ends so nothing clicks. Each effect has its own fixed random seed, so
every run writes the same bytes.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import synth as S  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot" / "assets" / "audio"
SR = 22050
TAU = S.TAU


def buf(secs):
    return np.zeros(int(secs * SR))


def put(dst, sig, t, gain=1.0):
    i = int(t * SR)
    m = min(len(sig), len(dst) - i)
    if m > 0:
        dst[i:i + m] += gain * sig[:m]


def tsec(n):
    return np.arange(n) / SR


def tone(kind, f, secs, tau, duty=0.25):
    """Short decaying chip tone. f may be a scalar or an array of int(secs*SR) values."""
    n = int(secs * SR)
    if kind == "pulse":
        x = S.pulse(f, n, SR, duty)
    elif kind == "sine":
        x = S.sine(f, n, SR)
    else:
        x = S.osc(kind, f, n, SR)
    return x * S.perc(secs, SR, tau, a=0.002, fade=0.008)


def glide(f0, f1, secs):
    n = int(secs * SR)
    return f0 * (f1 / f0) ** (np.arange(n) / max(1, n - 1))


def swish(rng, f0, f1, secs, width, shape=1.0):
    """Swept band of noise with a smooth rise and fall."""
    n = int(secs * SR)
    x = S.band_noise(rng, n, SR, glide(f0, f1, secs), width)
    env = np.sin(np.pi * (np.arange(n) / n) ** shape) ** 1.5
    return x * env


def chip(rng, base):
    """One clay poker chip landing on another: a click and a few inharmonic partials."""
    n = int(0.09 * SR)
    t = tsec(n)
    x = np.zeros(n)
    for ratio, amp, tau in ((1.0, 1.0, 0.016), (1.47, 0.6, 0.011), (2.09, 0.45, 0.008), (2.83, 0.3, 0.006)):
        if base * ratio < 9500:
            x += amp * np.sin(TAU * base * ratio * t + rng.uniform(0, TAU)) * np.exp(-t / tau)
    x += 0.7 * S.filt(rng.standard_normal(n), SR, lo=2500) * np.exp(-t / 0.0025)
    return x * S.perc(0.09, SR, 10.0, a=0.0004, fade=0.01)


def thump(rng, f0, f1, secs, tau, noise=0.3):
    n = int(secs * SR)
    t = tsec(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    x = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / tau)
    x += noise * S.filt(rng.standard_normal(n), SR, hi=2500) * np.exp(-t / 0.012)
    return np.tanh(1.5 * x)


# ------------------------------------------------------------------ the effects
def card_deal(rng):
    x = buf(0.2)
    put(x, swish(rng, 2200, 5200, 0.17, 1800, shape=0.6), 0.0)
    put(x, tone("sine", 260, 0.05, 0.012), 0.13, 0.35)
    return x


def card_flip(rng):
    x = buf(0.24)
    put(x, swish(rng, 1500, 4000, 0.09, 1500), 0.0, 0.6)
    n = int(0.08 * SR)
    snap = S.filt(rng.standard_normal(n), SR, lo=1800, hi=8000) * np.exp(-tsec(n) / 0.012)
    put(x, snap / np.abs(snap).max(), 0.10)
    put(x, tone("sine", 420, 0.05, 0.01), 0.10, 0.4)
    return x


def chip_bet(rng):
    x = buf(0.24)
    put(x, chip(rng, 2900), 0.0)
    put(x, chip(rng, 3350), 0.075, 0.85)
    return x


def chip_win(rng):
    x = buf(1.2)
    times = np.sort(rng.uniform(0.0, 1.0, 22) ** 1.4) * 1.02
    for i, t in enumerate(times):
        put(x, chip(rng, rng.uniform(2500, 3900)), t, rng.uniform(0.55, 1.0) * (1.0 - 0.35 * t))
    put(x, chip(rng, 2700), 1.06, 0.8)
    return x


def move(rng):
    return tone("pulse", glide(940, 1040, 0.05), 0.05, 0.018)


def ok(rng):
    x = buf(0.2)
    put(x, tone("pulse", 1318.5, 0.07, 0.03), 0.0)
    put(x, tone("pulse", 1760.0, 0.13, 0.05), 0.065)
    return x


def cancel(rng):
    x = buf(0.2)
    put(x, tone("pulse", 880.0, 0.07, 0.03), 0.0)
    put(x, tone("pulse", 587.3, 0.13, 0.05), 0.065)
    return x


def fold(rng):
    x = buf(0.42)
    put(x, swish(rng, 3200, 450, 0.4, 900, shape=0.7), 0.0)
    return S.filt(x, SR, hi=4500)


def check(rng):
    x = buf(0.34)
    for t, g in ((0.0, 1.0), (0.14, 0.85)):
        put(x, thump(rng, 210, 120, 0.16, 0.03, noise=0.5), t, g)
        put(x, tone("sine", 760, 0.04, 0.006), t, 0.35 * g)
    return x


def allin(rng):
    x = buf(1.42)
    put(x, thump(rng, 170, 42, 0.5, 0.16, noise=0.6), 0.0, 1.0)
    n = int(1.1 * SR)
    f = glide(110, 1320, 1.1)
    rise = (np.arange(n) / n) ** 1.6
    sweep = (S.osc("saw", f, n, SR) + 0.6 * S.osc("saw", f * 1.5, n, SR)) * rise
    put(x, sweep, 0.05, 0.5)
    put(x, S.band_noise(rng, n, SR, glide(500, 7000, 1.1), 1500) * rise, 0.05, 0.5)
    n2 = int(0.26 * SR)
    t2 = tsec(n2)
    hit = S.filt(rng.standard_normal(n2), SR, lo=300, hi=9000) * np.exp(-t2 / 0.05)
    for fq in (220.0, 277.2, 329.6, 440.0):
        hit += 0.5 * S.osc("saw", fq, n2, SR) * np.exp(-t2 / 0.07)
    put(x, hit, 1.15, 0.7)
    put(x, thump(rng, 200, 50, 0.26, 0.09), 1.15, 0.9)
    return x


def powerup(rng):
    x = buf(0.9)
    scale = [0, 2, 4, 7, 9]
    notes = [69 + 12 * (i // 5) + scale[i % 5] for i in range(14)]
    for i, m in enumerate(notes):
        put(x, tone("pulse", S.hz(m), 0.11, 0.05), i * 0.045, 0.6 + 0.03 * i)
    n = int(0.8 * SR)
    f = glide(500, 3200, 0.8) * (1.0 + 0.02 * np.sin(TAU * 11.0 * tsec(n)))
    shimmer = S.sine(f, n, SR) * np.sin(np.pi * np.arange(n) / n) * (0.6 + 0.4 * np.sin(TAU * 17.0 * tsec(n)))
    put(x, shimmer, 0.05, 0.45)
    return x


def cutin(rng):
    x = buf(0.66)
    n = int(0.28 * SR)
    whoosh = S.band_noise(rng, n, SR, glide(350, 6500, 0.28), 1400) * (np.arange(n) / n) ** 2
    put(x, whoosh, 0.0, 0.8)
    put(x, thump(rng, 220, 55, 0.36, 0.1, noise=0.8), 0.28)
    n2 = int(0.34 * SR)
    stab = (S.osc("saw", 110.0, n2, SR) + S.osc("saw", 165.4, n2, SR) + S.osc("saw", 220.6, n2, SR)) * np.exp(-tsec(n2) / 0.08)
    put(x, stab, 0.28, 0.35)
    return x


def star(rng):
    x = buf(0.55)
    for i, m in enumerate((88, 95, 100, 104, 107)):
        f = S.hz(m)
        n = int(0.3 * SR)
        t = tsec(n)
        ping = (np.sin(TAU * f * t) + 0.3 * np.sin(TAU * 2 * f * t)) * np.exp(-t / 0.07)
        put(x, ping * S.perc(0.3, SR, 10.0, a=0.001, fade=0.02), i * 0.05, 1.0 - 0.1 * i)
    return x


def fever(rng):
    x = buf(1.48)
    for i, m in enumerate((72, 76, 79, 84, 79, 84, 88)):
        put(x, tone("pulse", S.hz(m), 0.12, 0.06, duty=0.5), i * 0.07, 0.8)
    n = int(1.0 * SR)
    t = tsec(n)
    f = 880.0 * 2.0 ** (0.35 * np.sin(TAU * 5.0 * t))
    env = np.minimum(1.0, t / 0.05) * np.minimum(1.0, (1.0 - t) / 0.3)
    put(x, S.pulse(f, n, SR, 0.3) * env, 0.48, 0.55)
    put(x, S.pulse(f * 1.5, n, SR, 0.5) * env, 0.48, 0.25)
    return x


def win_hand(rng):
    x = buf(0.62)
    for i, m in enumerate((72, 76, 79)):
        put(x, tone("pulse", S.hz(m), 0.09, 0.04), i * 0.06)
    for m, g in ((84, 1.0), (88, 0.6), (91, 0.5)):
        put(x, tone("pulse", S.hz(m), 0.42, 0.14), 0.18, g)
    return x


def lose_hand(rng):
    x = buf(0.72)
    for i, m in enumerate((67, 63)):
        put(x, tone("pulse", S.hz(m), 0.16, 0.09, duty=0.5), i * 0.15, 0.9)
    put(x, tone("pulse", glide(S.hz(60), S.hz(58.6), 0.4), 0.4, 0.16, duty=0.5), 0.30)
    put(x, tone("tri", S.hz(48), 0.4, 0.16), 0.30, 0.7)
    return S.filt(x, SR, hi=3500)


def meter_tick(rng):
    return tone("pulse", 1568.0, 0.03, 0.009, duty=0.5)


def roulette_tick(rng):
    x = buf(0.04)
    n = len(x)
    t = tsec(n)
    x += np.sin(TAU * 2300.0 * t) * np.exp(-t / 0.004)
    x += 0.8 * S.filt(rng.standard_normal(n), SR, lo=3000) * np.exp(-t / 0.002)
    return x


def error(rng):
    x = buf(0.32)
    for t in (0.0, 0.16):
        n = int(0.13 * SR)
        z = (S.osc("square", 98.0, n, SR) + S.osc("square", 104.5, n, SR)) * S.perc(0.13, SR, 0.3, a=0.004, fade=0.02)
        put(x, z, t)
    return S.filt(x, SR, hi=2600)


def type_blip(rng):
    return tone("pulse", 1975.5, 0.028, 0.008)


SFX = [
    ("card_deal", card_deal), ("card_flip", card_flip), ("chip_bet", chip_bet), ("chip_win", chip_win),
    ("move", move), ("ok", ok), ("cancel", cancel), ("fold", fold), ("check", check), ("allin", allin),
    ("powerup", powerup), ("cutin", cutin), ("star", star), ("fever", fever), ("win_hand", win_hand),
    ("lose_hand", lose_hand), ("meter_tick", meter_tick), ("roulette_tick", roulette_tick),
    ("error", error), ("type", type_blip),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (name, fn) in enumerate(SFX):
        x = S.finish_sfx(fn(np.random.default_rng(1000 + i)), SR)
        path = OUT / (name + ".wav")
        S.write_wav(path, x, SR)
        print("%-18s %5.3f s  peak %5.1f dBFS  %6d bytes" % (
            path.name, len(x) / SR, 20 * np.log10(np.abs(x).max()), path.stat().st_size))


if __name__ == "__main__":
    main()
