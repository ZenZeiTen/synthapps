"""Copy the hand-edited content (content/data, content/levels) to both builds.

content/ is the only place to edit stages, rules and text. The Godot build reads
godot/content/, the three.js build web/public/content/. tests/verify_content.py fails
when a copy differs from its source.
"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAIRS = [("content/data", "godot/content/data"), ("content/levels", "godot/content/levels"), ("content/routes", "godot/content/routes"),
         ("content/data", "web/public/content/data"), ("content/levels", "web/public/content/levels"), ("content/routes", "web/public/content/routes")]


def main():
    for src, dst in PAIRS:
        s, d = ROOT / src, ROOT / dst
        d.mkdir(parents=True, exist_ok=True)
        for f in sorted(s.iterdir()):
            if f.is_file():
                shutil.copyfile(f, d / f.name)
        for f in d.iterdir():
            if f.is_file() and not (s / f.name).exists() and f.suffix in (".json", ".txt"):
                f.unlink()
    print("content synced")


if __name__ == "__main__":
    main()
