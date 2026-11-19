"""Build every code-drawn sprite and tile sheet: runs build() in each art_*.py module
found next to this file (art_tiles, art_items, art_ui, and art_chars / art_enemies /
art_fx when present), then prints what was written.

    python3 pipeline/aseprite/build_art.py            # all modules
    python3 pipeline/aseprite/build_art.py tiles ui   # only art_tiles and art_ui

Export afterwards with pipeline/aseprite/export_art.py.
"""
from __future__ import annotations

import glob
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))


def modules(only: list[str]) -> list[str]:
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(HERE, "art_*.py")))
    if only:
        want = {n if n.startswith("art_") else "art_" + n for n in only}
        missing = want - set(names)
        if missing:
            sys.exit(f"no such module: {' '.join(sorted(missing))}")
        names = [n for n in names if n in want]
    return names


def main() -> None:
    total, failed = 0, []
    for name in modules(sys.argv[1:]):
        t = time.time()
        try:
            mod = importlib.import_module(name)
            if not hasattr(mod, "build"):
                print(f"{name}: no build(), skipped")
                continue
            paths = mod.build()
        except Exception as e:  # report and carry on so one broken module does not hide the rest
            print(f"{name}: FAILED: {type(e).__name__}: {e}")
            failed.append(name)
            continue
        n = len(paths) if isinstance(paths, (list, tuple)) else None
        total += n or 0
        print(f"{name}: {'built' if n is None else f'{n} files'} in {time.time() - t:.1f}s")
    print(f"built {total} art files" + (f"; failed: {' '.join(failed)}" if failed else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
