"""Background music: four original pieces in the style of 1990 AdLib FM music,
synthesised from the scores below -- no samples, nothing borrowed.

    python pipeline/audio/make_music.py

Writes content/music/<track>.wav (8-bit mono, 22050 Hz: what a 1990 sound card
played) and content/music/music.json (which track plays where).

Scores are plain text, one string per part:
    NOTE:DUR    a note, e.g. D5:2  C#4:1  Bb3:1.5
    [N,N,..]:DUR  a chord
    r:DUR       a rest
    |           a bar line (ignored, but every part must add up to the same length)
DUR counts the track's `unit` (an eighth note in every piece here).

Each loop is rendered twice and the second pass is kept, so notes still ringing at
the end of the loop are already sounding at its start: the seam is inaudible.
"""
import json, os, re, wave
import numpy as np

ROOT = os.environ.get('CROWMERE_ROOT') or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'music')
SR = 22050

# ------------------------------------------------------------------ instruments
# Two-operator FM, like the OPL2 chip on an AdLib card: a sine carrier whose phase is
# pushed around by a sine modulator at `ratio` x the pitch. `index` sets brightness
# and fades toward index * index_floor over index_decay seconds (plucks go dull).
INSTRUMENTS = {
    'bass':     dict(kind='fm', ratio=1.0, index=1.8, index_floor=0.15, index_decay=0.12, attack=0.004, decay=0.35, sustain=0.25, release=0.07, gain=0.55),
    'organ':    dict(kind='fm', ratio=2.0, index=0.6, index_floor=1.0, index_decay=1.0, attack=0.08, decay=1.0, sustain=0.85, release=0.35, gain=0.11, vibrato=(4.5, 0.002, 0.0)),
    'theremin': dict(kind='fm', ratio=1.0, index=0.35, index_floor=1.0, index_decay=1.0, attack=0.05, decay=2.0, sustain=0.9, release=0.18, gain=0.40, vibrato=(5.8, 0.012, 0.12), glide=0.07),
    'harpsi':   dict(kind='fm', ratio=3.0, index=2.4, index_floor=0.05, index_decay=0.08, attack=0.003, decay=0.28, sustain=0.0, release=0.06, gain=0.50),
    'bell':     dict(kind='fm', ratio=3.5, index=2.2, index_floor=0.1, index_decay=0.6, attack=0.003, decay=1.4, sustain=0.0, release=0.8, gain=0.45),
    'lead':     dict(kind='fm', ratio=2.0, index=1.4, index_floor=0.4, index_decay=0.2, attack=0.01, decay=0.5, sustain=0.55, release=0.12, gain=0.34, vibrato=(5.5, 0.006, 0.2)),
    'drone':    dict(kind='fm', ratio=1.0, index=1.0, index_floor=0.6, index_decay=3.0, attack=1.5, decay=4.0, sustain=0.8, release=1.5, gain=0.16, vibrato=(0.3, 0.003, 0.0)),
    'clock':    dict(kind='tick', gain=0.12),          # tick-tock: a pitched click
    'drip':     dict(kind='drip', gain=0.16),          # water drop: a rising plink
    'heart':    dict(kind='thump', gain=0.40),         # a soft low heartbeat
}
INSTRUMENTS['organ_soft'] = dict(INSTRUMENTS['organ'], gain=0.06)   # Tiptoe stays dry

