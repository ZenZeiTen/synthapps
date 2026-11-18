"""Hyper Bluff!! Starlight Showdown soundtrack: seven original pieces.

    python3 tools/audio/music.py            (from hyper-bluff/; add --stats for stem levels)

Writes godot/assets/audio/<name>.ogg (stereo 32 kHz OGG Vorbis ~96 kbps), or 16-bit mono
22.05 kHz WAV if ffmpeg has no Vorbis encoder.

Every piece is written out by hand below: a chord per bar (or per half/quarter bar, comma
separated) and a melody in NOTE:DUR tokens, DUR in sixteenth notes ('r' is a rest, '|' ends
a bar, every bar must add up to 16, which is checked). Bass, comping, pads, arpeggios and
drums are generated from the chords by named patterns.

Loops are rendered into a buffer exactly as long as the piece, and every note tail, echo
and reverb wraps round to the start, so the last bar flows into the first with no seam.
All tunes are original to this game.
"""
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import synth as S  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "godot" / "assets" / "audio"
SR = 32000

# ==================================================================== patterns
QUALITY = {
    "": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11),
    "m7": (0, 3, 7, 10), "7sus4": (0, 5, 7, 10), "sus4": (0, 5, 7), "m7b5": (0, 3, 6, 10),
    "9": (0, 4, 10, 14), "add9": (0, 4, 7, 14), "6": (0, 4, 7, 9), "dim": (0, 3, 6),
}
_CHORD = re.compile(r"^([A-G][#b]?)(maj7|m7b5|m7|7sus4|sus4|add9|dim|m|7|9|6)?$")

