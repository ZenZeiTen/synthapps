#!/usr/bin/env python3
"""Write the translation templates (.pot) for the Corbelwise theme and the Corbelwise Toolkit plugin.

Collects the strings WordPress translates:
  * gettext calls in PHP and JavaScript: __, _e, _n, esc_html__, esc_html_e, esc_attr__, esc_attr_e,
    with "translators:" comments;
  * pattern headers (Title, Description) with the contexts WordPress uses for them;
  * theme.json and style variations: colour, font, size and shadow names, template and template part
    titles, and variation titles;
  * block.json: title, description and keywords;
  * the theme and plugin headers.

`wp i18n make-pot` from WP-CLI produces equivalent files where WP-CLI is available.

    python3 scripts/make-pot.py
"""
import json
import re
import sys
from pathlib import Path

CORBELWISE = Path(__file__).resolve().parent.parent
PROJECTS = [
    (CORBELWISE / "theme" / "corbelwise", "corbelwise", "Corbelwise"),
    (CORBELWISE / "plugin" / "corbelwise-toolkit", "corbelwise-toolkit", "Corbelwise Toolkit"),
]

LITERAL = r"'(?:[^'\\]|\\.)*'"
NOTE = r"(?:/\*\s*translators:(?P<note>.*?)\*/\s*)?"


def calls(domain):
    single = re.compile(
        NOTE + r"\b(?:__|_e|esc_html__|esc_html_e|esc_attr__|esc_attr_e)\(\s*(?P<msg>" + LITERAL + r")\s*,\s*'" + re.escape(domain) + "'",
        re.S,
    )
    plural = re.compile(
        NOTE + r"\b_n\(\s*(?P<msg>" + LITERAL + r")\s*,\s*(?P<plural>" + LITERAL + r")\s*,[^,]+,\s*'" + re.escape(domain) + "'",
        re.S,
    )
    return single, plural


def unquote(literal):
    return literal[1:-1].replace("\\'", "'").replace("\\\\", "\\")


def po_quote(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


class Pot:
    def __init__(self):
        self.entries = {}

    def add(self, msg, ref, context=None, plural=None, note=None):
        if not msg:
            return
        entry = self.entries.setdefault((context, msg), {"refs": [], "notes": set(), "plural": plural})
        if ref not in entry["refs"]:
            entry["refs"].append(ref)
        if note:
            entry["notes"].add(note)
        if plural:
            entry["plural"] = plural

    def write(self, target, name, domain):
        out = [
            f"# Copyright (C) 2026 ZenZeiTen",
            "# This file is distributed under the GPL-2.0-or-later.",
            'msgid ""',
            'msgstr ""',
            f'"Project-Id-Version: {name} 1.0.0\\n"',
            '"MIME-Version: 1.0\\n"',
            '"Content-Type: text/plain; charset=UTF-8\\n"',
            '"Content-Transfer-Encoding: 8bit\\n"',
            '"Plural-Forms: nplurals=INTEGER; plural=EXPRESSION;\\n"',
            f'"X-Domain: {domain}\\n"',
            "",
        ]
        for (context, msg), entry in self.entries.items():
            for note in sorted(entry["notes"]):
                out.append("#. " + note)
            out.append("#: " + " ".join(entry["refs"]))
            if "%" in msg:
                out.append("#, php-format")
            if context:
                out.append("msgctxt " + po_quote(context))
            out.append("msgid " + po_quote(msg))
            if entry["plural"]:
                out.append("msgid_plural " + po_quote(entry["plural"]))
                out.append('msgstr[0] ""')
                out.append('msgstr[1] ""')
            else:
                out.append('msgstr ""')
            out.append("")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(out), encoding="utf-8")


def theme_json_strings(pot, data, ref):
    settings = data.get("settings", {})
    for color in settings.get("color", {}).get("palette", []):
        pot.add(color.get("name"), ref, "Color name")
    typography = settings.get("typography", {})
    for family in typography.get("fontFamilies", []):
        pot.add(family.get("name"), ref, "Font family name")
    for size in typography.get("fontSizes", []):
        pot.add(size.get("name"), ref, "Font size name")
    for shadow in settings.get("shadow", {}).get("presets", []):
        pot.add(shadow.get("name"), ref, "Shadow name")
    for template in data.get("customTemplates", []):
        pot.add(template.get("title"), ref, "Custom template name")
    for part in data.get("templateParts", []):
        pot.add(part.get("title"), ref, "Template part name")
    if data.get("title"):
        pot.add(data["title"], ref, "Style variation name")


def collect(root, domain):
    pot = Pot()
    single, plural = calls(domain)
    for path in sorted(root.rglob("*")):
        rel = str(path.relative_to(root))
        if path.suffix in (".php", ".js"):
            text = path.read_text(encoding="utf-8")
            for regex, has_plural in ((single, False), (plural, True)):
                for m in regex.finditer(text):
                    line = text.count("\n", 0, m.start("msg")) + 1
                    note = "translators:" + m.group("note").strip() if m.group("note") else None
                    pot.add(unquote(m.group("msg")), f"{rel}:{line}", plural=unquote(m.group("plural")) if has_plural else None, note=note)
            if path.parent.name == "patterns" and path.suffix == ".php":
                for key, context in (("Title", "Pattern title"), ("Description", "Pattern description")):
                    m = re.search(r"^ \* " + key + r": (.+)$", text, re.M)
                    if m:
                        pot.add(m.group(1).strip(), rel, context)
        elif path.name == "theme.json" or (path.parent.name == "styles" and path.suffix == ".json"):
            theme_json_strings(pot, json.loads(path.read_text(encoding="utf-8")), rel)
        elif path.name == "block.json":
            data = json.loads(path.read_text(encoding="utf-8"))
            pot.add(data.get("title"), rel, "block title")
            pot.add(data.get("description"), rel, "block description")
            for keyword in data.get("keywords", []):
                pot.add(keyword, rel, "block keyword")
    return pot


def main():
    for root, domain, name in PROJECTS:
        pot = collect(root, domain)
        style = root / "style.css"
        header_file = style if style.exists() else root / (domain + ".php")
        header = header_file.read_text(encoding="utf-8")
        kind = "theme" if style.exists() else "plugin"
        for field in ("Theme Name" if kind == "theme" else "Plugin Name", "Description"):
            m = re.search(r"^\s*\*?\s*" + field + r":\s*(.+)$", header, re.M)
            if m:
                pot.add(m.group(1).strip(), header_file.name, note=f"{field} of the {kind}")
        target = root / "languages" / (domain + ".pot")
        pot.write(target, name, domain)
        print(f"{len(pot.entries)} strings -> {target.relative_to(CORBELWISE)}", file=sys.stderr)


if __name__ == "__main__":
    main()
