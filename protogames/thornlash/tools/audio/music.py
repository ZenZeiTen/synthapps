"""Thornlash soundtrack: twelve original compositions, each rendered twice.

    python tools/audio/music.py

  <track>_16.wav  "16-bit" arrangement: additive brass/strings/organ/choir, FM harpsichord,
                  bell and bass, synthesised drums and a SNES-style echo. 16-bit mono 32 kHz.
  <track>_8.wav   "8-bit" arrangement of the same notes: pulse lead, pulse arpeggios,
                  stepped triangle bass, noise drums. 8-bit mono 22.05 kHz.

Every track is written as a chord per bar plus a hand-written melody; bass, pads,
arpeggios and drums are generated from the chords by the track's style. Melodies are
plain text: NOTE:DUR tokens (C#5:2, Bb4:1, r:2 for a rest), '|' separates bars, and each
bar must fill exactly the track's bar length (checked). Each loop is rendered twice and
the second pass kept, so tails ring across the seam.
"""
import json
import os
import re
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot" / "content" / "audio" / "music"

# ==================================================================== the music (all original)
TRACKS = {
    "title": dict(name="Vigil of Hollowmoor", bpm=180, bar=6, style="chorale", lead="flute", key="Dm",
        chords="Dm Dm Bb C Dm Gm A A F C Dm Bb Gm A Dm Dm",
        melody="""A4:3 D5:2 E5:1 | F5:4 E5:1 D5:1 | D5:3 F5:2 D5:1 | E5:4 C5:2 |
                  A4:2 D5:1 F5:2 A5:1 | G5:3 F5:1 E5:1 D5:1 | E5:3 C#5:3 | A4:6 |
                  C5:2 F5:1 A5:3 | G5:2 E5:1 C5:3 | D5:2 F5:1 A5:2 D6:1 | C6:2 Bb5:1 A5:2 F5:1 |
                  G5:3 Bb5:3 | A5:2 G5:1 E5:2 C#5:1 | D5:6 | r:6"""),
    "stage1": dict(name="Thorn and Lantern", bpm=300, bar=8, style="drive", lead="brass",
        chords="Am Am F G Am Am Dm E F G Am Am Dm E Am E",
        melody="""E5:2 A4:1 C5:1 E5:2 D5:1 C5:1 | B4:2 C5:1 D5:1 E5:3 r:1 | F5:2 E5:1 D5:1 C5:2 A4:2 |
                  B4:2 D5:1 G5:1 G5:3 F5:1 | E5:2 A5:1 G5:1 E5:2 C5:1 E5:1 | D5:1 C5:1 B4:1 C5:1 A4:4 |
                  D5:2 F5:1 A5:1 G5:2 F5:1 D5:1 | E5:3 G#4:1 B4:2 E5:2 | C6:2 A5:1 F5:1 C5:2 F5:2 |
                  B5:2 G5:1 D5:1 B4:2 G5:2 | A5:3 E5:1 C5:2 E5:2 | A5:1 G5:1 E5:1 D5:1 C5:2 B4:2 |
                  A4:1 D5:1 F5:1 A5:1 D6:2 C6:1 A5:1 | G#5:2 B5:1 G#5:1 E5:2 D5:2 |
                  C5:1 E5:1 A5:1 E5:1 C5:1 E5:1 A4:2 | B4:2 E5:1 G#5:1 B5:3 r:1"""),
    "stage2": dict(name="Procession of Bones", bpm=264, bar=8, style="march", lead="strings_lead",
        chords="Em Em C D Em Em Am B C D Em Em Am B Em B",
        melody="""E5:3 D5:1 B4:2 G4:2 | A4:1 B4:1 G4:1 E4:1 B4:4 | C5:2 E5:2 G5:3 E5:1 | F#5:2 D5:2 A4:4 |
                  B4:1 E5:1 G5:2 F#5:1 E5:1 D5:2 | E5:2 B4:2 G4:2 B4:2 | C5:2 A4:1 C5:1 E5:3 D5:1 |
                  D#5:4 B4:2 F#4:2 | G5:2 E5:1 G5:1 C6:3 B5:1 | A5:2 F#5:1 A5:1 D6:3 C6:1 |
                  B5:2 G5:2 E5:2 G5:2 | F#5:1 G5:1 F#5:1 E5:1 D5:2 B4:2 | A4:1 C5:1 E5:1 A5:1 G5:2 E5:2 |
                  F#5:2 D#5:2 B4:2 F#5:2 | E5:3 B4:1 G4:2 E4:2 | D#4:2 F#4:2 B4:4"""),
    "stage3": dict(name="The Drowned Stair", bpm=276, bar=6, style="waltz", lead="flute",
        chords="Cm Cm Ab Bb Cm Fm G G Ab Bb Eb Cm Fm G Cm Cm",
        melody="""G4:2 C5:1 Eb5:2 D5:1 | C5:3 G4:3 | Ab4:2 C5:1 Eb5:2 F5:1 | D5:3 Bb4:3 |
                  G5:2 F5:1 Eb5:2 D5:1 | C5:2 Ab4:1 F4:3 | B4:2 D5:1 F5:2 D5:1 | G5:6 |
                  Eb5:2 Ab5:1 C6:2 Ab5:1 | F5:2 Bb5:1 D6:2 Bb5:1 | G5:2 Eb5:1 Bb4:2 Eb5:1 | C5:3 Eb5:3 |
                  F5:2 Ab5:1 G5:2 F5:1 | Eb5:2 D5:1 B4:3 | C5:6 | r:6"""),
    "stage4": dict(name="Iron in the Deep", bpm=320, bar=8, style="drive", lead="brass",
        chords="Gm Gm Eb F Gm Gm Cm D Eb F Gm Eb Cm D Gm D",
        melody="""D5:1 D5:1 G5:2 F5:1 D5:1 Bb4:2 | C5:1 D5:1 Bb4:1 A4:1 G4:4 | G4:1 Bb4:1 Eb5:2 D5:1 Eb5:1 G5:2 |
                  F5:3 C5:1 A4:4 | G5:2 A5:1 Bb5:1 A5:2 G5:2 | F5:1 D5:1 Bb4:1 D5:1 G5:4 |
                  Eb5:2 G5:1 C6:1 Bb5:2 G5:2 | F#5:3 A5:1 D6:4 | Bb5:2 G5:1 Eb5:1 Bb4:2 Eb5:2 |
                  A5:2 F5:1 C5:1 A4:2 F5:2 | G5:1 Bb5:1 D6:2 C6:1 Bb5:1 A5:2 | G5:3 Eb5:1 Bb4:4 |
                  C5:1 Eb5:1 G5:1 C6:1 Bb5:1 G5:1 Eb5:2 | D5:2 F#5:2 A5:2 C6:2 | Bb5:2 A5:1 G5:1 D5:4 |
                  F#5:2 A5:2 D5:4"""),
    "stage5": dict(name="Clockwork Spire", bpm=288, bar=8, style="clock", lead="brass",
        chords="F#m F#m D E F#m F#m Bm C#7 D E F#m F#m Bm C#7 F#m C#7",
        melody="""C#5:2 F#5:2 E5:1 D5:1 C#5:2 | B4:1 C#5:1 A4:1 B4:1 F#4:4 | F#4:1 A4:1 D5:2 C#5:1 D5:1 F#5:2 |
                  E5:2 G#4:2 B4:2 E5:2 | A5:2 G#5:1 F#5:1 C#5:2 F#5:2 | E5:1 F#5:1 E5:1 C#5:1 A4:4 |
                  B4:1 D5:1 F#5:1 B5:1 A5:2 F#5:2 | F5:3 G#5:1 B5:2 G#5:2 | F#5:2 D5:1 A4:1 D5:2 F#5:2 |
                  G#5:2 E5:1 B4:1 E5:2 G#5:2 | A5:3 F#5:1 C#5:2 A4:2 | C#5:1 D5:1 E5:1 F#5:1 G#5:2 A5:2 |
                  B5:2 A5:1 F#5:1 D5:2 B4:2 | C#5:2 F5:1 G#5:1 B5:2 G#5:2 | A5:2 F#5:2 C#5:4 |
                  F5:2 G#5:2 C#6:4"""),
    "stage6": dict(name="Throne of Ash", bpm=240, bar=8, style="dirge", lead="choir_lead",
        chords="Dm Dm Bb A Dm Gm A A Bb C F Dm Gm A Dm A",
        melody="""D5:4 A4:2 D5:1 E5:1 | F5:3 E5:1 D5:2 C#5:2 | D5:2 F5:2 Bb5:3 A5:1 | G5:2 E5:2 C#5:4 |
                  A5:4 F5:2 A5:1 G5:1 | F5:2 D5:2 Bb4:2 G5:2 | E5:2 G5:2 A5:2 C#6:2 | A5:8 |
                  F5:2 Bb5:2 D6:3 C6:1 | E5:2 G5:2 C6:3 Bb5:1 | A5:2 F5:2 C5:2 F5:2 | A5:3 G5:1 F5:2 D5:2 |
                  Bb4:1 D5:1 G5:1 Bb5:1 A5:2 G5:2 | C#5:2 E5:2 G5:2 E5:2 | F5:2 E5:1 D5:1 A4:4 |
                  C#5:2 E5:2 A5:4"""),
    "boss": dict(name="Fang and Talon", bpm=672, bar=16, style="boss", lead="brass",
        chords="Bm Bm G A Bm Bm Em F#",
        melody="""F#5:4 B5:2 A5:2 F#5:4 D5:2 E5:2 | F#5:6 E5:2 D5:4 B4:4 | G5:4 D5:2 G5:2 B5:6 A5:2 |
                  A5:4 E5:2 C#5:2 A4:8 | B4:2 D5:2 F#5:2 B5:2 A5:4 F#5:4 | G5:2 F#5:2 E5:2 D5:2 C#5:4 D5:4 |
                  E5:4 G5:2 B5:2 E6:6 D6:2 | C#6:4 A#5:4 F#5:8"""),
    "clear": dict(name="Soul Orb", bpm=280, bar=8, style="fanfare", lead="brass", once=True,
        chords="F G A A",
        melody="A4:1 C5:1 F5:2 A5:4 | B4:1 D5:1 G5:2 B5:4 | C#6:8 | r:8"),
    "death": dict(name="Fallen", bpm=200, bar=8, style="fanfare", lead="strings_lead", once=True,
        chords="Am E Am Am",
        melody="E5:2 D5:2 C5:2 B4:2 | A4:2 G#4:2 B4:4 | A4:8 | r:8"),
    "gameover": dict(name="The Vigil Ends", bpm=150, bar=6, style="chorale", lead="strings_lead",
        chords="Dm Bb Gm A Dm Bb Gm A",
        melody="A4:3 F4:3 | D5:3 Bb4:3 | G4:2 Bb4:1 D5:3 | C#5:6 | F4:3 A4:3 | D5:2 C5:1 Bb4:3 | G4:2 A4:1 Bb4:3 | A4:6"),
    "ending": dict(name="Dawn over Hollowmoor", bpm=200, bar=8, style="chorale", lead="flute",
        chords="D A Bm G D A G A Bm F#m G D G A D D",
        melody="""F#5:3 E5:1 D5:2 A4:2 | C#5:2 E5:2 A5:4 | B5:3 A5:1 F#5:2 D5:2 | G5:2 B5:2 D6:4 |
                  D6:3 C#6:1 B5:2 A5:2 | G5:2 F#5:2 E5:4 | D5:2 E5:2 G5:2 B5:2 | A5:8 |
                  F#5:2 B5:2 D6:3 C#6:1 | C#6:2 A5:2 F#5:4 | G5:2 B5:2 D6:2 G6:2 | F#6:4 D6:4 |
                  B5:2 A5:1 G5:1 E5:2 G5:2 | A5:2 C#6:2 E6:4 | D6:8 | r:8"""),
}

