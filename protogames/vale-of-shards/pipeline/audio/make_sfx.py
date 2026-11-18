"""Sound effects for Vale of Shards, synthesised from pulse waves, FM operators and noise.
No samples; every sound is built here from oscillators and envelopes.

    python3 pipeline/audio/make_sfx.py

Writes godot/content/sfx/<name>.wav: mono, 22050 Hz, 16-bit PCM, peak-normalised to
-3 dBFS, with a short fade in and out so nothing clicks. tests/verify_audio.py checks every
name in NAMES.
"""
from __future__ import annotations

import os
import wave

import numpy as np

SR = 22050
PEAK_DBFS = -3.0
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "content", "sfx")
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


@sfx
def menu():
    return blip(note("D6"), 0.05, 0.25, 0.02)


@sfx
def select():
    return cat(blip(note("E6"), 0.045, 0.5, 0.03),
               mix(blip(note("B6"), 0.11, 0.25, 0.05), 0.3 * bell(note("B7"), 0.11)))


@sfx
def back():
    return cat(blip(note("B5"), 0.045, 0.25, 0.03), blip(note("E5"), 0.08, 0.5, 0.04))


@sfx
def pause():
    return cat(blip(note("A5"), 0.045, 0.5, 0.02), np.zeros(ns(0.03)), blip(note("A6"), 0.07, 0.5, 0.03))


@sfx
def jump():
    f = vib(glide(210, 700, 0.15), 30, 0.02)
    return pulse(f, 0.25) * adsr(0.15, 0.003, 0.08, 0.5, 0.04)


@sfx
def land():
    return mix(lp(noise(0.09), 700) * dec(0.09, 0.02) * 1.8,
               sine(glide(130, 55, 0.08)) * dec(0.08, 0.03))


@sfx
def bolt():
    f = glide(2300, 480, 0.17)
    zap = fm(f, 0.5, 5.0, 0.05, 0.2) * adsr(0.17, 0.002, 0.06, 0.3, 0.05)
    sub = pulse(f / 2, 0.125) * dec(0.17, 0.05) * 0.35
    return mix(zap, sub)


@sfx
def splash():
    sec = 0.42
    body = lp(noise(sec), glide(4200, 350, sec)) * adsr(sec, 0.004, 0.09, 0.2, 0.12) * 1.8
    bub = mix(*[at(sine(glide(f, f * 2.2, 0.045)) * dec(0.045, 0.015) * 0.35, d)
                for f, d in ((420, 0.06), (560, 0.13), (380, 0.21), (650, 0.27))])
    return mix(body, bub)


def brass_note(f: float, sec: float, amp=1.0, rel=0.05):
    t = tt(sec)
    fr = f * (1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.12) / 0.2, 0, 1))
    idx_env = 0.4 + 0.6 * np.clip(t / 0.04, 0, 1)
    ph = _phase(fr)
    sig = np.sin(ph + 2.2 * idx_env * np.sin(ph + 0.2 * np.sin(ph)))
    return sig * adsr(sec, 0.015, 0.3, 0.7, rel) * amp


@sfx
def level():
    # a short rising call, answered by a held chord
    run = [("A4", 0.09), ("D5", 0.09), ("F#5", 0.09), ("E5", 0.09)]
    lead = cat(*[brass_note(note(n), s, 0.8) for n, s in run], brass_note(note("A5"), 0.8, 1.0, 0.35))
    harm = at(mix(brass_note(note("F#5"), 0.8, 0.45, 0.35), brass_note(note("D5"), 0.8, 0.4, 0.35)), 0.36)
    sparkle = at(mix(*[at(bell(note(n), 0.35, tau=0.12) * 0.25, 0.07 * k)
                       for k, n in enumerate(["D7", "F#7", "A7", "D8"])]), 0.36)
    return mix(lead, harm, sparkle)


@sfx
def key():
    return mix(bell(note("B6"), 0.4, 3.5, 2.2, 0.15),
               at(bell(note("E7"), 0.34, 3.5, 2.0, 0.14), 0.06),
               hp(noise(0.05), 5000) * dec(0.05, 0.012) * 0.3)


@sfx
def error():
    buzz = lambda: mix(pulse(const(140, 0.08), 0.5), pulse(const(147, 0.08), 0.3) * 0.7) * adsr(0.08, 0.003, 0.05, 0.8, 0.01)
    return cat(buzz(), np.zeros(ns(0.04)), buzz())


