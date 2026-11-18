"""Audio check: every sound effect and music track exists and is well formed.

    python3 tests/verify_audio.py

Sound effects (godot/content/sfx/<name>.wav):
  - every name in SFX exists, and there are no stray WAVs;
  - mono, 22050 Hz, 16-bit PCM;
  - not silent (RMS above -40 dBFS), not clipped (no sample at full scale), peak near -3 dBFS;
  - short: at most 1.6 s for die/level/sigil/gate, 0.75 s for the rest, and most under 0.5 s;
  - no click at either end (first and last samples near zero).
Music (godot/content/music/<name>.ogg):
  - every track exists, decodes with soundfile, is Ogg Vorbis, stereo, 32000 Hz;
  - its duration is in the expected range, it is not silent and not clipped;
  - looped tracks join seamlessly: the jump from the last frame to the first is small
    against the track's RMS and the waveform keeps its slope across the seam;
  - the stage-clear jingle ends in silence;
  - all music together is under 7 MB.
Prints a one-line summary; exits 1 on any failure.
"""
from __future__ import annotations

import os
import sys
import wave

import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SFX_DIR = os.path.join(ROOT, "godot", "content", "sfx")
MUSIC_DIR = os.path.join(ROOT, "godot", "content", "music")

SFX = ("menu select back jump land bolt splash level key error bounce kill1 kill2 kill3 bonus bonus2 "
       "toadland ouch switch_on switch_off stonebounce die hit1 hit2 hit3 hit4 spring snap token "
       "enemyfire dronefire firebreath grunt torpedo hitwall toaddie gate spider crash heart berry shard "
       "fishdie sigil spikes masher slick sting door rockland lift warp pause").split()
LONG_SFX = {"die", "level", "sigil", "gate"}

# name: (min seconds, max seconds, looped)
MUSIC = {
    "title": (36, 44, True), "map": (40, 50, True), "hollow": (45, 55, True), "mines": (45, 55, True),
    "aqueduct": (50, 60, True), "canopy": (45, 55, True), "foundry": (45, 55, True),
    "spire": (55, 65, True), "clear": (3, 5, False), "ending": (22, 28, True),
}
MUSIC_BUDGET = 7 * 1000 * 1000

fails: list[str] = []


def db(v: float) -> float:
    return 20 * np.log10(max(v, 1e-12))


def check_sfx() -> int:
    present = {f[:-4] for f in os.listdir(SFX_DIR) if f.endswith(".wav")} if os.path.isdir(SFX_DIR) else set()
    for stray in sorted(present - set(SFX)):
        fails.append(f"sfx/{stray}.wav: not in the list of names")
    short = 0
    for name in SFX:
        path = os.path.join(SFX_DIR, name + ".wav")
        if not os.path.exists(path):
            fails.append(f"sfx/{name}.wav: missing")
            continue
        with wave.open(path) as w:
            ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
        if (ch, width, rate) != (1, 2, 22050):
            fails.append(f"sfx/{name}.wav: {ch} ch, {8 * width}-bit, {rate} Hz (want mono 16-bit 22050)")
            continue
        x = np.frombuffer(raw, "<i2").astype(np.float64) / 32768
        sec = n / rate
        peak, rms = np.max(np.abs(x)), np.sqrt(np.mean(x ** 2))
        if db(rms) < -40:
            fails.append(f"sfx/{name}.wav: silent (RMS {db(rms):.1f} dBFS)")
        if np.any(np.abs(x) >= 32767 / 32768):
            fails.append(f"sfx/{name}.wav: clipped")
        if not -3.5 <= db(peak) <= -2.5:
            fails.append(f"sfx/{name}.wav: peak {db(peak):.2f} dBFS, want about -3")
        limit = 1.6 if name in LONG_SFX else 0.75
        if sec > limit:
            fails.append(f"sfx/{name}.wav: {sec:.2f} s, longer than {limit} s")
        short += sec < 0.5
        if abs(x[0]) > 0.01 or abs(x[-1]) > 0.01:
            fails.append(f"sfx/{name}.wav: starts or ends away from zero (click)")
    if short < len(SFX) * 2 / 3:
        fails.append(f"sfx: only {short} of {len(SFX)} sounds are under 0.5 s")
    return len(SFX)


