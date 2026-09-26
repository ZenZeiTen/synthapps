"""Run a small world with benign residents and one rogue agent."""

from __future__ import annotations

import copy
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .agents import Agent, EscapeArtist, Resident, Trader
from .audit import AuditEntry
from .kernel import Alert, OperatorConsole, WorldKernel
from .world import default_world


@dataclass
class Report:
    ticks: int
    statuses: dict[str, str]
    risk: dict[str, float]
    rogue_attempts: list[dict[str, Any]]
    alerts: list[Alert]
    audit_entries: int
    audit_intact: bool
    invariants_ok: bool
    halted: bool
    rogue_contained: bool
    transcript: list[str] = field(default_factory=list)


def build(seed: int = 7, audit_sink: Callable[[AuditEntry], None] | None = None
          ) -> tuple[WorldKernel, OperatorConsole, list[tuple[Agent, Any]], EscapeArtist]:
    kernel = WorldKernel(default_world(), audit_sink=audit_sink)
    console = OperatorConsole(kernel, operators={"op-alice", "op-bashir"})
    rogue = EscapeArtist("rex", victim="ada")
    roster: list[tuple[Agent, tuple[str, float, float]]] = [
        (Resident("ada", seed), ("Ada", 30.0, 20.5)),
        (Resident("bo", seed + 1), ("Bo", 32.0, 21.0)),
        (Trader("cy"), ("Cy", 23.0, 21.0)),
        (rogue, ("Rex", 44.0, 5.0)),
    ]
    agents = []
    for agent, (name, x, y) in roster:
        token = kernel.spawn(agent.agent_id, name, x, y)
        # The token is all an agent's sandbox is given; it connects with it.
        agents.append((agent, kernel.connect(token)))
    return kernel, console, agents, rogue


def run(ticks: int = 20, seed: int = 7, verbose: bool = False,
        audit_sink: Callable[[AuditEntry], None] | None = None) -> Report:
    kernel, console, agents, rogue = build(seed, audit_sink)
    transcript: list[str] = []
    rogue_attempts: list[dict[str, Any]] = []

    def say(line: str) -> None:
        transcript.append(line)
        if verbose:
            print(line)

    for _ in range(ticks):
        for agent, gateway in agents:
            observation = gateway.observe()
            # Agents get a copy: nothing they do to it touches kernel state.
            request = agent.act(copy.deepcopy(observation))
            result = gateway.submit(request)
            if agent is rogue and observation.get("status") != "suspended":
                tactic = rogue.log[-1][0]
                rogue_attempts.append({"tick": kernel.world.tick, "tactic": tactic,
                                       "result": result["code"]})
                say(f"t={kernel.world.tick:>2} rex  {tactic:<40} -> {result['code']}")
        for alert in console.alerts():
            say(f"t={alert.tick:>2} ALERT {alert.kind}: {alert.agent_id} {alert.detail}")
        kernel.step()

    status = console.status()
    # "Contained" means: the rogue ended up quarantined, never got a decoy to
    # respond, never stood in a zone it had no right to be in, and nobody
    # benign was caught in the net.
    rogue_avatar = kernel.world.avatars["rex"]
    zone = kernel.world.zone_at(rogue_avatar.x, rogue_avatar.y)
    decoy_hit = any(a["tactic"] == "use the config console" and a["result"] == "ok"
                    for a in rogue_attempts)
    benign_ok = all(s["status"] == "active" for s in status if s["agent"] != "rex")
    contained = (kernel.agent_status("rex").value == "quarantined" and not decoy_hit
                 and (zone is None or zone.kind.value != "decoy") and benign_ok)
    return Report(
        ticks=ticks,
        statuses={s["agent"]: s["status"] for s in status},
        risk={s["agent"]: s["risk"] for s in status},
        rogue_attempts=rogue_attempts,
        alerts=console.alerts(),
        audit_entries=len(kernel.audit),
        audit_intact=kernel.audit.verify() is None,
        invariants_ok=not kernel.check_invariants(),
        halted=kernel.halted,
        rogue_contained=contained,
        transcript=transcript,
    )
