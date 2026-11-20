"""Audio checks for what a test run cannot hear.

    python3 tests/verify_audio.py            (from hyper-bluff/; add --stats for a table)

For every file the game expects in godot/assets/audio:
* it exists and decodes (OGG through ffmpeg to raw PCM; WAV through the wave module);
* it has the expected format and its length is inside the expected range;
* it is not silent (RMS above a floor) and does not clip (no run of full-scale samples);
* sound effects are mono 16-bit 22050 Hz, peak near -3 dBFS, and start and end near zero;
* each music piece is exactly as long as its score says (bars x 4 beats at the tempo, plus
  the jingle tail), to the millisecond, so a loop ends exactly on a bar line;
* each music loop is seamless: the step from the last sample to the first must not be
  larger than the steps found inside the track (whole track, and the 50 ms on each side
  of the seam), and the level of the last 50 ms must be in line with the first 50 ms.
The folder as a whole must stay under 5 MB.
Prints "AUDIO ok" and exits 0, or prints every failure and exits 1.
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "godot" / "assets" / "audio"
sys.path.insert(0, str(ROOT / "tools" / "audio"))
import music as M  # noqa: E402  (only the score data: bar counts, tempo, jingle tail)

# name: (shortest s, longest s, is a loop)
MUSIC = {
    "title": (40.0, 48.0, True), "match": (48.0, 60.0, True), "boss": (48.0, 60.0, True),
    "fever": (16.0, 24.0, True), "ending": (40.0, 50.0, True),
    "victory": (4.0, 5.0, False), "defeat": (3.0, 4.0, False),
}
# name: (shortest s, longest s)
SFX = {
    "card_deal": (0.05, 0.6), "card_flip": (0.05, 0.6), "chip_bet": (0.05, 0.6), "chip_win": (1.0, 1.4),
    "move": (0.02, 0.15), "ok": (0.05, 0.5), "cancel": (0.05, 0.5), "fold": (0.15, 0.8),
    "check": (0.15, 0.6), "allin": (1.2, 1.5), "powerup": (0.4, 1.5), "cutin": (0.3, 1.0),
    "star": (0.2, 1.0), "fever": (1.3, 1.6), "win_hand": (0.3, 1.0), "lose_hand": (0.3, 1.2),
    "meter_tick": (0.01, 0.08), "roulette_tick": (0.01, 0.1), "error": (0.15, 0.6), "type": (0.01, 0.08),
}
RMS_FLOOR = 0.02            # -34 dBFS
SEAM_GLOBAL = 1.0           # seam step <= this x the largest step anywhere in the track
SEAM_LOCAL = 2.0            # seam step <= this x the largest step within 50 ms of the seam
SIZE_LIMIT = 5 * 1024 * 1024

fails = []


def fail(msg):
    fails.append(msg)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "stream=codec_name,sample_rate,channels", "-of", "default=nw=1", str(path)],
        capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return dict(line.split("=", 1) for line in out.stdout.split() if "=" in line)


def decode(path, sr, ch):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-acodec", "pcm_s16le",
         "-ar", str(sr), "-ac", str(ch), "-"], capture_output=True)
    if out.returncode != 0 or not out.stdout:
        return None
    return np.frombuffer(out.stdout, dtype="<i2").reshape(-1, ch)


def read_wav(path):
    with wave.open(str(path)) as w:
        ch, sr, sw, n = w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        return None, sr, ch, sw
    return np.frombuffer(raw, dtype="<i2").reshape(-1, ch), sr, ch, sw


def clip_run(pcm):
    """Longest run of consecutive full-scale samples in any channel."""
    best = 0
    for c in range(pcm.shape[1]):
        hot = np.abs(pcm[:, c].astype(np.int32)) >= 32767
        if hot.any():
            edges = np.diff(np.concatenate([[0], hot.astype(np.int8), [0]]))
            best = max(best, int((np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)).max()))
    return best


def seam(pcm, sr):
    """(step across the seam, largest step in the track, largest step within 50 ms of the
    seam, RMS of the last 50 ms, RMS of the first 50 ms), worst channel, in full-scale units."""
    x = pcm.astype(float) / 32768.0
    w = int(0.05 * sr)
    jump = np.abs(x[0] - x[-1]).max()
    inner = np.abs(np.diff(x, axis=0)).max()
    local = max(np.abs(np.diff(x[:w], axis=0)).max(), np.abs(np.diff(x[-w:], axis=0)).max())
    return jump, inner, local, np.sqrt((x[-w:] ** 2).mean()), np.sqrt((x[:w] ** 2).mean())


def common(name, pcm, sr, lo, hi):
    """Checks shared by music and effects. Returns (seconds, peak, rms)."""
    secs = len(pcm) / sr
    x = pcm.astype(float) / 32768.0
    peak = np.abs(x).max()
    rms = np.sqrt((x ** 2).mean())
    if not lo <= secs <= hi:
        fail("%s: %.3f s long, expected %.2f to %.2f s" % (name, secs, lo, hi))
    if rms < RMS_FLOOR:
        fail("%s: silent or nearly so (RMS %.4f, floor %.4f)" % (name, rms, RMS_FLOOR))
    run = clip_run(pcm)
    if run >= 3:
        fail("%s: clips (%d full-scale samples in a row)" % (name, run))
    return secs, peak, rms


def db(v):
    return 20.0 * np.log10(max(v, 1e-9))


def main(argv):
    stats = "--stats" in argv
    rows = []
    total = 0
    # ---------------------------------------------------------------- music
    for name, (lo, hi, loop) in MUSIC.items():
        ogg, wav = AUDIO / (name + ".ogg"), AUDIO / (name + ".wav")
        path = ogg if ogg.exists() else wav
        if not path.exists():
            fail("missing music %s.ogg" % name)
            continue
        total += path.stat().st_size
        if path.suffix == ".ogg":
            info = probe(path)
            if not info:
                fail("%s: ffprobe cannot read it" % path.name)
                continue
            sr, ch = int(info.get("sample_rate", 0)), int(info.get("channels", 0))
            if info.get("codec_name") != "vorbis":
                fail("%s: codec is %s, not vorbis" % (path.name, info.get("codec_name")))
            if sr not in (32000, 44100) or ch not in (1, 2):
                fail("%s: %d Hz, %d channels (want 32000 or 44100 Hz, mono or stereo)" % (path.name, sr, ch))
                continue
            pcm = decode(path, sr, ch)
            if pcm is None:
                fail("%s: ffmpeg cannot decode it" % path.name)
                continue
        else:                                   # fallback when no Vorbis encoder exists
            pcm, sr, ch, sw = read_wav(path)
            if pcm is None or sr != 22050:
                fail("%s: fallback music must be 16-bit 22050 Hz WAV" % path.name)
                continue
        secs, peak, rms = common(path.name, pcm, sr, lo, hi)
        spec = M.TRACKS[name]
        bars = sum(len(sec["chords"].split("|")) for sec in spec["sections"])
        want = bars * 4 * 60.0 / spec["bpm"] + (0.0 if loop else spec["tail"])
        if abs(secs - want) > 0.001:
            fail("%s: %.4f s long but its score is %d bars at %d bpm = %.4f s" % (
                path.name, secs, bars, spec["bpm"], want))
        note = ""
        if loop:
            jump, inner, local, tail, head = seam(pcm, sr)
            note = "seam %.4f  inner %.4f  local %.4f" % (jump, inner, local)
            if jump > SEAM_GLOBAL * inner:
                fail("%s: loop seam step %.4f exceeds the largest step in the track %.4f" % (path.name, jump, inner))
            if jump > SEAM_LOCAL * local:
                fail("%s: loop seam step %.4f is over %.1fx the largest step near the seam %.4f" % (
                    path.name, jump, SEAM_LOCAL, local))
            if tail < 0.1 * head or head < 0.02 * tail:
                fail("%s: level drops out at the loop seam (last 50 ms RMS %.4f, first 50 ms %.4f)" % (
                    path.name, tail, head))
        else:
            x = pcm.astype(float) / 32768.0
            if np.abs(x[-1]).max() > 0.01:
                fail("%s: jingle does not end in silence (last sample %.4f)" % (path.name, np.abs(x[-1]).max()))
        rows.append((path.name, secs, peak, rms, path.stat().st_size, note))
    # ---------------------------------------------------------------- effects
    for name, (lo, hi) in SFX.items():
        path = AUDIO / (name + ".wav")
        if not path.exists():
            fail("missing effect %s.wav" % name)
            continue
        total += path.stat().st_size
        try:
            pcm, sr, ch, sw = read_wav(path)
        except (wave.Error, EOFError) as err:
            fail("%s: not a readable WAV (%s)" % (path.name, err))
            continue
        if pcm is None or sr != 22050 or ch != 1:
            fail("%s: must be mono 16-bit 22050 Hz (got %d ch, %d-bit, %d Hz)" % (path.name, ch, sw * 8, sr))
            continue
        secs, peak, rms = common(path.name, pcm, sr, lo, hi)
        if not -4.5 <= db(peak) <= -2.0:
            fail("%s: peak %.1f dBFS, want about -3" % (path.name, db(peak)))
        x = pcm[:, 0].astype(float) / 32768.0
        if abs(x[0]) > 0.02 or abs(x[-1]) > 0.02:
            fail("%s: starts or ends away from zero (%.3f, %.3f): it would click" % (path.name, x[0], x[-1]))
        rows.append((path.name, secs, peak, rms, path.stat().st_size, ""))
    extra = sorted(p.name for p in AUDIO.glob("*") if p.suffix in (".ogg", ".wav")
                   and p.stem not in MUSIC and p.stem not in SFX)
    if extra:
        fail("unexpected audio files: %s" % ", ".join(extra))
    if total > SIZE_LIMIT:
        fail("audio folder is %.2f MB, limit 5 MB" % (total / 1048576.0))
    if stats:
        for nm, secs, peak, rms, size, note in rows:
            print("  %-18s %7.3f s  peak %6.1f dBFS  rms %6.1f dBFS  %7d bytes  %s" % (
                nm, secs, db(peak), db(rms), size, note))
        print("  total %.2f MB in %d files" % (total / 1048576.0, len(rows)))
    if fails:
        for f in fails:
            print("FAIL " + f)
        print("AUDIO failed: %d problem(s)" % len(fails))
        return 1
    print("AUDIO ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
