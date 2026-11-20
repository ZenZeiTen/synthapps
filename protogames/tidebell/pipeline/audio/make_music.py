"""Music for Tidebell: thirteen original pieces, synthesised with the shared engine
(synth.py: FM voices, pulse waves, noise percussion; no samples).

    python3 pipeline/audio/make_music.py             # all tracks
    python3 pipeline/audio/make_music.py reach over  # some tracks

Writes content/music/<track>.ogg for both builds (Vorbis, stereo, 32000 Hz).

The game's theme (THEME) climbs from the fifth below up to the third and falls back; the
bells answer it with a falling arpeggio (BELLS, 8-5-3-1). The theme opens the title, the
Lantern-house, the stage-clear jingle and the ending; the bell figure closes most pieces.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from synth import OUTS, SR, Song, join, mel, ornament, render, shift  # noqa: E402

VORBIS_COMPRESSION = 0.75      # libsndfile maps this to Vorbis quality ~0.25 (the 7z size budget)

THEME = ["5,:1 1:1 2:1 3:1", "5:2 4:1 3:1", "2:1 3:1 4:1 2:1", "1:3 5,:1",
         "6,:1 1:1 3:1 5:1", "6:2 5:1 3:1", "4:1 3:1 2:1 7,:1", "1:4"]
THEME_PROG = "1 | 3 | 7 | 1 | 6 | 4 | 5 | 1"
BELLS = "1':1 5:1 3:1 1:1"


def bells(s: Song, beat: float, base: int = 74, vel: float = 0.55) -> None:
    """The bell figure on the bell instrument: a falling arpeggio from `base` (MIDI)."""
    for i, d in enumerate((12, 7, 3, 0)):
        s.add("bell", "bell", beat + i * 0.5, 2.0, base + d - 12, vel)


def track_title() -> Song:
    """D minor, 96 bpm, 16 bars: the theme on the horn over harp and strings, then again
    an octave up on the flute with a second voice; bells at the ends of phrases."""
    s = Song("D", "minor", 96, 4, 16, seed=1)
    s.prog(0, THEME_PROG)
    s.prog(8, THEME_PROG)
    theme = " | ".join(THEME)
    s.melody("horn", theme, 0, 4, 0.8, bars=8)
    s.melody("flute", ornament(theme, 2.0, 0.5), 8, 5, 0.8, bars=8)
    s.harmony("horn", theme, 8, 5, 0.5)
    s.grid("harp", "12343234", range(16), kind="arp", center=62, vel=0.65)
    s.grid("bass_round", "R---5---R---8-5-", range(16), octave=2, vel=0.75)
    s.pad("strings", range(16), center=58, vel=0.5)
    s.drums(range(8, 16), {"kick": "x.......x.......", "tamb": "....x.......x...", "shaker": "..o...o...o...o."})
    for b in (7, 15):
        bells(s, b * 4, 74)
    s.hit("crash", 32, 0.6)
    s.fx.update(echo_beats=1.5, rev_size=1.2, target_rms=0.14)
    return s


def track_house() -> Song:
    """F major, 84 bpm, 8 bars: the Lantern-house. Soft electric piano and vibes, the
    theme's first half in the major, the bell figure to close."""
    s = Song("F", "major", 84, 4, 8, seed=2)
    s.prog(0, "1 | 6 | 4 | 5 | 1 | 3 | 4 5 | 1")
    s.melody("vibes", " | ".join(THEME[:4]) + " | " + " | ".join(["3:2 2:1 1:1", "5:3 r:1", "4:1 3:1 2:1 5,:1", "1:4"]),
             0, 5, 0.6, bars=8)
    s.grid("epiano", "1-3-2-3-", range(8), kind="arp", center=60, vel=0.55)
    s.grid("bass_round", "R-----5-", range(8), octave=2, vel=0.6)
    s.drums(range(8), {"shaker": "..o...o...o...o."})
    bells(s, 28, 77, 0.4)
    s.fx.update(echo_beats=0.75, rev_size=1.2, target_rms=0.12)
    return s


