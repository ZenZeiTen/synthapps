"""A backend that only records what it would send. Used for dry runs and tests."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from ..controls import Control, Kind
from .base import Backend


@dataclass
class RecordingBackend(Backend):
    name: str = "record"
    kinds: frozenset[Kind] = frozenset(Kind) - {Kind.STICK_DIRECTION}
    events: list[tuple[float, str, object]] = field(default_factory=list)
    clock: object = time.perf_counter

    def _now(self) -> float:
        return self.clock()  # type: ignore[operator]

    def _emit_button(self, control: Control, down: bool) -> None:
        self.events.append((self._now(), "down" if down else "up", control.name))

    def _emit_axes(self, axes: tuple[float, ...]) -> None:
        self.events.append((self._now(), "axes", tuple(round(a, 4) for a in axes)))

    def _emit_mouse_move(self, dx: int, dy: int) -> None:
        self.events.append((self._now(), "mouse", (dx, dy)))

    # helpers for tests and dry-run reports
    def presses(self, name: str) -> int:
        return sum(1 for _, kind, v in self.events if kind == "down" and v == name)

    def held_now(self) -> set[str]:
        return {c.name for c in self._current.held}

    def mouse_total(self) -> tuple[int, int]:
        dx = sum(v[0] for _, k, v in self.events if k == "mouse")  # type: ignore[index]
        dy = sum(v[1] for _, k, v in self.events if k == "mouse")  # type: ignore[index]
        return dx, dy
