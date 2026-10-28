#!/usr/bin/env python3
"""Compile plugin/contextchat/languages/*.po into the files WordPress loads.

For each contextchat-<locale>.po this writes:
  contextchat-<locale>.mo                 strings used by PHP
  contextchat-<locale>-<md5>.json         strings used by a script (one file per script),
                                          the Jed format read by wp_set_script_translations()

Same output as `msgfmt` plus `wp i18n make-json`, without needing either.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

LANG_DIR = Path(__file__).resolve().parent.parent / "plugin" / "contextchat" / "languages"


def unquote(s):
    s = s.strip()[1:-1]
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse_po(path):
    """Return the header and a list of (msgid, msgstr, references)."""
    entries, refs, field, cur = [], [], None, {}

    def flush():
        if "msgid" in cur:
            entries.append((cur["msgid"], cur.get("msgstr", ""), list(refs)))
        cur.clear()
        refs.clear()

    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#:"):
            if "msgid" in cur:
                flush()
            refs.extend(line[2:].split())
        elif line.startswith("msgid "):
            if "msgid" in cur:
                flush()
            field, cur["msgid"] = "msgid", unquote(line[6:])
        elif line.startswith("msgstr "):
            field, cur["msgstr"] = "msgstr", unquote(line[7:])
        elif line.startswith('"') and field:
            cur[field] += unquote(line)
        elif not line.strip():
            field = None
    flush()

    header = next((s for i, s, _ in entries if i == ""), "")
    return header, [e for e in entries if e[0] != ""]


def write_mo(path, header, pairs):
    pairs = sorted([("", header)] + [(i, s) for i, s in pairs if s])
    ids = b"".join(i.encode() + b"\0" for i, _ in pairs)
    strs = b"".join(s.encode() + b"\0" for _, s in pairs)
    n = len(pairs)
    key_start = 7 * 4 + 16 * n
    val_start = key_start + len(ids)
    offsets, ko, vo = [], 0, 0
    for i, s in pairs:
        offsets.append((len(i.encode()), key_start + ko, len(s.encode()), val_start + vo))
        ko += len(i.encode()) + 1
        vo += len(s.encode()) + 1
    out = struct.pack("Iiiiiii", 0x950412DE, 0, n, 7 * 4, 7 * 4 + 8 * n, 0, 0)
    out += b"".join(struct.pack("ii", l, o) for l, o, _, _ in offsets)
    out += b"".join(struct.pack("ii", l, o) for _, _, l, o in offsets)
    path.write_bytes(out + ids + strs)


def header_value(header, key):
    for line in header.splitlines():
        if line.lower().startswith(key.lower() + ":"):
            return line.split(":", 1)[1].strip()
    return ""


def main():
    for po in sorted(LANG_DIR.glob("contextchat-*.po")):
        locale = po.stem[len("contextchat-"):]
        header, entries = parse_po(po)
        missing = [i for i, s, _ in entries if not s]
        if missing:
            print(f"{po.name}: {len(missing)} untranslated", file=sys.stderr)

        write_mo(po.with_suffix(".mo"), header, [(i, s) for i, s, _ in entries])

        scripts = {}
        for msgid, msgstr, refs in entries:
            for ref in refs:
                file = ref.rsplit(":", 1)[0]
                if file.endswith(".js") and msgstr:
                    scripts.setdefault(file, {})[msgid] = [msgstr]
        for file, messages in scripts.items():
            data = {
                "domain": "messages",
                "locale_data": {
                    "messages": {
                        "": {"domain": "messages", "lang": locale, "plural-forms": header_value(header, "Plural-Forms")},
                        **messages,
                    }
                },
            }
            name = f"contextchat-{locale}-{hashlib.md5(file.encode()).hexdigest()}.json"
            (LANG_DIR / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

        print(f"{po.name}: {len(entries) - len(missing)} strings, {len(scripts)} script file(s)", file=sys.stderr)


if __name__ == "__main__":
    main()