def track_reach() -> Song:
    """E minor, 112 bpm, 16 bars: Mangrove Reach. Marimba ostinato, bongos and shakers, a
    pulse lead that answers itself; frogs and birds in the gaps."""
    s = Song("E", "minor", 112, 4, 16, seed=3)
    s.prog(0, "1 | 1 | 6 | 7 | 1 | 1 | 4 | 5")
    s.prog(8, "6 | 7 | 1 | 3 | 6 | 4 | 5 | 1")
    a = "1:0.5 3:0.5 5:1 4:0.5 3:0.5 2:1 | 2:1 3:1 5,:2 | 6,:0.5 1:0.5 3:1 2:0.5 1:0.5 2:1 | 7,:3 r:1"
    b = "3:0.5 5:0.5 1':1 7:0.5 5:0.5 6:1 | 6:1 5:1 3:2 | 4:0.5 3:0.5 2:1 1:1 7,:1 | 1:3 r:1"
    s.melody("pulse", join(a, b), 0, 4, 0.7, bars=8)
    s.melody("pulse", join(shift(a, 2), b), 8, 4, 0.7, bars=8)
    s.grid("marimba", "1.3.2.3.1.3.2.4.", range(16), kind="arp", center=64, vel=0.6)
    s.grid("bass_pizz", "R..R..5.R..R.8..", range(16), octave=2, vel=0.8)
    s.drums(range(16), {"bongo_lo": "x..x..x.x..x..x.", "bongo_hi": "..x...x...x..x.x", "shaker": "xoxoxoxoxoxoxoxo"})
    for bar in (3, 7, 11, 15):
        s.hit("chirp", bar * 4 + 2.5, 0.6)
    bells(s, 60, 76, 0.4)
    s.fx.update(echo_beats=0.75, rev_size=0.9, target_rms=0.15)
    return s


def track_harbor() -> Song:
    """G major, 6/8 (one beat an eighth, 216), 16 bars: Lantern Harbor. A rolling shanty on
    a reedy organ with a pizzicato bass and a stomping kick."""
    s = Song("G", "major", 216, 6, 16, seed=4)
    s.prog(0, "1 | 5 | 1 | 5 | 1 | 4 | 5 | 1")
    s.prog(8, "4 | 1 | 5 | 6 | 4 | 1 | 5 | 1")
    a = ["5,:2 1:1 1:2 2:1", "3:2 2:1 7,:3", "5,:2 1:1 1:2 3:1", "2:6",
         "3:2 4:1 5:2 5:1", "6:2 4:1 1':3", "7:2 5:1 2:2 7,:1", "1:6"]
    b = ["6:2 5:1 4:2 6:1", "5:2 3:1 1:3", "2:2 3:1 4:2 2:1", "3:3 5:3",
         "6:2 1':1 6:2 4:1", "5:2 3:1 1:3", "2:2 7,:1 5,:2 2:1", "1:6"]
    s.melody("organ", " | ".join(a), 0, 4, 0.8, bars=8)
    s.melody("organ", " | ".join(b), 8, 4, 0.8, bars=8)
    s.harmony("flute", " | ".join(b), 8, 5, 0.45)
    s.grid("bass_pizz", "R..5..", range(16), octave=2, vel=0.85)
    s.grid("harpsi", ".C..C.", range(16), kind="chord", center=60, vel=0.4)
    s.drums(range(16), {"kick": "x..x..", "tamb": "...x.x", "clap": lambda b: "......" if b % 2 == 0 else "...x.."})
    bells(s, 15 * 6, 79, 0.4)
    s.fx.update(echo_beats=3, rev_size=1.0, target_rms=0.15)
    return s


