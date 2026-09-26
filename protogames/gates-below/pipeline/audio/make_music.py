"""Background music for Gates Below: five original pieces, synthesised from the text
scores below with two-operator FM (no samples).

    python pipeline/audio/make_music.py

Writes godot/content/music/<track>.wav (16-bit mono, 22050 Hz).

Score syntax, one string per part:
    NOTE:DUR       e.g. D5:2  C#4:1  Bb3:3
    [N,N,..]:DUR   a chord
    r:DUR          a rest
    |              bar line (ignored; every part must add up to the same length)
DUR counts the track's unit (an eighth note in every piece).

Each loop is rendered twice and the second pass kept, so notes ringing past the end of
the loop are already sounding at its start: the seam cannot be heard.
"""
import os
import re
import wave

import numpy as np

SR = 22050
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "godot", "content", "music")
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

INSTRUMENTS = {
    "bass":   dict(ratio=1.0, index=1.6, floor=0.2, idecay=0.15, a=0.005, d=0.4, s=0.3, r=0.08, gain=0.5),
    "organ":  dict(ratio=2.0, index=0.5, floor=1.0, idecay=1.0, a=0.12, d=1.0, s=0.8, r=0.4, gain=0.09, vib=(4.8, 0.002)),
    "lead":   dict(ratio=1.0, index=0.45, floor=1.0, idecay=1.0, a=0.06, d=1.5, s=0.85, r=0.2, gain=0.3, vib=(5.5, 0.01)),
    "pluck":  dict(ratio=3.0, index=2.2, floor=0.05, idecay=0.09, a=0.003, d=0.3, s=0.0, r=0.05, gain=0.36),
    "bell":   dict(ratio=3.5, index=2.0, floor=0.1, idecay=0.7, a=0.003, d=1.8, s=0.0, r=1.0, gain=0.3),
    "drone":  dict(ratio=1.0, index=0.9, floor=0.6, idecay=3.0, a=1.5, d=4.0, s=0.8, r=1.5, gain=0.14, vib=(0.25, 0.003)),
    "horn":   dict(ratio=1.0, index=1.1, floor=0.7, idecay=0.4, a=0.08, d=0.8, s=0.7, r=0.25, gain=0.24, vib=(5.0, 0.006)),
    "drum":   dict(kind="thump", gain=0.5),
    "drip":   dict(kind="drip", gain=0.12),
}