def join_ok(x: np.ndarray, rms: float) -> tuple[bool, str]:
    """Seamless loop, looking at the last frame -> first frame step of the file:
      - the step itself is small against the track's RMS;
      - the waveform keeps its slope across the seam: the second difference centred on
        the last and on the first frame is within 4x the 99th percentile of the second
        differences in the 64 ms either side (or under 0.02, about the level of Vorbis
        coding error). A loop whose note tails were cut at the end instead of folded back
        onto the start fails this wherever the seam is not masked by a drum hit."""
    jump = float(np.max(np.abs(x[0] - x[-1])))
    w = 2048
    worst = 0.0
    for ch in range(x.shape[1]):
        s = np.concatenate([x[-w:, ch], x[:w, ch]])
        d2 = np.abs(s[2:] - 2 * s[1:-1] + s[:-2])
        seam = float(d2[w - 2:w].max())
        ref = float(np.percentile(np.delete(d2, [w - 2, w - 1]), 99))
        worst = max(worst, seam / max(0.02, 4 * ref))
    ok = jump <= 0.5 * rms and worst <= 1.0
    return ok, f"step {jump:.4f} (RMS {rms:.3f}), curvature {worst:.2f}x the local limit"


def check_music() -> tuple[int, int]:
    total = 0
    for name, (lo, hi, looped) in MUSIC.items():
        path = os.path.join(MUSIC_DIR, name + ".ogg")
        if not os.path.exists(path):
            fails.append(f"music/{name}.ogg: missing")
            continue
        total += os.path.getsize(path)
        try:
            info = sf.info(path)
            x, rate = sf.read(path, always_2d=True)
        except Exception as e:  # noqa: BLE001 - any decode failure is a failed check
            fails.append(f"music/{name}.ogg: does not decode ({e})")
            continue
        if info.format != "OGG" or info.subtype != "VORBIS":
            fails.append(f"music/{name}.ogg: {info.format}/{info.subtype}, want OGG/VORBIS")
        if x.shape[1] != 2 or rate != 32000:
            fails.append(f"music/{name}.ogg: {x.shape[1]} ch at {rate} Hz, want stereo 32000")
            continue
        sec = len(x) / rate
        if not lo <= sec <= hi:
            fails.append(f"music/{name}.ogg: {sec:.1f} s, want {lo}-{hi} s")
        peak, rms = np.max(np.abs(x)), np.sqrt(np.mean(x ** 2))
        if db(rms) < -35:
            fails.append(f"music/{name}.ogg: nearly silent (RMS {db(rms):.1f} dBFS)")
        if peak >= 0.999:
            fails.append(f"music/{name}.ogg: clipped (peak {peak:.3f})")
        # no silent gap of a second or more inside the track
        f = rate // 10
        m = len(x) // f
        frame_db = 10 * np.log10(np.mean(x[: m * f].reshape(m, f, 2) ** 2, axis=(1, 2)) + 1e-12)
        quiet = frame_db < db(rms) - 30
        run = best = 0
        for q in quiet[: m - 10 if not looped else m]:
            run = run + 1 if q else 0
            best = max(best, run)
        if best >= 10:
            fails.append(f"music/{name}.ogg: {best / 10:.1f} s silent gap")
        if looped:
            ok, detail = join_ok(x, rms)
            if not ok:
                fails.append(f"music/{name}.ogg: loop join not seamless: {detail}")
        elif np.max(np.abs(x[-rate // 50:])) > 0.01:
            fails.append(f"music/{name}.ogg: one-shot does not end in silence")
    if total > MUSIC_BUDGET:
        fails.append(f"music: {total / 1e6:.2f} MB, over the {MUSIC_BUDGET / 1e6:.0f} MB budget")
    return len(MUSIC), total


def main() -> int:
    n_sfx = check_sfx()
    n_music, size = check_music()
    for f in fails:
        print("FAIL", f)
    status = "FAIL" if fails else "OK"
    print(f"verify_audio: {status}: {n_sfx} sfx, {n_music} music tracks ({size / 1e6:.2f} MB), {len(fails)} problems")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
