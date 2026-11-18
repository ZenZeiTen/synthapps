"""The music engine shared with the repo's Vale of Shards: two-operator FM voices,
band-limited pulse waves and noise percussion, a Song sequencer over scale degrees,
and seamless-loop rendering (echo and reverb run as circular filters over the loop).
Tidebell's own pieces are in make_music.py.

A piece is written as chord progressions ("1 | 6 | 4 5 | 5D7"), melodies in scale
degrees ("3:1 2:0.5 5:1.5 1':0.5"; ' = octave up, , = octave down, r = rest),
and step patterns for bass, arpeggios, pads and drums.
"""
from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass

import numpy as np
import soundfile as sf

SR = 32000
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTS = [os.path.join(ROOT, "godot", "content", "music"), os.path.join(ROOT, "web", "public", "content", "music")]
VORBIS_COMPRESSION = 0.75     # libsndfile maps this to Vorbis quality ~0.25 (keeps the Windows 7z under 30 MiB)
TAIL_SEC = 6.0

# =========================================================================== theory

PCS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MODES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "harmonic": [0, 2, 3, 5, 7, 8, 11],
}
QUALITIES = {"M": [0, 4, 7], "m": [0, 3, 7], "d": [0, 3, 6], "+": [0, 4, 8], "M7": [0, 4, 7, 11],
             "m7": [0, 3, 7, 10], "D7": [0, 4, 7, 10], "s4": [0, 5, 7], "s2": [0, 2, 7]}


def pc_of(name: str) -> int:
    return (PCS[name[0]] + name[1:].count("#") - name[1:].count("b")) % 12


class Key:
    def __init__(self, tonic: str, mode: str):
        self.tonic = pc_of(tonic)
        self.scale = MODES[mode]

    def pitch(self, step: int, acc: int, octave: int) -> int:
        """MIDI note of scale step (0 = tonic) in the octave whose tonic is `octave`."""
        o, s = divmod(step, 7)
        return 12 * (octave + 1 + o) + self.tonic + self.scale[s] + acc

    def semis(self, step: int) -> int:
        o, s = divmod(step, 7)
        return 12 * o + self.scale[s]


@dataclass
class Chord:
    root: int          # pitch class
    tones: list        # semitones above the root, ascending, starting with 0
    bass: int          # pitch class of the bass (slash chords)


CHORD_RE = re.compile(r"^([#b]?)([1-7])(M7|m7|D7|s4|s2|M|m|d|\+|7|9)?(?:/([#b]?)([1-7]))?$")


def parse_chord(key: Key, tok: str) -> Chord:
    m = CHORD_RE.match(tok)
    if not m:
        raise ValueError(f"bad chord {tok!r}")
    acc = {"": 0, "#": 1, "b": -1}[m.group(1)]
    step = int(m.group(2)) - 1
    qual = m.group(3) or ""
    root = (key.tonic + key.semis(step) + acc) % 12
    if qual in QUALITIES:
        tones = list(QUALITIES[qual])
    else:  # diatonic stack of thirds from the scale
        n = 4 if qual == "7" else 3
        base = key.semis(step)
        tones = [key.semis(step + 2 * i) - base for i in range(n)]
        if qual == "9":
            tones.append(key.semis(step + 8) - base)
    bass = root
    if m.group(5):
        bacc = {"": 0, "#": 1, "b": -1}[m.group(4)]
        bass = (key.tonic + key.semis(int(m.group(5)) - 1) + bacc) % 12
    return Chord(root, tones, bass)


# --------------------------------------------------------------------------- melodies


@dataclass
class N:
    step: int | None   # scale step from the tonic (None = rest)
    acc: int
    dur: float


NOTE_RE = re.compile(r"^(r|[#b]?[1-7])([',]*)(?::([0-9.]+))?$")


def mel(text: str) -> list:
    out, last = [], 1.0
    for tok in text.replace("|", " ").split():
        m = NOTE_RE.match(tok)
        if not m:
            raise ValueError(f"bad note {tok!r}")
        head, marks, d = m.groups()
        if d:
            last = float(d)
        if head == "r":
            out.append(N(None, 0, last))
            continue
        acc = head.count("#") - head.count("b")
        step = int(head.lstrip("#b")) - 1 + 7 * (marks.count("'") - marks.count(","))
        out.append(N(step, acc, last))
    return out


def as_mel(ph) -> list:
    return mel(ph) if isinstance(ph, str) else ph


def length(ph) -> float:
    return sum(n.dur for n in as_mel(ph))


def shift(ph, steps: int, keep_acc: bool = True) -> list:
    """Diatonic transposition: a sequence, or (keep_acc=False) a harmony line."""
    return [N(None if n.step is None else n.step + steps, n.acc if keep_acc else 0, n.dur) for n in as_mel(ph)]


