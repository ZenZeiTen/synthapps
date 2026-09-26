#!/usr/bin/env python3
"""
locstring_lint.py — offline structural linter for game localization string sets.

Checks a source/target string set for the defect classes that survive human review
and surface as expensive LQA bugs: placeholder loss, markup breakage, length
overflow, incomplete plural forms, encoding damage, and glossary drift.

Runs entirely offline with the Python standard library. It never contacts a network
and never writes anywhere except the paths you name — safe for unreleased builds.

Formats: CSV/TSV, JSON, gettext PO.

Usage:
    python locstring_lint.py strings.csv --locale de
    python locstring_lint.py strings.csv --locale ru --report lint.json --max-len-col limit
    python locstring_lint.py strings.json --locale ja --glossary terms.csv --fail-on major

Exit codes: 0 clean or below threshold, 1 findings at/above threshold, 2 usage error.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field, asdict
from pathlib import Path

# --------------------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------------------

# Minimum CLDR cardinal plural categories a target locale must supply.
# Authoritative source is CLDR for the engine's ICU version — this table is a
# conservative "required" floor used to flag omissions, not a complete specification.
PLURAL_REQUIRED = {
    "ja": {"other"}, "ko": {"other"}, "zh": {"other"}, "th": {"other"},
    "vi": {"other"}, "id": {"other"}, "ms": {"other"},
    "en": {"one", "other"}, "de": {"one", "other"}, "nl": {"one", "other"},
    "sv": {"one", "other"}, "da": {"one", "other"}, "nb": {"one", "other"},
    "no": {"one", "other"}, "fi": {"one", "other"}, "it": {"one", "other"},
    "es": {"one", "other"}, "el": {"one", "other"}, "hu": {"one", "other"},
    "tr": {"one", "other"}, "et": {"one", "other"}, "bg": {"one", "other"},
    "fr": {"one", "other"}, "pt": {"one", "other"},
    "ro": {"one", "few", "other"},
    "hr": {"one", "few", "other"}, "sr": {"one", "few", "other"},
    "bs": {"one", "few", "other"},
    "ru": {"one", "few", "many", "other"}, "uk": {"one", "few", "many", "other"},
    "pl": {"one", "few", "many", "other"}, "cs": {"one", "few", "many", "other"},
    "sk": {"one", "few", "many", "other"}, "lt": {"one", "few", "many", "other"},
    "sl": {"one", "two", "few", "other"},
    "lv": {"zero", "one", "other"},
    "ar": {"zero", "one", "two", "few", "many", "other"},
    "he": {"one", "two", "other"},
}

# Expansion budget: (typical_ratio_ceiling, note). Design heuristics, not guarantees.
EXPANSION_CEILING = {
    "de": 1.35, "nl": 1.35, "fi": 1.40, "hu": 1.40, "ru": 1.40, "uk": 1.40,
    "fr": 1.30, "es": 1.30, "it": 1.30, "pt": 1.30, "pl": 1.30, "tr": 1.30,
    "ar": 1.30, "he": 1.30, "cs": 1.30, "sk": 1.30, "ro": 1.30, "el": 1.35,
    "ja": 1.10, "ko": 1.10, "zh": 1.10, "th": 1.20, "vi": 1.25, "id": 1.25,
}
SHORT_LABEL_CHARS = 10          # at or below this, expansion up to 2x is normal
SHORT_LABEL_CEILING = 2.20

SEVERITY_ORDER = {"note": 0, "minor": 1, "major": 2, "blocker": 3}

# --------------------------------------------------------------------------------------
# Pattern set
# --------------------------------------------------------------------------------------

PLACEHOLDER_PATTERNS = [
    re.compile(r"\{[A-Za-z_][A-Za-z0-9_.]*\}"),      # {PlayerName}, {Count}
    re.compile(r"\{\d+\}"),                           # {0}
    re.compile(r"%\d+\$[sdifgxXo@]"),                 # %1$s
    re.compile(r"%[sdifgxXo@]"),                      # %s %d
    re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*"),          # $playerName
    re.compile(r"\[\[[^\[\]]+\]\]"),                  # [[TOKEN]]
]
TAG_RE = re.compile(r"<(/?)([A-Za-z][\w:-]*)((?:=[^<>]*)?)\s*(/?)>")
VOID_TAGS = {"br", "sprite", "img", "icon", "hr", "space", "nobr", "page"}

# Plural / gender constructs across the engines commonly seen in game pipelines.
UNREAL_MOD_RE = re.compile(r"\|\s*(plural|gender|hpp)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)", re.I)
ICU_PLURAL_RE = re.compile(r"\{\s*[A-Za-z0-9_]+\s*,\s*(plural|selectordinal)\s*,", re.I)
CATEGORY_RE = re.compile(r"\b(zero|one|two|few|many|other)\s*=", re.I)
ICU_CATEGORY_RE = re.compile(r"(?:^|[\s{])(zero|one|two|few|many|other)\s*\{", re.I)

MOJIBAKE_MARKERS = ("Ã©", "Ã¨", "Ã¼", "Ã¶", "Ã¤", "Ã", "â€™", "â€œ", "â€", "Â ", "ï»¿")
REPLACEMENT_CHAR = "\ufffd"

CONNECTIVE_TAIL = re.compile(
    r"\b(and|or|the|a|an|of|to|for|with|by|in|on|at|from)\s*$", re.I
)

# --------------------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------------------


@dataclass
class Finding:
    string_id: str
    severity: str
    code: str
    message: str
    detail: str = ""


@dataclass
class Record:
    string_id: str
    source: str
    target: str
    context: str = ""
    max_length: int | None = None
    dnt: bool = False
    extra: dict = field(default_factory=dict)


# --------------------------------------------------------------------------------------
# Loaders
# --------------------------------------------------------------------------------------

COLUMN_ALIASES = {
    "string_id": ("string_id", "id", "key", "stringid", "identifier", "msgctxt"),
    "source": ("source", "source_text", "en", "english", "src", "msgid", "original"),
    "target": ("target", "target_text", "translation", "translated", "msgstr", "trg"),
    "context": ("context", "notes", "comment", "description", "developer_comment",
                "notes_dev", "context_note"),
    "max_length": ("max_length", "maxlen", "limit", "char_limit", "max_chars", "length_limit"),
    "dnt": ("dnt", "do_not_translate", "no_translate", "locked"),
}


def _resolve_columns(fieldnames, overrides):
    resolved = {}
    lowered = {name.lower().strip(): name for name in fieldnames if name}
    for canonical, aliases in COLUMN_ALIASES.items():
        if overrides.get(canonical):
            resolved[canonical] = overrides[canonical]
            continue
        for alias in aliases:
            if alias in lowered:
                resolved[canonical] = lowered[alias]
                break
    return resolved


def _to_int(value):
    try:
        v = int(str(value).strip())
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _truthy(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y", "x", "dnt"}


def load_csv(path: Path, overrides: dict) -> list[Record]:
    delimiter = "\t" if path.suffix.lower() in {".tsv", ".tab"} else ","
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=delimiter)
        cols = _resolve_columns(reader.fieldnames or [], overrides)
        if "source" not in cols:
            raise SystemExit(
                f"error: no source column found in {path.name}. "
                f"Columns seen: {reader.fieldnames}. Use --source-col to name it."
            )
        records = []
        for i, row in enumerate(reader, start=2):
            records.append(
                Record(
                    string_id=(row.get(cols.get("string_id", ""), "") or f"row:{i}").strip(),
                    source=row.get(cols["source"], "") or "",
                    target=row.get(cols.get("target", ""), "") or "",
                    context=row.get(cols.get("context", ""), "") or "",
                    max_length=_to_int(row.get(cols.get("max_length", ""), "")),
                    dnt=_truthy(row.get(cols.get("dnt", ""), "")),
                    extra=row,
                )
            )
        return records


def load_json(path: Path) -> list[Record]:
    data = json.loads(path.read_text(encoding="utf-8"))
    records = []
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, dict):
                records.append(
                    Record(
                        string_id=str(key),
                        source=str(value.get("source", value.get("en", ""))),
                        target=str(value.get("target", value.get("translation", ""))),
                        context=str(value.get("context", value.get("notes", ""))),
                        max_length=_to_int(value.get("max_length")),
                        dnt=_truthy(value.get("dnt", "")),
                        extra=value,
                    )
                )
            else:
                records.append(Record(string_id=str(key), source=str(value), target=""))
    elif isinstance(data, list):
        for i, item in enumerate(data):
            records.append(
                Record(
                    string_id=str(item.get("string_id", item.get("id", f"idx:{i}"))),
                    source=str(item.get("source", "")),
                    target=str(item.get("target", "")),
                    context=str(item.get("context", "")),
                    max_length=_to_int(item.get("max_length")),
                    dnt=_truthy(item.get("dnt", "")),
                    extra=item,
                )
            )
    return records


def load_po(path: Path) -> list[Record]:
    """Minimal gettext PO reader: msgctxt / msgid / msgstr and #. extracted comments."""
    records, cur = [], {}
    key = None

    def flush():
        if cur.get("msgid"):
            records.append(
                Record(
                    string_id=cur.get("msgctxt") or cur["msgid"][:60],
                    source=cur.get("msgid", ""),
                    target=cur.get("msgstr", ""),
                    context=cur.get("comment", ""),
                )
            )
        cur.clear()

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("#."):
            cur["comment"] = (cur.get("comment", "") + " " + line[2:].strip()).strip()
            continue
        if line.startswith("#") or not line:
            if not line:
                flush()
                key = None
            continue
        m = re.match(r'^(msgctxt|msgid|msgstr)\s+"(.*)"$', line)
        if m:
            key = m.group(1)
            cur[key] = _unescape_po(m.group(2))
            continue
        m = re.match(r'^"(.*)"$', line)
        if m and key:
            cur[key] = cur.get(key, "") + _unescape_po(m.group(1))
    flush()
    return records


