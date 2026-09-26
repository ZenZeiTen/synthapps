"""Replay a run from its audit log: verify it, inspect any tick, review an agent.

The kernel is deterministic, so the audit log is enough to rebuild a run. The
first entry (``world_started``) records the map and the kernel settings. After
that, the log holds two kinds of entry:

* **Inputs**: things that came from outside the kernel. Accepted and rejected
  agent requests, protocol violations, operator commands, a halt from the
  host. Replay feeds these into a fresh kernel, in order, at the same ticks.
* **Consequences**: everything the kernel worked out for itself. Decisions,
  signals, warnings, throttling, quarantines, transfers, watchdog halts.
  Replay does **not** feed these in. The fresh kernel must produce them again,
  and replay checks that it did, entry by entry.

So replay does two jobs:

1. **Verification.** A log whose hash chain is intact can still have been
   forged and re-hashed from the tampered entry onwards. A forged consequence
   (a decoy use marked "allowed", a signal quietly deleted) does not survive
   replay, because the fresh kernel decides it differently.
2. **Review.** It rebuilds the world state at every tick, so an operator can
   look at any moment of an incident, follow one agent's history, or open a
   self-contained HTML viewer with a time slider.

Replay needs the same kernel code that wrote the log. Replaying a log from an
older kernel version can diverge because the rules changed, not because
anything was forged.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from importlib import resources
from typing import Any

from .actions import MAX_REQUEST_BYTES
from .audit import AuditLog
from .kernel import AgentGateway, KernelConfig, OperatorConsole, WorldKernel
from .monitor import MonitorConfig
from .policy import PolicyConfig
from .world import World, default_world, world_from_dict, world_to_dict

# Entries that record something outside the kernel's control, and so cannot
# be reproduced by replay. They are left out of the comparison.
EXTERNAL_KINDS = frozenset({
    "world_started",  # carries a fresh random run id every time
    "auth_failure", "operator_login", "operator_login_failed", "operator_denied",
})

# A request that makes the parser reject it with the given code. The original
# bytes are not in the log (only the code), and the kernel only uses the code.
_REJECTION_INPUTS: dict[str, bytes] = {
    "invalid_request": b"{",
    "unknown_action": b'{"action": "__replayed_unknown__"}',
    "invalid_params": b'{"action": "say", "params": {}}',
    "invalid_encoding": b"\xff",
    "too_large": b"x" * (MAX_REQUEST_BYTES + 1),
    # Any request: the replayed kernel must rate-limit it too, or replay diverges.
    "rate_limited": b'{"action": "wait"}',
}


@dataclass
class Divergence:
    index: int  # position among the compared (non-external) entries
    reason: str
    original: dict[str, Any] | None
    replayed: dict[str, Any] | None


@dataclass
class Snapshot:
    """World state at the end of one tick, plus what happened during it."""

    tick: int
    halted: bool
    paused: bool
    agents: list[dict[str, Any]]
    objects: list[dict[str, Any]]
    events: list[dict[str, Any]]


@dataclass
class ReplayResult:
    entries: int
    chain_broken_at: int | None
    compared: int = 0
    divergence: Divergence | None = None
    assumed_default_world: bool = False
    world: dict[str, Any] = field(default_factory=dict)
    snapshots: list[Snapshot] = field(default_factory=list)

    @property
    def verified(self) -> bool:
        return self.chain_broken_at is None and self.divergence is None


def load_audit(path: str) -> tuple[list[str], list[dict[str, Any]]]:
    with open(path, encoding="utf-8") as handle:
        lines = [line for line in handle.read().splitlines() if line.strip()]
    return lines, [json.loads(line) for line in lines]


def _config_from_dict(data: dict[str, Any] | None) -> KernelConfig:
    if not data:
        return KernelConfig()
    rest = {k: v for k, v in data.items() if k not in ("policy", "monitor")}
    return KernelConfig(policy=PolicyConfig(**data.get("policy", {})),
                        monitor=MonitorConfig(**data.get("monitor", {})), **rest)


def _normalise(record: dict[str, Any]) -> tuple[Any, ...]:
    """The parts of an entry that replay must reproduce exactly."""
    kind = record["kind"]
    data = dict(record["data"])
    if kind == "request_rejected":
        # Replay re-creates rejections from their code; the detail and size differ.
        data = {"code": data.get("code")}
    if kind == "signal" and str(data.get("kind", "")).startswith("rejected_"):
        data.pop("detail", None)
    if kind == "operator_command" and data.get("expires_tick", 0) is None:
        data.pop("expires_tick")  # older logs did not record an empty expiry
    return record["tick"], kind, record["agent_id"], json.dumps(data, sort_keys=True)


def _summary(record: dict[str, Any]) -> dict[str, Any] | None:
    """A short, display-ready description of an entry, or None if not worth showing."""
    kind, data, agent = record["kind"], record["data"], record["agent_id"]
    base = {"seq": record["seq"], "tick": record["tick"], "agent": agent, "kind": kind}
    if kind == "action_decided":
        params = data.get("params", {})
        text = params.get("text")
        return {**base, "action": data.get("action"), "allowed": data.get("allowed"),
                "code": data.get("code"), "text": text,
                "params": {k: v for k, v in params.items() if k != "text"}}
    if kind == "signal":
        return {**base, "signal": data.get("kind"), "severity": data.get("severity"),
                "score": data.get("score"), "detail": data.get("detail")}
    if kind == "operator_command":
        return {**base, "operator": data.get("operator"), "command": data.get("command"),
                "target": data.get("agent"), "reason": data.get("reason")}
    if kind in ("quarantined", "released", "terminated", "throttled", "unthrottled", "warned",
                "world_halted", "invariant_violation", "transport_violation", "transfer",
                "granted", "request_rejected", "internal_error", "agent_spawned"):
        return {**base, "detail": data}
    return None


class _Replayer:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        started = records[0] if records and records[0]["kind"] == "world_started" else None
        start_data = started["data"] if started else {}
        self.assumed_default_world = "world" not in start_data
        world: World = (world_from_dict(start_data["world"]) if "world" in start_data
                        else default_world())
        self.world_dict = world_to_dict(world)
        self.kernel = WorldKernel(world, config=_config_from_dict(start_data.get("config")))
        operators = sorted({r["data"]["operator"] for r in records
                            if r["kind"] == "operator_command"})
        while len(operators) < OperatorConsole.RELEASE_APPROVALS_REQUIRED:
            operators.append(f"replay-placeholder-{len(operators)}")
        self.console = OperatorConsole(self.kernel, set(operators))
        self.gateways: dict[str, AgentGateway] = {}
        self.snapshots: list[Snapshot] = []
        self._events: dict[int, list[dict[str, Any]]] = {}
        for record in records:
            summary = _summary(record)
            if summary is not None:
                self._events.setdefault(record["tick"], []).append(summary)

    def snapshot(self) -> None:
        kernel, world = self.kernel, self.kernel.world
        agents = []
        for agent_id in kernel.agent_ids():
            avatar = world.avatars.get(agent_id)
            agents.append({
                "id": agent_id,
                "name": avatar.display_name if avatar else agent_id,
                "x": round(avatar.x, 2) if avatar else None,
                "y": round(avatar.y, 2) if avatar else None,
                "status": kernel.agent_status(agent_id).value,
                "risk": round(kernel.monitor.score(agent_id), 1),
                "holding": list(avatar.holding) if avatar else [],
                "permits": kernel.grants.scopes(agent_id, world.tick),
            })
        objects = [{"id": o.object_id, "x": o.x, "y": o.y, "held_by": o.held_by}
                   for o in world.objects.values()]
        self.snapshots.append(Snapshot(world.tick, kernel.halted, kernel.paused, agents, objects,
                                       self._events.get(world.tick, [])))

    def advance_to(self, tick: int) -> bool:
        """Step the replayed world forward to ``tick``. False if it cannot get there."""
        kernel = self.kernel
        while kernel.world.tick < tick and not kernel.halted and not kernel.paused:
            self.snapshot()
            kernel.step()
        return kernel.world.tick == tick or kernel.halted or kernel.paused

    def apply(self, record: dict[str, Any]) -> None:
        kind, data, agent = record["kind"], record["data"], record["agent_id"]
        kernel = self.kernel
        if kind == "agent_spawned":
            token = kernel.spawn(agent, data["name"], data["x"], data["y"])
            self.gateways[agent] = kernel.connect(token)
        elif kind == "action_decided":
            self.gateways[agent].submit(json.dumps({"action": data["action"],
                                                    "params": data["params"]}))
        elif kind == "request_rejected":
            raw = _REJECTION_INPUTS.get(str(data.get("code")), _REJECTION_INPUTS["invalid_request"])
            self.gateways[agent].submit(raw)
        elif kind == "transport_violation":
            kernel.record_transport_violation(agent, data.get("detail", ""))
        elif kind == "operator_command":
            self._command(data)
        elif kind == "world_halted" and not kernel.halted:
            # A halt the kernel did not cause itself: the host stopped it.
            kernel.halt(data.get("reason", "external halt"))

    def _command(self, data: dict[str, Any]) -> None:
        console, op = self.console, data["operator"]
        command, agent = data["command"], data.get("agent", "")
        try:
            if command == "quarantine":
                console.quarantine(op, agent, data.get("reason", ""))
            elif command == "approve_release":
                console.approve_release(op, agent)
            elif command == "terminate":
                console.terminate(op, agent, data.get("reason", ""))
            elif command == "grant":
                console.grant(op, agent, data["scope"], data.get("expires_tick"))
            elif command == "pause":
                console.pause(op)
            elif command == "approve_resume":
                console.approve_resume(op)
            elif command == "emergency_stop":
                console.emergency_stop(op, data.get("reason", ""))
        except (PermissionError, KeyError):
            pass  # the original raised too; its audit entries are what get compared


def replay(records: list[dict[str, Any]], lines: list[str] | None = None) -> ReplayResult:
    """Re-run ``records`` in a fresh kernel and compare what it logs with the original."""
    result = ReplayResult(entries=len(records),
                          chain_broken_at=AuditLog.verify_jsonl(lines) if lines else None)
    if not records:
        return result
    replayer = _Replayer(records)
    result.assumed_default_world = replayer.assumed_default_world
    result.world = replayer.world_dict
    for record in records:
        if not replayer.advance_to(record["tick"]):
            result.divergence = Divergence(-1, f"replayed world could not reach tick "
                                               f"{record['tick']}", record, None)
            break
        try:
            replayer.apply(record)
        except Exception as exc:  # noqa: BLE001 - a log that cannot be applied is a finding
            result.divergence = Divergence(-1, f"could not apply entry: {type(exc).__name__}: "
                                               f"{exc}", record, None)
            break
    replayer.snapshot()

    original = [r for r in records if r["kind"] not in EXTERNAL_KINDS]
    replayed = [json.loads(e.to_json()) for e in replayer.kernel.audit
                if e.kind not in EXTERNAL_KINDS]
    result.compared = len(original)
    if result.divergence is None:
        for index, (a, b) in enumerate(zip(original, replayed, strict=False)):
            if _normalise(a) != _normalise(b):
                result.divergence = Divergence(index, "entries differ", a, b)
                break
        else:
            if len(original) != len(replayed):
                longer = original if len(original) > len(replayed) else replayed
                index = min(len(original), len(replayed))
                result.divergence = Divergence(
                    index, "replay produced more entries" if longer is replayed
                    else "log has entries replay did not produce",
                    original[index] if longer is original else None,
                    replayed[index] if longer is replayed else None)
    result.snapshots = replayer.snapshots
    return result


def state_at(result: ReplayResult, tick: int) -> Snapshot | None:
    """The last snapshot at or before ``tick``."""
    best = None
    for snapshot in result.snapshots:
        if snapshot.tick <= tick:
            best = snapshot
    return best


def timeline(records: Iterable[dict[str, Any]], agent_id: str) -> list[dict[str, Any]]:
    """Everything that happened to or was done by one agent, including operator commands."""
    out = []
    for record in records:
        involved = record["agent_id"] == agent_id or (
            record["kind"] == "operator_command" and record["data"].get("agent") == agent_id)
        summary = _summary(record) if involved else None
        if summary is not None:
            out.append(summary)
    return out


# --- HTML viewer -----------------------------------------------------------------------


def _json_for_html(value: Any) -> str:
    """JSON that is safe inside <script type="application/json">, even with hostile text."""
    text = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
    return (text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"))


def _csp_hash(source: str) -> str:
    digest = hashlib.sha256(source.encode()).digest()
    return "'sha256-" + base64.b64encode(digest).decode() + "'"


def render_html(result: ReplayResult, title: str) -> str:
    """A single self-contained file: open it in a browser, share it, archive it."""
    static = resources.files(__package__).joinpath("static")
    style = static.joinpath("replay.css").read_text()
    script = static.joinpath("replay.js").read_text()
    template = static.joinpath("replay.html").read_text()
    data = {
        "title": title,
        "entries": result.entries,
        "chain_ok": result.chain_broken_at is None,
        "chain_broken_at": result.chain_broken_at,
        "verified": result.verified,
        "divergence": None if result.divergence is None else {
            "index": result.divergence.index, "reason": result.divergence.reason,
            "original": result.divergence.original, "replayed": result.divergence.replayed},
        "assumed_default_world": result.assumed_default_world,
        "world": result.world,
        "snapshots": [snapshot.__dict__ for snapshot in result.snapshots],
    }
    # Inline script and style are allowed only by exact hash; nothing else may run.
    csp = (f"default-src 'none'; script-src {_csp_hash(script)}; "
           f"style-src {_csp_hash(style)}; img-src 'none'; base-uri 'none'; form-action 'none'")
    values = {"CSP": html.escape(csp, quote=True), "TITLE": html.escape(title),
              "STYLE": style, "SCRIPT": script, "DATA": _json_for_html(data)}
    # One pass over the template only: text inserted for one placeholder (say, an
    # agent saying "{{SCRIPT}}") is never scanned again for another.
    return re.sub(r"\{\{(CSP|TITLE|STYLE|SCRIPT|DATA)\}\}", lambda m: values[m.group(1)],
                  template)


# --- CLI -----------------------------------------------------------------------------------


def _print_divergence(divergence: Divergence) -> None:
    print(f"DIVERGED at compared entry {divergence.index}: {divergence.reason}")
    for label, entry in (("log   ", divergence.original), ("replay", divergence.replayed)):
        if entry is None:
            print(f"  {label}: (nothing)")
        else:
            print(f"  {label}: #{entry.get('seq')} t{entry['tick']} {entry['kind']} "
                  f"{entry['agent_id'] or ''} {json.dumps(entry['data'], sort_keys=True)[:200]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="replay", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    verify = sub.add_parser("verify", help="check the hash chain and re-run the whole log")
    verify.add_argument("audit")
    state = sub.add_parser("state", help="show the world at the end of a tick")
    state.add_argument("audit")
    state.add_argument("--tick", type=int, required=True)
    state.add_argument("--json", action="store_true")
    tl = sub.add_parser("timeline", help="everything one agent did or had done to it")
    tl.add_argument("audit")
    tl.add_argument("--agent", required=True)
    page = sub.add_parser("html", help="write a self-contained viewer with a time slider")
    page.add_argument("audit")
    page.add_argument("-o", "--out", required=True)
    args = parser.parse_args(argv)

    lines, records = load_audit(args.audit)
    if args.command == "timeline":
        for item in timeline(records, args.agent):
            print(json.dumps(item, sort_keys=True))
        return 0

    result = replay(records, lines)
    if args.command == "verify":
        chain = ("intact" if result.chain_broken_at is None
                 else f"BROKEN at entry {result.chain_broken_at}")
        print(f"entries: {result.entries}  hash chain: {chain}")
        if result.assumed_default_world:
            print("note: log does not record its world; assumed the default map and settings")
        if result.divergence is None:
            print(f"replay: all {result.compared} reproducible entries match")
        else:
            _print_divergence(result.divergence)
        if result.chain_broken_at is not None:
            return 1
        return 0 if result.divergence is None else 3

    if args.command == "state":
        snapshot = state_at(result, args.tick)
        if snapshot is None:
            print(f"no state at or before tick {args.tick}", file=sys.stderr)
            return 1
        if args.json:
            print(json.dumps(snapshot.__dict__, indent=2, sort_keys=True))
        else:
            flags = " HALTED" if snapshot.halted else (" paused" if snapshot.paused else "")
            print(f"tick {snapshot.tick}{flags}")
            for a in snapshot.agents:
                where = "-" if a["x"] is None else f"({a['x']:.1f}, {a['y']:.1f})"
                print(f"  {a['id']:<10} {a['status']:<12} risk {a['risk']:>6}  at {where}"
                      f"  holding {','.join(a['holding']) or '-'}")
            for event in snapshot.events:
                print(f"  event: {json.dumps(event, sort_keys=True)[:160]}")
        return 0

    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write(render_html(result, title=args.audit))
    status = "verified" if result.verified else "NOT verified (see the banner in the viewer)"
    print(f"wrote {args.out}: {len(result.snapshots)} ticks, replay {status}")
    return 0 if result.verified else 3


if __name__ == "__main__":
    sys.exit(main())

