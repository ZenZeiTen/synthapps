"""Find the game window, read its position, and check that it has focus.

Input from virtual devices goes to whichever window has focus. If the player
alt-tabs away, the agent must stop typing into the browser, so the executor polls
:meth:`WindowTracker.focus_lost` every tick.

:func:`list_windows` and :func:`candidate_windows` list the open windows with the
program that owns each, for automatic game detection (``setup``).

* Windows: user32 (EnumWindows, GetForegroundWindow, GetClientRect/ClientToScreen).
  The process is made per-monitor DPI aware so rectangles are in real pixels.
* Linux/X11: the ``xdotool`` command. Under Wayland, window lookup is not
  available to other programs; the tracker then reports the whole screen and
  cannot check focus (``--no-focus-check`` is required, and stated in the log).
"""

from __future__ import annotations

import contextlib
import ctypes
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Rect:
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class WindowInfo:
    """One open window: an opaque handle, its title, the program that owns it, its area."""

    handle: int | str
    title: str
    process: str
    rect: Rect
    pid: int = 0


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

    def activate(self) -> bool:
        return True


#: Programs whose windows are never the game (lower case, without .exe).
NOT_GAMES = {
    # Windows shell and system
    "explorer", "applicationframehost", "textinputhost", "systemsettings", "shellexperiencehost",
    "startmenuexperiencehost", "searchhost", "lockapp", "taskmgr", "conhost", "rundll32",
    # terminals and editors, including the one running this program
    "windowsterminal", "openconsole", "powershell", "pwsh", "cmd", "python", "pythonw", "py",
    "code", "notepad", "notepad++", "gnome-terminal-server", "konsole", "xterm", "alacritty",
    "kitty", "tilix", "xfce4-terminal", "gedit", "kate",
    # browsers and chat
    "chrome", "msedge", "msedgewebview2", "firefox", "brave", "opera", "vivaldi", "discord",
    "slack", "teams", "ms-teams", "spotify", "zoom",
    # launchers (the game runs in its own window)
    "steam", "steamwebhelper", "epicgameslauncher", "eadesktop", "galaxyclient", "battle.net",
    "ubisoftconnect", "upc",
    # Linux desktops
    "gnome-shell", "plasmashell", "xfce4-panel", "xfdesktop", "nautilus", "dolphin", "nemo",
}

MIN_WIDTH, MIN_HEIGHT = 320, 240


def _process_key(name: str) -> str:
    low = name.lower().rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    return low[:-4] if low.endswith(".exe") else low


def prefer_game(matches: list[tuple[object, str]]) -> object:
    """From windows whose title matched, as (handle, owning program), pick the likely game.

    A browser tab named "Stardew Valley Wiki - Google Chrome" contains the game's whole title,
    so title matching alone can pick it; the first window not owned by a known non-game wins.
    """
    for handle, process in matches:
        if _process_key(process) not in NOT_GAMES:
            return handle
    return matches[0][0]


def candidate_windows(windows: list[WindowInfo] | None = None) -> list[WindowInfo]:
    """Windows that could be a game: big enough, not a known non-game program, not ours."""
    out = []
    for w in list_windows() if windows is None else windows:
        if w.pid and w.pid == os.getpid():
            continue
        if _process_key(w.process) in NOT_GAMES:
            continue
        if w.rect.width < MIN_WIDTH or w.rect.height < MIN_HEIGHT:
            continue
        out.append(w)
    return out


def list_windows() -> list[WindowInfo]:
    """Visible, titled, not minimized top-level windows, front to back."""
    if sys.platform == "win32":
        return _win_list()
    if sys.platform.startswith("linux") and shutil.which("xdotool"):
        return _x_list()
    return []


def visible_window_titles() -> list[str]:
    """Titles of the visible windows, to help choose ``title_contains``. Empty if unknown."""
    return [w.title for w in list_windows()]


def tracker_for(info: WindowInfo) -> WindowTracker:
    """A tracker for a window found by :func:`list_windows`."""
    if sys.platform == "win32":
        return Win32Window.from_handle(int(info.handle))
    return XdotoolWindow.from_id(str(info.handle))


