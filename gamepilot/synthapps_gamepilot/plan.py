"""The plan language: what the planner asks the hands to do.

A plan is a list of steps run one after another. Each step says which inputs are
held, where the sticks and triggers sit, and how far the mouse moves, for a set
time. Steps are written as plain JSON so a language model can produce them::

    {"buttons": ["jump", "RIGHT"], "duration_ms": 300}
    {"left_stick": {"x": 1, "y": 0}, "duration_ms": 800, "release_after": false}
    {"mouse_move": {"dx": 240, "dy": -30}, "buttons": ["MOUSE_LEFT"], "duration_ms": 120}
    {"duration_ms": 500}                       # wait with nothing held

Button names may be raw controls ("A", "KEY_SPACE", "MOUSE_LEFT", "LS_RIGHT") or
action names from the game profile ("jump" -> "A"). An input that is held in two
consecutive steps stays held, unless the first step has ``release_after: true``
(the default), in which case it is let go briefly so the game sees a fresh press.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from . import controls
from .controls import Control

MAX_STEPS = 40
MAX_STEP_MS = 5000
MAX_PLAN_MS = 15000
MAX_MOUSE = 5000
MAX_TEXT = 200
TYPE_KEY_MS = 30  # each typed character; the executor still holds it for at least min_hold_frames


class PlanError(ValueError):
    """A plan the hands refuse to run, with a message the planner can act on."""


@dataclass(frozen=True)
class Step:
    controls: frozenset[Control] = frozenset()
    left_stick: tuple[float, float] | None = None
    right_stick: tuple[float, float] | None = None
    left_trigger: float = 0.0
    right_trigger: float = 0.0
    mouse_dx: int = 0
    mouse_dy: int = 0
    duration_ms: int = 100
    release_after: bool = True
    #: Absolute pointer target. In a parsed plan: pixel position in the screenshot the
    #: planner saw. After :func:`map_pointer`: screen pixel position.
    pointer: tuple[float, float] | None = None


@dataclass(frozen=True)
class Plan:
    steps: tuple[Step, ...]
    intent: str = ""

    @property
    def duration_ms(self) -> int:
        return sum(s.duration_ms for s in self.steps)


@dataclass
class Bindings:
    """Action names from a game profile mapped to physical controls."""

    actions: dict[str, tuple[Control, ...]] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> Bindings:
        actions: dict[str, tuple[Control, ...]] = {}
        for action, target in mapping.items():
            names = [target] if isinstance(target, str) else list(target)
            if not names:
                raise PlanError(f"binding {action!r} is empty")
            try:
                actions[action.strip().lower()] = tuple(controls.resolve(n) for n in names)
            except controls.UnknownControl as exc:
                raise PlanError(f"binding {action!r}: {exc}; "
                                "list every name with: py -m synthapps_gamepilot controls") from None
        return cls(actions)

    def lookup(self, name: str) -> tuple[Control, ...]:
        key = name.strip().lower()
        if key in self.actions:
            return self.actions[key]
        try:
            return (controls.resolve(name),)
        except controls.UnknownControl:
            known = ", ".join(sorted(self.actions)) or "none"
            raise PlanError(
                f"unknown button or action {name!r}; profile actions are: {known}; "
                "raw names look like A, B, DPAD_UP, LS_RIGHT, KEY_W, KEY_SPACE, MOUSE_LEFT"
            ) from None


def _number(value: Any, where: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise PlanError(f"{where} must be a number")
    if not lo <= float(value) <= hi:
        raise PlanError(f"{where} must be between {lo:g} and {hi:g}, got {value}")
    return float(value)


def _stick(value: Any, where: str) -> tuple[float, float]:
    if not isinstance(value, Mapping):
        raise PlanError(f"{where} must be an object like {{\"x\": 1, \"y\": 0}}")
    extra = set(value) - {"x", "y"}
    if extra:
        raise PlanError(f"{where} has unknown fields {sorted(extra)}")
    return (
        _number(value.get("x", 0), f"{where}.x", -1, 1),
        _number(value.get("y", 0), f"{where}.y", -1, 1),
    )


_STEP_FIELDS = {
    "buttons", "left_stick", "right_stick", "left_trigger", "right_trigger",
    "mouse_move", "mouse_to", "duration_ms", "release_after", "type_text",
}


def parse_text(raw: Mapping[str, Any], index: int) -> list[Step]:
    """Expand ``{"type_text": "..."}`` into one key press per character."""
    where = f"steps[{index}]"
    if set(raw) != {"type_text"}:
        raise PlanError(f"{where}: a type_text step takes no other fields; put clicks and waits in their own steps")
    text = raw["type_text"]
    if not isinstance(text, str) or not text:
        raise PlanError(f"{where}.type_text must be non-empty text")
    if len(text) > MAX_TEXT:
        raise PlanError(f"{where}.type_text may be at most {MAX_TEXT} characters; split it over several turns")
    bad = sorted({c for c in text if c not in controls.TEXT_KEYS})
    if bad:
        raise PlanError(f"{where}.type_text has characters that cannot be typed: {''.join(bad)!r} "
                        "(only characters on a US keyboard)")
    steps = []
    for c in text:
        key, shift = controls.TEXT_KEYS[c]
        held = {controls.resolve("KEY_" + key)}
        if shift:
            held.add(controls.resolve("KEY_LEFTSHIFT"))
        steps.append(Step(controls=frozenset(held), duration_ms=TYPE_KEY_MS))
    return steps


def parse_step(raw: Any, bindings: Bindings, index: int) -> Step:
    where = f"steps[{index}]"
    if not isinstance(raw, Mapping):
        raise PlanError(f"{where} must be an object")
    extra = set(raw) - _STEP_FIELDS
    if extra:
        raise PlanError(f"{where} has unknown fields {sorted(extra)}")
    if "duration_ms" not in raw:
        raise PlanError(f"{where}.duration_ms is required")
    duration = int(_number(raw["duration_ms"], f"{where}.duration_ms", 1, MAX_STEP_MS))

    held: set[Control] = set()
    buttons = raw.get("buttons", [])
    if isinstance(buttons, str) or not isinstance(buttons, list):
        raise PlanError(f"{where}.buttons must be a list of names")
    for name in buttons:
        if not isinstance(name, str):
            raise PlanError(f"{where}.buttons must contain strings")
        held.update(bindings.lookup(name))

    mouse_dx = mouse_dy = 0
    if "mouse_move" in raw:
        move = raw["mouse_move"]
        if not isinstance(move, Mapping) or set(move) - {"dx", "dy"}:
            raise PlanError(f"{where}.mouse_move must be {{\"dx\": int, \"dy\": int}}")
        mouse_dx = int(round(_number(move.get("dx", 0), f"{where}.mouse_move.dx", -MAX_MOUSE, MAX_MOUSE)))
        mouse_dy = int(round(_number(move.get("dy", 0), f"{where}.mouse_move.dy", -MAX_MOUSE, MAX_MOUSE)))

    pointer = None
    if "mouse_to" in raw:
        to = raw["mouse_to"]
        if not isinstance(to, Mapping) or set(to) - {"x", "y"} or not {"x", "y"} <= set(to):
            raise PlanError(f"{where}.mouse_to must be {{\"x\": number, \"y\": number}} in screenshot pixels")
        pointer = (_number(to["x"], f"{where}.mouse_to.x", 0, 20000),
                   _number(to["y"], f"{where}.mouse_to.y", 0, 20000))

    release_after = raw.get("release_after", True)
    if not isinstance(release_after, bool):
        raise PlanError(f"{where}.release_after must be true or false")

    return Step(
        controls=frozenset(held),
        left_stick=_stick(raw["left_stick"], f"{where}.left_stick") if "left_stick" in raw else None,
        right_stick=_stick(raw["right_stick"], f"{where}.right_stick") if "right_stick" in raw else None,
        left_trigger=_number(raw.get("left_trigger", 0), f"{where}.left_trigger", 0, 1),
        right_trigger=_number(raw.get("right_trigger", 0), f"{where}.right_trigger", 0, 1),
        mouse_dx=mouse_dx,
        mouse_dy=mouse_dy,
        duration_ms=duration,
        release_after=release_after,
        pointer=pointer,
    )


def parse_plan(raw_steps: Any, bindings: Bindings | None = None, intent: str = "") -> Plan:
    bindings = bindings or Bindings()
    if not isinstance(raw_steps, list):
        raise PlanError("steps must be a list")
    if len(raw_steps) > MAX_STEPS:
        raise PlanError(f"a plan may have at most {MAX_STEPS} steps, got {len(raw_steps)}")
    steps: list[Step] = []
    for i, s in enumerate(raw_steps):
        if isinstance(s, Mapping) and "type_text" in s:
            steps.extend(parse_text(s, i))
        else:
            steps.append(parse_step(s, bindings, i))
    plan = Plan(tuple(steps), intent)
    if plan.duration_ms > MAX_PLAN_MS:
        raise PlanError(
            f"a plan may last at most {MAX_PLAN_MS} ms, this one lasts {plan.duration_ms} ms; "
            "act in shorter bursts and look again"
        )
    return plan


def describe(plan: Plan) -> str:
    """A compact one-line summary of a plan, for logs and the planner's history."""
    parts = []
    for s in plan.steps:
        bits = sorted(c.name for c in s.controls)
        if s.left_stick:
            bits.append(f"LS({s.left_stick[0]:+.2f},{s.left_stick[1]:+.2f})")
        if s.right_stick:
            bits.append(f"RS({s.right_stick[0]:+.2f},{s.right_stick[1]:+.2f})")
        if s.left_trigger:
            bits.append(f"LT{s.left_trigger:.2f}")
        if s.right_trigger:
            bits.append(f"RT{s.right_trigger:.2f}")
        if s.pointer:
            bits.append(f"to({s.pointer[0]:.0f},{s.pointer[1]:.0f})")
        if s.mouse_dx or s.mouse_dy:
            bits.append(f"mouse({s.mouse_dx:+d},{s.mouse_dy:+d})")
        hold = "" if s.release_after else " hold"
        parts.append(f"[{'+'.join(bits) or 'wait'} {s.duration_ms}ms{hold}]")
    return " ".join(parts) or "[no-op]"



@dataclass(frozen=True)
class PointerMap:
    """How screenshot pixels relate to the screen: the captured area and the image size."""

    left: int
    top: int
    width: int
    height: int
    image_width: int
    image_height: int


def map_pointer(plan: Plan, where: PointerMap | None) -> Plan:
    """Turn ``mouse_to`` positions (screenshot pixels) into screen pixels inside the window."""
    if not any(s.pointer for s in plan.steps):
        return plan
    if where is None:
        raise PlanError("mouse_to is not available here: the screen position of the game is unknown")
    from dataclasses import replace

    steps = []
    for i, s in enumerate(plan.steps):
        if s.pointer is not None:
            x, y = s.pointer
            if not (0 <= x < where.image_width and 0 <= y < where.image_height):
                raise PlanError(
                    f"steps[{i}].mouse_to ({x:g}, {y:g}) is outside the screenshot, which is "
                    f"{where.image_width}x{where.image_height} pixels"
                )
            sx = where.left + int((x + 0.5) * where.width / where.image_width)
            sy = where.top + int((y + 0.5) * where.height / where.image_height)
            s = replace(s, pointer=(sx, sy))
        steps.append(s)
    return Plan(tuple(steps), plan.intent)
