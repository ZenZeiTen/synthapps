#!/usr/bin/env python3
"""
pseudoloc.py — offline pseudo-localization generator for game string sets.

Produces a fake locale that is still readable in English while exposing the
structural defects real translation would hit — before any translator is paid:

  bracket wrapping   → truncation (missing closing bracket) and concatenation
                       (two bracket pairs inside one visual string)
  accent substitution → font coverage gaps and encoding failures
  length padding      → layout breakage under expansion
  untransformed text  → HARDCODED STRINGS that were never externalized

Placeholders ({Name}, {0}, %s, %1$s, $var), markup tags (<b>, <color=#f00>,
[icon:gold]), and plural/gender syntax (Unreal |plural(one=...), ICU
{count, plural, ...}) are preserved verbatim so the pseudo build still runs.

Known limitation: in nested-brace ICU MessageFormat, the argument name, keyword,
and category keys are protected, but the inner message bodies are treated as
protected too and therefore stay unaccented. Bracket and expansion checks still
apply at the outer level; for font-coverage testing of ICU-heavy strings, verify
against a real locale rather than relying on the pseudo pass alone.

Runs entirely offline with the Python standard library.

Usage:
    python pseudoloc.py strings.csv --out strings_pseudo.csv
    python pseudoloc.py strings.csv --mode accent,expand --expand 0.40
    python pseudoloc.py strings.json --mode hash --out hardcode_probe.json
    python pseudoloc.py strings.po --mode full --rtl --out rtl_probe.po

Modes (comma-separated, or 'full' for bracket+accent+expand):
    bracket  wrap each string in ⟦ ⟧
    accent   substitute accented look-alikes for ASCII letters
    expand   pad to simulate text expansion
    rtl      wrap in RLE/PDF controls to probe bidi handling
    hash     replace every letter with # (finds hardcoded strings fastest)
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

# --------------------------------------------------------------------------------------

ACCENT_MAP = str.maketrans({
    "a": "à", "b": "ƀ", "c": "ç", "d": "ð", "e": "é", "f": "ƒ", "g": "ğ", "h": "ĥ",
    "i": "î", "j": "ĵ", "k": "ķ", "l": "ł", "m": "ɱ", "n": "ñ", "o": "ö", "p": "þ",
    "q": "ɋ", "r": "ř", "s": "š", "t": "ţ", "u": "ü", "v": "ṽ", "w": "ŵ", "x": "ẋ",
    "y": "ý", "z": "ž",
    "A": "Å", "B": "Ɓ", "C": "Ç", "D": "Ð", "E": "É", "F": "Ƒ", "G": "Ğ", "H": "Ĥ",
    "I": "Î", "J": "Ĵ", "K": "Ķ", "L": "Ł", "M": "Ṁ", "N": "Ñ", "O": "Ö", "P": "Þ",
    "Q": "Ɋ", "R": "Ř", "S": "Š", "T": "Ţ", "U": "Ü", "V": "Ṽ", "W": "Ŵ", "X": "Ẋ",
    "Y": "Ý", "Z": "Ž",
})

OPEN, CLOSE = "\u27e6", "\u27e7"          # ⟦ ⟧ — visually unmistakable, single-width
PAD_CHARS = "\u00b7\u00b7\u00b7"          # ··· filler
RLE, PDF = "\u202b", "\u202c"             # right-to-left embedding / pop directional

# Segments that must survive untouched. Order matters: the plural/gender syntax
# patterns come first so their keywords are not swallowed by the brace pattern.
PROTECTED_RE = re.compile(
    r"(\|\s*(?:plural|gender|hpp)\s*\("                        # Unreal |plural( |gender(
    r"|\{\s*[A-Za-z_]\w*\s*(?=,\s*(?:plural|selectordinal|select)\b)"  # ICU {count, plural,
    r"|\b(?:zero|one|two|few|many|other)\b(?=\s*[={])"         # CLDR category keys
    r"|\b(?:plural|selectordinal|select)\b(?=\s*,)"            # ICU MessageFormat keywords
    r"|<[^<>]+>"                                               # markup tags
    r"|\[[A-Za-z][^\[\]]*\]"                                   # [icon:gold]
    r"|\{[^{}]*\}"                                             # {PlayerName}, {0}
    r"|%\d+\$[sdifgxXo@]"                                      # %1$s
    r"|%[sdifgxXo@]"                                           # %s
    r"|\$[A-Za-z_][A-Za-z0-9_]*"                               # $var
    r"|\\n|\\t"                                                # escaped whitespace
    r")"
)

# --------------------------------------------------------------------------------------


def split_protected(text: str):
    """Yield (segment, is_protected) pairs.

    re.split with a single capturing group returns alternating pieces: even
    indices are the text between matches, odd indices are the matches. Index
    parity is used rather than re-matching, because some protected patterns rely
    on lookahead and would not re-match in isolation.
    """
    for index, part in enumerate(PROTECTED_RE.split(text)):
        if part:
            yield part, bool(index % 2)


def transform(text: str, modes: set[str], expand: float) -> str:
    if not text:
        return text

    pieces = []
    translatable_len = 0
    for segment, protected in split_protected(text):
        if protected:
            pieces.append(segment)
            continue
        translatable_len += len(segment)
        if "hash" in modes:
            pieces.append(re.sub(r"[A-Za-z]", "#", segment))
        elif "accent" in modes:
            pieces.append(segment.translate(ACCENT_MAP))
        else:
            pieces.append(segment)
    out = "".join(pieces)

    if "expand" in modes and translatable_len:
        pad_len = max(3, int(round(translatable_len * expand)))
        pad = (PAD_CHARS * (pad_len // len(PAD_CHARS) + 1))[:pad_len]
        out = f"{out} {pad}"

    if "bracket" in modes:
        out = f"{OPEN}{out}{CLOSE}"
    if "rtl" in modes:
        out = f"{RLE}{out}{PDF}"
    return out


def parse_modes(raw: str) -> set[str]:
    if raw.strip().lower() == "full":
        return {"bracket", "accent", "expand"}
    modes = {m.strip().lower() for m in raw.split(",") if m.strip()}
    valid = {"bracket", "accent", "expand", "rtl", "hash"}
    unknown = modes - valid
    if unknown:
        raise SystemExit(f"error: unknown mode(s): {', '.join(sorted(unknown))}. "
                         f"Valid: {', '.join(sorted(valid))}, or 'full'.")
    if "hash" in modes and "accent" in modes:
        raise SystemExit("error: 'hash' and 'accent' are mutually exclusive.")
    return modes


# --------------------------------------------------------------------------------------
# Format handlers
# --------------------------------------------------------------------------------------

SOURCE_ALIASES = ("source", "source_text", "en", "english", "src", "msgid", "original")
TARGET_ALIASES = ("target", "target_text", "translation", "translated", "msgstr", "trg")


def process_csv(inp: Path, out: Path, modes, expand, source_col, target_col) -> int:
    delimiter = "\t" if inp.suffix.lower() in {".tsv", ".tab"} else ","
    with inp.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        lowered = {n.lower().strip(): n for n in fieldnames}
        src = source_col or next((lowered[a] for a in SOURCE_ALIASES if a in lowered), None)
        if not src:
            raise SystemExit(f"error: no source column in {inp.name}; columns: {fieldnames}")
        tgt = target_col or next((lowered[a] for a in TARGET_ALIASES if a in lowered), None)
        if not tgt:
            tgt = "target_pseudo"
            fieldnames.append(tgt)
        rows, count = [], 0
        for row in reader:
            row[tgt] = transform(row.get(src, "") or "", modes, expand)
            rows.append(row)
            count += 1
    with out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter=delimiter)
        writer.writeheader()
        writer.writerows(rows)
    return count


def process_json(inp: Path, out: Path, modes, expand) -> int:
    data = json.loads(inp.read_text(encoding="utf-8"))
    count = 0
    if isinstance(data, dict):
        result = {}
        for key, value in data.items():
            if isinstance(value, dict):
                item = dict(value)
                base = item.get("source", item.get("en", ""))
                item["target"] = transform(str(base), modes, expand)
                result[key] = item
            else:
                result[key] = transform(str(value), modes, expand)
            count += 1
        payload = result
    elif isinstance(data, list):
        payload = []
        for item in data:
            new = dict(item)
            new["target"] = transform(str(item.get("source", "")), modes, expand)
            payload.append(new)
            count += 1
    else:
        raise SystemExit("error: JSON root must be an object or an array")
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return count


def process_po(inp: Path, out: Path, modes, expand) -> int:
    lines, count, msgid = [], 0, None
    for raw in inp.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        m = re.match(r'^msgid\s+"(.*)"$', stripped)
        if m:
            msgid = m.group(1)
            lines.append(raw)
            continue
        m = re.match(r'^msgstr\s+"(.*)"$', stripped)
        if m and msgid is not None:
            if msgid:  # skip the PO header entry
                escaped = transform(_unescape(msgid), modes, expand)
                lines.append(f'msgstr "{_escape(escaped)}"')
                count += 1
            else:
                lines.append(raw)
            msgid = None
            continue
        lines.append(raw)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return count


def _unescape(s: str) -> str:
    return s.replace('\\"', '"').replace("\\\\", "\\")


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


# --------------------------------------------------------------------------------------


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="CSV/TSV, JSON, or PO string file")
    ap.add_argument("--out", type=Path, help="Output path (default: <input>_pseudo.<ext>)")
    ap.add_argument("--mode", default="full",
                    help="bracket,accent,expand,rtl,hash — or 'full' (default)")
    ap.add_argument("--expand", type=float, default=0.40,
                    help="Padding ratio for 'expand' mode (default 0.40 = +40%%)")
    ap.add_argument("--source-col", help="Explicit source column name (CSV only)")
    ap.add_argument("--target-col", help="Explicit target column name (CSV only)")
    args = ap.parse_args(argv)

    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        return 2
    if not 0.0 <= args.expand <= 3.0:
        print("error: --expand must be between 0.0 and 3.0", file=sys.stderr)
        return 2

    modes = parse_modes(args.mode)
    out = args.out or args.input.with_name(
        f"{args.input.stem}_pseudo{args.input.suffix}")

    suffix = args.input.suffix.lower()
    if suffix in {".csv", ".tsv", ".tab"}:
        n = process_csv(args.input, out, modes, args.expand,
                        args.source_col, args.target_col)
    elif suffix == ".json":
        n = process_json(args.input, out, modes, args.expand)
    elif suffix in {".po", ".pot"}:
        n = process_po(args.input, out, modes, args.expand)
    else:
        print(f"error: unsupported extension '{suffix}' (use .csv/.tsv/.json/.po)",
              file=sys.stderr)
        return 2

    print(f"pseudoloc — {n} strings transformed [{','.join(sorted(modes))}] → {out}")
    print("Next: load this as a locale and look for (1) plain English text = hardcoded "
          "strings, (2) missing ⟧ = truncation, (3) two bracket pairs in one visual "
          "string = concatenation, (4) boxes = font coverage gaps.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