@sfx
def bounce():
    f = fit(cat(glide(170, 520, 0.07), vib(glide(520, 300, 0.18), 18, 0.06)), ns(0.25))
    return tri(f) * adsr(0.25, 0.003, 0.15, 0.3, 0.05)


@sfx
def kill1():  # mechanical: crunch, clank and a falling bleep
    sec = 0.4
    clank = fm(const(310, sec), 1.414, 5.0, 0.05, 0.1) * dec(sec, 0.09)
    ring = mix(*[sine(const(f, sec)) * dec(sec, 0.14) * 0.25 for f in (1130, 1690, 2410)])
    crunch = bp(noise(0.12), 900, 5000) * dec(0.12, 0.03) * 1.5
    bleep = pulse(glide(900, 180, 0.2), 0.25) * dec(0.2, 0.08) * 0.4
    return mix(clank, ring, crunch, bleep)


@sfx
def kill2():  # creature: a pop and a squeaky fall
    fall = pulse(glide(720, 110, 0.24), 0.3) * adsr(0.24, 0.002, 0.12, 0.3, 0.05) * 0.7
    puff = lp(noise(0.18), 1500) * dec(0.18, 0.05)
    pop = sine(glide(1200, 300, 0.03)) * dec(0.03, 0.01)
    return mix(pop, at(fall, 0.02), puff)


@sfx
def kill3():  # big: an explosion with a low boom and debris
    sec = 0.62
    body = lp(noise(sec), glide(5000, 180, sec)) * adsr(sec, 0.003, 0.18, 0.0, 0.1) * 2.2
    boom = sine(glide(95, 32, sec)) * dec(sec, 0.22) * 0.9
    return mix(body, boom, at(crackle(0.5, 60, 0.18) * 0.5, 0.05))


@sfx
def bonus():
    return cat(bell(note("E6"), 0.05, 2.0, 1.2, 0.05) * 0.8, bell(note("A6"), 0.16, 2.0, 1.2, 0.08))


@sfx
def bonus2():
    run = ["G5", "B5", "D6", "E6", "G6", "B6", "D7", "E7"]
    notes = cat(*[blip(note(n), 0.035, 0.25, 0.03) for n in run])
    return mix(notes, at(bell(note("G7"), 0.28, 3.0, 1.5, 0.1) * 0.6, len(run) * 0.035))


@sfx
def toadland():
    plop = fm(glide(240, 105, 0.13), 1.0, 3.0, 0.03, 0.1) * adsr(0.13, 0.002, 0.06, 0.2, 0.03)
    return mix(plop, lp(noise(0.05), 500) * dec(0.05, 0.015))


@sfx
def ouch():
    f = vib(glide(640, 240, 0.24), 32, 0.08)
    return mix(pulse(f, 0.5) * adsr(0.24, 0.002, 0.1, 0.5, 0.05) * 0.8,
               bp(noise(0.05), 800, 4000) * dec(0.05, 0.015))


def click():
    return hp(noise(0.012), 3000) * dec(0.012, 0.003)


@sfx
def switch_on():
    return mix(click(), at(cat(blip(440, 0.04, 0.5, 0.03), blip(880, 0.07, 0.5, 0.04)), 0.012))


@sfx
def switch_off():
    return mix(click(), at(cat(blip(880, 0.04, 0.5, 0.03), blip(440, 0.07, 0.5, 0.04)), 0.012))


@sfx
def stonebounce():
    return mix(fm(const(760, 0.09), 2.1, 2.0, 0.01, 0.0) * dec(0.09, 0.018),
               lp(noise(0.03), 2500) * dec(0.03, 0.006) * 0.8)


@sfx
def die():
    # a chromatic tumble downward, then a soft low thud
    steps = [note(n) for n in ["E5", "D#5", "D5", "C#5", "C5", "B4", "A#4", "A4", "G#4", "G4", "F#4", "F4"]]
    tumble = cat(*[pulse(vib(const(f, 0.075), 12, 0.02), 0.5) * adsr(0.075, 0.003, 0.05, 0.6, 0.01) for f in steps])
    tumble *= np.linspace(1.0, 0.6, len(tumble))
    low = pulse(vib(glide(180, 60, 0.35), 8, 0.03), 0.25) * adsr(0.35, 0.005, 0.2, 0.3, 0.12) * 0.7
    return cat(tumble, low)


