"""Release gate for the gamedev-forge plugins: find content that must not be published.

Checks every text file under the given paths for:

- secrets: API-key shapes, private-key blocks, bearer tokens written out in full
- personal data: e-mail addresses and absolute home-folder paths
- host internals: account, session, skill and plugin IDs, and hard-coded MCP tool names
- private terms: names of people, clients or internal projects, read from a local
  deny-list that is never committed (so the scanner does not publish what it hides)

It also checks the plugin's skills: each SKILL.md has a name matching its folder, a
description, a listing text within the host's size cap, and no hand-off to a skill that
the plugin does not bundle.

Usage:
    python tools/sanitize_scan.py [PATH ...] [--denylist FILE]

With no PATH it scans this project's plugins and the repository's marketplace manifest.

The deny-list is one term per line (case-insensitive, whole word; lines starting with #
are comments). It defaults to the file named by $GAMEDEV_FORGE_DENYLIST, then to
`.sanitize-denylist` next to this script's parent folder. Keep that file out of git.

Exit code 0 when clean, 1 when anything is found, 2 on usage errors.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

TEXT_SUFFIXES = {
    ".md",
    ".txt",
    ".json",
    ".py",
    ".js",
    ".mjs",
    ".ts",
    ".html",
    ".css",
    ".csv",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".gd",
    ".lua",
    ".cfg",
    ".ini",
}

# Listing text Claude Code shows for a skill (description + when_to_use) is cut at this size.
SKILL_LISTING_CAP = 1536

# Skills a bundled skill may name that live in the host, not in this plugin.
HOST_SKILLS = {"artifact-design"}


@dataclass(frozen=True)
class Rule:
    code: str
    pattern: re.Pattern[str]
    message: str


RULES: tuple[Rule, ...] = (
    Rule("secret", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key block"),
    Rule("secret", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}"), "API key (sk-...)"),
    Rule("secret", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id"),
    Rule("secret", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "GitHub token"),
    Rule("secret", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    Rule("secret", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "Google API key"),
    Rule("secret", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{24,}=*"), "bearer token"),
    Rule(
        "secret",
        re.compile(
            r"(?i)\b(api[_-]?key|secret|password|access[_-]?token)\b\s*[:=]\s*"
            r"[\"'][^\"'$<{\s]{12,}[\"']"
        ),
        "credential assigned in plain text",
    ),
    Rule(
        "personal",
        re.compile(
            r"\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
        ),
        "e-mail address",
    ),
    Rule(
        "personal",
        re.compile(
            r"(?:/home/[a-z_][a-z0-9_-]*/|/Users/[A-Za-z0-9._-]+/|[A-Za-z]:\\Users\\[^\\\s]+)"
        ),
        "absolute home-folder path",
    ),
    Rule(
        "host",
        re.compile(r"\b(?:session|skill|plugin|env|trig|toolu)_01[A-Za-z0-9]{10,}\b"),
        "host-internal ID",
    ),
    Rule("host", re.compile(r"claude\.ai/code/session_"), "link to a private session"),
    Rule(
        "host",
        re.compile(r"\bmcp__(?!server__tool\b)[A-Za-z0-9_-]+__[A-Za-z0-9_-]+"),
        "hard-coded MCP tool name",
    ),
)

# Hand-off phrasings that name another skill in backticks.
HANDOFF_PATTERNS = (
    re.compile(r"`([a-z0-9]+(?:-[a-z0-9]+)+)`\s+skill\b"),
    re.compile(r"\bskills?\s+`([a-z0-9]+(?:-[a-z0-9]+)+)`"),
    re.compile(
        r"(?i:→|->|hand (?:off|it) to|belongs to|route to|load)\s+`([a-z0-9]+(?:-[a-z0-9]+)+)`"
    ),
    re.compile(
        r"^\|[^|\n]*\|\s*`([a-z0-9]+(?:-[a-z0-9]+)+-(?:forge|ops|linguist|director))`", re.M
    ),
)


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    code: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: [{self.code}] {self.message}"


def iter_files(paths: Iterable[Path]) -> Iterator[Path]:
    for root in paths:
        if root.is_file():
            yield root
            continue
        for p in sorted(root.rglob("*")):
            if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES and "__pycache__" not in p.parts:
                yield p


def load_denylist(path: Path | None) -> list[str]:
    if path is None or not path.is_file():
        return []
    terms = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        term = raw.strip()
        if term and not term.startswith("#"):
            terms.append(term)
    return terms


def scan_text(path: Path, text: str, deny: list[str]) -> list[Finding]:
    found: list[Finding] = []
    deny_res = [(t, re.compile(rf"(?<!\w){re.escape(t)}(?!\w)", re.I)) for t in deny]
    for lineno, line in enumerate(text.splitlines(), start=1):
        for rule in RULES:
            if rule.pattern.search(line):
                found.append(Finding(path, lineno, rule.code, rule.message))
        for term, rx in deny_res:
            if rx.search(line):
                # Report the rule, not the term: the report may end up in a public log.
                found.append(
                    Finding(path, lineno, "private", f"deny-list term #{deny.index(term) + 1}")
                )
    return found


def _frontmatter(text: str) -> dict[str, str] | None:
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    fields: dict[str, str] = {}
    key = None
    for line in text[4:end].splitlines():
        m = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if m:
            key = m.group(1)
            fields[key] = m.group(2).strip()
        elif key and line.startswith((" ", "\t")):
            fields[key] += " " + line.strip()
    for k, v in fields.items():
        v = v.removeprefix(">").removeprefix("|").strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        fields[k] = v
    return fields


def check_skills(plugin_root: Path) -> list[Finding]:
    skills_dir = plugin_root / "skills"
    if not skills_dir.is_dir():
        return []
    bundled = {p.parent.name for p in skills_dir.glob("*/SKILL.md")}
    found: list[Finding] = []
    for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        fm = _frontmatter(text)
        if fm is None:
            found.append(Finding(skill_md, 1, "skill", "missing YAML frontmatter"))
            continue
        if fm.get("name") != skill_md.parent.name:
            found.append(Finding(skill_md, 1, "skill", "name does not match its folder"))
        if not fm.get("description"):
            found.append(Finding(skill_md, 1, "skill", "missing description"))
        listing = len(fm.get("description", "")) + len(fm.get("when_to_use", ""))
        if listing > SKILL_LISTING_CAP:
            found.append(
                Finding(skill_md, 1, "skill", f"listing text {listing} > {SKILL_LISTING_CAP} chars")
            )
    for md in sorted(skills_dir.rglob("*.md")):
        for lineno, line in enumerate(md.read_text(encoding="utf-8").splitlines(), start=1):
            for rx in HANDOFF_PATTERNS:
                for name in rx.findall(line):
                    if name not in bundled and name not in HOST_SKILLS:
                        found.append(
                            Finding(
                                md, lineno, "handoff", f"names skill `{name}` that is not bundled"
                            )
                        )
    return found


def scan(paths: Iterable[Path], deny: list[str]) -> list[Finding]:
    paths = list(paths)
    found: list[Finding] = []
    for f in iter_files(paths):
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        found.extend(scan_text(f, text, deny))
    for root in paths:
        for manifest in [root] if root.is_file() else root.rglob("plugin.json"):
            if manifest.name == "plugin.json" and manifest.parent.name == ".claude-plugin":
                found.extend(check_skills(manifest.parent.parent))
    return found


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    defaults = [p for p in (here / "plugins", here.parent / ".claude-plugin") if p.exists()]
    ap.add_argument("paths", nargs="*", type=Path, default=defaults)
    ap.add_argument("--denylist", type=Path, default=None)
    args = ap.parse_args(argv)

    deny_path = args.denylist
    if deny_path is None:
        env = os.environ.get("GAMEDEV_FORGE_DENYLIST")
        deny_path = Path(env) if env else here / ".sanitize-denylist"
    if args.denylist is not None and not args.denylist.is_file():
        print(f"deny-list not found: {args.denylist}", file=sys.stderr)
        return 2
    deny = load_denylist(deny_path)

    missing = [p for p in args.paths if not p.exists()]
    if missing:
        print(f"path not found: {missing[0]}", file=sys.stderr)
        return 2

    findings = scan(args.paths, deny)
    for f in findings:
        print(f)
    note = f"{len(deny)} deny-list terms" if deny else "no deny-list loaded"
    print(f"{len(findings)} finding(s); {note}.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