# bass: (step, length, degree, velocity)   degree: R root, 3, 5, 7, 8 octave
BASS = {
    "drive": [(0, 2, "R", 1), (2, 2, "R", .8), (4, 2, "R", .9), (6, 2, "8", .8),
              (8, 2, "R", 1), (10, 2, "R", .8), (12, 2, "5", .9), (14, 2, "8", .8)],
    "stab": [(0, 3, "R", 1), (3, 3, "R", .9), (6, 2, "R", .9), (8, 3, "R", 1), (11, 3, "R", .9), (14, 2, "8", .9)],
    "funk": [(0, 3, "R", 1), (3, 1, "R", .6), (6, 2, "8", .9), (10, 2, "7", .8), (12, 1, "8", .7), (14, 2, "5", .85)],
    "funk2": [(0, 2, "R", 1), (3, 1, "8", .7), (4, 2, "R", .85), (7, 1, "R", .6), (8, 2, "5", .9),
              (11, 1, "7", .7), (12, 2, "8", .9), (14, 1, "7", .7), (15, 1, "5", .7)],
    "gallop": [(b * 4 + o, d, "R", v) for b in range(4) for (o, d, v) in ((0, 2, 1), (2, 1, .75), (3, 1, .75))],
    "pedal": [(i, 1, "R" if i % 4 else "8", 1 if i % 4 == 0 else .75) for i in range(16)],
    "bounce": [(i * 2, 2, "R" if i % 2 == 0 else "8", 1 if i % 2 == 0 else .8) for i in range(8)],
    "ballad": [(0, 8, "R", 1), (8, 4, "5", .75), (12, 4, "R", .8)],
    "fanfare": [(0, 2, "R", 1), (2, 1, "R", .8), (3, 1, "R", .8), (4, 2, "R", 1), (6, 2, "R", .9),
                (8, 3, "R", 1), (11, 1, "R", .8), (12, 3, "R", 1), (15, 1, "R", .8)],
    "hold": [(0, 13, "R", 1)],
    "halves": [(0, 8, "R", 1), (8, 8, "R", .9)],
}
# comping: (step, length, velocity) plays the chord voicing
COMP = {
    "stab": [(0, 2, 1), (3, 2, .9), (6, 2, .9), (8, 2, 1), (11, 2, .9), (14, 2, .9)],
    "rock": [(0, 4, 1), (6, 2, .8), (8, 4, .95), (12, 2, .8), (14, 2, .8)],
    "offbeat": [(2, 2, .9), (6, 2, .9), (10, 2, .9), (14, 2, .9)],
    "citypop": [(0, 5, 1), (6, 2, .7), (10, 3, .9), (14, 2, .6)],
    "chuck": [(2, 1, .7), (3, 1, .5), (7, 1, .7), (10, 1, .7), (11, 1, .5), (13, 1, .6), (15, 1, .7)],
    "hits": [(0, 3, 1), (6, 2, .85), (12, 2, .9)],
    "whole": [(0, 16, 1)],
    "fanfare": [(0, 2, 1), (2, 1, .8), (3, 1, .8), (4, 2, 1), (6, 2, .9), (8, 3, 1), (11, 1, .8), (12, 3, 1), (15, 1, .8)],
    "hold": [(0, 13, 1)],
}
# arpeggio: (step, length, index into the chord tones stacked over two octaves, velocity)
_UP = (0, 1, 2, 3, 4, 3, 2, 1)
_FEV = (0, 2, 4, 2, 1, 3, 5, 3)
_BAL = (0, 2, 3, 4, 3, 2, 3, 2)
ARP = {
    "up16": [(i, 1, _UP[i % 8], 1 if i % 4 == 0 else .7) for i in range(16)],
    "fever16": [(i, 1, _FEV[i % 8], 1 if i % 2 == 0 else .7) for i in range(16)],
    "ballad8": [(i * 2, 4, _BAL[i], 1 if i % 4 == 0 else .75) for i in range(8)],
    "up8": [(i * 2, 2, _UP[i], .9) for i in range(8)],
}
# drums: 16 steps per row.  X accent, x hit, o ghost, . rest
DRUMS = {
    "t_stab": dict(kick="x..x..x.x..x..x.", snare="....x.......x...", hat="x.x.x.x.x.x.x.x."),
    "t_verse": dict(kick="x.....x.x.x.....", snare="....X.......X...", hat="x.o.x.o.x.o.x.o."),
    "t_pre": dict(kick="x...x...x...x...", snare="....X.......X...", hat="x.x.x.x.x.x.x.x."),
    "t_chorus": dict(kick="x...x.x.x...x.x.", snare="....X.......X...", clap="....x.......x...",
                     ohat="..x...x...x...x.", hat="x...x...x...x..."),
    "funk": dict(kick="x......x..x.....", snare="....X....o..X..o", hat="XoxoXoxoXoxoXo.o", ohat="..............x."),
    "funk2": dict(kick="x..x...x..x.....", snare="....X....o..X..o", clap="....x.......x...",
                  hat="XoxoXoxoXoxoXo.o", ohat="..............x."),
    "b_intro": dict(kick="x...x...x...x...", snare="............x...", hat="x.x.x.x.x.x.x.x."),
    "b_a": dict(kick="x.x...x.x.x...x.", snare="....X.......X...", hat="x.x.x.x.x.x.x.x."),
    "b_c": dict(kick="x..xx.x.x..xx.x.", snare="....X.......X...", ohat="x...x...x...x...", hat="..x...x...x...x."),
    "fever": dict(kick="x...x...x...x...", snare="....X.......X...", clap="....x.......x...",
                  ohat="..x...x...x...x.", hat="xo.oxo.oxo.oxo.o"),
    "ballad": dict(kick="x.........x.....", rim="........x.......", hat="x.o.x.o.x.o.x.o."),
    "ballad2": dict(kick="x.....x...x.....", snare="........x.......", hat="x.o.x.o.x.o.x.o."),
    "v_roll": dict(snare="x.xxx.x.x.oxXoxX", kick="x...x...x...x..."),
    "v_end": dict(kick="X...............", crash="X...............", snare="X..............."),
    "d_end": dict(kick="x...............", tom3="x..............."),
}
# fills replace steps 8..15 of the bar they are applied to
FILLS = {
    "roll": dict(snare="........x.xxXxXX", kick="........x...x..."),
    "toms": dict(snare="........xx......", tom1="..........xx....", tom2="............xx..",
                 tom3="..............xX", kick="........x...x..."),
    "soft": dict(rim="............x.x.", kick="........x......."),
    "funk": dict(snare="........x..x.xXX", kick="........x.x.....", ohat="..............x."),
}
DRUM_GAIN = dict(kick=1.0, snare=.8, hat=.3, ohat=.28, clap=.45, crash=.5, tom1=.7, tom2=.7, tom3=.75, rim=.5)
DRUM_PAN = dict(hat=.3, ohat=.3, clap=-.15, crash=-.2, tom1=-.35, tom2=0.0, tom3=.35, rim=.1)
HIT_VEL = {"x": .8, "X": 1.0, "o": .35}

