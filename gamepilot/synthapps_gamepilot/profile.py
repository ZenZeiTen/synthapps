"""Game profiles: one TOML file per game, saying how to see it and how to play it.

See ``profiles/*.toml`` for annotated examples. Every field has a default except
``name``; unknown fields are an error, so a typo cannot silently do nothing.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

from .plan import Bindings, PlanError


class ProfileError(ValueError):
    pass


@dataclass
class Game:
    title_contains: str = ""  # part of the window title; empty = whole screen
    launch: str | list[str] = ""  # "steam://rungameid/APPID", or a command as a list
    fps: float = 60.0


@dataclass
class Input:
    device: str = "gamepad"  # gamepad | kbm | both
    tick_hz: float = 120.0
    min_hold_frames: int = 2
    min_release_frames: int = 2
    focus_check: bool = True


@dataclass
class Pacing:
    mode: str = "realtime"  # realtime | retroarch | stepped (frozen between plans; needs a custom clock)
    pause_input: str = ""  # realtime only: tap this to pause while thinking, e.g. "START"
    pause_settle_ms: int = 300


@dataclass
class Watch:
    name: str
    address: int
    length: int = 1


@dataclass
class RetroArchCfg:
    host: str = "127.0.0.1"
    port: int = 55355
    watch: list[Watch] = field(default_factory=list)


@dataclass
class Agent:
    goal: str = "Play the game well and make progress."
    notes: str = ""
    model: str = "claude-opus-5-5"
    effort: str = "low"
    max_turns: int = 300
    max_minutes: float = 30.0
    max_cost_usd: float = 5.0
    frames_per_turn: int = 1
    frame_gap_ms: int = 150
    image_max_edge: int = 1024
    turns_per_conversation: int = 16
    allow_anticheat: bool = False


@dataclass
class Profile:
    name: str
    game: Game = field(default_factory=Game)
    input: Input = field(default_factory=Input)
    pacing: Pacing = field(default_factory=Pacing)
    retroarch: RetroArchCfg = field(default_factory=RetroArchCfg)
    agent: Agent = field(default_factory=Agent)
    bindings: dict[str, Any] = field(default_factory=dict)
    path: Path | None = None

    def resolved_bindings(self) -> Bindings:
        return Bindings.from_mapping(self.bindings)


def _build(cls: type, data: Any, where: str) -> Any:
    if not isinstance(data, dict):
        raise ProfileError(f"[{where}] must be a table")
    names = {f.name for f in fields(cls)}
    unknown = set(data) - names
    if unknown:
        raise ProfileError(f"[{where}] unknown keys: {', '.join(sorted(unknown))}")
    return cls(**data)


def load(path: str | Path) -> Profile:
    path = Path(path)
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ProfileError(f"{path}: {exc}") from None
    return from_dict(data, path)


def from_dict(data: dict[str, Any], path: Path | None = None) -> Profile:
    data = dict(data)
    if "name" not in data:
        raise ProfileError("a profile needs a name")
    allowed = {"name", "game", "input", "pacing", "retroarch", "agent", "bindings"}
    unknown = set(data) - allowed
    if unknown:
        raise ProfileError(f"unknown top-level keys: {', '.join(sorted(unknown))}")
    ra = dict(data.get("retroarch", {}))
    watches = [_build(Watch, w, "retroarch.watch") for w in ra.pop("watch", [])]
    p = Profile(
        name=str(data["name"]),
        game=_build(Game, data.get("game", {}), "game"),
        input=_build(Input, data.get("input", {}), "input"),
        pacing=_build(Pacing, data.get("pacing", {}), "pacing"),
        retroarch=_build(RetroArchCfg, ra, "retroarch"),
        agent=_build(Agent, data.get("agent", {}), "agent"),
        bindings=dict(data.get("bindings", {})),
        path=path,
    )
    p.retroarch.watch = watches
    validate(p)
    return p


def validate(p: Profile) -> None:
    if p.input.device not in ("gamepad", "kbm", "both"):
        raise ProfileError("input.device must be gamepad, kbm or both")
    if p.pacing.mode not in ("realtime", "retroarch", "stepped"):
        raise ProfileError("pacing.mode must be realtime, retroarch or stepped")
    if p.pacing.mode != "realtime" and p.pacing.pause_input:
        raise ProfileError("pacing.pause_input is only for realtime mode")
    if not 10 <= p.game.fps <= 360:
        raise ProfileError("game.fps must be between 10 and 360")
    if not 30 <= p.input.tick_hz <= 1000:
        raise ProfileError("input.tick_hz must be between 30 and 1000")
    if p.input.min_hold_frames < 1 or p.input.min_release_frames < 1:
        raise ProfileError("input.min_hold_frames and min_release_frames must be at least 1")
    if p.agent.effort not in ("low", "medium", "high", "xhigh", "max"):
        raise ProfileError("agent.effort must be low, medium, high, xhigh or max")
    if not 1 <= p.agent.frames_per_turn <= 4:
        raise ProfileError("agent.frames_per_turn must be 1..4")
    if p.agent.turns_per_conversation < 2:
        raise ProfileError("agent.turns_per_conversation must be at least 2")
    try:
        p.resolved_bindings()
    except PlanError as exc:
        raise ProfileError(f"[bindings] {exc}") from None