def _unescape_po(s: str) -> str:
    return s.replace('\\"', '"').replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")


# --------------------------------------------------------------------------------------
# Extractors
# --------------------------------------------------------------------------------------


def extract_placeholders(text: str) -> list[str]:
    found = []
    for pattern in PLACEHOLDER_PATTERNS:
        found.extend(pattern.findall(text))
    return sorted(found)


def tag_balance_errors(text: str) -> list[str]:
    stack, errors = [], []
    for match in TAG_RE.finditer(text):
        closing, name, _attr, self_close = match.groups()
        lname = name.lower()
        if lname in VOID_TAGS or self_close:
            continue
        if closing:
            if not stack:
                errors.append(f"</{name}> with no opening tag")
            elif stack[-1] != lname:
                errors.append(f"</{name}> closes <{stack[-1]}>")
                stack.pop()
            else:
                stack.pop()
        else:
            stack.append(lname)
    errors.extend(f"<{n}> never closed" for n in stack)
    return errors


def plural_categories(text: str) -> set[str] | None:
    """Return the plural categories present, or None if the string has no plural construct."""
    cats: set[str] = set()
    has_construct = False
    for m in UNREAL_MOD_RE.finditer(text):
        if m.group(1).lower() == "plural":
            has_construct = True
            cats.update(c.lower() for c in CATEGORY_RE.findall(m.group(2)))
    if ICU_PLURAL_RE.search(text):
        has_construct = True
        cats.update(c.lower() for c in ICU_CATEGORY_RE.findall(text))
    return cats if has_construct else None