TRACKS = {
    # Title: D dorian waltz, slow. The call (D-E-F-A) is the game's motif.
    "title": dict(unit=60 / 150, parts=[
        ("bass", "D2:6 | D2:6 | C2:6 | A1:6 | Bb1:6 | F2:6 | G1:6 | A1:6 |"
                 "D2:6 | D2:6 | C2:6 | A1:6 | Bb1:6 | F2:6 | A1:6 | D2:6 |"),
        ("organ", "[D3,F3,A3]:6 | [D3,F3,A3]:6 | [C3,E3,G3]:6 | [A2,C3,E3]:6 | [Bb2,D3,F3]:6 | [A2,C3,F3]:6 | [G2,Bb2,D3]:6 | [A2,C#3,E3]:6 |"
                  "[D3,F3,A3]:6 | [D3,F3,A3]:6 | [C3,E3,G3]:6 | [A2,C3,E3]:6 | [Bb2,D3,F3]:6 | [A2,C3,F3]:6 | [A2,C#3,E3]:6 | [D3,F3,A3]:6 |"),
        ("lead", "D5:4 E5:2 | F5:4 A5:2 | G5:3 F5:1 E5:2 | E5:6 | F5:2 D5:2 Bb4:2 | C5:4 A4:2 | Bb4:2 C5:2 D5:2 | C#5:6 |"
                 "D5:4 F5:2 | A5:4 D6:2 | C6:3 Bb5:1 A5:2 | A5:6 | Bb5:2 A5:2 G5:2 | F5:4 A5:2 | G5:2 E5:2 C#5:2 | D5:6 |"),
    ]),
    # Level 1: A minor, a tiptoeing walk: pizzicato bass under a plucked tune.
    "cellars": dict(unit=60 / 200, parts=[
        ("bass", "A2:2 E3:2 A2:2 E3:2 | G2:2 D3:2 G2:2 D3:2 | F2:2 C3:2 F2:2 C3:2 | E2:2 B2:2 E2:2 G#2:2 |"
                 "A2:2 C3:2 E3:2 C3:2 | D3:2 F3:2 A2:2 F3:2 | E2:2 G#2:2 B2:2 D3:2 | A2:2 E2:2 A2:4 |"),
        ("pluck", "r:2 E5:1 D5:1 C5:2 B4:2 | r:2 D5:1 C5:1 B4:2 G4:2 | r:2 C5:1 B4:1 A4:2 F4:2 | E4:4 G#4:4 |"
                  "A4:2 C5:2 E5:2 A5:2 | G5:2 F5:2 D5:2 A4:2 | B4:2 D5:2 G#5:2 E5:2 | A5:4 r:4 |"),
        ("organ", "[A3,C4,E4]:8 | [G3,B3,D4]:8 | [F3,A3,C4]:8 | [E3,G#3,B3]:8 | [A3,C4,E4]:8 | [D3,F3,A3]:8 | [E3,G#3,D4]:8 | [A3,C4,E4]:8 |"),
    ]),
    # Level 2: E phrygian drone, water, a far bell.
    "cistern": dict(unit=60 / 130, parts=[
        ("drone", "E2:32 | E2:32 |"),
        ("organ", "[E3,B3]:16 [F3,C4]:16 | [E3,B3]:16 [D3,A3]:16 |"),
        ("bell", "r:4 B5:2 r:2 C6:4 r:4 | B5:2 A5:2 G5:4 r:8 | r:8 E5:2 F5:2 G5:4 | F5:8 r:8 |"),
        ("drip", "r:3 C7:1 r:6 G6:1 r:5 | r:9 E7:1 r:6 | r:2 D7:1 r:9 A6:1 r:3 | r:12 C7:1 r:3 |"),
    ]),
    # Level 3: C minor, a slow march toward the Gate: organ, horn, drum.
    "gatehall": dict(unit=60 / 150, parts=[
        ("bass", "C2:8 | Ab1:8 | F1:8 | G1:8 | C2:8 | Eb2:8 | Bb1:8 | G1:8 |"),
        ("organ", "[C3,Eb3,G3]:8 | [C3,Eb3,Ab3]:8 | [C3,F3,Ab3]:8 | [B2,D3,G3]:8 | [C3,Eb3,G3]:8 | [Eb3,G3,Bb3]:8 | [D3,F3,Bb3]:8 | [B2,D3,G3]:8 |"),
        ("horn", "G4:8 | Ab4:4 C5:4 | F4:8 | G4:6 B4:2 | C5:8 | Bb4:4 G4:4 | F4:4 D4:4 | G4:8 |"),
        ("drum", "C2:2 r:6 | C2:2 r:6 | C2:2 r:6 | C2:2 r:2 C2:2 r:2 | C2:2 r:6 | C2:2 r:6 | C2:2 r:6 | C2:2 r:2 C2:1 C2:1 C2:2 |"),
    ]),
    # Ending: the title call, now in D major.
    "ending": dict(unit=60 / 150, parts=[
        ("bass", "D2:6 | D2:6 | G1:6 | A1:6 | B1:6 | F#2:6 | G1:6 | A1:3 D2:3 |"),
        ("organ", "[D3,F#3,A3]:6 | [D3,F#3,A3]:6 | [G2,B2,D3]:6 | [A2,C#3,E3]:6 | [B2,D3,F#3]:6 | [A2,C#3,F#3]:6 | [G2,B2,D3]:6 | [A2,C#3,E3]:3 [D3,F#3,A3]:3 |"),
        ("lead", "D5:4 E5:2 | F#5:4 A5:2 | G5:3 F#5:1 E5:2 | E5:6 | F#5:2 D5:2 B4:2 | C#5:4 A4:2 | B4:2 C#5:2 E5:2 | D5:6 |"),
    ]),
}


