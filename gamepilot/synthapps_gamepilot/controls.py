"""The control vocabulary: every gamepad button, stick, trigger, key and mouse button
the agent can use, with the codes each operating system needs.

Names are case-insensitive. Keys may be written with or without the ``KEY_`` prefix
("W" and "KEY_W" are the same key). Gamepad names follow the Xbox layout, because
that is the layout Steam, SDL and almost every emulator recognise for a virtual pad.

Stick convention: x is -1 (left) .. +1 (right) and y is -1 (down) .. +1 (up), the
same as XInput. Backends that use the opposite y direction convert it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Kind(Enum):
    PAD_BUTTON = "pad_button"
    KEY = "key"
    MOUSE_BUTTON = "mouse_button"
    STICK_DIRECTION = "stick_direction"  # a digital alias for a fully deflected stick


@dataclass(frozen=True)
class Control:
    name: str
    kind: Kind


# --- Gamepad -----------------------------------------------------------------------

#: name -> (XUSB flag name used by ViGEm/vgamepad, Linux evdev code as the xpad driver reports it)
PAD_BUTTONS: dict[str, tuple[str, int]] = {
    "A": ("XUSB_GAMEPAD_A", 0x130),  # BTN_A / BTN_SOUTH
    "B": ("XUSB_GAMEPAD_B", 0x131),  # BTN_B / BTN_EAST
    "X": ("XUSB_GAMEPAD_X", 0x133),  # BTN_X (xpad maps the Xbox X button here)
    "Y": ("XUSB_GAMEPAD_Y", 0x134),  # BTN_Y
    "LB": ("XUSB_GAMEPAD_LEFT_SHOULDER", 0x136),  # BTN_TL
    "RB": ("XUSB_GAMEPAD_RIGHT_SHOULDER", 0x137),  # BTN_TR
    "BACK": ("XUSB_GAMEPAD_BACK", 0x13A),  # BTN_SELECT
    "START": ("XUSB_GAMEPAD_START", 0x13B),  # BTN_START
    "GUIDE": ("XUSB_GAMEPAD_GUIDE", 0x13C),  # BTN_MODE
    "LS": ("XUSB_GAMEPAD_LEFT_THUMB", 0x13D),  # BTN_THUMBL (left stick click)
    "RS": ("XUSB_GAMEPAD_RIGHT_THUMB", 0x13E),  # BTN_THUMBR
    # The d-pad is a hat on Linux (ABS_HAT0X/Y); the code here is unused for it.
    "DPAD_UP": ("XUSB_GAMEPAD_DPAD_UP", 0),
    "DPAD_DOWN": ("XUSB_GAMEPAD_DPAD_DOWN", 0),
    "DPAD_LEFT": ("XUSB_GAMEPAD_DPAD_LEFT", 0),
    "DPAD_RIGHT": ("XUSB_GAMEPAD_DPAD_RIGHT", 0),
}

DPAD = ("DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT")

PAD_ALIASES = {
    "L1": "LB",
    "R1": "RB",
    "SELECT": "BACK",
    "VIEW": "BACK",
    "MENU": "START",
    "HOME": "GUIDE",
    "L2": "LT",
    "R2": "RT",
    "L3": "LS",
    "R3": "RS",
    "UP": "DPAD_UP",
    "DOWN": "DPAD_DOWN",
    "LEFT": "DPAD_LEFT",
    "RIGHT": "DPAD_RIGHT",
}

#: Digital names for a fully deflected stick or fully pulled trigger: name -> (axis, x, y).
#: They are not buttons: the executor turns them into analog values.
STICK_DIRECTIONS: dict[str, tuple[str, float, float]] = {
    "LT": ("left_trigger", 1.0, 0.0),
    "RT": ("right_trigger", 1.0, 0.0),
    "LS_UP": ("left", 0.0, 1.0),
    "LS_DOWN": ("left", 0.0, -1.0),
    "LS_LEFT": ("left", -1.0, 0.0),
    "LS_RIGHT": ("left", 1.0, 0.0),
    "RS_UP": ("right", 0.0, 1.0),
    "RS_DOWN": ("right", 0.0, -1.0),
    "RS_LEFT": ("right", -1.0, 0.0),
    "RS_RIGHT": ("right", 1.0, 0.0),
}

# --- Keyboard -----------------------------------------------------------------------

#: name -> (PC set-1 scan code, needs the E0 "extended" prefix, Linux evdev KEY_* code)
#: Games read scan codes (DirectInput, raw input), so the Windows backend sends these,
#: not virtual-key codes. For the base block the Linux code equals the scan code.
KEYS: dict[str, tuple[int, bool, int]] = {}


def _base(name: str, code: int) -> None:
    KEYS[name] = (code, False, code)


for _i, _n in enumerate("1234567890"):
    _base(_n, 0x02 + _i)
for _row, _start in (("QWERTYUIOP", 0x10), ("ASDFGHJKL", 0x1E), ("ZXCVBNM", 0x2C)):
    for _i, _n in enumerate(_row):
        _base(_n, _start + _i)
for _i in range(10):
    _base(f"F{_i + 1}", 0x3B + _i)
for _name, _code in {
    "ESC": 0x01, "MINUS": 0x0C, "EQUAL": 0x0D, "BACKSPACE": 0x0E, "TAB": 0x0F,
    "LEFTBRACE": 0x1A, "RIGHTBRACE": 0x1B, "ENTER": 0x1C, "LEFTCTRL": 0x1D,
    "SEMICOLON": 0x27, "APOSTROPHE": 0x28, "GRAVE": 0x29, "LEFTSHIFT": 0x2A,
    "BACKSLASH": 0x2B, "COMMA": 0x33, "DOT": 0x34, "SLASH": 0x35, "RIGHTSHIFT": 0x36,
    "LEFTALT": 0x38, "SPACE": 0x39, "CAPSLOCK": 0x3A, "F11": 0x57, "F12": 0x58,
}.items():
    _base(_name, _code)
for _name, (_code, _linux) in {
    "RIGHTCTRL": (0x1D, 97), "RIGHTALT": (0x38, 100), "HOME": (0x47, 102),
    "UP": (0x48, 103), "PAGEUP": (0x49, 104), "LEFT": (0x4B, 105), "RIGHT": (0x4D, 106),
    "END": (0x4F, 107), "DOWN": (0x50, 108), "PAGEDOWN": (0x51, 109),
    "INSERT": (0x52, 110), "DELETE": (0x53, 111),
}.items():
    KEYS[_name] = (_code, True, _linux)

KEY_ALIASES = {
    "ESCAPE": "ESC", "RETURN": "ENTER", "SHIFT": "LEFTSHIFT", "CTRL": "LEFTCTRL",
    "CONTROL": "LEFTCTRL", "ALT": "LEFTALT", "LSHIFT": "LEFTSHIFT", "RSHIFT": "RIGHTSHIFT",
    "LCTRL": "LEFTCTRL", "RCTRL": "RIGHTCTRL", "LALT": "LEFTALT", "RALT": "RIGHTALT",
    "PERIOD": "DOT", "PGUP": "PAGEUP", "PGDN": "PAGEDOWN", "DEL": "DELETE",
    "ARROWUP": "UP", "ARROWDOWN": "DOWN", "ARROWLEFT": "LEFT", "ARROWRIGHT": "RIGHT",
}

# --- Mouse --------------------------------------------------------------------------

#: name -> (Windows (down flag, up flag, mouseData), Linux evdev BTN_* code)
MOUSE_BUTTONS: dict[str, tuple[tuple[int, int, int], int]] = {
    "MOUSE_LEFT": ((0x0002, 0x0004, 0), 0x110),
    "MOUSE_RIGHT": ((0x0008, 0x0010, 0), 0x111),
    "MOUSE_MIDDLE": ((0x0020, 0x0040, 0), 0x112),
    "MOUSE_BACK": ((0x0080, 0x0100, 1), 0x113),  # XBUTTON1 / BTN_SIDE
    "MOUSE_FORWARD": ((0x0080, 0x0100, 2), 0x114),  # XBUTTON2 / BTN_EXTRA
}


MOUSE_ALIASES = {
    "LMB": "MOUSE_LEFT", "MOUSE1": "MOUSE_LEFT", "LEFTCLICK": "MOUSE_LEFT", "LEFT_CLICK": "MOUSE_LEFT",
    "RMB": "MOUSE_RIGHT", "MOUSE2": "MOUSE_RIGHT", "RIGHTCLICK": "MOUSE_RIGHT", "RIGHT_CLICK": "MOUSE_RIGHT",
    "MMB": "MOUSE_MIDDLE", "MOUSE3": "MOUSE_MIDDLE", "MIDDLECLICK": "MOUSE_MIDDLE",
    "MOUSE4": "MOUSE_BACK", "MOUSE5": "MOUSE_FORWARD",
}


class UnknownControl(ValueError):
    pass


def _suggest(raw: str) -> str:
    """ ' (did you mean ...?)' for a misspelled control name, or ''."""
    import difflib

    names = {n: n for n in all_names()}
    names.update({n[4:]: n for n in all_names() if n.startswith("KEY_")})
    names.update({a: PAD_ALIASES[a] for a in PAD_ALIASES})
    close = difflib.get_close_matches(raw, list(names), n=3, cutoff=0.6)
    picks = list(dict.fromkeys(names[c] for c in close))
    return f" (did you mean {' or '.join(picks)}?)" if picks else ""


def resolve(name: str) -> Control:
    """Turn a written control name into a canonical :class:`Control`.

    Ambiguous words: "UP"/"LEFT"/... mean the d-pad; write "KEY_UP" for the arrow key.
    """
    raw = name.strip().upper().replace(" ", "_").replace("-", "_")
    if not raw:
        raise UnknownControl("empty control name")
    if raw.startswith("KEY_"):
        key = raw[4:]
        key = KEY_ALIASES.get(key, key)
        if key in KEYS:
            return Control("KEY_" + key, Kind.KEY)
        raise UnknownControl(f"unknown key {name!r}{_suggest(raw)}")
    raw = MOUSE_ALIASES.get(raw, raw)
    if raw in MOUSE_BUTTONS:
        return Control(raw, Kind.MOUSE_BUTTON)
    pad = PAD_ALIASES.get(raw, raw)
    if pad in STICK_DIRECTIONS:
        return Control(pad, Kind.STICK_DIRECTION)
    if pad in PAD_BUTTONS:
        return Control(pad, Kind.PAD_BUTTON)
    key = KEY_ALIASES.get(raw, raw)
    if key in KEYS:
        return Control("KEY_" + key, Kind.KEY)
    raise UnknownControl(f"unknown control {name!r}{_suggest(raw)}")


def all_names() -> list[str]:
    return (
        sorted(PAD_BUTTONS)
        + sorted(STICK_DIRECTIONS)
        + sorted("KEY_" + k for k in KEYS)
        + sorted(MOUSE_BUTTONS)
    )