# ------------------------------------------------------------------ scores
TRACKS = {
    # Title screen and the gate. D minor, 6/8: a haunted waltz with a theremin lead.
    'crowmere': dict(title='Crowmere Hill', unit=60 / 210, parts=[
        ('bass', '''
            D2:3 A2:3 | D2:3 A2:2 C3:1 | G2:3 D3:3 | A2:3 E2:2 G2:1 |
            D2:3 A2:3 | Bb2:3 F2:3 | G2:3 A2:3 | D2:3 D3:2 C3:1 |
            Bb2:3 F2:3 | F2:3 C3:3 | G2:3 D3:3 | D2:3 A2:3 |
            Bb2:3 F2:3 | G2:3 Bb2:3 | A2:3 E2:3 | A2:3 C#3:2 E3:1 |'''),
        ('organ', '''
            [F3,A3,D4]:6 | [F3,A3,D4]:6 | [G3,Bb3,D4]:6 | [G3,C#4,E4]:6 |
            [F3,A3,D4]:6 | [F3,Bb3,D4]:6 | [G3,Bb3,D4]:3 [G3,C#4,E4]:3 | [F3,A3,D4]:6 |
            [F3,Bb3,D4]:6 | [F3,A3,C4]:6 | [G3,Bb3,D4]:6 | [F3,A3,D4]:6 |
            [F3,Bb3,D4]:6 | [G3,Bb3,D4]:6 | [G3,C#4,E4]:6 | [G3,C#4,E4]:6 |'''),
        ('theremin', '''
            A4:2 D5:1 F5:2 E5:1 | D5:3 r:1 A4:1 C5:1 | Bb4:2 D5:1 G5:2 F5:1 | E5:3 C#5:2 A4:1 |
            A4:2 D5:1 F5:2 A5:1 | G5:2 F5:1 D5:3 | Bb4:2 D5:1 C#5:2 E5:1 | D5:6 |
            F5:2 D5:1 Bb4:3 | C5:2 F5:1 A5:3 | G5:2 Bb5:1 A5:2 G5:1 | F5:3 E5:2 D5:1 |
            D5:2 F5:1 Bb5:3 | A5:2 G5:1 F5:2 E5:1 | E5:3 G5:3 | C#5:3 r:3 |'''),
    ]),
    # Inside the house. A minor, 4/4: tiptoeing staccato over the grandfather clock.
    'tiptoe': dict(title='Tiptoe', unit=60 / 224, parts=[
        ('bass', '''
            A2:1 r:1 C3:1 r:1 E3:1 r:1 C3:1 r:1 | A2:1 r:1 C3:1 r:1 E3:1 r:1 C3:1 r:1 |
            D3:1 r:1 F3:1 r:1 A3:1 r:1 F3:1 r:1 | E2:1 r:1 G#2:1 r:1 B2:1 r:1 D3:1 r:1 |
            A2:1 r:1 C3:1 r:1 E3:1 r:1 C3:1 r:1 | F2:1 r:1 A2:1 r:1 C3:1 r:1 A2:1 r:1 |
            D3:1 r:1 F3:1 r:1 E2:1 r:1 G#2:1 r:1 | A2:1 r:1 E2:1 r:1 A2:1 r:3 |
            F2:1 r:1 A2:1 r:1 C3:1 r:1 A2:1 r:1 | C3:1 r:1 E3:1 r:1 G3:1 r:1 E3:1 r:1 |
            D3:1 r:1 F3:1 r:1 A3:1 r:1 F3:1 r:1 | A2:1 r:1 C3:1 r:1 E3:1 r:1 C3:1 r:1 |
            F2:1 r:1 A2:1 r:1 C3:1 r:1 A2:1 r:1 | D3:1 r:1 F3:1 r:1 A3:1 r:1 F3:1 r:1 |
            E2:1 r:1 G#2:1 r:1 B2:1 r:1 D3:1 r:1 | E2:1 r:1 B2:1 r:1 E3:1 r:3 |'''),
        ('organ_soft', '''
            [A3,C4,E4]:8 | [A3,C4,E4]:8 | [A3,D4,F4]:8 | [G#3,B3,D4]:8 |
            [A3,C4,E4]:8 | [A3,C4,F4]:8 | [A3,D4,F4]:4 [G#3,B3,D4]:4 | [A3,C4,E4]:8 |
            [A3,C4,F4]:8 | [G3,C4,E4]:8 | [A3,D4,F4]:8 | [A3,C4,E4]:8 |
            [A3,C4,F4]:8 | [A3,D4,F4]:8 | [G#3,B3,D4]:8 | [G#3,B3,D4]:8 |'''),
        ('clock', ' '.join(['E7:1 r:1 A6:1 r:1 E7:1 r:1 A6:1 r:1 |'] * 7 + ['E7:1 r:7 |']
                           + ['E7:1 r:1 A6:1 r:1 E7:1 r:1 A6:1 r:1 |'] * 7 + ['E7:1 r:7 |'])),
        ('harpsi', '''
            r:2 E4:1 A4:1 C5:1 r:1 B4:1 r:1 | A4:1 r:1 E4:1 r:1 D#4:1 E4:1 r:2 |
            r:2 F4:1 A4:1 D5:1 r:1 C5:1 r:1 | B4:1 r:1 G#4:1 r:1 E4:2 r:2 |
            r:2 E4:1 A4:1 C5:1 r:1 E5:1 r:1 | F5:1 r:1 E5:1 r:1 D5:1 C5:1 r:2 |
            D5:1 r:1 F5:1 r:1 E5:1 r:1 G#4:1 r:1 | A4:2 r:6 |
            r:2 A4:1 C5:1 F5:2 E5:1 D5:1 | E5:1 r:1 C5:1 r:1 G4:2 r:2 |
            r:2 D5:1 F5:1 A5:2 G5:1 F5:1 | E5:1 r:1 C5:1 r:1 A4:2 r:2 |
            r:2 C5:1 D5:1 E5:1 F5:1 G5:1 A5:1 | F5:1 r:1 D5:1 r:1 A4:2 r:2 |
            G#4:1 A4:1 B4:1 C5:1 D5:1 r:1 B4:1 r:1 | G#4:2 r:2 E4:1 r:3 |'''),
    ]),
    # The cellar. E Phrygian, slow: a drone, far-off bells, drips, a heartbeat.
    'below': dict(title='Down Below', unit=0.5, parts=[
        ('drone', '[E2,B2]:24 | [E2,B2]:24 |'),
        ('bell', 'E5:2 r:6 | r:4 F5:2 r:2 | r:2 B4:2 r:4 | G5:2 r:2 F5:2 r:2 | E5:4 r:4 | r:8 |'),
        ('drip', 'r:5 C7:1 r:2 | r:8 | r:3 G6:1 r:3 D7:1 | r:8 | r:6 A6:1 r:1 | r:2 E7:1 r:5 |'),
        ('heart', 'r:8 | A1:0.5 G1:0.5 r:7 | r:8 | A1:0.5 G1:0.5 r:7 | r:8 | A1:0.5 G1:0.5 r:7 |'),
    ]),
    # The ending. D major: the title's opening call, turned bright.
    'delivery': dict(title='Delivery Complete', unit=0.25, parts=[
        ('bass', '''
            D2:2 A2:2 D3:2 A2:2 | G2:2 D3:2 G3:2 D3:2 | A2:2 E3:2 A3:2 E3:2 | D3:2 A2:2 F#2:2 A2:2 |
            B2:2 F#3:2 B3:2 F#3:2 | G2:2 D3:2 G3:2 D3:2 | A2:2 E3:2 G3:2 C#3:2 | D3:2 A2:2 D2:2 r:2 |'''),
        ('organ', '''
            [F#3,A3,D4]:8 | [G3,B3,D4]:8 | [A3,C#4,E4]:8 | [F#3,A3,D4]:8 |
            [F#3,B3,D4]:8 | [G3,B3,D4]:8 | [G3,C#4,E4]:8 | [F#3,A3,D4]:8 |'''),
        ('clock', ' '.join(['r:2 E7:1 r:3 E7:1 r:1 |'] * 8)),
        ('lead', '''
            A4:1 D5:1 F#5:2 E5:1 D5:1 A4:2 | B4:1 D5:1 G5:2 F#5:1 E5:1 D5:2 |
            C#5:1 E5:1 A5:2 G5:1 F#5:1 E5:2 | F#5:2 D5:2 A4:4 |
            B4:1 D5:1 F#5:2 B5:2 A5:2 | G5:1 F#5:1 E5:2 D5:2 B4:2 |
            C#5:2 E5:2 G5:2 E5:2 | D5:4 r:4 |'''),
    ]),
}

