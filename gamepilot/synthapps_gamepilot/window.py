"""Find the game window, read its position, and check that it has focus.

Input from virtual devices goes to whichever window has focus. If the player
alt-tabs away, the agent must stop typing into the browser, so the executor polls
:meth:`WindowTracker.focus_lost` every tick.

* Windows: user32 (EnumWindows, GetForegroundWindow, GetClientRect/ClientToScreen).
  The process is made per-monitor DPI aware so rectangles are in real pixels.
* Linux/X11: the ``xdotool`` command. Under Wayland, window lookup is not
  available to other programs; the tracker then reports the whole screen and
  cannot check focus (``--no-focus-check`` is required, and stated in the log).
"""

from __future__ import annotations

import contextlib
import ctypes
import shutil
import subprocess
import sys
from dataclasses import dataclass


@dataclass(frozen=True)
class Rect:
    left: int
    top: int
    width: int
    height: int


class WindowNotFound(RuntimeError):
    pass


class WindowTracker:
    """Base: no window, whole primary screen, focus always assumed."""

    title = ""

    def rect(self) -> Rect | None:
        return None  # capture the whole primary monitor

    def focus_lost(self) -> bool:
        return False

    def activate(self) -> None:
        return None


class Win32Window(WindowTracker):
    def __init__(self, title_contains: str) -> None:
        if sys.platform != "win32":
            raise RuntimeError("Win32Window needs Windows")
        from ctypes import wintypes

        self._w = wintypes
        self.user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        # per-monitor DPI awareness v2, so coordinates are physical pixels
        with contextlib.suppress(AttributeError, OSError):
            self.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        self.title = title_contains
        self.hwnd = self._find(title_contains)

    def _find(self, needle: str) -> int:
        found: list[int] = []
        proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def visit(hwnd: int, _: int) -> bool:
            if self.user32.IsWindowVisible(hwnd) and needle.lower() in self._text(hwnd).lower():
                found.append(hwnd)
                return False
            return True

        self.user32.EnumWindows(proto(visit), 0)
        if not found:
            raise WindowNotFound(f"no visible window title contains {needle!r}")
        return found[0]

    def _text(self, hwnd: int) -> str:
        n = self.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        self.user32.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value

    def rect(self) -> Rect:
        r = self._w.RECT()
        self.user32.GetClientRect(self.hwnd, ctypes.byref(r))
        pt = self._w.POINT(0, 0)
        self.user32.ClientToScreen(self.hwnd, ctypes.byref(pt))
        return Rect(pt.x, pt.y, r.right - r.left, r.bottom - r.top)

    def focus_lost(self) -> bool:
        return self.user32.GetForegroundWindow() != self.hwnd

    def activate(self) -> None:
        self.user32.SetForegroundWindow(self.hwnd)


class XdotoolWindow(WindowTracker):
    def __init__(self, title_contains: str, run: object = None) -> None:
        self._run = run or self._default_run
        self.title = title_contains
        out = self._run(["xdotool", "search", "--onlyvisible", "--name", title_contains])
        ids = out.split()
        if not ids:
            raise WindowNotFound(f"no visible window title contains {title_contains!r}")
        self.wid = ids[0]

    @staticmethod
    def _default_run(args: list[str]) -> str:
        if not shutil.which(args[0]):
            raise RuntimeError("xdotool is not installed (sudo apt install xdotool)")
        return subprocess.run(args, capture_output=True, text=True, timeout=2).stdout

    def rect(self) -> Rect:
        out = self._run(["xdotool", "getwindowgeometry", "--shell", self.wid])
        vals = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        return Rect(int(vals["X"]), int(vals["Y"]), int(vals["WIDTH"]), int(vals["HEIGHT"]))

    def focus_lost(self) -> bool:
        return self._run(["xdotool", "getactivewindow"]).strip() != self.wid

    def activate(self) -> None:
        self._run(["xdotool", "windowactivate", "--sync", self.wid])


def find_window(title_contains: str) -> WindowTracker:
    if not title_contains:
        return WindowTracker()
    if sys.platform == "win32":
        return Win32Window(title_contains)
    if sys.platform.startswith("linux"):
        return XdotoolWindow(title_contains)
    raise RuntimeError(f"window lookup is not supported on {sys.platform}")
