"""Checks for the gamedev-forge marketplace entries, plugins and release scanner.

Run from the repository root or from gamedev-forge/:
    python -m unittest discover -s gamedev-forge/tests -t gamedev-forge
"""

from __future__ import annotations

import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
REPO = PROJECT.parent
PLUGINS = PROJECT / "plugins"
CORE = PLUGINS / "gamedev-forge"
CONNECTORS = PLUGINS / "gamedev-forge-connectors"
MARKETPLACE = REPO / ".claude-plugin" / "marketplace.json"

sys.path.insert(0, str(PROJECT / "tools"))
import sanitize_scan  # noqa: E402


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class MarketplaceTests(unittest.TestCase):
    def test_entries_match_plugin_manifests(self) -> None:
        market = load_json(MARKETPLACE)
        self.assertTrue(market["name"])
        self.assertTrue(market["owner"]["name"])
        names = [p["name"] for p in market["plugins"]]
        self.assertEqual(sorted(names), ["gamedev-forge", "gamedev-forge-connectors"])
        for entry in market["plugins"]:
            source = entry["source"]
            self.assertTrue(source.startswith("./"), source)
            self.assertNotIn("..", source)
            plugin_dir = (REPO / source).resolve()
            manifest = load_json(plugin_dir / ".claude-plugin" / "plugin.json")
            self.assertEqual(manifest["name"], entry["name"], "entry and manifest names must agree")
            self.assertEqual(
                manifest["version"], entry["version"], "entry and manifest versions must agree"
            )
            self.assertRegex(manifest["name"], r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_core_plugin_starts_no_servers(self) -> None:
        # The core plugin must make no network connections on its own; servers are opt-in.
        self.assertFalse((CORE / ".mcp.json").exists())
        self.assertNotIn("mcpServers", load_json(CORE / ".claude-plugin" / "plugin.json"))


class DirectoryPolicyTests(unittest.TestCase):
    """Checks mirroring the plugin directory's validation warnings."""

    def test_each_plugin_has_a_square_icon(self) -> None:
        for plugin in (CORE, CONNECTORS):
            icon = plugin / ".claude-plugin" / "icon.svg"
            text = icon.read_text(encoding="utf-8")
            m = re.search(r'<svg[^>]*width="(\d+)"[^>]*height="(\d+)"', text)
            self.assertIsNotNone(m, icon)
            assert m is not None
            w, h = int(m.group(1)), int(m.group(2))
            self.assertEqual(w, h, icon)
            self.assertGreaterEqual(w, 128, icon)

    def test_no_download_and_run_commands(self) -> None:
        # Fetching a file and then executing or installing it in one step is flagged by the
        # directory; skills must describe a verified, user-approved download instead.
        pattern = re.compile(
            r"(curl|wget)[^\n`]*(\|\s*(ba|z)?sh\b|&&[^\n`]*(chmod \+x|ln -s|/usr/local/bin|\./))"
        )
        hits = []
        for f in sorted(CORE.rglob("*")):
            if f.is_file() and f.suffix in {".md", ".py", ".js", ".html", ".sh"}:
                for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                    if pattern.search(line):
                        hits.append(f"{f.relative_to(CORE)}:{n}")
        self.assertEqual(hits, [])

    def test_skills_read_no_environment_variables(self) -> None:
        # A skill that reads the installer's environment ($PATH, ${TOKEN}, printenv) is held
        # for credential review by the directory. $ARGUMENTS is the skill argument placeholder.
        pattern = re.compile(
            r"\$\{?(?!ARGUMENTS\b)[A-Z][A-Z0-9_]{2,}\}?(?![\w.])|\bprintenv\b|\bexport -p\b"
        )
        hits = []
        for f in sorted(CORE.rglob("*.md")):
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if pattern.search(line):
                    hits.append(f"{f.relative_to(CORE)}:{n}: {line.strip()[:80]}")
        self.assertEqual(hits, [])


class ConnectorConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.servers = load_json(CONNECTORS / ".mcp.json")["mcpServers"]

    def test_expected_servers(self) -> None:
        self.assertEqual(sorted(self.servers), ["blender", "context7", "godot"])

    def test_no_literal_credentials(self) -> None:
        for name, cfg in self.servers.items():
            for key, value in cfg.get("env", {}).items():
                self.assertRegex(
                    value,
                    r"^\$\{[A-Z0-9_]+(:-[^}]*)?\}$",
                    f"{name}.{key} must come from the environment",
                )
            self.assertNotIn(
                "headers", cfg, f"{name}: auth headers belong to the user, not the plugin"
            )

    def test_remote_servers_use_https(self) -> None:
        for name, cfg in self.servers.items():
            if cfg.get("type") in {"http", "sse"}:
                self.assertTrue(cfg["url"].startswith("https://"), name)
            else:
                self.assertIn(cfg["command"], {"uvx", "npx"}, name)


class SkillTests(unittest.TestCase):
    def skill_names(self) -> set[str]:
        return {p.parent.name for p in (CORE / "skills").glob("*/SKILL.md")}

    def test_bundled_skill_set(self) -> None:
        expected = {
            "game-director",
            "new-game",
            "release-check",
            "godot-forge",
            "game-creator-2d",
            "browser-arcade-game-forge",
            "dos-game-forge",
            "threejs-retro-forge",
            "hd2d-forge",
            "aseprite-pixel-forge",
            "blender-game-asset-forge",
            "blender-2d-forge",
            "game-music-forge",
            "game-loc-ops",
            "game-liveops-linguist",
        }
        self.assertEqual(self.skill_names(), expected)

    def test_director_routes_only_to_bundled_skills(self) -> None:
        text = (CORE / "skills" / "game-director" / "SKILL.md").read_text(encoding="utf-8")
        routed = set(re.findall(r"`([a-z0-9]+(?:-[a-z0-9]+)*-(?:forge|2d|ops|linguist))`", text))
        self.assertTrue(routed)
        self.assertEqual(routed - self.skill_names(), set())

    def test_command_skills_are_user_invoked(self) -> None:
        for name in ("new-game", "release-check"):
            fm = sanitize_scan._frontmatter(
                (CORE / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
            )
            assert fm is not None
            self.assertEqual(fm.get("disable-model-invocation"), "true", name)

    def test_agent_is_read_only(self) -> None:
        fm = sanitize_scan._frontmatter(
            (CORE / "agents" / "playtest-auditor.md").read_text(encoding="utf-8")
        )
        assert fm is not None
        tools = {t.strip() for t in fm["tools"].split(",")}
        self.assertEqual(tools & {"Edit", "Write", "NotebookEdit"}, set())

    def test_referenced_support_files_exist(self) -> None:
        skills = CORE / "skills"
        names = self.skill_names()
        path_rx = re.compile(r"\b(?:references|scripts|assets)/[A-Za-z0-9_.-]+\.[a-z]+")
        missing = []
        for md in sorted(skills.rglob("*.md")):
            skill = md.relative_to(skills).parts[0]
            for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
                # A line may point into another bundled skill, e.g. `godot-forge/references/x.md`.
                owners = [skill] + [n for n in names if n in line]
                for rel in path_rx.findall(line):
                    if not any((skills / owner / rel).exists() for owner in owners):
                        missing.append(f"{md.relative_to(skills)}:{lineno}: {rel}")
        self.assertEqual(missing, [])

    def test_bundled_python_compiles(self) -> None:
        scripts = sorted((CORE / "skills").rglob("*.py"))
        self.assertTrue(scripts)
        with tempfile.TemporaryDirectory() as tmp:
            for i, script in enumerate(scripts):
                py_compile.compile(str(script), cfile=str(Path(tmp) / f"{i}.pyc"), doraise=True)

    def test_rulecheck_runs_on_its_sample(self) -> None:
        skill = CORE / "skills" / "game-liveops-linguist"
        proc = subprocess.run(
            [
                sys.executable,
                str(skill / "scripts" / "rulecheck.py"),
                str(skill / "assets" / "bilingual-sample.csv"),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        # The sample carries a deliberate 30% -> 20% mismatch that the checker must catch.
        self.assertIn("SKL_001", proc.stdout + proc.stderr)

    def test_pseudoloc_runs_on_lockit_template(self) -> None:
        skill = CORE / "skills" / "game-loc-ops"
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "pseudo.csv"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(skill / "scripts" / "pseudoloc.py"),
                    str(skill / "assets" / "lockit-template.csv"),
                    "--out",
                    str(out),
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(out.exists() and out.stat().st_size > 0)


class SanitizeScanTests(unittest.TestCase):
    def test_plugins_are_clean(self) -> None:
        deny_env = os.environ.get("GAMEDEV_FORGE_DENYLIST")
        deny = sanitize_scan.load_denylist(Path(deny_env)) if deny_env else []
        docs = sorted(PROJECT.glob("*.md")) + [REPO / "README.md"]
        findings = sanitize_scan.scan([PLUGINS, MARKETPLACE, *docs], deny)
        self.assertEqual([str(f) for f in findings], [])

    def planted(self, text: str, deny: list[str] | None = None) -> set[str]:
        return {f.code for f in sanitize_scan.scan_text(Path("x.md"), text, deny or [])}

    def test_detects_secrets(self) -> None:
        self.assertIn("secret", self.planted("key = sk-ant-" + "a1" * 20))
        self.assertIn("secret", self.planted("-----BEGIN RSA PRIVATE KEY-----"))
        self.assertIn("secret", self.planted('api_key = "' + "Zq8" * 6 + '"'))

    def test_allows_placeholders(self) -> None:
        self.assertEqual(self.planted('"env": {"API_KEY": "${API_KEY}"}'), set())
        self.assertEqual(self.planted("mail someone@example.com"), set())
        self.assertEqual(self.planted("rule: no `mcp__server__tool` names"), set())

    def test_detects_personal_data_and_host_ids(self) -> None:
        self.assertIn("personal", self.planted("contact jane@studio.io"))
        self.assertIn("personal", self.planted("cd /home/jane/game"))
        self.assertIn("personal", self.planted(r"C:\Users\jane\game"))
        self.assertIn("host", self.planted("see session_01ABCDEFGHIJKLMN"))
        self.assertIn("host", self.planted("call mcp__Figma__get_screenshot"))

    def test_denylist_terms_are_matched_but_not_echoed(self) -> None:
        findings = sanitize_scan.scan_text(Path("x.md"), "Built for Acme Quest.", ["acme quest"])
        self.assertEqual([f.code for f in findings], ["private"])
        self.assertNotIn("acme", str(findings[0]).lower())
        self.assertEqual(sanitize_scan.scan_text(Path("x.md"), "Acmeology", ["acme"]), [])

    def test_skill_checks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "p"
            (root / ".claude-plugin").mkdir(parents=True)
            (root / ".claude-plugin" / "plugin.json").write_text('{"name": "p"}', encoding="utf-8")
            good = root / "skills" / "good-skill"
            good.mkdir(parents=True)
            (good / "SKILL.md").write_text(
                "---\nname: good-skill\ndescription: fine\n---\n"
                "Hand off to `missing-forge` for music.\n",
                encoding="utf-8",
            )
            bad = root / "skills" / "bad-skill"
            bad.mkdir()
            (bad / "SKILL.md").write_text(
                "---\nname: other\ndescription: " + "x" * 1600 + "\n---\n", encoding="utf-8"
            )
            messages = [f.message for f in sanitize_scan.check_skills(root)]
        self.assertIn("names skill `missing-forge` that is not bundled", messages)
        self.assertIn("name does not match its folder", messages)
        self.assertTrue(any(m.startswith("listing text") for m in messages))

    def test_cli_exit_codes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clean = Path(tmp) / "clean.md"
            clean.write_text("nothing to see\n", encoding="utf-8")
            dirty = Path(tmp) / "dirty.md"
            dirty.write_text("mail jane@studio.io\n", encoding="utf-8")
            empty = Path(tmp) / "deny.txt"
            empty.write_text("# no terms\n", encoding="utf-8")
            self.assertEqual(sanitize_scan.main([str(clean), "--denylist", str(empty)]), 0)
            self.assertEqual(sanitize_scan.main([str(dirty), "--denylist", str(empty)]), 1)
            self.assertEqual(sanitize_scan.main([str(Path(tmp) / "nope.md")]), 2)


@unittest.skipUnless(shutil.which("claude"), "Claude Code CLI not installed")
class ClaudeValidateTests(unittest.TestCase):
    def test_strict_validation(self) -> None:
        for target in (REPO, CORE, CONNECTORS, CORE / "skills", CORE / "agents"):
            proc = subprocess.run(
                ["claude", "plugin", "validate", "--strict", str(target)],
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(proc.returncode, 0, f"{target}:\n{proc.stdout}{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
