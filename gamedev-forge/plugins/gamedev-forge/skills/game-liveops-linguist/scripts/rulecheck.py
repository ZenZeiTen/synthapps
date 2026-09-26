#!/usr/bin/env python3
"""
rulecheck.py — numeric, unit, placeholder and rule-component integrity for bilingual
game strings.

Offline. Standard library only. No network, no model calls.

What it checks
--------------
  NUMERIC      every number in source appears in target, and no number appears in target
               that is absent from source (locale separators tolerated)
  PERCENT      percent-bearing quantities match in count and value
  CURRENCY     currency symbols and ISO codes match in count
  UNIT         time and duration unit tokens match in count (heuristic, source-side)
  PLACEHOLDER  placeholders present, same names, same count (order may change)
  TIMEREF      a time reference in source (server time, UTC, GMT, local time) is not
               silently dropped in target
  LENGTH       target within the max-length budget, when a budget column is supplied
  CONSISTENCY  one source string rendered two ways, or one target used for two sources
  COMPONENT    rule-component completeness of the SOURCE for event/monetization rows
               (heuristic English-source scan — flags a probable source defect)

Input
-----
CSV with a header row. Default column names:

    id, class, source, target, max_len

Override with --col-id / --col-class / --col-source / --col-target / --col-maxlen.
The class column is optional; rows without one are treated as unclassified and skipped
for class-scoped checks.

Usage
-----
    python rulecheck.py bilingual.csv --report findings.csv
    python rulecheck.py bilingual.csv --classes C3,C4 --strict --report findings.csv
    python rulecheck.py bilingual.csv --format json --report findings.json

Exit codes: 0 clean, 1 findings at ERROR severity, 2 usage error.
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict

# --------------------------------------------------------------------------- patterns

NUMBER_RE = re.compile(r"(?<![\w.,])[+-]?\d[\d.,\u00a0\u202f ]*\d|(?<![\w.,])[+-]?\d")
PERCENT_RE = re.compile(r"[+-]?\d[\d.,]*\s*%|%\s*\d")
CURRENCY_SYMBOLS = "$€£¥₩₫₹₽₺฿₴₦₱"
CURRENCY_CODE_RE = re.compile(
    r"\b(USD|EUR|GBP|JPY|KRW|CNY|RMB|IDR|VND|THB|PHP|MYR|SGD|INR|BRL|RUB|TRY|AUD|CAD|TWD|HKD)\b"
)

PLACEHOLDER_PATTERNS = [
    re.compile(r"\{\{[^{}]{0,64}\}\}"),          # {{name}}
    re.compile(r"\{[^{}]{0,64}\}"),              # {0} {name} {count:d}
    re.compile(r"\$\{[^{}]{0,64}\}"),            # ${name}
    re.compile(r"%\d+\$[sdfi@]"),                # %1$s
    re.compile(r"%[sdfiu@]"),                    # %s %d
    re.compile(r"%[A-Za-z_][A-Za-z0-9_]{0,32}%"),  # %NAME%
    re.compile(r"\[[A-Za-z_][A-Za-z0-9_]{0,32}\]"),  # [name]
    re.compile(r"<[^<>]{1,48}>"),                # <b> <color=#fff>
]

TIMEREF_RE = re.compile(
    r"\b(server\s+time|game\s+time|local\s+time|UTC[+-]?\d{0,2}(:\d{2})?|GMT[+-]?\d{0,2}"
    r"|PST|PDT|EST|EDT|CST|CET|CEST|JST|KST|WIB|WITA|WIT|SGT|ICT|IST)\b",
    re.IGNORECASE,
)
# Tokens that count as the time reference surviving into the target. Extend with
# --timeref-target for locales that localize the phrase.
TIMEREF_TARGET_DEFAULT = [
    "utc", "gmt", "server", "waktu server", "server time", "pst", "pdt", "est", "edt",
    "cst", "cet", "cest", "jst", "kst", "wib", "wita", "wit", "sgt", "ict", "ist",
]

UNIT_RE = re.compile(
    r"\b(\d[\d.,]*)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?"
    r"|turns?|rounds?|waves?|stacks?|times?|stages?|levels?|stars?)\b",
    re.IGNORECASE,
)

# --------------------------------------------------------------- rule-component probes
# Heuristic English-source probes. Presence of the trigger without the requirement is a
# probable source defect worth a query. These are deliberately conservative.

COMPONENT_PROBES = [
    {
        "name": "TIMEZONE",
        "trigger": re.compile(
            r"\b(reset|settle[sd]?|settlement|ends?|starts?|begins?|expires?|deadline"
            r"|daily|weekly)\b",
            re.IGNORECASE,
        ),
        "requirement": TIMEREF_RE,
        "message": "time-bound rule with no explicit time reference (server time / UTC / local)",
    },
    {
        "name": "TIEBREAK",
        "trigger": re.compile(r"\b(rank(ing|ed|s)?|leaderboard|top\s*\d+|placement)\b", re.IGNORECASE),
        "requirement": re.compile(
            r"\b(tie|tied|tie-?break(er)?|same\s+(score|points)|whoever\s+reach|earlier|first\s+to)\b",
            re.IGNORECASE,
        ),
        "message": "ranking rule with no tiebreak clause",
    },
    {
        "name": "CAP",
        "trigger": re.compile(
            r"\b(earn|obtain|gain|collect|accumulate)\b(?!.*\b(rank|leaderboard)\b)",
            re.IGNORECASE | re.DOTALL),
        "requirement": re.compile(
            r"\b(up to|at most|maximum|max\.?|limit(ed)?|per day|daily|per account|per player"
            r"|per alliance|no more than|only once|once per)\b",
            re.IGNORECASE,
        ),
        "message": "accrual or purchase rule with no stated cap or limit",
    },
    {
        "name": "EXPIRY",
        "trigger": re.compile(
            r"\b(event\s+(currency|token|point|ticket|coin)|token|ticket|voucher"
            r"|event\s+shop|exchange)\b",
            re.IGNORECASE,
        ),
        "requirement": re.compile(
            r"\b(expire[sd]?|expiry|expiration|valid until|no longer|removed|converted|reclaim)\b",
            re.IGNORECASE,
        ),
        "message": "event currency or ticket with no stated expiry behaviour",
    },
    {
        "name": "SETTLEMENT",
        "trigger": re.compile(r"\b(rank(ing)?|leaderboard|reward tier|final score)\b", re.IGNORECASE),
        "requirement": re.compile(
            r"\b(settle|settlement|distribut|sent (via|to)|deliver|mail(ed|box)?|within \d+"
            r"|after the event)\b",
            re.IGNORECASE,
        ),
        "message": "ranked reward with no stated settlement or delivery method",
    },
    {
        "name": "ODDS_BASE",
        "trigger": re.compile(r"\b(chance|probability|rate|odds)\b", re.IGNORECASE),
        "requirement": re.compile(
            r"\b(base rate|consolidated|including|excluding|guarantee[d]?|pity|per (draw|pull|attempt))\b",
            re.IGNORECASE,
        ),
        "message": "probability stated without a per-draw / base-vs-consolidated qualifier",
    },
    {
        "name": "SCALING_BASE",
        "trigger": re.compile(
            r"\b(increase[sd]?|decrease[sd]?|reduce[sd]?|boost(s|ed)?|raise[sd]?)\b.{0,40}\d+\s*%",
            re.IGNORECASE | re.DOTALL,
        ),
        "requirement": re.compile(
            r"\b(base|current|max(imum)?|total|final|of the target|of damage dealt"
            r"|percentage points?)\b",
            re.IGNORECASE,
        ),
        "message": "percentage modifier with no stated scaling base",
    },
    {
        "name": "AUTORENEW",
        "trigger": re.compile(
            r"\b(subscription|subscribe|monthly (card|pass)|weekly (card|pass)|auto-?renew)\b",
            re.IGNORECASE,
        ),
        "requirement": re.compile(
            r"\b(cancel|renew(s|al|ed)?|unsubscribe|manage.{0,20}(subscription|account)"
            r"|charged (again|automatically))\b",
            re.IGNORECASE,
        ),
        "message": "subscription text with no renewal or cancellation terms",
    },
]

CLASSES_FOR_COMPONENTS = {"C3", "C4"}

SEV_ORDER = {"INFO": 0, "WARN": 1, "ERROR": 2}


# ------------------------------------------------------------------------- normalizing

def nfkc(text):
    return unicodedata.normalize("NFKC", text or "")


def number_variants(token):
    """Return the set of plausible canonical values for a numeric token.

    Handles both 1,234.56 and 1.234,56 without guessing which locale is in play:
    if a token is ambiguous, every plausible reading is returned and a match on any
    one of them counts as a match.
    """
    raw = token.strip()
    sign = ""
    if raw[:1] in "+-":
        sign, raw = raw[0], raw[1:]
    raw = raw.replace("\u00a0", "").replace("\u202f", "").replace(" ", "")
    if not raw:
        return set()

    variants = set()
    has_dot = "." in raw
    has_comma = "," in raw

    def canon(value):
        try:
            f = float(value)
        except ValueError:
            return None
        if f == int(f):
            return f"{sign}{int(f)}"
        return f"{sign}{f:g}"

    if has_dot and has_comma:
        # the rightmost separator is the decimal mark
        if raw.rfind(".") > raw.rfind(","):
            variants.add(canon(raw.replace(",", "")))
        else:
            variants.add(canon(raw.replace(".", "").replace(",", ".")))
    elif has_dot or has_comma:
        sep = "." if has_dot else ","
        head, _, tail = raw.rpartition(sep)
        if raw.count(sep) > 1:
            # repeated separator can only be grouping
            variants.add(canon(raw.replace(sep, "")))
        elif len(tail) == 3 and head:
            # ambiguous: 1.000 is one thousand or one point zero zero zero
            variants.add(canon(raw.replace(sep, "")))
            variants.add(canon(head + "." + tail))
        else:
            variants.add(canon(raw.replace(sep, ".")))
    else:
        variants.add(canon(raw))

    return {v for v in variants if v is not None}


def number_multiset(text):
    """Map every numeric token in text to its variant set, as a list."""
    out = []
    for m in NUMBER_RE.finditer(nfkc(text)):
        v = number_variants(m.group(0))
        if v:
            out.append(v)
    return out


def match_numbers(src_text, tgt_text):
    """Greedy bipartite match of source numbers to target numbers by variant overlap.

    Returns (unmatched_source_tokens, unmatched_target_tokens).
    """
    src = number_multiset(src_text)
    tgt = number_multiset(tgt_text)
    used = [False] * len(tgt)
    missing = []
    for s in src:
        hit = False
        for i, t in enumerate(tgt):
            if not used[i] and s & t:
                used[i] = True
                hit = True
                break
        if not hit:
            missing.append(sorted(s)[0])
    extra = [sorted(t)[0] for i, t in enumerate(tgt) if not used[i]]
    return missing, extra


def placeholders(text):
    """Extract placeholders, longest-pattern-first so {{x}} is not read as {x}."""
    text = nfkc(text)
    found = []
    spans = []
    for pat in PLACEHOLDER_PATTERNS:
        for m in pat.finditer(text):
            s, e = m.span()
            if any(not (e <= a or s >= b) for a, b in spans):
                continue
            spans.append((s, e))
            found.append(m.group(0))
    return Counter(found)


def count_symbols(text, symbols):
    text = nfkc(text)
    return Counter(ch for ch in text if ch in symbols)


def unit_counter(text):
    out = Counter()
    for m in UNIT_RE.finditer(nfkc(text)):
        out[m.group(2).lower().rstrip("s")] += 1
    return out


# ----------------------------------------------------------------------------- checking

class Finding(dict):
    pass


def add(findings, row_id, cls, check, severity, issue, detail=""):
    findings.append(
        Finding(
            id=row_id,
            cls=cls or "",
            check=check,
            severity=severity,
            issue=issue,
            detail=detail,
        )
    )


def check_row(row_id, cls, source, target, max_len, findings, strict, timeref_tokens,
              unit_map):
    if not source.strip():
        add(findings, row_id, cls, "INPUT", "WARN", "empty source")
        return
    if not target.strip():
        add(findings, row_id, cls, "INPUT", "ERROR", "empty target")
        return

    # NUMERIC
    missing, extra = match_numbers(source, target)
    if missing:
        add(findings, row_id, cls, "NUMERIC", "ERROR",
            "number in source missing from target", ", ".join(missing))
    if extra:
        add(findings, row_id, cls, "NUMERIC", "ERROR",
            "number in target absent from source", ", ".join(extra))

    # PERCENT
    sp = len(PERCENT_RE.findall(nfkc(source)))
    tp = len(PERCENT_RE.findall(nfkc(target)))
    if sp != tp:
        add(findings, row_id, cls, "PERCENT", "ERROR",
            "percent quantity count differs", f"source {sp}, target {tp}")

    # CURRENCY
    scur = count_symbols(source, CURRENCY_SYMBOLS) + Counter(
        CURRENCY_CODE_RE.findall(nfkc(source)))
    tcur = count_symbols(target, CURRENCY_SYMBOLS) + Counter(
        CURRENCY_CODE_RE.findall(nfkc(target)))
    if scur != tcur:
        add(findings, row_id, cls, "CURRENCY", "ERROR",
            "currency marker mismatch",
            f"source {dict(scur)}, target {dict(tcur)}")

    # UNIT — only runs when a target unit lexicon is supplied via --unit-map.
    # Without one the check is undecidable cross-lingually and produces pure noise.
    if unit_map:
        low = nfkc(target).lower()
        for unit, count in unit_counter(source).items():
            accepted = unit_map.get(unit)
            if not accepted:
                continue
            if not any(tok in low for tok in accepted):
                add(findings, row_id, cls, "UNIT", "WARN",
                    f"source unit {unit!r} has no accepted target form in the target",
                    "accepted forms: " + ", ".join(sorted(accepted)))

    # PLACEHOLDER
    sph, tph = placeholders(source), placeholders(target)
    if sph != tph:
        lost = sph - tph
        gained = tph - sph
        detail = []
        if lost:
            detail.append("missing: " + ", ".join(sorted(lost.elements())))
        if gained:
            detail.append("added: " + ", ".join(sorted(gained.elements())))
        add(findings, row_id, cls, "PLACEHOLDER", "ERROR",
            "placeholder set differs", "; ".join(detail))

    # TIMEREF
    if TIMEREF_RE.search(nfkc(source)):
        low = nfkc(target).lower()
        if not any(tok in low for tok in timeref_tokens):
            add(findings, row_id, cls, "TIMEREF", "ERROR",
                "time reference in source not detected in target",
                "add the server-time / UTC / local-time frame, or extend --timeref-target")

    # LENGTH
    if max_len:
        try:
            budget = int(str(max_len).strip())
        except ValueError:
            budget = None
        if budget and len(target) > budget:
            add(findings, row_id, cls, "LENGTH", "ERROR",
                "target exceeds length budget",
                f"budget {budget}, actual {len(target)}")

    # COMPONENT (source-side, class-scoped)
    if cls in CLASSES_FOR_COMPONENTS:
        sev = "ERROR" if strict else "WARN"
        for probe in COMPONENT_PROBES:
            if probe["trigger"].search(source) and not probe["requirement"].search(source):
                add(findings, row_id, cls, f"COMPONENT/{probe['name']}", sev,
                    "probable source defect: " + probe["message"],
                    "heuristic — confirm against the LocKit before filing a query")


def check_consistency(rows, findings):
    by_source = defaultdict(set)
    by_target = defaultdict(set)
    ids_by_source = defaultdict(list)
    for r in rows:
        s, t = r["source"].strip(), r["target"].strip()
        if not s or not t:
            continue
        by_source[s].add(t)
        by_target[t].add(s)
        ids_by_source[s].append(r["id"])
    for s, targets in by_source.items():
        if len(targets) > 1:
            add(findings, ", ".join(ids_by_source[s][:6]), "", "CONSISTENCY", "WARN",
                "one source string rendered more than one way",
                f"source: {s[:60]!r}; targets: " + " | ".join(sorted(targets)[:4]))
    for t, sources in by_target.items():
        if len(sources) > 1:
            add(findings, "", "", "CONSISTENCY", "INFO",
                "one target string used for more than one source",
                f"target: {t[:60]!r}; sources: " + " | ".join(sorted(sources)[:4]))


# --------------------------------------------------------------------------------- io

def load_rows(path, cols):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise SystemExit("error: input has no header row")
        for required in ("source", "target"):
            if cols[required] not in reader.fieldnames:
                raise SystemExit(
                    f"error: column {cols[required]!r} not found. "
                    f"Header is: {', '.join(reader.fieldnames)}"
                )
        rows = []
        for i, raw in enumerate(reader, start=2):
            rows.append(
                {
                    "id": (raw.get(cols["id"]) or f"row{i}").strip(),
                    "cls": (raw.get(cols["cls"]) or "").strip().upper(),
                    "source": raw.get(cols["source"]) or "",
                    "target": raw.get(cols["target"]) or "",
                    "max_len": (raw.get(cols["maxlen"]) or "").strip(),
                }
            )
    return rows


def write_report(findings, path, fmt):
    if fmt == "json":
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(findings, fh, ensure_ascii=False, indent=2)
    else:
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(
                fh, fieldnames=["id", "cls", "check", "severity", "issue", "detail"]
            )
            w.writeheader()
            for f in findings:
                w.writerow(f)


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Numeric, unit, placeholder and rule-component integrity checker "
                    "for bilingual game strings.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("input", help="bilingual CSV with a header row")
    p.add_argument("--report", help="write findings to this path")
    p.add_argument("--format", choices=["csv", "json"], default="csv")
    p.add_argument("--classes", help="comma-separated class filter, e.g. C3,C4")
    p.add_argument("--strict", action="store_true",
                   help="raise source-component findings from WARN to ERROR")
    p.add_argument("--min-severity", choices=["INFO", "WARN", "ERROR"], default="INFO")
    p.add_argument("--no-consistency", action="store_true",
                   help="skip cross-row consistency checks")
    p.add_argument("--timeref-target", default="",
                   help="comma-separated extra tokens that count as a surviving time "
                        "reference in the target locale")
    p.add_argument("--unit-map",
                   help="CSV mapping source time/duration units to accepted target forms "
                        "(columns: unit,targets — targets pipe-separated). Without it the "
                        "UNIT check is skipped, because it is not decidable cross-lingually.")
    p.add_argument("--col-id", default="id")
    p.add_argument("--col-class", default="class")
    p.add_argument("--col-source", default="source")
    p.add_argument("--col-target", default="target")
    p.add_argument("--col-maxlen", default="max_len")
    args = p.parse_args(argv)

    cols = {
        "id": args.col_id,
        "cls": args.col_class,
        "source": args.col_source,
        "target": args.col_target,
        "maxlen": args.col_maxlen,
    }
    rows = load_rows(args.input, cols)

    if args.classes:
        wanted = {c.strip().upper() for c in args.classes.split(",") if c.strip()}
        rows = [r for r in rows if r["cls"] in wanted]

    timeref_tokens = list(TIMEREF_TARGET_DEFAULT)
    timeref_tokens += [
        t.strip().lower() for t in args.timeref_target.split(",") if t.strip()
    ]

    unit_map = {}
    if args.unit_map:
        with open(args.unit_map, newline="", encoding="utf-8-sig") as fh:
            for raw in csv.DictReader(fh):
                unit = (raw.get("unit") or "").strip().lower().rstrip("s")
                targets = [t.strip().lower() for t in (raw.get("targets") or "").split("|")
                           if t.strip()]
                if unit and targets:
                    unit_map[unit] = targets

    findings = []
    for r in rows:
        check_row(r["id"], r["cls"], r["source"], r["target"], r["max_len"],
                  findings, args.strict, timeref_tokens, unit_map)
    if not args.no_consistency:
        check_consistency(rows, findings)

    floor = SEV_ORDER[args.min_severity]
    findings = [f for f in findings if SEV_ORDER[f["severity"]] >= floor]
    findings.sort(key=lambda f: (-SEV_ORDER[f["severity"]], f["check"], f["id"]))

    counts = Counter(f["severity"] for f in findings)
    print(f"rows checked: {len(rows)}")
    print(f"findings: {len(findings)}  "
          f"(ERROR {counts['ERROR']}, WARN {counts['WARN']}, INFO {counts['INFO']})")
    for f in findings[:40]:
        detail = f" — {f['detail']}" if f["detail"] else ""
        print(f"  [{f['severity']}] {f['check']:<22} {f['id']:<18} {f['issue']}{detail}")
    if len(findings) > 40:
        print(f"  ... {len(findings) - 40} more (see report)")

    if args.report:
        write_report(findings, args.report, args.format)
        print(f"report written: {args.report}")

    return 1 if counts["ERROR"] else 0


if __name__ == "__main__":
    sys.exit(main())