def track_village() -> Song:
    """A major, 120 bpm, 16 bars: the Stilt Village. Harp and flute over a light shuffle,
    a xylophone answer, bright and easy."""
    s = Song("A", "major", 120, 4, 16, seed=5)
    s.prog(0, "1 | 4 | 1 | 5 | 6 | 4 | 2 | 5")
    s.prog(8, "1 | 3 | 4 | 1 | 2 | 5 | 4 5 | 1")
    a = "3:1 5:1 6:0.5 5:0.5 3:1 | 2:1 3:0.5 2:0.5 1:2 | 3:1 5:1 1':1 7:1 | 6:2 5:2"
    b = "6:1 5:0.5 4:0.5 3:1 1:1 | 4:1 3:0.5 2:0.5 5,:2 | 6,:1 1:1 3:1 2:1 | 1:4"
    s.melody("flute", join(a, b), 0, 5, 0.7, bars=8)
    s.melody("xylo", join(shift(a, 2), b), 8, 5, 0.6, bars=8)
    s.grid("harp", "1232", range(16), kind="arp", center=64, vel=0.55)
    s.grid("bass_round", "R.5.8.5.", range(16), octave=2, vel=0.7)
    s.drums(range(16), {"kick": "x...x...", "wood": "..x...x.", "shaker": "oooooooo"})
    bells(s, 60, 81, 0.4)
    s.fx.update(echo_beats=1.0, rev_size=1.0, target_rms=0.14)
    return s


def track_cliffs() -> Song:
    """C major, 128 bpm, 16 bars: Gullstone Cliffs. A climbing brass tune in fourths over
    driving strings; the second half rises a step."""
    s = Song("C", "major", 128, 4, 16, seed=6)
    s.prog(0, "1 | b7 | 4 | 1 | 1 | b7 | 4 | 5")
    s.prog(8, "2 | 1 | 5 | 6 | 4 | 5 | 1 | 1")
    a = "1:1 4:1 5:2 | b7:1 6:1 5:2 | 4:1 5:1 6:1 1':1 | 5:4"
    b = "1:1 4:1 5:2 | b7:1 1':1 2':2 | 1':1 7:1 6:1 5:1 | 5:3 r:1"
    c = "2':2 1':1 6:1 | 5:2 3:1 1:1 | 2:1 3:1 5:1 7:1 | 6:4"
    d = "4:1 6:1 1':2 | 7:1 5:1 2':2 | 1':4 | 1':3 r:1"
    s.melody("brass", join(a, b), 0, 4, 0.8, bars=8)
    s.melody("brass", join(c, d), 8, 4, 0.85, bars=8)
    s.harmony("horn", join(c, d), 8, 4, 0.5)
    s.grid("strings", "1.2.3.2.1.2.3.4.", range(16), kind="arp", center=60, vel=0.45)
    s.grid("bass_fm", "R.RR.R5.R.RR.8.5", range(16), octave=2, vel=0.75)
    s.drums(range(16), {"kick": "x...x...x...x...", "snare": "....x.......x...", "hat": "x.x.x.x.x.x.x.x."})
    s.hit("crash", 32, 0.7)
    bells(s, 60, 84, 0.4)
    s.fx.update(echo_beats=0.75, rev_size=1.1, target_rms=0.15)
    return s


def track_abbey() -> Song:
    """C minor, 72 bpm, 16 bars: the Drowned Abbey. Slow organ and choir, a distant bell
    on the first beat of every other bar, drips."""
    s = Song("C", "minor", 72, 4, 16, seed=7)
    s.prog(0, "1 | 6 | 4 | 5 | 1 | 7 | 6 | 5")
    s.prog(8, "4 | 1 | b2M | 5 | 1 | 6 | 4 5 | 1")
    a = "5:3 4:1 | 3:2 2:2 | 1:3 2:1 | 7,:4 | 5:3 6:1 | 7:2 1':2 | 6:3 5:1 | 5:4"
    b = "6:3 5:1 | 4:2 3:2 | b2:3 1:1 | 7,:4 | 1:2 3:2 | 6:2 5:2 | 4:2 2:2 | 1:4"
    s.melody("choir", a, 0, 4, 0.55, bars=8)
    s.melody("glass", b, 8, 5, 0.5, bars=8)
    s.pad("organ", range(16), center=55, vel=0.45)
    s.grid("bass_round", "R-------", range(16), octave=2, vel=0.6)
    for bar in range(0, 16, 2):
        s.add("bell", "bell", bar * 4, 3.0, 60, 0.45)
    for i in range(10):
        s.hit("drip", 2 + i * 6.3, 0.5)
    s.fx.update(echo_beats=2, echo_fb=0.45, rev_size=1.5, rev_fb=0.85, target_rms=0.12)
    return s