def ornament(ph, min_dur: float = 1.0, grain: float = 0.25) -> list:
    """Turn each long note into note, upper neighbour, note (same total length)."""
    out = []
    for n in as_mel(ph):
        if n.step is not None and n.dur >= min_dur:
            out += [N(n.step, n.acc, grain), N(n.step + 1, 0, grain), N(n.step, n.acc, n.dur - 2 * grain)]
        else:
            out.append(n)
    return out


def join(*phs) -> list:
    out = []
    for p in phs:
        out += as_mel(p)
    return out


# =========================================================================== the song model


class Song:
    def __init__(self, key: str, mode: str, bpm: float, bpb: float, bars: int, seed: int,
                 loop: bool = True, total_beats: float | None = None):
        self.key = Key(key, mode)
        self.bpm, self.bpb, self.bars, self.loop = bpm, bpb, bars, loop
        self.total_beats = total_beats if total_beats is not None else bars * bpb
        self.notes = []    # (part, inst, beat, dur_beats, midi, vel)
        self.hits = []     # (drum, beat, vel)
        self.chords = []   # (beat0, beat1, Chord)
        self.rng = np.random.default_rng(seed)
        self.levels = {}   # part -> dB (overrides the instrument's default level)
        self.fx = dict(echo_beats=0.75, echo_fb=0.35, echo_damp=3500.0, rev_size=1.0, rev_fb=0.78,
                       rev_damp=5000.0, target_rms=0.16)
        self._vcache = {}
        self._vprev = {}

    # ---- harmony
    def prog(self, bar: int, text: str) -> int:
        bars = [b.split() for b in text.split("|") if b.strip()]
        for i, toks in enumerate(bars):
            w = self.bpb / len(toks)
            for j, tok in enumerate(toks):
                b0 = (bar + i) * self.bpb + j * w
                self.chords.append((b0, b0 + w, parse_chord(self.key, tok)))
        self.chords.sort(key=lambda c: c[0])
        return bar + len(bars)

    def prog_beats(self, beat: float, items) -> None:
        for tok, n in items:
            self.chords.append((beat, beat + n, parse_chord(self.key, tok)))
            beat += n
        self.chords.sort(key=lambda c: c[0])

    def chord_at(self, beat: float):
        idx = 0
        for i, (b0, b1, _) in enumerate(self.chords):
            if b0 <= beat + 1e-6:
                idx = i
        cur = self.chords[idx]
        nxt = self.chords[(idx + 1) % len(self.chords)]
        return cur, nxt

    def chords_in_bar(self, bar: int) -> int:
        b0, b1 = bar * self.bpb, (bar + 1) * self.bpb
        return sum(1 for c in self.chords if b0 - 1e-6 <= c[0] < b1 - 1e-6)

    def voicing(self, part: str, chord_entry, center: int, size: int | None = None) -> list:
        """Closed voicing near `center`, voice-led from this part's previous chord."""
        ck = (part, chord_entry[0], center)
        if ck in self._vcache:
            return self._vcache[ck]
        ch = chord_entry[2]
        pcs = [(ch.root + t) % 12 for t in ch.tones][: size or None]
        prev = self._vprev.get((part, center))
        best, best_cost = None, None
        for lo in range(center - 9, center + 4):
            if lo % 12 not in pcs:
                continue
            notes, want, m = [lo], [p for p in pcs if p != lo % 12], lo
            while want:
                m += 1
                if m % 12 in want:
                    notes.append(m)
                    want.remove(m % 12)
            if prev and len(prev) == len(notes):
                cost = sum(abs(a - b) for a, b in zip(notes, prev)) + 0.3 * abs(np.mean(notes) - center)
            else:
                cost = abs(np.mean(notes) - center)
            if best_cost is None or cost < best_cost:
                best, best_cost = notes, cost
        self._vprev[(part, center)] = best
        self._vcache[ck] = best
        return best

    # ---- note makers
    def hum(self) -> float:
        return float(1 + 0.06 * (self.rng.random() - 0.5))

    def add(self, part, inst, beat, dur, midi, vel):
        self.notes.append((part, inst, beat, dur, midi, vel))

    def melody(self, inst: str, ph, bar: float, octave: int, vel: float = 0.8, gate: float = 0.93,
               bars: float | None = None, part: str | None = None, xpose: int = 0) -> float:
        ph = as_mel(ph)
        if bars is not None and abs(length(ph) - bars * self.bpb) > 1e-6:
            raise ValueError(f"{part or inst} at bar {bar}: {length(ph)} beats, want {bars * self.bpb}")
        beat = bar * self.bpb
        for n in ph:
            if n.step is not None:
                d = n.dur * gate if n.dur > 0.3 else n.dur * 0.85
                self.add(part or inst, inst, beat, d, self.key.pitch(n.step, n.acc, octave) + xpose, vel * self.hum())
            beat += n.dur
        return beat

    def harmony(self, inst: str, ph, bar: float, octave: int, vel: float = 0.6, gate: float = 0.93,
                part: str | None = None, lo: int = 3, hi: int = 9) -> None:
        """A second voice under a melody: for each note, a tone of the chord sounding at that
        moment, 3..9 semitones below the tune, moving as little as possible."""
        beat, prev = bar * self.bpb, None
        for n in as_mel(ph):
            if n.step is not None:
                m = self.key.pitch(n.step, n.acc, octave)
                ch = self.chord_at(beat)[0][2]
                pcs = {(ch.root + t) % 12 for t in ch.tones}
                cands = [p for p in range(m - hi, m - lo + 1) if p % 12 in pcs]
                if cands:
                    h = min(cands, key=lambda p: (abs(p - prev) if prev is not None else 0, m - p))
                    d = n.dur * gate if n.dur > 0.3 else n.dur * 0.85
                    self.add(part or inst, inst, beat, d, h, vel * self.hum())
                    prev = h
            beat += n.dur

    def _place_root(self, pc: int, octave: int) -> int:
        base = 12 * (octave + 1)
        m = base + pc
        return m - 12 if m > base + 6 else m

    def grid(self, inst: str, pat, bars, octave: int = 2, vel: float = 0.8, gate: float = 0.9,
             kind: str = "bass", center: int = 60, part: str | None = None, size: int | None = None):
        part = part or inst
        for bar in bars:
            s = (pat(bar) if callable(pat) else pat).replace(" ", "")
            n = len(s)
            step = self.bpb / n
            for i, c in enumerate(s):
                if c in ".-":
                    continue
                j = i + 1
                while j < n and s[j] == "-":
                    j += 1
                beat = bar * self.bpb + i * step
                cur, nxt = self.chord_at(beat)
                d = (j - i) * step * gate
                for p in self._resolve(c, cur, nxt, kind, octave, center, part, size):
                    self.add(part, inst, beat, d, p, vel * self.hum())

    def _resolve(self, c, cur, nxt, kind, octave, center, part, size):
        ch = cur[2]
        if kind == "arp":
            v = self.voicing(part, cur, center, size)
            k = int(c) - 1
            return [v[k % len(v)] + 12 * (k // len(v))]
        r = self._place_root(ch.root, octave)
        if c == "R":
            return [self._place_root(ch.bass, octave)]
        tone = lambda i, dflt: r + (ch.tones[i] if i < len(ch.tones) else dflt)
        if c == "3":
            return [tone(1, 4)]
        if c == "5":
            return [tone(2, 7)]
        if c == "7":
            return [tone(3, 12)]
        if c == "8":
            return [r + 12]
        if c == "L":
            return [tone(2, 7) - 12]
        if c == "N":
            return [r + 1]
        if c == "A":
            nr = self._place_root(nxt[2].bass, octave)
            return [nr - 1]
        if c == "P":
            return [r, r + 7, r + 12]
        if c == "C":
            return self.voicing(part, cur, center, size)
        raise ValueError(c)

    def pad(self, inst: str, bars, center: int = 60, vel: float = 0.7, part: str | None = None,
            size: int | None = None):
        part = part or inst
        b0, b1 = bars[0] * self.bpb, (bars[-1] + 1) * self.bpb
        for entry in self.chords:
            if b0 - 1e-6 <= entry[0] < b1 - 1e-6:
                for p in self.voicing(part, entry, center, size):
                    self.add(part, inst, entry[0], (entry[1] - entry[0]) * 0.98, p, vel * self.hum())

    DRUMVEL = {"x": 0.8, "X": 1.0, "o": 0.5, "g": 0.28}

    def drums(self, bars, pats: dict, vel: float = 1.0):
        for bar in bars:
            for name, s in pats.items():
                s = (s(bar) if callable(s) else s).replace(" ", "")
                step = self.bpb / len(s)
                for i, c in enumerate(s):
                    if c in self.DRUMVEL:
                        self.hits.append((name, bar * self.bpb + i * step, self.DRUMVEL[c] * vel * self.hum()))

    def hit(self, name: str, beat: float, vel: float = 1.0):
        self.hits.append((name, beat, vel))

    def roll(self, name: str, beat: float, beats: float, step: float, v0: float, v1: float):
        k = int(round(beats / step))
        for i in range(k):
            self.hits.append((name, beat + i * step, v0 + (v1 - v0) * i / max(1, k - 1)))

    def sec(self, beats: float) -> float:
        return beats * 60.0 / self.bpm


# =========================================================================== synthesis


def M(ratio, index, idecay=1e9, ifloor=1.0, iatk=0.0, wave=0, fb=0.0):
    return dict(ratio=ratio, index=index, idecay=idecay, ifloor=ifloor, iatk=iatk, wave=wave, fb=fb)


# lvl: loudness of the part in the mix (dB, measured on the stem while it plays).
# echo/rev: send levels. a/d/s/r: attack, decay time constant, sustain level, release time constant.
INST = {
    "brass":   dict(mods=[M(1, 2.3, 0.5, 0.55, 0.05, fb=0.15)], a=0.03, d=0.4, s=0.8, r=0.1,
                    vib=(5.3, 0.006, 0.25), lvl=0, pan=0.0, echo=0.12, rev=0.22),
    "horn":    dict(mods=[M(1, 1.3, 0.6, 0.6, 0.08)], a=0.06, d=0.5, s=0.8, r=0.18,
                    vib=(4.8, 0.004, 0.3), lvl=-5, pan=-0.3, echo=0.1, rev=0.3),
    "strings": dict(mods=[M(1, 0.9, 1.0, 0.8, 0.2)], a=0.25, d=1.0, s=0.85, r=0.45,
                    vib=(5.0, 0.004, 0.1), detune=6, width=0.6, lvl=-11, pan=0.0, rev=0.35),
    "organ":   dict(mods=[M(2, 0.7)], cwave=1, a=0.02, d=1.0, s=0.9, r=0.12, detune=3, width=0.4,
                    lvl=-13, pan=0.0, rev=0.2),
    "choir":   dict(mods=[M(1, 0.5), M(3, 0.15)], a=0.3, d=1.0, s=0.9, r=0.6, vib=(4.5, 0.005, 0.3),
                    detune=9, width=0.8, lvl=-12, rev=0.45),
    "harp":    dict(mods=[M(1, 1.1, 0.12, 0.15)], a=0.003, d=0.9, s=0.0, r=0.6, lvl=-8, pan=0.35,
                    echo=0.1, rev=0.25),
    "bell":    dict(mods=[M(3.5, 2.2, 0.6, 0.1)], a=0.002, d=1.3, s=0.0, r=1.0, lvl=-11, pan=0.4,
                    echo=0.25, rev=0.3),
    "epiano":  dict(mods=[M(1, 1.3, 0.3, 0.2), M(14, 0.25, 0.02, 0.0)], a=0.003, d=1.6, s=0.0, r=0.8,
                    trem=(4.5, 0.15), lvl=-7, pan=-0.2, echo=0.35, rev=0.3),
    "marimba": dict(mods=[M(4, 1.4, 0.03, 0.0)], a=0.002, d=0.45, s=0.0, r=0.25, lvl=0, pan=0.1,
                    echo=0.08, rev=0.15),
    "xylo":    dict(mods=[M(3, 2.0, 0.02, 0.0)], a=0.001, d=0.3, s=0.0, r=0.2, lvl=-2, pan=0.15,
                    echo=0.12, rev=0.2),
    "flute":   dict(mods=[M(1, 0.35)], a=0.06, d=0.3, s=0.85, r=0.1, vib=(5.0, 0.007, 0.25),
                    breath=0.06, lvl=0, pan=-0.1, echo=0.2, rev=0.3),
    "glass":   dict(mods=[M(2, 0.3, 0.5, 0.5)], a=0.09, d=0.8, s=0.8, r=0.5, vib=(4.5, 0.006, 0.3),
                    lvl=0, pan=0.0, echo=0.45, rev=0.4),
    "vibes":   dict(mods=[M(4, 0.5, 0.4, 0.0)], a=0.003, d=1.4, s=0.0, r=1.0, trem=(5.5, 0.3),
                    lvl=-6, pan=0.3, echo=0.25, rev=0.3),
    "pulse":   dict(type="pulse", duty=0.25, pwm=(0.7, 0.1), a=0.005, d=0.25, s=0.7, r=0.06,
                    vib=(6.0, 0.008, 0.2), lvl=-1, pan=0.0, echo=0.2, rev=0.12),
    "sqarp":   dict(type="pulse", duty=0.125, a=0.002, d=0.12, s=0.3, r=0.04, lvl=-12, pan=0.35,
                    echo=0.2, rev=0.1),
    "bass_fm": dict(mods=[M(1, 3.0, 0.07, 0.25, fb=0.4)], a=0.004, d=0.3, s=0.6, r=0.05, lvl=-3),
    "bass_round": dict(mods=[M(1, 0.9, 0.25, 0.35)], a=0.01, d=0.6, s=0.6, r=0.1, lvl=-3),
    "bass_pizz": dict(mods=[M(1, 1.6, 0.06, 0.1)], a=0.003, d=0.35, s=0.0, r=0.12, lvl=-3),
    "bass_dist": dict(mods=[M(1, 3.5, 0.15, 0.5, fb=0.6), M(0.5, 1.0, 0.1, 0.3)], a=0.003, d=0.2,
                      s=0.7, r=0.04, drive=2.5, lvl=-3),
    "power":   dict(mods=[M(1, 3.0, 0.2, 0.6, fb=0.5), M(2, 0.8)], a=0.004, d=0.4, s=0.6, r=0.06,
                    drive=3.0, detune=8, width=0.7, lvl=-7, rev=0.15),
    "harpsi":  dict(mods=[M(3, 1.8, 0.04, 0.1), M(1, 1.0, 0.1, 0.2)], cwave=1, a=0.001, d=0.5, s=0.0,
                    r=0.2, lvl=-9, pan=0.3, echo=0.15, rev=0.2),
    "timp":    dict(mods=[M(1, 1.2, 0.05, 0.1)], a=0.003, d=0.7, s=0.0, r=0.6, bend=1.04, lvl=-5,
                    rev=0.3),
}

# default level (dB) and pan of each percussion voice
DRUM_MIX = {
    "kick": (-4, 0.0, 0.0), "kick_hard": (-3, 0.0, 0.0), "snare": (-7, 0.05, 0.2), "clap": (-8, -0.1, 0.25),
    "rim": (-12, 0.2, 0.15), "hat": (-15, 0.3, 0.05), "ohat": (-15, 0.3, 0.1), "shaker": (-17, -0.35, 0.05),
    "tamb": (-15, 0.4, 0.1), "crash": (-12, -0.2, 0.2), "tom_lo": (-8, -0.3, 0.2), "tom_hi": (-9, 0.3, 0.2),
    "anvil": (-9, 0.35, 0.2), "clank": (-11, -0.4, 0.15), "clink": (-12, 0.45, 0.2), "piston": (-15, -0.5, 0.1),
    "wood": (-12, 0.3, 0.15), "drip": (-13, 0.0, 0.35), "chirp": (-16, 0.5, 0.3), "bongo_lo": (-11, -0.3, 0.1),
    "bongo_hi": (-12, 0.3, 0.1), "snap": (-14, -0.2, 0.25), "glass": (-12, 0.4, 0.35), "sub": (-8, 0.0, 0.0),
}


def wave(ph: np.ndarray, w: int) -> np.ndarray:
    """OPL-style operator waveforms: 0 sine, 1 half-sine, 2 abs-sine (DC removed)."""
    s = np.sin(ph)
    if w == 1:
        return (np.maximum(s, 0.0) - 1 / np.pi) * 1.6
    if w == 2:
        return (np.abs(s) - 2 / np.pi) * 1.6
    return s


def _blep(ph, dt):
    y = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] = x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] = x * x + x + x + 1
    return y


