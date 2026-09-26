"""Checks the rendered background music against its scores.

    python tests/verify_music.py

1. Every track in content/music/music.json exists as 8-bit mono 22050 Hz WAV of the
   stated length, and every room and screen names a real track.
2. Each loop is seamless: the step from the last sample back to the first is no
   bigger than the track's ordinary sample-to-sample steps (99.9th percentile).
3. Every note of each melody line sounds at the written pitch. The line is rendered
   solo through the same synth, and each note's frequency is measured mid-note and
   must land within 2% of the score (a semitone is 5.9%). The expected pitch comes
   from this file's own reading of the note names, never from the synth's parser,
   so a parser bug can't agree with itself.

CROWMERE_ROOT / CROWMERE_MUSIC_SRC point it at another content tree and synth
(tests/mutation_music.py uses them to prove each check can fail).
"""
import json, os, sys, wave
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.environ.get('CROWMERE_ROOT', REPO)
sys.path.insert(0, os.environ.get('CROWMERE_MUSIC_SRC', os.path.join(REPO, 'pipeline', 'audio')))
import make_music as M  # noqa: E402

MUSIC = os.path.join(ROOT, 'content', 'music')

# pitch classes, spelled the way the scores spell them
CLASS = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
         'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def expected_hz(name):
    """C4 is middle C; A4 = 440 Hz; equal temperament."""
    pc, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((CLASS[pc] - 9) / 12 + (octave - 4))


def melody(score):
    """(start_units, dur_units, note_name) for every single note of a score line."""
    out, pos = [], 0.0
    for tok in score.replace('|', ' ').split():
        what, dur = tok.split(':')
        if what != 'r' and not what.startswith('['):
            out.append((pos, float(dur), what))
        pos += float(dur)
    return out
MELODY = {'crowmere': 'theremin', 'tiptoe': 'harpsi', 'below': 'bell', 'delivery': 'lead'}
errors = []


def read_wav(path):
    with wave.open(path, 'rb') as w:
        info = (w.getnchannels(), w.getsampwidth(), w.getframerate())
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.uint8)
    return info, (raw.astype(np.float64) - 128) / 127


def pitch(x):
    """Dominant frequency of a mono snippet (Hann window, zero-padded, parabolic peak)."""
    n = 1 << 16
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)), n))
    lo = int(40 * n / M.SR)                      # ignore DC and rumble
    k = lo + int(np.argmax(spec[lo:]))
    a, b, c = np.log(spec[k - 1:k + 2] + 1e-12)
    return (k + 0.5 * (a - c) / (a - 2 * b + c)) * M.SR / n


index = json.load(open(os.path.join(MUSIC, 'music.json'), encoding='utf-8'))
game = json.load(open(os.path.join(ROOT, 'content', 'game.json'), encoding='utf-8'))
for place in [index['title'], index['ending'], *index['rooms'].values()]:
    if place is not None and place not in index['tracks']:
        errors.append(f'music.json names unknown track {place!r}')
for room in game['rooms']:
    if room not in index['rooms']:
        errors.append(f'room {room!r} has no music entry (use null for silence)')

notes_checked = 0
for name, meta in index['tracks'].items():
    (ch, width, rate), x = read_wav(os.path.join(MUSIC, meta['file']))
    if (ch, width, rate) != (1, 1, M.SR):
        errors.append(f'{name}: {ch} ch, {8 * width}-bit, {rate} Hz; expected mono 8-bit {M.SR} Hz')
    if abs(len(x) / rate - meta['seconds']) > 0.01:
        errors.append(f'{name}: {len(x) / rate:.3f} s long, music.json says {meta["seconds"]}')
    steps = np.abs(np.diff(x))
    seam = abs(x[0] - x[-1])
    limit = np.percentile(steps, 99.9)
    if seam > limit:
        errors.append(f'{name}: loop seam jumps {seam:.3f}, ordinary steps stay under {limit:.3f}')

    # the melody, solo, through the same synth
    track = M.TRACKS[name]
    inst, score = next(p for p in track['parts'] if p[0] == MELODY[name])
    solo, _ = M.render(dict(track, parts=[(inst, score)]), seed=0)
    unit = track['unit']
    for start, dur, note in melody(score):
        seconds = dur * unit
        a = int((start * unit + min(0.1, 0.3 * seconds) + 0.02) * M.SR)
        b = int((start * unit + 0.8 * seconds) * M.SR)
        got, want = pitch(solo[a:b]), expected_hz(note)
        notes_checked += 1
        if abs(got / want - 1) > 0.02:
            errors.append(f'{name}: {note} at unit {start:g} should be {want:.1f} Hz, sounds {got:.1f} Hz')

if errors:
    print('\n'.join(errors))
    print(f'{len(errors)} problem(s)')
    sys.exit(1)
print(f'ok: {len(index["tracks"])} tracks, seamless loops, {notes_checked} melody notes at the written pitch')
