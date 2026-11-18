"""Sound effects for Tidebell, synthesised from pulse waves, FM operators and noise
(the oscillator helpers are shared with the repo's Vale of Shards). No samples.

    python3 pipeline/audio/make_sfx.py

Writes content/sfx/<name>.wav for both builds: mono, 22050 Hz, 16-bit PCM,
peak-normalised to -3 dBFS, with short fades so nothing clicks. The names are the core's
sound events (pipeline/aseprite/manifest.py SFX); tests/verify_audio.py checks them.
"""
from __future__ import annotations

import os
import wave as wave_mod

import numpy as np

SR = 22050
PEAK_DBFS = -3.0
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTS = [os.path.join(ROOT, "godot", "content", "sfx"), os.path.join(ROOT, "web", "public", "content", "sfx")]
rng = np.random.default_rng(2031)

# --------------------------------------------------------------------------- building blocks


def ns(sec: float) -> int:
    return max(1, int(round(sec * SR)))


def tt(sec: float) -> np.ndarray:
    return np.arange(ns(sec)) / SR


def note(name: str) -> float:
    """'A4' / 'C#5' / 'Bb3' -> Hz."""
    pcs = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    pc = pcs[name[0]]
    rest = name[1:]
    if rest[0] in "#b":
        pc += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    midi = 12 * (int(rest) + 1) + pc
    return 440.0 * 2 ** ((midi - 69) / 12)


def glide(f0: float, f1: float, sec: float, curve: str = "exp") -> np.ndarray:
    n = ns(sec)
    if curve == "lin":
        return np.linspace(f0, f1, n)
    return np.geomspace(f0, f1, n)


def const(f: float, sec: float) -> np.ndarray:
    return np.full(ns(sec), float(f))


def _phase(freq: np.ndarray) -> np.ndarray:
    return 2 * np.pi * np.cumsum(freq) / SR


def _blep(ph: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """PolyBLEP residual that rounds off the step of a naive pulse (less aliasing)."""
    y = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] = x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] = x * x + x + x + 1
    return y


def pulse(freq: np.ndarray, duty=0.5) -> np.ndarray:
    """Band-limited pulse wave; freq and duty may be arrays."""
    dt = np.clip(freq / SR, 1e-6, 0.5)
    ph = np.cumsum(dt) % 1.0
    duty = np.broadcast_to(np.asarray(duty, dtype=float), ph.shape)
    y = np.where(ph < duty, 1.0, -1.0)
    y += _blep(ph, dt)
    y -= _blep((ph - duty) % 1.0, dt)
    return y - (2 * duty - 1)


def tri(freq: np.ndarray) -> np.ndarray:
    ph = np.cumsum(freq / SR) % 1.0
    return 4 * np.abs(ph - 0.5) - 1


def sine(freq: np.ndarray) -> np.ndarray:
    return np.sin(_phase(freq))


def fm(freq: np.ndarray, ratio: float, index: float, idecay: float = 1e9, ifloor: float = 0.0,
       fb: float = 0.0) -> np.ndarray:
    """Two-operator FM: a sine modulator (with a touch of self-feedback) into a sine carrier."""
    n = len(freq)
    t = np.arange(n) / SR
    ph = _phase(freq)
    mph = ph * ratio
    if fb:
        mph = mph + fb * np.sin(mph)
    idx = index * (ifloor + (1 - ifloor) * np.exp(-t / idecay))
    return np.sin(ph + idx * np.sin(mph))


def noise(sec: float) -> np.ndarray:
    return rng.uniform(-1, 1, ns(sec))