@sfx
def hit1():
    return mix(pulse(glide(1500, 950, 0.06), 0.25) * dec(0.06, 0.025) * 0.8,
               hp(noise(0.02), 3000) * dec(0.02, 0.006) * 0.6)


@sfx
def hit2():
    return mix(pulse(glide(900, 480, 0.09), 0.5) * dec(0.09, 0.035) * 0.8,
               bp(noise(0.04), 800, 4000) * dec(0.04, 0.012))


@sfx
def hit3():
    return mix(fm(glide(320, 170, 0.14), 1.0, 4.0, 0.04, 0.2) * dec(0.14, 0.05),
               lp(noise(0.08), 1500) * dec(0.08, 0.02) * 1.2)


@sfx
def hit4():
    sec = 0.24
    clank = fm(const(150, sec), 1.414, 6.0, 0.03, 0.1) * dec(sec, 0.07)
    thump = sine(glide(90, 45, sec)) * dec(sec, 0.09)
    growl = pulse(vib(const(75, sec), 28, 0.05), 0.3) * adsr(sec, 0.005, 0.1, 0.3, 0.05) * 0.35
    return mix(clank, thump, growl, lp(noise(0.1), 900) * dec(0.1, 0.03))


@sfx
def spring():
    sec = 0.4
    t = tt(sec)
    f = glide(260, 480, sec) * (1 + 0.35 * np.exp(-t / 0.12) * np.sin(2 * np.pi * 24 * t))
    return fm(f, 1.0, 1.2, 0.1, 0.2) * adsr(sec, 0.002, 0.2, 0.2, 0.08)


@sfx
def snap():
    clack = lambda f: mix(hp(noise(0.02), 2500) * dec(0.02, 0.004), fm(const(f, 0.025), 3.3, 3, 0.005) * dec(0.025, 0.006))
    return cat(clack(1300), np.zeros(ns(0.045)), clack(1050), np.zeros(ns(0.03)))


@sfx
def token():
    run = cat(*[blip(note(n), 0.04, 0.25, 0.03) for n in ["A5", "C#6", "E6"]])
    return mix(run, at(bell(note("E7"), 0.14, 3.5, 1.8, 0.07) * 0.7, 0.12))


@sfx
def enemyfire():
    return mix(pulse(glide(1050, 330, 0.13), 0.5) * adsr(0.13, 0.002, 0.06, 0.3, 0.03) * 0.8,
               hp(noise(0.03), 2500) * dec(0.03, 0.01) * 0.5)


@sfx
def dronefire():
    f = glide(1700, 880, 0.16)
    return mix(fm(f, 3.5, 3.0, 0.04, 0.2), fm(f * 1.007, 3.5, 2.0, 0.04, 0.2) * 0.6) * adsr(0.16, 0.002, 0.07, 0.2, 0.04)


@sfx
def firebreath():
    sec = 0.42
    cut = np.concatenate([glide(500, 2800, sec * 0.35), glide(2800, 700, sec - ns(sec * 0.35) / SR)])
    roar = bp(noise(sec), 250, fit(cut, ns(sec))) * adsr(sec, 0.05, 0.2, 0.4, 0.12) * 2.5
    rumble = sine(const(62, sec)) * (0.6 + 0.4 * lp(noise(sec), 30) * 8) * adsr(sec, 0.04, 0.2, 0.4, 0.12) * 0.25
    return mix(roar, rumble)


@sfx
def grunt():
    sec = 0.22
    t = tt(sec)
    f = 95 + 40 * np.sin(np.pi * t / sec) + 10 * np.sin(2 * np.pi * 7 * t)
    g = fm(f, 1.0, 3.0, 1.0, 1.0, fb=0.3) * (1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * 31 * t)))
    return mix(g * adsr(sec, 0.01, 0.1, 0.6, 0.05), lp(noise(sec), 600) * adsr(sec, 0.01, 0.08, 0.3, 0.05) * 0.5)


@sfx
def torpedo():
    sec = 0.42
    t = tt(sec)
    whoosh = lp(noise(sec), glide(600, 2400, sec)) * adsr(sec, 0.03, 0.2, 0.3, 0.1) * 1.5
    f = 320 + 160 * np.sin(2 * np.pi * 26 * t) * np.exp(-t / 0.2)
    bubbles = sine(f) * adsr(sec, 0.005, 0.15, 0.2, 0.1) * 0.5
    return mix(whoosh, bubbles)


