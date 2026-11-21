# Generates the promo's original background music (no samples, no licences needed).
# 90 s ambient-electronic bed at 100 BPM: warm pads (Am - F - C - G), a soft kick from the
# first feature scene, hi-hats and a pentatonic pluck arpeggio as the story builds, a lift
# before the outro and a gentle fade. Writes public/music.wav (then encode to m4a with ffmpeg).
import sys
import wave
import numpy as np

SR = 44100
DUR = 92.0
BPM = 100.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
n = int(SR * DUR)
t = np.arange(n) / SR
out = np.zeros((n, 2))

def note(m):  # MIDI -> Hz
    return 440.0 * 2 ** ((m - 69) / 12)

def env_adsr(length, a, d, s, r):
    e = np.ones(length) * s
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    ai = max(ai, 1)
    e[:ai] = np.linspace(0, 1, ai)
    if di > 0:
        e[ai:ai + di] = np.linspace(1, s, min(di, max(length - ai, 0)))[: len(e[ai:ai + di])]
    if ri > 0:
        e[-ri:] *= np.linspace(1, 0, ri)
    return e

def add(start, sig, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= n:
        return
    sig = sig[: n - i] * gain
    out[i:i + len(sig), 0] += sig * (1 - pan) * 0.5 + sig * 0.5 * (1 - abs(pan))
    out[i:i + len(sig), 1] += sig * (1 + pan) * 0.5 + sig * 0.5 * (1 - abs(pan))

# --- pads: Am, F, C, G (two bars each), detuned soft partials ---
chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
bar = 0
pos = 0.0
while pos < DUR:
    ch = chords[bar % 4]
    length = 2 * BAR
    L = int(length * SR) + int(1.0 * SR)
    tt = np.arange(L) / SR
    sig = np.zeros(L)
    for m in ch:
        f = note(m)
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            sig += 0.5 * np.sin(2 * np.pi * ff * tt) + 0.12 * np.sin(2 * np.pi * 2 * ff * tt) + 0.04 * np.sin(2 * np.pi * 3 * ff * tt)
    sig *= env_adsr(L, 1.2, 0.5, 0.85, 1.4) / (len(ch) * 3)
    # slow tremolo for movement
    sig *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.25 * tt)
    add(pos, sig, 0.0, 0.55)
    pos += length
    bar += 1

# --- bass on each bar's root ---
pos, bar = 0.0, 0
while pos < DUR:
    root = chords[(bar // 2) % 4][0] - 12
    L = int(BAR * SR)
    tt = np.arange(L) / SR
    sig = np.sin(2 * np.pi * note(root) * tt) * env_adsr(L, 0.02, 0.3, 0.6, 0.3)
    if pos >= 6.0:
        add(pos, sig, 0.0, 0.22)
    pos += BAR
    bar += 1

# --- kick from 6 s, hats from 18 s, both drop out for the outro calm (82 s+) ---
def kick():
    L = int(0.35 * SR)
    tt = np.arange(L) / SR
    f = 110 * np.exp(-tt * 18) + 42
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 9)

def hat():
    L = int(0.06 * SR)
    noise = np.random.default_rng(7).standard_normal(L)
    hp = np.diff(noise, prepend=0)
    return hp * np.exp(-np.arange(L) / SR * 70)

k, h = kick(), hat()
b = 0
x = 0.0
while x < DUR:
    if 6.0 <= x < 82.0:
        add(x, k, 0.0, 0.55)
    if 18.0 <= x < 82.0:
        add(x + BEAT / 2, h, 0.25, 0.10)
    x += BEAT
    b += 1

# --- pentatonic pluck arpeggio (A minor pentatonic), from 30 s to 82 s ---
penta = [69, 72, 74, 76, 79, 81, 84]
rng = np.random.default_rng(3)
x = 30.0
i = 0
while x < 82.0:
    m = penta[(i * 3 + (i // 4)) % len(penta)]
    L = int(0.9 * SR)
    tt = np.arange(L) / SR
    f = note(m)
    sig = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 6)
    add(x, sig, float(rng.uniform(-0.6, 0.6)), 0.10)
    x += BEAT / 2
    i += 1

# --- riser into the outro (79-82 s) and a bell on the logo (82.3 s) ---
L = int(3.0 * SR)
tt = np.arange(L) / SR
noise = np.random.default_rng(11).standard_normal(L)
rise = np.convolve(noise, np.ones(30) / 30, mode='same') * (tt / 3.0) ** 2
add(79.0, rise, 0.0, 0.18)
L = int(4.0 * SR)
tt = np.arange(L) / SR
bell = sum(np.sin(2 * np.pi * note(81) * r * tt) * a for r, a in ((1, 1), (2.76, 0.4), (5.4, 0.2))) * np.exp(-tt * 1.2)
add(82.3, bell, 0.0, 0.25)

# --- master: gentle fade in/out, soft limiter ---
fade_in = np.clip(t / 1.5, 0, 1)
fade_out = np.clip((DUR - 1.0 - t) / 4.0, 0, 1)
out *= (fade_in * fade_out)[:, None]
out = np.tanh(out * 1.6) / np.tanh(1.6)
out /= max(1e-9, np.abs(out).max()) / 0.85

path = sys.argv[1] if len(sys.argv) > 1 else 'public/music.wav'
with wave.open(path, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes())
print('wrote', path)
