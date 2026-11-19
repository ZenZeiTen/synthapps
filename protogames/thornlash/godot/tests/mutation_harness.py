"""Plant one fault at a time in the view/app code and check the harness goes red.
    python tests/mutation_harness.py"""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MUTANTS = [
    ("scripts/main.gd", "\t\tgame.restore(history[history.size() - 1])", "\t\tpass  # MUTANT", "rewind undoes a death"),
    ("scripts/main.gd", "\tif screen_t > 48 and _any_pressed():", "\tif _any_pressed():", "story pages ignore"),
    ("scripts/core/game.gd", "\tif not s.inf_lives:\n\t\ts.lives -= 1", "\tif true:\n\t\ts.lives -= 1", "infinite lives"),
    ("scripts/main.gd", '\t\treturn "boss"', '\t\treturn "stage1"', "music follows"),
]
results = []
for path, a, b, test in MUTANTS:
    f = ROOT / path
    src = f.read_text(encoding="utf8")
    assert src.count(a) == 1, (path, a)
    f.write_text(src.replace(a, b), encoding="utf8", newline="\n")
    try:
        r = subprocess.run(["bash", str(ROOT / "tests" / "harness.sh")], env={**os.environ, "ONLY": test},
                           capture_output=True, text=True, timeout=900)
        caught = "FAIL" in r.stdout
        results.append((test, caught))
        print(("caught   " if caught else "SURVIVED ") + test)
    finally:
        f.write_text(src, encoding="utf8", newline="\n")
print("MUTANTS %d/%d caught" % (sum(c for _, c in results), len(results)))
