"""Headless-browser checks for hd2d-forge/assets/hd2d-threejs.js.

Builds a sprite fixture, makes its normal map with scripts/sprite_normalmap.py, then runs
tests/browser/hd2d-threejs.check.mjs in headless Chromium. Skips unless Node.js, the
browser test packages and Chromium are available:

    cd gamedev-forge/tests/browser && npm ci
    export CHROMIUM_PATH=/path/to/chrome   # optional
    python -m unittest discover -s gamedev-forge/tests -t gamedev-forge
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
BROWSER = HERE / "browser"
SKILL = HERE.parent / "plugins/gamedev-forge/skills/hd2d-forge"
SCRIPT = SKILL / "scripts/sprite_normalmap.py"
CHROMIUM = Path(
    os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
)

sys.path.insert(0, str(SCRIPT.parent))
import sprite_normalmap  # noqa: E402


def capsule_sprite() -> list[list[tuple[int, int, int, int]]]:
    """32x48 frame: a 20-texel-wide capsule from image row 6 to row 47, feet on the bottom."""
    rows = []
    for y in range(48):
        row = []
        for x in range(32):
            cx, r = 15.5, 10.0
            if y < 6:
                inside = False
            elif y < 16:  # rounded head
                inside = (x - cx) ** 2 + (y - 16) ** 2 <= r**2
            else:
                inside = abs(x - cx) <= r
            row.append((170, 140, 120, 255) if inside else (0, 0, 0, 0))
        rows.append(row)
    return rows


@unittest.skipUnless(shutil.which("node"), "Node.js not installed")
@unittest.skipUnless((BROWSER / "node_modules/three").is_dir(), "run `npm ci` in tests/browser")
@unittest.skipUnless(CHROMIUM.exists(), "Chromium not found; set CHROMIUM_PATH")
class Hd2dThreejsBrowserTests(unittest.TestCase):
    def test_module_in_headless_chromium(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixtures = Path(tmp)
            sprite_normalmap.write_png(fixtures / "sprite.png", 32, 48, capsule_sprite())
            made = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(fixtures / "sprite.png"),
                    str(fixtures / "sprite_n.png"),
                    "--bevel",
                    "3",
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(made.returncode, 0, made.stderr)
            proc = subprocess.run(
                ["node", str(BROWSER / "hd2d-threejs.check.mjs"), str(fixtures)],
                capture_output=True,
                text=True,
                timeout=600,
                env={**os.environ, "CHROMIUM_PATH": str(CHROMIUM)},
            )
        try:
            report = json.loads(proc.stdout)
        except json.JSONDecodeError:
            self.fail(f"runner did not print JSON:\n{proc.stdout}\n{proc.stderr}")
        failed = [c for c in report["checks"] if not c["ok"]]
        self.assertEqual(report["errors"], [], "page logged errors")
        self.assertEqual(failed, [], json.dumps(failed, indent=2))
        self.assertGreaterEqual(len(report["checks"]), 9)
        self.assertTrue(report["ok"])


if __name__ == "__main__":
    unittest.main()
