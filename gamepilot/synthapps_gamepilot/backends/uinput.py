"""Linux: virtual devices through the kernel's uinput module (python-evdev).

The gamepad copies what the kernel ``xpad`` driver reports for a wired Xbox 360
pad (vendor 045e, product 028e, same buttons, axes and ranges), so SDL, Steam and
emulators apply their stock Xbox mapping to it.

Needs ``pip install evdev`` and write access to ``/dev/uinput`` (load the module
with ``sudo modprobe uinput`` and add a udev rule or the ``input`` group; see the
README). Works under X11 and Wayland, because it sits below both.
"""

from __future__ import annotations

from typing import Any

from ..controls import KEYS, MOUSE_BUTTONS, PAD_BUTTONS, Control, Kind
from .base import Backend, BackendUnavailable

EV_KEY, EV_REL, EV_ABS = 0x01, 0x02, 0x03
REL_X, REL_Y = 0x00, 0x01
ABS_X, ABS_Y, ABS_Z, ABS_RX, ABS_RY, ABS_RZ = 0x00, 0x01, 0x02, 0x03, 0x04, 0x05
ABS_HAT0X, ABS_HAT0Y = 0x10, 0x11
BUS_USB = 0x03

STICK_MAX = 32767
TRIGGER_MAX = 255


def _load() -> Any:
    try:
        import evdev  # type: ignore[import-not-found]
    except ImportError as exc:
        raise BackendUnavailable("the evdev package is missing: pip install evdev") from exc
    return evdev


def _open(evdev: Any, **kwargs: Any) -> Any:
    errors = (OSError, getattr(evdev, "UInputError", OSError))
    try:
        return evdev.UInput(**kwargs)
    except errors as exc:
        raise BackendUnavailable(
            f"cannot open /dev/uinput ({exc}); run 'sudo modprobe uinput' and give your user "
            "write access to /dev/uinput (see README: Linux setup)"
        ) from exc


def stick_value(v: float, invert: bool = False) -> int:
    v = max(-1.0, min(1.0, -v if invert else v))
    return int(round(v * STICK_MAX))


class UInputGamepad(Backend):
    def __init__(self, module: Any = None) -> None:
        super().__init__(name="uinput-x360", kinds=frozenset({Kind.PAD_BUTTON}))
        evdev = module or _load()
        absinfo = evdev.AbsInfo
        stick = absinfo(value=0, min=-32768, max=STICK_MAX, fuzz=16, flat=128, resolution=0)
        trigger = absinfo(value=0, min=0, max=TRIGGER_MAX, fuzz=0, flat=0, resolution=0)
        hat = absinfo(value=0, min=-1, max=1, fuzz=0, flat=0, resolution=0)
        self._dev = _open(
            evdev,
            events={
                EV_KEY: sorted(code for code in (c for _, c in PAD_BUTTONS.values()) if code),
                EV_ABS: [(ABS_X, stick), (ABS_Y, stick), (ABS_Z, trigger), (ABS_RX, stick),
                         (ABS_RY, stick), (ABS_RZ, trigger), (ABS_HAT0X, hat), (ABS_HAT0Y, hat)],
            },
            name="Microsoft X-Box 360 pad",
            vendor=0x045E, product=0x028E, version=0x0110, bustype=BUS_USB,
        )
        self._dpad: set[str] = set()

    def _emit_button(self, control: Control, down: bool) -> None:
        if control.name.startswith("DPAD_"):
            (self._dpad.add if down else self._dpad.discard)(control.name)
            x = ("DPAD_RIGHT" in self._dpad) - ("DPAD_LEFT" in self._dpad)
            y = ("DPAD_DOWN" in self._dpad) - ("DPAD_UP" in self._dpad)
            self._dev.write(EV_ABS, ABS_HAT0X, x)
            self._dev.write(EV_ABS, ABS_HAT0Y, y)
            return
        self._dev.write(EV_KEY, PAD_BUTTONS[control.name][1], 1 if down else 0)

    def _emit_axes(self, axes: tuple[float, ...]) -> None:
        lx, ly, rx, ry, lt, rt = axes
        # evdev's y axis grows downwards; ours grows upwards.
        self._dev.write(EV_ABS, ABS_X, stick_value(lx))
        self._dev.write(EV_ABS, ABS_Y, stick_value(ly, invert=True))
        self._dev.write(EV_ABS, ABS_RX, stick_value(rx))
        self._dev.write(EV_ABS, ABS_RY, stick_value(ry, invert=True))
        self._dev.write(EV_ABS, ABS_Z, int(round(max(0.0, min(1.0, lt)) * TRIGGER_MAX)))
        self._dev.write(EV_ABS, ABS_RZ, int(round(max(0.0, min(1.0, rt)) * TRIGGER_MAX)))

    def _flush(self) -> None:
        self._dev.syn()

    def _close(self) -> None:
        self._dev.close()


def _xdotool_pointer() -> Any:
    """Absolute pointer jumps on X11 via xdotool; None where that is not possible."""
    import os
    import shutil
    import subprocess

    if os.environ.get("XDG_SESSION_TYPE") == "wayland" or not shutil.which("xdotool"):
        return None

    def move(x: int, y: int) -> None:
        subprocess.run(["xdotool", "mousemove", str(x), str(y)], check=False, timeout=2)

    return move


class UInputKeyboardMouse(Backend):
    def __init__(self, module: Any = None, pointer: Any = "auto") -> None:
        self._pointer = _xdotool_pointer() if pointer == "auto" else pointer
        super().__init__(name="uinput-kbm", kinds=frozenset({Kind.KEY, Kind.MOUSE_BUTTON}),
                         supports_pointer=self._pointer is not None)
        evdev = module or _load()
        keys = sorted({linux for _, _, linux in KEYS.values()} | {c for _, c in MOUSE_BUTTONS.values()})
        self._dev = _open(
            evdev,
            events={EV_KEY: keys, EV_REL: [REL_X, REL_Y]},
            name="gamepilot virtual keyboard and mouse",
            bustype=BUS_USB,
        )

    def _emit_button(self, control: Control, down: bool) -> None:
        code = KEYS[control.name[4:]][2] if control.kind is Kind.KEY else MOUSE_BUTTONS[control.name][1]
        self._dev.write(EV_KEY, code, 1 if down else 0)

    def _emit_pointer(self, x: int, y: int) -> None:
        self._dev.syn()  # deliver earlier events before the pointer jumps
        self._pointer(x, y)

    def _emit_mouse_move(self, dx: int, dy: int) -> None:
        if dx:
            self._dev.write(EV_REL, REL_X, dx)
        if dy:
            self._dev.write(EV_REL, REL_Y, dy)

    def _flush(self) -> None:
        self._dev.syn()

    def _close(self) -> None:
        self._dev.close()