@sfx
def hitwall():
    return mix(crackle(0.06, 400, 0.02) * 0.8, pulse(glide(2100, 1200, 0.035), 0.25) * dec(0.035, 0.012) * 0.6)


@sfx
def toaddie():
    croak = lambda f0, f1, sec: pulse(glide(f0, f1, sec), 0.12) * (0.6 + 0.4 * np.sin(2 * np.pi * 38 * tt(sec))) * adsr(sec, 0.004, 0.06, 0.5, 0.03)
    return cat(croak(200, 150, 0.1), np.zeros(ns(0.03)), croak(170, 80, 0.2))


@sfx
def gate():
    sec = 1.4
    rumble = lp(noise(sec), 160) * adsr(sec, 0.12, 0.6, 0.5, 0.35) * 4.0
    t = tt(sec)
    swell = np.clip(t / 0.7, 0, 1)
    chord = mix(*[fm(const(note(n), sec), 1.0, 0.8, 0.5, 0.4) * 0.2 for n in ("D4", "A4", "D5", "F#5")])
    chord *= swell * adsr(sec, 0.01, 2.0, 0.9, 0.35)
    chime = at(mix(bell(note("A6"), 0.4, tau=0.15) * 0.4, at(bell(note("D7"), 0.35, tau=0.15) * 0.35, 0.06)), 0.95)
    return mix(rumble, chord, chime)


@sfx
def spider():
    out = np.zeros(ns(0.26))
    pos = 0.0
    while pos < 0.22:
        c = mix(hp(noise(0.006), 4000) * dec(0.006, 0.0015), pulse(const(2800 + 800 * rng.random(), 0.008), 0.5) * dec(0.008, 0.002) * 0.4)
        i = ns(pos)
        out[i:i + len(c)] += c[:len(out) - i]
        pos += 0.018 + 0.017 * rng.random()
    return out


@sfx
def crash():
    sec = 0.5
    crunch = lp(noise(sec), glide(3500, 400, sec)) * adsr(sec, 0.002, 0.08, 0.1, 0.1) * 2.0
    thump = sine(glide(120, 50, 0.2)) * dec(0.2, 0.06) * 0.8
    return mix(crunch, thump, at(crackle(0.4, 45, 0.15) * 0.6, 0.08))


@sfx
def heart():
    notes = cat(*[fm(const(note(n), 0.075), 1.0, 1.0, 0.05, 0.3) * adsr(0.075, 0.003, 0.05, 0.6, 0.01) * 0.8 for n in ("F5", "A5")])
    last = fm(const(note("C6"), 0.28), 1.0, 1.0, 0.1, 0.3) * adsr(0.28, 0.003, 0.15, 0.3, 0.1)
    return mix(cat(notes, last), at(bell(note("F7"), 0.25, tau=0.1) * 0.3, 0.15))


@sfx
def berry():
    return mix(sine(glide(380, 950, 0.035)) * dec(0.035, 0.012), at(blip(note("B6"), 0.065, 0.25, 0.03), 0.04))


@sfx
def shard():
    return mix(bell(note("E7"), 0.26, 3.5, 2.0, 0.1), bell(note("B7") * 1.003, 0.22, 3.5, 1.5, 0.08) * 0.5)


@sfx
def fishdie():
    out = []
    for k, f in enumerate((900, 740, 600, 470, 340)):
        out.append(sine(glide(f, f * 1.5, 0.05)) * dec(0.05, 0.018) * (1 - 0.12 * k))
        out.append(np.zeros(ns(0.015)))
    return cat(*out)


@sfx
def sigil():
    # the game's motif (3-2-3-5-8 of D major) on a flute, with a soft echo
    seq = [("F#5", 0.16), ("E5", 0.12), ("F#5", 0.12), ("A5", 0.2), ("D6", 0.62)]
    parts, prev = [], note("D5")
    for i, (n, sec) in enumerate(seq):
        f = note(n)
        body = flute(prev, f, sec) * adsr(sec, 0.02, 0.4, 0.85, 0.03 if i < len(seq) - 1 else 0.3)
        parts.append(body)
        prev = f
    line = cat(*parts)
    echo = at(line * 0.3, 0.18)
    return mix(line, echo, at(bell(note("D7"), 0.5, 2.0, 1.0, 0.25) * 0.2, 0.6))