# ==================================================================== the music (all original)
TRACKS = {
    # ---------------------------------------------------------------- title: A major, 150 bpm
    "title": dict(name="Starlight Showdown", bpm=150, key="A major", seed=11, reverb=1.3, rev_level=.22,
        mix=dict(drums=(.8, 0, .10), bass=(.62, 0, 0), lead=(.6, 0, .35), lead2=(.45, .2, .5),
                 comp=(.42, -.35, .3), pad=(.27, 0, .5), arp=(.4, .4, .3)),
        echo=dict(lead=(3, .35, .16)),
        sections=[
            dict(name="intro", chords="D | E | F#m | E", crash=True, fill="toms",
                 melody="""F#5:3 F#5:1 A5:4 r:2 F#5:2 A5:2 D6:2 | E6:6 D6:2 B5:4 G#5:4 |
                           A5:3 A5:1 C#6:4 r:2 A5:2 C#6:2 F#6:2 | E6:4 r:2 E6:2 G#6:2 r:2 B5:2 E6:2""",
                 lead=[("brass", -12, 1.0, "lead")], bass=("stab", "fmbass"), comp=[("stab", "hit", 57)],
                 pad="pad", drums="t_stab"),
            dict(name="verse", chords="A | E | F#m | C#m | D | A | Bm | E", crash=True, fill="roll",
                 melody="""C#6:4 B5:2 A5:2 E5:4 A5:2 B5:2 | B5:6 G#5:2 E5:4 r:4 |
                           A5:4 G#5:2 F#5:2 C#5:4 F#5:2 A5:2 | G#5:6 E5:2 C#5:4 r:2 E5:2 |
                           F#5:2 F#5:2 A5:2 D6:4 C#6:2 B5:2 A5:2 | C#6:6 A5:2 E5:4 r:2 A5:2 |
                           B5:2 D6:2 F#6:4 E6:2 D6:2 B5:2 D6:2 | E6:8 r:2 E5:2 G#5:2 B5:2""",
                 lead=[("sawlead", -12, .85, "lead")], bass=("drive", "fmbass"), comp=[("rock", "epiano", 57)],
                 pad="pad", drums="t_verse"),
            dict(name="lift", chords="D | E | C#m | F#m | D | E | F | G", fill="roll",
                 melody="""A5:3 A5:3 A5:2 B5:2 A5:2 F#5:4 | B5:3 B5:3 B5:2 C#6:2 B5:2 G#5:4 |
                           C#6:3 C#6:3 C#6:2 E6:2 C#6:2 G#5:4 | A5:4 C#6:4 F#6:6 r:2 |
                           F#6:2 E6:2 D6:2 A5:4 D6:2 E6:2 F#6:2 | G#6:4 E6:4 B5:4 E6:2 G#6:2 |
                           A6:6 G6:2 F6:4 C6:4 | B6:4 A6:2 G6:2 D6:2 G6:2 B6:2 D7:2""",
                 lead=[("sawlead", -12, .9, "lead"), ("bell", 0, .8, "lead2")], bass=("drive", "fmbass"),
                 comp=[("stab", "epiano", 57)], pad="strings", drums="t_pre"),
            dict(name="chorus", chords="A | E | F#m | E | D | C#m,F#m | Bm,E | A", crash=True, fill="toms",
                 melody="""E6:3 E6:1 C#6:2 E6:2 A6:4 G#6:2 E6:2 | G#6:3 G#6:1 E6:2 G#6:2 B6:4 r:2 B5:2 |
                           C#6:3 C#6:1 A5:2 C#6:2 F#6:4 E6:2 C#6:2 | E6:6 D6:2 B5:4 r:2 E6:2 |
                           F#6:3 F#6:1 D6:2 F#6:2 A6:4 F#6:2 D6:2 | E6:4 G#6:4 A6:4 C#7:4 |
                           D6:2 F#6:2 B6:4 B6:2 G#6:2 E6:2 G#6:2 | A6:8 r:2 A5:2 C#6:2 E6:2""",
                 lead=[("brass", -12, 1.0, "lead"), ("sawlead", 0, .45, "lead2")], bass=("drive", "fmbass"),
                 comp=[("rock", "epiano", 57)], pad="strings", arp=("up16", "pulse", 69), drums="t_chorus"),
        ]),
    # ---------------------------------------------------------------- match: D minor, 118 bpm
    "match": dict(name="Neon Felt", bpm=118, key="D minor", seed=23, reverb=1.5, rev_level=.25,
        mix=dict(drums=(.85, 0, .08), bass=(.68, 0, 0), lead=(.5, 0, .4), lead2=(.34, -.15, .5),
                 comp=(.4, -.3, .35), comp2=(.5, .4, .2), pad=(.22, 0, .5)),
        echo=dict(lead=(3, .4, .2)),
        sections=[
            dict(name="a", chords="Bbmaj7 | A7 | Dm7 | Dm7,G7 | Bbmaj7 | A7 | Dm7 | C7sus4,C7", crash=True, fill="funk",
                 melody="""r:2 A4:2 D5:2 F5:3 E5:3 D5:4 | C#5:3 E5:3 A4:6 r:4 |
                           r:2 A4:2 D5:2 F5:3 G5:3 A5:4 | F5:3 D5:3 B4:4 r:2 D5:2 F5:2 |
                           A5:4 r:2 F5:2 D5:3 F5:3 A5:2 | G5:3 E5:3 C#5:6 r:2 E5:2 |
                           F5:6 E5:2 D5:4 A4:4 | C5:3 F5:3 G5:2 E5:4 r:4""",
                 lead=[("soft", 0, 1.0, "lead"), ("epiano", 0, .9, "lead2")], bass=("funk", "fmbass"),
                 comp=[("citypop", "epiano", 55), ("chuck", "pluck", 67)], pad="pad", drums="funk"),
            dict(name="b", chords="Gm7 | C7 | Fmaj7 | Dm7 | Gm7 | A7 | Dm7 | Em7b5,A7", fill="funk",
                 melody="""D5:2 F5:2 Bb5:4 A5:2 G5:2 F5:4 | E5:3 G5:3 Bb5:2 A5:2 G5:2 E5:4 |
                           A5:6 C6:2 A5:4 F5:4 | r:2 D5:2 F5:2 A5:2 C6:4 A5:4 |
                           Bb5:3 A5:3 G5:2 D5:4 G5:4 | A5:3 G5:3 E5:2 C#5:4 E5:2 G5:2 |
                           F5:8 r:2 D5:2 F5:2 A5:2 | Bb5:4 G5:4 A5:4 C#6:4""",
                 lead=[("brass", 0, .8, "lead"), ("bell", 0, .7, "lead2")], bass=("funk2", "fmbass"),
                 comp=[("citypop", "epiano", 55), ("chuck", "pluck", 67)], pad="pad", drums="funk2"),
            dict(name="a2", chords="Bbmaj7 | A7 | Dm7 | Dm7,G7 | Bbmaj7 | A7 | Dm7 | C7sus4,C7", crash=True, fill="funk",
                 melody="""r:2 A4:2 D5:2 F5:3 E5:3 D5:4 | C#5:3 E5:3 A4:6 r:4 |
                           r:2 A4:2 D5:2 F5:3 G5:3 A5:4 | F5:3 D5:3 B4:4 r:2 D5:2 F5:2 |
                           A5:4 r:2 F5:2 D5:3 F5:3 A5:2 | G5:3 E5:3 C#5:6 r:2 E5:2 |
                           F5:3 A5:3 D6:6 r:4 | C6:3 Bb5:3 G5:2 E5:4 C5:4""",
                 lead=[("soft", 0, 1.0, "lead"), ("epiano", 12, .6, "lead2")], bass=("funk", "fmbass"),
                 comp=[("citypop", "epiano", 55), ("chuck", "pluck", 67)], pad="strings", drums="funk"),
            dict(name="turn", chords="Bbmaj7 | C | Dm7 | A7sus4,A7", fill="funk",
                 melody="""D5:4 F5:4 A5:6 r:2 | E5:4 G5:4 C6:6 r:2 |
                           D6:3 C6:3 A5:2 F5:4 D5:4 | E5:6 D5:2 C#5:4 r:4""",
                 lead=[("bell", 0, .9, "lead"), ("soft", 0, .7, "lead2")], bass=("funk2", "fmbass"),
                 comp=[("hits", "epiano", 55)], pad="strings", drums="funk2"),
        ]),
    # ---------------------------------------------------------------- boss: E minor, 165 bpm
    "boss": dict(name="Last Card Standing", bpm=165, key="E minor", seed=37, reverb=1.2, rev_level=.2,
        mix=dict(drums=(.75, 0, .08), bass=(.62, 0, 0), lead=(.6, 0, .35), lead2=(.45, .15, .4),
                 comp=(.7, -.3, .3), pad=(.28, 0, .5), arp=(.35, .4, .3)),
        echo=dict(lead=(3, .3, .14)),
        sections=[
            dict(name="intro", chords="Em | Em | C | D", crash=True, fill="toms",
                 melody="""E5:2 r:1 E5:1 G5:2 E5:2 B5:2 A5:2 G5:2 F#5:2 | E5:2 r:1 E5:1 G5:2 E5:2 D6:2 B5:2 A5:2 B5:2 |
                           E5:2 r:1 E5:1 G5:2 E5:2 C6:2 B5:2 G5:2 E5:2 | F#5:2 r:1 F#5:1 A5:2 F#5:2 D6:4 D#6:4""",
                 lead=[("sawlead", 0, .9, "lead")], bass=("pedal", "rockbass"), comp=[("hits", "hit", 52)],
                 drums="b_intro"),
            dict(name="a", chords="Em | C | D | B7 | Em | C | Am | B7", crash=True, fill="roll",
                 melody="""E6:6 D6:2 B5:4 G5:2 B5:2 | C6:6 B5:2 G5:4 E5:2 G5:2 |
                           A5:4 D6:4 F#6:4 E6:2 D6:2 | D#6:6 B5:2 F#5:4 B5:2 D#6:2 |
                           E6:4 G6:4 F#6:2 E6:2 D6:2 B5:2 | C6:4 E6:4 G6:6 E6:2 |
                           A5:2 C6:2 E6:2 A6:4 G6:2 E6:2 C6:2 | B5:2 D#6:2 F#6:2 B6:6 r:2 B5:2""",
                 lead=[("sawlead", -12, 1.0, "lead"), ("pulse", 0, .5, "lead2")], bass=("gallop", "rockbass"),
                 comp=[("stab", "hit", 52)], pad="strings", drums="b_a"),
            dict(name="b", chords="C | D | Em | Em | C | D | B7 | B7", crash=True, fill="toms",
                 melody="""G5:2 C6:2 E6:2 G5:2 C6:2 E6:2 G6:4 | A5:2 D6:2 F#6:2 A5:2 D6:2 F#6:2 A6:4 |
                           B6:6 A6:2 G6:4 E6:4 | r:2 E6:2 G6:2 B6:2 A6:2 G6:2 F#6:2 E6:2 |
                           E6:6 C6:2 G5:4 C6:2 E6:2 | F#6:6 D6:2 A5:4 D6:2 F#6:2 |
                           F#6:3 F#6:3 F#6:2 A6:3 A6:3 A6:2 | B6:8 r:2 B5:2 D#6:2 F#6:2""",
                 lead=[("brass", -12, 1.0, "lead"), ("pulse", 0, .4, "lead2")], bass=("gallop", "rockbass"),
                 comp=[("rock", "hit", 52)], pad="strings", arp=("up16", "pulse", 64), drums="b_a"),
            dict(name="c", chords="G | D | Em | Bm | C | G | Am | B7", crash=True, fill="roll",
                 melody="""G6:6 F#6:2 D6:4 B5:4 | A5:2 D6:2 F#6:4 A6:6 r:2 |
                           G6:6 F#6:2 E6:4 B5:4 | D6:2 F#6:2 B6:4 A6:2 F#6:2 D6:4 |
                           E6:6 D6:2 C6:4 G5:4 | B5:2 D6:2 G6:4 B6:6 r:2 |
                           C7:4 B6:2 A6:2 E6:4 A6:2 C7:2 | B6:4 A6:4 F#6:4 D#6:4""",
                 lead=[("sawlead", -12, 1.0, "lead"), ("brass", -12, .6, "lead2")], bass=("drive", "rockbass"),
                 comp=[("rock", "hit", 55)], pad="strings", arp=("up16", "pulse", 67), drums="b_c"),
            dict(name="a2", chords="Em | C | D | B7 | Em | Am | B7 | Em", crash=True, fill="toms",
                 melody="""E6:6 D6:2 B5:4 G5:2 B5:2 | C6:6 B5:2 G5:4 E5:2 G5:2 |
                           A5:4 D6:4 F#6:4 E6:2 D6:2 | D#6:6 B5:2 F#5:4 B5:2 D#6:2 |
                           E6:2 G6:2 B6:4 A6:2 G6:2 F#6:2 E6:2 | C6:2 E6:2 A6:4 G6:2 E6:2 C6:2 E6:2 |
                           D#6:2 F#6:2 B6:2 A6:2 F#6:2 D#6:2 B5:2 D#6:2 | E6:12 r:4""",
                 lead=[("sawlead", -12, 1.0, "lead"), ("pulse", 0, .5, "lead2")], bass=("gallop", "rockbass"),
                 comp=[("stab", "hit", 52)], pad="strings", arp=("up16", "pulse", 64), drums="b_c"),
        ]),
    # ---------------------------------------------------------------- fever: C major, 175 bpm
    "fever": dict(name="Jackpot Rush", bpm=175, key="C major", seed=41, reverb=1.0, rev_level=.18,
        mix=dict(drums=(.85, 0, .08), bass=(.62, 0, 0), lead=(.52, 0, .3), lead2=(.35, .2, .45),
                 comp=(.6, -.35, .25), arp=(.3, .4, .25)),
        echo=dict(lead=(3, .3, .14)),
        sections=[
            dict(name="a", chords="C | G | Am | Em | F | C | Dm | G", crash=True, fill="roll",
                 melody="""E6:2 E6:1 E6:1 G6:2 E6:2 C6:2 D6:2 E6:4 | D6:2 D6:1 D6:1 G6:2 D6:2 B5:2 C6:2 D6:4 |
                           C6:2 C6:1 C6:1 E6:2 C6:2 A5:2 B5:2 C6:4 | B5:2 G5:2 B5:2 E6:4 r:2 E5:2 G5:2 |
                           A5:2 A5:1 A5:1 C6:2 A5:2 F5:2 A5:2 C6:4 | G5:2 C6:2 E6:2 G6:4 E6:2 C6:2 E6:2 |
                           F6:2 E6:2 D6:2 F6:2 A6:4 F6:2 D6:2 | G6:2 r:1 G6:1 G6:2 B6:2 D7:4 r:2 G6:2""",
                 lead=[("square", -12, 1.0, "lead"), ("bell", 0, .8, "lead2")], bass=("bounce", "fmbass"),
                 comp=[("offbeat", "pluck", 60)], arp=("fever16", "pulse", 72), drums="fever"),
            dict(name="b", chords="F | G | Em | Am | F | G | Ab | Bb", crash=True, fill="toms",
                 melody="""A6:4 F6:2 C6:2 F6:2 A6:2 C7:4 | B6:4 G6:2 D6:2 G6:2 B6:2 D7:4 |
                           G6:2 E6:2 B5:2 E6:2 G6:2 B6:2 G6:2 E6:2 | A6:6 G6:2 E6:4 C6:4 |
                           F6:2 F6:1 F6:1 A6:2 F6:2 C6:2 F6:2 A6:4 | G6:2 G6:1 G6:1 B6:2 G6:2 D6:2 G6:2 B6:4 |
                           C7:3 C7:3 Ab6:2 Eb6:4 Ab6:2 C7:2 | D7:3 D7:3 Bb6:2 F6:2 Bb6:2 D7:2 F7:2""",
                 lead=[("square", -12, 1.0, "lead"), ("brass", -12, .7, "lead2")], bass=("bounce", "fmbass"),
                 comp=[("stab", "pluck", 60)], arp=("fever16", "pulse", 72), drums="fever"),
        ]),
    # ---------------------------------------------------------------- ending: F major, 80 bpm
    "ending": dict(name="After the Last Hand", bpm=80, key="F major", seed=53, reverb=2.0, rev_level=.32,
        mix=dict(drums=(.55, 0, .2), bass=(.45, 0, 0), lead=(.58, 0, .5), lead2=(.6, .2, .6),
                 pad=(.24, 0, .6), arp=(.3, -.25, .45)),
        echo=dict(lead=(3, .35, .15)),
        sections=[
            dict(name="a", chords="F | C | Dm7 | Am7 | Bbmaj7 | F | Gm7 | C7sus4,C7", fill="soft",
                 melody="""A4:4 C5:4 F5:6 E5:2 | E5:4 D5:2 C5:2 G4:8 | F4:4 A4:4 D5:6 C5:2 | C5:4 A4:2 G4:2 E4:8 |
                           D5:4 F5:4 A5:6 G5:2 | F5:4 C5:4 A4:6 C5:2 | Bb4:4 D5:4 G5:4 F5:2 D5:2 | F5:8 E5:6 r:2""",
                 lead=[("soft", 0, 1.0, "lead")], bass=("ballad", "subbass"), pad="strings",
                 arp=("ballad8", "epiano", 53), drums="ballad"),
            dict(name="b", chords="Bbmaj7 | C | Am7 | Dm7 | Gm7 | Am7 | Bbmaj7 | C7sus4,C7", fill="soft",
                 melody="""A5:6 G5:2 F5:4 D5:4 | G5:6 F5:2 E5:4 C5:4 | E5:4 G5:4 C6:6 A5:2 | A5:4 F5:4 D5:6 r:2 |
                           Bb5:6 A5:2 G5:4 D5:4 | C6:6 A5:2 G5:4 E5:4 | D5:2 F5:2 A5:4 D6:6 C6:2 | C6:4 Bb5:4 G5:4 E5:2 G5:2""",
                 lead=[("soft", 0, 1.0, "lead"), ("bell", 12, .7, "lead2")], bass=("ballad", "subbass"), pad="strings",
                 arp=("ballad8", "epiano", 53), drums="ballad2"),
        ]),
    # ---------------------------------------------------------------- jingles (no loop)
    "victory": dict(name="Showdown Won", bpm=160, key="A major", seed=61, reverb=1.3, rev_level=.25,
        loop=False, tail=1.6,
        mix=dict(drums=(.8, 0, .12), bass=(.6, 0, 0), lead=(.6, 0, .4), lead2=(.25, .2, .5),
                 comp=(.3, -.2, .35), pad=(.5, 0, .5), arp=(.3, .3, .5)),
        echo={},
        sections=[
            dict(name="run", chords="A,A,F,G", melody="E5:2 E5:1 E5:1 A5:2 C#6:2 F6:3 F6:1 G6:3 G6:1",
                 lead=[("brass", -12, 1.0, "lead"), ("bell", 0, .8, "lead2")], bass=("fanfare", "fmbass"),
                 comp=[("fanfare", "brass", 57)], drums="v_roll"),
            dict(name="hold", chords="A", melody="A6:13 r:3",
                 lead=[("brass", -12, 1.0, "lead"), ("bell", 0, .8, "lead2")], bass=("hold", "fmbass"),
                 comp=[("hold", "brass", 57)], pad="strings", arp=("up16", "bell", 69), drums="v_end"),
        ]),
    "defeat": dict(name="Busted", bpm=140, key="D minor", seed=67, reverb=1.6, rev_level=.3,
        loop=False, tail=0.45,
        mix=dict(drums=(.6, 0, .2), bass=(.6, 0, 0), lead=(.6, 0, .45), lead2=(.25, .15, .5), pad=(.26, 0, .5)),
        echo={},
        sections=[
            dict(name="fall", chords="Dm,Dm,A7,A7", melody="A4:4 F4:4 E4:4 C#4:4",
                 lead=[("soft", 0, 1.0, "lead"), ("brass", -12, .6, "lead2")], bass=("halves", "subbass"),
                 pad="strings"),
            dict(name="thud", chords="Dm", melody="D4:9 r:7",
                 lead=[("soft", 0, 1.0, "lead"), ("brass", -12, .6, "lead2")], bass=("hold", "subbass"),
                 pad="strings", drums="d_end"),
        ]),
}
ORDER = ["title", "match", "boss", "fever", "ending", "victory", "defeat"]