# ==================================================================== theory
NOTE_RE = re.compile(r"^([A-G])(#|b)?(-?\d)$")
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUAL = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10), "dim": (0, 3, 6)}


def midi(name):
    m = NOTE_RE.match(name)
    if not m:
        raise ValueError(f"bad note {name!r}")
    letter, acc, octv = m.groups()
    return 12 * (int(octv) + 1) + STEPS[letter] + {"#": 1, "b": -1, None: 0}[acc]


def chord(sym):
    m = re.match(r"^([A-G])(#|b)?(m7|m|7|dim)?$", sym)
    if not m:
        raise ValueError(f"bad chord {sym!r}")
    root = STEPS[m.group(1)] + {"#": 1, "b": -1, None: 0}[m.group(2)]
    return root, QUAL[m.group(3) or ""]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def parse_melody(text, bar):
    events, pos = [], 0.0
    for bi, b in enumerate(text.split("|")):
        blen = 0.0
        for tok in b.split():
            what, _, d = tok.rpartition(":")
            d = float(d)
            if what != "r":
                events.append((pos + blen, d, [midi(what)]))
            blen += d
        if abs(blen - bar) > 1e-6:
            raise ValueError(f"bar {bi + 1} holds {blen} units, not {bar}")
        pos += blen
    return events, pos


