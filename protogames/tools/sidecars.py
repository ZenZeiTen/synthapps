"""Give every raw content file a keep-importer sidecar so Godot leaves it alone and the
export packs it byte for byte (the game reads content with FileAccess, not load())."""
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[1] / "godot" / "content"
KEEP = '[remap]\n\nimporter="keep"\n'
n = 0
for f in CONTENT.rglob("*"):
    if f.is_file() and f.suffix.lower() in (".png", ".wav", ".json", ".txt"):
        side = f.with_name(f.name + ".import")
        if not side.exists() or side.read_text() != KEEP:
            side.write_text(KEEP)
            n += 1
print("sidecars written:", n)
