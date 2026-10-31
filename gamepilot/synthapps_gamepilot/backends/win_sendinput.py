"""Windows: keyboard and mouse through ``SendInput``, the way games expect them.

* Keys are sent as hardware scan codes (``KEYEVENTF_SCANCODE``), with the E0 flag
  for extended keys. Many games read DirectInput or raw input and ignore the
  virtual-key codes that simpler automation tools send.
* Mouse movement is relative (no ``MOUSEEVENTF_ABSOLUTE``), so first-person games
  that lock the cursor and read raw deltas turn the camera.

Windows may block input sent into a program running as administrator from a
program that is not: run both at the same level.
"""

from __future__ import annotations

import ctypes
import sys
from collections.abc import Sequence

from ..controls import KEYS, MOUSE_BUTTONS, Control, Kind
from .base import Backend, BackendUnavailable

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_VIRTUALDESK = 0x4000
MOUSEEVENTF_ABSOLUTE = 0x8000
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 76, 77, 78, 79

# Fixed-width types so the layout matches Windows on any host (LONG is 32-bit there).
LONG = ctypes.c_int32
DWORD = ctypes.c_uint32
WORD = ctypes.c_uint16
ULONG_PTR = ctypes.c_size_t


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", LONG), ("dy", LONG), ("mouseData", DWORD), ("dwFlags", DWORD),
                ("time", DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", WORD), ("wScan", WORD), ("dwFlags", DWORD), ("time", DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", DWORD), ("wParamL", WORD), ("wParamH", WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", DWORD), ("u", _INPUTUNION)]


def key_input(name: str, down: bool) -> INPUT:
    scan, extended, _ = KEYS[name]
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_EXTENDEDKEY if extended else 0)
    if not down:
        flags |= KEYEVENTF_KEYUP
    inp = INPUT(type=INPUT_KEYBOARD)
    inp.ki = KEYBDINPUT(wVk=0, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)
    return inp


def mouse_button_input(name: str, down: bool) -> INPUT:
    (down_flag, up_flag, data), _ = MOUSE_BUTTONS[name]
    inp = INPUT(type=INPUT_MOUSE)
    inp.mi = MOUSEINPUT(dx=0, dy=0, mouseData=data, dwFlags=down_flag if down else up_flag,
                        time=0, dwExtraInfo=0)
    return inp


def mouse_move_input(dx: int, dy: int) -> INPUT:
    inp = INPUT(type=INPUT_MOUSE)
    inp.mi = MOUSEINPUT(dx=dx, dy=dy, mouseData=0, dwFlags=MOUSEEVENTF_MOVE, time=0, dwExtraInfo=0)
    return inp


def pointer_input(x: int, y: int, desktop: tuple[int, int, int, int]) -> INPUT:
    """An absolute move to screen pixel (x, y) on the virtual desktop (all monitors).

    ``desktop`` is (left, top, width, height) of the virtual desktop; Windows wants the
    position scaled to 0..65535 across it.
    """
    left, top, width, height = desktop
    nx = round((x - left) * 65535 / max(1, width - 1))
    ny = round((y - top) * 65535 / max(1, height - 1))
    inp = INPUT(type=INPUT_MOUSE)
    inp.mi = MOUSEINPUT(dx=max(0, min(65535, nx)), dy=max(0, min(65535, ny)), mouseData=0,
                        dwFlags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                        time=0, dwExtraInfo=0)
    return inp


class SendInputKeyboardMouse(Backend):
    def __init__(self, send: object = None, desktop: object = None) -> None:
        super().__init__(name="sendinput", kinds=frozenset({Kind.KEY, Kind.MOUSE_BUTTON}),
                         supports_pointer=True)
        if send is None:
            if sys.platform != "win32":
                raise BackendUnavailable("SendInput exists only on Windows")
            from ..window import _user32

            user32 = _user32()  # also makes this process DPI aware, so pixels match screenshots
            user32.SendInput.argtypes = [ctypes.c_uint, ctypes.POINTER(INPUT), ctypes.c_int]
            user32.SendInput.restype = ctypes.c_uint
            send = user32.SendInput

            def desktop() -> tuple[int, int, int, int]:
                m = user32.GetSystemMetrics
                return (m(SM_XVIRTUALSCREEN), m(SM_YVIRTUALSCREEN),
                        m(SM_CXVIRTUALSCREEN), m(SM_CYVIRTUALSCREEN))
        self._send = send
        self._desktop = desktop or (lambda: (0, 0, 1920, 1080))
        self._pending: list[INPUT] = []

    def _emit_button(self, control: Control, down: bool) -> None:
        if control.kind is Kind.KEY:
            self._pending.append(key_input(control.name[4:], down))
        else:
            self._pending.append(mouse_button_input(control.name, down))

    def _emit_mouse_move(self, dx: int, dy: int) -> None:
        self._pending.append(mouse_move_input(dx, dy))

    def _emit_pointer(self, x: int, y: int) -> None:
        self._pending.append(pointer_input(x, y, self._desktop()))  # type: ignore[operator]

    def _flush(self) -> None:
        batch: Sequence[INPUT] = self._pending
        self._pending = []
        if not batch:
            return
        array = (INPUT * len(batch))(*batch)
        sent = self._send(len(batch), array, ctypes.sizeof(INPUT))  # type: ignore[operator]
        if sent != len(batch):
            raise OSError(
                f"SendInput accepted {sent} of {len(batch)} events; another program may be "
                "blocking input (UIPI: run the agent at the same privilege level as the game)"
            )
