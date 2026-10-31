"""Pick the right virtual devices for this computer."""

from __future__ import annotations

import importlib.util
import os
import sys

from .base import Backend, BackendUnavailable, MultiBackend
from .record import RecordingBackend


def available_backends() -> dict[str, str]:
    """Each backend name with "ok" or the reason it cannot run here."""
    out: dict[str, str] = {"record": "ok (dry run: records inputs, sends nothing)"}
    if sys.platform == "win32":
        out["sendinput"] = "ok"
        out["vigem"] = "ok" if importlib.util.find_spec("vgamepad") else "missing: pip install vgamepad"
    elif sys.platform.startswith("linux"):
        evdev = importlib.util.find_spec("evdev") is not None
        writable = os.access("/dev/uinput", os.W_OK)
        reason = "ok" if evdev and writable else "; ".join(
            r for r, bad in (("missing: pip install evdev", not evdev),
                             ("/dev/uinput is not writable (see README: Linux setup)", not writable)) if bad
        )
        out["uinput"] = reason
    else:
        out["native"] = f"no virtual input backend for {sys.platform} yet"
    return out


def make_backend(device: str, *, dry_run: bool = False) -> Backend:
    """Create the backend for ``device``: "gamepad", "kbm" or "both"."""
    if device not in ("gamepad", "kbm", "both"):
        raise ValueError(f"device must be gamepad, kbm or both, not {device!r}")
    if dry_run:
        return RecordingBackend()
    parts: list[Backend] = []
    if sys.platform == "win32":
        if device in ("gamepad", "both"):
            from .vigem import ViGEmGamepad

            parts.append(ViGEmGamepad())
        if device in ("kbm", "both"):
            from .win_sendinput import SendInputKeyboardMouse

            parts.append(SendInputKeyboardMouse())
    elif sys.platform.startswith("linux"):
        from .uinput import UInputGamepad, UInputKeyboardMouse

        if device in ("gamepad", "both"):
            parts.append(UInputGamepad())
        if device in ("kbm", "both"):
            parts.append(UInputKeyboardMouse())
    else:
        raise BackendUnavailable(
            f"virtual input is supported on Windows and Linux; {sys.platform} is not supported yet"
        )
    return parts[0] if len(parts) == 1 else MultiBackend(*parts)
