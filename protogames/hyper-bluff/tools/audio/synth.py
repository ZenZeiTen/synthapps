"""Hyper Bluff!! Starlight Showdown: shared synthesiser for music.py and sfx.py.

Pure numpy. Everything here is deterministic: noise comes from a seeded generator that the
caller passes in, and nothing reads the clock.

  oscillators   sine, band-limited wavetable saw/square/triangle/pulse, 2-operator FM
  envelopes     adsr, perc
  voices        FM brass, e-piano, bell, bass; saw lead, pulse (chip) lead, pad, strings, ...
  drums         kick, snare, hats, clap, crash, toms, rim
  mixer         Mix (stereo buffer; in loop mode every note tail wraps round to the start,
                so a loop is seamless by construction), circular delay and reverb, master
  writers       16-bit WAV, and OGG Vorbis through ffmpeg (bit-exact flags)
"""
import os
import re
import subprocess
import tempfile
import wave

import numpy as np

TAU = 2.0 * np.pi

# ------------------------------------------------------------------ pitch
_NOTE = re.compile(r"^([A-G])([#b]?)(-?\d)$")
_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACC = {"#": 1, "b": -1, "": 0}


def midi(name):
    """'C#5' -> MIDI note number (A4 = 69)."""
    m = _NOTE.match(name)
    if not m:
        raise ValueError("bad note name: %r" % name)
    return 12 * (int(m.group(3)) + 1) + _PC[m.group(1)] + _ACC[m.group(2)]


def pitch_class(name):
    """'Bb' -> 10."""
    return (_PC[name[0]] + _ACC[name[1:]]) % 12


def hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


# ------------------------------------------------------------------ envelopes
def adsr(gate, sr, a=0.005, d=0.05, s=0.7, r=0.05):
    """Attack/decay/sustain over `gate` seconds, then a release of `r` seconds that ends at 0."""
    ng = max(1, int(gate * sr))
    na = max(1, int(a * sr))
    nd = max(1, int(d * sr))
    nr = max(2, int(r * sr))
    t = np.arange(ng)
    e = np.where(t < na, t / na, s + (1.0 - s) * np.exp(-(t - na) / (nd / 3.0)))
    k = np.arange(nr)
    rel = e[-1] * np.exp(-k / (nr / 4.0)) * (1.0 - k / nr)
    return np.concatenate([e, rel])


def perc(dur, sr, tau, a=0.001, fade=0.006):
    """Percussive envelope: tiny attack, exponential decay, faded to 0 at the end."""
    n = max(4, int(dur * sr))
    t = np.arange(n) / sr
    e = np.exp(-t / tau)
    na = max(1, int(a * sr))
    e[:na] *= np.arange(na) / na
    nf = min(n, max(2, int(fade * sr)))
    e[-nf:] *= np.linspace(1.0, 0.0, nf)
    return e


def vib(n, sr, rate=5.5, depth=0.004, delay=0.15):
    """Frequency multiplier for vibrato that fades in after `delay` seconds."""
    t = np.arange(n) / sr
    ramp = np.clip((t - delay) / 0.2, 0.0, 1.0)
    return 1.0 + depth * ramp * np.sin(TAU * rate * t)


# ------------------------------------------------------------------ oscillators
_TN = 2048
_HSET = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512)
_tables = {}