def pulse_wave(fv: np.ndarray, duty) -> np.ndarray:
    dt = np.clip(fv / SR, 1e-7, 0.5)
    ph = np.cumsum(dt) % 1.0
    duty = np.broadcast_to(np.asarray(duty, dtype=float), ph.shape)
    y = np.where(ph < duty, 1.0, -1.0) + _blep(ph, dt) - _blep((ph - duty) % 1.0, dt)
    return y - (2 * duty - 1)


def synth(p: dict, f: float, dur: float, vel: float, rng) -> np.ndarray:
    a, d, s, r = max(p["a"], 0.002), p["d"], p["s"], p["r"]
    ring = dur if s > 0 else min(dur, a + 6 * d)
    n = int((ring + 5 * r) * SR) + 64
    t = np.arange(n) / SR
    fv = np.full(n, f)
    if "bend" in p:
        fv *= 1 + (p["bend"] - 1) * np.exp(-t / 0.04)
    if "vib" in p:
        rate, depth, delay = p["vib"]
        fv *= 1 + depth * np.sin(2 * np.pi * rate * t) * np.clip((t - delay) / 0.25, 0, 1)
    if p.get("type") == "pulse":
        duty = p["duty"]
        if "pwm" in p:
            duty = duty + p["pwm"][1] * np.sin(2 * np.pi * p["pwm"][0] * t)
        sig = pulse_wave(fv, duty) * 0.7
    else:
        ph = 2 * np.pi * np.cumsum(fv) / SR
        mod = 0.0
        vs = 0.55 + 0.45 * vel
        for m in p["mods"]:
            ienv = m["index"] * vs * (m["ifloor"] + (1 - m["ifloor"]) * np.exp(-t / m["idecay"]))
            if m["iatk"] > 0:
                ienv = ienv * np.minimum(1.0, 0.3 + 0.7 * t / m["iatk"])
            mph = ph * m["ratio"]
            if m["fb"]:
                mph = mph + m["fb"] * np.sin(mph)
            mod = mod + ienv * wave(mph, m["wave"])
        sig = wave(ph + mod, p.get("cwave", 0))
    if p.get("breath"):
        nz = np.convolve(rng.uniform(-1, 1, n), np.ones(5) / 5, "same")
        sig = sig + p["breath"] * 4 * nz * (0.35 + 0.65 * np.exp(-t / 0.08))
    if p.get("drive"):
        k = p["drive"]
        sig = np.tanh(k * sig) / np.tanh(k)
    env = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    nh = int(ring * SR)
    if nh < n:
        lvl = env[max(nh - 1, 0)]
        env[nh:] = lvl * np.exp(-(t[nh:] - t[nh]) / r)
    env[-64:] *= np.linspace(1, 0, 64)
    sig = sig * env * vel
    if "trem" in p:
        rate, depth = p["trem"]
        sig *= 1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t))
    return sig


