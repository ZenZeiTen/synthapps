"""Both builds' copies of the hand-edited content match content/ (run
pipeline/sync_content.py after editing a stage, the rules or the text).

    python3 tests/verify_content.py
"""
import filecmp
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    errors = []
    n = 0
    for sub in ("data", "levels", "routes"):
        src = os.path.join(ROOT, "content", sub)
        for f in sorted(os.listdir(src)):
            for base in ("godot/content", "web/public/content"):
                dst = os.path.join(ROOT, base, sub, f)
                n += 1
                if not os.path.exists(dst) or not filecmp.cmp(os.path.join(src, f), dst, shallow=False):
                    errors.append(f"{base}/{sub}/{f} differs from content/{sub}/{f}")
    for e in errors:
        print("CONTENT", e)
    print("CONTENT ok (%d copies)" % n if not errors else "CONTENT FAIL (%d)" % len(errors))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