def track_brinecrow() -> Song:
    """D minor, 140 bpm, 16 bars: the Brinecrow's decks. Distorted bass and power chords,
    a pulse lead built on the theme's opening, turned sharp."""
    s = Song("D", "minor", 140, 4, 16, seed=8)
    s.prog(0, "1 | 1 | 6 | 7 | 1 | 1 | 4 | 5")
    s.prog(8, "6 | 7 | 1 | 1 | 4 | 5 | 6 5 | 1")
    a = "5,:0.5 1:0.5 2:0.5 3:0.5 5:1 4:0.5 3:0.5 | 2:1 3:1 1:2 | 5,:0.5 1:0.5 2:0.5 3:0.5 6:1 5:0.5 4:0.5 | 3:2 2:2"
    b = "3:1 5:1 1':1 7:1 | 6:1 5:1 3:2 | 4:1 3:1 2:1 7,:1 | 1:3 r:1"
    s.melody("pulse", join(a, b), 0, 4, 0.75, bars=8)
    s.melody("pulse", join(shift(a, 2), b), 8, 4, 0.8, bars=8)
    s.grid("power", "P...P...P.P.P...", range(16), octave=3, vel=0.5)
    s.grid("bass_dist", "R.R.R.RRR.R.R.5.", range(16), octave=1, vel=0.8)
    s.drums(range(16), {"kick_hard": "x..x..x.x..x..x.", "snare": "....x.......x...", "hat": "xxxxxxxxxxxxxxxx"})
    s.hit("crash", 0, 0.7)
    s.hit("crash", 32, 0.7)
    s.fx.update(echo_beats=0.75, rev_size=0.8, target_rms=0.16)
    return s


def track_guardian() -> Song:
    """E minor (harmonic), 150 bpm, 8 bars: the guardian fights. Timpani and a fast
    bass on the root, brass stabs, a two-note alarm."""
    s = Song("E", "harmonic", 150, 4, 8, seed=9)
    s.prog(0, "1 | 1 | 6 | 5 | 1 | 1 | 4 | 5D7")
    s.melody("brass", "1:1.5 7,:0.5 1:2 | 3:1.5 2:0.5 1:2 | 6:1.5 5:0.5 4:2 | 7,:4 | "
                      "1:1.5 7,:0.5 1:2 | 5:1.5 4:0.5 3:2 | 4:1 5:1 6:1 7:1 | 7:4", 0, 4, 0.8, bars=8)
    s.grid("bass_fm", "RRRRRRRRRRRRRR5R", range(8), octave=2, vel=0.75)
    s.grid("strings", "C...C...C...C.C.", range(8), kind="chord", center=60, vel=0.45)
    s.drums(range(8), {"kick_hard": "x...x...x...x...", "snare": "....x.......x.xx", "hat": "x.x.x.x.x.x.x.x."})
    for bar in range(8):
        s.add("timp", "timp", bar * 4, 1.0, 40, 0.8)
    s.fx.update(echo_beats=0.5, rev_size=0.9, target_rms=0.16)
    return s


def track_final() -> Song:
    """C minor (harmonic), 164 bpm, 16 bars: the Silt King. Choir and power chords over a
    galloping bass; the theme returns in the minor, broken up."""
    s = Song("C", "harmonic", 164, 4, 16, seed=10)
    s.prog(0, "1 | 6 | 4 | 5 | 1 | 6 | b2M | 5")
    s.prog(8, "4 | 5 | 1 | 6 | 4 | 5D7 | 1 | 5")
    s.melody("choir", "1:4 | 6,:4 | 4,:4 | 5,:4 | 1:4 | 6,:4 | b2:4 | 7,:4", 0, 4, 0.6, bars=8)
    theme = " | ".join(THEME)
    s.melody("brass", theme, 8, 4, 0.85, bars=8)
    s.grid("power", "P..P..P.P..P..P.", range(16), octave=3, vel=0.5)
    s.grid("bass_dist", "R.RR.RR.R.RR.R5.", range(16), octave=1, vel=0.8)
    s.drums(range(16), {"kick_hard": "x.xx.xx.x.xx.xx.", "snare": "....x.......x...", "crash": "x..............."})
    s.fx.update(echo_beats=0.5, rev_size=1.0, target_rms=0.16)
    return s


