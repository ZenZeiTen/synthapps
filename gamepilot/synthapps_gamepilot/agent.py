"""The loop that ties eyes, brain and hands together.

    look (capture) -> think (planner) -> act (executor) -> look again

Safety is part of the loop, not an add-on: it checks for anti-cheat before the
first input, stops on the kill switch or a spending limit, pauses sending input
while the game window is not in front, and always lets go of every input when it
ends, however it ends.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .backends.base import Backend
from .capture import Capture
from .executor import Clock, Executor, RealTimeClock, SteppedClock, Timing
from .imaging import Frame, encode_png, fit
from .plan import Plan, PlanError, PointerMap, describe, map_pointer, parse_plan
from .planner import Decision, Observation, Planner
from .profile import Profile
from .retroarch import RetroArch, RetroArchError
from .safety import Budget, KillSwitch, detect_anti_cheat
from .window import WindowTracker

FREE_PLAY = "Free play:"


class AntiCheatRunning(RuntimeError):
    pass


@dataclass
class RunResult:
    status: str  # done | stopped | stuck | refused | error
    reason: str
    turns: int
    cost_usd: float
    log: list[dict[str, Any]] = field(default_factory=list)


class _Throttled:
    """Calls ``fn`` at most every ``interval`` seconds and reuses the last answer."""

    def __init__(self, fn: Callable[[], bool], interval: float, now: Callable[[], float]) -> None:
        self.fn, self.interval, self.now = fn, interval, now
        self.last_t = -1e9
        self.last = False

    def __call__(self) -> bool:
        t = self.now()
        if t - self.last_t >= self.interval:
            self.last_t, self.last = t, self.fn()
        return self.last


class GameAgent:
    def __init__(
        self,
        profile: Profile,
        backend: Backend,
        capture: Capture,
        planner: Planner,
        window: WindowTracker | None = None,
        retroarch: RetroArch | None = None,
        clock: Clock | None = None,
        kill_switch: KillSwitch | None = None,
        budget: Budget | None = None,
        log: Callable[[str], None] = print,
        transcript: Path | None = None,
        frames_dir: Path | None = None,
        process_names: Callable[[], list[str]] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.p = profile
        self.backend = backend
        self.capture = capture
        self.planner = planner
        self.window = window or WindowTracker()
        self.retroarch = retroarch
        self.kill = kill_switch or KillSwitch()
        a = profile.agent
        self.budget = budget or Budget(a.max_turns, a.max_minutes * 60, a.max_cost_usd, a.model)
        self.log = log
        self.transcript = transcript
        self.frames_dir = frames_dir
        self.process_names = process_names
        self.sleep = sleep
        self.now = now
        self.bindings = profile.resolved_bindings()
        self.timing = Timing(profile.game.fps, profile.input.min_hold_frames,
                             profile.input.min_release_frames)
        if clock is None:
            if profile.pacing.mode == "retroarch":
                if retroarch is None:
                    raise ValueError("pacing.mode = retroarch needs a RetroArch connection")
                clock = SteppedClock(retroarch.frame_advance, tick_hz=profile.game.fps)
            elif profile.pacing.mode == "stepped":
                raise ValueError("pacing.mode = stepped needs a clock that advances the game")
            else:
                clock = RealTimeClock(tick_hz=profile.input.tick_hz)
        self.clock = clock
        focus_check = profile.input.focus_check
        self._focus_lost = _Throttled(self.window.focus_lost if focus_check else (lambda: False),
                                      0.1, time.monotonic)
        self.executor = Executor(backend, clock, self.timing, should_stop=self._interrupt)
        self.records: list[dict[str, Any]] = []
        self.pointer_map: PointerMap | None = None
        self.goal = profile.agent.goal
        self.goals_queue = list(profile.agent.goals)
        self.goals_done: list[str] = []

    # --- checks -----------------------------------------------------------------
    def _interrupt(self) -> str:
        reason = self.kill.check()
        if reason:
            return reason
        if self._focus_lost():
            return "game window lost focus"
        return ""

    def preflight(self) -> None:
        found = detect_anti_cheat(self.process_names() if self.process_names else None)
        if found:
            names = ", ".join(f"{proc} ({product})" for proc, product in sorted(found.items()))
            if not self.p.agent.allow_anticheat:
                raise AntiCheatRunning(
                    f"anti-cheat software is running: {names}. Automated input can get an account "
                    "banned and is against the rules of online games. Close that game, or set "
                    "agent.allow_anticheat = true only for an offline single-player game whose "
                    "terms allow it."
                )
            self.log(f"WARNING: anti-cheat running ({names}); continuing because the profile allows it")

    # --- one turn ---------------------------------------------------------------
    def _grab_frames(self) -> list[Frame]:
        frames = [self.capture.grab()]
        for _ in range(self.p.agent.frames_per_turn - 1):
            if self.retroarch is not None and self.p.pacing.mode == "retroarch":
                for _ in range(max(1, round(self.p.agent.frame_gap_ms * self.p.game.fps / 1000))):
                    self.retroarch.frame_advance()
                self.sleep(0.02)
            else:
                self.sleep(self.p.agent.frame_gap_ms / 1000)
            frames.append(self.capture.grab())
        region = self.capture.last_region
        last = frames[-1]
        if region is not None:
            w, h = fit(last.width, last.height, self.p.agent.image_max_edge)
            self.pointer_map = PointerMap(*region, w, h)
        return frames

    def _memory(self) -> dict[str, str]:
        out: dict[str, str] = {}
        if self.retroarch is None:
            return out
        for w in self.p.retroarch.watch:
            try:
                data = self.retroarch.read_memory(w.address, w.length)
                out[w.name] = str(int.from_bytes(data, "little"))
            except RetroArchError as exc:
                out[w.name] = f"unreadable ({exc})"
        return out

    def _tap(self, control_name: str) -> None:
        plan = parse_plan([{"buttons": [control_name], "duration_ms": 80}], self.bindings)
        self.executor.run(plan)

    def _wait_for_focus(self) -> str:
        self.backend.release_all()
        self.log("game window is not in front; inputs released, waiting (bring the game back)")
        while True:
            reason = self.kill.check() or self.budget.exhausted()
            if reason:
                return reason
            if not self.window.focus_lost():
                self.log("game window is back in front; continuing")
                return ""
            self.sleep(0.5)

    def _save_frames(self, turn: int, frames: list[Frame]) -> None:
        if not self.frames_dir:
            return
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        for i, f in enumerate(frames):
            (self.frames_dir / f"turn{turn:04d}_{i}.png").write_bytes(encode_png(f))

    def _record(self, entry: dict[str, Any]) -> None:
        self.records.append(entry)
        if self.transcript:
            with self.transcript.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _next_goal(self) -> str | None:
        """The goal after the current one: the next listed goal, or a free-play goal, or None."""
        if self.goals_queue:
            return self.goals_queue.pop(0)
        if self.p.agent.free_play:
            done = "; ".join(self.goals_done[-8:]) or "nothing yet"
            return (f"{FREE_PLAY} choose something new and worthwhile to do in this game that you have not "
                    "done yet, say what it is in your intent and your notes, and do it. Already done: "
                    f"{done}. When it is done, report done and you will be asked to choose again.")
        return None

    # --- the loop ---------------------------------------------------------------
    def run(self) -> RunResult:
        self.preflight()
        status, reason = "stopped", ""
        last_result, last_error = "No inputs sent yet.", False
        stuck_in_a_row = 0
        try:
            if self.retroarch is not None and self.p.pacing.mode == "retroarch":
                self.retroarch.set_paused(True)
                self.log("RetroArch paused; the game advances only while a plan runs")
            while True:
                reason = self.kill.check() or self.budget.exhausted()
                if reason:
                    break
                if self.p.input.focus_check and self.window.focus_lost():
                    reason = self._wait_for_focus()
                    if reason:
                        break
                    continue

                turn = self.budget.turns + 1
                frames = self._grab_frames()
                self._save_frames(turn, frames)
                obs = Observation(frames, last_result, turn, self._memory(), last_error,
                                  goal=self.goal if self.goal != self.p.agent.goal else "")
                if self.p.pacing.pause_input:
                    self._tap(self.p.pacing.pause_input)
                started = self.now()
                decision = self.planner.decide(obs)
                think_s = self.now() - started
                self.budget.turns += 1
                if self.p.pacing.pause_input:
                    self._tap(self.p.pacing.pause_input)
                    self.sleep(self.p.pacing.pause_settle_ms / 1000)

                entry: dict[str, Any] = {
                    "turn": turn, "think_s": round(think_s, 2), "status": decision.status,
                    "saw": decision.observation, "intent": decision.intent,
                    "cost_usd": round(self.budget.cost_usd, 4),
                }
                if decision.status == "refused":
                    status, reason = "refused", f"the model declined to continue: {decision.observation}"
                    self._record(entry)
                    break
                if decision.status == "done":
                    entry["goal"] = self.goal
                    self._record(entry)
                    free = self.goal.startswith(FREE_PLAY)
                    self.goals_done.append((decision.intent or decision.observation or "a goal")[:120]
                                           if free else self.goal)
                    nxt = self._next_goal()
                    if nxt is None:
                        status, reason = "done", decision.observation or "the planner reports the goal reached"
                        break
                    self.log(f"turn {turn}: goal reached: {self.goals_done[-1]}")
                    self.log("  next: " + ("Claude chooses (free play)" if nxt.startswith(FREE_PLAY) else nxt))
                    self.goal = nxt
                    last_result, last_error = f"Goal reached. Your next goal: {nxt}", False
                    stuck_in_a_row = 0
                    continue
                stuck_in_a_row = stuck_in_a_row + 1 if decision.status == "stuck" else 0
                if stuck_in_a_row >= 3:
                    status, reason = "stuck", "the planner reported being stuck three turns in a row"
                    self._record(entry)
                    break

                last_result, last_error = self._act(decision, entry)
                self._record(entry)
                self.log(f"turn {turn} ({think_s:.1f}s, ${self.budget.cost_usd:.3f}): "
                         f"{decision.intent or decision.status} -> {entry.get('result', '')}")
                if "stopped early" in entry.get("result", "") and self.kill.check():
                    reason = self.kill.check()
                    break
        except KeyboardInterrupt:
            reason = "interrupted with Ctrl+C"
        except Exception as exc:
            status, reason = "error", f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self.backend.release_all()
            self.log(f"finished: {status} ({reason}); all inputs released")
        return RunResult(status, reason, self.budget.turns, self.budget.cost_usd, self.records)

    def _act(self, decision: Decision, entry: dict[str, Any]) -> tuple[str, bool]:
        notes = []
        if decision.emulator != "none":
            if self.retroarch is None:
                notes.append(f"{decision.emulator} ignored: no emulator connection")
            else:
                (self.retroarch.save_state if decision.emulator == "save_state"
                 else self.retroarch.load_state)()
                notes.append(f"{decision.emulator} done")
                entry["emulator"] = decision.emulator
                if decision.emulator == "load_state":
                    self.sleep(0.1)
        try:
            plan: Plan = map_pointer(parse_plan(decision.steps, self.bindings, decision.intent),
                                     self.pointer_map)
        except PlanError as exc:
            entry["result"] = f"plan rejected: {exc}"
            return "; ".join(notes + [f"Your plan was rejected and nothing was pressed: {exc}"]), True
        entry["plan"] = describe(plan)
        if not plan.steps:
            entry["result"] = "empty plan, nothing pressed"
            return "; ".join(notes + ["The plan was empty; nothing was pressed."]), False
        report = self.executor.run(plan)
        entry["result"] = report.summary()
        return "; ".join(notes + [f"Plan {report.summary()}."]), not report.completed