@sfx
def spikes():
    return mix(fm(const(610, 0.2), 2.76, 4.0, 0.03, 0.1) * dec(0.2, 0.05),
               hp(noise(0.08), 3500) * dec(0.08, 0.02) * 0.8)


@sfx
def masher():
    sec = 0.36
    return mix(sine(glide(95, 38, sec)) * dec(sec, 0.1),
               lp(noise(0.2), 450) * dec(0.2, 0.05) * 1.5,
               fm(const(200, 0.15), 1.414, 5.0, 0.02, 0.1) * dec(0.15, 0.035) * 0.5)


@sfx
def slick():
    sec = 0.2
    squelch = lp(noise(sec), glide(300, 2200, sec)) * adsr(sec, 0.01, 0.08, 0.4, 0.05) * 2.0
    t = tt(sec)
    wob = sine(glide(180, 620, sec) * (1 + 0.15 * np.sin(2 * np.pi * 30 * t))) * adsr(sec, 0.01, 0.1, 0.3, 0.05) * 0.5
    return mix(squelch, wob)


@sfx
def sting():
    sec = 0.4
    t = tt(sec)
    f = 225 * (1 + 0.06 * np.sin(2 * np.pi * 37 * t) + 0.03 * np.sin(2 * np.pi * 3 * t))
    buzz = pulse(f, 0.3) * (1 - 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 19 * t)))
    return lp(buzz, 2500) * adsr(sec, 0.04, 0.2, 0.6, 0.1)


@sfx
def door():
    sec = 0.55
    t = tt(sec)
    grind = lp(noise(sec), 350) * (0.6 + 0.4 * np.sin(2 * np.pi * 13 * t)) * adsr(sec, 0.03, 0.3, 0.6, 0.1) * 3.0
    clunk = at(mix(fm(const(147, 0.15), 1.0, 2.5, 0.03, 0.1) * dec(0.15, 0.05),
                   lp(noise(0.06), 800) * dec(0.06, 0.015)), 0.38)
    return mix(grind, clunk)


@sfx
def rockland():
    sec = 0.36
    return mix(sine(glide(75, 34, sec)) * dec(sec, 0.12) * 1.1,
               lp(noise(0.2), 260) * dec(0.2, 0.06) * 2.0,
               at(crackle(0.2, 50, 0.08) * 0.3, 0.03))


@sfx
def lift():
    sec = 0.6
    t = tt(sec)
    hum = lp(pulse(const(100, sec), 0.4), 700) * 0.8 + sine(const(50, sec)) * 0.5
    ripple = 1 - 0.2 * (0.5 + 0.5 * np.sin(2 * np.pi * 8 * t))
    return hum * ripple * adsr(sec, 0.08, 1.0, 1.0, 0.15)


@sfx
def warp():
    sec = 0.6
    t = tt(sec)
    half = ns(0.32)
    f = np.concatenate([glide(300, 2400, half / SR), glide(2400, 600, sec - half / SR)])
    f = fit(f, ns(sec)) * (1 + 0.03 * np.sin(2 * np.pi * 20 * t))
    body = fm(f, 2.0, 3.0, 0.2, 0.4) * adsr(sec, 0.03, 0.4, 0.5, 0.12)
    shimmer = mix(*[at(bell(note(n), 0.25, tau=0.08) * 0.25, d) for n, d in (("E7", 0.1), ("B7", 0.2), ("E8", 0.3))])
    return mix(body, shimmer)


NAMES = ("menu select back jump land bolt splash level key error bounce kill1 kill2 kill3 bonus bonus2 "
         "toadland ouch switch_on switch_off stonebounce die hit1 hit2 hit3 hit4 spring snap token "
         "enemyfire dronefire firebreath grunt torpedo hitwall toaddie gate spider crash heart berry shard "
         "fishdie sigil spikes masher slick sting door rockland lift warp pause").split()


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
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    missing = set(NAMES) - set(SFX)
    extra = set(SFX) - set(NAMES)
    assert not missing and not extra, (missing, extra)
    os.makedirs(OUT, exist_ok=True)
    for name in NAMES:
        x = SFX[name]()
        write(name, x)
    print(f"wrote {len(NAMES)} sound effects to {OUT}")


if __name__ == "__main__":
    main()