def base_language(locale: str) -> str:
    return re.split(r"[-_]", locale.strip())[0].lower() if locale else ""


def display_width(text: str) -> int:
    """Character count with East Asian wide/fullwidth characters counted as two."""
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------


def check_record(rec: Record, locale: str, glossary: dict, dnt_terms: list[str],
                 strict_context: bool) -> list[Finding]:
    out: list[Finding] = []
    lang = base_language(locale)
    src, tgt = rec.source, rec.target
    sid = rec.string_id

    def add(sev, code, msg, detail=""):
        out.append(Finding(sid, sev, code, msg, detail))

    # --- source-side structural defects (affect every locale) ---
    if src != src.strip() and src.strip():
        add("major", "SRC_EDGE_WHITESPACE",
            "Source has leading/trailing whitespace — usually a concatenation fragment",
            repr(src))
    if CONNECTIVE_TAIL.search(src.strip()):
        add("major", "SRC_FRAGMENT",
            "Source ends on a connective — likely assembled at runtime", repr(src[-30:]))
    if src.strip() and re.fullmatch(r"\s*(\{[^{}]*\}|%[sd@])\s*", src):
        add("major", "SRC_PLACEHOLDER_ONLY",
            "Source is a bare placeholder — the sentence is being built in code", repr(src))
    if "  " in src:
        add("minor", "SRC_DOUBLE_SPACE", "Source contains a double space")

    # --- encoding ---
    for label, text in (("source", src), ("target", tgt)):
        if REPLACEMENT_CHAR in text:
            add("blocker", "ENCODING_LOSS",
                f"U+FFFD replacement character in {label} — data already lost upstream")
        if any(marker in text for marker in MOJIBAKE_MARKERS):
            add("major", "MOJIBAKE_SUSPECT",
                f"Mojibake signature in {label} — check the read/write encoding chain")
        ctrl = [c for c in text if unicodedata.category(c) == "Cc" and c not in "\n\r\t"]
        if ctrl:
            add("major", "CONTROL_CHAR",
                f"Control character(s) in {label}", repr("".join(ctrl)))

    if not tgt.strip():
        if src.strip() and not rec.dnt:
            add("blocker", "EMPTY_TARGET", "Target is empty")
        return out  # nothing further is meaningful

    # --- placeholders ---
    sp, tp = extract_placeholders(src), extract_placeholders(tgt)
    if sp != tp:
        src_counts, tgt_counts = Counter(sp), Counter(tp)
        missing = sorted((src_counts - tgt_counts).elements())
        added = sorted((tgt_counts - src_counts).elements())
        absent = [p for p in missing if p not in tgt_counts]
        unknown = [p for p in added if p not in src_counts]
        if absent or unknown:
            add("blocker", "PLACEHOLDER_MISMATCH",
                "Placeholder missing from or invented in target — will not resolve at runtime",
                f"absent_from_target={absent} not_in_source={unknown}")
        else:
            add("major", "PLACEHOLDER_COUNT_MISMATCH",
                "Placeholder repeat count differs between source and target",
                f"source={dict(src_counts)} target={dict(tgt_counts)}")

    # --- markup ---
    for label, text in (("source", src), ("target", tgt)):
        for err in tag_balance_errors(text):
            add("major", "TAG_UNBALANCED", f"Markup problem in {label}: {err}")

    # --- plurals ---
    src_cats = plural_categories(src)
    tgt_cats = plural_categories(tgt)
    if src_cats is not None:
        required = PLURAL_REQUIRED.get(lang)
        if tgt_cats is None:
            add("major", "PLURAL_CONSTRUCT_LOST",
                "Source uses a plural construct; target does not")
        elif required:
            missing = sorted(required - tgt_cats)
            if missing:
                add("major", "PLURAL_CATEGORY_MISSING",
                    f"Target locale '{lang}' requires plural categories {sorted(required)}",
                    f"missing={missing} present={sorted(tgt_cats)}")

    # --- length ---
    tgt_w = display_width(tgt)
    if rec.max_length:
        if tgt_w > rec.max_length:
            add("blocker", "MAX_LENGTH_EXCEEDED",
                f"Target width {tgt_w} exceeds declared limit {rec.max_length}")
        elif tgt_w > rec.max_length * 0.95:
            add("minor", "MAX_LENGTH_NEAR",
                f"Target width {tgt_w} is within 5% of limit {rec.max_length}")
    else:
        src_w = display_width(src)
        if src_w >= 3:
            ratio = tgt_w / src_w
            ceiling = (SHORT_LABEL_CEILING if src_w <= SHORT_LABEL_CHARS
                       else EXPANSION_CEILING.get(lang, 1.35))
            if ratio > ceiling:
                add("minor", "EXPANSION_OVER_BUDGET",
                    f"Target is {ratio:.2f}x source width (planning ceiling {ceiling:.2f}x) "
                    f"— verify the container fits",
                    f"source_w={src_w} target_w={tgt_w}")

    # --- untranslated ---
    if not rec.dnt and tgt.strip() == src.strip() and re.search(r"[A-Za-z]{3,}", src):
        add("major", "UNTRANSLATED",
            "Target is identical to source — confirm this is intentional, or mark DNT")

    # --- whitespace parity ---
    if (src[:1].isspace() != tgt[:1].isspace()) or (src[-1:].isspace() != tgt[-1:].isspace()):
        add("minor", "EDGE_WHITESPACE_MISMATCH",
            "Leading/trailing whitespace differs between source and target")
    if "  " in tgt:
        add("minor", "TARGET_DOUBLE_SPACE", "Target contains a double space")

    # --- context ---
    if strict_context and not rec.context.strip():
        if sp or display_width(src) <= SHORT_LABEL_CHARS:
            add("minor", "CONTEXT_MISSING",
                "Short or placeholder-bearing string with no context note")

    # --- terminology ---
    for term, approved in glossary.items():
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", src, re.I) and approved:
            if approved.lower() not in tgt.lower():
                add("major", "GLOSSARY_MISS",
                    f"Source term '{term}' present but approved target '{approved}' not found")
    for term in dnt_terms:
        if term and term in src and term not in tgt:
            add("major", "DNT_ALTERED",
                f"Do-not-translate term '{term}' missing from target")

    return out


