#!/usr/bin/env python3
"""Write zenzeiten-bastion/languages/zenzeiten-bastion.pot from the plugin's translatable strings.

Covers the gettext calls the plugin uses (__, _e, esc_html__, esc_html_e, esc_attr__,
esc_attr_e) with single-quoted literals, plus "translators:" comments. WP-CLI's
`wp i18n make-pot` gives the same result where it is available.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "zenzeiten-bastion"
CALL = re.compile(
    r"(?:/\*\s*translators:(?P<note>.*?)\*/\s*)?"
    r"\b(?:__|_e|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\(\s*'(?P<msg>(?:[^'\\]|\\.)*)'\s*,\s*'zenzeiten-bastion'",
    re.S,
)


def unescape(s):
    return s.replace("\\'", "'").replace("\\\\", "\\")


def po_quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def main():
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
                entry["notes"].add("translators:" + m.group("note").strip())

    out = [
        "# Copyright (C) 2026 ZenZeiTen",
        "# This file is distributed under the MIT license.",
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: ZenZeiTen Bastion 1.0.0\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"X-Domain: zenzeiten-bastion\\n"',
        "",
    ]
    for msg, entry in entries.items():
        for note in sorted(entry["notes"]):
            out.append("#. " + note)
        out.append("#: " + " ".join(entry["refs"]))
        if "%" in msg:
            out.append("#, php-format")
        out.append("msgid " + po_quote(msg))
        out.append('msgstr ""')
        out.append("")

    target = ROOT / "languages" / "zenzeiten-bastion.pot"
    target.write_text("\n".join(out), encoding="utf-8")
    print(f"{len(entries)} strings -> {target}", file=sys.stderr)


if __name__ == "__main__":
    main()
