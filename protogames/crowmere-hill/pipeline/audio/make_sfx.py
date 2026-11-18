"""PC-speaker style sound effects, synthesised from scratch (square waves, noise,
sweeps) -- no samples, nothing borrowed. Writes content/sfx/*.wav and sfx.json.

    python pipeline/audio/make_sfx.py
"""
import json, os, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'sfx')
SR = 22050
rng = np.random.default_rng(1990)


def t(sec):
    return np.arange(int(SR * sec)) / SR


def square(freq, sec, duty=0.5):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (int(SR * sec),))
    phase = np.cumsum(f) / SR
    return np.where((phase % 1.0) < duty, 1.0, -1.0)


def env(x, attack=0.005, release=0.05):
    n = len(x)
    e = np.ones(n)
    a, r = int(SR * attack), int(SR * release)
    if a:
        e[:a] = np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r)
    return x * e


def decay(x, rate):
    return x * np.exp(-rate * np.arange(len(x)) / SR)


def notes(seq, duty=0.5, gap=0.02):
    """seq: [(midi_note or None, seconds)] -> a little square-wave tune."""
    parts = []
    for n, d in seq:
        if n is None:
            parts.append(np.zeros(int(SR * d)))
        else:
            f = 440.0 * 2 ** ((n - 69) / 12)
            tone = env(square(f, d - gap, duty), 0.003, 0.02)
            parts += [tone, np.zeros(int(SR * gap))]
    return np.concatenate(parts)


def noise(sec):
    return rng.uniform(-1, 1, int(SR * sec))


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode='same')


SFX = {
    # UI
    'score': notes([(84, 0.06), (91, 0.1)], duty=0.25),
    'death': notes([(67, 0.18), (66, 0.18), (65, 0.18), (64, 0.5)], duty=0.5, gap=0.03),
    'win': notes([(60, 0.12), (64, 0.12), (67, 0.12), (72, 0.24), (67, 0.12), (72, 0.45)], duty=0.25),
    # the house
    'slam': decay(lowpass(noise(0.45), 6) * 1.4 + 0.6 * square(55, 0.45), 9.0),
    'knock': np.concatenate([decay(square(95, 0.09) + 0.4 * lowpass(noise(0.09), 3), 30.0), np.zeros(int(SR * 0.12)),
                             decay(square(95, 0.09) + 0.4 * lowpass(noise(0.09), 3), 30.0)]),
    'clunk': decay(square(70, 0.22) * 0.8 + lowpass(noise(0.22), 4) * 0.5, 18.0),
    'creak': env(square(260 + 90 * np.sin(2 * np.pi * 7 * t(0.75)) + 140 * t(0.75), 0.75, duty=0.2) * 0.6, 0.02, 0.15),
    'match': env(decay(noise(0.12), 20.0), 0.001, 0.02).tolist() + (0.25 * decay(lowpass(noise(0.35), 2), 6.0)).tolist(),
    'whistle': env(0.25 * np.sin(2 * np.pi * np.cumsum(2300 + 400 * t(0.6)) / SR), 0.03, 0.1),
    'caw': np.concatenate([env(square(820 - 500 * t(0.18), 0.18, duty=0.3), 0.005, 0.04), np.zeros(int(SR * 0.08)),
                           env(square(760 - 480 * t(0.22), 0.22, duty=0.3), 0.005, 0.05)]),
    'bark': np.concatenate([env(square(460 - 220 * t(0.11), 0.11) * 0.8 + 0.3 * noise(0.11), 0.004, 0.03), np.zeros(int(SR * 0.1)),
                            env(square(430 - 200 * t(0.13), 0.13) * 0.8 + 0.3 * noise(0.13), 0.004, 0.03)]),
    'thunder': decay(lowpass(noise(1.8), 60) * 6.0 + 0.3 * lowpass(noise(1.8), 12), 1.8),
}


def write(name, x):
    x = np.asarray(x, dtype=np.float64)
    peak = np.max(np.abs(x)) or 1.0
    pcm = (x / peak * 0.8 * 32767).astype('<i2')
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for name, samples in SFX.items():
        write(name, samples)
        index[name] = name + '.wav'
    with open(os.path.join(OUT, 'sfx.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(index, fh, indent=1)
        fh.write('\n')
    print(f'{len(index)} effects -> content/sfx/')
