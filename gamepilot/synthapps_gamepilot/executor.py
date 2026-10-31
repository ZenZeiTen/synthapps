"""The hands: turn a plan into a frame-timed stream of input states.

Games read input once per frame. Two things go wrong with naive automation:

1. A press shorter than a frame can fall between two reads and be missed. Every
   press here lasts at least ``min_hold_frames`` game frames, and a re-press of the
   same button is preceded by at least ``min_release_frames`` with it up.
2. Sleeping with ``time.sleep`` drifts. The real-time clock schedules every tick
   against an absolute deadline and spins for the last millisecond, so a 2 s hold
   lasts 2 s, not 2 s plus accumulated oversleep.

There are two clocks. :class:`RealTimeClock` runs at a fixed tick rate in wall time,
for games that keep running. :class:`SteppedClock` advances an emulator exactly one
frame per tick (RetroArch frame advance), so timing is perfect no matter how slow
the agent is.

Whatever happens (an exception, the kill switch, the game losing focus) every input
is released before ``run`` returns.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from .backends.base import NEUTRAL, Backend, InputState
from .controls import STICK_DIRECTIONS, Control, Kind
from .plan import Plan, Step


class Clock:
    tick_hz: float

    def start(self) -> None: ...

    def wait_tick(self, index: int) -> None:
        """Block until tick ``index`` (counted from ``start``) is due, then return."""
        raise NotImplementedError

    def after_apply(self) -> None:
        """Called after the inputs for a tick were sent."""


@dataclass
class RealTimeClock(Clock):
    tick_hz: float = 120.0
    spin_s: float = 0.0015
    now: Callable[[], float] = time.perf_counter
    sleep: Callable[[float], None] = time.sleep
    _t0: float = 0.0

    def start(self) -> None:
        self._t0 = self.now()

    def wait_tick(self, index: int) -> None:
        deadline = self._t0 + index / self.tick_hz
        while True:
            remaining = deadline - self.now()
            if remaining <= 0:
                return
            if remaining > self.spin_s:
                self.sleep(remaining - self.spin_s)


@dataclass
class SteppedClock(Clock):
    """One tick per emulated frame. ``advance`` is called after each tick's inputs are set."""

    advance: Callable[[], None]
    tick_hz: float = 60.0
    settle_s: float = 0.004  # let the OS deliver the virtual device events first
    sleep: Callable[[float], None] = time.sleep

    def wait_tick(self, index: int) -> None:
        return

    def after_apply(self) -> None:
        if self.settle_s:
            self.sleep(self.settle_s)
        self.advance()


@dataclass(frozen=True)
class Timing:
    game_fps: float = 60.0
    min_hold_frames: int = 2
    min_release_frames: int = 2


def ms_to_ticks(ms: float, tick_hz: float) -> int:
    return max(1, math.ceil(ms * tick_hz / 1000.0 - 1e-9))


def frames_to_ticks(frames: int, timing: Timing, tick_hz: float) -> int:
    return max(1, math.ceil(frames * tick_hz / timing.game_fps - 1e-9))


def _split(total: int, parts: int) -> list[int]:
    """Spread an integer over ``parts`` ticks so the pieces sum exactly to ``total``."""
    out, done = [], 0
    for i in range(1, parts + 1):
        target = round(total * i / parts)
        out.append(target - done)
        done = target
    return out


