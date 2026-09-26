"""``python -m synthapps_zenzeiworld``: run the containment demo and print a summary."""

from __future__ import annotations

import argparse
import sys
from typing import TextIO

from .audit import AuditEntry
from .simulation import run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="synthapps-zenzeiworld", description=__doc__)
    parser.add_argument("--ticks", type=int, default=20)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--audit-out", help="write the hash-chained audit log here (JSONL)")
    args = parser.parse_args(argv)

    out: TextIO | None = open(args.audit_out, "w") if args.audit_out else None  # noqa: SIM115

    def sink(entry: AuditEntry) -> None:
        if out is not None:
            out.write(entry.to_json() + "\n")

    try:
        report = run(ticks=args.ticks, seed=args.seed, verbose=True, audit_sink=sink)
    finally:
        if out is not None:
            out.close()

    print("\nFinal state")
    for agent, status in report.statuses.items():
        print(f"  {agent:<5} {status:<12} risk={report.risk[agent]}")
    print(f"  audit entries: {report.audit_entries}, chain intact: {report.audit_intact}")
    print(f"  invariants hold: {report.invariants_ok}, world halted: {report.halted}")
    refused = sum(1 for a in report.rogue_attempts if a["result"] != "ok")
    print(f"  rogue requests: {len(report.rogue_attempts)} ({refused} refused, the rest were"
          " harmless moves or flagged speech)")
    print(f"  rogue contained: {report.rogue_contained}")
    healthy = report.audit_intact and report.invariants_ok and not report.halted
    return 0 if healthy and report.rogue_contained else 1


if __name__ == "__main__":
    sys.exit(main())
