"""The brain: Claude looks at the game and decides what to press next.

Each turn the planner sends the newest screenshot(s), the result of the last plan
and any emulator memory readings, and Claude answers with one call to the ``act``
tool: what it sees, what it is trying to do, a short input plan, and optionally
updated notes. The conversation only ever grows by appending (thinking blocks
stay valid); after ``turns_per_conversation`` turns it starts a fresh one that
carries over the notes and a short log, which keeps cost and latency flat over a
long session.

Any planner (a scripted bot, a different model) can be used as long as it has a
``decide(observation) -> Decision`` method.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from . import controls
from .imaging import Frame, encode_for_model
from .plan import MAX_PLAN_MS, MAX_STEP_MS, MAX_STEPS
from .profile import Profile


@dataclass
class Observation:
    frames: list[Frame]
    last_result: str  # what happened with the previous plan, or why it was rejected
    turn: int
    memory_readings: dict[str, str] = field(default_factory=dict)
    last_result_is_error: bool = False


@dataclass
class Decision:
    steps: list[Any]
    intent: str = ""
    observation: str = ""
    memory: str | None = None
    status: str = "playing"  # playing | done | stuck | refused
    emulator: str = "none"  # none | save_state | load_state
    raw: dict[str, Any] = field(default_factory=dict)


class Planner(Protocol):
    def decide(self, obs: Observation) -> Decision: ...


# --- the act tool ---------------------------------------------------------------------

_STICK = {
    "type": "object",
    "properties": {"x": {"type": "number", "minimum": -1, "maximum": 1},
                   "y": {"type": "number", "minimum": -1, "maximum": 1}},
    "required": ["x", "y"],
    "additionalProperties": False,
}

STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "buttons": {"type": "array", "items": {"type": "string"},
                    "description": "Inputs held during this step: action names from the profile or raw controls."},
        "left_stick": _STICK,
        "right_stick": _STICK,
        "left_trigger": {"type": "number", "minimum": 0, "maximum": 1},
        "right_trigger": {"type": "number", "minimum": 0, "maximum": 1},
        "mouse_move": {
            "type": "object",
            "properties": {"dx": {"type": "integer"}, "dy": {"type": "integer"}},
            "required": ["dx", "dy"],
            "additionalProperties": False,
            "description": "Relative mouse movement in pixels, spread evenly over the step.",
        },
        "duration_ms": {"type": "integer", "minimum": 1, "maximum": MAX_STEP_MS},
        "release_after": {"type": "boolean",
                          "description": "Default true. false keeps inputs held into the next step without a gap."},
    },
    "required": ["duration_ms"],
    "additionalProperties": False,
}


def act_tool(with_emulator: bool) -> dict[str, Any]:
    props: dict[str, Any] = {
        "observation": {"type": "string", "description": "What you see on screen now, briefly."},
        "intent": {"type": "string", "description": "What this plan should achieve."},
        "steps": {"type": "array", "items": STEP_SCHEMA, "maxItems": MAX_STEPS},
        "memory": {"type": "string",
                   "description": "Optional. Replaces your notes: progress, map, what works, what failed."},
        "status": {"type": "string", "enum": ["playing", "done", "stuck"]},
    }
    required = ["observation", "intent", "steps", "status"]
    if with_emulator:
        props["emulator"] = {
            "type": "string", "enum": ["none", "save_state", "load_state"],
            "description": "save_state before a risky moment; load_state to retry after a failure. "
                           "Runs before the steps.",
        }
    return {
        "name": "act",
        "description": "Send inputs to the game. Call this exactly once per turn.",
        "input_schema": {"type": "object", "properties": props, "required": required,
                         "additionalProperties": False},
    }


def system_prompt(profile: Profile) -> str:
    stepped = profile.pacing.mode in ("retroarch", "stepped")
    pacing = (
        "The game is frozen while you think and only runs while your plan runs, one frame at a "
        "time, so timing is exact. Precise, longer plans are fine."
        if stepped else
        "The game keeps running while you think (that takes seconds), unless it pauses itself. "
        "Prefer short plans (about 0.3 to 2 seconds) and end in a safe position, then look again."
    )
    bindings = "\n".join(f"- {k}: {v}" for k, v in profile.bindings.items()) or "- (none; use raw controls)"
    device = {"gamepad": "a virtual Xbox controller", "kbm": "a virtual keyboard and mouse",
              "both": "a virtual Xbox controller plus a virtual keyboard and mouse"}[profile.input.device]
    return f"""You are playing the video game "{profile.name}" with {device}.

Goal: {profile.agent.goal}