# ==================================================================== score parsing
def parse_chords(text):
    """-> list of bars; each bar is a list of (first step, steps, root pitch class, intervals)."""
    bars = []
    for bar in text.split("|"):
        names = [c.strip() for c in bar.strip().split(",")]
        if 16 % len(names):
            raise ValueError("a bar must hold 1, 2, 4 or 8 chords: %r" % bar)
        span = 16 // len(names)
        segs = []
        for i, nm in enumerate(names):
            m = _CHORD.match(nm)
            if not m:
                raise ValueError("bad chord %r" % nm)
            segs.append((i * span, span, S.pitch_class(m.group(1)), QUALITY[m.group(2) or ""]))
        bars.append(segs)
    return bars


def parse_melody(text):
    """-> list of bars; each bar is a list of (step in bar, steps, midi note or None)."""
    bars = []
    for bi, bar in enumerate(text.split("|")):
        pos, notes = 0, []
        for tok in bar.split():
            name, dur = tok.rsplit(":", 1)
            dur = int(dur)
            notes.append((pos, dur, None if name == "r" else S.midi(name)))
            pos += dur
        if pos != 16:
            raise ValueError("melody bar %d adds up to %d, not 16: %r" % (bi + 1, pos, bar.strip()))
        bars.append(notes)
    return bars


