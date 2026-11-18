#!/usr/bin/env python3
"""Write plugin/contextchat/languages/contextchat.pot from the plugin's translatable strings,
then bring every contextchat-<locale>.po in line with it.

Covers the gettext calls the plugin uses (__, _e, esc_html__, esc_html_e, esc_attr__,
esc_attr_e) with single-quoted literals, plus "translators:" comments. WP-CLI's
`wp i18n make-pot` gives the same result where it is available.

Each .po keeps its header and its translations. Its entries are rewritten in the template's
order with current file references; strings no longer in the plugin are dropped, and new ones
are added with an empty translation and listed, so they are easy to find and translate.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "plugin" / "contextchat"
CALL = re.compile(
    r"(?:/\*\s*translators:(?P<note>.*?)\*/\s*)?"
    r"\b(?:__|_e|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\(\s*'(?P<msg>(?:[^'\\]|\\.)*)'\s*,\s*'contextchat'",
    re.S,
)


def unescape(s):
    return s.replace("\\'", "'").replace("\\\\", "\\")


def po_quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def po_unquote(s):
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), s.strip()[1:-1])


def entry_lines(msg, entry, msgstr=""):
    lines = ["#. " + note for note in sorted(entry["notes"])]
    lines.append("#: " + " ".join(entry["refs"]))
    if "%" in msg:
        lines.append("#, php-format")
    return lines + ["msgid " + po_quote(msg), "msgstr " + po_quote(msgstr), ""]


def merge_po(path, entries, version):
    """Rewrite one .po from the template's entries, keeping its header and translations."""
    blocks = path.read_text(encoding="utf-8").split("\n\n")
    header = re.sub(r'("Project-Id-Version: ContextChat )[^\\"]*', lambda m: m.group(1) + version, blocks[0])
    known = {}
    for block in blocks[1:]:
        field, cur = None, {}
        for line in block.splitlines():
            if line.startswith("msgid "):
                field, cur["msgid"] = "msgid", po_unquote(line[6:])
            elif line.startswith("msgstr "):
                field, cur["msgstr"] = "msgstr", po_unquote(line[7:])
            elif line.startswith('"') and field:
                cur[field] += po_unquote(line)
        if cur.get("msgid"):
            known[cur["msgid"]] = cur.get("msgstr", "")

    out = [header.rstrip("\n"), ""]
    for msg, entry in entries.items():
        out += entry_lines(msg, entry, known.get(msg, ""))
    path.write_text("\n".join(out), encoding="utf-8")

    new = [m for m in entries if not known.get(m)]
    gone = [m for m in known if m not in entries]
    print(f"{path.name}: {len(entries) - len(new)} translated, {len(new)} to translate, {len(gone)} dropped", file=sys.stderr)
    for m in new:
        print(f"  to translate: {m}", file=sys.stderr)


def main():
    version = re.search(r"^ \* Version:\s*(\S+)", (ROOT / "contextchat.php").read_text(encoding="utf-8"), re.M).group(1)
    entries = {}
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in (".php", ".js"):
            continue
        text = path.read_text(encoding="utf-8")
        for m in CALL.finditer(text):
            msg = unescape(m.group("msg"))
            line = text.count("\n", 0, m.start("msg")) + 1
            entry = entries.setdefault(msg, {"refs": [], "notes": set()})
            entry["refs"].append(f"{path.relative_to(ROOT)}:{line}")
            if m.group("note"):
                entry["notes"].add("translators: " + m.group("note").strip())

    out = [
        "# Copyright (C) 2026 NSXSFT",
        "# This file is distributed under the GPL-2.0-or-later.",
        'msgid ""',
        'msgstr ""',
        f'"Project-Id-Version: ContextChat {version}\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"X-Domain: contextchat\\n"',
        "",
    ]
    for msg, entry in entries.items():
        out += entry_lines(msg, entry)

    target = ROOT / "languages" / "contextchat.pot"
    target.write_text("\n".join(out), encoding="utf-8")
    print(f"{len(entries)} strings -> {target}", file=sys.stderr)

    for po in sorted(target.parent.glob("contextchat-*.po")):
        merge_po(po, entries, version)


if __name__ == "__main__":
    main()