# Where each track plays. Every room is listed; null would mean silence.
PLACES = {
    'title': 'crowmere', 'ending': 'delivery',
    'rooms': {'gate': 'crowmere', 'hall': 'tiptoe', 'library': 'tiptoe', 'kitchen': 'tiptoe',
              'bedroom': 'tiptoe', 'cellar': 'below'},
}

# ------------------------------------------------------------------ parsing
NOTE_RE = re.compile(r'^([A-G])(#|b)?(-?\d)$')
STEPS = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name):
    m = NOTE_RE.match(name)
    if not m:
        raise ValueError(f'bad note {name!r}')
    letter, acc, octave = m.groups()
    return 12 * (int(octave) + 1) + STEPS[letter] + {'#': 1, 'b': -1, None: 0}[acc]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def parse(score):
    """-> list of (start_units, dur_units, [midi, ...]) and the total length."""
    events, pos = [], 0.0
    for tok in score.replace('|', ' ').split():
        what, _, dur = tok.rpartition(':')
        d = float(dur)
        if what != 'r':
            names = what[1:-1].split(',') if what.startswith('[') else [what]
            events.append((pos, d, [midi(n) for n in names]))
        pos += d
    return events, pos


# ------------------------------------------------------------------ synthesis
def envelope(n, dur, p):
    t = np.arange(n) / SR
    a = max(p['attack'], 0.002)
    e = np.where(t < a, t / a, p['sustain'] + (1 - p['sustain']) * np.exp(-(np.maximum(t - a, 0)) / p['decay']))
    off = t >= dur
    if off.any():
        at_off = e[np.argmax(off)]
        e[off] = at_off * np.clip(1 - (t[off] - dur) / max(p['release'], 0.01), 0, 1)
    return e