def track_clear() -> Song:
    """D major, 132 bpm: a four-second fanfare: the theme's climb, then the bells. Not
    looped."""
    s = Song("D", "major", 132, 9, 1, seed=11, loop=False, total_beats=9)
    s.prog_beats(0, [("1", 2), ("4", 1), ("5", 1), ("1", 5)])
    lead = "5,:0.5 1:0.5 2:0.5 3:0.5 5:1 4:0.5 3:0.5 1':3 r:2"
    s.melody("brass", lead, 0, 4, 0.9)
    s.harmony("horn", lead, 0, 4, 0.6)
    s.melody("bass_round", "1:2 4:1 5:1 1:3 r:2", 0, 2, 0.9)
    s.pad("strings", [0], center=62, vel=0.6)
    bells(s, 4, 86, 0.6)
    s.hit("crash", 4, 1.0)
    s.add("timp", "timp", 4, 2.0, 38, 1.0)
    s.fx.update(rev_size=1.3, target_rms=0.075)
    return s


def track_ending() -> Song:
    """D major, 80 bpm, 16 bars: the theme in the major, slow and warm, then the bells in
    full over the last four bars."""
    s = Song("D", "major", 80, 4, 16, seed=12)
    s.prog(0, "1 | 3 | 4 | 1 | 6 | 4 | 5 | 1")
    s.prog(8, "4 | 1 | 5 | 6 | 4 | 5 | 4 5 | 1")
    theme = " | ".join(THEME)
    s.melody("flute", theme, 0, 5, 0.75, bars=8)
    s.melody("horn", theme, 8, 4, 0.7, bars=8)
    s.harmony("strings", theme, 8, 5, 0.4)
    s.grid("harp", "12343234", range(16), kind="arp", center=64, vel=0.55)
    s.grid("bass_round", "R-----5-", range(16), octave=2, vel=0.65)
    s.pad("strings", range(16), center=58, vel=0.45)
    for bar in range(12, 16):
        bells(s, bar * 4, 74 + (bar - 12) * 2, 0.5)
    s.fx.update(rev_size=1.4, rev_fb=0.8, target_rms=0.13)
    return s


def track_over() -> Song:
    """D minor, 70 bpm, 4 bars: the tide takes the islands. Not looped."""
    s = Song("D", "minor", 70, 4, 4, seed=13, loop=False)
    s.prog(0, "1 | 6 | 4 | 5")
    s.melody("glass", "5:2 4:1 3:1 | 3:2 2:2 | 1:2 7,:2 | 1:4", 0, 4, 0.6, bars=4)
    s.pad("strings", range(4), center=57, vel=0.5)
    s.add("bell", "bell", 12, 4.0, 50, 0.5)
    s.fx.update(rev_size=1.5, target_rms=0.1)
    return s


TRACKS = {
    "title": track_title, "house": track_house, "reach": track_reach, "harbor": track_harbor,
    "village": track_village, "cliffs": track_cliffs, "abbey": track_abbey, "brinecrow": track_brinecrow,
    "guardian": track_guardian, "final": track_final, "clear": track_clear, "ending": track_ending,
    "over": track_over,
}


def main(names) -> None:
    for out in OUTS:
        os.makedirs(out, exist_ok=True)
    total = 0
    for name in names:
        song = TRACKS[name]()
        x = render(song)
        for out in OUTS:
            path = os.path.join(out, name + ".ogg")
            sf.write(path, x.astype(np.float32), SR, format="OGG", subtype="VORBIS",
                     compression_level=VORBIS_COMPRESSION)
        size = os.path.getsize(os.path.join(OUTS[0], name + ".ogg"))
        total += size
        print(f"{name:9s} {len(x) / SR:5.1f} s  {song.bpm:6.1f} bpm  peak {np.max(np.abs(x)):.2f}  "
              f"rms {np.sqrt(np.mean(x ** 2)):.3f}  {size / 1024:.0f} KiB")
    print(f"total {total / 1024 / 1024:.2f} MiB")


if __name__ == "__main__":
    main(sys.argv[1:] or list(TRACKS))
