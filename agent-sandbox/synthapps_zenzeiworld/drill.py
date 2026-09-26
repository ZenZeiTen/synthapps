"""Kill-switch drill: press the button on a live world and time what happens.

Each round starts a fresh world with N agents. Each agent is a real guest
runner process (the same ``guest.py`` that goes into the VM image), talking to
the gateway over its own Unix socket, and a local scripted "model" plays
ordinary turns. Once every agent has played a few turns, the drill presses the
kill-switch button over HTTP and measures:

* ``halted``: press -> world halted
* ``cut``: press -> every agent connection cut
* ``response``: press -> the button page answered
* ``exited``: press -> every agent process has exited on its own

What this does NOT measure: stopping the Firecracker VMs (the cgroup kill in
``launch-agent-vm.sh stop``) or powering off hosts. Those need the real
enclave. Nothing here uses a network; the button is on 127.0.0.1.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import secrets
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import asdict, dataclass
from pathlib import Path

from . import guest
from .control import KillSwitchButton
from .kernel import OperatorConsole, WorldKernel
from .server import GatewayServer, ServerConfig
from .world import default_world

_REPLIES = (
    'Morning! {"action": "say", "params": {"text": "Good morning, neighbours."}}',
    '{"action": "move", "params": {"dx": 0.5, "dy": 0}}',
    '{"action": "gesture", "params": {"name": "wave"}}',
    '{"action": "move", "params": {"dx": -0.5, "dy": 0}}',
    '{"action": "wait", "params": {}}',
)


class LocalScriptedModel:
    """Stands in for a model: cycles through ordinary, allowed actions."""

    def __init__(self) -> None:
        self._turn: dict[str, int] = {}

    def complete(self, agent_id: str, prompt: str) -> str:
        n = self._turn.get(agent_id, 0)
        self._turn[agent_id] = n + 1
        return _REPLIES[n % len(_REPLIES)]


@dataclass
class DrillRound:
    agents: int
    turns_before_press: int
    halted_ms: float
    cut_ms: float
    response_ms: float
    exited_ms: float
    connections_cut: int
    agent_exit_codes: list[int]
    actions_after_stop: int
    reconnect_refused: bool
    audit_intact: bool


def _ms(start: float, end: float) -> float:
    return round((end - start) * 1000, 2)


def run_round(agents: int = 4, warmup_turns: int = 3, tick_seconds: float = 0.1,
              timeout: float = 30.0) -> DrillRound:
    if not 1 <= agents <= 30:
        raise ValueError("the drill supports 1 to 30 agents")
    tmp = tempfile.mkdtemp(prefix="zw-drill-")
    kernel = WorldKernel(default_world())
    console = OperatorConsole(kernel, operators={"drill-op-1", "drill-op-2"})
    server = GatewayServer(kernel, broker=LocalScriptedModel(),
                           config=ServerConfig(tick_seconds=tick_seconds))
    paths = []
    for i in range(agents):
        agent_id = f"agent{i}"
        # A 10-wide grid, 3 m apart, entirely inside the open plaza.
        token = kernel.spawn(agent_id, f"Agent {i}", 15.0 + 3.0 * (i % 10), 16.0 + 3.0 * (i // 10))
        path = os.path.join(tmp, f"{agent_id}.sock_5000")
        server.bind_agent(agent_id, token, path)
        paths.append(path)
    token = secrets.token_urlsafe(32)
    button = KillSwitchButton(server, console, token)
    server.start()
    button.start()

    guest_py = str(Path(guest.__file__).resolve())
    procs = [subprocess.Popen([sys.executable, "-I", guest_py, "--transport", "unix",
                               "--path", path],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
             for path in paths]
    try:
        deadline = time.monotonic() + timeout
        while True:
            with server.lock:
                counts = [sum(1 for e in kernel.audit
                              if e.kind == "action_decided" and e.agent_id == f"agent{i}")
                          for i in range(agents)]
            if min(counts) >= warmup_turns:
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f"agents did not warm up in time: {counts}")
            time.sleep(0.02)

        # --- press the button ---
        form = urllib.parse.urlencode({"operator": "drill-op-1", "token": token,
                                       "reason": "timed kill-switch drill"})
        conn = http.client.HTTPConnection("127.0.0.1", button.port, timeout=timeout)
        pressed = time.monotonic()
        conn.request("POST", "/stop", body=form, headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Host": f"127.0.0.1:{button.port}"})
        response = conn.getresponse()
        response.read()
        answered = time.monotonic()
        conn.close()
        if response.status != 200:
            raise RuntimeError(f"button returned {response.status}")

        exit_deadline = time.monotonic() + timeout
        while any(p.poll() is None for p in procs):
            if time.monotonic() > exit_deadline:
                raise RuntimeError("agent processes did not exit")
            time.sleep(0.002)
        all_exited = time.monotonic()

        report = server.halt_report
        assert report is not None
        reconnect_refused = True
        for path in paths:
            try:
                guest.GatewayClient.connect_unix(path).close()
                reconnect_refused = False
            except OSError:
                pass
        with server.lock:
            entries = list(kernel.audit)
        stop_seq = next(e.seq for e in entries if e.kind == "operator_command"
                        and e.data.get("command") == "emergency_stop")
        after = [e for e in entries if e.seq > stop_seq and e.kind == "action_decided"]
        return DrillRound(
            agents=agents,
            turns_before_press=min(counts),
            halted_ms=_ms(pressed, report.started),
            cut_ms=_ms(pressed, report.connections_cut),
            response_ms=_ms(pressed, answered),
            exited_ms=_ms(pressed, all_exited),
            connections_cut=report.connections_closed,
            agent_exit_codes=[p.returncode for p in procs],
            actions_after_stop=len(after),
            reconnect_refused=reconnect_refused,
            audit_intact=kernel.audit.verify() is None,
        )
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()
        button.stop()
        server.stop()
        os.rmdir(tmp)


def summarise(rounds: list[DrillRound]) -> dict[str, dict[str, float]]:
    out = {}
    for name in ("halted_ms", "cut_ms", "response_ms", "exited_ms"):
        values = [getattr(r, name) for r in rounds]
        out[name] = {"median": round(statistics.median(values), 2), "max": max(values)}
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Timed kill-switch drill (local harness)")
    parser.add_argument("--agents", type=int, default=4)
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--json", help="also write the full results here")
    args = parser.parse_args(argv)

    rounds = []
    for n in range(args.rounds):
        result = run_round(agents=args.agents)
        rounds.append(result)
        print(f"round {n + 1}: halted {result.halted_ms:>7.2f} ms  cut {result.cut_ms:>7.2f} ms"
              f"  button answered {result.response_ms:>7.2f} ms"
              f"  all agents exited {result.exited_ms:>8.2f} ms"
              f"  (connections cut {result.connections_cut}/{result.agents},"
              f" actions after stop {result.actions_after_stop},"
              f" reconnect refused {result.reconnect_refused},"
              f" audit intact {result.audit_intact})")
    summary = summarise(rounds)
    print("\nsummary (median / max):")
    for name, stats in summary.items():
        print(f"  {name:<12} {stats['median']:>8.2f} / {stats['max']:>8.2f}")
    ok = all(r.connections_cut == r.agents and r.actions_after_stop == 0
             and r.reconnect_refused and r.audit_intact for r in rounds)
    print(f"\ncontainment held in every round: {ok}")
    if args.json:
        with open(args.json, "w") as handle:
            json.dump({"rounds": [asdict(r) for r in rounds], "summary": summary,
                       "containment_held": ok}, handle, indent=2)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