def fm_note(f0, dur, p, prev_f):
    n = int((dur + p['release']) * SR)
    t = np.arange(n) / SR
    f = np.full(n, f0)
    if p.get('glide') and prev_f:
        g = min(p['glide'], dur)
        k = t < g
        f[k] = prev_f * (f0 / prev_f) ** (t[k] / g)
    if p.get('vibrato'):
        rate, depth, delay = p['vibrato']
        f = f * (1 + depth * np.clip((t - delay) / 0.3, 0, 1) * np.sin(2 * np.pi * rate * t))
    phase = 2 * np.pi * np.cumsum(f) / SR
    index = p['index'] * (p['index_floor'] + (1 - p['index_floor']) * np.exp(-t / p['index_decay']))
    return np.sin(phase + index * np.sin(p['ratio'] * phase)) * envelope(n, dur, p)


def perc_note(kind, f0, rng):
    if kind == 'tick':
        t = np.arange(int(0.05 * SR)) / SR
        return (0.6 * np.sin(2 * np.pi * f0 * t) + 0.4 * rng.uniform(-1, 1, len(t))) * np.exp(-t / 0.012)
    if kind == 'drip':
        t = np.arange(int(0.12 * SR)) / SR
        f = f0 * (1 + 1.2 * (1 - np.exp(-t / 0.012)))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * np.clip(t / 0.002, 0, 1)
    if kind == 'thump':
        t = np.arange(int(0.3 * SR)) / SR
        f = f0 * (0.5 + 0.5 * np.exp(-t / 0.05)) * 1.6
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.09) * np.clip(t / 0.004, 0, 1)
    raise ValueError(kind)


def render(track, seed):
    """One seamless loop: render the score twice, keep the second pass."""
    rng = np.random.default_rng(seed)
    unit = track['unit']
    lengths = set()
    parsed = []
    for inst, score in track['parts']:
        events, total = parse(score)
        lengths.add(round(total, 6))
        parsed.append((INSTRUMENTS[inst], events))
    if len(lengths) != 1:
        raise ValueError(f"parts differ in length: {sorted(lengths)} units")
    loop_units = lengths.pop()
    loop_n = int(round(loop_units * unit * SR))
    mix = np.zeros(2 * loop_n + int(3.5 * SR))
    for p, events in parsed:
        prev_f = None
        for rep in range(2):
            for start, dur, notes in events:
                s = int(round((start + rep * loop_units) * unit * SR))
                for m in notes:
                    if p['kind'] == 'fm':
                        y = fm_note(hz(m), dur * unit, p, prev_f if len(notes) == 1 else None)
                    else:
                        y = perc_note(p['kind'], hz(m), rng)
                    mix[s:s + len(y)] += p['gain'] * y
                if len(notes) == 1:
                    prev_f = hz(notes[0])
    loop = mix[loop_n:2 * loop_n]
    return loop / max(np.abs(loop).max(), 1e-9) * 0.9, loop_units * unit


def write_u8(path, x, seed):
    rng = np.random.default_rng(seed)
    dither = rng.uniform(-0.5, 0.5, len(x)) + rng.uniform(-0.5, 0.5, len(x))
    q = np.clip(np.round(x * 127 + dither) + 128, 0, 255).astype(np.uint8)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(1)                    # 8-bit WAV is unsigned, silence = 128
        w.setframerate(SR)
        w.writeframes(q.tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {'tracks': {}, 'title': PLACES['title'], 'ending': PLACES['ending'], 'rooms': PLACES['rooms']}
    for i, (name, track) in enumerate(TRACKS.items()):
        loop, seconds = render(track, seed=1990 + i)
        write_u8(os.path.join(OUT, f'{name}.wav'), loop, seed=2090 + i)
        index['tracks'][name] = {'file': f'{name}.wav', 'title': track['title'], 'seconds': round(seconds, 3)}
        print(f'{name:9s} {track["title"]!r:22s} {seconds:5.1f} s  {os.path.getsize(os.path.join(OUT, name + ".wav")) / 1024:5.0f} KB')
    with open(os.path.join(OUT, 'music.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(index, fh, indent=1)
        fh.write('\n')


if __name__ == '__main__':
    main()
