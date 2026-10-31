"""Windows: a virtual Xbox 360 controller through the ViGEmBus driver.

Games, Steam and emulators see it as a real wired Xbox 360 pad (XInput), so it
works with anything that supports a controller. Needs the ViGEmBus driver and the
``vgamepad`` package (``pip install vgamepad``; its installer offers ViGEmBus).
"""

from __future__ import annotations

from typing import Any

from ..controls import PAD_BUTTONS, Control, Kind
from .base import Backend, BackendUnavailable


def _load() -> Any:
    try:
        import vgamepad  # type: ignore[import-not-found]
    except ImportError as exc:
        raise BackendUnavailable(
            "the vgamepad package is missing: pip install vgamepad "
            "(it also installs the ViGEmBus driver on Windows)"
        ) from exc
    return vgamepad


class ViGEmGamepad(Backend):
    def __init__(self, module: Any = None) -> None:
        super().__init__(name="vigem-x360", kinds=frozenset({Kind.PAD_BUTTON}))
        vg = module or _load()
        try:
            self._pad = vg.VX360Gamepad()
        except Exception as exc:  # vgamepad raises a plain exception when ViGEmBus is absent
            raise BackendUnavailable(
                f"could not create a virtual Xbox 360 pad ({exc}); install the ViGEmBus driver"
            ) from exc
        self._flags = {name: getattr(vg.XUSB_BUTTON, flag) for name, (flag, _) in PAD_BUTTONS.items()}

    def _emit_button(self, control: Control, down: bool) -> None:
        flag = self._flags[control.name]
        if down:
            self._pad.press_button(button=flag)
        else:
            self._pad.release_button(button=flag)

    def _emit_axes(self, axes: tuple[float, ...]) -> None:
        lx, ly, rx, ry, lt, rt = axes
        # vgamepad uses the XInput convention (y up is positive), the same as ours.
        self._pad.left_joystick_float(x_value_float=lx, y_value_float=ly)
        self._pad.right_joystick_float(x_value_float=rx, y_value_float=ry)
        self._pad.left_trigger_float(value_float=lt)
        self._pad.right_trigger_float(value_float=rt)

    def _flush(self) -> None:
        self._pad.update()

    def _close(self) -> None:
        self._pad.reset()
        self._pad.update()
        del self._pad