# --------------------------------------------------------------------------- percussion


def _lp(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole low-pass as a convolution with its (truncated) impulse response."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    k = int(min(len(x), np.ceil(np.log(1e-4) / np.log(a)) + 1))
    h = (1 - a) * a ** np.arange(k)
    return np.convolve(x, h)[: len(x)]


def _hp(x, cutoff):
    return x - _lp(x, cutoff)


def _t(sec):
    return np.arange(int(sec * SR)) / SR


def _ramp(x, ms=1.0):
    k = max(2, int(SR * ms / 1000))
    x[:k] *= np.linspace(0, 1, k)
    x[-k:] *= np.linspace(1, 0, k)
    return x


def _partials(t, freqs, taus, amps):
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / tau) for f, tau, a in zip(freqs, taus, amps))


def make_drum(name: str, rng) -> np.ndarray:
    nz = lambda sec: rng.uniform(-1, 1, int(sec * SR))
    if name in ("kick", "kick_hard"):
        hard = name == "kick_hard"
        t = _t(0.4)
        f = 44 + (190 if hard else 140) * np.exp(-t / 0.03)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.2 if hard else 0.16))
        click = _lp(nz(0.4), 3000) * np.exp(-t / 0.004) * 0.5
        x = x + click
        if hard:
            x = np.tanh(2.2 * x) / np.tanh(2.2)
        return _ramp(x, 0.7)
    if name == "snare":
        t = _t(0.3)
        tone = (np.sin(2 * np.pi * 185 * t) + 0.5 * np.sin(2 * np.pi * 330 * t)) * np.exp(-t / 0.045)
        body = _hp(nz(0.3), 1200) * np.exp(-t / 0.1)
        return _ramp(0.55 * tone + body)
    if name == "clap":
        t = _t(0.3)
        env = np.exp(-t / 0.09)
        for d in (0.0, 0.011, 0.022):
            env = np.maximum(env, (t >= d) * np.exp(-np.clip(t - d, 0, None) / 0.006))
        return _ramp(_lp(_hp(nz(0.3), 900), 5000) * env)
    if name == "rim":
        t = _t(0.06)
        return _ramp(np.sin(2 * np.pi * 1650 * t + 1.5 * np.sin(2 * np.pi * 3700 * t)) * np.exp(-t / 0.012)
                     + _hp(nz(0.06), 3000) * np.exp(-t / 0.004) * 0.6)
    if name in ("hat", "ohat"):
        sec, tau = (0.08, 0.025) if name == "hat" else (0.4, 0.14)
        t = _t(sec)
        metal = sum(np.sign(np.sin(2 * np.pi * f * t)) for f in (3140, 4270, 5190, 6560)) * 0.15
        return _ramp(_hp(0.6 * nz(sec) + metal, 6500) * np.exp(-t / tau))
    if name == "shaker":
        t = _t(0.12)
        env = np.clip(t / 0.012, 0, 1) * np.exp(-np.clip(t - 0.012, 0, None) / 0.035)
        return _ramp(_lp(_hp(nz(0.12), 4500), 11000) * env)
    if name == "tamb":
        t = _t(0.2)
        jingle = _partials(t, (5200, 6800, 8100), (0.06, 0.05, 0.04), (0.3, 0.25, 0.2))
        return _ramp(_hp(nz(0.2), 5000) * np.exp(-t / 0.06) + jingle)
    if name == "crash":
        t = _t(1.8)
        return _ramp(_lp(_hp(nz(1.8), 3000), 11000) * np.exp(-t / 0.55) * (0.4 + 0.6 * np.clip(t / 0.01, 0, 1)))
    if name in ("tom_lo", "tom_hi"):
        f0 = 95 if name == "tom_lo" else 150
        t = _t(0.4)
        f = f0 * (1 + 0.5 * np.exp(-t / 0.05))
        return _ramp(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) + _lp(nz(0.4), 2000) * np.exp(-t / 0.01) * 0.3)
    if name == "anvil":
        t = _t(0.9)
        ph = 2 * np.pi * 830 * t
        x = np.sin(ph + 4 * np.exp(-t / 0.05) * np.sin(1.414 * ph)) * np.exp(-t / 0.25)
        x += _partials(t, (2270, 3410), (0.18, 0.1), (0.3, 0.2))
        return _ramp(x + _hp(nz(0.9), 4000) * np.exp(-t / 0.004))
    if name == "clank":
        t = _t(0.45)
        f0 = 380 * (1 + 0.05 * rng.random())
        x = _partials(t, [f0 * r for r in (1, 1.47, 2.09, 2.56, 3.2)], (0.12, 0.09, 0.07, 0.05, 0.04), (1, 0.7, 0.5, 0.4, 0.3))
        return _ramp(x + _lp(nz(0.45), 3000) * np.exp(-t / 0.01))
    if name == "clink":
        t = _t(0.25)
        f0 = 1850 * (1 + 0.08 * rng.random())
        x = _partials(t, (f0, f0 * 2.37, f0 * 3.9), (0.07, 0.04, 0.03), (1, 0.5, 0.3))
        return _ramp(x + _hp(nz(0.25), 5000) * np.exp(-t / 0.003) * 0.8)
    if name == "piston":
        t = _t(0.7)
        env = np.clip(t / 0.3, 0, 1) ** 2 * np.exp(-np.clip(t - 0.3, 0, None) / 0.08)
        return _ramp(_hp(_lp(nz(0.7), 7000), 1500) * env)
    if name == "wood":
        t = _t(0.1)
        ph = 2 * np.pi * 980 * t
        return _ramp(np.sin(ph + 1.5 * np.exp(-t / 0.01) * np.sin(2.3 * ph)) * np.exp(-t / 0.03))
    if name == "drip":
        t = _t(0.18)
        f0 = 700 + 900 * rng.random()
        f = f0 * (1 + 1.2 * np.clip(t / 0.05, 0, 1))
        return _ramp(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035))
    if name == "chirp":
        out = np.zeros(int(0.3 * SR))
        pos = 0
        for _ in range(2 + int(rng.random() * 2)):
            sec = 0.04 + 0.03 * rng.random()
            t = _t(sec)
            f0 = 2600 + 1400 * rng.random()
            f = f0 + f0 * 0.5 * np.sin(np.pi * t / sec)
            x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / sec)
            out[pos:pos + len(x)] += x[: len(out) - pos]
            pos += len(x) + int(SR * (0.02 + 0.03 * rng.random()))
            if pos >= len(out):
                break
        return _ramp(out)
    if name in ("bongo_lo", "bongo_hi"):
        f0 = 210 if name == "bongo_lo" else 330
        t = _t(0.2)
        f = f0 * (1 + 0.15 * np.exp(-t / 0.02))
        return _ramp(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07) + _hp(nz(0.2), 2000) * np.exp(-t / 0.005) * 0.4)
    if name == "snap":
        t = _t(0.1)
        return _ramp(_lp(_hp(nz(0.1), 1800), 6000) * np.exp(-t / 0.018))
    if name == "glass":
        t = _t(1.6)
        ph = 2 * np.pi * 1760 * t
        return _ramp(np.sin(ph + 2 * np.exp(-t / 0.3) * np.sin(3.5 * ph)) * np.exp(-t / 0.5))
    if name == "sub":
        t = _t(0.6)
        f = 52 * (1 + 0.3 * np.exp(-t / 0.03))
        return _ramp(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2))
    raise KeyError(name)


