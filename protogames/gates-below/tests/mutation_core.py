"""Mutation check for the GDScript core: plant a fault, run the headless suite, and
require it to FAIL. A suite that can't fail proves nothing.

    python tests/mutation_core.py
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CORE = os.path.join(ROOT, "godot", "scripts", "core")
GODOT = os.environ.get("GODOT", "godot")

MUTANTS = [
    ("hit ignores STR/DEX", "rules.gd", "+ (int(a[\"str\"]) * 15 + int(a[\"dex\"]) * 10) / 150", ""),
    ("AP from MOB/10", "rules.gd", "return maxi(mob / 15, 0)", "return maxi(mob / 10, 0)"),
    ("fizzle and backfire swapped", "rules.gd", "return {\"result\": \"backfire\", \"learn\": false}", "return {\"result\": \"fizzle\", \"learn\": false}"),
    ("items do not press plates", "game.gd", "\t\t\tif not pile(c, k).is_empty():\n\t\t\t\tpressed = true", "\t\t\tif false:\n\t\t\t\tpressed = true"),
    ("illusion walls are solid", "game.gd", "\t\t\"open\", \"secret\":\n\t\t\treturn true", "\t\t\"open\":\n\t\t\treturn true"),
    ("runes are not learned", "game.gd", "\t\t\tif not r in s[\"runes\"]:\n\t\t\t\ts[\"runes\"].append(r)", "\t\t\tpass"),
    ("STR point raises HP by 2", "game.gd", "b[\"hp_max\"] = int(b[\"hp_max\"]) + int(1.5 * n) - int(1.5 * o)", "b[\"hp_max\"] = int(b[\"hp_max\"]) + 2"),
    ("disc interpolation loses its rounding", "rules.gd", "return x + ((q + 8) >> 4)", "return x + (q >> 4)"),
    ("created characters skip the STR>20 bonus", "game.gd", "\t\tif int(st[\"str\"]) > 20:\n\t\t\tch[\"base\"][\"atk_h\"] = int(ch[\"base\"][\"atk_h\"]) + 1", "\t\tif false:\n\t\t\tpass"),
    ("doors open instantly and never block", "game.gd", "\t\t\"door\", \"gate\":\n\t\t\treturn float(door_state(fi)[\"p\"]) >= 1.0", "\t\t\"door\", \"gate\":\n\t\t\treturn true"),
]


def run_suite() -> bool:
    r = subprocess.run([GODOT, "--headless", "--path", os.path.join(ROOT, "godot"), "--script", "res://tests/run_tests.gd"],
                       capture_output=True, text=True, timeout=600)
    return r.returncode == 0


def main():
    if not run_suite():
        print("the unmutated suite fails; fix that first")
        sys.exit(2)
    caught = 0
    for name, fname, old, new in MUTANTS:
        path = os.path.join(CORE, fname)
        src = open(path).read()
        if old not in src:
            print(f"MUTANT NOT APPLIED: {name} (pattern missing in {fname})")
            continue
        open(path, "w").write(src.replace(old, new, 1))
        try:
            ok = run_suite()
        finally:
            open(path, "w").write(src)
        print(("caught   " if not ok else "SURVIVED ") + name)
        caught += 0 if ok else 1
    print(f"{caught}/{len(MUTANTS)} mutants caught")
    sys.exit(0 if caught == len(MUTANTS) else 1)


if __name__ == "__main__":
    main()
