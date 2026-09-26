from __future__ import annotations

import json
from typing import Any

from agentworld.kernel import AgentGateway, KernelConfig, OperatorConsole, WorldKernel
from agentworld.world import default_world


def req(action: str, **params: Any) -> str:
    return json.dumps({"action": action, "params": params})


def make_world(config: KernelConfig | None = None,
               positions: dict[str, tuple[float, float]] | None = None,
               ) -> tuple[WorldKernel, OperatorConsole, dict[str, AgentGateway], dict[str, str]]:
    kernel = WorldKernel(default_world(), config=config)
    console = OperatorConsole(kernel, operators={"alice", "bashir", "chen"})
    positions = positions or {"ada": (20.0, 21.0), "bo": (21.0, 21.0)}
    gateways, tokens = {}, {}
    for agent_id, (x, y) in positions.items():
        tokens[agent_id] = kernel.spawn(agent_id, agent_id.title(), x, y)
        gateways[agent_id] = kernel.connect(tokens[agent_id])
    return kernel, console, gateways, tokens
