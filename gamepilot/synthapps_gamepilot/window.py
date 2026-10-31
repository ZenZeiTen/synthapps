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
    found_title = "(whole screen)"

    def rect(self) -> Rect | None:
        return None  # capture the whole primary monitor

    def focus_lost(self) -> bool:
        return False

    def activate(self) -> None:
        return None


_USER32 = None


def _user32():  # noqa: ANN202 - a ctypes DLL object
    """user32 with argument types set, so 64-bit window handles pass through intact."""
    global _USER32
    if _USER32 is None:
        if sys.platform != "win32":
            raise RuntimeError("this needs Windows")
        u = ctypes.windll.user32  # type: ignore[attr-defined]
        hwnd = ctypes.c_void_p
        u.IsWindowVisible.argtypes = [hwnd]
        u.GetWindowTextLengthW.argtypes = [hwnd]
        u.GetWindowTextW.argtypes = [hwnd, ctypes.c_wchar_p, ctypes.c_int]
        u.GetForegroundWindow.restype = hwnd
        u.SetForegroundWindow.argtypes = [hwnd]
        u.GetClientRect.argtypes = [hwnd, ctypes.c_void_p]
        u.ClientToScreen.argtypes = [hwnd, ctypes.c_void_p]
        # per-monitor DPI awareness v2, so coordinates are physical pixels
        with contextlib.suppress(AttributeError, OSError):
            u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        _USER32 = u
    return _USER32


def _window_text(hwnd: int) -> str:
    u = _user32()
    n = u.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _visible_windows() -> list[tuple[int, str]]:
    """Every visible top-level window that has a title, front to back."""
    u = _user32()
    out: list[tuple[int, str]] = []
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)  # type: ignore[attr-defined]

    def visit(hwnd: int, _: int) -> bool:
        if hwnd and u.IsWindowVisible(hwnd):
            title = _window_text(hwnd)
            if title:
                out.append((hwnd, title))
        return True

    u.EnumWindows(proto(visit), 0)
    return out


def visible_window_titles() -> list[str]:
    """Titles of the visible windows, to help choose ``title_contains``. Empty if unknown."""
    if sys.platform == "win32":
        return [t for _, t in _visible_windows()]
    if sys.platform.startswith("linux") and shutil.which("xdotool"):
        ids = subprocess.run(["xdotool", "search", "--onlyvisible", "--name", "."],
                             capture_output=True, text=True, timeout=5).stdout.split()
        titles = []
        for wid in ids:
            name = subprocess.run(["xdotool", "getwindowname", wid], capture_output=True,
                                  text=True, timeout=2).stdout.strip()
            if name:
                titles.append(name)
        return titles
    return []


class Win32Window(WindowTracker):
    def __init__(self, title_contains: str) -> None:
        from ctypes import wintypes

        self._w = wintypes
        self.user32 = _user32()
        self.title = title_contains
        self.hwnd = self._find(title_contains)
        self.found_title = _window_text(self.hwnd)

    def _find(self, needle: str) -> int:
        for hwnd, title in _visible_windows():
            if needle.lower() in title.lower():
                return hwnd
        raise WindowNotFound(f"no visible window title contains {needle!r}")

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
        self.found_title = self._run(["xdotool", "getwindowname", self.wid]).strip()

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
