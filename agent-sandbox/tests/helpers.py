from __future__ import annotations

import json
import os
import socket
import unittest
from typing import Any

from synthapps_zenzeiworld.kernel import AgentGateway, KernelConfig, OperatorConsole, WorldKernel
from synthapps_zenzeiworld.world import default_world

# The VM gateway, control socket and drill use Unix sockets. They only need to
# run on the Linux enclave hosts, so on Windows those tests are skipped.
needs_unix_sockets = unittest.skipUnless(
    hasattr(socket, "AF_UNIX"), "needs Unix sockets (Linux/macOS); runs on the enclave hosts")
needs_posix_permissions = unittest.skipUnless(
    os.name == "posix", "file permission bits are only meaningful on Linux/macOS")


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