def midi(name: str) -> int:
    m = re.fullmatch(r"([A-G])(#|b)?(-?\d)", name)
    if not m:
        raise ValueError(name)
    n = NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return 12 * (int(m.group(3)) + 1) + n


def freq(n: int) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def parse(score: str):
    """-> list of (start_units, dur_units, [midi notes]); total length in units."""
    events, pos = [], 0.0
    for tok in score.replace("|", " ").split():
        head, dur = tok.rsplit(":", 1)
        dur = float(dur)
        if head != "r":
            notes = [midi(x) for x in head.strip("[]").split(",")]
            events.append((pos, dur, notes))
        pos += dur
    return events, pos


def voice(inst: dict, f: float, sec: float) -> np.ndarray:
    kind = inst.get("kind", "fm")
    if kind == "thump":
        n = int(SR * 0.35)
        tt = np.arange(n) / SR
        return np.sin(2 * np.pi * np.geomspace(90, 40, n) * tt) * np.exp(-tt / 0.09)
    if kind == "drip":
        n = int(SR * 0.25)
        tt = np.arange(n) / SR
        return np.sin(2 * np.pi * np.cumsum(np.geomspace(f * 0.6, f * 1.4, n)) / SR) * np.exp(-tt / 0.04)
    rel = inst["r"]
    n = int(SR * (sec + rel))
    tt = np.arange(n) / SR
    fv = np.full(n, f)
    if "vib" in inst:
        rate, depth = inst["vib"]
        fv = f * (1 + depth * np.sin(2 * np.pi * rate * tt) * np.clip(tt / 0.3, 0, 1))
    ph = 2 * np.pi * np.cumsum(fv) / SR
    idx = inst["index"] * (inst["floor"] + (1 - inst["floor"]) * np.exp(-tt / inst["idecay"]))
    sig = np.sin(ph + idx * np.sin(ph * inst["ratio"]))
    # ADSR: attack, decay to sustain while held, release after
    e = np.ones(n) * inst["s"]
    na, nd, nh = int(SR * inst["a"]), int(SR * inst["d"]), int(SR * sec)
    e[:na] = np.linspace(0, 1, max(na, 1))[:na]
    dec = np.linspace(1, inst["s"], max(nd, 1))
    e[na:na + nd] = dec[:max(0, min(nd, n - na))]
    level = e[min(nh, n - 1)] if nh < n else inst["s"]
    e[nh:] = level * np.exp(-np.arange(n - nh) / (SR * max(rel, 0.01) / 3))
    return sig * e


def render(track: dict) -> np.ndarray:
    unit = track["unit"]
    lengths = set()
    parsed = []
    for inst_name, score in track["parts"]:
        ev, total = parse(score)
        lengths.add(total)
        parsed.append((INSTRUMENTS[inst_name], ev))
    assert len(lengths) == 1, f"parts differ in length: {lengths}"
    total = lengths.pop()
    loop = int(SR * total * unit)
    buf = np.zeros(loop * 2 + SR * 4)
    for inst, ev in parsed:
        for rep in range(2):
            for (pos, dur, notes) in ev:
                for n in notes:
                    v = voice(inst, freq(n), dur * unit * 0.95) * inst["gain"]
                    i0 = int(SR * pos * unit) + rep * loop
                    buf[i0:i0 + len(v)] += v
    # the second pass: its start already carries the tails of the first pass's last notes
    return buf[loop:loop * 2].copy()


def write(name: str, x: np.ndarray) -> None:
    peak = np.max(np.abs(x)) or 1.0
    x = x / peak * 0.85
    pcm = (x * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, tr in TRACKS.items():
        x = render(tr)
        write(name, x)
        print(f"{name}: {len(x) / SR:.1f} s")


if __name__ == "__main__":
    main()
