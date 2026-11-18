"""Plant one fault at a time in the rules and check the core suite goes red.
    python tests/mutation_core.py"""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
G = os.environ.get("GODOT") or os.path.expanduser("~/Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe")
MUTANTS = [
    ("scripts/core/game.gd", "const JUMP_V := -4.45", "const JUMP_V := -3.6"),
    ("scripts/core/game.gd", "const WHIP_LEN := [0, 26, 26, 42]", "const WHIP_LEN := [0, 12, 12, 42]"),
    ("scripts/core/actors.gd", "\te.hp -= dmg\n", "\te.hp -= 0\n"),
    ("scripts/core/level.gd", "\t\t\t\twhile ch(ex + 1, ey - 1) == \"/\":", "\t\t\t\twhile false:"),
    ("scripts/core/game.gd", "\t\tif absf(fy - p.y) <= 1.0 and absf(fx - p.x) <= 12.0:", "\t\tif absf(fy - p.y) <= 1.0 and absf(fx - p.x) <= 2.0:"),
]
caught = 0
for path, a, b in MUTANTS:
    f = ROOT / path
    src = f.read_text(encoding="utf8")
    assert src.count(a) == 1, (path, a)
    f.write_text(src.replace(a, b), encoding="utf8", newline="\n")
    try:
        r = subprocess.run([G, "--headless", "--path", str(ROOT), "--script", "res://tests/run_tests.gd",
                            "--quit-after", "1000000"], capture_output=True, text=True, timeout=600)
        line = [l for l in r.stdout.splitlines() if l.startswith("TESTS")]
        ok = bool(line) and line[-1].split()[1].split("/")[0] == line[-1].split()[1].split("/")[1]
        fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
        print(("SURVIVED " if ok else "caught   ") + f"{path}: {b.strip()[:50]}  -> {', '.join(x[5:] for x in fails)[:90]}")
        caught += 0 if ok else 1
    finally:
        f.write_text(src, encoding="utf8", newline="\n")
print(f"MUTANTS {caught}/{len(MUTANTS)} caught")
