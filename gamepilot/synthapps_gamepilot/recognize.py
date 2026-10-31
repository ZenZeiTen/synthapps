"""Automatic setup: find the game window, recognize the game, write its settings file.

1. The operating system lists the open windows with the program that owns each.
   Windows that are clearly not games (browsers, terminals, Explorer, launchers)
   are skipped.
2. Each remaining window is brought to the front for a moment and photographed.
3. Claude sees the photographs, titles and program names in one request, says
   which window is the game and which game it is, and suggests a device, pacing,
   button layout and notes from what it knows about that game.
4. The answer is checked like a hand-written settings file (every control name
   must exist, the title part must really be in the window title) and written out
   as a normal TOML file the player can read and edit.

Claude's button layout comes from its knowledge of the game's default controls,
so the file says so and asks the player to compare it with the game's menu.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import controls
from .claude import create_message, get, usage_numbers
from .imaging import Frame, encode_for_model
from .window import WindowInfo

THUMB_EDGE = 768
MAX_CANDIDATES = 6

SYSTEM = """You help set up an agent that plays PC and emulated games with a virtual controller or keyboard and mouse.
You receive screenshots of the windows open on the player's computer, each with its title and the program that owns it.
Decide which window is a game, and which game it is. Then call the identify_game tool once.

Rules:
- A game window shows a game: a title screen, a menu, or gameplay. Launchers (Steam, Epic), stores, browsers, chat and video players are not games, even when they show a game's picture.
- An emulator (RetroArch, Dolphin, PCSX2, PPSSPP, DuckStation, Ryujinx and others) running a game counts as the game. Name the game it runs, and the emulator.
- If no window is a game, set game_window to -1.
- title_contains must be a short part of that window's exact title that other windows are unlikely to have.
- Suggest bindings only for controls you are confident are the game's defaults. Fewer correct bindings are better than many guesses. Use only these control names: {names}.
- pacing: "waits" if the game waits for the player (turn-based, puzzle, card, visual novel, menus), "realtime" if it keeps moving.
- pause_input: for a realtime game, the control that pauses and unpauses it, if you know it; otherwise an empty string."""

TOOL = {
    "name": "identify_game",
    "description": "Report which window is the game, which game it is, and how to play it.",
    "input_schema": {
        "type": "object",
        "properties": {
            "game_window": {"type": "integer", "description": "Index of the game window, or -1 if none."},
            "game": {"type": "string", "description": "The game's name."},
            "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
            "emulator": {"type": "string", "description": "Emulator and system, e.g. 'RetroArch (SNES)'; empty if none."},
            "title_contains": {"type": "string"},
            "device": {"type": "string", "enum": ["gamepad", "kbm"]},
            "pacing": {"type": "string", "enum": ["waits", "realtime"]},
            "pause_input": {"type": "string"},
            "bindings": {
                "type": "object",
                "description": "Action name (letters, digits, underscores) -> control name.",
                "additionalProperties": {"type": "string"},
            },
            "notes": {"type": "string", "description": "What the player agent should know: controls, objectives, what to avoid."},
            "goal": {"type": "string", "description": "A concrete first goal from what is on screen."},
            "reasoning": {"type": "string", "description": "One or two sentences on how you recognized it."},
        },
        "required": ["game_window", "game", "confidence", "title_contains", "device", "pacing",
                     "bindings", "notes", "goal"],
        "additionalProperties": False,
    },
}


class RecognitionError(RuntimeError):
    pass


@dataclass
class Recognition:
    window: WindowInfo
    game: str
    confidence: str
    emulator: str
    title_contains: str
    device: str
    pacing: str
    pause_input: str
    bindings: dict[str, str | list[str]]
    notes: str
    goal: str
    reasoning: str = ""
    dropped: list[str] = field(default_factory=list)  # suggestions that failed validation


def photograph(windows: list[WindowInfo], activate: Callable[[WindowInfo], bool],
               grab: Callable[[WindowInfo], Frame], settle_s: float = 0.4,
               sleep: Callable[[float], None] = time.sleep) -> list[Frame | None]:
    """Bring each window to the front for a moment and photograph it."""
    frames: list[Frame | None] = []
    for w in windows:
        try:
            activate(w)
            sleep(settle_s)
            frames.append(grab(w))
        except Exception:  # noqa: BLE001 - one unphotographable window must not stop setup
            frames.append(None)
    return frames


def _content(windows: list[WindowInfo], frames: list[Frame | None], goal_hint: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for i, (w, f) in enumerate(zip(windows, frames, strict=True)):
        blocks.append({"type": "text", "text": (
            f"Window {i}: title {w.title!r}, program {w.process or 'unknown'!r}, "
            f"{w.rect.width}x{w.rect.height} pixels" + ("" if f else " (could not be photographed)"))})
        if f is not None:
            media, data = encode_for_model(f, THUMB_EDGE)
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
    ask = "Which window is the game? Call identify_game."
    if goal_hint:
        ask += f" The player's goal: {goal_hint}"
    blocks.append({"type": "text", "text": ask})
    return blocks


def identify(
    client: Any,
    windows: list[WindowInfo],
    frames: list[Frame | None],
    *,
    model: str = "claude-opus-5-5",
    effort: str = "low",
    goal_hint: str = "",
    on_usage: Callable[[int, int, int, int], None] | None = None,
    log: Callable[[str], None] = print,
) -> Recognition | None:
    """Ask Claude which window is the game. Returns None when no window is a game."""
    if not windows:
        return None
    messages: list[dict[str, Any]] = [{"role": "user", "content": _content(windows, frames, goal_hint)}]
    system = SYSTEM.format(names=", ".join(controls.all_names()))
    for _ in range(2):
        response = create_message(client, model=model, effort=effort, system=system, tools=[TOOL],
                                  messages=messages, max_tokens=8000, log=log)
        if on_usage:
            on_usage(*usage_numbers(response))
        if get(response, "stop_reason") == "refusal":
            raise RecognitionError("Claude declined to identify the windows")
        content = get(response, "content", [])
        calls = [b for b in content if get(b, "type") == "tool_use" and get(b, "name") == "identify_game"]
        if calls:
            data = get(calls[0], "input") or {}
            if isinstance(data, str):
                data = json.loads(data)
            return _validate(data, windows)
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": [
            *({"type": "tool_result", "tool_use_id": get(b, "id"), "is_error": True,
               "content": "Unknown tool."} for b in content if get(b, "type") == "tool_use"),
            {"type": "text", "text": "Call the identify_game tool now."}]})
    raise RecognitionError("Claude did not report a result")


def _validate(data: dict[str, Any], windows: list[WindowInfo]) -> Recognition | None:
    index = data.get("game_window", -1)
    if not isinstance(index, int) or not 0 <= index < len(windows):
        return None
    window = windows[index]
    dropped: list[str] = []

    title_part = str(data.get("title_contains", "")).strip()
    if not title_part or title_part.lower() not in window.title.lower():
        if title_part:
            dropped.append(f"title_contains {title_part!r} is not in the window title; using the full title")
        title_part = window.title

    bindings: dict[str, str | list[str]] = {}
    raw = data.get("bindings") if isinstance(data.get("bindings"), dict) else {}
    for action, target in raw.items():
        key = re.sub(r"[^a-z0-9_]+", "_", str(action).strip().lower()).strip("_")
        names = target if isinstance(target, list) else [target]
        try:
            if not key or not names:
                raise controls.UnknownControl("empty")
            resolved = [controls.resolve(str(n)).name for n in names]
        except controls.UnknownControl:
            dropped.append(f"binding {action!r} = {target!r}")
            continue
        bindings[key] = resolved[0] if len(resolved) == 1 else resolved

    pause = str(data.get("pause_input", "")).strip()
    if pause:
        try:
            pause = controls.resolve(pause).name
        except controls.UnknownControl:
            dropped.append(f"pause_input {pause!r}")
            pause = ""

    device = data.get("device") if data.get("device") in ("gamepad", "kbm") else "gamepad"
    pacing = data.get("pacing") if data.get("pacing") in ("waits", "realtime") else "realtime"
    return Recognition(
        window=window,
        game=str(data.get("game", "")).strip() or window.title,
        confidence=data.get("confidence") if data.get("confidence") in ("low", "medium", "high") else "low",
        emulator=str(data.get("emulator", "")).strip(),
        title_contains=title_part,
        device=device,
        pacing=pacing,
        pause_input=pause if pacing == "realtime" else "",
        bindings=bindings,
        notes=str(data.get("notes", "")).strip(),
        goal=str(data.get("goal", "")).strip() or "Make progress in the game.",
        reasoning=str(data.get("reasoning", "")).strip(),
        dropped=dropped,
    )


# --- writing the settings file ------------------------------------------------------

def _q(text: str) -> str:
    """A TOML basic string. JSON escapes are valid TOML escapes."""
    return json.dumps(text, ensure_ascii=False)


def _key(name: str) -> str:
    return name if re.fullmatch(r"[A-Za-z0-9_-]+", name) else _q(name)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:40] or "game"


def profile_text(r: Recognition, *, retroarch: bool = False, model: str = "claude-opus-5-5",
                 max_cost_usd: float = 2.0) -> str:
    """The settings file for a recognized game, as TOML text with explanatory comments."""
    device = r.device
    if retroarch:
        device = "gamepad"
    lines = [
        "# Written by: gamepilot setup (automatic game detection).",
        f"# Claude recognized this game with {r.confidence} confidence"
        + (f": {r.reasoning}" if r.reasoning else "."),
        "# Check the [bindings] against the game's controls menu: they come from Claude's knowledge",
        "# of the game's default controls, not from your settings. Edit anything; see SETTINGS.md.",
        "",
        f"name = {_q(r.game)}",
        "",
        "[game]",
        f"title_contains = {_q(r.title_contains)}",
        "fps = 60",
        "",
        "[input]",
        f"device = {_q(device)}",
        "focus_check = true",
        "",
        "[pacing]",
    ]
    if retroarch:
        lines.append('mode = "retroarch"    # paused while Claude thinks; plans run frame by frame')
    elif r.pacing == "waits":
        lines.append('mode = "realtime"     # the game waits for the player, so no pause is needed')
    else:
        lines.append('mode = "realtime"')
        if r.pause_input:
            lines.append(f"pause_input = {_q(r.pause_input)}    # pauses the game while Claude thinks")
        else:
            lines.append('# pause_input = "START"    # set this to the game\'s pause button if it has one')
    lines += ["", "[bindings]"]
    if r.bindings:
        for action, target in r.bindings.items():
            value = _q(target) if isinstance(target, str) else "[" + ", ".join(_q(t) for t in target) + "]"
            lines.append(f"{_key(action)} = {value}")
    else:
        lines.append("# none suggested: Claude will use raw control names")
    notes = r.notes
    if r.emulator:
        notes = f"Running in {r.emulator}.\n{notes}".strip()
    lines += [
        "",
        "[agent]",
        f"goal = {_q(r.goal)}",
        f"notes = {_q(notes)}",
        f"model = {_q(model)}",
        'effort = "low"',
        "max_turns = 200",
        "max_minutes = 30",
        f"max_cost_usd = {max_cost_usd:g}",
        "allow_anticheat = false",
        "",
    ]
    return "\n".join(lines)


def write_profile(r: Recognition, path: Path, **kwargs: Any) -> Path:
    from .profile import from_dict

    text = profile_text(r, **kwargs)
    import tomllib

    from_dict(tomllib.loads(text))  # the file must load exactly like a hand-written one
    path.write_text(text, encoding="utf-8")
    return path
