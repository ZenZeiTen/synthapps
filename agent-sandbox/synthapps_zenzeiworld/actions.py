"""Closed action vocabulary and strict parsing of agent requests.

Agents never call kernel methods. They send one small JSON document per
turn, and this module either turns it into a typed ``Action`` or rejects it.
If an action is not listed here, it does not exist in the world: there is no
"run code", "open socket" or "read file" verb to misuse.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Any

MAX_REQUEST_BYTES = 2048
MAX_TEXT_CHARS = 280
MAX_JSON_DEPTH = 3
MAX_MOVE_COMPONENT = 50.0

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

GESTURES = frozenset(
    {"wave", "nod", "shake_head", "point", "bow", "shrug", "thumbs_up", "sit", "stand"}
)


class ActionType(StrEnum):
    WAIT = "wait"
    MOVE = "move"
    SAY = "say"
    WHISPER = "whisper"
    GESTURE = "gesture"
    PICK_UP = "pick_up"
    DROP = "drop"
    OFFER = "offer"
    ACCEPT = "accept"
    DECLINE = "decline"
    USE = "use"


class ActionRejected(Exception):
    """Raised when a request is not a well-formed action.

    ``code`` is safe to show to the agent. ``detail`` is for the audit log
    only, so agents cannot use error messages to map the parser.
    """

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class Action:
    kind: ActionType
    params: Mapping[str, Any]


Validator = Callable[[Any], Any]


def _invalid(detail: str) -> ActionRejected:
    return ActionRejected("invalid_params", detail)


def _coordinate(value: Any) -> float:
    # bool is a subclass of int; "true" is not a distance.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _invalid("coordinate must be a number")
    number = float(value)
    if not math.isfinite(number) or abs(number) > MAX_MOVE_COMPONENT:
        raise _invalid("coordinate out of range")
    return number


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise _invalid("identifier malformed")
    return value


def _text(value: Any) -> str:
    if not isinstance(value, str):
        raise _invalid("text must be a string")
    text = unicodedata.normalize("NFC", value).strip()
    if not text or len(text) > MAX_TEXT_CHARS:
        raise _invalid("text empty or too long")
    # Control and format characters (zero-width joiners, bidi overrides,
    # soft hyphens...) are how hidden payloads ride inside innocent text.
    for char in text:
        if unicodedata.category(char) in ("Cc", "Cf"):
            raise _invalid("text contains control or format characters")
    return text


def _gesture(value: Any) -> str:
    if value not in GESTURES:
        raise _invalid("unknown gesture")
    return str(value)


_SCHEMAS: dict[ActionType, dict[str, Validator]] = {
    ActionType.WAIT: {},
    ActionType.MOVE: {"dx": _coordinate, "dy": _coordinate},
    ActionType.SAY: {"text": _text},
    ActionType.WHISPER: {"to": _identifier, "text": _text},
    ActionType.GESTURE: {"name": _gesture},
    ActionType.PICK_UP: {"object": _identifier},
    ActionType.DROP: {"object": _identifier},
    ActionType.OFFER: {"object": _identifier, "to": _identifier},
    ActionType.ACCEPT: {"offer": _identifier},
    ActionType.DECLINE: {"offer": _identifier},
    ActionType.USE: {"object": _identifier},
}


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            # Two parsers can disagree on which duplicate wins; refuse both.
            raise ActionRejected("invalid_request", f"duplicate key {key!r}")
        result[key] = value
    return result


def _reject_constant(name: str) -> Any:
    raise ActionRejected("invalid_request", f"non-finite constant {name}")


def _too_deep(document: Any, limit: int) -> bool:
    stack: list[tuple[Any, int]] = [(document, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > limit:
            return True
        if isinstance(node, dict):
            stack.extend((child, depth + 1) for child in node.values())
        elif isinstance(node, list):
            stack.extend((child, depth + 1) for child in node)
    return False


def parse_action(raw: object) -> Action:
    """Turn an untrusted request into an ``Action`` or raise ``ActionRejected``."""
    if isinstance(raw, str):
        try:
            data = raw.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise ActionRejected("invalid_encoding", "unencodable string") from exc
    elif isinstance(raw, bytes):
        data = raw
    else:
        raise ActionRejected("invalid_request", f"unsupported type {type(raw).__name__}")

    # Size check happens before any parsing work is spent on the payload.
    if len(data) > MAX_REQUEST_BYTES:
        raise ActionRejected("too_large", f"{len(data)} bytes")

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ActionRejected("invalid_encoding", "not utf-8") from exc

    try:
        document = json.loads(
            text,
            object_pairs_hook=_reject_duplicates,
            parse_constant=_reject_constant,
        )
    except ActionRejected:
        raise
    except (ValueError, RecursionError) as exc:
        raise ActionRejected("invalid_request", "not valid json") from exc

    if not isinstance(document, dict):
        raise ActionRejected("invalid_request", "top level must be an object")
    if _too_deep(document, MAX_JSON_DEPTH):
        raise ActionRejected("invalid_request", "nesting too deep")
    if not set(document) <= {"action", "params"} or "action" not in document:
        raise ActionRejected("invalid_request", f"unexpected keys {sorted(document)}")

    try:
        kind = ActionType(document["action"])
    except (ValueError, TypeError) as exc:
        raise ActionRejected("unknown_action", repr(document["action"])[:64]) from exc

    params = document.get("params", {})
    if not isinstance(params, dict):
        raise _invalid("params must be an object")

    schema = _SCHEMAS[kind]
    if set(params) != set(schema):
        raise _invalid(f"expected params {sorted(schema)}, got {sorted(params)}")

    clean = {name: validate(params[name]) for name, validate in schema.items()}
    return Action(kind=kind, params=MappingProxyType(clean))
