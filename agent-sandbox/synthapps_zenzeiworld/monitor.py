"""Behavioural monitoring and the escalation ladder.

Policy rules and the parser emit ``Signal``s. The monitor turns them into a
per-agent risk score that decays over time, and maps the score onto a
response level. One critical signal (touching a decoy) is enough to
quarantine; lesser signals have to add up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Severity(IntEnum):
    INFO = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


SEVERITY_WEIGHT: dict[Severity, float] = {
    Severity.INFO: 0.5,
    Severity.LOW: 2.0,
    Severity.MEDIUM: 8.0,
    Severity.HIGH: 20.0,
    Severity.CRITICAL: 100.0,
}


class Level(IntEnum):
    NORMAL = 0
    WARN = 1
    THROTTLE = 2
    QUARANTINE = 3


@dataclass(frozen=True)
class Signal:
    agent_id: str
    kind: str
    severity: Severity
    detail: str = ""


@dataclass
class MonitorConfig:
    decay_per_tick: float = 0.97  # half-life of roughly 23 ticks
    warn_at: float = 10.0
    throttle_at: float = 25.0
    quarantine_at: float = 50.0


@dataclass
class _AgentRisk:
    score: float = 0.0
    history: list[Signal] = field(default_factory=list)
    critical: bool = False


class RiskMonitor:
    def __init__(self, config: MonitorConfig | None = None) -> None:
        self.config = config or MonitorConfig()
        self._risk: dict[str, _AgentRisk] = {}

    def _entry(self, agent_id: str) -> _AgentRisk:
        return self._risk.setdefault(agent_id, _AgentRisk())

    def record(self, signal: Signal) -> Level:
        entry = self._entry(signal.agent_id)
        entry.score += SEVERITY_WEIGHT[signal.severity]
        entry.history.append(signal)
        if signal.severity is Severity.CRITICAL:
            entry.critical = True
        return self.level(signal.agent_id)

    def level(self, agent_id: str) -> Level:
        entry = self._entry(agent_id)
        cfg = self.config
        if entry.critical or entry.score >= cfg.quarantine_at:
            return Level.QUARANTINE
        if entry.score >= cfg.throttle_at:
            return Level.THROTTLE
        if entry.score >= cfg.warn_at:
            return Level.WARN
        return Level.NORMAL

    def score(self, agent_id: str) -> float:
        return self._entry(agent_id).score

    def history(self, agent_id: str) -> list[Signal]:
        return list(self._entry(agent_id).history)

    def decay(self) -> None:
        for entry in self._risk.values():
            entry.score *= self.config.decay_per_tick

    def reset(self, agent_id: str) -> None:
        """Called only when operators release an agent from quarantine."""
        entry = self._entry(agent_id)
        entry.score = 0.0
        entry.critical = False