def chord_at(segs, step):
    for seg in segs:
        if seg[0] <= step < seg[0] + seg[1]:
            return seg
    return segs[-1]


def voicing(seg, lo):
    """Close voicing with every chord tone folded into the octave starting at `lo`."""
    _, _, root, ivs = seg
    if len(ivs) > 4:
        ivs = ivs[1:]
    return sorted({lo + ((root + iv - lo) % 12) for iv in ivs})


def bass_note(seg, deg, lo=28):
    _, _, root, ivs = seg
    base = lo + ((root - lo) % 12)
    if deg == "R":
        return base
    if deg == "8":
        return base + 12
    if deg == "3":
        return base + ivs[1]
    if deg == "5":
        return base + (7 if 7 in ivs else 6 if 6 in ivs else 7)
    if deg == "7":
        return base + (10 if 10 in ivs else 11 if 11 in ivs else 7)
    raise ValueError(deg)


def bar_count(spec):
    return sum(len(parse_chords(s["chords"])) for s in spec["sections"])


def duration(spec):
    """Length in seconds, from the score alone."""
    secs = bar_count(spec) * 16 * 60.0 / spec["bpm"] / 4.0
    return secs + (0.0 if spec.get("loop", True) else spec["tail"])


# ==================================================================== rendering
def render(spec, stats=False):
    sr = SR
    step_sec = 60.0 / spec["bpm"] / 4.0
    spb = sr * step_sec
    loop = spec.get("loop", True)
    nbars = bar_count(spec)
    n_song = int(round(nbars * 16 * spb))
    n = n_song if loop else n_song + int((spec["tail"] + 2.5) * sr)
    kit = S.make_kit(sr, spec["seed"])
    stems, cache = {}, {}

    def stem(name):
        if name not in stems:
            stems[name] = S.Mix(n, sr, loop)
        return stems[name]

    def note(stem_name, voice, m, step, dur, vel, gate=0.92):
        key = (voice, m, dur, gate)
        if key not in cache:
            cache[key] = S.VOICES[voice](S.hz(m), dur * step_sec * gate, sr)
        stem(stem_name).add(cache[key], round(step * spb), vel)

    def drum(inst, step, vel):
        stem("drums").add(kit[inst], round(step * spb), vel * DRUM_GAIN[inst], DRUM_PAN.get(inst, 0.0))

    bar0 = 0
    for sec in spec["sections"]:
        chords = parse_chords(sec["chords"])
        melody = parse_melody(sec["melody"]) if sec.get("melody") else []
        if melody and len(melody) != len(chords):
            raise ValueError("%s/%s: %d melody bars for %d chord bars" % (spec["name"], sec["name"], len(melody), len(chords)))
        for b, segs in enumerate(chords):
            s0 = (bar0 + b) * 16
            last = b == len(chords) - 1
            if sec.get("bass"):
                pat, voice = sec["bass"]
                for st, du, deg, vel in BASS[pat]:
                    note("bass", voice, bass_note(chord_at(segs, st), deg), s0 + st, du, vel, gate=0.85)
            for ci, (pat, voice, lo) in enumerate(sec.get("comp", [])):
                for st, du, vel in COMP[pat]:
                    for m in voicing(chord_at(segs, st), lo):
                        note("comp" if ci == 0 else "comp2", voice, m, s0 + st, du, vel * 0.6, gate=0.8)
            if sec.get("pad"):
                for seg in segs:
                    for m in voicing(seg, 55):
                        note("pad", sec["pad"], m, s0 + seg[0], seg[1], 0.5, gate=1.0)
            if sec.get("arp"):
                pat, voice, lo = sec["arp"]
                for st, du, idx, vel in ARP[pat]:
                    v = voicing(chord_at(segs, st), lo)
                    tones = v + [t + 12 for t in v]
                    note("arp", voice, tones[idx % len(tones)], s0 + st, du, vel, gate=0.8)
            if sec.get("drums"):
                rows = dict(DRUMS[sec["drums"]])
                if last and sec.get("fill"):
                    rows = {k: r[:8] + "........" for k, r in rows.items()}
                    for k, r in FILLS[sec["fill"]].items():
                        base = rows.get(k, "." * 16)
                        rows[k] = base[:8] + r[8:]
                for inst, row in rows.items():
                    for i, c in enumerate(row):
                        if c != ".":
                            drum(inst, s0 + i, HIT_VEL[c])
                if b == 0 and sec.get("crash"):
                    drum("crash", s0, 0.9)
            if melody:
                for st, du, m in melody[b]:
                    if m is None:
                        continue
                    for voice, shift, gain, stem_name in sec["lead"]:
                        note(stem_name, voice, m + shift, s0 + st, du, gain)
        bar0 += len(chords)

    # ---- mixdown
    dry = np.zeros((n, 2))
    send = np.zeros((n, 2))
    for name, mx in stems.items():
        gain, pan, rev = spec["mix"][name]
        buf = mx.buf
        if name in spec.get("echo", {}):
            steps, fb, amt = spec["echo"][name]
            buf = S.delay(buf, sr, steps * step_sec, fb, amt)
        if name == "pad":
            buf = S.filt(buf, sr, lo=160.0)
        buf = buf * gain * np.array([min(1.0, 1.0 - pan), min(1.0, 1.0 + pan)])
        if stats:
            print("    %-6s rms %6.1f dB" % (name, 20 * np.log10(np.sqrt((buf ** 2).mean()) + 1e-12)))
        dry += buf
        send += buf * rev
    out = dry + spec["rev_level"] * 4.0 * S.reverb(send, sr, t60=spec["reverb"], seed=spec["seed"])
    out = S.filt(out, sr, lo=28.0)
    out = S.master(out)
    if not loop:
        total = n_song + int(spec["tail"] * sr)
        out = S.fade_out(out[:total], sr, min(spec["tail"], 0.6))
        out = out * (0.84 / np.abs(out).max())
    return out


def main(argv):
    stats = "--stats" in argv
    names = [a for a in argv if not a.startswith("--")] or ORDER
    vorbis = S.have_vorbis()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in names:
        spec = TRACKS[name]
        if stats:
            print("  %s stems:" % name)
        x = render(spec, stats)
        if vorbis:
            path = OUT / (name + ".ogg")
            S.write_ogg(path, x, SR, 96)
        else:
            path = OUT / (name + ".wav")
            idx = np.arange(0, len(x) - 1, SR / 22050.0)
            mono = S.filt(x.mean(axis=1), SR, hi=10000.0, order=6)
            S.write_wav(path, np.interp(idx, np.arange(len(mono)), mono), 22050)
        print("%-12s %-22s %3d bpm  %-8s %2d bars  %6.2f s  %7d bytes" % (
            path.name, spec["name"], spec["bpm"], spec["key"], bar_count(spec), len(x) / SR, path.stat().st_size))
    if not vorbis:
        print("NOTE: ffmpeg has no libvorbis encoder; wrote 16-bit mono 22050 Hz WAV instead.")


if __name__ == "__main__":
    main(sys.argv[1:])