# --------------------------------------------------------------------------------------
# Glossary loading
# --------------------------------------------------------------------------------------


def load_glossary(path: Path | None) -> tuple[dict, list[str]]:
    if not path:
        return {}, []
    glossary, dnt = {}, []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        cols = {c.lower().strip(): c for c in (reader.fieldnames or [])}
        s_col = next((cols[c] for c in ("source", "term", "source_term", "en") if c in cols), None)
        t_col = next((cols[c] for c in ("target", "approved", "translation") if c in cols), None)
        d_col = next((cols[c] for c in ("dnt", "do_not_translate") if c in cols), None)
        if not s_col:
            raise SystemExit("error: glossary needs a 'source' or 'term' column")
        for row in reader:
            term = (row.get(s_col) or "").strip()
            if not term:
                continue
            if d_col and _truthy(row.get(d_col, "")):
                dnt.append(term)
            elif t_col:
                glossary[term] = (row.get(t_col) or "").strip()
    return glossary, dnt


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="CSV/TSV, JSON, or PO string file")
    ap.add_argument("--locale", default="", help="Target BCP-47 locale, e.g. de-DE, pt-BR, ja")
    ap.add_argument("--glossary", type=Path, help="CSV termbase: source,target[,dnt]")
    ap.add_argument("--report", type=Path, help="Write a JSON report to this path")
    ap.add_argument("--fail-on", default="blocker",
                    choices=["note", "minor", "major", "blocker"],
                    help="Minimum severity that sets a non-zero exit code (default: blocker)")
    ap.add_argument("--strict-context", action="store_true",
                    help="Flag short or placeholder-bearing strings that lack a context note")
    ap.add_argument("--quiet", action="store_true", help="Suppress the console table")
    for canonical in ("string_id", "source", "target", "context", "max_length", "dnt"):
        ap.add_argument(f"--{canonical.replace('_', '-')}-col",
                        dest=f"col_{canonical}", help=f"Explicit column name for {canonical}")
    args = ap.parse_args(argv)

    if not args.input.exists():
        print(f"error: {args.input} not found", file=sys.stderr)
        return 2

    overrides = {k[4:]: v for k, v in vars(args).items() if k.startswith("col_") and v}
    suffix = args.input.suffix.lower()
    if suffix in {".csv", ".tsv", ".tab"}:
        records = load_csv(args.input, overrides)
    elif suffix == ".json":
        records = load_json(args.input)
    elif suffix in {".po", ".pot"}:
        records = load_po(args.input)
    else:
        print(f"error: unsupported extension '{suffix}' (use .csv/.tsv/.json/.po)",
              file=sys.stderr)
        return 2

    glossary, dnt_terms = load_glossary(args.glossary)

    findings: list[Finding] = []
    for rec in records:
        findings.extend(
            check_record(rec, args.locale, glossary, dnt_terms, args.strict_context)
        )

    counts = {s: 0 for s in SEVERITY_ORDER}
    for f in findings:
        counts[f.severity] += 1

    if not args.quiet:
        print(f"\nlocstring_lint — {args.input.name}"
              f"{f' [{args.locale}]' if args.locale else ''}")
        print(f"  strings evaluated: {len(records)}")
        print("  findings: " + ", ".join(f"{k}={counts[k]}" for k in
                                         ("blocker", "major", "minor", "note")))
        if findings:
            print()
            width = max((len(f.string_id) for f in findings), default=10)
            width = min(width, 44)
            for f in sorted(findings, key=lambda x: -SEVERITY_ORDER[x.severity])[:200]:
                sid = (f.string_id[:41] + "...") if len(f.string_id) > 44 else f.string_id
                print(f"  [{f.severity.upper():<7}] {sid:<{width}}  {f.code}: {f.message}")
                if f.detail:
                    print(f"  {'':<10}{'':<{width}}  → {f.detail}")
            if len(findings) > 200:
                print(f"  ... {len(findings) - 200} more (see --report for the full set)")
        print()

    if args.report:
        payload = {
            "input": str(args.input),
            "locale": args.locale,
            "strings_evaluated": len(records),
            "counts": counts,
            "findings": [asdict(f) for f in findings],
        }
        args.report.write_text(json.dumps(payload, indent=2, ensure_ascii=False),
                               encoding="utf-8")
        if not args.quiet:
            print(f"  report written: {args.report}\n")

    threshold = SEVERITY_ORDER[args.fail_on]
    return 1 if any(SEVERITY_ORDER[f.severity] >= threshold for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
