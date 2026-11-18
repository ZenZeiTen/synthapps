"""Checks the exported builds, then packs the Windows build for delivery.

    python3 tests/verify_export.py

1. Exports Linux and Windows (Godot export templates 4.7 must be installed).
2. Runs the Linux binary from a temporary folder, headless: every asset loads, stage 1 is
   replayed through pad events, and the last stage is played by pad through the talks,
   the ending and the credits to the title (the same checks as tests/run_all.sh).
3. Runs the same checks on the data packed inside the Windows exe (--main-pack).
4. Packs dist/Tidebell-windows.7z (x86 BCJ + LZMA2 preset 9 extreme), which must stay
   under 30 MiB, unpacks it again and compares SHA-256 hashes.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

import py7zr

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST = os.path.join(ROOT, "dist")
LIMIT = 30 * 1024 * 1024
FINAL = ("replay:brinecrow:pad:talk:end,waittalk,wait:30,ptap:start,waittalk,wait:30,ptap:start,wait:30,ptap:start,"
         "waittalk,wait:30,ptap:start,wait:30,ptap:start,wait:30,ptap:start,wait:200,pad:x,wait:120,padup:x,wait:60,"
         "ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,wait:60,ptap:a,wait:30,wait:200,dump,quit")
CHECKS = [("assets,quit", "ASSETS ok"), ("replay:reach:pad", "REPLAY reach ok"), (FINAL, "DUMP mode=title")]


def run(cmd, cwd, want):
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=1800)
    text = out.stdout + out.stderr
    if want not in text or "SCRIPT ERROR" in text:
        print(text[-3000:])
        sys.exit(f"EXPORT FAIL: {' '.join(cmd[:4])} did not print {want!r}")
    print(f"ok   {want}")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    os.makedirs(os.path.join(DIST, "windows"), exist_ok=True)
    os.makedirs(os.path.join(DIST, "linux"), exist_ok=True)
    for preset, out in (("Linux", "linux/tidebell.x86_64"), ("Windows Desktop", "windows/tidebell.exe")):
        subprocess.run(["godot", "--headless", "--path", os.path.join(ROOT, "godot"), "--export-release", preset,
                        os.path.join(DIST, out)], check=True, capture_output=True, timeout=900)
    linux = os.path.join(DIST, "linux", "tidebell.x86_64")
    exe = os.path.join(DIST, "windows", "tidebell.exe")
    with tempfile.TemporaryDirectory() as tmp:
        bin_ = os.path.join(tmp, "tidebell.x86_64")
        shutil.copy(linux, bin_)
        for script, want in CHECKS:
            run([bin_, "--headless", "--quit-after", "40000", "--", "--script=" + script], tmp, want)
        for script, want in CHECKS:
            run(["godot", "--headless", "--main-pack", exe, "--quit-after", "40000", "--", "--script=" + script], tmp, want)
    readme = os.path.join(DIST, "windows", "README.txt")
    shutil.copy(os.path.join(ROOT, "dist_readme.txt"), readme)
    with open(readme, "rb") as f:
        data = f.read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    with open(readme, "wb") as f:
        f.write(data)
    arc = os.path.join(DIST, "Tidebell-windows.7z")
    if os.path.exists(arc):
        os.remove(arc)
    filters = [{"id": py7zr.FILTER_X86}, {"id": py7zr.FILTER_LZMA2, "preset": 9 | py7zr.PRESET_EXTREME}]
    with py7zr.SevenZipFile(arc, "w", filters=filters) as z:
        z.write(exe, "Tidebell/tidebell.exe")
        z.write(readme, "Tidebell/README.txt")
    size = os.path.getsize(arc)
    print(f"7z {size / 1024 / 1024:.2f} MiB")
    if size >= LIMIT:
        sys.exit("EXPORT FAIL: the 7z is over 30 MiB")
    with tempfile.TemporaryDirectory() as tmp:
        with py7zr.SevenZipFile(arc, "r") as z:
            z.extractall(tmp)
        for src, name in ((exe, "tidebell.exe"), (readme, "README.txt")):
            if sha(src) != sha(os.path.join(tmp, "Tidebell", name)):
                sys.exit(f"EXPORT FAIL: {name} unpacks differently")
    print("ok   the 7z unpacks byte-identical")
    print("EXPORT ok")


if __name__ == "__main__":
    main()