def find_window(title_contains: str) -> WindowTracker:
    if not title_contains:
        return WindowTracker()
    if sys.platform == "win32":
        return Win32Window(title_contains)
    if sys.platform.startswith("linux"):
        return XdotoolWindow(title_contains)
    raise RuntimeError(f"window lookup is not supported on {sys.platform}")


# --- Windows ------------------------------------------------------------------------

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
        u.IsIconic.argtypes = [hwnd]
        u.GetWindowTextLengthW.argtypes = [hwnd]
        u.GetWindowTextW.argtypes = [hwnd, ctypes.c_wchar_p, ctypes.c_int]
        u.GetWindowThreadProcessId.argtypes = [hwnd, ctypes.POINTER(ctypes.c_uint32)]
        u.GetForegroundWindow.restype = hwnd
        u.SetForegroundWindow.argtypes = [hwnd]
        u.ShowWindow.argtypes = [hwnd, ctypes.c_int]
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


def _win_cloaked(hwnd: int) -> bool:
    """True for windows that report visible but are hidden (suspended store apps)."""
    try:
        dwm = ctypes.windll.dwmapi  # type: ignore[attr-defined]
        value = ctypes.c_int(0)
        dwm.DwmGetWindowAttribute(ctypes.c_void_p(hwnd), 14, ctypes.byref(value), 4)  # DWMWA_CLOAKED
        return value.value != 0
    except (AttributeError, OSError):
        return False


def _win_process(pid: int) -> str:
    try:
        import psutil  # type: ignore[import-not-found]

        return psutil.Process(pid).name()
    except Exception:  # noqa: BLE001 - psutil missing, process gone, or access denied
        pass
    k = ctypes.windll.kernel32  # type: ignore[attr-defined]
    k.OpenProcess.restype = ctypes.c_void_p
    k.QueryFullProcessImageNameW.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_wchar_p,
                                             ctypes.POINTER(ctypes.c_uint32)]
    k.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ""
    try:
        size = ctypes.c_uint32(1024)
        buf = ctypes.create_unicode_buffer(1024)
        if k.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return Path(buf.value).name
        return ""
    finally:
        k.CloseHandle(handle)


def _visible_windows() -> list[tuple[int, str]]:
    """Every visible, not minimized, not cloaked top-level window with a title, front to back."""
    u = _user32()
    out: list[tuple[int, str]] = []
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)  # type: ignore[attr-defined]

    def visit(hwnd: int, _: int) -> bool:
        if hwnd and u.IsWindowVisible(hwnd) and not u.IsIconic(hwnd) and not _win_cloaked(hwnd):
            title = _window_text(hwnd)
            if title:
                out.append((hwnd, title))
        return True

    u.EnumWindows(proto(visit), 0)
    return out


def _win_list() -> list[WindowInfo]:
    u = _user32()
    out = []
    for hwnd, title in _visible_windows():
        pid = ctypes.c_uint32(0)
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        win = Win32Window.from_handle(hwnd)
        out.append(WindowInfo(hwnd, title, _win_process(pid.value), win.rect(), pid.value))
    return out