def lp(x: np.ndarray, cutoff) -> np.ndarray:
    """One-pole low-pass; cutoff in Hz, scalar or per-sample array."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x: np.ndarray, cutoff) -> np.ndarray:
    return x - lp(x, cutoff)


def bp(x: np.ndarray, lo, hi) -> np.ndarray:
    return lp(hp(x, lo), hi)


def dec(sec: float, tau: float) -> np.ndarray:
    return np.exp(-tt(sec) / tau)


def adsr(sec: float, a: float = 0.005, d: float = 0.1, s: float = 0.6, r: float = 0.05) -> np.ndarray:
    """Attack to 1, exponential decay towards s, then a linear release over the last r seconds."""
    t = tt(sec)
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    n = len(t)
    k = min(n, ns(r))
    e[n - k:] *= np.linspace(1, 0, k)
    return e


def fit(x: np.ndarray, n: int) -> np.ndarray:
    return x[:n] if len(x) >= n else np.concatenate([x, np.zeros(n - len(x))])


def at(x: np.ndarray, sec: float) -> np.ndarray:
    return np.concatenate([np.zeros(ns(sec)), x])


def mix(*parts: np.ndarray) -> np.ndarray:
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def cat(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts)


def tone_seq(notes, voice, gap: float = 0.0) -> np.ndarray:
    """notes: [(hz, seconds)]; voice(freq_array, seconds) -> samples."""
    out = []
    for f, sec in notes:
        out.append(voice(const(f, sec), sec))
        if gap:
            out.append(np.zeros(ns(gap)))
    return cat(*out)


def vib(f: np.ndarray, rate: float, depth: float) -> np.ndarray:
    t = np.arange(len(f)) / SR
    return f * (1 + depth * np.sin(2 * np.pi * rate * t))


def crackle(sec: float, density: float, tau: float) -> np.ndarray:
    """Sparse random clicks, fading out: debris, sparks."""
    n = ns(sec)
    x = np.zeros(n)
    hits = rng.random(n) < density / SR
    x[hits] = rng.uniform(-1, 1, hits.sum())
    return lp(x, 5000) * np.exp(-np.arange(n) / (tau * SR)) * 6


def blip(f: float, sec: float, duty: float = 0.25, tau: float | None = None) -> np.ndarray:
    e = dec(sec, tau) if tau else adsr(sec, 0.002, sec / 2, 0.5, sec * 0.4)
    return pulse(const(f, sec), duty) * e


def bell(f: float, sec: float, ratio: float = 3.5, index: float = 2.0, tau: float = 0.3) -> np.ndarray:
    return fm(const(f, sec), ratio, index, tau * 0.6, 0.1) * adsr(sec, 0.002, tau, 0.0, 0.02)


def flute(f0: float, f1: float, sec: float, amp: float = 1.0) -> np.ndarray:
    """Soft FM flute: near-sine with delayed vibrato, breath noise and a small portamento."""
    n = ns(sec)
    t = np.arange(n) / SR
    fr = f1 + (f0 - f1) * np.exp(-t / 0.018)
    fr = fr * (1 + 0.009 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.1) / 0.2, 0, 1))
    body = fm(fr, 1.0, 0.45, 0.08, 0.6) + 0.12 * np.sin(2 * _phase(fr))
    breath = lp(noise(sec), 2800) * (0.10 + 0.25 * np.exp(-t / 0.05))
    return (body + breath) * amp



# --------------------------------------------------------------------------- the sounds

SFX = {}


def sfx(fn):
    SFX[fn.__name__.rstrip("_")] = fn
    return fn


def swish(sec, f0, f1, amp=1.0):
    n = noise(sec)
    return bp(n, f0, f1) * adsr(sec, 0.01, sec * 0.5, 0.3, sec * 0.3) * amp


@sfx
def menu():
    return blip(note("E6"), 0.05, 0.25, 0.02)


@sfx
def select():
    return cat(blip(note("A5"), 0.05, 0.5, 0.03), mix(blip(note("E6"), 0.1, 0.25, 0.05), 0.3 * bell(note("E7"), 0.12)))


@sfx
def page():
    return mix(swish(0.08, 1800, 5000, 0.6), blip(note("C6"), 0.04, 0.5, 0.02) * 0.4)


@sfx
def jump():
    return pulse(glide(240, 620, 0.12), 0.25) * adsr(0.12, 0.003, 0.06, 0.5, 0.04)


@sfx
def land():
    return mix(lp(noise(0.08), 600) * dec(0.08, 0.02) * 1.6, sine(glide(120, 60, 0.07)) * dec(0.07, 0.03))


@sfx
def swing():
    return swish(0.14, 900, 3800)


@sfx
def spin():
    return cat(swish(0.1, 1200, 4200), swish(0.14, 700, 3000, 0.9))


@sfx
def cleave():
    return mix(swish(0.35, 500, 4000), 0.5 * sine(glide(300, 90, 0.35)) * dec(0.35, 0.15),
               0.35 * bell(note("A5"), 0.35, 2.0, 1.5, 0.2))


@sfx
def hit():
    return mix(lp(noise(0.08), 2500) * dec(0.08, 0.02) * 1.4, pulse(glide(300, 120, 0.08), 0.5) * dec(0.08, 0.03))


@sfx
def clink():
    return mix(bell(note("E7"), 0.18, 3.1, 1.5, 0.06), bell(note("B7"), 0.14, 2.3, 1.0, 0.05) * 0.6)


@sfx
def hurt():
    return pulse(glide(520, 180, 0.2), 0.5) * adsr(0.2, 0.002, 0.1, 0.5, 0.05)


@sfx
def die():
    f = glide(440, 70, 0.9)
    return pulse(vib(f, 9, 0.04), 0.25) * adsr(0.9, 0.005, 0.4, 0.6, 0.3)


@sfx
def coin():
    return cat(blip(note("B6"), 0.05, 0.5, 0.03), blip(note("E7"), 0.12, 0.5, 0.06))


@sfx
def item():
    return cat(*[blip(note(n), 0.06, 0.25, 0.04) for n in ("C6", "E6", "G6", "C7")])


@sfx
def use():
    return mix(fm(glide(300, 900, 0.25), 2.0, 3.0, 0.1) * adsr(0.25, 0.01, 0.1, 0.5, 0.1), swish(0.25, 2000, 6000, 0.3))


@sfx
def deny():
    return cat(blip(note("C4"), 0.07, 0.5, 0.05), blip(note("C4"), 0.1, 0.5, 0.07))


@sfx
def chest():
    return mix(lp(noise(0.25), 900) * dec(0.25, 0.08) * 1.5, sine(glide(160, 70, 0.2)) * dec(0.2, 0.06),
               cat(np.zeros(ns(0.08)), bell(note("G6"), 0.3) * 0.5))


@sfx
def post():
    return mix(bell(note("D6"), 0.6, 3.5, 1.5, 0.3), bell(note("A6"), 0.5, 3.5, 1.2, 0.25) * 0.6)


@sfx
def splash():
    return mix(bp(noise(0.45), 400, 3000) * dec(0.45, 0.15) * 1.2, sine(glide(300, 90, 0.3)) * dec(0.3, 0.1) * 0.6)


@sfx
def eswing():
    return swish(0.16, 500, 2400)


@sfx
def throw():
    return swish(0.12, 1500, 5000, 0.8)


@sfx
def break_():
    return mix(bp(noise(0.2), 2500, 8000) * dec(0.2, 0.05) * 1.5, crackle(0.2, 400, 0.05))


@sfx
def boom():
    return mix(lp(noise(0.6), 500) * dec(0.6, 0.2) * 2.0, sine(glide(90, 35, 0.5)) * dec(0.5, 0.2))


@sfx
def slam():
    return mix(lp(noise(0.4), 300) * dec(0.4, 0.12) * 2.0, sine(glide(70, 30, 0.35)) * dec(0.35, 0.15) * 1.2)


@sfx
def net():
    return mix(swish(0.2, 300, 1500), crackle(0.2, 200, 0.04) * 0.5)


@sfx
def screech():
    f = vib(glide(1800, 900, 0.5), 25, 0.06)
    return fm(f, 1.5, 4.0, 0.3) * adsr(0.5, 0.02, 0.2, 0.6, 0.15)


@sfx
def appear():
    return mix(fm(glide(200, 800, 0.35), 3.5, 2.0, 0.2) * adsr(0.35, 0.05, 0.1, 0.6, 0.1), swish(0.35, 3000, 7000, 0.3))


@sfx
def vanish():
    return mix(fm(glide(800, 200, 0.35), 3.5, 2.0, 0.2) * adsr(0.35, 0.01, 0.1, 0.6, 0.15), swish(0.35, 3000, 7000, 0.3))


@sfx
def cast():
    return cat(*[fm(const(note(n), 0.08), 2.0, 2.0, 0.05) * dec(0.08, 0.05) for n in ("E5", "B5", "E6")])


@sfx
def roar():
    f = vib(glide(110, 70, 1.1), 7, 0.08)
    return mix(fm(f, 0.5, 6.0, 0.6, 2.0) * adsr(1.1, 0.08, 0.4, 0.8, 0.3), lp(noise(1.1), 500) * adsr(1.1, 0.1, 0.5, 0.5, 0.3))


@sfx
def wave():
    return lp(noise(0.9), 900) * adsr(0.9, 0.3, 0.3, 0.7, 0.3) * 1.5


@sfx
def bell_():
    return mix(bell(note("D5"), 2.0, 3.5, 2.5, 0.9), bell(note("A5"), 1.8, 2.8, 1.5, 0.8) * 0.6,
               bell(note("D6"), 1.5, 3.5, 1.0, 0.6) * 0.4)


@sfx
def gate():
    return mix(lp(noise(0.5), 400) * dec(0.5, 0.2) * 1.4, pulse(glide(90, 60, 0.5), 0.5) * dec(0.5, 0.2) * 0.4,
               cat(np.zeros(ns(0.2)), bell(note("C5"), 0.4) * 0.4))


@sfx
def life():
    return cat(*[blip(note(n), 0.07, 0.25, 0.05) for n in ("G5", "C6", "E6", "G6", "C7")])


NAMES = ("jump land swing spin cleave hit clink hurt die coin item use deny chest post splash eswing throw break "
         "boom slam net screech appear vanish cast roar wave bell gate life select menu page").split()


def finish(x: np.ndarray) -> np.ndarray:
    """Remove DC, fade in 3 ms and out 8 ms, peak-normalise to PEAK_DBFS."""
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    fi, fo = min(len(x) // 4, ns(0.003)), min(len(x) // 4, ns(0.008))
    x[:fi] *= np.linspace(0, 1, fi)
    x[len(x) - fo:] *= np.linspace(1, 0, fo)
    peak = np.max(np.abs(x)) or 1.0
    return x / peak * 10 ** (PEAK_DBFS / 20)


def write(name: str, x: np.ndarray) -> None:
    pcm = np.round(finish(x) * 32767).astype("<i2")
    for out in OUTS:
        with wave_mod.open(os.path.join(out, name + ".wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())


def main() -> None:
    missing = set(NAMES) - set(SFX)
    extra = set(SFX) - set(NAMES)
    assert not missing and not extra, (missing, extra)
    for out in OUTS:
        os.makedirs(out, exist_ok=True)
    for name in NAMES:
        write(name, SFX[name]())
    print(f"wrote {len(NAMES)} sound effects")


if __name__ == "__main__":
    main()
