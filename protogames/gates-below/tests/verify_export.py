"""Export check (needs the Godot 4.7.1 export templates installed).

Exports the Linux build, copies the single binary to an unrelated temporary folder,
runs a scripted battle in it under a virtual display and screenshots it. Passes when the
build starts, reports no script errors, and the screenshot shows the dungeon (not a
blank or error screen). The Windows preset exports the same way.

    python tests/verify_export.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GODOT = os.environ.get("GODOT", "godot")


def main():
    out = os.path.join(ROOT, "dist", "linux", "gates-below.x86_64")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    r = subprocess.run([GODOT, "--headless", "--path", os.path.join(ROOT, "godot"), "--export-release", "Linux", out],
                       capture_output=True, text=True, timeout=600)
    if not os.path.exists(out):
        print(r.stdout[-2000:], r.stderr[-2000:])
        print("FAIL export produced nothing (are the export templates installed?)")
        sys.exit(1)
    with tempfile.TemporaryDirectory() as tmp:
        exe = os.path.join(tmp, "gates-below.x86_64")
        shutil.copy2(out, exe)
        shot = os.path.join(tmp, "shot.png")
        run = subprocess.run(["xvfb-run", "-a", "-s", "-screen 0 1280x720x24", exe, "--rendering-driver", "opengl3",
                              "--resolution", "640x360", "--", "--script=seed:5,at:7:1:1,wait,tick:12,wait,wait",
                              "--shot=" + shot, "--frames=70"], capture_output=True, text=True, timeout=120, cwd=tmp)
        errors = [l for l in (run.stdout + run.stderr).splitlines() if "SCRIPT ERROR" in l or "Parse Error" in l]
        if errors or not os.path.exists(shot):
            print("\n".join(errors[:10]) or "no screenshot written")
            print("FAIL exported build")
            sys.exit(1)
        from PIL import Image
        im = Image.open(shot).convert("RGB")
        colours = len(set(im.getdata() if not hasattr(im, "get_flattened_data") else im.get_flattened_data()))
        size_mb = os.path.getsize(out) / 1e6
        print(f"export {size_mb:.0f} MB; ran from {tmp}; screenshot {im.size} with {colours} colours")
        if colours < 20:
            print("FAIL the screenshot looks blank")
            sys.exit(1)
    print("export OK")


if __name__ == "__main__":
    main()