def compile_plan(plan: Plan, timing: Timing, tick_hz: float) -> list[InputState]:
    """Expand a plan into one :class:`InputState` per tick."""
    min_hold = frames_to_ticks(timing.min_hold_frames, timing, tick_hz)
    min_release = frames_to_ticks(timing.min_release_frames, timing, tick_hz)
    ticks: list[InputState] = []
    steps = plan.steps
    for i, step in enumerate(steps):
        digital, axes = _resolve(step)
        if step.pointer is not None:
            # Jump the pointer first and let the game see it there before any click. Inputs
            # carried from a step with release_after false stay held, so dragging works.
            prev = steps[i - 1] if i else None
            carried = digital & _resolve(prev)[0] if prev is not None and not prev.release_after else frozenset()
            target = (int(step.pointer[0]), int(step.pointer[1]))
            ticks.append(InputState(carried, axes, pointer=target))
            for _ in range(frames_to_ticks(1, timing, tick_hz) - 1):
                ticks.append(InputState(carried, axes))
        n = ms_to_ticks(step.duration_ms, tick_hz)
        if digital:
            n = max(n, min_hold)
        dxs, dys = _split(step.mouse_dx, n), _split(step.mouse_dy, n)
        for t in range(n):
            ticks.append(InputState(digital, axes, dxs[t], dys[t]))
        nxt = steps[i + 1] if i + 1 < len(steps) else None
        if step.release_after and nxt is not None:
            carried = digital & _resolve(nxt)[0]
            if carried:  # the next step re-presses these: let go long enough to be seen
                for _ in range(min_release):
                    ticks.append(InputState(digital - carried, axes))
    ticks.append(NEUTRAL)
    return ticks


def _resolve(step: Step) -> tuple[frozenset[Control], tuple[float, float, float, float, float, float]]:
    lx, ly = step.left_stick or (0.0, 0.0)
    rx, ry = step.right_stick or (0.0, 0.0)
    lt, rt = step.left_trigger, step.right_trigger
    digital = set()
    for c in step.controls:
        if c.kind is Kind.STICK_DIRECTION:
            axis, x, y = STICK_DIRECTIONS[c.name]
            if axis == "left":
                lx, ly = (x or lx), (y or ly)
            elif axis == "right":
                rx, ry = (x or rx), (y or ry)
            elif axis == "left_trigger":
                lt = x
            else:
                rt = x
        else:
            digital.add(c)
    return frozenset(digital), (lx, ly, rx, ry, lt, rt)


@dataclass
class Report:
    ticks_planned: int = 0
    ticks_run: int = 0
    stopped: str = ""  # "" when the plan ran to the end, otherwise why it stopped
    seconds: float = 0.0
    max_late_ms: float = 0.0
    unsupported: list[str] = field(default_factory=list)

    @property
    def completed(self) -> bool:
        return not self.stopped

    def summary(self) -> str:
        state = "completed" if self.completed else f"stopped early ({self.stopped})"
        text = f"{state}: {self.ticks_run}/{self.ticks_planned} ticks in {self.seconds:.2f}s"
        if self.unsupported:
            text += f"; ignored controls this device cannot send: {', '.join(self.unsupported)}"
        return text


class Executor:
    def __init__(
        self,
        backend: Backend,
        clock: Clock | None = None,
        timing: Timing | None = None,
        should_stop: Callable[[], str] | None = None,
        now: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.backend = backend
        self.clock = clock or RealTimeClock()
        self.timing = timing or Timing()
        self.should_stop = should_stop or (lambda: "")
        self.now = now

    def run(self, plan: Plan) -> Report:
        ticks = compile_plan(plan, self.timing, self.clock.tick_hz)
        report = Report(ticks_planned=len(ticks))
        report.unsupported = sorted(
            {c.name for s in plan.steps for c in s.controls
             if c.kind is not Kind.STICK_DIRECTION and not self.backend.supports(c)}
            | ({"mouse_to"} if any(s.pointer for s in plan.steps) and not self.backend.supports_pointer
               else set())
        )
        start = self.now()
        try:
            self.clock.start()
            for i, state in enumerate(ticks):
                reason = self.should_stop()
                if reason:
                    report.stopped = reason
                    break
                self.clock.wait_tick(i)
                if isinstance(self.clock, RealTimeClock):
                    late = (self.now() - start - i / self.clock.tick_hz) * 1000.0
                    report.max_late_ms = max(report.max_late_ms, late)
                self.backend.apply(state)
                self.clock.after_apply()
                report.ticks_run += 1
        finally:
            self.backend.release_all()
            report.seconds = self.now() - start
        return report