def _table(kind, h):
    key = (kind, h)
    if key not in _tables:
        k = np.arange(1, h + 1)
        if kind == "saw":
            a = (2.0 / np.pi) * (-1.0) ** (k + 1) / k
        elif kind == "square":
            a = np.where(k % 2 == 1, (4.0 / np.pi) / k, 0.0)
        elif kind == "tri":
            a = np.where(k % 2 == 1, (8.0 / np.pi ** 2) * (-1.0) ** ((k - 1) // 2) / k ** 2, 0.0)
        else:
            raise ValueError(kind)
        a = a * np.sinc(k / (h + 1.0))            # Lanczos sigma: tames the Gibbs ripple
        ph = np.arange(_TN) / _TN * TAU
        tab = (a[:, None] * np.sin(np.outer(k, ph))).sum(axis=0)
        _tables[key] = np.append(tab, tab[0])
    return _tables[key]


def _phase(f, n, sr, ph0=0.0):
    if np.ndim(f) == 0:
        return ph0 + float(f) * np.arange(n) / sr, float(f)
    f = np.asarray(f, dtype=float)
    return ph0 + (np.cumsum(f) - f[0]) / sr, float(f.max())


def osc(kind, f, n, sr, ph0=0.0):
    """Band-limited saw/square/tri. `f` is Hz, a scalar or an array of n values."""
    phase, fmax = _phase(f, n, sr, ph0)
    hmax = max(1, int(0.45 * sr / max(fmax, 1.0)))
    h = max(x for x in _HSET if x <= hmax)
    tab = _table(kind, h)
    x = (phase % 1.0) * _TN
    i = x.astype(np.int64)
    fr = x - i
    return tab[i] * (1.0 - fr) + tab[i + 1] * fr


def pulse(f, n, sr, duty=0.25):
    """Band-limited pulse wave (difference of two saws)."""
    return 0.5 * (osc("saw", f, n, sr) - osc("saw", f, n, sr, ph0=duty))


def sine(f, n, sr, ph0=0.0):
    phase, _ = _phase(f, n, sr, ph0)
    return np.sin(TAU * phase)


def fm(f, n, sr, ratio=1.0, index=1.0, cratio=1.0):
    """Two-operator FM: sin(c + index * sin(m)). `index` may be an array."""
    phase, _ = _phase(f, n, sr)
    return np.sin(TAU * phase * cratio + index * np.sin(TAU * phase * ratio))


def filt(x, sr, lo=None, hi=None, order=2):
    """Zero-phase Butterworth-shaped filter done in the frequency domain (so it is circular:
    right for loop buffers, and for clips that start and end in silence)."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1.0 / sr)
    g = np.ones_like(f)
    if hi:
        g *= 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))
    if lo:
        g *= 1.0 / np.sqrt(1.0 + (lo / np.maximum(f, 1e-9)) ** (2 * order))
    spec = np.fft.rfft(x, axis=0)
    if x.ndim == 2:
        g = g[:, None]
    return np.fft.irfft(spec * g, n=n, axis=0)


def band_noise(rng, n, sr, centre, width):
    """Noise centred on `centre` Hz (scalar or array): low-passed noise ring-modulated by a
    sine at the centre frequency. A cheap way to sweep a noise band."""
    base = filt(rng.standard_normal(n), sr, hi=width)
    base /= (np.abs(base).max() + 1e-12)
    return base * sine(centre, n, sr)


# ------------------------------------------------------------------ voices
# Every voice takes (freq Hz, gate seconds, sample rate) and returns a mono array that is
# gate + release long, peaking near 1.
def v_brass(f, dur, sr):
    env = adsr(dur, sr, a=0.022, d=0.14, s=0.78, r=0.07)
    n = len(env)
    fv = f * vib(n, sr, 5.6, 0.0045, 0.16)
    idx = 0.7 + 2.7 * adsr(dur, sr, a=0.035, d=0.22, s=0.5, r=0.07)
    x = fm(fv, n, sr, 1.0, idx) + 0.55 * fm(fv * 1.005, n, sr, 1.0, idx * 0.8)
    return x * env / 1.5


def v_epiano(f, dur, sr):
    env = adsr(dur, sr, a=0.003, d=0.9, s=0.25, r=0.12)
    n = len(env)
    t = np.arange(n) / sr
    x = fm(f, n, sr, 1.0, 0.25 + 1.5 * np.exp(-t / 0.22))
    x += 0.35 * fm(f, n, sr, 14.0, 0.8 * np.exp(-t / 0.05))
    x += 0.3 * fm(f * 1.003, n, sr, 1.0, 0.3)
    return x * env / 1.6


def v_bell(f, dur, sr):
    gate = max(dur, 0.25)
    env = adsr(gate, sr, a=0.002, d=0.7, s=0.0, r=0.25)
    n = len(env)
    t = np.arange(n) / sr
    x = fm(f, n, sr, 3.5, 2.2 * np.exp(-t / 0.25)) + 0.4 * sine(f * 2.0, n, sr)
    return x * env / 1.4


def v_fmbass(f, dur, sr, grit=3.4):
    env = adsr(dur, sr, a=0.003, d=0.16, s=0.62, r=0.03)
    n = len(env)
    t = np.arange(n) / sr
    x = 0.8 * fm(f, n, sr, 1.0, 0.5 + grit * np.exp(-t / 0.07)) + 0.55 * sine(f, n, sr)
    return x * env / 1.3


def v_rockbass(f, dur, sr):
    return v_fmbass(f, dur, sr, grit=5.0)


def v_subbass(f, dur, sr):
    env = adsr(dur, sr, a=0.012, d=0.3, s=0.8, r=0.08)
    n = len(env)
    x = sine(f, n, sr) + 0.35 * fm(f, n, sr, 1.0, 0.9) + 0.12 * sine(2 * f, n, sr)
    return x * env / 1.4


def v_sawlead(f, dur, sr):
    env = adsr(dur, sr, a=0.008, d=0.1, s=0.82, r=0.06)
    n = len(env)
    fv = f * vib(n, sr, 6.0, 0.005, 0.14)
    x = osc("saw", fv, n, sr) + 0.7 * osc("saw", fv * 1.006, n, sr, 0.31) + 0.7 * osc("saw", fv * 0.994, n, sr, 0.67)
    return filt(x * env, sr, hi=6500) / 1.9


def v_pulse(f, dur, sr, duty=0.25):
    env = adsr(dur, sr, a=0.003, d=0.07, s=0.72, r=0.035)
    n = len(env)
    fv = f * vib(n, sr, 6.5, 0.004, 0.12)
    return pulse(fv, n, sr, duty) * env * 1.25


def v_square(f, dur, sr):
    return v_pulse(f, dur, sr, 0.5) * 1.5


def v_pad(f, dur, sr):
    env = adsr(dur, sr, a=0.22, d=0.3, s=0.9, r=0.35)
    n = len(env)
    x = osc("saw", f * 1.004, n, sr) + osc("saw", f * 0.996, n, sr, 0.5) + 0.5 * sine(f, n, sr)
    return filt(x * env, sr, hi=1700) / 1.6


def v_strings(f, dur, sr):
    env = adsr(dur, sr, a=0.11, d=0.3, s=0.88, r=0.25)
    n = len(env)
    fv = f * vib(n, sr, 5.2, 0.0035, 0.25)
    x = osc("saw", fv, n, sr) + osc("saw", fv * 1.007, n, sr, 0.37) + osc("saw", fv * 0.993, n, sr, 0.71)
    return filt(x * env, sr, hi=3600) / 2.2


def v_soft(f, dur, sr):
    """Mellow flute-like lead for the ballad."""
    env = adsr(dur, sr, a=0.045, d=0.25, s=0.85, r=0.14)
    n = len(env)
    fv = f * vib(n, sr, 5.0, 0.0045, 0.22)
    x = sine(fv, n, sr) + 0.28 * sine(fv * 2, n, sr) + 0.1 * sine(fv * 3, n, sr) + 0.25 * fm(fv, n, sr, 1.0, 0.6)
    return x * env / 1.45


def v_pluck(f, dur, sr):
    gate = min(dur, 0.16)
    env = adsr(gate, sr, a=0.002, d=0.1, s=0.15, r=0.05)
    n = len(env)
    x = pulse(f, n, sr, 0.35) + 0.5 * osc("saw", f * 1.003, n, sr)
    return filt(x * env, sr, hi=4200) / 1.1


def v_hit(f, dur, sr):
    """Orchestra-hit style stab: stacked octaves, fast decay."""
    gate = min(dur, 0.3)
    env = adsr(gate, sr, a=0.004, d=0.22, s=0.3, r=0.12)
    n = len(env)
    x = osc("saw", f, n, sr) + 0.8 * osc("saw", f * 2.003, n, sr, 0.3) + 0.7 * osc("saw", f * 0.5, n, sr, 0.6)
    x += 0.8 * fm(f, n, sr, 1.0, 1.2)
    return filt(x * env, sr, hi=5000) / 2.6


VOICES = {
    "brass": v_brass, "epiano": v_epiano, "bell": v_bell, "fmbass": v_fmbass,
    "rockbass": v_rockbass, "subbass": v_subbass, "sawlead": v_sawlead, "pulse": v_pulse,
    "square": v_square, "pad": v_pad, "strings": v_strings, "soft": v_soft,
    "pluck": v_pluck, "hit": v_hit,
}


# ------------------------------------------------------------------ drums
def kick(sr, rng, f0=47.0, f1=170.0, dur=0.34, tau=0.12):
    n = int(dur * sr)
    t = np.arange(n) / sr
    f = f0 + (f1 - f0) * np.exp(-t / 0.028)
    x = np.sin(TAU * np.cumsum(f) / sr) * np.exp(-t / tau)
    x += 0.25 * filt(rng.standard_normal(n), sr, hi=3500) * np.exp(-t / 0.004)
    return np.tanh(1.6 * x) * perc(dur, sr, 10.0, a=0.0005, fade=0.02)


def snare(sr, rng, dur=0.26, tone=185.0):
    n = int(dur * sr)
    t = np.arange(n) / sr
    nz = filt(rng.standard_normal(n), sr, lo=1400, hi=9000) * np.exp(-t / 0.065)
    f = tone + 60.0 * np.exp(-t / 0.02)
    body = np.sin(TAU * np.cumsum(f) / sr) * np.exp(-t / 0.045)
    x = 0.55 * nz + 0.75 * body
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.0005, fade=0.02)


def hat(sr, rng, dur=0.06, tau=0.016):
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = filt(rng.standard_normal(n), sr, lo=6500, order=3) * np.exp(-t / tau)
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.0005, fade=0.01)


def open_hat(sr, rng, dur=0.3):
    return hat(sr, rng, dur=dur, tau=0.09)


def clap(sr, rng, dur=0.22):
    n = int(dur * sr)
    t = np.arange(n) / sr
    nz = filt(rng.standard_normal(n), sr, lo=900, hi=5500)
    env = np.zeros(n)
    for off in (0.0, 0.011, 0.023):
        k = int(off * sr)
        env[k:] += np.exp(-(t[: n - k]) / 0.008)
    env += 0.8 * np.exp(-np.maximum(t - 0.03, 0.0) / 0.05) * (t >= 0.03)
    x = nz * env
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.0005, fade=0.02)


def crash(sr, rng, dur=1.7):
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = filt(rng.standard_normal(n), sr, lo=3500, order=2) * np.exp(-t / 0.42)
    for fq in (3117.0, 4371.0, 5783.0, 7219.0):
        x += 0.12 * osc("square", fq, n, sr) * np.exp(-t / 0.3)
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.001, fade=0.2)


def tom(sr, rng, f=120.0, dur=0.28):
    n = int(dur * sr)
    t = np.arange(n) / sr
    fr = f * (1.0 + 0.6 * np.exp(-t / 0.03))
    x = np.sin(TAU * np.cumsum(fr) / sr) * np.exp(-t / 0.09)
    x += 0.1 * filt(rng.standard_normal(n), sr, hi=4000) * np.exp(-t / 0.006)
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.0005, fade=0.02)


def rim(sr, rng, dur=0.09):
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = (np.sin(TAU * 1720.0 * t) + 0.6 * np.sin(TAU * 820.0 * t)) * np.exp(-t / 0.012)
    x += 0.3 * filt(rng.standard_normal(n), sr, lo=2500) * np.exp(-t / 0.004)
    return x / np.abs(x).max() * perc(dur, sr, 10.0, a=0.0005, fade=0.01)


def make_kit(sr, seed):
    rng = np.random.default_rng(seed)
    return {
        "kick": kick(sr, rng), "snare": snare(sr, rng), "hat": hat(sr, rng),
        "ohat": open_hat(sr, rng), "clap": clap(sr, rng), "crash": crash(sr, rng),
        "tom1": tom(sr, rng, 175.0), "tom2": tom(sr, rng, 130.0), "tom3": tom(sr, rng, 95.0),
        "rim": rim(sr, rng),
    }


# ------------------------------------------------------------------ mixer and effects
class Mix:
    """Stereo buffer. With loop=True anything running past the end wraps to the start."""

    def __init__(self, n, sr, loop=True):
        self.n, self.sr, self.loop = int(n), sr, loop
        self.buf = np.zeros((self.n, 2))

    def add(self, sig, start, gain=1.0, pan=0.0):
        a = (pan + 1.0) * np.pi / 4.0
        gl, gr = gain * np.cos(a) * 1.41421356, gain * np.sin(a) * 1.41421356
        start = int(start)
        if self.loop:
            start %= self.n
            pos = 0
            while pos < len(sig):
                m = min(len(sig) - pos, self.n - start)
                self.buf[start:start + m, 0] += gl * sig[pos:pos + m]
                self.buf[start:start + m, 1] += gr * sig[pos:pos + m]
                pos += m
                start = 0
        else:
            m = min(len(sig), self.n - start)
            if m > 0:
                self.buf[start:start + m, 0] += gl * sig[:m]
                self.buf[start:start + m, 1] += gr * sig[:m]


def delay(x, sr, time, feedback=0.4, mix=0.3, taps=5, ping=True):
    """Circular multi-tap echo (wraps round a loop buffer). ping=True swaps sides per tap."""
    d = int(time * sr)
    out = x.copy()
    for k in range(1, taps + 1):
        tap = np.roll(x, k * d, axis=0) * (mix * feedback ** (k - 1))
        if ping and k % 2 == 1:
            tap = tap[:, ::-1]
        out += tap
    return out


def reverb(x, sr, t60=1.4, seed=7, predelay=0.012, bright=5000.0):
    """Circular convolution with a synthetic decaying-noise impulse response. Returns the wet
    signal only."""
    n = len(x)
    m = min(n, int((t60 * 1.3 + predelay) * sr))
    rng = np.random.default_rng(seed)
    t = np.arange(m) / sr
    ir = rng.standard_normal((m, 2)) * np.exp(-6.9 * t / t60)[:, None]
    ir[: int(predelay * sr)] = 0.0
    ir = filt(ir, sr, lo=250.0, hi=bright)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    full = np.zeros((n, 2))
    full[:m] = ir
    spec = np.fft.rfft(x, axis=0) * np.fft.rfft(full, axis=0)
    return np.fft.irfft(spec, n=n, axis=0)


def soft_limit(x, knee=0.6):
    a = np.abs(x)
    over = a > knee
    y = x.copy()
    y[over] = np.sign(x[over]) * (knee + (1.0 - knee) * np.tanh((a[over] - knee) / (1.0 - knee)))
    return y


def master(x, peak=0.84, rms=0.2):
    """Remove DC, bring the mix to a working level, soft-limit the peaks, set the final peak."""
    x = x - x.mean(axis=0)
    level = np.sqrt((x ** 2).mean())
    y = soft_limit(x * (rms / max(level, 1e-9)))
    return y * (peak / np.abs(y).max())


def fade_out(x, sr, secs):
    n = min(len(x), int(secs * sr))
    y = x.copy()
    ramp = np.linspace(1.0, 0.0, n) ** 1.5
    y[-n:] = y[-n:] * (ramp[:, None] if y.ndim == 2 else ramp)
    return y


def finish_sfx(x, sr, peak=0.708, fade=0.008, fade_in=0.0008):
    """Trim to a clean clip: short fade in and out (no click), peak at about -3 dBFS."""
    y = np.asarray(x, dtype=float).copy()
    y -= y.mean()
    ni = max(1, int(fade_in * sr))
    y[:ni] *= np.linspace(0.0, 1.0, ni)
    nf = min(len(y), max(2, int(fade * sr)))
    y[-nf:] *= np.linspace(1.0, 0.0, nf)
    return y * (peak / np.abs(y).max())


# ------------------------------------------------------------------ writers
def write_wav(path, x, sr):
    """16-bit PCM. x is mono (n,) or stereo (n, 2) in -1..1."""
    pcm = np.clip(np.round(np.asarray(x) * 32767.0), -32768, 32767).astype("<i2")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1 if pcm.ndim == 1 else pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def have_vorbis():
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    except OSError:
        return False
    return "libvorbis" in out


def write_ogg(path, x, sr, kbps=96):
    """OGG Vorbis through ffmpeg/libvorbis. The bitexact flags keep the output byte-identical
    from run to run (fixed stream serial, no encoder tag, no date)."""
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "in.wav")
        write_wav(src, x, sr)
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
               "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
               "-c:a", "libvorbis", "-b:a", "%dk" % kbps, str(path)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError("ffmpeg failed for %s: %s" % (path, res.stderr.strip()))