How each turn works:
1. You receive the newest screenshot(s) of the game (oldest first when there are several) and a report on your previous plan.
2. You answer by calling the act tool once: describe what you see, say what you intend, and give a list of input steps.
3. The steps run in order. Each step holds its buttons, stick and trigger positions for duration_ms, then the next step starts. Then you see the result.

{pacing}

Controls:
- Gamepad buttons: A B X Y LB RB BACK START LS RS DPAD_UP DPAD_DOWN DPAD_LEFT DPAD_RIGHT. Triggers: left_trigger/right_trigger 0..1. Sticks: left_stick/right_stick with x -1 (left) to 1 (right) and y -1 (down) to 1 (up); LS_LEFT/LS_RIGHT/LS_UP/LS_DOWN (and RS_*) are full tilts usable as buttons.
- Keys: KEY_ followed by the key name, e.g. KEY_W KEY_SPACE KEY_ENTER KEY_ESC KEY_LEFTSHIFT KEY_UP. Mouse: MOUSE_LEFT MOUSE_RIGHT MOUSE_MIDDLE, and mouse_move {{dx, dy}} in pixels (relative, turns the camera in most 3D games).
- Prefer these action names from the profile:
{bindings}
- Every press lasts at least {profile.input.min_hold_frames} frames. To press the same button twice, put it in two steps; it is released briefly in between. To keep holding across steps, set release_after to false.
- A step with no inputs is a wait. Limits: {MAX_STEPS} steps and {MAX_PLAN_MS // 1000} seconds per plan.
- Do not press GUIDE: it opens the Steam or system overlay.

Game notes:
{profile.agent.notes or "(none)"}

Playing well:
- Check the new screenshot against your intent. If an action did not work twice, try something different (other timing, other approach) instead of repeating it.
- Keep your notes up to date with the memory field: where you are, what you learned about the controls and the level, what failed. Your notes are all you keep when the conversation is renewed.
- Use status "done" only when the goal is clearly reached, and "stuck" if you have tried many different things without progress."""


def _image_blocks(frames: list[Frame], max_edge: int) -> list[dict[str, Any]]:
    blocks = []
    for f in frames:
        media, data = encode_for_model(f, max_edge)
        blocks.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
    return blocks


def _status_text(obs: Observation, memory: str) -> str:
    lines = [f"Turn {obs.turn}."]
    if obs.memory_readings:
        lines.append("Game memory: " + ", ".join(f"{k}={v}" for k, v in obs.memory_readings.items()))
    lines.append(f"Your notes: {memory or '(empty)'}")
    lines.append("Call the act tool.")
    return "\n".join(lines)


def _ignored(tool_use_id: str) -> dict[str, Any]:
    return {"type": "tool_result", "tool_use_id": tool_use_id, "is_error": True,
            "content": "Ignored: only one act call per turn is used."}


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


class ClaudePlanner:
    """Plans with the Claude API (``pip install anthropic``; reads ANTHROPIC_API_KEY)."""

    BETAS = ["server-side-fallback-2026-07-01"]

    def __init__(
        self,
        profile: Profile,
        client: Any = None,
        on_usage: Callable[[int, int, int, int], None] | None = None,
        log: Callable[[str], None] = print,
        sleep: Callable[[float], None] = time.sleep,
        use_fallbacks: bool = True,
    ) -> None:
        if client is None:
            try:
                import anthropic  # type: ignore[import-not-found]
            except ImportError as exc:
                raise RuntimeError("the Claude planner needs the SDK: pip install anthropic") from exc
            client = anthropic.Anthropic()
        self.client = client
        self.profile = profile
        self.on_usage = on_usage or (lambda *a: None)
        self.log = log
        self.sleep = sleep
        self.use_fallbacks = use_fallbacks
        self.tool = act_tool(profile.pacing.mode == "retroarch")
        self.system = system_prompt(profile)
        self.memory = ""
        self.history: list[str] = []  # one line per turn, carried into new conversations
        self.messages: list[dict[str, Any]] = []
        self.pending_tool_ids: list[str] = []
        self.turns_in_conversation = 0

    # --- conversation ---------------------------------------------------------
    def _new_conversation(self) -> None:
        self.messages = []
        self.pending_tool_ids = []
        self.turns_in_conversation = 0

    def _user_content(self, obs: Observation) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = []
        if self.pending_tool_ids:
            first, *extra = self.pending_tool_ids
            content.append({"type": "tool_result", "tool_use_id": first,
                            "content": obs.last_result, "is_error": obs.last_result_is_error})
            content.extend(_ignored(tid) for tid in extra)
        else:
            intro = "The game is on screen. Start playing."
            if self.history:
                intro = ("This conversation continues an earlier session. Recent turns:\n"
                         + "\n".join(self.history[-8:]))
            content.append({"type": "text", "text": intro + f"\nLast result: {obs.last_result}"})
        content.extend(_image_blocks(obs.frames, self.profile.agent.image_max_edge))
        content.append({"type": "text", "text": _status_text(obs, self.memory)})
        return content

    def _request(self) -> Any:
        # Newer request fields go in extra_body: older SDK releases reject them as keyword
        # arguments, but every release merges extra_body into the request as is.
        body: dict[str, Any] = {
            "output_config": {"effort": self.profile.agent.effort},
            "cache_control": {"type": "ephemeral"},
        }
        kwargs: dict[str, Any] = {}
        if self.use_fallbacks:
            # On a safety decline, the API re-runs the turn on Anthropic's recommended model.
            kwargs["betas"] = self.BETAS
            body["fallbacks"] = "default"
        return self._with_retries(lambda: self.client.beta.messages.create(
            model=self.profile.agent.model,
            max_tokens=16000,
            system=[{"type": "text", "text": self.system}],
            tools=[self.tool],
            tool_choice={"type": "auto"},
            messages=self.messages,
            extra_body=body,
            **kwargs,
        ))

    def _with_retries(self, call: Callable[[], Any]) -> Any:
        try:
            import anthropic  # type: ignore[import-not-found]

            names = ("RateLimitError", "APIConnectionError", "InternalServerError", "OverloadedError")
            retryable: tuple[type[BaseException], ...] = tuple(
                getattr(anthropic, n) for n in names if hasattr(anthropic, n))
        except ImportError:
            retryable = ()
        for attempt in range(4):
            try:
                return call()
            except retryable as exc:  # the SDK already retried twice
                if attempt == 3:
                    raise
                wait = 5.0 * (attempt + 1)
                self.log(f"API busy or unreachable ({type(exc).__name__}); retrying in {wait:.0f}s")
                self.sleep(wait)
        raise AssertionError("unreachable")

    # --- the turn -------------------------------------------------------------
    def decide(self, obs: Observation) -> Decision:
        if self.turns_in_conversation >= self.profile.agent.turns_per_conversation:
            self._new_conversation()
        self.messages.append({"role": "user", "content": self._user_content(obs)})
        for _ in range(3):
            response = self._request()
            usage = _get(response, "usage")
            self.on_usage(
                _get(usage, "input_tokens", 0) or 0, _get(usage, "output_tokens", 0) or 0,
                _get(usage, "cache_read_input_tokens", 0) or 0,
                _get(usage, "cache_creation_input_tokens", 0) or 0,
            )
            content = _get(response, "content", [])
            self.messages.append({"role": "assistant", "content": content})
            stop = _get(response, "stop_reason")
            if stop == "refusal":
                details = _get(response, "stop_details")
                why = _get(details, "explanation", "") if details else ""
                self._new_conversation()
                return Decision(steps=[], status="refused", observation=why or "the model declined")
            uses = [b for b in content if _get(b, "type") == "tool_use"]
            acts = [b for b in uses if _get(b, "name") == "act"]
            if acts:
                # Only the first act call runs; any other tool_use still gets a result next turn.
                self.pending_tool_ids = [_get(acts[0], "id")] + [
                    _get(b, "id") for b in uses if b is not acts[0]]
                self.turns_in_conversation += 1
                return self._decision(_get(acts[0], "input") or {})
            # No act call (text only, or cut off): ask again, appending only.
            nudge = "You must call the act tool to send inputs. Call it now."
            if stop == "max_tokens":
                nudge = "Your answer was cut off. Call the act tool now with a short plan."
            reply = [_ignored(_get(b, "id")) for b in uses]
            reply.append({"type": "text", "text": nudge})
            self.messages.append({"role": "user", "content": reply})
        self._new_conversation()
        return Decision(steps=[], status="stuck", observation="the model did not call the act tool")

    def _decision(self, data: Any) -> Decision:
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                data = {}
        if not isinstance(data, dict):
            data = {}
        if isinstance(data.get("memory"), str) and data["memory"].strip():
            self.memory = data["memory"].strip()[:4000]
        decision = Decision(
            steps=data.get("steps") if isinstance(data.get("steps"), list) else [],
            intent=str(data.get("intent", ""))[:500],
            observation=str(data.get("observation", ""))[:1000],
            memory=data.get("memory") if isinstance(data.get("memory"), str) else None,
            status=data.get("status") if data.get("status") in ("playing", "done", "stuck") else "playing",
            emulator=data.get("emulator") if data.get("emulator") in ("save_state", "load_state") else "none",
            raw=data,
        )
        self.history.append(f"- saw: {decision.observation[:160]} | did: {decision.intent[:160]}")
        return decision


def known_controls_hint() -> str:
    return ", ".join(controls.all_names())