VARIANTS = {"clank": 3, "clink": 4, "drip": 6, "chirp": 5, "hat": 2, "shaker": 2}

# =========================================================================== render


def pan_gains(p: float):
    ang = (p + 1) * np.pi / 4
    return np.cos(ang), np.sin(ang)


def freq(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def zinv(n_fft: int, nbins: int):
    return np.exp(-2j * np.pi * np.arange(nbins) / n_fft)


def circ_echo(x: np.ndarray, delay: int, fb: float, damp: float) -> np.ndarray:
    """Feedback delay with a damping low-pass, run as a circular filter (periodic in len(x))."""
    n = len(x)
    X = np.fft.rfft(x)
    z1 = zinv(n, len(X))
    a = np.exp(-2 * np.pi * damp / SR)
    lp = (1 - a) / (1 - a * z1)
    zd = np.exp(-2j * np.pi * np.arange(len(X)) * delay / n)
    H = zd * lp / (1 - fb * zd * lp)
    return np.fft.irfft(X * H, n)


def circ_reverb(x: np.ndarray, size: float, fb: float, damp: float, spread: int) -> np.ndarray:
    """Four damped combs into two allpasses (Schroeder/Freeverb shape), circular via FFT."""
    n = len(x)
    X = np.fft.rfft(x)
    k = np.arange(len(X))
    a = np.exp(-2 * np.pi * damp / SR)
    lp = (1 - a) / (1 - a * zinv(n, len(X)))
    H = np.zeros(len(X), dtype=complex)
    for ms in (29.7, 37.1, 41.1, 43.7):
        d = int(ms * size * SR / 1000) + spread
        zd = np.exp(-2j * np.pi * k * d / n)
        H += zd / (1 - fb * lp * zd)
    H *= 0.25
    for ms, g in ((5.0, 0.5), (1.7, 0.5)):
        d = int(ms * SR / 1000) + spread // 3
        zd = np.exp(-2j * np.pi * k * d / n)
        H *= (-g + zd) / (1 - g * zd)
    return np.fft.irfft(X * H, n)


def active_rms(x: np.ndarray) -> float:
    """Loudness of a stem while it plays: RMS over its louder 50 ms frames."""
    f = int(0.05 * SR)
    m = len(x) // f
    if m == 0:
        return float(np.sqrt(np.mean(x ** 2)) + 1e-12)
    pw = np.mean(x[: m * f].reshape(m, f) ** 2, axis=1)
    act = pw > pw.max() * 0.01
    return float(np.sqrt(pw[act].mean()) + 1e-12)


def soft_clip(x: np.ndarray, th: float = 0.7) -> np.ndarray:
    a = np.abs(x)
    over = a > th
    y = x.copy()
    y[over] = np.sign(x[over]) * (th + (1 - th) * np.tanh((a[over] - th) / (1 - th)))
    return y


def render(song: Song) -> np.ndarray:
    L = int(round(song.sec(song.total_beats) * SR))
    tail = int(TAIL_SEC * SR)
    N = L + tail
    stems = {}      # part -> stereo float32
    sends = {}      # part -> (echo, rev)

    def stem(part):
        if part not in stems:
            stems[part] = np.zeros((N, 2), dtype=np.float32)
        return stems[part]

    def put(buf, x, i0, pan):
        if i0 >= N:
            return
        x = x[: N - i0]
        gl, gr = pan_gains(pan)
        buf[i0:i0 + len(x), 0] += (x * gl).astype(np.float32)
        buf[i0:i0 + len(x), 1] += (x * gr).astype(np.float32)

    for part, inst, beat, dur, midi, vel in song.notes:
        p = INST[inst]
        i0 = int(round(song.sec(beat) * SR))
        buf = stem(part)
        pan = p.get("pan", 0.0)
        if p.get("detune"):
            c = p["detune"] / 1200
            w = p.get("width", 0.5)
            for sgn in (-1, 1):
                x = synth(p, freq(midi) * 2 ** (sgn * c), song.sec(dur), vel, song.rng) * 0.7
                put(buf, x, i0, float(np.clip(pan + sgn * w, -1, 1)))
        else:
            put(buf, synth(p, freq(midi), song.sec(dur), vel, song.rng), i0, pan)
        sends[part] = (p.get("echo", 0.0), p.get("rev", 0.0), p.get("lvl", 0.0))

    cache = {}
    for name, beat, vel in song.hits:
        if name not in cache:
            cache[name] = [make_drum(name, song.rng) for _ in range(VARIANTS.get(name, 1))]
        var = cache[name]
        x = var[int(song.rng.integers(len(var)))]
        x = x / (np.max(np.abs(x)) or 1.0)
        lvl, pan, rev = DRUM_MIX[name]
        put(stem(name), x * vel, int(round(song.sec(beat) * SR)), pan)
        sends[name] = (0.0, rev, lvl)

    # fold the tail onto the head (loop) or keep it (one-shot)
    for k in stems:
        s = stems[k]
        if song.loop:
            s[:tail] += s[L:]
            stems[k] = s[:L]
    n = L if song.loop else N

    mix = np.zeros((n, 2))
    esend = np.zeros(n)
    rsend = np.zeros(n)
    for part, s in stems.items():
        echo, rev, lvl = sends[part]
        lvl = song.levels.get(part, lvl)
        mono = s.mean(axis=1).astype(np.float64)
        g = 0.1 * 10 ** (lvl / 20) / active_rms(mono)
        mix += s * g
        esend += mono * g * echo
        rsend += mono * g * rev

    fx = song.fx
    if not song.loop:  # pad so the circular effects have room to ring out
        pad = int(4 * SR)
        mix = np.concatenate([mix, np.zeros((pad, 2))])
        esend = np.concatenate([esend, np.zeros(pad)])
        rsend = np.concatenate([rsend, np.zeros(pad)])
    d = int(song.sec(fx["echo_beats"]) * SR)
    mix[:, 0] += circ_echo(esend, d, fx["echo_fb"], fx["echo_damp"])
    mix[:, 1] += circ_echo(esend, int(d * 1.5), fx["echo_fb"], fx["echo_damp"])
    mix[:, 0] += circ_reverb(rsend, fx["rev_size"], fx["rev_fb"], fx["rev_damp"], 0) * 0.8
    mix[:, 1] += circ_reverb(rsend, fx["rev_size"], fx["rev_fb"], fx["rev_damp"], 23) * 0.8

    # master: remove DC and rumble below 25 Hz (circular, so the loop stays exact)
    X = np.fft.rfft(mix, axis=0)
    fr = np.fft.rfftfreq(len(mix), 1 / SR)
    X *= np.clip((fr - 15) / 15, 0, 1)[:, None]
    mix = np.fft.irfft(X, len(mix), axis=0)
    mix *= fx["target_rms"] / np.sqrt(np.mean(mix ** 2))
    mix = soft_clip(mix, 0.7)
    peak = np.max(np.abs(mix))
    if peak > 0.8:          # headroom: Vorbis overshoots transients by a few percent
        mix *= 0.8 / peak
    if not song.loop:
        mix = mix[: int(round(song.sec(song.total_beats) * SR))]
        k = int(0.3 * SR)
        mix[-k:] *= np.linspace(1, 0, k)[:, None] ** 2
    return mix


# =========================================================================== the pieces
# Degrees are relative to each track's key; octave=4 puts degree 1 in the 4th octave.

