"""synthapps_zenzeiworld: reference kernel for a contained, embodied multi-agent world."""

from .actions import Action, ActionRejected, ActionType, parse_action
from .kernel import AgentGateway, AgentStatus, KernelConfig, OperatorConsole, WorldKernel
from .security import AuthenticationError
from .world import HumanoidSpec, World, default_world

__all__ = [
    "Action",
    "ActionRejected",
    "ActionType",
    "AgentGateway",
    "AgentStatus",
    "AuthenticationError",
    "HumanoidSpec",
    "KernelConfig",
    "OperatorConsole",
    "World",
    "WorldKernel",
    "default_world",
    "parse_action",
]