# ==================================================================== arrangement

def arrange(tr):
    """-> {part: [(start, dur, [midi...])]} generated from the chords by the style."""
    bar = tr["bar"]
    chords = [chord(c) for c in tr["chords"].split()]
    mel, total = parse_melody(tr["melody"], bar)
    assert abs(total - bar * len(chords)) < 1e-6, (tr["name"], total, bar * len(chords))
    P = {"lead": mel, "bass": [], "pad": [], "arp": [], "drums": [], "tick": []}
    st = tr["style"]
    for i, (root, q) in enumerate(chords):
        t0 = i * bar
        r2 = 36 + (root - 4) % 12 + 4          # bass root between E2 and D#3
        tri = [48 + root + iv for iv in q[:3]]
        tri = [n if n >= 53 else n + 12 for n in tri]       # pad voiced F3..E4-ish
        fifth = r2 + 7
        if st in ("drive", "clock"):
            pat = [r2, r2 + 12, r2, fifth, r2, r2 + 12, fifth, r2 + 12]
            for k in range(8):
                P["bass"].append((t0 + k, 1, [pat[k]]))
            P["pad"].append((t0, bar, sorted(tri)))
            arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[2], tri[1], tri[0] + 12, tri[2]]
            for k in range(8):
                P["arp"].append((t0 + k, 1, [arp[k] + 12]))
            for k, dr in enumerate(["K", "H", "S", "H", "K", "K", "S", "H"]):
                P["drums"].append((t0 + k, 1, [dr]))
            if st == "clock":
                for k in range(0, 8, 2):
                    P["tick"].append((t0 + k, 1, [96 if k % 4 == 0 else 91]))
        elif st == "march":
            for k, n in enumerate([r2, r2, fifth, r2 + 12]):
                P["bass"].append((t0 + k * 2, 2, [n]))
            P["pad"].append((t0, bar, sorted(tri)))
            for k in range(0, 8, 2):
                P["arp"].append((t0 + k, 2, [tri[(k // 2) % 3] + 12]))
            for k, dr in enumerate(["K", "", "S", "S", "K", "", "S", "H"]):
                if dr:
                    P["drums"].append((t0 + k, 1, [dr]))
        elif st == "waltz":
            P["bass"].append((t0, 3, [r2]))
            P["bass"].append((t0 + 3, 3, [fifth]))
            P["pad"].append((t0, bar, sorted(tri)))
            arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[2], tri[1]]
            for k in range(6):
                P["arp"].append((t0 + k, 1, [arp[k] + 12]))
            for k, dr in enumerate(["K", "H", "H", "S", "H", "H"]):
                P["drums"].append((t0 + k, 1, [dr]))
        elif st == "chorale":
            P["bass"].append((t0, bar, [r2]))
            P["pad"].append((t0, bar, sorted(tri)))
            P["arp"].append((t0, bar, [tri[2] + 12]))
        elif st == "dirge":
            P["bass"].append((t0, 4, [r2]))
            P["bass"].append((t0 + 4, 4, [r2 + 12 if i % 2 else fifth]))
            P["pad"].append((t0, bar, sorted(tri)))
            for k in range(8):
                P["arp"].append((t0 + k, 1, [[tri[0], tri[2], tri[1], tri[2]][k % 4] + 12]))
            for k, dr in enumerate(["K", "", "", "", "S", "", "K", ""]):
                if dr:
                    P["drums"].append((t0 + k, 1, [dr]))
        elif st == "boss":
            for k in range(16):
                n = [r2, r2, r2 + 12, r2][k % 4] if k < 12 else [fifth, r2 + 12, fifth, r2 + 13][k - 12]
                P["bass"].append((t0 + k, 1, [n]))
            P["pad"].append((t0, bar, sorted(tri)))
            for k, dr in enumerate("K.H.S.HKK.H.S.HS"):
                if dr != ".":
                    P["drums"].append((t0 + k, 1, [dr]))
            for k in range(0, 16, 2):
                P["arp"].append((t0 + k, 2, [[tri[0], tri[1], tri[2], tri[1]][(k // 2) % 4] + 24]))
        elif st == "fanfare":
            if i < len(chords) - 1:
                P["bass"].append((t0, bar, [r2]))
                P["pad"].append((t0, bar, sorted(tri)))
                P["drums"].append((t0, 1, ["K"]))
                if i == len(chords) - 2:
                    P["drums"].append((t0, 1, ["C"]))
        else:
            raise ValueError("unknown style " + st)
    return P, total


# ==================================================================== synthesis

def adsr(n, dur, sr, a, d, s, r):
    t = np.arange(n) / sr
    a = max(a, 1e-3)
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-np.maximum(t - a, 0) / max(d, 1e-3)))
    off = t >= dur
    if off.any():
        e0 = e[np.argmax(off)]
        e[off] = e0 * np.clip(1 - (t[off] - dur) / max(r, 1e-3), 0, 1)
    return e


def vib(t, f0, rate, depth, delay):
    return f0 * (1 + depth * np.clip((t - delay) / 0.25, 0, 1) * np.sin(2 * np.pi * rate * t))


def additive(f, t, sr, amps, bright=None):
    phase = 2 * np.pi * np.cumsum(f) / sr
    y = np.zeros_like(t)
    fmax = float(np.max(f))
    for k, a in enumerate(amps, start=1):
        if k * fmax > sr * 0.45:
            break
        ak = a if bright is None else a * np.exp(-(k - 1) * (1 - bright))
        y += ak * np.sin(k * phase)
    return y


def inst16(kind, m, dur, sr, rng):
    f0 = hz(m)
    rel = {"pad": 0.45, "bell": 1.2, "flute": 0.12, "choir_lead": 0.3}.get(kind, 0.1)
    n = int((dur + rel) * sr)
    t = np.arange(n) / sr
    if kind == "brass":
        f = vib(t, f0, 5.6, 0.006, 0.18)
        bright = np.clip(t / 0.04, 0, 1) * (0.55 + 0.35 * np.exp(-t / 0.25))
        y = additive(f, t, sr, [1 / k for k in range(1, 14)], bright)
        return 0.9 * y * adsr(n, dur, sr, 0.02, 0.4, 0.75, 0.1)
    if kind == "strings_lead":
        f = vib(t, f0, 5.2, 0.007, 0.15)
        y = sum(additive(f * (1 + dc), t, sr, [1 / k for k in range(1, 11)]) for dc in (-0.003, 0.003)) * 0.5
        return 0.8 * y * adsr(n, dur, sr, 0.06, 0.8, 0.8, 0.15)
    if kind == "flute":
        f = vib(t, f0, 5.0, 0.008, 0.2)
        y = additive(f, t, sr, [1.0, 0.25, 0.08]) + 0.04 * rng.uniform(-1, 1, n)
        return y * adsr(n, dur, sr, 0.04, 0.5, 0.85, 0.12)
    if kind == "choir_lead":
        f = vib(t, f0, 4.6, 0.007, 0.2)
        amps = [np.exp(-((k * f0 - 700) / 350) ** 2) + 0.7 * np.exp(-((k * f0 - 1150) / 300) ** 2) + 0.2 for k in range(1, 16)]
        y = sum(additive(f * (1 + dc), t, sr, amps) for dc in (-0.004, 0.0, 0.004)) / 3
        return 0.7 * y * adsr(n, dur, sr, 0.12, 1.0, 0.85, 0.3)
    if kind == "pad":
        f = f0 * np.ones(n)
        y = sum(additive(f * (1 + dc), t, sr, [1 / k for k in range(1, 8)]) for dc in (-0.004, 0.0, 0.004)) / 3
        return y * adsr(n, dur, sr, 0.25, 1.5, 0.8, 0.45)
    if kind == "organ":
        f = f0 * np.ones(n)
        y = additive(f, t, sr, [1.0, 0.6, 0.35, 0.3, 0, 0.2, 0, 0.12])
        return y * adsr(n, dur, sr, 0.03, 1.0, 1.0, 0.12)
    if kind in ("harpsi", "bass", "bell"):
        ratio, index, floor, idec, a, d, s = {
            "harpsi": (3.0, 2.2, 0.05, 0.08, 0.002, 0.25, 0.0),
            "bass": (1.0, 2.4, 0.2, 0.09, 0.003, 0.3, 0.35),
            "bell": (3.5, 2.0, 0.1, 0.5, 0.002, 1.1, 0.0)}[kind]
        phase = 2 * np.pi * f0 * t
        idx = index * (floor + (1 - floor) * np.exp(-t / idec))
        return np.sin(phase + idx * np.sin(ratio * phase)) * adsr(n, dur, sr, a, d, s, rel)
    raise ValueError(kind)


def drum16(kind, sr, rng):
    if kind == "K":
        t = np.arange(int(0.28 * sr)) / sr
        f = 45 + 110 * np.exp(-t / 0.035)
        return np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t / 0.12) * 1.1
    if kind == "S":
        t = np.arange(int(0.22 * sr)) / sr
        noise = rng.uniform(-1, 1, len(t))
        noise = noise - np.concatenate([[0], noise[:-1]]) * 0.6
        return (0.75 * noise * np.exp(-t / 0.07) + 0.5 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)) * 0.8
    if kind == "H":
        t = np.arange(int(0.06 * sr)) / sr
        noise = rng.uniform(-1, 1, len(t))
        noise = noise - np.concatenate([[0], noise[:-1]])
        return noise * np.exp(-t / 0.018) * 0.35
    if kind == "C":
        t = np.arange(int(1.2 * sr)) / sr
        noise = rng.uniform(-1, 1, len(t))
        noise = noise - np.concatenate([[0], noise[:-1]]) * 0.8
        return noise * np.exp(-t / 0.4) * 0.45
    raise ValueError(kind)


def pulse(f, t, sr, duty):
    phase = np.cumsum(f) / sr
    return np.where((phase % 1.0) < duty, 1.0, -1.0)


def inst8(kind, m, dur, sr):
    f0 = hz(m)
    n = int((dur + 0.02) * sr)
    t = np.arange(n) / sr
    if kind == "lead":
        f = vib(t, f0, 6.0, 0.012, 0.2)
        env = np.clip(1 - t / (dur + 0.02), 0.55, 1.0) * adsr(n, dur, sr, 0.003, 0.3, 0.8, 0.02)
        return pulse(f, t, sr, 0.25) * np.round(env * 15) / 15
    if kind == "arp":
        return pulse(f0 * np.ones(n), t, sr, 0.125) * np.round(adsr(n, dur, sr, 0.002, 0.08, 0.3, 0.02) * 15) / 15
    if kind == "bass":
        ph = (np.cumsum(f0 * np.ones(n)) / sr) % 1.0
        tri = np.abs(ph * 4 - 2) - 1
        return np.round(tri * 7.5) / 7.5 * (t < dur + 0.01)
    raise ValueError(kind)


def drum8(kind, sr, rng):
    L = {"K": 0.12, "S": 0.14, "H": 0.04, "C": 0.6}[kind]
    n = int(L * sr)
    t = np.arange(n) / sr
    hold = {"K": 40, "S": 3, "H": 1, "C": 2}[kind]   # noise "period": long = low-pitched
    base = np.repeat(rng.choice([-1.0, 1.0], n // hold + 1), hold)[:n]
    if kind == "K":
        f = 40 + 180 * np.exp(-t / 0.02)
        base = 0.6 * np.sign(np.sin(2 * np.pi * np.cumsum(f) / sr)) + 0.2 * base
    return base * np.exp(-t / (L / 3))


def echo(y, sr, delay=0.19, fb=0.34, mix=0.28, taps=5):
    """SNES-style echo buffer: repeats every `delay` s, each `fb` quieter."""
    d = int(delay * sr)
    wet = np.zeros_like(y)
    for k in range(1, taps + 1):
        wet[k * d:] += y[:len(y) - k * d] * fb ** (k - 1)
    return y + mix * wet


GAINS16 = {"lead": 0.34, "bass": 0.42, "pad": 0.09, "arp": 0.11, "drums": 0.36, "tick": 0.10}
GAINS8 = {"lead": 0.24, "bass": 0.34, "arp": 0.07, "drums": 0.22, "tick": 0.08}


def render(tr, version, seed):
    rng = np.random.default_rng(seed)
    parts, total = arrange(tr)
    unit = 60.0 / tr["bpm"]
    sr = 32000 if version == "16" else 22050
    loop_n = int(round(total * unit * sr))
    reps = 1 if tr.get("once") else 2
    mix = np.zeros(reps * loop_n + int(3.0 * sr))
    style = tr["style"]
    for part, events in parts.items():
        for rep in range(reps):
            for start, dur, notes in events:
                s0 = int(round((start + rep * total) * unit * sr))
                for n in notes:
                    if version == "16":
                        if part == "drums":
                            y = drum16(n, sr, rng)
                        elif part == "tick":
                            tt = np.arange(int(0.05 * sr)) / sr
                            y = np.sin(2 * np.pi * hz(n) * tt) * np.exp(-tt / 0.01)
                        else:
                            kind = {"lead": tr["lead"], "bass": "bass", "pad": "organ" if style in ("chorale", "dirge") else "pad",
                                    "arp": "bell" if style == "chorale" else "harpsi"}[part]
                            y = inst16(kind, n, dur * unit, sr, rng)
                        g = GAINS16[part] * (1.6 if part == "pad" and style in ("chorale", "dirge") else 1.0)
                    else:
                        if part == "drums":
                            y = drum8(n, sr, rng)
                        elif part == "tick":
                            tt = np.arange(int(0.03 * sr)) / sr
                            y = pulse(np.full(len(tt), hz(n)), tt, sr, 0.5) * np.exp(-tt / 0.008)
                        elif part == "pad":
                            continue        # the chip version carries harmony in the arpeggio
                        else:
                            y = inst8({"lead": "lead", "bass": "bass", "arp": "arp"}[part], n, dur * unit, sr)
                        g = GAINS8[part]
                    mix[s0:s0 + len(y)] += g * y
    if version == "16":
        mix = echo(mix, sr)
    loop = mix[loop_n:2 * loop_n] if reps == 2 else mix[:loop_n]
    peak = max(np.abs(loop).max(), 1e-9)
    return loop / peak * 0.89, sr, total * unit


def write(path, x, sr, bits, seed):
    rng = np.random.default_rng(seed)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setframerate(sr)
        if bits == 16:
            w.setsampwidth(2)
            w.writeframes(np.clip(np.round(x * 32767), -32768, 32767).astype("<i2").tobytes())
        else:
            w.setsampwidth(1)
            d = rng.uniform(-0.5, 0.5, len(x)) + rng.uniform(-0.5, 0.5, len(x))
            w.writeframes(np.clip(np.round(x * 127 + d) + 128, 0, 255).astype(np.uint8).tobytes())


def main(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for i, (name, tr) in enumerate(TRACKS.items()):
        if only and name not in only:
            continue
        for v, bits in (("16", 16), ("8", 8)):
            y, sr, secs = render(tr, v, 1994 + i)
            p = OUT / f"{name}_{v}.wav"
            write(p, y, sr, bits, 3000 + i)
            index.setdefault(name, {"title": tr["name"], "seconds": round(secs, 3)})
            print(f"{name:9s} {v:>2s}  {tr['name']!r:26s} {secs:5.1f}s {p.stat().st_size / 1024:6.0f} KB")
    (OUT / "music.json").write_text(json.dumps(index, indent=1))


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