class Win32Window(WindowTracker):
    def __init__(self, title_contains: str) -> None:
        self._setup()
        self.title = title_contains
        self.hwnd = self._find(title_contains)
        self.found_title = _window_text(self.hwnd)

    @classmethod
    def from_handle(cls, hwnd: int) -> Win32Window:
        self = cls.__new__(cls)
        self._setup()
        self.hwnd = hwnd
        self.found_title = self.title = _window_text(hwnd)
        return self

    def _setup(self) -> None:
        from ctypes import wintypes

        self._w = wintypes
        self.user32 = _user32()

    def _find(self, needle: str) -> int:
        u = _user32()
        matches = []
        for hwnd, title in _visible_windows():
            if needle.lower() in title.lower():
                pid = ctypes.c_uint32(0)
                u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                matches.append((hwnd, _win_process(pid.value)))
        if not matches:
            raise WindowNotFound(f"no visible window title contains {needle!r}")
        return int(prefer_game(matches))

    def rect(self) -> Rect:
        r = self._w.RECT()
        self.user32.GetClientRect(self.hwnd, ctypes.byref(r))
        pt = self._w.POINT(0, 0)
        self.user32.ClientToScreen(self.hwnd, ctypes.byref(pt))
        return Rect(pt.x, pt.y, r.right - r.left, r.bottom - r.top)

    def focus_lost(self) -> bool:
        return self.user32.GetForegroundWindow() != self.hwnd

    def activate(self) -> bool:
        """Bring the window to the front. Returns whether Windows allowed it."""
        if self.user32.IsIconic(self.hwnd):
            self.user32.ShowWindow(self.hwnd, 9)  # SW_RESTORE
        self.user32.SetForegroundWindow(self.hwnd)
        if self.user32.GetForegroundWindow() == self.hwnd:
            return True
        # Windows refuses focus changes from background programs unless a key was just
        # pressed; a released Alt tap is the usual way to satisfy that rule.
        from .backends.win_sendinput import INPUT, key_input

        send = self.user32.SendInput
        for down in (True, False):
            event = key_input("LEFTALT", down)
            send(1, ctypes.byref(event), ctypes.sizeof(INPUT))
        self.user32.SetForegroundWindow(self.hwnd)
        time.sleep(0.05)
        return self.user32.GetForegroundWindow() == self.hwnd


# --- Linux (X11) --------------------------------------------------------------------

def _x_run(args: list[str]) -> str:
    if not shutil.which(args[0]):
        raise RuntimeError("xdotool is not installed (sudo apt install xdotool)")
    return subprocess.run(args, capture_output=True, text=True, timeout=2).stdout


def _x_list() -> list[WindowInfo]:
    out = []
    for wid in _x_run(["xdotool", "search", "--onlyvisible", "--name", "."]).split():
        title = _x_run(["xdotool", "getwindowname", wid]).strip()
        if not title:
            continue
        pid_text = _x_run(["xdotool", "getwindowpid", wid]).strip()
        pid = int(pid_text) if pid_text.isdigit() else 0
        process = ""
        if pid:
            with contextlib.suppress(OSError):
                process = Path(f"/proc/{pid}/comm").read_text().strip()
        try:
            rect = XdotoolWindow.from_id(wid).rect()
        except (KeyError, ValueError):
            continue
        out.append(WindowInfo(wid, title, process, rect, pid))
    return out


class XdotoolWindow(WindowTracker):
    def __init__(self, title_contains: str, run: object = None) -> None:
        self._run = run or _x_run
        self.title = title_contains
        out = self._run(["xdotool", "search", "--onlyvisible", "--name", title_contains])
        ids = out.split()
        if not ids:
            raise WindowNotFound(f"no visible window title contains {title_contains!r}")
        self.wid = str(prefer_game([(wid, self._process_of(wid)) for wid in ids]))
        self.found_title = self._run(["xdotool", "getwindowname", self.wid]).strip()

    @classmethod
    def from_id(cls, wid: str, run: object = None) -> XdotoolWindow:
        self = cls.__new__(cls)
        self._run = run or _x_run
        self.wid = wid
        self.found_title = self.title = self._run(["xdotool", "getwindowname", wid]).strip()
        return self

    def _process_of(self, wid: str) -> str:
        pid = self._run(["xdotool", "getwindowpid", wid]).strip()
        if not pid.isdigit():
            return ""
        try:
            return Path(f"/proc/{pid}/comm").read_text().strip()
        except OSError:
            return ""

    def rect(self) -> Rect:
        out = self._run(["xdotool", "getwindowgeometry", "--shell", self.wid])
        vals = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        return Rect(int(vals["X"]), int(vals["Y"]), int(vals["WIDTH"]), int(vals["HEIGHT"]))

    def focus_lost(self) -> bool:
        return self._run(["xdotool", "getactivewindow"]).strip() != self.wid

    def activate(self) -> bool:
        self._run(["xdotool", "windowactivate", "--sync", self.wid])
        return not self.focus_lost()
